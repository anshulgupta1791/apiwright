/**
 * RunCommand — orchestrates config load, flag resolution, env load, prod-safety
 * gate, and TestRunner delegation for the `apiwright run` command.
 *
 * Never calls process.exit; throws typed CliError subclasses for all failure
 * modes so the top-level error handler maps them to exit codes.
 */

import { dirname, resolve } from "node:path";

import { EnvironmentLoader } from "../../env/loader.js";
import { ConfigLoader } from "../config/loader.js";
import { resolveEffectiveSettings } from "../config/resolve-effective.js";
import type { CliFlags, LogLevel } from "../config/types.js";
import { ConfigError, ProdSafetyAbortError, RunFailedError } from "../errors.js";
import type { Logger } from "../logging/logger.js";
import { ProdSafetyGate } from "../prod-safety.js";
import type { TestRunner } from "../seams/test-runner.js";
import { NotImplementedTestRunner } from "../seams/test-runner.js";

/** Options accepted by {@link RunCommand}. */
export interface RunCommandOptions {
  /**
   * Config loader factory. Called with the optional `--config` path so each
   * invocation honours the per-run config override. Required.
   */
  configLoaderFactory: (configPath?: string) => ConfigLoader;
  /** Prod safety gate seam. Required. */
  prodSafetyGate: ProdSafetyGate;
  /**
   * Environment loader factory. Default: real EnvironmentLoader factory.
   * Receives `rootDir` (the directory that *contains* `environments/`) so the
   * EnvironmentLoader finds `<rootDir>/environments/<name>.yaml`.
   */
  environmentLoaderFactory?: (
    rootDir: string,
    env?: NodeJS.ProcessEnv,
  ) => EnvironmentLoader;
  /** TestRunner seam. Default NotImplementedTestRunner. */
  testRunner?: TestRunner;
  /**
   * Logger factory. Required. Forwarded to the TestRunner seam via
   * EffectiveSettings; the runner owns its own logging (Task #10).
   */
  loggerFactory: (lvl: LogLevel) => Logger;
}

/**
 * Orchestrates the `apiwright run` command pipeline.
 *
 * Steps:
 * 1. Build ConfigLoader from factory (honouring --config path), then load config.
 * 2. Resolve effective settings from flags.
 * 3. Load the environment via EnvironmentLoader.
 *    rootDir is computed as dirname(resolve(config.environments_dir)) so the
 *    loader's appended `environments/` segment lands on the configured dir
 *    (e.g. environments_dir="./environments" → rootDir="." →
 *    loader finds "./environments/qa.yaml").
 * 4. Evaluate prod safety gate.
 * 5. Delegate to TestRunner seam.
 *    The TestRunner owns its own logging; logLevel is forwarded via settings.
 */
export class RunCommand {
  readonly #configLoaderFactory: (configPath?: string) => ConfigLoader;
  readonly #prodSafetyGate: ProdSafetyGate;
  readonly #envLoaderFactory: (
    rootDir: string,
    env?: NodeJS.ProcessEnv,
  ) => EnvironmentLoader;
  readonly #testRunner: TestRunner;

  /**
   * Creates a RunCommand with injectable collaborators.
   * @param options - Injectable collaborators.
   */
  constructor(options: RunCommandOptions) {
    this.#configLoaderFactory = options.configLoaderFactory;
    this.#prodSafetyGate = options.prodSafetyGate;
    this.#envLoaderFactory =
      options.environmentLoaderFactory ??
      ((rootDir: string, env?: NodeJS.ProcessEnv) =>
        new EnvironmentLoader(
          env !== undefined ? { rootDir, env } : { rootDir },
        ));
    this.#testRunner = options.testRunner ?? new NotImplementedTestRunner();
  }

  /**
   * Executes the run pipeline for the given CLI flags.
   * @param flags - CLI flag values for this invocation.
   * @throws ConfigError when config or flag resolution fails.
   * @throws ConfigError when environment loading fails.
   * @throws ProdSafetyAbortError when the gate declines.
   * @throws NotImplementedError when the TestRunner seam is the default.
   * @throws RunFailedError when the runner completes but `summary.failed > 0`.
   *   Thrown AFTER the runner finishes (and has emitted all reports) so the
   *   artifacts remain on disk even when the process exits non-zero. This is
   *   the canonical "CI red" signal — matches pytest/vitest exit-1 convention.
   */
  async execute(flags: CliFlags): Promise<void> {
    // Step 1: build the loader for this invocation (honours --config path),
    // then load config.
    const configLoader = this.#configLoaderFactory(flags.config);
    const configResult = configLoader.load();
    if (!configResult.valid || !configResult.config) {
      throw new ConfigError(
        (configResult.errors ?? ["config load failed"]).join("; "),
      );
    }
    const config = configResult.config;

    // Step 2: resolve effective settings
    const resolveResult = resolveEffectiveSettings(config, flags);
    if (!resolveResult.ok) {
      throw new ConfigError(resolveResult.errors.join("; "));
    }
    const settings = resolveResult.settings;

    // Step 3: load environment.
    // rootDir must be the directory *containing* the environments/ dir so the
    // EnvironmentLoader's own path logic (`<rootDir>/environments/<name>.yaml`)
    // resolves correctly. With environments_dir="./environments", dirname gives
    // "." and the loader finds "./environments/qa.yaml" as expected.
    const rootDir = dirname(resolve(config.environments_dir));
    const envLoader = this.#envLoaderFactory(rootDir);
    const envResult = envLoader.load(settings.env);
    if (!envResult.valid || !envResult.environment) {
      throw new ConfigError(
        (envResult.errors ?? ["environment load failed"]).join("; "),
      );
    }
    const environment = envResult.environment;

    // Step 4: prod safety gate (only evaluated for prod environments)
    if (environment.prod) {
      const gateDecision = await this.#prodSafetyGate.evaluate({
        prodEnvironment: environment.prod,
        markers: settings.markers,
        allowNonSmokeInProd: settings.allowNonSmokeInProd,
      });

      if (!gateDecision.allowed) {
        throw new ProdSafetyAbortError(gateDecision.reason);
      }
    }

    // Step 5: delegate to TestRunner seam.
    // The TestRunner seam receives logLevel via settings and owns its own
    // logging (Task #10); no separate logger is created here.
    const outcome = await this.#testRunner.run({
      env: settings.env,
      environment,
      markers: settings.markers,
      logLevel: settings.logLevel,
      settings,
    });

    // Step 6: propagate test failures via exit code.
    // The runner has already emitted every report; we now translate the
    // outcome counts into the documented exit-code contract. Throwing
    // RunFailedError routes through the existing handleCliError pipeline so
    // the process exits with ExitCode.TEST_FAILURE (1) — matching the
    // pytest/vitest/mocha convention CI tooling expects.
    failIfAnyTestsFailed(outcome);
  }
}

/**
 * Throws {@link RunFailedError} iff the run outcome recorded any failed test
 * after retries. Pure helper extracted from `RunCommand.execute` so the
 * orchestrator stays under the complexity gate.
 * @param outcome - The {@link TestRunOutcome} returned by the test runner.
 * @param outcome.total - Total planned tests.
 * @param outcome.passed - Tests that passed.
 * @param outcome.failed - Tests that failed after retries.
 * @param outcome.flaky - Tests that passed only after retry.
 * @throws RunFailedError when `outcome.failed > 0`.
 */
function failIfAnyTestsFailed(outcome: {
  total: number;
  passed: number;
  failed: number;
  flaky: number;
}): void {
  if (outcome.failed <= 0) return;
  throw new RunFailedError(
    `Run had ${outcome.failed} failure(s) of ${outcome.total} planned ` +
      `test(s) (passed=${outcome.passed}, flaky=${outcome.flaky}). ` +
      "See the run report for details.",
  );
}
