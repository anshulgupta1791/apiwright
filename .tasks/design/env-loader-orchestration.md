# Design: env-loader-orchestration

## Overview

`EnvironmentLoader` composes the four already-shipped env primitives —
`readYamlFile` (#2), `resolveTemplates` (#4 `${env.*}`),
`resolveSecrets` (#3 `${secret.*}`), `EnvironmentSchemaValidator` (#1) —
into a single startup entry point. It loads an environment by name, applies
per-environment overrides via deep merge, resolves all template then secret
references, validates against the JSON schema, and runs a connection-name
consistency check on `databases` / `auth_strategies` keys.

Per V1_BUILD_SPEC.md §7–§8 and the task spec: the loader **never throws** for
user-config problems. Every failure (file not found, malformed YAML, schema
violation, unresolved `${env.*}`, missing `${secret.*}`, bad connection name)
returns a structured `{ valid:false, errors:[...] }` with human-readable,
aggregated messages. Secret values never appear in any error or in the
returned errors array. On success it returns the fully resolved environment
typed as `ResolvedEnvironment` plus the populated `SecretRegistry` so
downstream redaction (#10 reporting) can consume `registry.values()`.

Depends on: `env-yaml-file-reader` (#2), `env-secret-resolution` (#3),
`env-template-resolution` (#4), and the schema/types from #1.

## Public API

### `src/env/loader.ts`

```typescript
import type { ResolvedEnvironment } from "./types.js";
import { SecretRegistry } from "./secrets.js";

/** Discriminated outcome of EnvironmentLoader.load(). */
export interface EnvironmentLoadResult {
  /** True when the environment loaded, resolved, and validated cleanly. */
  valid: boolean;
  /** The fully resolved environment; present only when valid. */
  environment?: ResolvedEnvironment;
  /** Aggregated, human-readable error messages; present only when invalid. */
  errors?: string[];
  /**
   * Registry of resolved secret values, always returned (even on failure, so
   * any secrets resolved before a later-stage failure are still redactable).
   */
  secretRegistry: SecretRegistry;
}

/** Options controlling where/how the loader reads environment files. */
export interface EnvironmentLoaderOptions {
  /**
   * Directory the loader resolves env files against. Defaults to the current
   * working directory. `load("qa")` tries `<root>/.env.qa.yaml` then
   * `<root>/environments/qa.yaml`.
   */
  rootDir?: string;
  /**
   * Environment-variable source passed through to secret resolution.
   * Defaults to process.env. Injectable for deterministic tests.
   */
  env?: NodeJS.ProcessEnv;
}

/**
 * Orchestrates reading, override-merging, template + secret resolution,
 * schema validation, and connection-name consistency for one environment.
 * Never throws for user-config problems; returns a structured result.
 */
export class EnvironmentLoader {
  constructor(options?: EnvironmentLoaderOptions);

  /**
   * Loads an environment by name. Resolution order:
   *   1. `<rootDir>/.env.<name>.yaml`
   *   2. `<rootDir>/environments/<name>.yaml`
   * Then: deep-merge per-env overrides → resolve ${env.*} → resolve
   * ${secret.*} → schema-validate → connection-name consistency.
   * @param name - The environment name (e.g. "qa").
   * @returns A discriminated load result; never throws on user-config errors.
   */
  load(name: string): EnvironmentLoadResult;
}
```

Re-exported from `src/env/index.ts`:
`EnvironmentLoader`, `EnvironmentLoadResult`, `EnvironmentLoaderOptions`.

## Pipeline (order is load-bearing)

```
load(name)
  → resolve file path  (.env.<name>.yaml | environments/<name>.yaml)
  → readYamlFile(path)                       [#2]   fail → not found / malformed
  → applyEnvironmentOverrides(data, name)     deep-merge data.environments[name]
  → resolveTemplates(merged, merged)          [#4]   fail → unresolved ${env.*}
  → resolveSecrets(resolved, registry, env)   [#3]   fail → missing ${secret.*}
  → schemaValidator.validate(secretResolved)  [#1]   fail → schema errors
  → checkConnectionNames(secretResolved)             fail → bad/dup names
  → { valid:true, environment, secretRegistry }
```

**Why templates before secrets:** `${env.*}` may interpolate into a string
that also holds `${secret.*}`. Resolving env first keeps the two-namespace
isolation intact (template resolver has no `process.env` access; secret
resolver runs on the env-resolved tree). This matches §7 "namespaces never
overlap." Schema validation runs **after** resolution because the schema
checks the concrete final shape (e.g. `default_sla_ms` is an integer only
after `${env.sla}` resolves to a number-via-whole-token).

**Why a single `secretRegistry` is always returned:** §8 redaction must be
able to redact any secret that was resolved even if a *later* stage fails.
The registry is created once in `load()` and returned in every result.

## Per-Environment Overrides (deep merge)

Per the task spec acceptance criteria: "Per-environment overrides merge over
base values (override wins; deep merge for nested objects like databases)."

Convention: a base env file may declare an `environments` map keyed by env
name. When present, `data.environments[name]` is **deep-merged over** the
base document (override wins), then the `environments` key is dropped from
the working object so it never leaks into the resolved result or schema.

Deep-merge rules (`deepMerge(base, override)`):

- Both values plain objects → recurse key-by-key.
- Override key absent → keep base value.
- Override value is a non-object (string/number/boolean/null) or an array →
  override replaces base wholesale (arrays are NOT element-merged; replacing
  is the least-surprising rule for connection lists / credential arrays).
- Base key absent → take override value.
- Input objects are never mutated; a new tree is produced.

If no `environments` key exists, or `environments[name]` is absent, the base
document passes through unchanged (zero-override is the common case — most
projects keep one file per environment, not a multi-env base).

## Connection-Name Consistency Check

Acceptance criterion: "validates that every db connection / auth_strategy
key is a well-formed name and reports duplicates or empty names."

After schema validation, `checkConnectionNames(env)` inspects
`env.databases` and `env.auth_strategies` (each an object map):

- A key that is the empty string or whitespace-only → error
  `databases connection name must be non-empty`.
- A key not matching `^[A-Za-z0-9_]+$` → error
  `databases connection name "<key>" is invalid (use letters, digits, _)`.
- Duplicates: object keys are inherently unique in parsed JS objects, so a
  literal duplicate YAML key is already collapsed by js-yaml. The
  consistency check instead guards **cross-section collision**: a name that
  appears as BOTH a database connection AND an auth strategy is reported as
  `connection name "<key>" is used by both databases and auth_strategies`
  (ambiguous for `${db.<connection>...}` resolution downstream, #9 runner).
- All offending names aggregated into the `errors` array (no early return).

This stage only runs when schema validation passed (the schema already
guarantees `databases`/`auth_strategies` are objects when present).

## Error Handling

- **Never throws** for user-config problems. Each stage’s discriminated
  failure is mapped to `{ valid:false, errors:[...], secretRegistry }`.
- File not found / unreadable / malformed / empty / unsafe → single error
  from `readYamlFile`’s message (already path-aware and human-readable).
- Unresolved `${env.*}` → `resolveTemplates` aggregated error (one string).
- Missing/empty `${secret.*}` → `resolveSecrets` aggregated error (one
  string, names only — never values).
- Schema violations → `EnvironmentSchemaValidator` formatted errors (array).
- Connection-name violations → aggregated array from the check.
- **Fail-fast per stage:** the first failing stage short-circuits; later
  stages do not run (e.g. a malformed file never reaches schema validation).
  This mirrors the spec’s "fail at startup with explicit error listing which
  references failed" — each stage already aggregates *within* itself.
- A genuinely unexpected internal throw (should be impossible given the
  primitives never throw for user input) is caught at the `load()` boundary
  and surfaced as a single `unexpected error: <message>` entry rather than
  propagating — keeps the "never throws" contract absolute.

## Edge Cases

1. `load("qa")` with neither `.env.qa.yaml` nor `environments/qa.yaml` →
   `valid:false`, error listing both attempted paths.
2. `.env.qa.yaml` exists but is malformed YAML → `valid:false`, parse error.
3. `.env.qa.yaml` takes precedence over `environments/qa.yaml` when both
   exist (dotfile is the explicit per-env override location).
4. Base file with `environments: { qa: { base_url: ... } }` → qa overrides
   deep-merged; `environments` key stripped from result.
5. Override replaces a nested DB password but keeps host/port (deep merge).
6. Override sets `databases.x` where base had no `databases` → added.
7. Array value in override (e.g. a list) replaces base array wholesale.
8. `${env.missing}` somewhere → template stage fails, secrets never run.
9. `${secret.MISSING}` with all env present → secret stage fails; the
   registry still contains any secrets resolved (none here, but contract
   holds); error names only.
10. Schema failure (e.g. `prod` missing) after clean resolution →
    `valid:false` with schema errors.
11. `databases: { "": {...} }` → connection-name error (empty name).
12. `databases: { "bad-name": {...} }` → invalid-name error (hyphen).
13. A name used in both `databases` and `auth_strategies` → collision error.
14. Fully valid file → `valid:true`, `environment` typed as
    `ResolvedEnvironment`, `secretRegistry.size` reflects resolved secrets.
15. Successful load: `${env.*}` and `${secret.*}` fully substituted;
    `${response.*}`/`${token}`/`${db.*}` left intact for the runner (#9).
16. Empty string name `load("")` → path resolution still attempted, file
    not found error (no throw).
17. Unexpected internal error path covered via an injected reader stub in
    tests (the catch-all boundary).

## Internal Structure

```
src/env/loader.ts
  - EnvironmentLoadResult        (interface, exported)
  - EnvironmentLoaderOptions     (interface, exported)
  - deepMerge(base, override)    (pure, recursive, new tree)
  - applyEnvironmentOverrides()  (strips & merges data.environments[name])
  - isPlainObject(v)             (guard: object, not array, not null)
  - CONNECTION_NAME_RE           (module const ^[A-Za-z0-9_]+$)
  - checkConnectionNames(env)    (returns string[] of violations)
  - EnvironmentLoader            (class; load() runs the pipeline)
```

`EnvironmentLoader` is a thin orchestrator: each helper is independently
unit-testable, keeping the class method’s branching shallow (pipeline
invariant: small functions, single responsibility, no duplication — the
deep-merge and tree work reuse plain recursion, not a new copy of
`tree-walk` which is string-leaf-specific and not suited to structural
merge).

## Coverage Plan

`loader.ts` must hit ≥95% on branches, functions, lines, statements.
Test strategy: write real temp YAML files under an OS temp dir (the reader
cannot be ESM-mocked, same constraint noted in the yaml-reader design), and
inject the `env` source for deterministic secret resolution.

Test matrix:

- Path resolution: `.env.<name>.yaml` chosen; fallback to
  `environments/<name>.yaml`; precedence when both exist; neither exists
  (both paths in error); custom `rootDir`.
- Reader failures: malformed YAML, empty file → mapped errors.
- Deep merge: nested override wins; base-only keys kept; override-only keys
  added; array replacement; non-object override replaces object; no
  `environments` key (passthrough); `environments[name]` absent (passthrough).
- Template stage: unresolved `${env.*}` → fail before secrets; successful
  `${env.*}` whole-token typed substitution (e.g. SLA number).
- Secret stage: missing secret → fail (names only, no value in error);
  successful resolution populates registry; registry returned on failure too.
- Schema stage: missing required field after resolution → schema errors.
- Connection names: empty name; whitespace-only name; invalid char name;
  valid names pass; cross-section collision; multiple violations aggregated;
  no databases/auth_strategies (skip cleanly); only databases / only auth.
- Success: full file (mirrors the §7 example) → `valid:true`, typed env,
  `${response.*}`/`${token}` left intact, registry size correct.
- Boundary: empty-string name; the catch-all unexpected-error path via an
  injected throwing reader (constructor option) — covers the final branch.
- `secretRegistry` always present on every result shape.

## Dependencies & Imports

No new npm dependencies. Imports only existing siblings:
`./yaml-reader.js` (`readYamlFile`), `./template-resolver.js`
(`resolveTemplates`), `./secrets.js` (`SecretRegistry`, `resolveSecrets`),
`./schema.js` (`EnvironmentSchemaValidator`), `./types.js`
(`ResolvedEnvironment`), and `node:path` for path joining. The catch-all
test seam is a constructor-injectable reader function defaulting to
`readYamlFile`, kept internal (not exported) to avoid widening the public
API while still enabling the unexpected-error branch to be covered.
