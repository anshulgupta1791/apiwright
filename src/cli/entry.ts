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

import { createRequire } from "node:module";

import { Command } from "commander";
import { config as loadDotenvFile } from "dotenv";

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
import { NotImplementedDocsGenerator } from "./seams/docs-generator.js";
import type { Importer } from "./seams/importer.js";
import { NotImplementedTestRunner } from "./seams/test-runner.js";

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
  /** TestRunner seam (default: NotImplementedTestRunner). */
  testRunner: InstanceType<typeof NotImplementedTestRunner>;
  /** Importer seam (default: CompositePostmanImporter). */
  importer: Importer;
  /** DocsGenerator seam (default: NotImplementedDocsGenerator). */
  docsGenerator: InstanceType<typeof NotImplementedDocsGenerator>;
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
    testRunner: new NotImplementedTestRunner(),
    importer: new CompositePostmanImporter(),
    docsGenerator: new NotImplementedDocsGenerator(),
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
    .option("--log <level>", "Log level (error,warn,info,debug)")
    .option("--workers <n>", "Worker count")
    .option("--retries <n>", "Retry count (0-5)")
    .option("--allow-non-smoke-in-prod", "Allow non-smoke tests in prod")
    .option("--config <path>", "Path to apiwright.config.json")
    .action(async (opts: Record<string, unknown>) => {
      const logger = resolved.loggerFactory("warn");
      const flags: import("./config/types.js").CliFlags = {
        allowNonSmokeInProd: opts["allowNonSmokeInProd"] === true,
        ...(typeof opts["env"] === "string" && { env: opts["env"] }),
        ...(typeof opts["markers"] === "string" && {
          markers: opts["markers"],
        }),
        ...(typeof opts["log"] === "string" && { log: opts["log"] }),
        ...(typeof opts["workers"] === "string" && {
          workers: opts["workers"],
        }),
        ...(typeof opts["retries"] === "string" && {
          retries: opts["retries"],
        }),
        ...(typeof opts["config"] === "string" && { config: opts["config"] }),
      };
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
