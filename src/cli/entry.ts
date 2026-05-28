#!/usr/bin/env node
/**
 * CLI entry point — commander wiring and process.exit boundary.
 *
 * This is the ONLY file in src/cli that calls process.exit. Every other
 * module throws typed CliError subclasses; this file converts them to exit
 * codes via the injectable `exit` seam.
 *
 * Exported for testing: buildProgram() creates a commander program without
 * parsing; main() parses and dispatches.
 *
 * Coverage note: src/cli/entry.ts is excluded from coverage thresholds
 * per configs/vitest.config.ts. The one literal process.exit call is marked
 * `istanbul ignore next` with justification.
 *
 * Size note: this file exceeds the 300-line soft limit because every
 * commander subcommand registration must share the single resolved deps
 * object; factoring the registrations into separate files would require
 * threading that object across module boundaries, reintroducing the
 * coupling the single-entry pattern is designed to eliminate. It remains
 * well under the 500-line hard limit.
 */

import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { Command } from "commander";
import { config as loadDotenvFile } from "dotenv";

import { MarkdownDocsGenerator } from "../docs/index.js";
import { EnvironmentLoader } from "../env/loader.js";
import { SecretRegistry } from "../env/secrets.js";
import { CompositePostmanImporter } from "../importers/composite-importer.js";

import { DocsCommand } from "./commands/docs.js";
import { ImportCommand } from "./commands/import.js";
import { RunCommand } from "./commands/run.js";
import { ValidateCommand } from "./commands/validate.js";
import { ConfigLoader } from "./config/loader.js";
import type { LogLevel } from "./config/types.js";
import { handleCliError } from "./error-handler.js";
import { ConfigError, ValidationFailedError } from "./errors.js";
import { ExitCode } from "./exit-codes.js";
import type { Logger } from "./logging/logger.js";
import { createLogger } from "./logging/logger.js";
import { ProdSafetyGate } from "./prod-safety.js";
import type { DocsGenerator } from "./seams/docs-generator.js";
import type { Importer } from "./seams/importer.js";
import { RealTestRunner } from "./seams/real-test-runner.js";
import type { TestRunner } from "./seams/test-runner.js";

/** Read version from package.json via CJS require (not a dynamic import). */
const _require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports, no-restricted-syntax
const pkgJson = _require("../../package.json") as { version: string };
const PKG_VERSION = pkgJson.version;

/**
 * All injectable dependencies for the CLI entry point.
 *
 * Production defaults are applied in {@link buildProgram}. Tests inject fakes
 * to exercise every branch without real disk, network, or process.exit calls.
 */
export interface EntryDeps {
  /**
   * Config loader factory. Called with the optional `--config` path for each
   * invocation so the per-run override is honoured. Required.
   */
  configLoaderFactory: (configPath?: string) => ConfigLoader;
  /** Prod safety gate seam. */
  prodSafetyGate: ProdSafetyGate;
  /** TestRunner seam (default: RealTestRunner, the §9 runner from Task #10). */
  testRunner: TestRunner;
  /** Importer seam (default: CompositePostmanImporter). */
  importer: Importer;
  /** DocsGenerator seam (default: MarkdownDocsGenerator, the §11 generator). */
  docsGenerator: DocsGenerator;
  /** Logger factory (default: createLogger). */
  loggerFactory: (lvl: LogLevel) => Logger;
  /** Exit side-effect seam. Default process.exit. */
  exit: (code: ExitCode) => never;
  /** Environment variables for prod-safety gate. Default process.env. */
  env: NodeJS.ProcessEnv;
  /**
   * Env loader factory seam for RunCommand. Required. Production always
   * supplies the real factory via makeDefaultDeps so the real EnvironmentLoader
   * is used. Tests must supply a factory (real or fake) explicitly — a missing
   * factory is a wiring error, not silently bypassed.
   */
  environmentLoaderFactory: (
    rootDir: string,
    env: NodeJS.ProcessEnv,
  ) => EnvironmentLoader;
}

/**
 * Production defaults for EntryDeps.
 * @param env - The process environment (for prod-safety gate).
 * @returns A fully populated EntryDeps with production implementations.
 */
function makeDefaultDeps(env: NodeJS.ProcessEnv): EntryDeps {
  const prodSafetyGate = new ProdSafetyGate({ env });
  return {
    configLoaderFactory: (configPath?: string) =>
      configPath !== undefined
        ? new ConfigLoader({ configPath })
        : new ConfigLoader(),
    prodSafetyGate,
    testRunner: new RealTestRunner(),
    importer: new CompositePostmanImporter(),
    docsGenerator: new MarkdownDocsGenerator(),
    loggerFactory: (lvl: LogLevel) => createLogger(lvl),
    /* istanbul ignore next — process.exit terminates the worker;
       behavior covered via injected exit in unit tests. */
    exit: (code: ExitCode): never => process.exit(code),
    env,
    environmentLoaderFactory: (rootDir: string, procEnv: NodeJS.ProcessEnv) =>
      new EnvironmentLoader({ rootDir, env: procEnv }),
  };
}

/**
 * Builds a stub EnvironmentLoader factory for unit tests that exercise
 * the run pipeline without real YAML files. Import this from tests, not from
 * production code.
 *
 * The stub returns a minimal non-prod environment when the real load fails, so
 * tests can drive the pipeline to the TestRunner seam without disk setup.
 * @returns A stub factory suitable for test use only.
 */
export function buildTestStubEnvLoaderFactory(): (
  rootDir: string,
  procEnv: NodeJS.ProcessEnv,
) => EnvironmentLoader {
  return (rootDir: string, procEnv: NodeJS.ProcessEnv) => {
    const stubLoader = new EnvironmentLoader({ rootDir, env: procEnv });
    const originalLoad = stubLoader.load.bind(stubLoader);
    (stubLoader as unknown as Record<string, unknown>)["load"] = (
      name: string,
    ) => {
      const result = originalLoad(name);
      if (result.valid) {
        return result;
      }
      // File not found → return minimal non-prod stub so run reaches the seam
      return {
        valid: true as const,
        environment: {
          name,
          prod: false,
          base_url: "",
        } as unknown as import("../env/types.js").ResolvedEnvironment,
        secretRegistry: new SecretRegistry(),
      };
    };
    return stubLoader;
  };
}

/**
 * Builds the commander program (pure: no parse, no exit). Exported so tests
 * drive every command without spawning a process.
 * @param deps - Injectable dependencies (production defaults used when absent).
 * @returns The configured Commander program.
 */
export function buildProgram(deps?: EntryDeps): Command {
  const resolved = deps ?? makeDefaultDeps(process.env);

  const program = new Command();
  program
    .name("apiwright")
    .description("APIWright — declarative API testing")
    .version(PKG_VERSION)
    .exitOverride();

  // validate <dir>
  program
    .command("validate <dir>")
    .description("Validate endpoint JSON and environment YAML files")
    .action((dir: string) => {
      const logger = resolved.loggerFactory("warn");
      try {
        const cmd = new ValidateCommand({ logger });
        const summary = cmd.run(dir);
        if (summary.failedCount > 0) {
          throw new ValidationFailedError(
            `${summary.failedCount} file(s) failed validation`,
          );
        }
      } catch (e: unknown) {
        handleCliError(e, { logger, exit: resolved.exit });
      }
    });

  // run
  program
    .command("run")
    .description("Run API tests")
    .option("--env <name>", "Environment name")
    .option("--markers <csv>", "Test markers (smoke,regression,e2e,all)")
    .option("--path <dir>", "Only run endpoints under this directory subtree")
    .option("--tag <tag>", "Only run endpoints carrying this tag")
    .option("--endpoint <id>", "Run a single endpoint by its declared id")
    .option("--exclude-tag <csv>", "Exclude endpoints carrying any of these tags")
    .option("--log <level>", "Log level (error,warn,info,debug)")
    .option("--workers <n>", "Worker count")
    .option("--retries <n>", "Retry count (0-5)")
    .option("--allow-non-smoke-in-prod", "Allow non-smoke tests in prod")
    .option("--config <path>", "Path to apiwright.config.json")
    .action(async (opts: Record<string, unknown>) => {
      const logger = resolved.loggerFactory("warn");
      const flags = buildRunFlags(opts);
      try {
        const cmd = new RunCommand({
          configLoaderFactory: resolved.configLoaderFactory,
          prodSafetyGate: resolved.prodSafetyGate,
          testRunner: resolved.testRunner,
          loggerFactory: resolved.loggerFactory,
          environmentLoaderFactory: (rootDir: string) =>
            resolved.environmentLoaderFactory(rootDir, resolved.env),
        });
        await cmd.execute(flags);
      } catch (e: unknown) {
        handleCliError(e, { logger, exit: resolved.exit });
      }
    });

  // import postman <file>
  const importCmd = program
    .command("import")
    .description("Import tests from external formats");

  importCmd
    .command("postman <file>")
    .description("Import a Postman collection")
    .requiredOption("--output <dir>", "Output directory")
    .option("--config <path>", "Path to apiwright.config.json")
    .action(async (file: string, opts: Record<string, unknown>) => {
      const logger = resolved.loggerFactory("warn");
      try {
        const cmd = new ImportCommand({
          configLoaderFactory: resolved.configLoaderFactory,
          importer: resolved.importer,
          loggerFactory: resolved.loggerFactory,
        });
        await cmd.postman(file, {
          outputDir: opts["output"] as string,
          ...(typeof opts["config"] === "string" && {
            configPath: opts["config"],
          }),
        });
      } catch (e: unknown) {
        handleCliError(e, { logger, exit: resolved.exit });
      }
    });

  importCmd
    .command("openapi <source>")
    .description("Import an OpenAPI/Swagger spec")
    .requiredOption("--output <dir>", "Output directory")
    .option("--config <path>", "Path to apiwright.config.json")
    .action(async (source: string, opts: Record<string, unknown>) => {
      const logger = resolved.loggerFactory("warn");
      try {
        const cmd = new ImportCommand({
          configLoaderFactory: resolved.configLoaderFactory,
          importer: resolved.importer,
          loggerFactory: resolved.loggerFactory,
        });
        await cmd.openapi(source, {
          outputDir: opts["output"] as string,
          ...(typeof opts["config"] === "string" && {
            configPath: opts["config"],
          }),
        });
      } catch (e: unknown) {
        handleCliError(e, { logger, exit: resolved.exit });
      }
    });

  // docs generate
  const docsCmd = program.command("docs").description("Generate documentation");

  docsCmd
    .command("generate")
    .description("Generate per-endpoint Markdown")
    .requiredOption("--output <dir>", "Output directory")
    .option("--source <dir>", "Source directory (overrides config.tests_dir)")
    .option("--config <path>", "Path to apiwright.config.json")
    .action(async (opts: Record<string, unknown>) => {
      const logger = resolved.loggerFactory("warn");
      try {
        const cmd = new DocsCommand({
          configLoaderFactory: resolved.configLoaderFactory,
          docsGenerator: resolved.docsGenerator,
          loggerFactory: resolved.loggerFactory,
        });
        await cmd.generate({
          outputDir: opts["output"] as string,
          ...(typeof opts["source"] === "string" && {
            sourceDir: opts["source"],
          }),
          ...(typeof opts["config"] === "string" && {
            configPath: opts["config"],
          }),
        });
      } catch (e: unknown) {
        handleCliError(e, { logger, exit: resolved.exit });
      }
    });

  return program;
}

/**
 * Parses argv and dispatches; the single process.exit site.
 * @param argv - The process.argv array (first two elements are node + script).
 * @param deps - Injectable dependencies (production defaults used when absent).
 */
export async function main(argv: string[], deps?: EntryDeps): Promise<void> {
  // §8: load a local .env into process.env if present. No-op when absent;
  // never overrides already-set (CI-injected) vars. Local-dev convenience.
  loadDotenvFile();
  const resolved = deps ?? makeDefaultDeps(process.env);
  const program = buildProgram(resolved);
  const logger = resolved.loggerFactory("warn");

  try {
    await program.parseAsync(argv);
  } catch (e: unknown) {
    // commander throws CommanderError for exitOverride
    if (isCommanderError(e)) {
      if (e.exitCode === 0) {
        // --version / --help: success
        return;
      }
      handleCliError(new ConfigError(e.message), {
        logger,
        exit: resolved.exit,
      });
    } else {
      handleCliError(e, { logger, exit: resolved.exit });
    }
  }
}

/**
 * Builds the {@link CliFlags} object for the `run` command from commander's
 * parsed options. Only string-valued options are forwarded (commander gives
 * `true` for boolean flags and `undefined` for absent ones); the resolver
 * applies defaults and validates. Extracted from the action to keep that
 * callback under the complexity limit.
 * @param opts - Commander's parsed options bag for `run`.
 * @returns The CliFlags to pass to RunCommand.
 */
function buildRunFlags(opts: Record<string, unknown>): import("./config/types.js").CliFlags {
  const strFlag = (key: string): Record<string, string> =>
    typeof opts[key] === "string" ? { [key]: opts[key] } : {};
  return {
    allowNonSmokeInProd: opts["allowNonSmokeInProd"] === true,
    ...strFlag("env"),
    ...strFlag("markers"),
    ...strFlag("path"),
    ...strFlag("tag"),
    ...strFlag("endpoint"),
    ...strFlag("excludeTag"),
    ...strFlag("log"),
    ...strFlag("workers"),
    ...strFlag("retries"),
    ...strFlag("config"),
  };
}

/**
 * Type guard for commander's CommanderError.
 * @param err - The value to test.
 * @returns True when err has an exitCode number property (CommanderError shape).
 */
function isCommanderError(
  err: unknown,
): err is { exitCode: number; message: string } {
  return (
    typeof err === "object" &&
    err !== null &&
    "exitCode" in err &&
    typeof (err as Record<string, unknown>)["exitCode"] === "number"
  );
}

/**
 * Determines whether this module is being executed directly as the CLI
 * binary (vs. imported by tests). Compares the real path of `argv[1]`
 * (resolved through any npm `.bin` symlink) against this module's own
 * file path. Returns false — never throws — when `argv[1]` is absent or
 * cannot be resolved (e.g. under a test runner).
 * @returns True iff this file is the process entry point.
 */
function isDirectExecution(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return realpathSync(entry) === fileURLToPath(import.meta.url);
  } catch {
    /* istanbul ignore next — only hit when argv[1] is unresolvable (no such
       file); the import-by-test path returns false above via the mismatch. */
    return false;
  }
}

// Top-level bootstrap: invoke main() ONLY when run as the binary
// (`bin: { apiwright: "./dist/cli/entry.js" }`), never when imported by a
// test. main() owns the process.exit boundary, so a rejection here is
// already converted to an exit code inside main; the `.catch` is a
// last-resort guard against an unexpected throw before that boundary.
/* istanbul ignore next — the binary-execution branch cannot run under the
   in-process test runner (argv[1] is the vitest binary, not this module);
   exercised by the subprocess test in tests/integration/cli/. */
if (isDirectExecution()) {
  void main(process.argv).catch((err: unknown) => {
    process.stderr.write(`apiwright: fatal: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  });
}
