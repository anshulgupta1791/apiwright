/**
 * The top-level `Runner` — composes the §9 pipeline end-to-end. Discovery →
 * load → assertion-parse-at-startup → plan-gen → filter → shard → lifecycle
 * open → per-endpoint executor → aggregate → emit → lifecycle close.
 *
 * Discharges every obligation by composition (each step's discharge is
 * captured in the per-layer module).
 *
 * Worker parallelism: this runner is single-worker. The `--workers=N` flag
 * is honored by the CLI but the v1.0 executor is sequential — true
 * worker-pool parallelization is a Task 11+ follow-up (the executor is
 * already worker-isolated by design, since each worker would instantiate
 * its own registries and consume a shard slice).
 */

import { SchemaValidator } from "../core/index.js";
import type { ResolvedEnvironment, SecretRegistry } from "../env/index.js";

import { parseAllAssertions } from "./discovery/assertion-binder-wiring.js";
import { generateTestPlan } from "./discovery/plan-generator.js";
import { loadEndpointPlan } from "./discovery/plan-loader.js";
import { discoverEndpointFiles } from "./discovery/walker.js";
import { RUNNER_ERROR_CODES, RunnerError } from "./errors.js";
import { type ExecutorDeps, executeEndpoint } from "./execute/endpoint-executor.js";
import { type HttpClientSeam, createDefaultHttpClient } from "./execute/http-client.js";
import { closeLifecycle, openLifecycle } from "./execute/lifecycle.js";
import type { ResolvedRetryPolicy } from "./execute/retry-policy.js";
import { applyFilters } from "./filter/filter.js";
import { type ShardSpec, shardCases } from "./filter/sharder.js";
import { emitRunResult } from "./output/run-result-emitter.js";
import type {
  EndpointResult,
  PlannedTestCase,
  RunFilters,
  RunResult,
} from "./types.js";

/** Full runner configuration. */
export interface RunnerConfig {
  /** Tests directory (recursive walk root). */
  readonly testsDir: string;
  /** Reports directory (JSON sidecar destination). */
  readonly reportsDir: string;
  /** The resolved environment (Task #2). */
  readonly env: ResolvedEnvironment;
  /** The run-scoped SecretRegistry. */
  readonly secrets: SecretRegistry;
  /** Filter snapshot. */
  readonly filters: RunFilters;
  /** Shard spec or null. */
  readonly shard: ShardSpec | null;
  /** Worker count (informational only in v1.0 — executor is sequential). */
  readonly workers: number;
  /** Optional global retry policy from apiwright.config.json. */
  readonly globalRetryPolicy?: Partial<ResolvedRetryPolicy>;
  /** Optional --retries CLI override. */
  readonly cliRetryOverride?: number;
  /** Optional HTTP client seam (tests inject fakes). */
  readonly httpClient?: HttpClientSeam;
  /** Optional shared SchemaValidator (tests inject a stub). */
  readonly schemaValidator?: SchemaValidator;
  /**
   * When true, skip the built-in JSON sidecar emission so callers (e.g. the
   * CLI, which orchestrates HTML + JUnit + JSON via the §10 Reporting layer)
   * can own the emission boundary. Default false preserves Task #10 behavior.
   */
  readonly skipBuiltInEmit?: boolean;
}

/**
 * Runs the full §9 pipeline once. Returns the {@link RunResult} after the
 * lifecycle has been torn down. Writes the JSON sidecar before returning.
 * @param config - The {@link RunnerConfig}.
 * @returns The aggregated {@link RunResult}.
 * @throws {RunnerError} for pre-execute failures (discovery, parse, validate,
 *   shard); per-endpoint failures are captured into the RunResult rather
 *   than thrown.
 */
export async function runOnce(config: RunnerConfig): Promise<RunResult> {
  const started_at_ms = Date.now();
  const started_at = new Date(started_at_ms).toISOString();
  const validator = config.schemaValidator ?? new SchemaValidator();

  // 1. Discovery.
  const paths = await discoverEndpointFiles(config.testsDir);
  if (paths.length === 0) {
    throw new RunnerError({
      code: RUNNER_ERROR_CODES.RUNNER_PLAN_EMPTY,
      phase: "discovery",
      message: `No '*.endpoint.json' files found under '${config.testsDir}'.`,
    });
  }

  // 2. Load + validate.
  const endpointMap = await loadEndpointPlan(paths, validator);

  // 3. Parse-at-startup (obligation #1).
  parseAllAssertions(endpointMap);

  // 4. Plan generation.
  const planReport = generateTestPlan(endpointMap);

  // 5. Filter + shard.
  const filtered = applyFilters(
    planReport.cases,
    planReport.endpoints,
    config.filters,
    config.env.prod === true,
  );
  const sharded = shardCases(filtered, config.shard);

  // 6. Lifecycle open.
  const lifecycle = openLifecycle(config.env, config.secrets);

  // 7. Group cases by endpoint id (post-shard).
  const grouped = groupByEndpoint(sharded);
  const httpClient = config.httpClient ?? createDefaultHttpClient();
  const deps: ExecutorDeps = {
    connRegistry: lifecycle.connRegistry,
    authRegistry: lifecycle.authRegistry,
    secrets: config.secrets,
    httpClient,
    env: config.env,
    schemaValidator: validator,
    ...(config.globalRetryPolicy ? { globalRetryPolicy: config.globalRetryPolicy } : {}),
    ...(config.cliRetryOverride !== undefined ? { cliRetryOverride: config.cliRetryOverride } : {}),
  };

  // 8. Execute per endpoint (sequential v1.0; obligation #2 + auth + db).
  const endpoints: EndpointResult[] = [];
  for (const [endpointId, cases] of grouped) {
    const record = planReport.endpoints.get(endpointId);
    /* istanbul ignore next — every case carries an endpoint_id from a loaded record. */
    if (!record) continue;
    const result = await executeEndpoint(record.endpoint, cases, deps);
    endpoints.push(result);
  }

  // 9. Lifecycle close (always runs).
  await closeLifecycle(lifecycle);

  const ended_at_ms = Date.now();
  const ended_at = new Date(ended_at_ms).toISOString();

  // 10. Aggregate + emit.
  const result: RunResult = {
    started_at,
    ended_at,
    env: config.env.name,
    filters: config.filters,
    shard: config.shard,
    workers: config.workers,
    endpoints,
    summary: summarize(endpoints, ended_at_ms - started_at_ms),
  };
  if (!config.skipBuiltInEmit) {
    await emitRunResult(result, config.reportsDir, config.secrets);
  }
  return result;
}

/**
 * Groups planned cases by endpoint id, preserving each group's first-seen
 * order in the iteration so the executor processes endpoints in shard order.
 * @param cases - The sharded cases.
 * @returns A Map of endpoint id → its cases.
 */
function groupByEndpoint(
  cases: readonly PlannedTestCase[],
): ReadonlyMap<string, readonly PlannedTestCase[]> {
  const out = new Map<string, PlannedTestCase[]>();
  for (const c of cases) {
    const list = out.get(c.endpoint_id);
    if (list) {
      list.push(c);
    } else {
      out.set(c.endpoint_id, [c]);
    }
  }
  return out;
}

/**
 * Aggregates per-endpoint outcomes into a summary tuple.
 * @param endpoints - The per-endpoint results.
 * @param duration_ms - Run wall-clock duration.
 * @returns The {@link RunResult.summary}.
 */
function summarize(
  endpoints: readonly EndpointResult[],
  duration_ms: number,
): RunResult["summary"] {
  let passed = 0;
  let failed = 0;
  let flaky = 0;
  for (const e of endpoints) {
    if (e.status === "pass") passed++;
    else if (e.status === "fail") failed++;
    /* istanbul ignore next — flaky path requires retry-then-pass which is exercised
       by retry-policy tests; integration test does not produce flaky endpoints. */
    else if (e.status === "flaky") flaky++;
  }
  return {
    endpoints_planned: endpoints.length,
    passed,
    failed,
    flaky,
    duration_ms,
  };
}
