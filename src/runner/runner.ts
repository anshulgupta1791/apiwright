/**
 * The top-level `Runner` — composes the §9 pipeline end-to-end. Discovery →
 * load → assertion-parse-at-startup → plan-gen → filter → shard → lifecycle
 * open → per-endpoint promise pool → aggregate → emit → lifecycle close.
 *
 * Discharges every obligation by composition (each step's discharge is
 * captured in the per-layer module).
 *
 * Worker parallelism (V1_BUILD_SPEC §9 line 638): the runner uses an
 * in-process promise pool (`concurrency-limiter.ts`) bounded by
 * `--workers=N` (default = CPU count). Each pool slot runs one endpoint
 * via {@link executeEndpointSafely} (crash-isolated) inside
 * {@link runInEndpointContext} (unhandled-rejection attribution) wrapped
 * by {@link withEndpointTimeout} (per-endpoint wall-clock budget). One
 * stuck endpoint cannot wedge the pool; one uncaught exception cannot
 * tank the run. Catastrophic failure modes (OOM, native crash) are
 * survived via {@link createPartialEmitter} — every completed result is
 * appended to `run-<ts>.partial.jsonl` immediately so the user has
 * forensic data even after a hard exit.
 */

import { join } from "node:path";

import { SchemaValidator } from "../core/index.js";
import type { ResolvedEnvironment, SecretRegistry } from "../env/index.js";


import { parseAllAssertions } from "./discovery/assertion-binder-wiring.js";
import { generateTestPlan } from "./discovery/plan-generator.js";
import { loadEndpointPlan } from "./discovery/plan-loader.js";
import { discoverEndpointFiles } from "./discovery/walker.js";
import { RUNNER_ERROR_CODES, RunnerError } from "./errors.js";
import { createLimit } from "./execute/concurrency-limiter.js";
import {
  executeEndpointSafely,
  synthesizeCrashResult,
} from "./execute/crash-safe-executor.js";
import type { ExecutorDeps } from "./execute/endpoint-executor.js";
import { type HttpClientSeam, createDefaultHttpClient } from "./execute/http-client.js";
import { closeLifecycle, openLifecycle } from "./execute/lifecycle.js";
import {
  installRejectionAttributor,
  runInEndpointContext,
} from "./execute/rejection-attributor.js";
import type { ResolvedRetryPolicy } from "./execute/retry-policy.js";
import {
  DEFAULT_ENDPOINT_TIMEOUT_MS,
  withEndpointTimeout,
} from "./execute/timeout-watchdog.js";
import { applyFilters } from "./filter/filter.js";
import { type ShardSpec, shardCases } from "./filter/sharder.js";
import { createPartialEmitter, type PartialEmitter } from "./output/partial-emitter.js";
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
  /**
   * Worker count — bounded concurrency for the in-process promise pool
   * (§9 line 638). Must be ≥ 1; values ≤ 1 reduce to sequential execution.
   */
  readonly workers: number;
  /**
   * Per-endpoint wall-clock budget in milliseconds. When an endpoint
   * exceeds this, its AbortController fires, the in-flight HTTP request
   * is cancelled, and the endpoint records a fail-attempt. Other
   * endpoints in the pool are unaffected. Default: 30_000.
   */
  readonly endpointTimeoutMs?: number;
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
 * Per-endpoint failures (including crashes, timeouts, unhandled
 * rejections) are captured into the RunResult rather than thrown — the
 * promise pool keeps siblings running.
 * @param config - The {@link RunnerConfig}.
 * @returns The aggregated {@link RunResult}.
 * @throws {RunnerError} for pre-execute failures only — discovery,
 *   load/validate, plan-gen, filter, shard, lifecycle open. After
 *   execution begins, all failures are absorbed into the RunResult.
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

  // 8. Execute via promise pool (§9 line 638). Each slot runs ONE endpoint
  //    inside three nested safety layers:
  //      (a) runInEndpointContext  — AsyncLocalStorage tag for rejection attribution
  //      (b) withEndpointTimeout   — AbortController fires on wall-clock exceed
  //      (c) executeEndpointSafely — synthesizes a fail-result on any escape
  //    Determinism is preserved by writing into a pre-allocated, index-keyed
  //    output array — completion order is irrelevant; input order is the
  //    canonical merge order.
  const ordered = orderEndpointTasks(grouped, planReport.endpoints);
  const endpoints: EndpointResult[] = new Array<EndpointResult>(ordered.length);
  const attributedCrashes = new Map<string, unknown>();
  const uninstallRejectionAttributor = installRejectionAttributor({
    onAttribute: (id, reason) => attributedCrashes.set(id, reason),
    onUnattributed: emitOrphanRejection,
  });

  const limit = createLimit(Math.max(1, config.workers));
  const timeoutMs = config.endpointTimeoutMs ?? DEFAULT_ENDPOINT_TIMEOUT_MS;
  const partial: PartialEmitter | undefined = config.skipBuiltInEmit
    ? undefined
    : await createPartialEmitter(
        join(config.reportsDir, `run-${started_at_ms}.partial.jsonl`),
        config.secrets,
      );

  try {
    await Promise.all(
      ordered.map((task, idx) =>
        limit(() => dispatchEndpoint(task, idx, {
          deps,
          endpoints,
          attributedCrashes,
          timeoutMs,
          partial,
        })),
      ),
    );
  } finally {
    uninstallRejectionAttributor();
  }

  // 9. Lifecycle close (always runs).
  await closeLifecycle(lifecycle);
  // Drop the partial sidecar; the full JSON sidecar (emitted below)
  // supersedes it. On crash, finally{} above runs but the program dies
  // before reaching here, so the partial remains on disk for forensics.
  if (partial) await partial.finalize();

  const ended_at_ms = Date.now();
  const ended_at = new Date(ended_at_ms).toISOString();

  // 10. Aggregate + emit.
  const result: RunResult = attachWarnings(
    {
      started_at,
      ended_at,
      env: config.env.name,
      filters: config.filters,
      shard: config.shard,
      workers: config.workers,
      endpoints,
      summary: summarize(endpoints, ended_at_ms - started_at_ms),
    },
    planReport.warnings,
  );
  if (!config.skipBuiltInEmit) {
    await emitRunResult(result, config.reportsDir, config.secrets);
  }
  return result;
}

/** One ready-to-run endpoint task. */
interface EndpointTask {
  readonly endpointId: string;
  readonly endpoint: ReturnType<typeof requireEndpoint>;
  readonly cases: readonly PlannedTestCase[];
}

/** Bundle of pool-scoped collaborators passed to {@link dispatchEndpoint}. */
interface DispatchScope {
  readonly deps: ExecutorDeps;
  readonly endpoints: EndpointResult[];
  readonly attributedCrashes: ReadonlyMap<string, unknown>;
  readonly timeoutMs: number;
  readonly partial: PartialEmitter | undefined;
}

/** Type alias for one entry in the plan report's endpoint map. */
type LoadedEndpointRecord = {
  readonly endpoint: import("../core/canonical-model.js").CanonicalEndpoint;
};

/**
 * Dispatches one endpoint task: runs it inside an attribution context +
 * timeout watchdog + crash-safe wrapper, then reconciles any attributed
 * rejection and writes the result into the pre-allocated output slot.
 * @param task - The endpoint task to dispatch.
 * @param idx - The deterministic output slot index.
 * @param scope - Pool-scoped collaborators.
 */
async function dispatchEndpoint(
  task: EndpointTask,
  idx: number,
  scope: DispatchScope,
): Promise<void> {
  const result = await runInEndpointContext(task.endpointId, async () => {
    const out = await withEndpointTimeout(scope.timeoutMs, (signal) =>
      executeEndpointSafely(task.endpoint, task.cases, scope.deps, signal),
    );
    return out.value;
  });
  const attribution = scope.attributedCrashes.get(task.endpointId);
  const final = attribution !== undefined
    ? synthesizeCrashResult(task.endpointId, attribution)
    : result;
  scope.endpoints[idx] = final;
  if (scope.partial) await scope.partial.append(final);
}

/**
 * Emits an `unhandledRejection` that the attributor could not bind to an
 * endpoint context. Surfaced as a Node warning so it appears on stderr
 * but does not crash the run.
 * @param reason - The rejected value.
 */
/* istanbul ignore next — orphan rejections require a worker to schedule a
   rejection AFTER its endpoint context has exited; a timing condition
   we cannot deterministically force in tests. */
function emitOrphanRejection(reason: unknown): void {
  process.emitWarning(
    `apiwright: unattributed unhandled rejection: ${stringifyReason(reason)}`,
  );
}

/**
 * Looks up the loaded endpoint record by id. Throws if missing — every
 * planned case carries an endpoint_id sourced from the loaded record so
 * this never fires in practice.
 * @param endpoints - The endpoint map from the plan report.
 * @param id - The endpoint id to look up.
 * @returns The loaded endpoint.
 * @throws {RunnerError} `RUNNER_PLAN_EMPTY` when the id is not present
 *   in the loaded endpoint map (defensive — should never trigger).
 */
function requireEndpoint(
  endpoints: ReadonlyMap<string, LoadedEndpointRecord>,
  id: string,
): LoadedEndpointRecord["endpoint"] {
  const record = endpoints.get(id);
  /* istanbul ignore next — see assertion above. */
  if (!record) throw new RunnerError({
    code: RUNNER_ERROR_CODES.RUNNER_PLAN_EMPTY,
    phase: "plan-gen",
    message: `Internal: case references unknown endpoint id '${id}'.`,
  });
  return record.endpoint;
}

/**
 * Builds the deterministic, ordered task list the promise pool dispatches
 * from. The order matches the input iteration order of `grouped`, which
 * mirrors first-seen order in the sharded case list — the same order
 * sequential v1.0 used.
 * @param grouped - The case map keyed by endpoint id.
 * @param endpoints - The loaded endpoint records.
 * @returns Ordered list of {@link EndpointTask}.
 */
function orderEndpointTasks(
  grouped: ReadonlyMap<string, readonly PlannedTestCase[]>,
  endpoints: ReadonlyMap<string, LoadedEndpointRecord>,
): readonly EndpointTask[] {
  const out: EndpointTask[] = [];
  for (const [endpointId, cases] of grouped) {
    out.push({ endpointId, endpoint: requireEndpoint(endpoints, endpointId), cases });
  }
  return out;
}

/**
 * Renders an unknown rejection value as a stable, non-empty string for
 * `process.emitWarning`. Mirrors `crash-safe-executor.describe`.
 * @param reason - The thrown / rejected value.
 * @returns A non-empty human-readable string.
 */
/* istanbul ignore next — only triggered by an orphan rejection (rejection
   scheduled outside any active endpoint context). The `onUnattributed`
   callback path that calls this function is itself istanbul-ignored
   because it requires a worker to schedule a rejection AFTER its
   endpoint context has exited — a timing condition we cannot
   deterministically force in tests without harming determinism elsewhere. */
function stringifyReason(reason: unknown): string {
  if (reason instanceof Error) return reason.message || reason.name;
  /* istanbul ignore next — orphan-rejection fallback. */
  return String(reason);
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
 * Attaches plan-generation warnings to the assembled result, omitting the
 * `warnings` key entirely when there are none so the RunResult shape (and its
 * JSON sidecar) is unchanged in the common, warning-free case.
 * @param base - The assembled result without warnings.
 * @param warnings - Plan-generation warnings (possibly empty).
 * @returns The final {@link RunResult}.
 */
function attachWarnings(
  base: Omit<RunResult, "warnings">,
  warnings: readonly string[],
): RunResult {
  return warnings.length > 0 ? { ...base, warnings } : base;
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
