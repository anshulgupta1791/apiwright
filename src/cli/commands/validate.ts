/**
 * ValidateCommand — validates endpoint JSON and environment YAML files.
 *
 * Discovers files via the FileSystem seam, delegates endpoint validation to
 * SchemaValidator (src/core) and env validation to EnvironmentLoader (src/env).
 * Never imports from src/importers, src/runner, or src/docs-generator.
 */

import { dirname, basename } from "node:path";

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
  readonly #envLoaderFactory: (rootDir: string) => EnvironmentLoader;
  readonly #logger: Logger;

  /**
   * Creates a ValidateCommand with injectable collaborators.
   * @param options - Injectable collaborators (fs, validators, logger).
   */
  constructor(options: ValidateCommandOptions) {
    this.#fs = options.fs ?? new NodeFileSystem();
    this.#schemaValidator = options.schemaValidator ?? new SchemaValidator();
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

    const results: FileValidationResult[] = [
      ...endpointFiles.map((f) => this.#validateEndpointFile(f)),
      ...envFiles.map((f) => this.#validateEnvFile(f)),
    ];

    this.#logResults(results);

    const passedCount = results.filter((r) => r.passed).length;
    const failedCount = results.length - passedCount;

    this.#logger.info(
      `validated ${results.length} files: ${passedCount} passed, ${failedCount} failed`,
    );

    return { results, passedCount, failedCount };
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
  #validateEndpointFile(file: string): FileValidationResult {
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
    if (result.valid) {
      return { path: file, kind: "endpoint", passed: true, errors: [] };
    }
    return {
      path: file,
      kind: "endpoint",
      passed: false,
      errors: result.errors ?? [],
    };
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
