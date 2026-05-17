# Design: Task #4 — Postman v2.1 Importer (`src/importers/`)

This document is the verbatim contract for the test-engineer and
implementation-engineer agents covering all 11 decomposed Postman subtasks
as one cohesive `src/importers/` module. Every type, signature, file, error
path, and edge case below is binding.

## Scope and Source Authority

- Authoritative spec: `V1_BUILD_SPEC.md` §1 (lines 306–351), Importer System
  and the canonical per-endpoint JSON shape.
- FROZEN, never modified: `src/cli/seams/importer.ts`
  (`Importer`, `ImportOutcome {written, warnings}`, `NotImplementedError`),
  `src/cli/commands/import.ts`.
- Reused verbatim (read for exact contracts):
  - `src/core/canonical-model.ts` — `CanonicalEndpoint`, `CanonicalRequest`,
    `CanonicalResponse`, `HttpMethod`, `JsonSchema`, `CanonicalSource`.
  - `src/core/schema-validator.ts` — `SchemaValidator.validateEndpoint`
    → `{ valid: boolean; errors?: string[] }`, `formatAjvErrors`,
    `ENDPOINT_META_SCHEMA`. The validator already runs `formatAjvErrors`
    internally; consumers use `result.errors` directly.
  - `src/core/safe-json.ts` — `parseJson(raw): { ok:true; value } | { ok:false; error }`.
    This is the ONLY permitted JSON parse. Raw `JSON.parse` is a semgrep
    finding. (Note: the postman-collection SDK calls `JSON.parse` internally;
    we never hand it raw text — we hand it the object already produced by
    `parseJson`, so no raw parse occurs in our code.)
  - `src/env/template-resolver.ts` — the `${env.*}` grammar. The resolver
    accepts `\$\{env\.([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*)\}`. Our rewritten
    tokens MUST satisfy this exact grammar.
  - `src/cli/entry.ts` `makeDefaultDeps` — the single integration point.
- Dependencies present in `package.json`: `postman-collection@^5.3.0`,
  `@types/postman-collection@^3.5.0`.

### Coverage policy applied to this design (binding)

`configs/vitest.config.ts` excludes `src/**/types.ts` and `src/cli/entry.ts`
from coverage; everything else under `src/**` is gated at 95% branches /
functions / lines / statements.

Design consequences:

- Pure type-only declarations live in files literally named `types.ts` so
  they are coverage-exempt. **No executable logic may live in any `types.ts`.**
- Every other file (loaders, converters, writers, seams, orchestrator,
  composite) is gated at 95% and MUST be exercised by unit tests including
  **default-seam constructor fallbacks** (`x = options.x ?? new DefaultX()`).
  These fallbacks are tested by constructing the class with no options and
  asserting the default collaborator is used (per `.claude/README.md`:
  default-seam fallbacks are NOT an accepted istanbul-ignore category).
- `/* istanbul ignore next */` is permitted in this module ONLY for
  platform/OS-specific errno branches in `NodeImporterFileSystem` (mirroring
  the existing `src/cli/fs-seam.ts` precedent) and provably-unreachable
  defensive guards whose comment names the invariant. Every other branch
  must be reached by tests via injected fakes.

---

## File Layout (binding)

All files: kebab-case names, one exported class per file, TSDoc on every
exported symbol, ESM `.js` import specifiers, ≤500 lines hard / ≤300 soft,
≤100-char lines. Estimated line counts are budgets, not minimums.

```
src/importers/
  types.ts                         # coverage-exempt; all shared types/interfaces  (~180)
  fs-seam.ts                        # NodeImporterFileSystem (class)                (~140)
  warnings.ts                       # Warnings accumulator (class)                  (~70)
  composite-importer.ts             # CompositePostmanImporter (class)              (~80)
  index.ts                          # public barrel re-exports                      (~25)
  postman/
    collection-loader.ts            # PostmanCollectionLoader (class)               (~180)
    flattener.ts                    # PostmanFlattener (class)                      (~170)
    variable-templating.ts          # PostmanVariableTemplater (class)              (~190)
    schema-infer.ts                 # JsonSchemaInferrer (class) — SHARED helper    (~150)
    request-converter.ts            # PostmanRequestConverter (class)               (~230)
    response-seeder.ts              # PostmanResponseSeeder (class)                 (~140)
    auth-extractor.ts               # PostmanAuthExtractor (class) — SECURITY       (~260)
    endpoint-assembler.ts           # PostmanEndpointAssembler (class)              (~190)
    path-naming.ts                  # PathNamer (class) — id/path/filename safety   (~170)
    output-writer.ts                # PostmanOutputWriter (class)                   (~160)
    postman-importer.ts             # PostmanImporter (class) — orchestrator        (~210)

tests/fixtures/postman/
  sample.postman_collection.json    # hand-authored v2.1 fixture

tests/integration/importers/
  postman.test.ts                   # end-to-end pipeline test
```

Files modified outside `src/importers/`: **only** `src/cli/entry.ts`
(`makeDefaultDeps` body — swap `new NotImplementedImporter()` for
`new CompositePostmanImporter()`). `src/cli/seams/importer.ts` and
`src/cli/commands/import.ts` stay byte-for-byte unchanged.

### Why these boundaries (defended)

- **One class per file, composition not inheritance**: every pipeline stage
  is an independently-testable unit with a single responsibility; the
  orchestrator composes them. No stage extends another. This satisfies the
  OOP-with-composition invariant and keeps each file under the soft limit.
- **`schema-infer.ts` is a standalone shared class** consumed by both
  `request-converter.ts` (subtask 4, body schema) and `response-seeder.ts`
  (subtask 5, response schema). Single source of inference logic → DRY
  enforced structurally, not by convention.
- **`path-naming.ts` is a standalone shared class** consumed by
  `request-converter.ts` (endpoint `id` generation) and `output-writer.ts`
  (directory + filename sanitization). Both need the identical
  `^[a-z0-9._-]+$`/filesystem-safe slug rules and deterministic dedupe;
  one class prevents two divergent slug implementations.
- **`fs-seam.ts` is a NEW write-capable seam under `src/importers/`**, NOT a
  mutation of `src/cli/fs-seam.ts`. The CLI seam is read-only by contract and
  consumed by `ConfigLoader`/`ValidateCommand`; adding write methods there
  would widen a frozen interface. A separate seam keeps blast radius zero.
- **`types.ts` holds only types** so it is coverage-exempt and the gated
  files stay small and logic-focused.

---

## Subtask 1 — Internal types + write-capable FS seam

### Files

- `src/importers/types.ts` (coverage-exempt; types only)
- `src/importers/fs-seam.ts` (`NodeImporterFileSystem`)
- `src/importers/warnings.ts` (`Warnings`)
- `src/importers/index.ts` (barrel)

### Type definitions (`src/importers/types.ts`)

```typescript
import type { CanonicalEndpoint } from "../core/canonical-model.js";

/** Categorized FS error code, mirroring src/cli/fs-seam.ts conventions. */
export type ImporterFsErrorCode = "ENOENT" | "EACCES" | "EISDIR" | "UNKNOWN";

/** Tagged error thrown by ImporterFileSystem.readFile on failure. */
export interface ImporterFsError extends Error {
  /** Categorized error code for caller branching. */
  code: ImporterFsErrorCode;
}

/**
 * Write-capable filesystem abstraction for the importer pipeline.
 *
 * Distinct from the read-only src/cli FileSystem seam. All importer disk
 * access flows through this so the pipeline is fully testable with an
 * in-memory fake (no real disk; supports the 95% coverage gate).
 */
export interface ImporterFileSystem {
  /**
   * Reads a UTF-8 file. Throws a tagged {@link ImporterFsError} on failure.
   * @param path - Absolute file path.
   * @returns The file contents as a string.
   */
  readFile(path: string): string;

  /**
   * Recursively creates a directory (mkdir -p semantics). Idempotent: an
   * already-existing directory is not an error.
   * @param dir - Absolute directory path.
   */
  mkdirp(dir: string): void;

  /**
   * Writes UTF-8 contents to a file, overwriting if present. The parent
   * directory must already exist (callers call mkdirp first).
   * @param path - Absolute file path.
   * @param contents - UTF-8 file contents.
   */
  writeFile(path: string, contents: string): void;
}

/** One ordered request flattened out of the Postman item tree. */
export interface FlattenedRequest {
  /** Stable id source: Postman item id when present, else "". */
  postmanId: string;
  /** Display name (Postman item name); may be "". */
  name: string;
  /** Ordered folder-path segments from root to parent; [] at root. */
  folderPath: string[];
  /** Raw Postman method string (e.g. "POST"); may be "" or unknown. */
  method: string;
  /** Raw URL string with Postman {{var}} tokens intact. */
  rawUrl: string;
  /** Header lines in document order (templating not yet applied). */
  headers: FlattenedHeader[];
  /** Raw request body, mode-tagged; undefined when no body. */
  body?: FlattenedBody;
  /** Query parameters in document order. */
  query: FlattenedQueryParam[];
  /** Pre-request script text joined by "\n"; "" when absent. */
  preRequestScript: string;
  /** Request-level auth block, or undefined when none. */
  auth?: FlattenedAuth;
  /** Saved/example responses in document order. */
  responses: FlattenedResponse[];
  /** True when the Postman item is disabled. */
  disabled: boolean;
  /** Variables in scope (collection + folder + request), name→raw value. */
  variables: Record<string, string>;
}

/** A single Postman header line. */
export interface FlattenedHeader {
  /** Header name. */
  key: string;
  /** Header value (may contain {{var}} tokens). */
  value: string;
  /** True when the header line is disabled in Postman. */
  disabled: boolean;
}

/** A single Postman query parameter. */
export interface FlattenedQueryParam {
  /** Param name. */
  key: string;
  /** Param value (may contain {{var}} tokens); "" when valueless. */
  value: string;
  /** True when the param is disabled in Postman. */
  disabled: boolean;
}

/** Request body in its Postman raw form. */
export interface FlattenedBody {
  /** Postman body mode. */
  mode: "raw" | "urlencoded" | "formdata" | "file" | "graphql" | string;
  /** Raw textual body for mode "raw"; "" otherwise. */
  raw: string;
}

/** Normalized request-level auth block. */
export interface FlattenedAuth {
  /** Postman auth type, e.g. "bearer" | "basic" | "apikey" | other. */
  type: string;
}

/** A Postman saved/example response. */
export interface FlattenedResponse {
  /** HTTP status code; 0 when absent/unparseable. */
  code: number;
  /** Raw response body string; "" when absent. */
  body: string;
}

/** Per-request conversion result. Endpoint absent ⇒ request was dropped. */
export interface ConversionResult {
  /** The assembled, schema-valid endpoint, or undefined when dropped. */
  endpoint?: CanonicalEndpoint;
  /** Human-readable warnings accumulated for this request. */
  warnings: string[];
}

/** Discriminated collection-load result. Never represents a thrown error. */
export type CollectionLoadResult =
  | { ok: true; collection: LoadedCollection }
  | { ok: false; error: string };

/** Hydrated, validated v2.1 collection plus derived metadata. */
export interface LoadedCollection {
  /** postman-collection SDK Collection instance (typed via @types). */
  sdk: import("postman-collection").Collection;
  /** Basename of the input file, for source.collection. */
  fileBasename: string;
  /**
   * RECONCILED (implementation drift, recorded post-build): the
   * postman-collection SDK v5 does NOT expose folder-level `variables`
   * on hydrated `ItemGroup`s, so folder variables cannot be merged via
   * the SDK as subtask 2 originally described. The loader therefore also
   * carries `rawParsed` — the already-parsed collection JSON (reused
   * from the single `parseJson` call; NO second JSON parse occurs) — and
   * the flattener re-derives folder variables via a position-parallel
   * walk of `rawParsed` alongside the SDK tree.
   */
  rawParsed: Record<string, unknown>;
}
```

### `NodeImporterFileSystem` (`src/importers/fs-seam.ts`)

```typescript
export class NodeImporterFileSystem implements ImporterFileSystem {
  readFile(path: string): string;
  mkdirp(dir: string): void;       // fs.mkdirSync(dir, { recursive: true })
  writeFile(path: string, contents: string): void; // fs.writeFileSync utf8
}
```

- `readFile` mirrors `src/cli/fs-seam.ts` exactly: catch, read `err.code`,
  map to `ENOENT|EACCES|EISDIR|UNKNOWN`, throw a tagged `ImporterFsError`
  with message `readFile failed: <path>`. The `EACCES`/`UNKNOWN` ternary
  arms carry `/* istanbul ignore next — OS-specific errno */` (the one
  accepted category, matching the precedent file).
- `mkdirp` uses `mkdirSync(dir, { recursive: true })`; `recursive:true`
  makes an existing dir a no-op (no EEXIST branch needed).
- `writeFile` uses `writeFileSync(path, contents, "utf8")`.
- **Default-seam coverage**: subtask-1 tests construct `NodeImporterFileSystem`
  with no args and call `mkdirp` + `writeFile` + `readFile` against an OS
  temp dir created in the test (real ops), then `readFile` a missing path to
  assert `code === "ENOENT"`. The constructor-fallback wiring in every
  downstream class (`fs = options.fs ?? new NodeImporterFileSystem()`) is
  unit-tested by constructing with no `fs` and asserting behavior, never
  istanbul-ignored.

### `Warnings` (`src/importers/warnings.ts`)

```typescript
export class Warnings {
  /** Appends one message. Never throws. */
  add(message: string): void;
  /** Appends every message, in order. */
  addAll(messages: readonly string[]): void;
  /**
   * Appends every message prefixed with a request-name context tag in the
   * form `[<context>] <message>`.
   */
  addAllWithContext(context: string, messages: readonly string[]): void;
  /** Returns a defensive copy of accumulated messages in insertion order. */
  list(): string[];
  /** Count of accumulated messages. */
  get size(): number;
}
```

Rationale: a class (not a bare array) so accumulation, contextual prefixing,
and deterministic ordering live in one tested place reused by every stage,
satisfying DRY for the `{ endpoint?, warnings }` pattern.

### Edge cases (subtask 1)

| Case | Behavior |
|---|---|
| `mkdirp` on existing dir | No-op (recursive flag); no throw. |
| `writeFile` parent missing | Throws `ImporterFsError` UNKNOWN; callers always `mkdirp` first so this is defensive. |
| `readFile` ENOENT | Tagged `ImporterFsError`, `code:"ENOENT"`. |
| `Warnings.addAll([])` | No-op. |
| `addAllWithContext` empty list | No-op. |

---

## Subtask 2 — Collection loader + flattener

### Files

- `src/importers/postman/collection-loader.ts` (`PostmanCollectionLoader`)
- `src/importers/postman/flattener.ts` (`PostmanFlattener`)

### `PostmanCollectionLoader`

```typescript
export interface PostmanCollectionLoaderOptions {
  /** Write-capable FS seam. Default: new NodeImporterFileSystem(). */
  fs?: ImporterFileSystem;
}

export class PostmanCollectionLoader {
  constructor(options?: PostmanCollectionLoaderOptions);
  /**
   * Reads, JSON-parses (via parseJson), shape-checks, and SDK-hydrates a
   * Postman v2.1 collection file. Never throws for bad input — returns a
   * discriminated failure instead.
   * @param file - Path to the collection file.
   * @returns A CollectionLoadResult.
   */
  load(file: string): CollectionLoadResult;
}
```

Load algorithm (ordered, fail-soft):

1. `fs.readFile(file)` inside `try`. On `ImporterFsError` →
   `{ ok:false, error: "Cannot read collection file '<file>': <code>" }`.
   (The catch narrows on the tagged `code`; no raw error escapes.)
2. `parseJson(raw)`. On `ok:false` →
   `{ ok:false, error: "Invalid JSON in '<file>': <error>" }`.
   **No raw `JSON.parse` anywhere.**
3. Shape gate (v2.1 recognition): the parsed value must be a non-null object
   with `info.schema` a string containing the substring
   `collection/v2.1.0` **or** `info._postman_id`/`item` array present with a
   `info.schema` matching `/v2\.1/`. Concretely: require
   `typeof parsed === "object" && parsed !== null`, `parsed.info` an object,
   `typeof parsed.info.schema === "string"`, and
   `parsed.info.schema.includes("v2.1.0")`. On failure →
   `{ ok:false, error: "'<file>' is not a recognizable Postman v2.1 collection" }`.
4. Hydrate: `new Collection(parsed as ...)` from `postman-collection`.
   Construction is wrapped in `try`; any SDK throw →
   `{ ok:false, error: "Failed to hydrate Postman collection '<file>': <message>" }`.
   (The SDK's internal `JSON.parse` is not invoked on raw text because we
   pass the already-parsed object — semgrep rule unaffected.)
5. Success → `{ ok:true, collection: { sdk, fileBasename: basename(file) } }`.

### `PostmanFlattener`

```typescript
export class PostmanFlattener {
  /**
   * Walks the collection item tree depth-first in document order, producing
   * one FlattenedRequest per request item. Pure; no I/O.
   * @param loaded - The hydrated collection.
   * @returns Ordered FlattenedRequest list (document order).
   */
  flatten(loaded: LoadedCollection): FlattenedRequest[];
}
```

Flatten algorithm:

- Depth-first pre-order traversal of `sdk.item` using the SDK's
  `ItemGroup`/`Item` API. `Item` (has `.request`) → emit a
  `FlattenedRequest`. `ItemGroup` (folder) → push its name onto the
  `folderPath` stack, recurse, pop.
- `folderPath` is the array of ancestor folder names from root to immediate
  parent; a root-level request gets `[]`.
- Per item, extract: `postmanId = item.id ?? ""`, `name = item.name ?? ""`,
  `method = request.method ?? ""`, `rawUrl = request.url.toString()`,
  headers (each `{ key, value, disabled: !!header.disabled }`), body
  (`request.body` → `{ mode, raw }`; `raw` only meaningful for mode `raw`),
  query (`request.url.query` → `{ key, value, disabled }`),
  `preRequestScript` (join all `prerequest` event `script.exec` lines with
  `\n`; `""` when absent), `auth` (`request.auth?.type`), `responses`
  (`item.responses` → `{ code: r.code ?? 0, body: r.body ?? "" }`),
  `disabled` (`item.request?.disabled` OR Postman `disabled` flag on the
  item — true when either is set).
- Variables: merge collection-level (`sdk.variables`), then each ancestor
  folder's `variables`, then the item's own — innermost wins. Stored as
  `name → raw string`. Attached to every emitted request so subtask 3 can
  resolve scoped `{{var}}`.

### Edge cases (subtask 2)

| Case | Behavior |
|---|---|
| File does not exist | `{ ok:false, error: "Cannot read collection file ... ENOENT" }`. |
| Malformed JSON | `{ ok:false, error: "Invalid JSON in '<file>': <parseJson error>" }`. |
| Valid JSON, not a v2.1 collection | `{ ok:false, error: "... not a recognizable Postman v2.1 collection" }`. |
| Empty collection (no items) | `flatten` → `[]`; loader still `ok:true`. |
| 3+ levels nested folders | `folderPath` has exactly that many segments, root→parent order. |
| Request at root | `folderPath === []`. |
| Disabled request | Present in output with `disabled:true` (NOT filtered here). |
| Item with no request (folder w/ only metadata) | Not emitted (only `Item`s emit). |
| URL is object form | `request.url.toString()` normalizes; tokens preserved. |
| Duplicate variable across scopes | Innermost scope wins in `variables` map. |

---

## Subtask 3 — Variable templating `{{var}}` → `${env.*}`

### File

- `src/importers/postman/variable-templating.ts` (`PostmanVariableTemplater`)

### API

```typescript
/** Result of rewriting one FlattenedRequest's variable references. */
export interface VariableRewriteResult {
  /** A new FlattenedRequest with all rewrites applied (input not mutated). */
  request: FlattenedRequest;
  /** Warnings (sanitizations, unbalanced braces). */
  warnings: string[];
}

export class PostmanVariableTemplater {
  /**
   * Rewrites every Postman {{var}} reference to ${env.<name>} across url,
   * header values, query values, and a raw body string. Pure: returns a
   * deep-copied rewritten request; the input is never mutated.
   * @param request - The flattened request to rewrite.
   * @returns The rewritten request plus warnings.
   */
  rewrite(request: FlattenedRequest): VariableRewriteResult;
}
```

### Transformation rules (binding, exhaustive)

Target grammar (must match `src/env/template-resolver.ts` exactly):
`${env.NAME}` where `NAME = [A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*`.

Token recognition regex (single, non-greedy, no nested braces):
`/\{\{\s*([^{}]*?)\s*\}\}/g`. Matched group is the inner variable name with
surrounding whitespace trimmed.

For each match producing inner name `n`:

1. **Empty name** (`{{}}` or `{{   }}`): leave the literal `{{...}}`
   unchanged; emit warning
   `Empty variable reference left as-is in <field>`.
2. **Legal name** — `n` already matches
   `^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*$`: replace with `${env.<n>}`.
   No warning.
3. **Sanitizable name** — `n` contains characters illegal in the grammar
   (e.g. `-`, space, `$`, `:`): sanitize by replacing every run of illegal
   characters with a single `_`, then collapse leading/trailing `_`, then
   if the result is empty fall back to `var`. If sanitization yields a name
   already used by a *different* original in this request, append `_2`,
   `_3`, … deterministically. Replace with `${env.<sanitized>}`; emit
   warning `Variable '<original>' rewritten to '<sanitized>' (illegal
   characters in ${env.*} grammar)`. The original→rewritten mapping is in
   the warning text.
4. **Dotted names**: dots between `[A-Za-z0-9_]+` segments are legal and
   preserved (`{{auth.token}}` → `${env.auth.token}`). A leading/trailing/
   doubled dot is illegal → treated as case 3 (sanitized: dots in illegal
   position become `_`).

Unbalanced braces: the regex only matches well-formed `{{...}}`. A lone
`{{oops` or `oops}}` simply does not match → left literal. Detection of an
*unbalanced* situation: after global replacement, if the original string
still contains the substring `{{` OR `}}` that was not part of a matched
pair, emit warning `Unbalanced braces left literal in <field>: "<snippet>"`
(snippet truncated to 60 chars). **No exception ever thrown.**

Strings with no `{{` and no `}}`: returned identical (referential copy in
the new request; value unchanged).

Fields rewritten: `rawUrl`, every `headers[].value`, every `query[].value`,
and `body.raw` (only when `body.mode === "raw"`). Header/param `key`s are
NOT rewritten (Postman variables in header *names* are out of scope and
extremely rare; documented in TSDoc). `preRequestScript` is NOT rewritten
(it is consumed verbatim by subtask 6's string matcher).

Purity: build a structuredClone-equivalent deep copy of the request, mutate
the copy's string fields, return it. The `<field>` token in warnings is one
of `url`, `header '<key>'`, `query '<key>'`, `body`.

### Edge cases (subtask 3)

| Case | Behavior |
|---|---|
| `{{baseUrl}}/users` | `${env.baseUrl}/users`. |
| `Bearer {{token}}` | `Bearer ${env.token}`. |
| `{{a}}-{{b}}` | `${env.a}-${env.b}`. |
| `{{my-var}}` | `${env.my_var}` + sanitization warning. |
| `{{ spaced }}` | trimmed → `${env.spaced}`, no warning. |
| `{{}}` | left literal `{{}}` + warning. |
| `{{oops` | left literal + unbalanced-braces warning. |
| `no vars here` | unchanged, no warning. |
| Two distinct originals sanitize to same name | second gets `_2` suffix, both warned. |
| body mode `formdata`/`urlencoded` | `body.raw` is `""`; rewrite is a no-op there (documented; full form-body support out of scope per converter rules below). |

---

## Subtask 4 — Request converter (+ shared schema-infer) (+ id naming)

### Files

- `src/importers/postman/request-converter.ts` (`PostmanRequestConverter`)
- `src/importers/postman/schema-infer.ts` (`JsonSchemaInferrer`) — SHARED
- `src/importers/postman/path-naming.ts` (`PathNamer`) — SHARED (id rules)

### `JsonSchemaInferrer` — the schema-inference algorithm (binding)

```typescript
export class JsonSchemaInferrer {
  /**
   * Infers a JSON Schema from a concrete JSON example value.
   * Deterministic and total (always returns a JsonSchema; never throws).
   * @param example - Any JSON value (object/array/primitive/null).
   * @returns A JSON Schema describing the example's structure.
   */
  infer(example: unknown): JsonSchema;
}
```

Algorithm (recursive, deterministic):

1. `null` → `{ "type": "null" }`.
2. `boolean` → `{ "type": "boolean" }`.
3. `number` → integer test: `Number.isInteger(v)` → `{ "type": "integer" }`,
   else `{ "type": "number" }`.
4. `string` → `{ "type": "string" }`.
5. **array**:
   - empty `[]` → `{ "type": "array", "items": {} }` (permissive, matches
     anything; `{}` is a valid JSON Schema).
   - non-empty → infer the schema of each element; if all element schemas
     are deep-equal, `items` = that schema; if they differ, `items` =
     `{ "oneOf": [<distinct element schemas in first-seen order>] }`
     (duplicates removed by deep-equality).
6. **object** (plain object, not array, not null):
   - `properties`: for each own key in **insertion order**, recurse on the
     value. Keys are emitted in `Object.keys(example)` order; the inference
     is otherwise order-independent.
   - `required`: every key present in the example, in the same insertion
     order. (Spec subtask 4: "required = keys present in the example".)
   - result: `{ "type": "object", "properties": {...}, "required": [...] }`.
     When the object has zero keys: `{ "type": "object", "properties": {},
     "required": [] }`.
7. `undefined` (only reachable for an absent value, defensive) → `{}`
   (matches anything). Comment names the invariant: callers only pass
   parsed JSON which never yields `undefined` at the root; this guard is
   for nested holes and IS reachable via sparse arrays, so it is tested,
   not ignored.

Determinism guarantee: identical input → byte-identical schema (object key
order = example key order; `oneOf` order = first-seen order). This makes
re-import diff-clean (subtask 8 depends on it).

DRY: this is the ONLY inference implementation. Subtask 4 (request body)
and subtask 5 (response body) both call `JsonSchemaInferrer.infer`. No
second copy may be written; code-quality-enforcer will reject duplication.

### `PathNamer` — id / slug / filesystem-safe naming (binding)

```typescript
export class PathNamer {
  /**
   * Slugifies arbitrary text to the endpoint-id charset ^[a-z0-9._-]+$.
   * Lowercase; non-matching runs → "_"; trim leading/trailing separators;
   * empty result → "endpoint".
   * @param text - Source text (e.g. a request name).
   * @returns A slug guaranteed to match ^[a-z0-9._-]+$.
   */
  toIdSlug(text: string): string;

  /**
   * Slugifies text for a single filesystem path segment (folder or file
   * stem): lowercase, non [a-z0-9._-] → "_", trim, empty → "unnamed".
   * @param text - Source text.
   * @returns A filesystem-safe segment.
   */
  toPathSegment(text: string): string;

  /**
   * Returns a unique value for `candidate` given an already-used set,
   * appending "_2", "_3", … until unique, and records the used value.
   * Deterministic for a fixed call order.
   * @param candidate - The proposed slug.
   * @param used - Mutable set of already-allocated slugs.
   * @returns A unique slug; `used` is updated.
   */
  dedupe(candidate: string, used: Set<string>): string;
}
```

Slug rule detail: `text.normalize("NFKD")` → strip diacritics →
`toLowerCase()` → replace `[^a-z0-9._-]+` with `_` → collapse repeated `_`
→ trim leading/trailing `_-.` → fallback constant if empty. Deterministic;
no randomness, no timestamps. Reused by both the converter (endpoint `id`)
and the writer (dir/file names), satisfying DRY.

### `PostmanRequestConverter`

```typescript
export interface RequestConversionResult {
  /** Partial endpoint core (id, name, method, url, request) or undefined. */
  core?: {
    id: string;
    name: string;
    method: HttpMethod;
    url: string;
    request: CanonicalRequest;
  };
  /** Warnings accumulated during conversion. */
  warnings: string[];
}

export interface PostmanRequestConverterOptions {
  /** Shared inferrer. Default: new JsonSchemaInferrer(). */
  inferrer?: JsonSchemaInferrer;
  /** Shared namer. Default: new PathNamer(). */
  namer?: PathNamer;
}

export class PostmanRequestConverter {
  constructor(options?: PostmanRequestConverterOptions);
  /**
   * Converts one (already variable-rewritten) FlattenedRequest into the
   * core CanonicalEndpoint fields. Never throws — failures become warnings.
   * @param request - The rewritten flattened request.
   * @param usedIds - Mutable set for deterministic id de-duplication
   *                   across the whole collection.
   * @returns The core fields (or none) plus warnings.
   */
  convert(request: FlattenedRequest, usedIds: Set<string>): RequestConversionResult;
}
```

Conversion rules:

- **id**: `namer.dedupe(namer.toIdSlug(request.name || request.postmanId
  || "endpoint"), usedIds)`. Guaranteed `^[a-z0-9._-]+$`; collisions across
  requests deduped deterministically by call order (orchestrator iterates in
  document order).
- **name**: `request.name` verbatim; if empty, name = the generated id and
  a warning `Request had no name; using id '<id>'`.
- **method**: uppercase `request.method`; if it is one of the seven
  `HttpMethod` members → use it; else (empty/unsupported, e.g. `TRACE`,
  `LINK`, `""`) → `core` undefined + warning
  `Unsupported or missing HTTP method '<m>'; request skipped`.
- **url**: `request.rawUrl` verbatim. `${env.*}` tokens already present
  (subtask 3) are preserved unchanged. If `rawUrl` is empty → warning
  `Request URL is empty; using '/'` and url = `/` (keeps schema-valid:
  `url` minLength 1).
- **headers**: enabled headers only (`!h.disabled`) → `Record<key,value>`;
  last write wins on duplicate keys; disabled lines skipped. Empty result →
  `headers` omitted from `request`.
- **body** (mode `raw` only):
  - `parseJson(body.raw)` → `ok:true` and value is object/array/primitive:
    `body_example = value`; `body_schema = inferrer.infer(value)`.
  - `ok:false` (non-JSON / unparseable) OR mode ≠ `raw` with non-empty
    content: `body_example = body.raw` (raw string), no `body_schema`,
    warning `Request body is not valid JSON; stored as raw example`.
  - no body / empty raw: neither `body_example` nor `body_schema` set.
- **query_params**: enabled params only → `Record<key, JsonSchema>` where
  each value is `{ "type": "string" }` (Postman query values are strings;
  the example value is not encoded into the schema, matching the
  `query_params` JSON-Schema-properties contract). Disabled params skipped.
  Empty result → `query_params` omitted.
- Returns `{ core?, warnings }`; never throws.

### Edge cases (subtask 4)

| Case | Behavior |
|---|---|
| Name `Create User` | id `create_user`, name `Create User`. |
| Two requests both `Create User` | ids `create_user`, `create_user_2`. |
| Method `PATCH` | mapped to `"PATCH"`. |
| Method `TRACE`/`""` | no core + warning. |
| URL with `${env.baseUrl}/x` | preserved verbatim. |
| Empty URL | url `/` + warning. |
| Disabled header | skipped. |
| Raw JSON body `{"a":1}` | example `{a:1}`, schema object/integer/required `["a"]`. |
| Raw body `not json` | example `"not json"` + warning, no schema. |
| Empty `[]` body | example `[]`, schema `{type:"array",items:{}}`. |
| Disabled query param | skipped. |
| Non-ASCII name `Café` | slug `cafe` (NFKD strip). |

---

## Subtask 5 — Response seeding (reuses `JsonSchemaInferrer` — DRY)

### File

- `src/importers/postman/response-seeder.ts` (`PostmanResponseSeeder`)

### API

```typescript
export interface ResponseSeedResult {
  /** Always populated (a schema-valid default is produced when needed). */
  response: CanonicalResponse;
  /** Warnings (default used, non-2xx chosen, non-JSON body, etc.). */
  warnings: string[];
}

export interface PostmanResponseSeederOptions {
  /** Shared inferrer (same class as the converter). Default new instance. */
  inferrer?: JsonSchemaInferrer;
}

export class PostmanResponseSeeder {
  constructor(options?: PostmanResponseSeederOptions);
  /**
   * Seeds response.expected_status and response.schema from a request's
   * saved/example responses. Never throws.
   * @param request - The flattened request (rewritten or raw; only
   *                   `responses` is read).
   * @returns A complete CanonicalResponse plus warnings.
   */
  seed(request: FlattenedRequest): ResponseSeedResult;
}
```

Seeding algorithm:

1. No `responses` → default: `{ expected_status: 200, schema: {} }`
   (empty-object schema; `{}` is a valid JSON Schema and passes
   ENDPOINT_META_SCHEMA's `response.schema` `type:"object"` constraint —
   verified: `{}` is an object) + warning
   `Request '<name>' has no example response; defaulted to 200 with empty
   schema (manual review advised)`.

   Note: ENDPOINT_META_SCHEMA requires `response.schema` to be
   `type:"object"`. `{}` satisfies that. `JsonSchemaInferrer` for a null
   body would yield `{type:"null"}` (also an object literal at the JSON
   level — still passes `type:"object"` AJV check since it IS a JS object).
2. Choose example: first response whose `code` is in `[200,299]`; if none,
   the first response in document order + warning
   `Request '<name>' has no 2xx example; used status <code>`.
3. `expected_status = chosen.code` when `100 ≤ code ≤ 599`; otherwise 200 +
   warning `Example response status <code> out of range; defaulted to 200`.
4. Body → schema:
   - `parseJson(chosen.body)` `ok:true` → `schema = inferrer.infer(value)`.
   - `ok:false` (non-JSON) → `schema = { "type": "object" }` (permissive)
     + warning `Example response body is not valid JSON; used permissive
     object schema`.
   - empty body → `schema = {}` + warning `Example response had no body;
     used empty schema`.
5. Returns `{ response, warnings }`; never throws.

DRY: uses the SAME `JsonSchemaInferrer` injected/defaulted. No second
inference path.

### Edge cases (subtask 5)

| Case | Behavior |
|---|---|
| One example 201 JSON | status 201, schema inferred. |
| Examples [500, 200] | picks 200, no choice warning. |
| Examples [301, 404] (no 2xx) | picks first (301) + warning. |
| Example body non-JSON | schema `{type:"object"}` + warning. |
| No examples | status 200, schema `{}` + manual-review warning. |
| status 0 / 700 | defaulted to 200 + warning. |

---

## Subtask 6 — Pre-request-script + request-auth extraction (SECURITY)

### File

- `src/importers/postman/auth-extractor.ts` (`PostmanAuthExtractor`)

This is the security-sensitive boundary. **Scripts are NEVER executed,
eval'd, `Function`-constructed, `vm`-run, or `require`d.** Only
string/regex matching against a CLOSED ALLOWLIST. The module TSDoc
exhaustively documents the allowlist (below) so a reviewer can audit it.

### API

```typescript
export interface AuthExtractionResult {
  /** Detected canonical auth strategy name, or undefined when none/unsure. */
  authStrategy?: string;
  /** Warnings (manual-review prompts naming the request). */
  warnings: string[];
}

export class PostmanAuthExtractor {
  /**
   * Derives auth_strategy ONLY for the closed allowlist below. Anything
   * outside it leaves authStrategy unset and emits a manual-review warning
   * naming the request. The script is string-matched only — never executed.
   * @param request - The flattened request.
   * @returns { authStrategy?, warnings }; never throws.
   */
  extract(request: FlattenedRequest): AuthExtractionResult;
}
```

### Canonical strategy names (documented mapping)

| Postman / script form | `auth_strategy` |
|---|---|
| request-level auth `type: "bearer"` | `user_token` |
| request-level auth `type: "basic"` | `basic_auth` |
| request-level auth `type: "apikey"` | `api_key` |
| recognized bearer-token script form | `user_token` |

### CLOSED ALLOWLIST (exhaustive — copied verbatim into module TSDoc)

`extract` resolves in this precedence order; the first match wins:

**A. Request-level auth block** (`request.auth.type`), exact case-insensitive
match against the closed set `{ "bearer", "basic", "apikey" }`:

- `bearer` → `user_token`
- `basic`  → `basic_auth`
- `apikey` → `api_key`
- any other `type` (e.g. `oauth2`, `awsv4`, `hawk`, `ntlm`, `digest`) →
  NOT mapped; fall through to the script check; if the script is also not
  allowlisted, emit warning
  `Request '<name>' uses unsupported auth type '<type>'; set auth_strategy
  manually`.

**B. Pre-request script** — only consulted when A produced no strategy.
First, **reject** (→ manual-review, no strategy) if the script (after
stripping `//` and `/* */` comments) contains ANY of these
disqualifying substrings/patterns (the closed denylist that gates the
allowlist; matched case-insensitively as word-ish tokens):

- control flow: `if`, `for`, `while`, `switch`, `case`, `?` ternary,
  `&&`, `||`, `=>` (arrow), `function`
- network: `pm.sendRequest`, `pm.execution`, `fetch`, `require(`,
  `XMLHttpRequest`
- crypto / signing: `crypto`, `CryptoJS`, `hmac`, `sha256`, `sha1`,
  `md5`, `sign`, `Buffer`
- process / fs / eval: `process`, `eval`, `Function`, `child_process`,
  `fs.`, `import(`, `globalThis`, `__proto__`
- more than one effective statement (see "effective statement" below)

If any disqualifier is present → `authStrategy` unset + warning
`Request '<name>' has a pre-request script outside the recognized
allowlist; review auth manually`.

Otherwise the script's **single effective statement** (defined as: the
script with comments removed and blank lines removed, then split on `;`
and `\n`, with empty fragments discarded — there must be exactly **one**
non-empty fragment) MUST match one of these EXACT recognized forms
(whitespace-flexible, quote-flexible `'`/`"`/`` ` ``):

1. **Environment token set** —
   `pm.environment.set( <q>token<q> , <anything-not-containing-disqualifiers> )`
   regex:
   `^pm\.environment\.set\(\s*['"\`]token['"\`]\s*,\s*[^;()]+\)$`
   → `user_token`.
2. **Collection-variable token set** — same as (1) with
   `pm.collectionVariables.set` and key `token`/`accessToken`/`access_token`
   → `user_token`.
3. **Authorization header add (bearer)** —
   `pm.request.headers.add({ key: 'Authorization', value: 'Bearer ' + <ref> })`
   regex matching key `Authorization` (case-insensitive) and a value
   string that begins with `Bearer ` (case-insensitive), where `<ref>` is
   a simple identifier / `pm.environment.get('...')` / `'<literal>'` with
   NO disqualifier tokens →
   `user_token`.
4. **Authorization header upsert variants** —
   `pm.request.headers.upsert(...)` with the same Authorization/Bearer
   shape as (3) → `user_token`.

No other script shape is recognized. A script that passes the denylist but
matches none of forms (1)–(4) → `authStrategy` unset + warning
`Request '<name>' pre-request script not in the recognized auth allowlist;
review manually`.

**C. Empty script + no auth block** (`preRequestScript` is `""` or
whitespace-only AND `request.auth` undefined): `authStrategy` unset, **no
warning** (this is the legitimate "no auth" case; subtask 7 omits the
field entirely).

### Provable non-execution (test contract)

A unit test feeds a pre-request script containing the literal text
`process.exit(1)` and `pm.sendRequest('http://evil')`. Assertions:
(a) `extract` returns `{ warnings: [<manual-review naming request>] }`
with `authStrategy` undefined; (b) no process exit, no network — proven by
the test simply completing and by spying that `process.exit` is never
called and no `http`/`fetch` global is invoked. The implementation imports
no `vm`/`child_process`/`eval`; this is enforced by the security-auditor
and asserted structurally (no dynamic-eval imports in the file).

### Edge cases (subtask 6)

| Case | Result |
|---|---|
| `auth.type === "bearer"` | `user_token`, no warning. |
| `auth.type === "basic"` | `basic_auth`, no warning. |
| `auth.type === "apikey"` | `api_key`, no warning. |
| `auth.type === "oauth2"`, no script | unset + unsupported-type warning. |
| Script `pm.environment.set('token', pm.response.json().jwt)` — note `pm.response` is not a disqualifier but contains `(` → fragment regex requires `[^;()]+`; `pm.response.json()` has parens → fails form (1) → manual-review warning. (Documented limitation: only simple RHS recognized.) |
| Script `pm.environment.set('token', env.jwt)` | `user_token`. |
| Script with `if (x) {...}` | manual-review warning, unset. |
| Script with `pm.sendRequest(...)` | manual-review warning, unset. |
| Script with `CryptoJS.HmacSHA256(...)` | manual-review warning, unset. |
| Script `// just a comment` | treated as empty → no strategy, no warning. |
| Empty script, no auth | unset, no warning. |
| Two statements both benign | >1 effective statement → manual-review warning. |
| Script text contains `process.exit(1)` | manual-review warning; provably no execution. |

---

## Subtask 7 — Endpoint assembler + validation

### File

- `src/importers/postman/endpoint-assembler.ts` (`PostmanEndpointAssembler`)

### API

```typescript
export interface PostmanEndpointAssemblerOptions {
  /** Default: new PostmanRequestConverter(). */
  converter?: PostmanRequestConverter;
  /** Default: new PostmanResponseSeeder(). */
  seeder?: PostmanResponseSeeder;
  /** Default: new PostmanAuthExtractor(). */
  authExtractor?: PostmanAuthExtractor;
  /** Default: new SchemaValidator() (from src/core). */
  validator?: SchemaValidator;
}

export class PostmanEndpointAssembler {
  constructor(options?: PostmanEndpointAssemblerOptions);
  /**
   * Assembles one complete CanonicalEndpoint from a rewritten flattened
   * request and validates it against ENDPOINT_META_SCHEMA. A request that
   * fails conversion or validation is dropped (endpoint undefined) with an
   * aggregated warning naming it. Pure; never throws.
   * @param request - The variable-rewritten flattened request.
   * @param fileBasename - Basename of the source collection file.
   * @param usedIds - Mutable id-dedupe set shared across the collection.
   * @returns ConversionResult ({ endpoint?, warnings }).
   */
  assemble(
    request: FlattenedRequest,
    fileBasename: string,
    usedIds: Set<string>,
  ): ConversionResult;
}
```

Assembly algorithm:

1. `converter.convert(request, usedIds)`. If no `core` → return
   `{ warnings: [...converter.warnings contextualized with request name] }`
   (request dropped before assembly).
2. `seeder.seed(request)` → always a `response`.
3. `authExtractor.extract(request)` → optional `authStrategy`.
4. Build the endpoint object:
   ```
   { id, name, method, url, request,
     ...(authStrategy !== undefined ? { auth_strategy: authStrategy } : {}),
     response,
     source: {
       type: "postman",
       collection: fileBasename,
       ...(request.postmanId ? { endpoint_id: request.postmanId } : {}),
     } }
   ```
   `auth_strategy` is **OMITTED** (key absent) when unset — never `""` —
   so `additionalProperties:false` + the `string` type both stay satisfied.
5. `validator.validateEndpoint(endpoint)`:
   - `valid:true` → `{ endpoint, warnings: <merged stage warnings, each
     prefixed `[<name>]`> }`.
   - `valid:false` → endpoint dropped; one warning
     `[<name>] dropped: schema validation failed: <errors joined by "; ">`
     plus the merged stage warnings. (`errors` already formatted by the
     validator via `formatAjvErrors`.) **Never throws.**
6. Warning merge order is deterministic: converter → seeder → auth →
   validation, each via `Warnings.addAllWithContext(request.name, …)`.

### Edge cases (subtask 7)

| Case | Behavior |
|---|---|
| Fully convertible request | `endpoint` set, `valid:true`. |
| `source` content | exactly `{ type:"postman", collection:<basename> }` plus `endpoint_id` when Postman id present. |
| Assembled object fails meta-schema | dropped + one warning with request name + aggregated AJV strings; no throw. |
| Converter produced no core | dropped pre-assembly; converter warnings surfaced. |
| No auth detected | `auth_strategy` key absent; endpoint still valid. |
| Stage warnings present | all merged under `[<request name>]` context, deterministic order. |

---

## Subtask 8 — Output writer (+ shared `PathNamer`)

### File

- `src/importers/postman/output-writer.ts` (`PostmanOutputWriter`)
- (`path-naming.ts` already defined in subtask 4 — reused, NOT duplicated)

### API

```typescript
/** One endpoint plus its Postman folder path, ready to write. */
export interface WritableEndpoint {
  /** The validated endpoint. */
  endpoint: CanonicalEndpoint;
  /** Folder-path segments from the source FlattenedRequest. */
  folderPath: string[];
}

export interface OutputWriteResult {
  /** Count of files successfully written. */
  written: number;
  /** Rename/collision warnings. */
  warnings: string[];
}

export interface PostmanOutputWriterOptions {
  /** Write-capable FS seam. Default: new NodeImporterFileSystem(). */
  fs?: ImporterFileSystem;
  /** Shared namer. Default: new PathNamer(). */
  namer?: PathNamer;
}

export class PostmanOutputWriter {
  constructor(options?: PostmanOutputWriterOptions);
  /**
   * Writes each endpoint as <outputDir>/<folder slugs.../><name>.endpoint.json,
   * creating mirror directories. Collisions disambiguated deterministically.
   * Never throws on a name collision.
   * @param items - Endpoints with their folder paths, in document order.
   * @param outputDir - Destination root directory (absolute or relative).
   * @returns Count written plus rename warnings.
   */
  write(items: readonly WritableEndpoint[], outputDir: string): OutputWriteResult;
}
```

Write algorithm:

1. For each item in order:
   - `segments = item.folderPath.map(s => namer.toPathSegment(s))`.
   - `dir = join(outputDir, ...segments)`.
   - `stem = namer.toPathSegment(item.endpoint.name)`.
   - Build a per-run `Set<string>` of full target paths; the candidate full
     path is `join(dir, stem + ".endpoint.json")`. If already used,
     `namer.dedupe` the **stem** (`stem_2`, `stem_3`, …) and warn
     `Output name collision: '<orig>.endpoint.json' written as
     '<final>.endpoint.json'`.
   - `fs.mkdirp(dir)`; `fs.writeFile(finalPath, serialize(endpoint))`.
   - increment `written`.
2. Serialization: `serialize(endpoint)` = stable pretty JSON with
   **deterministic key order** so re-import is diff-clean. Order =
   the canonical field order from `CanonicalEndpoint`:
   `id, name, method, url, auth_strategy, tags, markers, prod_safe,
   request, response, db_verify, assertions, cleanup, retry, source`;
   nested objects (`request`, `response`, `source`) emitted in their
   declared field order; remaining/unknown keys sorted lexicographically
   after known keys (defensive). Two-space indent, trailing newline.
   Implemented with a custom ordered replacer — NOT `JSON.parse`
   round-tripping (no raw parse). `JSON.stringify` for *serialization* is
   allowed (the semgrep rule targets `JSON.parse` only).
3. All disk via `fs` seam; tests inject an in-memory fake recording
   `mkdirp`/`writeFile` calls and asserting paths + contents. Never throws
   on collision (resolved by rename + warning). An `ImporterFsError` from
   the real FS is NOT swallowed here — it indicates a programmer/IO error,
   not bad *input*; it propagates to the orchestrator which converts it to
   a warning (see subtask 9).

### Edge cases (subtask 8)

| Case | Behavior |
|---|---|
| folderPath `["Users","Admin"]` | `<out>/users/admin/<stem>.endpoint.json`. |
| folderPath `[]` | `<out>/<stem>.endpoint.json`. |
| Two requests same folder + name | second `<stem>_2.endpoint.json` + rename warning. |
| Folder name `My Folder!` | segment `my_folder_`. → collapsed `my_folder`. |
| Empty endpoint name | stem `unnamed`. |
| Re-running import | byte-identical output (stable key order) → diff-clean. |

---

## Subtask 9 — Orchestrator `PostmanImporter`

### File

- `src/importers/postman/postman-importer.ts` (`PostmanImporter`)
- adds export to `src/importers/index.ts`

### API

```typescript
export interface PostmanImporterOptions {
  fs?: ImporterFileSystem;                 // default NodeImporterFileSystem
  loader?: PostmanCollectionLoader;        // default new (shares fs)
  flattener?: PostmanFlattener;            // default new
  templater?: PostmanVariableTemplater;    // default new
  assembler?: PostmanEndpointAssembler;    // default new
  writer?: PostmanOutputWriter;            // default new (shares fs)
}

export class PostmanImporter {
  constructor(options?: PostmanImporterOptions);
  /**
   * Drives the full Postman import pipeline. Satisfies the `postman`
   * member of the FROZEN Importer interface. Resolves an ImportOutcome;
   * only programmer errors throw — all bad input becomes a warning.
   * @param input - File path and output directory.
   * @param input.file - Path to the Postman collection file.
   * @param input.outputDir - Destination directory.
   * @returns Promise<ImportOutcome> ({ written, warnings }).
   */
  postman(input: { file: string; outputDir: string }): Promise<ImportOutcome>;
}
```

Note: `PostmanImporter` does NOT `implements Importer` (that interface also
requires `openapi`). It structurally provides the `postman` method; the
`CompositePostmanImporter` (subtask 11) is the class that `implements
Importer`. This keeps `src/cli/seams/importer.ts` untouched.

Pipeline (async wrapper around sync stages so the seam stays `Promise`):

1. `loader.load(file)`. `ok:false` → resolve
   `{ written: 0, warnings: [result.error] }`. **No throw for bad input.**
2. `flattener.flatten(loaded)` → ordered `FlattenedRequest[]`.
3. `usedIds = new Set<string>()`; `warnings = new Warnings()`;
   `writable: WritableEndpoint[] = []`.
4. For each request in document order:
   - if `request.disabled` → `warnings.add("Skipped disabled request
     '<name>'")`; continue (not written, not counted).
   - `templater.rewrite(request)` → `{ request: rewritten, warnings }`;
     `warnings.addAll(...)`.
   - `assembler.assemble(rewritten, loaded.fileBasename, usedIds)` →
     `{ endpoint?, warnings }`; `warnings.addAll(...)`.
   - if `endpoint` → push `{ endpoint, folderPath: request.folderPath }`.
   - RECONCILED (post-build): the per-request templater+assembler step is
     wrapped in a `try/catch`. Any thrown error (e.g. a `RangeError` from
     an excessively-nested body overflowing the schema-inference recursion)
     is converted to `warnings.add("Request '<name>' skipped:
     unprocessable (e.g. excessively nested body)")` and the loop
     `continue`s — preserving the "never throws for bad user input;
     postman() always resolves an ImportOutcome" contract. The catch is
     strictly per-request and does not swallow loader/writer/IO errors.
5. `writer.write(writable, outputDir)` wrapped in `try`; on a thrown
   `ImporterFsError` (real disk failure) → `warnings.add("Failed to write
   output to '<dir>': <code>")`, `written` stays at whatever the writer
   reported before the throw is unknown, so on throw `written = 0`
   (conservative). On success `written = result.written`,
   `warnings.addAll(result.warnings)`.
6. Resolve `{ written, warnings: warnings.list() }`. Warning order is
   deterministic: load → per-request (document order: skip, then templating,
   then assembly) → write.

### Edge cases (subtask 9)

| Case | Behavior |
|---|---|
| Non-existent file | resolve `{ written:0, warnings:[<descriptive>] }`, no throw. |
| Non-Postman JSON | same, single descriptive warning. |
| Disabled request | one skip warning, not written, not counted. |
| Request fails conversion/validation | skipped, warning surfaced, import still resolves with partial count. |
| All requests disabled | `written:0`, N skip warnings. |
| No options passed | real defaults wired; tested by constructing `new PostmanImporter()` and running against a fake-FS-backed in-memory collection (default-seam wiring covered, not ignored). |
| Writer throws ImporterFsError | converted to a warning; never rethrown. |

---

## Subtask 10 — Fixture + integration test

### Files

- `tests/fixtures/postman/sample.postman_collection.json`
- `tests/integration/importers/postman.test.ts`

### Fixture requirements (binding contents)

Valid Postman v2.1 JSON (`info.schema` =
`https://schema.getpostman.com/json/collection/v2.1.0/collection.json`)
containing AT LEAST:

- `info` with name + v2.1 schema; collection-level `variable` array
  including `{ key: "baseUrl", value: "https://api.example.com" }`.
- ≥3 levels nested folders, e.g.
  `Users → Admin → Internal` each an `ItemGroup`.
- One root-level request (no folder).
- ≥1 disabled request (`disabled: true` on the item, or its request).
- A request using `{{baseUrl}}` in URL, `{{token}}` in an `Authorization`
  header, and `{{userId}}` in a raw JSON body.
- A request with parseable request-level `auth: { type: "bearer" }` (and a
  second with `auth: { type: "apikey" }`).
- A request with an UNPARSEABLE pre-request script (contains
  `if (...)` control flow AND `pm.sendRequest(...)`).
- A request with ≥1 example `response` (status 201, JSON body) plus a
  second request with two examples (500 then 200) to exercise 2xx pick.
- A request whose name collides with another in the same folder (to
  exercise dedupe + rename warning).

### Integration test assertions

- Runs `new PostmanImporter({ fs: <in-memory fake> })` (and a second case
  with the real `NodeImporterFileSystem` against an OS temp dir) against
  the fixture.
- Asserts the produced directory tree mirrors folder nesting
  (`users/admin/internal/...`).
- Reads every written `.endpoint.json` back (the fake FS records contents;
  parsed with `parseJson`, not raw `JSON.parse`) and asserts each passes
  `new SchemaValidator().validateEndpoint(...)` with `valid:true`.
- Asserts the disabled request produced exactly one
  `Skipped disabled request '<name>'` warning and was NOT written.
- Asserts the unparseable-script request produced a manual-review warning
  and (if otherwise convertible) was written WITHOUT `auth_strategy`.
- Asserts the `{{var}}` request's written JSON contains `${env.baseUrl}`,
  `${env.token}`, `${env.userId}` and no remaining `{{` or `}}`.
- Asserts every written endpoint has `source.type === "postman"` and
  `source.collection === "sample.postman_collection.json"`.
- Asserts `written` equals a **computed** expected count: programmatically
  count enabled, convertible requests in the parsed fixture (filter
  `!disabled` and supported method), NOT a hardcoded number.

---

## Subtask 11 — CLI wiring `CompositePostmanImporter`

### Files

- `src/importers/composite-importer.ts` (`CompositePostmanImporter`)
- `src/importers/index.ts` (export it)
- `src/cli/entry.ts` — `makeDefaultDeps` body only

### API

```typescript
export interface CompositePostmanImporterOptions {
  /** Real Postman engine. Default: new PostmanImporter(). */
  postmanImporter?: PostmanImporter;
}

/**
 * Importer composite: postman() delegates to the real PostmanImporter;
 * openapi() rejects with NotImplementedError naming Task #5 until that
 * task ships. Implements the FROZEN Importer interface unchanged.
 */
export class CompositePostmanImporter implements Importer {
  constructor(options?: CompositePostmanImporterOptions);
  /** Delegates to the real Postman engine. */
  postman(input: { file: string; outputDir: string }): Promise<ImportOutcome>;
  /** Always rejects: NotImplementedError("`apiwright import openapi`", 5). */
  openapi(input: { source: string; outputDir: string }): Promise<ImportOutcome>;
}
```

- `implements Importer` (imported as a TYPE from
  `../cli/seams/importer.js`). The interface file is NOT edited — we only
  import from it.
- `postman` → `this.#postmanImporter.postman(input)`.
- `openapi` → `Promise.reject(new NotImplementedError("`apiwright import
  openapi`", 5))` (`NotImplementedError` imported from
  `../cli/errors.js`; the literal `5` matches the existing
  `OPENAPI_TASK` constant value — we replicate the existing
  `NotImplementedImporter.openapi` behavior exactly so CLI exit-code 5 is
  preserved).
- Default-seam fallback `postmanImporter ?? new PostmanImporter()` is
  unit-tested by constructing with no options and asserting delegation
  (not istanbul-ignored).

### `src/cli/entry.ts` change (the ONLY edit outside `src/importers/`)

In `makeDefaultDeps`, change the `importer` field:

```diff
- import { NotImplementedImporter } from "./seams/importer.js";
+ import { NotImplementedImporter } from "./seams/importer.js";
+ import { CompositePostmanImporter } from "../importers/composite-importer.js";
...
-   importer: new NotImplementedImporter(),
+   importer: new CompositePostmanImporter(),
```

`NotImplementedImporter` import is retained ONLY if still referenced by the
`EntryDeps.importer` type annotation
(`InstanceType<typeof NotImplementedImporter>`). To keep the change
minimal and the `EntryDeps` interface stable, widen the field's type to the
`Importer` interface:

```diff
-  /** Importer seam (default: NotImplementedImporter). */
-  importer: InstanceType<typeof NotImplementedImporter>;
+  /** Importer seam (default: CompositePostmanImporter). */
+  importer: Importer;
```

This is a TYPE widening within `entry.ts` only (entry.ts is
coverage-excluded; it is the documented integration point and the task
explicitly permits entry.ts wiring changes). `Importer` is imported as a
type from `./seams/importer.js`. `src/cli/seams/importer.ts` and
`src/cli/commands/import.ts` remain byte-for-byte unchanged. `ImportCommand`
already types its `importer` as `Importer`, so it accepts the composite
with no change.

> Halting check: this widening touches `entry.ts` only and does not alter
> any *exported* public interface (`EntryDeps` is consumed only by entry.ts
> and tests, which already pass concrete importers). It does not require
> changing a frozen interface, so no halt is needed. If the test-engineer
> finds an existing entry.ts test asserting the field is exactly
> `InstanceType<typeof NotImplementedImporter>`, that test is updated to the
> wider `Importer` type — flagged here for the test-engineer.

### Edge cases (subtask 11)

| Case | Behavior |
|---|---|
| `import postman <fixture> --output <tmp>` | exit 0; files written via real engine. |
| `import openapi <x> --output <tmp>` | exit 5; message names Task #5. |
| Composite constructed with no options | default `PostmanImporter` wired; delegation tested. |
| `postman()` underlying resolves warnings only | composite passes the `ImportOutcome` through unchanged. |

---

## Public API surface (`src/importers/index.ts`)

Exports (barrel):

- Types (from `types.ts`): `ImporterFileSystem`, `ImporterFsError`,
  `ImporterFsErrorCode`, `FlattenedRequest` and its members,
  `ConversionResult`, `CollectionLoadResult`, `LoadedCollection`.
- `NodeImporterFileSystem`, `Warnings`.
- `PostmanImporter`, `CompositePostmanImporter`.
- (Pipeline-stage classes are NOT re-exported from the top barrel —
  they are internal collaborators; `postman/` files import each other by
  relative path. This keeps the public surface minimal.)

Consumers: only `src/cli/entry.ts` (`makeDefaultDeps`) imports
`CompositePostmanImporter`. Nothing else in `src/cli` changes.

---

## Cross-cutting error-handling strategy

| Layer | Failure | Response |
|---|---|---|
| `parseJson` boundary | malformed JSON | `{ ok:false }` → loader returns typed failure → orchestrator → ONE warning, `written:0`. Never throws. |
| `ImporterFileSystem.readFile` | ENOENT/EACCES/EISDIR | tagged `ImporterFsError`; loader catches → typed failure → warning. |
| `ImporterFileSystem.write/mkdirp` | real disk error | thrown to orchestrator → converted to a warning; never rethrown to the CLI. |
| Shape gate | not v2.1 | typed failure → warning. |
| SDK hydration | SDK throws | caught in loader → typed failure → warning. |
| Converter | bad method / non-JSON body | no `core` or raw-example + warning; never throws. |
| Seeder | no/non-JSON examples | documented default + warning; never throws. |
| Auth extractor | script outside allowlist | `auth_strategy` unset + manual-review warning; never executes script. |
| Assembler | meta-schema invalid | endpoint dropped + aggregated AJV warning; never throws. |
| Writer | name collision | deterministic rename + warning; never throws on collision. |
| Orchestrator | any bad input | resolves `ImportOutcome` with warnings; only genuine programmer errors (e.g. a bug) propagate. |
| Composite `openapi()` | always | `NotImplementedError` (exit code 5) — intentional, preserves CLI contract. |

Invariant: **the importer never throws for bad user input.** The CLI
(`ImportCommand` → seam) only sees a resolved `ImportOutcome` for any
collection content; the sole rejection path is `openapi()` (by design).

---

## Acceptance-criteria traceability (verification)

Every acceptance criterion across all 11 task YAMLs maps to a section
above. Spot-check of the load-bearing ones:

- T1: `ImporterFileSystem` (mkdirp/writeFile/readFile) + tagged error
  codes + `FlattenedRequest`/`ConversionResult`/`Warnings` — Subtask 1.
- T2: ordered flatten, 3-level folder paths, root `[]`, disabled flagged
  not dropped, typed failures via `parseJson`, scoped variables — Subtask 2.
- T3: all six rewrite examples + purity — Subtask 3.
- T4: snake-case id `^[a-z0-9._-]+$` + dedupe, method union, url token
  preservation, header/query disabled-skip, JSON-body schema infer,
  non-JSON raw + warning — Subtask 4.
- T5: 2xx preference, non-JSON permissive schema, no-example default,
  shared inferrer (DRY) — Subtask 5.
- T6: closed allowlist documented in TSDoc, parseable bearer/basic/apikey
  + token-script forms, unparseable → unset + warning, empty → silent,
  never-execute proof — Subtask 6.
- T7: validate via core `SchemaValidator`, drop-not-throw, `source`
  shape, `auth_strategy` omitted — Subtask 7.
- T8: mirror folders, root direct, dedupe + rename warning, stable JSON,
  seam-only disk — Subtask 8.
- T9: `ImportOutcome` counts, disabled skip warning, partial success,
  bad-input → written 0, default wiring tested — Subtask 9.
- T10: fixture branch coverage + e2e assertions with computed count —
  Subtask 10.
- T11: composite implements frozen `Importer`, entry.ts-only change,
  exit 0 / exit 5 entry tests — Subtask 11.

No acceptance criterion requires altering a frozen public interface. No
decomposition adjustment needed.

## Pipeline-invariant compliance

- No file exceeds 300 soft / 500 hard lines (largest budgeted:
  `request-converter.ts` ~230, `auth-extractor.ts` ~260).
- One exported class per file; pluggable seams are TS `interface`s with
  class implementations; composition (orchestrator composes stages), no
  inheritance among stages.
- DRY: single `JsonSchemaInferrer` (subtasks 4 & 5), single `PathNamer`
  (subtasks 4 & 8), single `Warnings`, single write-seam.
- `types.ts` is the only coverage-exempt file and holds no logic; every
  gated file's default-seam fallback is unit-tested, never istanbul-ignored
  (only OS-errno arms in `fs-seam.ts` carry an ignore, matching the
  existing `src/cli/fs-seam.ts` precedent and the README's accepted
  category).
- No raw `JSON.parse`: all parsing via `parseJson`; `JSON.stringify` used
  only for serialization (allowed; semgrep rule targets parse only).
- ESM `.js` import specifiers; TSDoc on every exported symbol.

## Hand-off

Files to be **created**:

- `src/importers/types.ts`
- `src/importers/fs-seam.ts`
- `src/importers/warnings.ts`
- `src/importers/composite-importer.ts`
- `src/importers/index.ts`
- `src/importers/postman/collection-loader.ts`
- `src/importers/postman/flattener.ts`
- `src/importers/postman/variable-templating.ts`
- `src/importers/postman/schema-infer.ts`
- `src/importers/postman/request-converter.ts`
- `src/importers/postman/response-seeder.ts`
- `src/importers/postman/auth-extractor.ts`
- `src/importers/postman/endpoint-assembler.ts`
- `src/importers/postman/path-naming.ts`
- `src/importers/postman/output-writer.ts`
- `src/importers/postman/postman-importer.ts`
- `tests/fixtures/postman/sample.postman_collection.json`
- `tests/integration/importers/postman.test.ts`

File to be **modified** (only one outside `src/importers/`):

- `src/cli/entry.ts` — `makeDefaultDeps` swap to `CompositePostmanImporter`
  + `EntryDeps.importer` type widened to `Importer`.

Files explicitly **unchanged**: `src/cli/seams/importer.ts`,
`src/cli/commands/import.ts`, `src/cli/fs-seam.ts`, all `src/core/*`,
all `src/env/*`.

Pipeline proceeds to **test-engineer**.
