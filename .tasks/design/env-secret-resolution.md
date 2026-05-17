# Design: env-secret-resolution

## Overview

Resolve `${secret.NAME}` references in a parsed config from `process.env`.
Per V1_BUILD_SPEC.md §8 and the task spec: **`${secret.API_KEY}` maps to
`process.env.API_KEY` with NO prefix**. Missing or empty-string secrets fail
fast with a single aggregated error listing every unresolved reference.
Resolved values are recorded in an in-memory registry for later log
redaction. Secret values must NEVER appear in error messages or returned text.

Depends on `env-config-types-and-schema` (#1).

## Public API

### `src/env/secrets.ts`

```typescript
/** In-memory registry of resolved secret values, for log redaction. */
export class SecretRegistry {
  /** Records a resolved secret value. */
  add(value: string): void;
  /** Returns the set of all recorded secret values. */
  values(): ReadonlySet<string>;
  /** Number of recorded distinct secret values. */
  get size(): number;
}

/** Outcome of resolving all ${secret.*} references in a config tree. */
export interface SecretResolutionResult {
  ok: boolean;
  /** Present only when ok: true — the config with secrets substituted. */
  data?: Record<string, unknown>;
  /** Present only when ok: false — aggregated, value-free error message. */
  error?: string;
  /** The references that could not be resolved (names only, no values). */
  missing?: string[];
}

/**
 * Resolves every ${secret.NAME} in the config tree from process.env (no
 * prefix). Returns a new object; does not mutate the input. Aggregates all
 * missing/empty references into one error.
 * @param config - The parsed config object.
 * @param registry - Registry to record resolved values into.
 * @param env - The environment variable source (defaults to process.env).
 * @returns A discriminated resolution result.
 */
export function resolveSecrets(
  config: Record<string, unknown>,
  registry: SecretRegistry,
  env?: NodeJS.ProcessEnv,
): SecretResolutionResult;
```

Re-exported from `src/env/index.ts`.

## Resolution Semantics

- Token grammar: `${secret.<NAME>}` where `<NAME>` matches `[A-Za-z0-9_]+`.
- Mapping: `${secret.API_KEY}` → `env["API_KEY"]` (no prefix, exact name).
- A string may contain multiple tokens and surrounding text:
  `"Bearer ${secret.TOK}"` → `"Bearer <value>"`.
- Walk the entire tree: strings inside nested objects and arrays. Object keys
  are NOT resolved (values only). Non-string leaves pass through unchanged.
- Only `${secret.*}` is touched. `${env.*}`, `${response.*}`, `${request.*}`,
  `${db.*}`, `${token}` are left **intact** (template resolver / runner own
  those).
- **Missing**: env var unset → unresolved. **Empty**: env var is `""` →
  treated as missing (same handling).
- All unresolved references collected, de-duplicated, sorted; one aggregated
  error: `"Unresolved secret(s): API_KEY, QA_DB_PASSWORD. Set the
  corresponding environment variable(s)."` — **names only, never values**.
- On success: every resolved value added to the registry; return new tree.
- The substitution itself uses the registry only as a sink; redaction logic
  lives downstream (reporters/runner) and consumes `registry.values()`.

## Internal Structure

```
src/env/secrets.ts
  - SECRET_TOKEN_RE  (module-const regex, global)
  - SecretRegistry   (class)
  - resolveSecrets   (pure-ish: reads env, returns new tree)
  - internal walk()  (recursive tree transform, depth-safe)
```

Recursion depth: env files are shallow; a recursion guard is unnecessary but
the walk handles arrays + plain objects only (skips functions/Dates — env
files are pure JSON-ish from YAML JSON_SCHEMA, so only string/number/
boolean/null/array/object occur).

## Error Handling

- Never throws for user-config problems. A config with missing secrets returns
  `{ ok:false, error, missing:[...] }`.
- Two-pass: pass 1 collects all referenced secret names and which are
  unresolved; if any unresolved → return aggregated failure WITHOUT
  substituting (so no partial tree leaks). Pass 2 substitutes only when all
  resolve.
- Security: error/`missing` contain only the env-var NAME, never the value.
  Registry holds values in memory only; never serialized by this module.

## Edge Cases

1. `${secret.A}` unset → missing:["A"], aggregated error names A.
2. `${secret.A}` = "" → treated as missing (named in error).
3. Multiple missing → all listed once, sorted, comma-joined.
4. Same secret referenced twice → resolved once, registry has 1 value,
   missing list de-duped.
5. `"x-${secret.A}-${secret.B}"` both set → fully substituted in one string.
6. `${env.foo}` / `${secret` (no close) / `${token}` → untouched.
7. Nested: `databases.pg.password = "${secret.PW}"` → resolved deep.
8. Array values containing tokens → resolved element-wise.
9. Secret value that itself looks like `${secret.X}` → NOT re-expanded
   (single pass substitution; no recursive re-resolution — prevents injection).
10. Empty config / no tokens → `{ ok:true, data: <clone>, missing: [] }`.

## Coverage Plan

`secrets.ts` ≥95% on all 4 metrics. Tests inject a fake `env` object (no
reliance on real process.env; deterministic). Cover: single resolve, no-prefix
mapping, empty-string-as-missing, unset-as-missing, multi-missing aggregation,
de-dup, multi-token string, nested object, array, namespace isolation
(${env.*}/${token} untouched), no-double-expansion, registry size/values,
empty config, non-string leaves passthrough. Assert no secret value ever
appears in `error`.

## Dependencies & Imports

- No new deps. Pure TS + a regex. `NodeJS.ProcessEnv` from @types/node.
