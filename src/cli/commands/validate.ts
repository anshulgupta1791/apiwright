/**
 * ValidateCommand — validates endpoint JSON and environment YAML files.
 *
 * Discovers files via the FileSystem seam, delegates endpoint validation to
 * SchemaValidator (src/core) and env validation to EnvironmentLoader (src/env).
 * Never imports from src/importers, src/runner, or src/docs-generator.
 */

import { dirname, basename } from "node:path";

import { AssertionParser } from "../../assertions/parser.js";
import { parseJson } from "../../core/safe-json.js";
import { SchemaValidator } from "../../core/schema-validator.js";
import { EnvironmentLoader } from "../../env/loader.js";
import { ConfigError } from "../errors.js";
import type { FileSystem } from "../fs-seam.js";
import { NodeFileSystem } from "../fs-seam.js";
import type { Logger } from "../logging/logger.js";

/** Result for one validated file. */
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

/** Aggregated summary of a validate run. */
export interface ValidateSummary {
  /** All per-file results in discovery order. */
  results: FileValidationResult[];
  /** Count of files that passed. */
  passedCount: number;
  /** Count of files that failed. */
  failedCount: number;
}

/** Options accepted by {@link ValidateCommand}. */
export interface ValidateCommandOptions {
  /** Filesystem seam (walk + read). Default new NodeFileSystem(). */
  fs?: FileSystem;
  /** Endpoint validator. Default new SchemaValidator() from src/core. */
  schemaValidator?: SchemaValidator;
  /**
   * Assertion parser. Default new AssertionParser(). Injectable so
   * tests can stub it (issue #65 — validate must catch assertion
   * syntax errors at validate-time, matching `apiwright run` startup).
   */
  assertionParser?: AssertionParser;
  /**
   * Env loader factory. Default (rootDir) => new EnvironmentLoader({ rootDir }).
   * Injectable so env validation is unit-tested without YAML on disk.
   */
  environmentLoaderFactory?: (rootDir: string) => EnvironmentLoader;
  /** Output logger. Required. */
  logger: Logger;
}

/** File suffix for endpoint files. */
const ENDPOINT_SUFFIX = ".endpoint.json";

/** File suffix for flow files (ignored in v1.0; multi-step flows are v1.5). */
const FLOW_SUFFIX = ".flow.json";

/** YAML suffixes that identify environment files. */
const YAML_SUFFIXES = [".yaml", ".yml"] as const;

/**
 * Matches `${env.NAME[.deeper]}` tokens. Capture group 1 = TOP-level
 * segment (everything before the first dot, or the whole tail if no
 * dot). v1.0 cross-checks only the top segment; nested-path checking
 * is deferred so we don't false-positive on legitimate deep accesses.
 */
const ENV_TOP_KEY_RE = /\$\{env\.([A-Za-z0-9_]+)(?:\.[A-Za-z0-9_]+)*\}/g;

/**
 * Matches `${secret.NAME}` tokens. Issue #73: endpoints must NOT
 * reference secrets directly — the runner only resolves `${secret.X}`
 * inside env YAML. An endpoint with `${secret.X}` silently sends the
 * literal token on the wire and the user gets 401 with no explanation.
 */
const SECRET_TOKEN_RE = /\$\{secret\.([A-Za-z0-9_]+)\}/g;

/**
 * Walks every string leaf in a parsed JSON tree and collects the
 * top-level env reference key from each `${env.X}` token. Pure;
 * mutates only the `into` accumulator.
 * @param node - The current tree node.
 * @param into - Accumulator set of referenced top-level keys.
 */
function collectEnvRefsInTree(node: unknown, into: Set<string>): void {
  if (typeof node === "string") {
    for (const m of node.matchAll(ENV_TOP_KEY_RE)) {
      into.add(String(m[1]));
    }
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) collectEnvRefsInTree(item, into);
    return;
  }
  if (typeof node === "object" && node !== null) {
    for (const v of Object.values(node)) collectEnvRefsInTree(v, into);
  }
}

/**
 * Walks every string leaf and collects `${secret.NAME}` references.
 * Issue #73 — used to fail validation when endpoints reference
 * secrets directly.
 * @param node - The current tree node.
 * @param into - Accumulator set of referenced secret names.
 */
function collectSecretRefsInTree(node: unknown, into: Set<string>): void {
  if (typeof node === "string") {
    for (const m of node.matchAll(SECRET_TOKEN_RE)) {
      into.add(String(m[1]));
    }
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) collectSecretRefsInTree(item, into);
    return;
  }
  if (typeof node === "object" && node !== null) {
    for (const v of Object.values(node)) collectSecretRefsInTree(v, into);
  }
}

/**
 * Builds the "known env keys" tail-string used in `${env.X}` undeclared
 * errors. When the walk found at least one declared key, prints the
 * sorted list. When the walk found none, appends a HINT that explains
 * the most common cause (the user passed an endpoints subdirectory
 * instead of the project root containing both `endpoints/` and
 * `environments/`). v1.0.2 polish: the prior message just said
 * "(none declared)" with no actionable guidance, which is the gotcha
 * surfaced during the cross-platform install rehearsal.
 * @param known - The accumulated env-key set across walked YAMLs.
 * @returns A user-facing description of what was discovered.
 */
function describeKnownEnvKeys(known: ReadonlySet<string>): string {
  if (known.size > 0) return [...known].sort().join(", ");
  return (
    "(none declared — if you passed an endpoints subdirectory," +
    " try `apiwright validate .` from the project root containing both" +
    " endpoints/ and environments/)"
  );
}

/**
 * Same shape as {@link describeKnownEnvKeys} but for the
 * `auth_strategies` cross-check. Returns the hint when zero env YAMLs
 * declared any strategy.
 * @param known - The accumulated auth-strategy-name set.
 * @returns A user-facing description of what was discovered.
 */
function describeKnownAuthStrategies(known: ReadonlySet<string>): string {
  if (known.size > 0) return [...known].sort().join(", ");
  return (
    "(none declared — if you passed an endpoints subdirectory," +
    " try `apiwright validate .` from the project root containing both" +
    " endpoints/ and environments/)"
  );
}

/**
 * Validates every endpoint/environment file under a directory.
 *
 * Algorithm:
 * 1. dirExists false → throw ConfigError (USAGE).
 * 2. walk → classify by suffix.
 * 3. Zero validatable files → throw ConfigError (USAGE).
 * 4. Validate endpoints via SchemaValidator.
 * 5. Validate env YAMLs via EnvironmentLoader factory.
 * 6. Emit per-file log lines + summary. Return ValidateSummary.
 */
export class ValidateCommand {
  readonly #fs: FileSystem;
  readonly #schemaValidator: SchemaValidator;
  readonly #assertionParser: AssertionParser;
  readonly #envLoaderFactory: (rootDir: string) => EnvironmentLoader;
  readonly #logger: Logger;

  /**
   * Creates a ValidateCommand with injectable collaborators.
   * @param options - Injectable collaborators (fs, validators, logger).
   */
  constructor(options: ValidateCommandOptions) {
    this.#fs = options.fs ?? new NodeFileSystem();
    this.#schemaValidator = options.schemaValidator ?? new SchemaValidator();
    this.#assertionParser =
      options.assertionParser ?? new AssertionParser();
    this.#envLoaderFactory =
      options.environmentLoaderFactory ??
      ((rootDir: string) => new EnvironmentLoader({ rootDir }));
    this.#logger = options.logger;
  }

  /**
   * Validates every endpoint/env file under `dir`.
   *
   * Returns the summary; the caller maps a non-zero failedCount to
   * ValidationFailedError.
   * @param dir - Directory to validate recursively.
   * @returns Validation summary with per-file results and counts.
   * @throws ConfigError when the directory is missing or has no validatable files.
   */
  run(dir: string): ValidateSummary {
    if (!this.#fs.dirExists(dir)) {
      throw new ConfigError(`directory not found: ${dir}`);
    }

    const { endpointFiles, envFiles } = this.#classifyFiles(dir);

    if (endpointFiles.length === 0 && envFiles.length === 0) {
      throw new ConfigError(`no validatable files found under ${dir}`);
    }

    // Issue #57: env files present but zero endpoint files almost always
    // indicates a glob mistake or missing CI checkout — `apiwright run`
    // against the same directory would produce zero tests, which the user
    // would discover only at runtime. Fail fast with a hint pointing at
    // the likely cause.
    if (endpointFiles.length === 0) {
      throw new ConfigError(
        `no endpoint files (*.endpoint.json) found under ${dir}` +
          ` (found ${envFiles.length} environment file(s) but zero` +
          ` endpoints — check your tests_dir / glob, or remove the` +
          ` environments and re-run from a different root)`,
      );
    }

    // Issue #69: collect the union of auth strategy names declared across
    // every env YAML so #validateEndpointFile can verify endpoint refs.
    const knownAuthStrategies = this.#collectAuthStrategies(envFiles);
    // Issue #71: same idea for `${env.X}` references — collect the union
    // of declared top-level keys across all env YAMLs so endpoints with
    // `${env.SOMETHING_MISSING}` in url/headers/body fail at validate
    // time instead of as an opaque 404 at run time.
    const knownEnvKeys = this.#collectEnvKeys(envFiles);

    const results: FileValidationResult[] = [
      ...endpointFiles.map((f) =>
        this.#validateEndpointFile(f, knownAuthStrategies, knownEnvKeys),
      ),
      ...envFiles.map((f) => this.#validateEnvFile(f)),
    ];

    this.#logResults(results);

    const passedCount = results.filter((r) => r.passed).length;
    const failedCount = results.length - passedCount;
    this.#logSummary(results, passedCount, failedCount);

    return { results, passedCount, failedCount };
  }

  /**
   * Emits the final summary line. On success: "Validated N endpoint
   * file(s) and M environment file(s) — OK". On failure: same counts
   * with "K failed" suffix. Visible by default so the user can confirm
   * what was checked (issue #56 — silent success regression guard).
   * @param results - All per-file results.
   * @param passedCount - Count of files that passed.
   * @param failedCount - Count of files that failed.
   */
  #logSummary(
    results: FileValidationResult[],
    passedCount: number,
    failedCount: number,
  ): void {
    const endpointCount = results.filter((r) => r.kind === "endpoint").length;
    const envCount = results.filter((r) => r.kind === "environment").length;
    const head =
      `Validated ${endpointCount} endpoint file(s)` +
      ` and ${envCount} environment file(s)`;
    if (failedCount === 0) {
      this.#logger.info(`${head} — OK`);
      return;
    }
    this.#logger.info(
      `${head} — ${passedCount} passed, ${failedCount} failed`,
    );
  }

  /**
   * Classifies files under `dir` into endpoint and environment file lists.
   * @param dir - Root directory to walk.
   * @returns Classified endpoint and environment file path lists.
   */
  #classifyFiles(dir: string): { endpointFiles: string[]; envFiles: string[] } {
    const allFiles = this.#fs.walk(dir);
    const endpointFiles: string[] = [];
    const envFiles: string[] = [];

    for (const file of allFiles) {
      if (file.endsWith(ENDPOINT_SUFFIX)) {
        endpointFiles.push(file);
      } else if (file.endsWith(FLOW_SUFFIX)) {
        this.#logger.info(`ignoring flow file (reserved for v1.5): ${file}`);
      } else if (YAML_SUFFIXES.some((s) => file.endsWith(s))) {
        envFiles.push(file);
      }
      // all other files ignored silently
    }

    return { endpointFiles, envFiles };
  }

  /**
   * Logs per-file PASS/FAIL results with error details for failures.
   * @param results - The file validation results to log.
   */
  #logResults(results: FileValidationResult[]): void {
    for (const r of results) {
      if (r.passed) {
        this.#logger.info(`PASS ${r.path}`);
      } else {
        this.#logger.error(`FAIL ${r.path}`);
        for (const e of r.errors) {
          this.#logger.error(`  ${e}`);
        }
      }
    }
  }

  /**
   * Validates one endpoint JSON file.
   * JSON parse errors and schema violations become failed results (no throw).
   * @param file - Absolute path to the .endpoint.json file.
   * @returns A FileValidationResult.
   */
  /**
   * Loads every env YAML and returns the union of declared
   * `auth_strategies` names. Issue #69: used to cross-check endpoint
   * `auth_strategy` refs at validate-time so the user fails fast
   * instead of seeing per-test "Unknown auth strategy" at run-time.
   * Failed env loads are silently skipped here (their own
   * #validateEnvFile call still surfaces the loader errors).
   * @param envFiles - The discovered environment YAML files.
   * @returns A set of strategy names seen across all envs (may be empty).
   */
  #collectAuthStrategies(envFiles: readonly string[]): ReadonlySet<string> {
    const names = new Set<string>();
    for (const file of envFiles) {
      const { rootDir, name } = this.#deriveLoaderArgs(file);
      const loader = this.#envLoaderFactory(rootDir);
      const result = loader.load(name);
      const strategies = result.environment?.auth_strategies;
      if (strategies === undefined) continue;
      for (const key of Object.keys(strategies)) {
        names.add(key);
      }
    }
    return names;
  }

  /**
   * Issue #71: Loads every env YAML and returns the union of declared
   * TOP-LEVEL keys (everything endpoints can reference via `${env.X}`).
   * v1.0 scope is top-level only; nested-path validation (`${env.db.host}`)
   * is deferred — runtime resolver still catches those. Reserved keys
   * (`environments`, the spec's deep-merge map) are excluded from the set
   * because they're not user-facing namespaces.
   * @param envFiles - The discovered environment YAML files.
   * @returns A set of top-level env keys seen across all envs.
   */
  #collectEnvKeys(envFiles: readonly string[]): ReadonlySet<string> {
    const keys = new Set<string>();
    for (const file of envFiles) {
      const { rootDir, name } = this.#deriveLoaderArgs(file);
      const loader = this.#envLoaderFactory(rootDir);
      const result = loader.load(name);
      const env = result.environment;
      if (env === undefined) continue;
      for (const key of Object.keys(env)) {
        // `environments` is the per-env override-merge map per spec §7;
        // not a user-facing namespace, so skip it.
        if (key === "environments") continue;
        keys.add(key);
      }
    }
    return keys;
  }

  #validateEndpointFile(
    file: string,
    knownAuthStrategies: ReadonlySet<string>,
    knownEnvKeys: ReadonlySet<string>,
  ): FileValidationResult {
    let raw: string;
    try {
      raw = this.#fs.readFile(file);
    } catch {
      return {
        path: file,
        kind: "endpoint",
        passed: false,
        errors: [`cannot read ${file}`],
      };
    }

    const parsed = parseJson(raw);
    if (!parsed.ok) {
      return {
        path: file,
        kind: "endpoint",
        passed: false,
        errors: [`${file} is not valid JSON: ${parsed.error}`],
      };
    }

    const result = this.#schemaValidator.validateEndpoint(parsed.value);
    if (!result.valid) {
      return {
        path: file,
        kind: "endpoint",
        passed: false,
        errors: result.errors ?? [],
      };
    }

    // Issue #65: schema-validated endpoint may STILL have unparseable
    // assertion strings (`AssertionParser` lives in src/assertions/ and
    // is invoked at `apiwright run` startup). Validate must catch these
    // here so the two commands agree on the contract.
    const assertionErrors = this.#parseAssertions(parsed.value);
    // Issue #69: cross-check that auth_strategy (if declared) refers to
    // a strategy that exists in at least one env YAML's auth_strategies
    // block. Otherwise the runner would fail every test case at run-time
    // with "Unknown auth strategy 'X'".
    const authErrors = this.#checkAuthStrategyRef(
      parsed.value,
      knownAuthStrategies,
    );
    // Issue #71: cross-check every `${env.X}` reference in url / headers /
    // body / queries. Missing refs are the spec's "fail at startup with
    // explicit error listing which references failed" — currently fall
    // through to runtime as opaque server errors (404, etc.).
    const envRefErrors = this.#checkEnvRefs(parsed.value, knownEnvKeys);
    // Issue #73: endpoints must NOT reference secrets directly. The
    // runner only resolves `${secret.X}` inside env YAML; an endpoint
    // with `${secret.X}` silently sends the literal token on the wire.
    const secretRefErrors = this.#checkNoSecretRefs(parsed.value);
    const errors = [
      ...assertionErrors,
      ...authErrors,
      ...envRefErrors,
      ...secretRefErrors,
    ];
    if (errors.length > 0) {
      return { path: file, kind: "endpoint", passed: false, errors };
    }

    return { path: file, kind: "endpoint", passed: true, errors: [] };
  }

  /**
   * Issue #71: Walks every string value in the parsed endpoint and
   * extracts `${env.X}` references (top-level keys only — `${env.X.Y}`
   * matches X). For each, fails iff X is not in the known-env-keys set.
   * Aggregates all missing refs into one message per file.
   * @param endpoint - The parsed endpoint JSON (any shape — guarded).
   * @param known - Union of top-level env keys across all env YAMLs.
   * @returns Error messages; empty when every ref resolves.
   */
  /**
   * Issue #73: Endpoints must NOT reference secrets directly via
   * `${secret.X}`. The runner only resolves `${secret.X}` inside env
   * YAML; an endpoint that uses `${secret.X}` silently sends the
   * literal token on the wire. Fail at validate with a pointer to the
   * correct pattern (declare in env YAML, reference via `${env.X}`).
   * @param endpoint - The parsed endpoint JSON (any shape — guarded).
   * @returns One error per secret name referenced; empty when none.
   */
  #checkNoSecretRefs(endpoint: unknown): string[] {
    const refs = new Set<string>();
    collectSecretRefsInTree(endpoint, refs);
    if (refs.size === 0) return [];
    const sorted = [...refs].sort();
    return sorted.map(
      (name) =>
        `\${secret.${name}} cannot be referenced from an endpoint file.` +
        ` Declare the secret in your env YAML's auth_strategies / databases` +
        ` block and reference the resolved value via \${env.X} here.`,
    );
  }

  #checkEnvRefs(endpoint: unknown, known: ReadonlySet<string>): string[] {
    const refs = new Set<string>();
    collectEnvRefsInTree(endpoint, refs);
    const missing = [...refs].filter((r) => !known.has(r)).sort();
    if (missing.length === 0) return [];
    const list = describeKnownEnvKeys(known);
    return missing.map(
      (ref) =>
        `\${env.${ref}} is not declared in any environment YAML.` +
        ` Declared env keys across all environments: ${list}.`,
    );
  }

  /**
   * Issue #69: returns an error iff the endpoint references an
   * `auth_strategy` name that is NOT declared in any env YAML's
   * `auth_strategies:` block. Empty array otherwise (no auth_strategy
   * declared, OR ref exists).
   * @param endpoint - The parsed endpoint JSON (any shape — guarded).
   * @param known - Union of strategy names across all env YAMLs.
   * @returns Error messages; empty when the ref resolves cleanly.
   */
  #checkAuthStrategyRef(
    endpoint: unknown,
    known: ReadonlySet<string>,
  ): string[] {
    if (typeof endpoint !== "object" || endpoint === null) return [];
    const ref = (endpoint as { auth_strategy?: unknown }).auth_strategy;
    if (typeof ref !== "string" || ref.length === 0) return [];
    if (known.has(ref)) return [];
    const list = describeKnownAuthStrategies(known);
    return [
      `auth_strategy '${ref}' is not declared in any environment YAML's` +
        ` auth_strategies block. Known across all environments: ${list}.`,
    ];
  }

  /**
   * Parses every assertion string in the endpoint's `assertions` array.
   * Returns one error line per failed assertion (prefixed with the
   * assertion's 1-based index so multi-assertion endpoints stay
   * traceable). Empty array (no assertions, or all parsed cleanly)
   * means the file is valid from §4's perspective.
   * @param endpoint - The parsed endpoint JSON (any shape — guarded).
   * @returns Error messages; empty when the assertions array parses cleanly.
   */
  #parseAssertions(endpoint: unknown): string[] {
    if (typeof endpoint !== "object" || endpoint === null) return [];
    const assertions = (endpoint as { assertions?: unknown }).assertions;
    if (!Array.isArray(assertions)) return [];
    const errors: string[] = [];
    const items = assertions as unknown[];
    for (let i = 0; i < items.length; i++) {
      const raw: unknown = items[i];
      if (typeof raw !== "string") {
        errors.push(`assertion #${i + 1}: expected a string, got ${typeof raw}`);
        continue;
      }
      const parseResult = this.#assertionParser.parse(raw);
      if (!parseResult.ok) {
        for (const e of parseResult.errors) {
          errors.push(`assertion #${i + 1}: ${e}`);
        }
      }
    }
    return errors;
  }

  /**
   * Validates one environment YAML file via EnvironmentLoader.
   * Loader failures become failed results (no throw).
   * @param file - Absolute path to the .yaml/.yml file.
   * @returns A FileValidationResult.
   */
  #validateEnvFile(file: string): FileValidationResult {
    const { rootDir, name } = this.#deriveLoaderArgs(file);
    const loader = this.#envLoaderFactory(rootDir);
    const result = loader.load(name);
    if (result.valid) {
      return { path: file, kind: "environment", passed: true, errors: [] };
    }
    return {
      path: file,
      kind: "environment",
      passed: false,
      errors: result.errors ?? ["unknown error"],
    };
  }

  /**
   * Reconstructs the `(rootDir, name)` pair an {@link EnvironmentLoader}
   * needs so that one of its derived candidate paths
   * (`<rootDir>/.env.<name>.yaml` or `<rootDir>/environments/<name>.yaml`,
   * see src/env/loader.ts) resolves back to this discovered file.
   *
   * Handles the two file layouts the spec defines (§7):
   * - Committed form `<root>/environments/<name>.yaml`
   *   → rootDir=`<root>`, name=`<name>` (loader's dirPath hits it).
   * - Dotfile form `<dir>/.env.<name>.yaml`
   *   → rootDir=`<dir>`, name=`<name>` (loader's dotPath hits it).
   * - Any other YAML → rootDir=`dirname(file)`, name=`<base sans ext>`;
   *   the loader then reports a clear "not found" listing both tried paths.
   * @param file - Absolute path to the discovered .yaml/.yml file.
   * @returns The rootDir and environment name for the loader.
   */
  #deriveLoaderArgs(file: string): { rootDir: string; name: string } {
    const base = basename(file);
    const parent = dirname(file);
    const stripped = this.#stripYamlExt(base);

    const dotName = /^\.env\.(.+)$/.exec(stripped)?.[1];
    if (dotName !== undefined) {
      return { rootDir: parent, name: dotName };
    }

    if (basename(parent) === "environments") {
      return { rootDir: dirname(parent), name: stripped };
    }

    return { rootDir: parent, name: stripped };
  }

  /**
   * Strips a trailing `.yaml`/`.yml` extension from a filename.
   * @param base - The file basename.
   * @returns The basename without its YAML extension.
   */
  #stripYamlExt(base: string): string {
    for (const suffix of YAML_SUFFIXES) {
      if (base.endsWith(suffix)) {
        return base.slice(0, -suffix.length);
      }
    }
    /* istanbul ignore next — only called for .yaml/.yml files; unreachable otherwise */
    return base;
  }
}
