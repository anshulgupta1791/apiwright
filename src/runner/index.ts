/**
 * Public barrel for the §9 Test Runner (Task #10). Single entry point —
 * consumers (the CLI `apiwright run` command, eventually §10 Reporting) MUST
 * import from this barrel, never from deep `src/runner/**` paths.
 *
 * Internal classes (executor, walker, planner, etc.) are not re-exported.
 * The barrel surfaces only: the top-level `runOnce` entry point, the
 * `RunnerConfig` / `RunResult` / supporting types, the error taxonomy.
 *
 * DEFERRED to Task 11+: true worker-pool parallelization. The v1.0 runner
 * is single-worker (sequential); the `workers` config field is captured
 * into the RunResult for downstream tools but does not affect execution.
 * The §10 Reporting layer (Task 11) builds the HTML + JUnit XML formats
 * on top of the JSON RunResult emitted here.
 */

export { runOnce } from "./runner.js";
export type { RunnerConfig } from "./runner.js";

export {
  RUNNER_ERROR_CODES,
  RunnerError,
  isRunnerError,
} from "./errors.js";
export type { RunnerErrorCode, RunnerErrorInit, RunnerPhase } from "./errors.js";

export type {
  AttemptResult,
  DbVerifyOutcomeRecord,
  EndpointLoadRecord,
  EndpointResult,
  FinalStatus,
  PlannedTestCase,
  RequestRecord,
  ResponseRecord,
  RunFilters,
  RunResult,
  RunSummary,
  TestPlanReport,
  Verdict,
} from "./types.js";

export type { ShardSpec } from "./filter/sharder.js";

export {
  DEFAULT_RETRY_POLICY,
  resolveRetryPolicy,
} from "./execute/retry-policy.js";
export type { ResolvedRetryPolicy } from "./execute/retry-policy.js";

export type { HttpClientSeam } from "./execute/http-client.js";
export { createDefaultHttpClient } from "./execute/http-client.js";
