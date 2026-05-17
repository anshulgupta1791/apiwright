# Design: env-yaml-file-reader

## Overview

Load a single environment YAML file from disk using `js-yaml`'s **safe** loader
only, returning either the parsed object or a structured error for
missing-file / unreadable / malformed-YAML / empty / unsafe-tag cases. No
throwing for user-config problems — the function returns a discriminated result.

Depends on `env-config-types-and-schema` (#1) for shared result conventions.

## Public API

### `src/env/yaml-reader.ts`

```typescript
/** Successful parse outcome. */
export interface YamlReadSuccess {
  ok: true;
  data: Record<string, unknown>;
}

/** Failure outcome with a human-readable, path-aware message. */
export interface YamlReadFailure {
  ok: false;
  error: string;
  kind: "not_found" | "unreadable" | "malformed" | "empty" | "unsafe";
}

export type YamlReadResult = YamlReadSuccess | YamlReadFailure;

/**
 * Reads and safe-parses a YAML environment file.
 * @param filePath - Absolute or relative path to the YAML file.
 * @returns A discriminated result; never throws for user-config problems.
 */
export function readYamlFile(filePath: string): YamlReadResult;
```

Re-exported from `src/env/index.ts`.

## Internal Structure

```
src/env/yaml-reader.ts   # readYamlFile + result types
```

Imports (top of file): `readFileSync`, `existsSync` from `node:fs`;
`js-yaml` via the established `require()` shim convention (CJS interop, same as
`schema.ts`). Use `yaml.load` with `JSON_SCHEMA` (or `FAILSAFE`/default safe
schema) so custom/unsafe tags do NOT construct arbitrary types. `js-yaml`'s
`load` (v4) is already safe by default (no `!!js/function` etc.); we pass
`{ schema: yaml.JSON_SCHEMA }` to be explicit and reject custom tags.

## Behavior / Error Handling

1. **Missing file** → `existsSync` false → `{ ok:false, kind:"not_found",
   error: "Environment file not found: <path>" }`. Path is included.
2. **Unreadable** (permission/IO error on `readFileSync`) → catch →
   `{ ok:false, kind:"unreadable", error: "Could not read environment file
   <path>: <reason>" }`.
3. **Malformed YAML** → `yaml.load` throws `YAMLException` → catch → message
   includes the parser's line/column (`e.mark` / `e.message`) →
   `{ ok:false, kind:"malformed", error: "Invalid YAML in <path>: <yaml msg
   with line/column>" }`.
4. **Unsafe tag** → with `JSON_SCHEMA`, a custom tag like `!!js/function` or
   `!customtype` raises a `YAMLException` ("unknown tag"); mapped to
   `kind:"unsafe"` when the message indicates an unknown/unresolvable tag,
   otherwise `malformed`. No code executes. Distinguish by checking the
   YAML error message for `tag`.
5. **Empty file / whitespace-only** → `yaml.load` returns `undefined`/`null`
   → `{ ok:false, kind:"empty", error: "Environment file is empty: <path>" }`
   (not silently passed on).
6. **Non-object top-level** (e.g. a YAML scalar `42` or a list) → treated as
   `kind:"malformed"` with "expected a mapping" — env files must be a mapping.
7. **Success** → `{ ok:true, data: <parsed object> }`.

## Edge Cases

- File exists but is a directory → `readFileSync` throws EISDIR → `unreadable`.
- BOM / trailing newline → handled by js-yaml normally → success.
- YAML with anchors/aliases (safe feature) → success (still data-only).
- A YAML doc that is a valid mapping but contains `${secret.*}` strings →
  success; templating is a later phase, strings pass through verbatim.

## Integration Points

- `env-loader-orchestration` (#5) calls `readYamlFile`, then feeds
  `result.data` to `EnvironmentSchemaValidator` and the resolvers.
- Error `kind` lets the loader produce aggregated, user-friendly messages.

## Coverage Plan

`yaml-reader.ts` ≥95% on all 4 metrics. Tests use real temp files
(`node:os` tmpdir + `node:fs`) for: valid mapping, missing path, empty file,
whitespace-only, malformed YAML (bad indentation), unsafe custom tag,
non-mapping scalar, list top-level, and an unreadable path (directory) to hit
the catch branch. Each `kind` and each branch is exercised.

## Dependencies & Imports

- `node:fs` (`existsSync`, `readFileSync`), `node:os`, `node:path` (tests).
- `js-yaml` (already a dependency) + `@types/js-yaml` (devDep present).
