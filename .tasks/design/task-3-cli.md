# Design: Task #3 — APIWright CLI Entry Point (`src/cli/`)

> Scope: all 9 decomposed subtasks (`cli-*.yaml`) designed as one cohesive
> `src/cli/` module. Authoritative spec: `V1_BUILD_SPEC.md` §12 (lines
> 684–730), prod-safety rules §7 (lines 517–521), log levels §10 (lines
> 648–657). Reuses `src/core` (`SchemaValidator`, `ENDPOINT_META_SCHEMA`) and
> `src/env` (`EnvironmentLoader`) verbatim — no new validation logic.

---

## 0. Design Principles & Cross-Cutting Decisions

These decisions are defended once here and referenced by each subtask.

1. **Pure core, side-effects at the edge.** Every module that performs a
   decision (config load, flag merge, prod gate, validate walk) is a pure
   class/function over injected seams. The only true side-effect lines are
   `process.exit` and `commander.parse`, both isolated in `entry.ts` and
   marked `/* istanbul ignore next */` with justification. This is mandatory
   for the **real 95% branch-coverage gate**.

2. **Dependency injection over module mocking.** Every external boundary
   (filesystem reads, `process.env`, stdin, CI detection, clock,
   `process.exit`, output stream, seam implementations) is an injected
   parameter with a production default — mirroring the proven
   `EnvironmentLoader` `{ rootDir, env, reader }` seam pattern in
   `src/env/loader.ts`. Rationale: module mocking (`vi.mock`) is brittle
   across ESM/NodeNext and hides branches; constructor/parameter injection
   makes every branch deterministically reachable in a unit test without
   touching the real OS.

3. **Never throw on user-config error.** Config loading and env validation
   return discriminated `{ valid, ... , errors? }` results (same contract
   as `EnvironmentLoader.load`). Exceptions are reserved for *programmer*
   errors and the deliberate `NotImplementedError` seam signal. The
   top-level handler converts every `CliError` subclass into a documented
   exit code.

4. **No forbidden imports.** No file under `src/cli/**` may import from
   `src/importers`, `src/runner`, or `src/docs-generator` (none exist). The
   seam interfaces (`TestRunner`, `Importer`, `DocsGenerator`) live entirely
   in `src/cli/seams/` and are the *only* contract the future engines
   (Tasks #4/#5/#10/#11) implement. `entry.ts` imports only from `src/cli`,
   `src/core`, `src/env`, `commander`, and Node builtins.

5. **One class per file, ≤500 lines hard / ≤300 soft, ≤100-char lines,
   TSDoc on every export.** Pluggable behavior (seams, prompt, exiter, fs)
   is expressed as TypeScript `interface` declarations implemented by
   classes; shared behavior is composed, never inherited.

6. **AJV-via-`require()` + `errorMessage` convention reused exactly** from
   `src/core/schema-validator.ts` and `src/env/schema.ts`, including the
   two eslint-disable lines and the `formatAjvErrors`-style
   `"<path> <message>"` formatter. The CLI config validator is a sibling of
   those two, not a new pattern.

---

## 1. File Layout (`src/cli/`)

Every file ≤500 lines (all are far smaller); one exported class per class
file; TSDoc on every exported symbol.

```
src/cli/
├── index.ts                       # public re-exports (barrel); no logic
├── entry.ts                       # commander wiring + process.exit boundary (subtask 9)
│
├── config/
│   ├── types.ts                   # ApiwrightConfig, RetryConfig, ReportConfig,
│   │                              #   LogLevel, Marker, EffectiveSettings (subtask 1; type-only)
│   ├── defaults.ts                # DEFAULT_CONFIG constant + deep-clone helper (subtask 2)
│   ├── schema.ts                  # ApiwrightConfigSchemaValidator + APIWRIGHT_CONFIG_SCHEMA
│   │                              #   + formatConfigErrors (subtask 1)
│   ├── loader.ts                  # ConfigLoader class (subtask 2)
│   └── resolve-effective.ts       # resolveEffectiveSettings() + parseMarkers() (subtask 3)
│
├── logging/
│   ├── logger.ts                  # Logger interface + PinoLogger + createLogger (subtask 4)
│
├── errors.ts                      # CliError hierarchy (subtask 5)
├── exit-codes.ts                  # ExitCode enum + errorToExitCode() (subtask 5)
├── error-handler.ts              # handleCliError() top-level formatter (subtask 5)
│
├── prod-safety.ts                 # ProdSafetyGate class + ConfirmationPrompt iface (subtask 6)
│
├── fs-seam.ts                     # FileSystem interface + NodeFileSystem default (shared seam)
│
├── seams/
│   ├── test-runner.ts             # TestRunner iface + NotImplementedTestRunner (subtask 8)
│   ├── importer.ts                # Importer iface + NotImplementedImporter (subtask 8)
│   └── docs-generator.ts          # DocsGenerator iface + NotImplementedDocsGenerator (subtask 8)
│
└── commands/
    ├── validate.ts                # ValidateCommand class — fully functional (subtask 7)
    ├── run.ts                     # RunCommand class — config+gate+TestRunner seam (subtask 9)
    ├── import.ts                  # ImportCommand class — Importer seam (subtask 9)
    └── docs.ts                    # DocsCommand class — DocsGenerator seam (subtask 9)
```

**Why `config/` is a sub-package and not one file:** types, schema, defaults,
loader, and the effective-settings resolver are five independently-tested
units with distinct failure modes; combining them would breach the 300-line
soft limit and couple pure type declarations to AJV. Each is a clean unit.

**Why `fs-seam.ts` is shared (DRY):** both `ConfigLoader` (read one JSON
file) and `ValidateCommand` (recursive walk + read JSON/YAML) need a
filesystem abstraction. A single `FileSystem` interface with one
`NodeFileSystem` default avoids duplicated `fs` wrappers and gives both a
single injection point.

**Why `error-handler.ts` is separate from `errors.ts`/`exit-codes.ts`:**
`errors.ts` (data) and `exit-codes.ts` (mapping) are pure and trivially
100% covered; `error-handler.ts` formats via the `Logger` (level-aware
stack suppression) and is the one place exit logic is composed — separating
keeps each unit's branch surface small.

---

## 2. Type Definitions

### 2.1 Config types — `src/cli/config/types.ts` (subtask 1; type-only, excluded from coverage like `src/env/types.ts`)

```typescript
/** Console verbosity levels (V1_BUILD_SPEC.md §10, lines 648–657). */
export type LogLevel = "error" | "warn" | "info" | "debug";

/** Test markers (V1_BUILD_SPEC.md §3). `all` is a CLI shorthand only,
 *  never stored in config (config uses the concrete three). */
export type Marker = "smoke" | "regression" | "e2e";

/** Retry policy block of apiwright.config.json (V1_BUILD_SPEC.md §9). */
export interface RetryConfig {
  /** Initial attempt plus up to N retries. Range 0–5. Default 2. */
  count: number;
  /** Delay between attempts in ms. Non-negative. Default 1000. */
  delay_ms: number;
  /** Backoff strategy between retries. Default "linear". */
  backoff: "none" | "linear" | "exponential";
  /** Strict mode treats any first-attempt failure as fail. Default false. */
  strict: boolean;
}

/** Report output block of apiwright.config.json (V1_BUILD_SPEC.md §10). */
export interface ReportConfig {
  /** Emit the HTML technical report. Default true. */
  html: boolean;
  /** Emit the JSON sidecar. Default true. */
  json: boolean;
  /** Emit JUnit XML for CI. Default true. */
  junit_xml: boolean;
  /** Directory reports are written to. Default "./reports". */
  output_dir: string;
}

/**
 * Fully-resolved apiwright.config.json. After {@link ConfigLoader.load}
 * every field is present (defaults filled); no optionals. Consumed by the
 * loader, command handlers, and the run/import/docs seams.
 */
export interface ApiwrightConfig {
  /** Endpoint test directory. Default "./tests". */
  tests_dir: string;
  /** Environment YAML directory. Default "./environments". */
  environments_dir: string;
  /** Reports directory. Default "./reports". */
  reports_dir: string;
  /** Default environment name when --env is absent. Default "qa". */
  default_env: string;
  /** Default markers when --markers is absent. Default ["smoke"]. */
  default_markers: Marker[];
  /** Default console log level when --log is absent. Default "warn". */
  log_level: LogLevel;
  /** Default Playwright worker count. Positive integer. Default 8. */
  workers: number;
  /** Retry policy. */
  retry: RetryConfig;
  /** Report output policy. */
  report: ReportConfig;
}

/** Partial config as it may appear on disk (every key optional). */
export type PartialApiwrightConfig = {
  [K in keyof ApiwrightConfig]?: K extends "retry"
    ? Partial<RetryConfig>
    : K extends "report"
      ? Partial<ReportConfig>
      : ApiwrightConfig[K];
};

/**
 * The per-run settings produced by merging CLI flags over a loaded config
 * (subtask 3). Distinct from {@link ApiwrightConfig}: this is the
 * single-invocation view consumed by command handlers and the TestRunner
 * seam. The on-disk config is never mutated to produce this.
 */
export interface EffectiveSettings {
  /** Resolved environment name (CLI --env or config default_env). */
  env: string;
  /** Resolved, validated, de-`all`-expanded markers. */
  markers: Marker[];
  /** Resolved console log level. */
  logLevel: LogLevel;
  /** Resolved worker count (CLI --workers or config workers). */
  workers: number;
  /** Resolved retry count (CLI --retries or config retry.count). */
  retries: number;
  /** Whether --allow-non-smoke-in-prod was passed (prod-safety input). */
  allowNonSmokeInProd: boolean;
  /** The full underlying config (immutable; for paths, report policy). */
  config: Readonly<ApiwrightConfig>;
}

/** Raw CLI flag values for one invocation (only supplied flags present). */
export interface CliFlags {
  /** --env=<name>. */
  env?: string;
  /** --markers=<csv|all>. */
  markers?: string;
  /** --log=<level>. */
  log?: string;
  /** --workers=<n> (string from commander; parsed by resolver). */
  workers?: string;
  /** --retries=<n>. */
  retries?: string;
  /** --allow-non-smoke-in-prod boolean flag. */
  allowNonSmokeInProd?: boolean;
  /** --config=<path> override for config file location. */
  config?: string;
}
```

### 2.2 Result shapes (discriminated; mirror `EnvironmentLoadResult`)

```typescript
// src/cli/config/schema.ts
/** Mirrors src/core & src/env validator return shape. */
export interface ConfigValidationResult {
  valid: boolean;
  /** Aggregated "<path> <message>" strings; present only when invalid. */
  errors?: string[];
}

// src/cli/config/loader.ts
export interface ConfigLoadResult {
  valid: boolean;
  /** Fully-defaulted config; present when valid. Defaults even on a
   *  missing file (missing file is NOT an error). */
  config?: ApiwrightConfig;
  /** Parse / schema errors; present only when invalid. */
  errors?: string[];
}

// src/cli/config/resolve-effective.ts
export type ResolveResult =
  | { ok: true; settings: EffectiveSettings }
  | { ok: false; errors: string[] };

// src/cli/prod-safety.ts
export type ProdSafetyDecision =
  | { allowed: true }
  | { allowed: false; reason: string };

// src/cli/commands/validate.ts
export interface FileValidationResult {
  /** Absolute or root-relative path of the validated file. */
  path: string;
  /** "endpoint" | "environment". */
  kind: "endpoint" | "environment";
  /** True when the file passed its schema/loader check. */
  passed: boolean;
  /** Per-file errors; empty when passed. */
  errors: string[];
}
export interface ValidateSummary {
  results: FileValidationResult[];
  passedCount: number;
  failedCount: number;
}
```

---

## 3. Subtask-by-Subtask Design

### Subtask 1 — `cli-config-types-and-schema`

**Files:** `config/types.ts`, `config/schema.ts`, plus barrel export in
`index.ts`.

**Public API:**

- All types in §2.1 / §2.2 (`types.ts`).
- `export const APIWRIGHT_CONFIG_SCHEMA: Record<string, unknown>` — JSON
  Schema with `errorMessage` annotations naming each field.
- `export function formatConfigErrors(errors): string[]` — identical
  formatter to `formatAjvErrors`/`formatEnvErrors` (`"<path> <message>"`,
  `instancePath || "root"`). Defended: re-using the exact formatter keeps
  CLI error strings consistent with core/env and satisfies the acceptance
  criterion "uses the AJV-via-require + errorMessage convention".
- `export class ApiwrightConfigSchemaValidator` with
  `validate(config: unknown): ConfigValidationResult`. One class per file;
  constructed once (compiles the schema in the ctor, same as
  `SchemaValidator`/`EnvironmentSchemaValidator`).

**Schema rules (each acceptance criterion mapped to a schema constraint):**

| Field | Schema constraint | `errorMessage` |
|---|---|---|
| `log_level` | `enum: ["error","warn","info","debug"]` | `log_level must be one of error, warn, info, debug` |
| `retry.backoff` | `enum: ["none","linear","exponential"]` | `retry.backoff must be one of none, linear, exponential` |
| `retry.count` | `integer, min 0, max 5` | `retry.count must be an integer 0-5` |
| `retry.delay_ms` | `integer, min 0` | `retry.delay_ms must be a non-negative integer` |
| `retry.strict` | `boolean` | `retry.strict must be a boolean` |
| `workers` | `integer, minimum: 1` | `workers must be a positive integer` |
| `default_markers` | `array, items enum [smoke,regression,e2e]` | `default_markers must be an array of smoke, regression, or e2e` |
| `tests_dir`/`environments_dir`/`reports_dir`/`default_env` | `string, minLength 1` | `<field> must be a non-empty string` |
| `report.{html,json,junit_xml}` | `boolean` | `report.<field> must be a boolean` |
| `report.output_dir` | `string, minLength 1` | `report.output_dir must be a non-empty string` |

- Schema is **partial-tolerant**: top-level `required: []`, every property
  optional, nested `retry`/`report` objects optional with their own
  optional props. Defended: the on-disk file may omit any key (defaults are
  filled by the loader in subtask 2); the schema validates *shape and
  enum/type correctness of what is present*, not completeness. The spec
  example (lines 706–727) must pass with **zero** errors.
- `additionalProperties: false` at top level and within `retry`/`report`
  with `errorMessage: "unknown property in apiwright.config.json"` —
  consistent with `ENDPOINT_META_SCHEMA`. AJV constructed
  `{ strict: false, allErrors: true }` exactly like the two siblings, with
  `addFormats(ajv)`.

**Error handling:** none thrown; invalid input → `{ valid:false, errors }`.

**Edge cases / test seams:** non-object input (`null`, array, string,
number) → single clear error; empty object `{}` → valid (all optional);
spec example object → valid with `errors` absent. No injection needed
(pure, deterministic) — the validator is constructed and `validate()`
called directly in tests.

---

### Subtask 2 — `cli-config-loader`

**Files:** `config/loader.ts`, `config/defaults.ts`; uses `fs-seam.ts`.

**`DEFAULT_CONFIG` (`config/defaults.ts`)** — frozen canonical defaults from
spec example, plus a `cloneDefaults(): ApiwrightConfig` deep-clone helper
(structuredClone) so callers receive a fresh mutable object and the frozen
constant is never aliased:

```typescript
export const DEFAULT_CONFIG: Readonly<ApiwrightConfig> = Object.freeze({
  tests_dir: "./tests",
  environments_dir: "./environments",
  reports_dir: "./reports",
  default_env: "qa",
  default_markers: ["smoke"],
  log_level: "warn",
  workers: 8,
  retry: { count: 2, delay_ms: 1000, backoff: "linear", strict: false },
  report: { html: true, json: true, junit_xml: true, output_dir: "./reports" },
});
```

**`FileSystem` seam (`fs-seam.ts`):**

```typescript
export interface FileSystem {
  /** Reads a UTF-8 file. Throws a tagged FsError on ENOENT/EACCES. */
  readFile(path: string): string;
  /** True if the path exists and is a regular file. */
  fileExists(path: string): boolean;
  /** True if the path exists and is a directory. */
  dirExists(path: string): boolean;
  /** Recursively lists regular file paths under dir (no dirs). */
  walk(dir: string): string[];
}
export class NodeFileSystem implements FileSystem { /* node:fs sync impls */ }
```

`readFile` failures are surfaced as a small tagged error
(`{ code: "ENOENT" | "EACCES" | "EISDIR" | "UNKNOWN" }`) so callers branch
on cause without string-matching OS messages.

**Public API — `ConfigLoader` (one class, `config/loader.ts`):**

```typescript
export interface ConfigLoaderOptions {
  /** Repo root to resolve apiwright.config.json against. Default cwd. */
  rootDir?: string;
  /** Explicit config path (CLI --config) overriding rootDir lookup. */
  configPath?: string;
  /** Filesystem seam. Default new NodeFileSystem(). */
  fs?: FileSystem;
  /** Schema validator seam. Default new ApiwrightConfigSchemaValidator(). */
  validator?: ApiwrightConfigSchemaValidator;
}
export class ConfigLoader {
  constructor(options?: ConfigLoaderOptions);
  /** Locates, parses, validates, and defaults the config. Never throws on
   *  user-config error. Missing file → defaults, valid=true. */
  load(): ConfigLoadResult;
}
```

**Algorithm (mirrors `EnvironmentLoader.runPipeline` short-circuit style):**

1. Resolve path: `configPath` if given, else
   `join(rootDir, "apiwright.config.json")`.
2. `fs.fileExists(path)` false → return
   `{ valid: true, config: cloneDefaults() }` (missing file is **not** an
   error — explicit acceptance criterion).
3. `fs.readFile` throws ENOENT after exists check (race) → treat as missing
   → defaults. EACCES/EISDIR → `{ valid:false, errors:["cannot read
   <path>: <code>"] }`.
4. `JSON.parse` throws → `{ valid:false, errors:["apiwright.config.json is
   not valid JSON: <message>"] }` (names the file; does not throw).
5. `validator.validate(parsed)` invalid → `{ valid:false,
   errors: result.errors }`.
6. Deep-merge parsed over `cloneDefaults()` (plain-object key-by-key;
   arrays/scalars replace — same merge semantics already proven in
   `src/env/loader.ts deepMerge`; **DRY note:** the merge rule is identical
   in spirit but `env`'s `deepMerge` is private to that module. To avoid a
   forbidden cross-module private import, a tiny local `mergeDefaults`
   limited to the known two-level config shape is used; documented as a
   deliberate, bounded duplication of the *rule*, not the code, because
   exposing env internals would be worse coupling). Return
   `{ valid:true, config }`.

**Edge cases:** empty file (`""`) → JSON parse error, reported; file
containing `null`/`[]`/`"x"` → schema rejects (non-object); BOM-prefixed
JSON → stripped before parse; deeply partial file (only `log_level`) →
defaults fill the rest; unknown top-level key → schema
`additionalProperties:false` rejects with the named message.

**Test seams:** inject a fake `FileSystem` returning canned content/paths
and a fake/real validator — no disk access; every branch (missing,
unreadable, bad JSON, schema-fail, partial, full) is a one-line fake.

---

### Subtask 3 — `cli-flag-override-merge`

**Files:** `config/resolve-effective.ts` (pure functions, no class — see
rationale).

**Public API:**

```typescript
/** Pure: merges supplied CLI flags over a validated config into the
 *  per-run EffectiveSettings. Mutates neither input. Only flags that are
 *  present (not undefined) override; absent flags keep the config value. */
export function resolveEffectiveSettings(
  config: ApiwrightConfig,
  flags: CliFlags,
): ResolveResult;

/** Parses a --markers string. Accepts comma-separated smoke/regression/e2e
 *  and the literal "all" (→ ["smoke","regression","e2e"]). Whitespace
 *  trimmed; case-sensitive per spec tokens. Unknown token → error. */
export function parseMarkers(raw: string): {
  ok: true; markers: Marker[];
} | {
  ok: false; error: string;
};
```

**Why functions, not a class:** this unit holds no state, no injected
collaborators, no polymorphism — it is a pure transformation. The OOP
invariant requires classes for *pluggable* components; a deterministic pure
function is the correct, more testable shape (matches `src/env`'s
`resolveSecrets`/`resolveTemplates` precedent, which are exported
functions).

**Merge rules (acceptance-criterion mapped):**

- `env`: `flags.env ?? config.default_env`. An explicitly-passed flag equal
  to the config value is still applied (no-op effect, no error).
- `markers`: if `flags.markers` present → `parseMarkers`; on `ok:false`
  return `{ ok:false, errors:[error] }`. If absent → `config.default_markers`.
- `logLevel`: if `flags.log` present, validate it ∈ LogLevel set; invalid →
  `{ ok:false, errors:["--log must be one of error, warn, info, debug
  (got '<x>')"] }`. Absent → `config.log_level`.
- `workers`: `flags.workers` present → parse positive int; invalid →
  error. Absent → `config.workers`.
- `retries`: `flags.retries` present → parse int 0–5; invalid → error.
  Absent → `config.retry.count`.
- `allowNonSmokeInProd`: `flags.allowNonSmokeInProd === true`.
- `config`: the unchanged input, frozen view (`Object.freeze` shallow not
  required since callers treat as `Readonly`; we pass through by reference,
  no mutation occurs anywhere — defended: purity is enforced by never
  writing to `config` or `flags` and by building a brand-new
  `EffectiveSettings` object).

**Error aggregation:** all flag-parse failures collected and returned
together (consistent with the "aggregate messages" philosophy of
`EnvironmentLoader`), so a user with two bad flags sees both.

**Edge cases:** `--markers=all` → three markers; `--markers=smoke,,regression`
→ empty token rejected with clear message; `--markers=` (empty) → error
"markers must not be empty"; duplicate markers (`smoke,smoke`) → de-duplicated
silently (order preserved), not an error; `--workers=0`/`-1`/`8.5`/`abc` →
"workers must be a positive integer"; `--retries=6` → "retries must be an
integer 0-5".

**Test seams:** none needed — pure; tests call with literal config + flag
objects and assert returned object identity is new (input refs unchanged).

---

### Subtask 4 — `cli-logging-setup`

**Files:** `logging/logger.ts`.

**Public API:**

```typescript
/** Stable console-output contract. Command handlers and the run/import/docs
 *  seams depend on THIS, never on pino directly (decoupling). */
export interface Logger {
  error(message: string): void;
  warn(message: string): void;
  info(message: string): void;
  debug(message: string): void;
  /** The level this logger was created at (for stack-suppression logic). */
  readonly level: LogLevel;
}

export interface LoggerOptions {
  /** Output stream for emitted lines. Default process.stdout. Injectable
   *  so tests assert lines without writing real stdout. */
  stream?: NodeJS.WritableStream;
}

/** Builds a pino-backed Logger filtered to `level`. Invalid level string
 *  → throws ConfigError naming accepted values (NOT silent default). */
export function createLogger(level: LogLevel, opts?: LoggerOptions): Logger;
```

**Internal structure:** `class PinoLogger implements Logger` wrapping a
`pino` instance configured `{ level }` writing through `pino-pretty`
(human-friendly per spec) to the injected stream. `createLogger` is the
factory; the class is one-per-file.

**Why an interface + class:** `Logger` is a pluggable boundary consumed by
every handler and every seam; per the OOP invariant a pluggable boundary is
a TS `interface` with a class implementation, enabling a trivial
test/fake logger and keeping pino swappable.

**Level filtering (acceptance-mapped):** pino's native level filter:
`error` shows only `error`; `warn` (default) shows `warn`+`error`; `info`
adds `info`; `debug` shows all four. Verified by capturing the injected
stream.

**Error handling:** `createLogger("nope" as LogLevel)` → throws
`ConfigError("--log must be one of error, warn, info, debug")` (subtask 5
type). Justification for throw (not result shape): an invalid level reaching
this factory means the upstream resolver (subtask 3) failed to gate — it is
a programmer/wiring error, surfaced loudly; in normal flow the resolver
already validated the level so this path is defensive.

**pino-pretty in tests:** the design mandates `createLogger` accept the
stream; `pino-pretty`'s sync transport (`{ destination: stream, sync:true }`)
is used so emitted lines are flushed synchronously and asserted
deterministically in unit tests (avoids pino's async worker transport which
is untestable in-process).

**Edge cases:** multi-line messages preserved; messages containing
newlines/ANSI not crash; logger created at `error` and `.debug()` called →
no output line (asserted empty stream).

---

### Subtask 5 — `cli-error-and-exit-codes`

**Files:** `errors.ts`, `exit-codes.ts`, `error-handler.ts`.

**Error hierarchy — `errors.ts` (composition-friendly; each a distinct
class, single shared base for `instanceof`):**

```typescript
/** Base for every CLI-recognized failure. Carries the exit code. */
export abstract class CliError extends Error {
  abstract readonly code: ExitCode;
  constructor(message: string) { super(message); this.name = new.target.name; }
}
/** Bad flag, malformed/invalid config, unknown command. */
export class ConfigError extends CliError { readonly code = ExitCode.USAGE; }
/** `validate` found one or more invalid files. */
export class ValidationFailedError extends CliError {
  readonly code = ExitCode.VALIDATION;
}
/** Prod-safety gate declined / failed fast in CI. */
export class ProdSafetyAbortError extends CliError {
  readonly code = ExitCode.PROD_SAFETY;
}
/** A deferred seam was invoked. Names the responsible future task. */
export class NotImplementedError extends CliError {
  readonly code = ExitCode.NOT_IMPLEMENTED;
  constructor(feature: string, taskNumber: number) {
    super(`${feature} is not yet implemented (Task #${taskNumber})`);
  }
}
```

**Why abstract base + subclasses (inheritance here is justified):** these
are *error data types*, not behavior strategies. A discriminated error
hierarchy with `instanceof` is the idiomatic, type-safe way to map failures
to exit codes; the OOP "composition over inheritance" rule targets
*pluggable behavior* (strategies/connectors), not exception taxonomy. Each
subclass adds only a literal `code` — zero behavior inheritance risk.

**Exit codes — `exit-codes.ts` (documented constants):**

```typescript
/** Process exit codes. Documented contract for CI and scripts. */
export enum ExitCode {
  /** Success. */                                    SUCCESS = 0,
  /** Usage/config error: bad flag, malformed or
   *  schema-invalid config, unknown command,
   *  missing required argument. */                   USAGE = 2,
  /** `validate` found at least one invalid file. */  VALIDATION = 3,
  /** Prod-safety gate declined or CI fail-fast. */   PROD_SAFETY = 4,
  /** A deferred seam (run/import/docs) invoked
   *  before its engine exists. */                    NOT_IMPLEMENTED = 5,
  /** Unexpected/uncaught internal error. */          INTERNAL = 70,
}
/** Maps any thrown value to an ExitCode. CliError → its .code;
 *  anything else → INTERNAL. Pure; no side effects. */
export function errorToExitCode(err: unknown): ExitCode;
```

Codes chosen distinct and non-overlapping (2/3/4/5 distinct as required;
0 success; 70 = sysexits `EX_SOFTWARE` for unexpected). `1` deliberately
unused so a generic crash (code 1) is distinguishable from our taxonomy.

**Top-level handler — `error-handler.ts`:**

```typescript
export interface ErrorHandlerOptions {
  /** Logger to format the failure through. */
  logger: Logger;
  /** Exit side-effect seam. Default (code) => process.exit(code).
   *  Injectable so mapping is unit-tested without killing the runner. */
  exit?: (code: ExitCode) => never;
}
/** Logs the failure (message only unless logger.level === "debug", then
 *  full stack) and exits with the mapped code. Returns never. */
export function handleCliError(err: unknown, opts: ErrorHandlerOptions): never;
```

**Behavior:** `CliError` → `logger.error(err.message)`; if
`logger.level === "debug"` also `logger.debug(err.stack ?? "")`. Non-`CliError`
→ generic `logger.error("unexpected error: <message>")` (+ stack at debug)
and `INTERNAL`. Never leaks stack at non-debug levels (acceptance
criterion). The injected `exit` defaults to a function returning `never`
that calls `process.exit`; tests pass a fake `exit` that throws a sentinel
to assert the code without terminating the Vitest worker.

**Edge cases:** thrown non-Error (`throw "x"` / `throw 42`) → coerced via
`String(err)`, mapped to INTERNAL; `NotImplementedError` message must
contain `Task #<n>` (asserted); a `CliError` with empty message still logs
and exits its code.

---

### Subtask 6 — `cli-prod-safety-confirmation`

**Files:** `prod-safety.ts`.

**Confirmation prompt seam (pluggable → interface + class):**

```typescript
/** Reads a single confirmation line from the user. */
export interface ConfirmationPrompt {
  /** Writes `question` and resolves with the user's typed line (trimmed
   *  of the trailing newline only). */
  ask(question: string): Promise<string>;
}
/** Default: readline over an injectable input/output stream. */
export class StdinConfirmationPrompt implements ConfirmationPrompt {
  constructor(io?: { input?: NodeJS.ReadableStream;
                     output?: NodeJS.WritableStream });
}
```

**Gate — `ProdSafetyGate` (one class):**

```typescript
export interface ProdSafetyOptions {
  /** Prompt seam. Default new StdinConfirmationPrompt(). */
  prompt?: ConfirmationPrompt;
  /** Env source for CI detection + ALLOW_PROD_DESTRUCTIVE. Default
   *  process.env. */
  env?: NodeJS.ProcessEnv;
  /** CI detection seam. Default: () => Boolean(env.CI). Injectable so the
   *  "is CI" branch is deterministically testable both ways. */
  isCi?: (env: NodeJS.ProcessEnv) => boolean;
}
export class ProdSafetyGate {
  constructor(options?: ProdSafetyOptions);
  /** Decides whether the run may proceed. Pure decision + at most one
   *  prompt; runs NO tests. */
  async evaluate(args: {
    prodEnvironment: boolean;
    markers: Marker[];
    allowNonSmokeInProd: boolean;
  }): Promise<ProdSafetyDecision>;
}
```

**Decision table (V1_BUILD_SPEC.md §7 lines 517–521, acceptance-mapped):**

| prod | markers | CI? | flag | ALLOW_PROD_DESTRUCTIVE | Result |
|---|---|---|---|---|---|
| false | any | – | – | – | `{ allowed:true }` (no prompt) |
| true | only `smoke` | – | – | – | `{ allowed:true }` (no prompt) |
| true | non-smoke | no | – | – | prompt; input `=== "CONFIRM"` → allowed; else `{ allowed:false }` |
| true | non-smoke | yes | absent | – | `{ allowed:false }` fail-fast, **no prompt** |
| true | non-smoke | yes | present | unset/≠`true` | `{ allowed:false }` (flag alone insufficient) |
| true | non-smoke | yes | present | `=== "true"` | `{ allowed:true }` (no prompt) |

"non-smoke" = markers contains anything other than `smoke` (i.e. includes
`regression` or `e2e`; an `all` flag is already expanded to the three by
subtask 3 before reaching the gate). Exact prompt string (spec wording):

```
WARNING: You are about to run non-smoke tests against prod. Type 'CONFIRM' to proceed:
```

`evaluate` returns a `{ allowed:false, reason }` decision; **it does not
throw**. The caller (`RunCommand`, subtask 9) converts a non-allowed
decision into `ProdSafetyAbortError` so subtask 5 maps it to
`ExitCode.PROD_SAFETY`. Defended: keeping the gate side-effect-free (no
throw, no exit) makes its full truth table unit-testable as pure return
values; only the wiring layer turns the decision into an exit.

**Edge cases:** input `" CONFIRM "` (surrounding spaces) → trimmed and
accepted? **No** — per spec "Type 'CONFIRM'": we trim only the trailing
newline, then require exact `=== "CONFIRM"`; `" CONFIRM"`/`"confirm"`/
`"CONFIRM "`/`""`/EOF(stdin closed) → abort. CI detection via injected
`isCi` so both CI and non-CI branches are tested without touching
`process.env.CI`. `ALLOW_PROD_DESTRUCTIVE` compared strictly to the string
`"true"` (not truthiness) to avoid `"false"`/`"0"` accidentally enabling.

**Test seams:** fake `ConfirmationPrompt` returning a scripted answer
(incl. one that records the question text to assert exact wording); injected
`env` map; injected `isCi`. Every row of the table is one deterministic
test.

---

### Subtask 7 — `cli-validate-command`

**Files:** `commands/validate.ts`; uses `fs-seam.ts`, `src/core`,
`src/env`, `logging/logger.ts`.

**Public API:**

```typescript
export interface ValidateCommandOptions {
  /** Filesystem seam (walk + read). Default new NodeFileSystem(). */
  fs?: FileSystem;
  /** Endpoint validator. Default new SchemaValidator() from src/core. */
  schemaValidator?: SchemaValidator;
  /** Env loader factory. Default (rootDir) => new EnvironmentLoader({...}).
   *  Injectable so env validation is unit-tested without YAML on disk. */
  environmentLoaderFactory?: (rootDir: string) => EnvironmentLoader;
  /** Output logger. */
  logger: Logger;
}
export class ValidateCommand {
  constructor(options: ValidateCommandOptions);
  /** Validates every endpoint/env file under `dir`. Returns the summary;
   *  the caller maps a non-zero failedCount to ValidationFailedError. */
  run(dir: string): ValidateSummary;
}
```

**Algorithm:**

1. `fs.dirExists(dir)` false → throw `ConfigError("directory not found:
   <dir>")` (→ ExitCode.USAGE) — "not a crash" per acceptance criterion.
2. `fs.walk(dir)` → classify by suffix:
   - `*.endpoint.json` → endpoint files.
   - `*.flow.json` → ignored in v1.0 (reserved; logged at `info`).
   - files under `<dir>` matching `*.yaml`/`*.yml` whose name (sans ext)
     is a plausible env name → environment files. Defended scoping: the
     spec's validate command targets the tests dir; environment YAMLs are
     validated when present. To avoid mis-validating arbitrary YAML, only
     files directly named like environments are validated; the design
     reuses `EnvironmentLoader` so the *exact same* env contract applies.
   - all other files ignored (matches §9 "file naming convention is the
     only contract").
3. If zero endpoint **and** zero environment files → throw
   `ConfigError("no validatable files found under <dir>")` (USAGE,
   non-zero, not a crash) — acceptance criterion.
4. For each endpoint file: `JSON.parse` (parse error → failed result with
   "<file> is not valid JSON: <msg>", no throw) →
   `schemaValidator.validateEndpoint(parsed)` → map `{ valid, errors }` to
   a `FileValidationResult`.
5. For each environment file: derive env `name` from filename; build
   `EnvironmentLoader` via the injected factory with
   `rootDir = dirname(file)` (or the env dir) and call
   `load(name)`; map `{ valid, errors }` to a `FileValidationResult`
   (reuses the loader's aggregated messages verbatim — no new validation
   logic, satisfying the acceptance criterion). Secret-resolution failures
   from the loader are reported as-is (loader never throws; values never
   leak — already guaranteed by `src/env`).
6. Emit per-file lines via `logger` (`info` for pass, `error` for fail with
   each message), then a final summary line
   `"validated N files: P passed, F failed"` (acceptance criterion).
   Return `ValidateSummary`.

**Why a class:** holds injected collaborators (`fs`, validator, loader
factory, logger) and orchestrates them — a stateful coordinator, correctly
a class with one responsibility (the actual validation logic lives in
`src/core`/`src/env`; this class only discovers, dispatches, and reports —
DRY: no schema logic duplicated).

**Reuse contracts (exact):**
- `new SchemaValidator()` then `.validateEndpoint(obj)` →
  `{ valid: boolean; errors?: string[] }` (from
  `src/core/schema-validator.ts`).
- `new EnvironmentLoader({ rootDir, env, reader })` then `.load(name)` →
  `{ valid, environment?, errors?, secretRegistry }` (from
  `src/env/loader.ts`). The CLI passes the real `process.env` in production;
  tests inject a fake loader factory.

**Edge cases:** empty directory (exists, no files) → USAGE error; directory
with only `.flow.json`/README/fixtures → USAGE "no validatable files";
endpoint JSON that is valid JSON but violates schema → reported with the
exact `formatAjvErrors` messages, `failedCount>0`,
`ValidationFailedError`; endpoint JSON that is malformed JSON → reported
failed (parse message), not thrown; nested subdirectories walked to any
depth (recursive walk per §9); a directory passed that is actually a file →
`dirExists` false → USAGE; mixed pass/fail → summary counts correct, exit
VALIDATION because `failedCount>0`.

**Test seams:** fake `FileSystem` returning a canned file list + canned
contents per path; a real `SchemaValidator` (cheap, deterministic) or a
fake; a fake `environmentLoaderFactory` returning a stub loader with
scripted `load()` results; a fake `Logger` capturing emitted lines. No disk,
no real YAML.

---

### Subtask 8 — `cli-deferred-command-seams`

**Files:** `seams/test-runner.ts`, `seams/importer.ts`,
`seams/docs-generator.ts`. **No import** from `src/importers`,
`src/runner`, `src/docs-generator` (those paths do not exist; verified by
the layout — these three files import only `../errors.js`,
`../config/types.js`, and `src/env` types).

**Seam interfaces (the STABLE contract Tasks #4/#5/#10/#11 implement):**

```typescript
// seams/test-runner.ts
import type { EffectiveSettings } from "../config/types.js";
import type { ResolvedEnvironment } from "../../env/index.js";

/** Result a future runner returns; runner exit policy is the runner's. */
export interface TestRunOutcome {
  /** Total endpoint test cases attempted. */
  total: number;
  /** Cases that passed (including pass-after-retry "flaky"). */
  passed: number;
  /** Cases that failed after retries. */
  failed: number;
  /** Cases that passed only after a retry. */
  flaky: number;
}
/** Implemented by Task #10. The CLI depends only on this. */
export interface TestRunner {
  /** Executes the resolved test plan for one invocation. */
  run(input: {
    /** Resolved environment name. */
    env: string;
    /** Already loaded + validated environment (CLI loads it via
     *  src/env EnvironmentLoader before delegating). May be undefined if
     *  the runner is responsible for loading; see §4 contract note. */
    environment?: ResolvedEnvironment;
    /** Resolved markers (de-`all`-expanded). */
    markers: EffectiveSettings["markers"];
    /** Resolved console log level. */
    logLevel: EffectiveSettings["logLevel"];
    /** Full effective settings (paths, workers, retries, report cfg). */
    settings: EffectiveSettings;
  }): Promise<TestRunOutcome>;
}
/** Default binding until Task #10 ships. */
export class NotImplementedTestRunner implements TestRunner {
  run(): Promise<TestRunOutcome> {
    throw new NotImplementedError("`apiwright run`", 10);
  }
}

// seams/importer.ts
/** Implemented by Task #4 (postman) and Task #5 (openapi). */
export interface Importer {
  /** Converts a Postman v2.1 collection file into endpoint JSON files. */
  postman(input: { file: string; outputDir: string }): Promise<ImportOutcome>;
  /** Converts an OpenAPI/Swagger spec (URL or file) into endpoint JSON. */
  openapi(input: { source: string; outputDir: string }):
    Promise<ImportOutcome>;
}
export interface ImportOutcome {
  /** Number of endpoint files written. */
  written: number;
  /** Human-readable warnings (e.g., unparseable pre-request scripts). */
  warnings: string[];
}
export class NotImplementedImporter implements Importer {
  postman(): Promise<ImportOutcome> {
    throw new NotImplementedError("`apiwright import postman`", 4);
  }
  openapi(): Promise<ImportOutcome> {
    throw new NotImplementedError("`apiwright import openapi`", 5);
  }
}

// seams/docs-generator.ts
/** Implemented by Task #11. */
export interface DocsGenerator {
  /** Generates per-endpoint Markdown from a source dir into output dir. */
  generate(input: { sourceDir: string; outputDir: string }):
    Promise<DocsOutcome>;
}
export interface DocsOutcome {
  /** Number of Markdown files written. */
  written: number;
}
export class NotImplementedDocsGenerator implements DocsGenerator {
  generate(): Promise<DocsOutcome> {
    throw new NotImplementedError("`apiwright docs generate`", 11);
  }
}
```

**Why interfaces + Not-Implemented classes (OOP invariant):** these are the
canonical *pluggable boundaries* (importers/runner/docs-generator are listed
in `.claude/README.md` as the things that must be classes implementing TS
interfaces). The default `NotImplemented*` classes are real implementations
that throw the typed `NotImplementedError` (subtask 5) — never a `require`
of a non-existent module. Future tasks add a sibling class implementing the
same interface; **no CLI change required**, satisfying the criterion "the
future engines can implement them without CLI changes".

**Throw vs result:** seams *throw* `NotImplementedError` (not a result
shape) deliberately — it is not a user-config error; it is "this build
doesn't have that engine yet". The top-level handler maps it to
`ExitCode.NOT_IMPLEMENTED` with the task number in the message.

**Test seam:** every command handler (subtask 9) accepts its seam via
constructor injection; tests substitute a fake implementing the interface
to assert *delegation occurred with the right arguments* and a fake
throwing to assert exit-code mapping.

---

### Subtask 9 — `cli-command-wiring-entry`

**Files:** `entry.ts`, `commands/run.ts`, `commands/import.ts`,
`commands/docs.ts`, `index.ts`.

**Command handler classes (one per file, each constructor-injected with
its collaborators — no global singletons):**

```typescript
// commands/run.ts
export interface RunCommandOptions {
  configLoader: ConfigLoader;
  prodSafetyGate: ProdSafetyGate;
  /** Loads + validates the env before delegating. Default: real
   *  EnvironmentLoader factory. */
  environmentLoaderFactory?: (rootDir: string, env: NodeJS.ProcessEnv)
    => EnvironmentLoader;
  testRunner: TestRunner;          // default NotImplementedTestRunner
  loggerFactory: (lvl: LogLevel) => Logger;
}
export class RunCommand {
  constructor(o: RunCommandOptions);
  /** Loads config, resolves flags, builds logger, loads the environment
   *  (src/env), runs the prod-safety gate, then delegates to the
   *  TestRunner seam. Throws CliError subclasses; never calls exit. */
  async execute(flags: CliFlags): Promise<void>;
}
```

`commands/import.ts` → `ImportCommand` (ctor: `{ importer: Importer,
configLoader, loggerFactory }`; methods `postman(file, opts)` /
`openapi(source, opts)`), `commands/docs.ts` → `DocsCommand` (ctor:
`{ docsGenerator: DocsGenerator, configLoader, loggerFactory }`).

**`RunCommand.execute` flow (acceptance-mapped):**
1. `configLoader.load()` → invalid → throw `ConfigError(errors.join("; "))`.
2. `resolveEffectiveSettings(config, flags)` → `ok:false` → throw
   `ConfigError`.
3. `loggerFactory(settings.logLevel)`.
4. Load env via `EnvironmentLoader` (`src/env`). RECONCILED CONTRACT
   (corrects original design): `EnvironmentLoader.load(name)` itself
   resolves `<rootDir>/.env.<name>.yaml` then
   `<rootDir>/environments/<name>.yaml` (see src/env/loader.ts:44-46).
   Therefore `rootDir` MUST be the directory that *contains* the
   environments dir, NOT `config.environments_dir` itself (passing
   `./environments` would make the loader look for
   `./environments/environments/<name>.yaml`). Pass
   `dirname(resolve(config.environments_dir))` as `rootDir` so the
   loader's appended `environments/` lands on the configured dir for
   the default `./environments` layout. Invalid → throw
   `ConfigError(loader.errors)`. Capture `environment.prod`.
5. `prodSafetyGate.evaluate({ prodEnvironment: environment.prod,
   markers: settings.markers, allowNonSmokeInProd:
   settings.allowNonSmokeInProd })`. `allowed:false` → throw
   `ProdSafetyAbortError(reason)`.
6. `await testRunner.run({ env, environment, markers, logLevel,
   settings })` — the `NotImplementedTestRunner` throws
   `NotImplementedError(..., 10)` here, mapped by the handler to
   `ExitCode.NOT_IMPLEMENTED`. (Acceptance: `--markers=smoke` reaches the
   seam without prompting; `--markers=regression` prompts first then
   reaches the seam on CONFIRM.)

**`entry.ts` — commander wiring (the ONLY file with the `process.exit`
boundary):**

```typescript
#!/usr/bin/env node
// imports: commander, ./commands/*, ./config/*, ./logging/logger,
//          ./error-handler, ./seams/*, ./prod-safety, node:fs/url
// (NO import from src/importers | src/runner | src/docs-generator)

/** Builds the commander program (pure: no parse, no exit). Exported so
 *  tests drive every command without spawning a process. */
export function buildProgram(deps?: EntryDeps): Command;

/** Parses argv and dispatches; the single process.exit site. */
export async function main(argv: string[], deps?: EntryDeps): Promise<void>;
```

- `EntryDeps` bundles every injectable (config loader, logger factory,
  prod gate, all three seams, `exit` fn, output stream, `env`) with
  production defaults — one composition root, fully overridable in tests.
- Commands declared: `run` (opts `--env --markers --log --workers
  --retries --allow-non-smoke-in-prod --config`), `import` with
  subcommands `postman <file>` / `openapi <source>` (opt `--output`,
  required), `validate <dir>`, `docs generate` (opt `--output`).
  `program.version(pkgVersion)` reads `version` from `package.json`
  (`0.1.0`) via a small JSON read at startup (documented lazy read; not a
  forbidden dynamic import). `--help` auto-provided by commander.
- Every action handler body: `try { await handler.execute(flags) }
  catch (e) { handleCliError(e, { logger, exit }) }`. Unknown command /
  missing required arg: commander's error → caught and mapped to
  `ExitCode.USAGE` via `program.exitOverride()` so commander never calls
  `process.exit` itself (we own the boundary). On success the handler
  returns and `main` exits `0`.
- `validate` dispatches to the real `ValidateCommand`; a `failedCount>0`
  summary → `main` throws `ValidationFailedError` → `ExitCode.VALIDATION`;
  all-pass → exit `0`.
- The literal `process.exit(code)` call inside the default `exit` seam is
  the **only** `/* istanbul ignore next */` line, justified inline:
  "process.exit terminates the worker; behavior covered via injected exit
  in unit tests." Every dispatch/branch above it is covered by driving
  `main`/`buildProgram` with injected fakes.

**`index.ts`** re-exports the public surface (all `config/*` types +
validator + loader, `resolveEffectiveSettings`, `parseMarkers`,
`createLogger`/`Logger`, the `CliError` hierarchy, `ExitCode`,
`errorToExitCode`, `handleCliError`, `ProdSafetyGate`, the three seam
interfaces + `NotImplemented*` defaults, `ValidateCommand`,
`buildProgram`). No logic in the barrel.

**Why classes for command handlers:** each is a coordinator owning injected
collaborators with one public `execute`; commander's thin action callbacks
delegate to them. This keeps `entry.ts` to wiring only (well under 500
lines) and makes every handler unit-testable in isolation (acceptance:
"dispatch logic covered by unit tests; process.exit the only ignored line").

---

## 4. Seam Contract Note (stability guarantee for Tasks #4/#5/#10/#11)

- **`TestRunner.run(input)`** — input carries the resolved `env` name, the
  already-loaded `ResolvedEnvironment` (CLI owns env loading via `src/env`
  so the gate can read `prod`; the runner may re-load if it needs the
  `secretRegistry`, but the contract guarantees a validated environment is
  available), de-`all`-expanded `markers`, `logLevel`, and full
  `EffectiveSettings` (paths/workers/retries/report). Returns
  `TestRunOutcome`. Task #10 implements this class; CLI unchanged.
- **`Importer.postman/openapi`** — `{ file|source, outputDir }` →
  `ImportOutcome { written, warnings }`. Tasks #4/#5 implement; CLI
  unchanged.
- **`DocsGenerator.generate`** — `{ sourceDir, outputDir }` →
  `DocsOutcome { written }`. Task #11 implements; CLI unchanged.

These three interfaces are frozen by this design. Future tasks add a class
implementing the interface and bind it in `EntryDeps`; **no edit to any
existing `src/cli` file's public API is required**, satisfying the "stable
contract" mandate.

---

## 5. Consolidated Error → Exit-Code Map

| Failure | Thrown by | Class | Exit |
|---|---|---|---|
| Bad/unknown flag, malformed/schema-invalid config, unknown command, missing arg, dir-not-found, no validatable files | resolver / loader / validate / commander | `ConfigError` | `2` USAGE |
| `validate` found ≥1 invalid file | `entry.ts` after `ValidateCommand` | `ValidationFailedError` | `3` VALIDATION |
| Prod gate declined / CI fail-fast | `RunCommand` from gate decision | `ProdSafetyAbortError` | `4` PROD_SAFETY |
| `run`/`import`/`docs` invoked pre-engine | `NotImplemented*` seam | `NotImplementedError` | `5` NOT_IMPLEMENTED |
| Anything uncaught | — | non-`CliError` | `70` INTERNAL |
| All handlers returned cleanly | — | — | `0` SUCCESS |

Stack traces shown only when `logger.level === "debug"` (subtask 5
acceptance). Codes 2/3/4/5 are distinct as required; `1` intentionally
reserved for generic crashes outside our taxonomy.

---

## 6. Global Edge-Case Register

- **Missing `apiwright.config.json`** → defaults, `valid:true` (NOT an
  error) — explicit acceptance criterion of subtask 2.
- **Empty / BOM / non-object config file** → parse or schema error,
  reported, no throw.
- **`--markers=all`** → expanded to `[smoke,regression,e2e]` before the
  prod gate (so the gate correctly classifies it non-smoke).
- **Smoke-only against prod** → no prompt, reaches `TestRunner` seam →
  `NotImplementedError(#10)`.
- **Non-smoke against prod, interactive, non-CONFIRM input / EOF** →
  `ProdSafetyAbortError`, exit `4`, no test execution.
- **Non-smoke against prod in CI without both flag + env var** → fail-fast,
  no prompt, exit `4`.
- **`validate` on nonexistent dir / empty dir / only ignored files** →
  `ConfigError`, exit `2`, never a stack-trace crash.
- **`validate` mixed valid/invalid** → full per-file report + summary, exit
  `3`.
- **Env file with unresolved `${secret.*}`** during `validate` →
  `EnvironmentLoader` returns aggregated errors (no secret values),
  reported per file.
- **Invalid `--log` value reaching `createLogger`** → throws `ConfigError`
  (defensive; resolver normally gates it first → exit `2`).
- **Unexpected thrown non-Error** anywhere → coerced, exit `70`.
- **Concurrent access:** CLI is a single-shot process; no shared mutable
  global state (every collaborator injected per invocation), so no
  concurrency hazards. `DEFAULT_CONFIG` is frozen and only ever deep-cloned.

---

## 7. Test Seams Summary (for test-engineer; 95% branch gate is REAL)

| Seam | Interface / param | Injected into | Default | Test substitute |
|---|---|---|---|---|
| Filesystem | `FileSystem` | `ConfigLoader`, `ValidateCommand` | `NodeFileSystem` | in-memory fake (canned files/walk) |
| Config validator | `ApiwrightConfigSchemaValidator` | `ConfigLoader` | real | real (cheap) or fake |
| `process.env` | `NodeJS.ProcessEnv` | `ProdSafetyGate`, env loader factory | `process.env` | literal map |
| Stdin / prompt | `ConfirmationPrompt` | `ProdSafetyGate` | `StdinConfirmationPrompt` | scripted-answer fake (also asserts prompt text) |
| CI detection | `(env) => boolean` | `ProdSafetyGate` | `env => Boolean(env.CI)` | `() => true/false` |
| Output stream | `WritableStream` | `createLogger`, prompt | `process.stdout` | capture buffer |
| `process.exit` | `(code) => never` | `error-handler`, `EntryDeps` | real `process.exit` (only ignored line) | throws sentinel |
| Endpoint validator | `SchemaValidator` (src/core) | `ValidateCommand` | real | real or fake |
| Env loader | `EnvironmentLoader` factory (src/env) | `ValidateCommand`, `RunCommand` | real factory | stub with scripted `load()` |
| run/import/docs engines | `TestRunner`/`Importer`/`DocsGenerator` | command handlers + `EntryDeps` | `NotImplemented*` | fake asserting delegation args |
| Logger | `Logger` | all handlers | `PinoLogger` | line-capturing fake |
| commander parse/exit | `program.exitOverride()` | `entry.ts` | n/a | drive `buildProgram`/`main` with argv arrays |

Every branch in every decision module is reachable by toggling these
injected inputs without touching the OS, network, or terminating the test
process. The single `/* istanbul ignore next */` is the literal
`process.exit(code)` inside the default `exit` seam, justified inline.

---

## 8. Acceptance-Criteria Verification

Every acceptance criterion across all 9 task YAMLs maps to a concrete
element above:

- **Subtask 1:** `ApiwrightConfig`/`RetryConfig`/`ReportConfig` exported
  (§2.1); enum/type/positive-integer/array schema rules with named messages
  (§3.1 table); spec example (lines 706–727) passes (partial-tolerant
  schema, all enums satisfied); `{ valid, errors }` shape +
  AJV-via-require/`errorMessage` convention reused (§0.6).
- **Subtask 2:** valid file → full config; missing file → defaults
  `valid:true`; malformed JSON → `valid:false` named error, no throw;
  schema-fail → aggregated errors, no throw; injectable rootDir + reader;
  typed `ApiwrightConfig` (§3.2).
- **Subtask 3:** env/markers/log override-or-keep; explicit-equals-config
  is a no-op override (not error); pure (new object, inputs untouched);
  `all` expansion + invalid-marker error (§3.3).
- **Subtask 4:** per-level filtering; invalid level rejected loudly;
  `Logger` interface decoupling pino; injectable stream (§3.4).
- **Subtask 5:** typed `NotImplementedError`; exit `0`/distinct
  `2`/`3`/`4`/`5`; debug-only stacks; injectable `exit` (§3.5, §5).
- **Subtask 6:** full prod truth table incl. CI flag+env-var double-gate;
  exact spec prompt wording; injectable prompt/env/CI; non-allowed →
  recognized abort, no test run (§3.6).
- **Subtask 7:** valid dir → exit 0; bad endpoint → schema errors + exit 3;
  env YAML via real `EnvironmentLoader`; nonexistent/empty dir → usage
  error not crash; reuses `src/core`+`src/env` only; summary line;
  injectable fs (§3.7).
- **Subtask 8:** `TestRunner`/`Importer`/`DocsGenerator` interfaces +
  defaults throwing `NotImplementedError` naming Tasks #10/#4/#5/#11;
  zero forbidden imports; typed with `ApiwrightConfig`/`ResolvedEnvironment`;
  injectable defaults (§3.8, §4).
- **Subtask 9:** `--version`/`--help` exit 0; real `validate`;
  `run --env=prod --markers=regression` → gate → seam #10;
  `run --env=prod --markers=smoke` → no prompt → seam #10; import/docs reach
  seams #4/#5/#11; unknown command/missing arg → usage code; entry compiles
  to `dist/cli/entry.js` (matches `package.json bin`, version `0.1.0`);
  process.exit the only ignored line (§3.9).

No acceptance criterion requires altering an existing public interface in
`src/core` or `src/env`; no architectural change touching unrelated
modules; no two-option ambiguity with materially different downstream
impact. **No halting condition triggered.**

---

## 9. Hand-off

**Files to be created (all new; nothing modified — `src/cli/` is greenfield;
`package.json` `bin`/`main` already point at `dist/cli/entry.js`):**

```
src/cli/index.ts
src/cli/entry.ts
src/cli/config/types.ts
src/cli/config/defaults.ts
src/cli/config/schema.ts
src/cli/config/loader.ts
src/cli/config/resolve-effective.ts
src/cli/logging/logger.ts
src/cli/errors.ts
src/cli/exit-codes.ts
src/cli/error-handler.ts
src/cli/prod-safety.ts
src/cli/fs-seam.ts
src/cli/seams/test-runner.ts
src/cli/seams/importer.ts
src/cli/seams/docs-generator.ts
src/cli/commands/validate.ts
src/cli/commands/run.ts
src/cli/commands/import.ts
src/cli/commands/docs.ts
```

No existing file modified. No file exceeds the 500-line hard limit (all are
well under 300). No `src/cli` file imports from `src/importers`,
`src/runner`, or `src/docs-generator`.

**Pipeline: proceed to test-engineer.**
