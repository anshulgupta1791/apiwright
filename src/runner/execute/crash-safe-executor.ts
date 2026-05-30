/**
 * Crash-safe wrapper around {@link executeEndpoint}.
 *
 * The §9 runner runs endpoints concurrently via a promise pool. The
 * existing executor (`executeEndpoint`) already promises NEVER to throw —
 * every failure becomes a structured {@link EndpointResult} so that one
 * bad case doesn't abort the run. This wrapper is the belt-and-braces
 * safety net for the rare path the executor's own try/catch missed
 * (a thrown value from a callback, an unhandled promise rejection that
 * escaped, a programmer error in a dep, etc.).
 *
 * When the executor escapes — synchronously or asynchronously — this
 * wrapper synthesizes a `status: "fail"` `EndpointResult` with a single
 * `verdict: "fail"` attempt and a `failure_reason` describing the escape.
 * Concurrent siblings keep running because the wrapper itself never
 * throws.
 *
 * Determinism: timing is captured at call time (started_at = now,
 * ended_at = now) — crash results contribute zero wall time to the run
 * total. The wrapper does NOT touch retry policy because the executor
 * already exhausted retries before the escape; recreating retry context
 * here would double-count attempts.
 */

import type { CanonicalEndpoint } from "../../core/canonical-model.js";
import type { AttemptResult, EndpointResult, PlannedTestCase } from "../types.js";

import type { ExecutorDeps } from "./endpoint-executor.js";
import { executeEndpoint } from "./endpoint-executor.js";

/**
 * Wraps {@link executeEndpoint} so escaped exceptions become structured
 * {@link EndpointResult}s instead of unhandled rejections. Identical
 * semantics on success.
 * @param endpoint - The canonical endpoint.
 * @param cases - Planned cases for the endpoint.
 * @param deps - The executor dependencies.
 * @param signal - Optional abort signal forwarded to the HTTP client.
 *   When the signal aborts the in-flight HTTP request, the executor's
 *   own per-attempt catch records a fail-attempt; subsequent cases on
 *   the same endpoint still observe the signal and short-circuit.
 * @returns The executor's result, or a synthetic crash result on escape.
 */
export async function executeEndpointSafely(
  endpoint: CanonicalEndpoint,
  cases: readonly PlannedTestCase[],
  deps: ExecutorDeps,
  signal?: AbortSignal,
): Promise<EndpointResult> {
  try {
    return await executeEndpoint(endpoint, cases, deps, signal);
  } catch (cause: unknown) {
    return synthesizeCrashResult(endpoint.id, cause);
  }
}

/**
 * Builds a deterministic `EndpointResult` representing an executor escape.
 * Exported so the rejection-attributor (Task 6.C) can reuse the same
 * shape when attributing an unhandled rejection.
 * @param endpointId - The endpoint id that owned the crashed task.
 * @param cause - The value that was thrown (any type).
 * @returns A `status: "fail"` result with a single crash-attempt entry.
 */
export function synthesizeCrashResult(
  endpointId: string,
  cause: unknown,
): EndpointResult {
  const now = Date.now();
  const reason = describe(cause);
  const attempt: AttemptResult = {
    // The executor crashed before a TestCase could be identified; use
    // synthetic markers so JSON/HTML/JUnit reports still surface a kind
    // (issue #63 — every attempt MUST carry case_id + kind).
    case_id: `${endpointId}.crash`,
    kind: "executor_crash",
    attempt: 1,
    verdict: "fail",
    started_at: now,
    ended_at: now,
    assertions: [],
    db_verify: [],
    failure_reason: reason,
  };
  return {
    endpoint_id: endpointId,
    status: "fail",
    attempts: [attempt],
    flaky: false,
  };
}

/**
 * Renders an unknown thrown value as a stable human-readable string.
 * Prefers `Error.message`; falls back to `String(value)`; coerces null /
 * undefined to a fixed placeholder so the result is never empty.
 * @param cause - The thrown value.
 * @returns Non-empty descriptive string.
 */
function describe(cause: unknown): string {
  if (cause instanceof Error) {
    return `Executor crashed: ${cause.message || cause.name}`;
  }
  if (cause === null) return "Executor crashed: null";
  if (cause === undefined) return "Executor crashed: undefined";
  if (typeof cause === "string") return `Executor crashed: ${cause}`;
  if (typeof cause === "number" || typeof cause === "boolean" || typeof cause === "bigint") {
    return `Executor crashed: ${cause.toString()}`;
  }
  // Plain-object / symbol throws are vanishingly rare (idiomatic JS code
  // throws Error subclasses). When they happen, JSON-stringify is more
  // informative than the default "[object Object]" coercion.
  try {
    return `Executor crashed: ${JSON.stringify(cause)}`;
  } catch {
    /* istanbul ignore next — JSON.stringify on a circular / un-stringifiable
       value; fall back to a generic descriptor so the result is never empty. */
    return "Executor crashed: <unserialisable value>";
  }
}
