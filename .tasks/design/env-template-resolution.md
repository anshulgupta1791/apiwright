# Design: env-template-resolution

## Overview

Resolve `${env.*}` template references against the parsed environment object.
`${env.foo}` and nested paths like `${env.db.host}` resolve through the env
object. Namespace isolation is absolute: `${env.*}` can NEVER read a secret —
only the env object is consulted. Missing `${env.*}` paths fail fast with one
aggregated error listing every unresolved path. The resolver walks the full
config tree and substitutes in place (returning a new object), leaving
`${secret.*}`, `${response.*}`, `${request.*}`, `${db.*}`, `${token}` intact.

Depends on `env-config-types-and-schema` (#1).

## Public API

### `src/env/template-resolver.ts`

```typescript
/** Outcome of resolving all ${env.*} references in a config tree. */
export interface TemplateResolutionResult {
  ok: boolean;
  /** Present only when ok — config with ${env.*} substituted. */
  data?: Record<string, unknown>;
  /** Present only when not ok — aggregated error. */
  error?: string;
  /** Full dotted paths that could not be resolved. */
  missing?: string[];
}

/**
 * Resolves every ${env.PATH} reference in the config tree against the
 * provided environment object (the same object, post-secret-resolution).
 * Only the env object is consulted — never secrets. Aggregates all missing
 * paths into one error. Does not mutate the input.
 * @param config - The config tree to resolve (often the env object itself).
 * @param envObject - The environment object ${env.*} resolves against.
 * @returns A discriminated resolution result.
 */
export function resolveTemplates(
  config: Record<string, unknown>,
  envObject: Record<string, unknown>,
): TemplateResolutionResult;
```

Re-exported from `src/env/index.ts`.

## Resolution Semantics

- Token grammar: `${env.<PATH>}` where `<PATH>` is dot-separated segments,
  each `[A-Za-z0-9_]+` (e.g. `env.base_url`, `env.db.host`,
  `env.a.b.c`). Regex: `\$\{env\.([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*)\}`.
- Resolution: split PATH on `.`, walk `envObject` segment by segment. A
  segment landing on a non-object before the path ends → unresolved. A final
  value that is `undefined` → unresolved.
- A resolved value that is a string is substituted textually. A resolved
  value that is a non-string primitive (number/boolean) is stringified when
  the token is embedded in a larger string; when the entire string is exactly
  one token, the **typed value is preserved** (e.g. `default_sla_ms:
  "${env.sla}"` with `sla: 1000` → number `1000`, not `"1000"`). This keeps
  numeric env values usable downstream.
- Multiple tokens in one string (`"Bearer ${env.prefix}-${env.id}"`) → every
  `${env.*}` substituted (string interpolation; typed-preservation only when
  the whole string is a single token).
- Walk entire tree: strings in nested objects and arrays. Keys not resolved.
- Namespace isolation: only `${env.*}` is touched. `${secret.*}`,
  `${response.*}`, `${request.*}`, `${db.*}`, `${token}` left verbatim. The
  env object is the ONLY data source — there is no secret access path in this
  module, structurally guaranteeing `${env.*}` cannot read a secret.
- Single pass: a resolved value that itself contains `${env.x}` is NOT
  re-expanded (prevents injection / infinite loops).
- All unresolved paths collected, de-duplicated, sorted; one aggregated
  error naming each full path (e.g. `env.db.host`). No partial substitution
  on failure.

## Internal Structure

```
src/env/template-resolver.ts
  - ENV_TOKEN_RE / WHOLE_ENV_TOKEN_RE (module consts)
  - lookupPath(envObject, dottedPath) -> { found, value }
  - collectPaths(value, into)         (recursive)
  - resolveTemplates(config, envObject)
  - transform(value, resolver)        (recursive, new tree)
```

`lookupPath` returns a discriminated `{ found: boolean; value?: unknown }`
so a legitimately-resolved `undefined`/`null` is distinguishable (a null env
value is treated as resolved-to-null; only a missing path is "missing").

## Error Handling

- Never throws for user-config problems.
- Two-pass: collect all `${env.*}` paths, attempt each lookup; if ANY path
  unresolved → aggregated failure, no substitution. Else substitute.
- Error: `"Unresolved environment reference(s): env.db.host, env.x. Check the
  environment file."` — paths only.

## Edge Cases

1. `${env.base_url}` → top-level value.
2. `${env.db.host}` → nested object path.
3. Missing leaf (`env.db.host` where db has no host) → missing:["env.db.host"].
4. Path through a non-object (`env.base_url.foo` where base_url is string) →
   missing:["env.base_url.foo"].
5. Multiple missing → aggregated, de-duped, sorted.
6. Whole-string single token with numeric value → typed number preserved.
7. Whole-string single token with string value → string.
8. Embedded token in larger string → stringified interpolation.
9. `"${env.a}-${env.b}"` both present → fully interpolated.
10. `${secret.X}` / `${token}` / `${response.x}` / `${request.x}` /
    `${db.c.q.col}` → untouched.
11. Resolved value containing `${env.y}` → NOT re-expanded.
12. Env value resolves to `null` → treated as resolved (substitutes the
    string "null" when embedded; preserves `null` when whole-token).
13. Array elements with tokens → resolved element-wise.
14. Input not mutated.
15. No `${env.*}` tokens → ok, missing: [].

## Coverage Plan

`template-resolver.ts` ≥95% all 4 metrics. Tests cover every edge case above
including: typed preservation (number, boolean, null), embedded vs whole,
non-object traversal failure, multi-missing aggregation, namespace isolation
(explicit secret-object NOT consulted), no double expansion, deep nesting,
arrays, no-mutation, branch-free helper paths.

## Dependencies & Imports

- No new deps. Pure TS + regex. Structurally cannot access secrets (no
  process.env / SecretRegistry import in this module).
