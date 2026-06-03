/**
 * Real `TestRunner` implementation that wires the CLI to the §9 runner.
 *
 * Replaces the {@link NotImplementedTestRunner} placeholder from Task #3.
 * Builds a {@link RunnerConfig} from the resolved `EffectiveSettings`,
 * invokes {@link runOnce}, and aggregates the result into a
 * {@link TestRunOutcome} for CLI consumption.
 */

import { SecretRegistry } from "../../env/index.js";
import { emitRunReport, reportRunToConsole } from "../../reporting/index.js";
import { runOnce } from "../../runner/index.js";
import type { RunFilters, ShardSpec } from "../../runner/index.js";
import { createLogger } from "../logging/logger.js";

import type { TestRunInput, TestRunOutcome, TestRunner } from "./test-runner.js";

/**
 * Default workers (single-worker v1.0; --workers flag is honored but
 *  multi-worker is deferred to Task 11+).
 */
const DEFAULT_WORKERS = 1;

/**
 * The real CLI test runner. Composes the {@link runOnce} entry point.
 */
export class RealTestRunner implements TestRunner {
  /**
   * Builds the {@link RunnerConfig} from the CLI's EffectiveSettings and
   * invokes the §9 runner.
   * @param input - Run parameters from the CLI.
   * @returns A {@link TestRunOutcome} aggregating endpoints.
   */
  async run(input: TestRunInput): Promise<TestRunOutcome> {
    const env = input.environment;
    if (!env) {
      throw new Error("RealTestRunner: environment was not loaded by the CLI.");
    }

    // §9 filters: markers from input + path/tag/endpoint/excludeTags resolved
    // onto settings (the runner's applyFilters already honors all of them).
    const s = input.settings;
    const filters: RunFilters = {
      markers: input.markers,
      ...(s.path !== undefined ? { path: s.path } : {}),
      ...(s.tag !== undefined ? { tag: s.tag } : {}),
      ...(s.endpoint !== undefined ? { endpoint: s.endpoint } : {}),
      ...(s.excludeTags !== undefined ? { excludeTags: s.excludeTags } : {}),
    };
    // Issue #75 §9 line 638: thread the user's --shard N/M through.
    // resolveEffectiveSettings already validated the shape; null means
    // no sharding (run the full plan).
    const shard: ShardSpec | null = s.shard
      ? { index: s.shard.index, total: s.shard.total }
      : null;

    const secrets = new SecretRegistry();
    const result = await runOnce({
      testsDir: input.settings.config.tests_dir,
      reportsDir: input.settings.config.reports_dir,
      env,
      secrets,
      filters,
      shard,
      /* istanbul ignore next — CLI resolver always supplies workers; default is fallback. */
      workers: input.settings.workers ?? DEFAULT_WORKERS,
      // v1.0 known-issue fix: forward the FULL retry policy (count + delay_ms +
      // backoff + strict) from config.retry, not just the count. Prior to fix
      // only count reached the executor; delay_ms / backoff were silently
      // dropped (a no-effect-flag ship-bar violation). The runner's
      // resolveRetryPolicy() layers: DEFAULT ← globalRetryPolicy ← endpoint
      // override ← cliRetryOverride.
      globalRetryPolicy: input.settings.globalRetryPolicy,
      // cliRetryOverride is now ONLY set when the user passed `--retries N`
      // (prior to fix: config count was forwarded here, so per-endpoint
      // `retry: {count: 0}` always lost). With the fix, per-endpoint
      // overrides win when no CLI flag is present.
      ...(input.settings.cliRetryOverride !== undefined
        ? { cliRetryOverride: input.settings.cliRetryOverride }
        : {}),
      // §10 Reporting layer owns the emission boundary.
      skipBuiltInEmit: true,
      // Forward case_generation.skip_globally from config (backward-compat:
      // defaults to [] when the field is absent from config).
      skipGlobally: input.settings.config.case_generation?.skip_globally ?? [],
    });

    // §10 Reporting — file artifacts.
    const reportCfg = input.settings.config.report;
    await emitRunReport(
      result,
      {
        reportsDir: input.settings.config.reports_dir,
        targets: {
          html: reportCfg.html,
          json: reportCfg.json,
          junit_xml: reportCfg.junit_xml,
        },
      },
      secrets,
    );

    // §10 Reporting — console output filtered by --log level.
    const logger = createLogger(input.settings.logLevel);
    reportRunToConsole(result, logger, secrets);

    return {
      total: result.summary.endpoints_planned,
      passed: result.summary.passed,
      failed: result.summary.failed,
      flaky: result.summary.flaky,
    };
  }
}
