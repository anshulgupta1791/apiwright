/**
 * Retry policy per §9 lines 642–661.
 *
 * Re-execution semantics (line 660): retries do not partially re-run; each
 * attempt is a clean execution. Pass-after-retry policy (line 661): lenient
 * by default — a flaky pass is `status: "flaky"`, not `"pass"`; strict mode
 * treats any first-attempt failure as a fail regardless.
 *
 * Backoff strategies (line 657): `none` / `linear` / `exponential`.
 * Default per spec: `count: 2`, `delay_ms: 1000`, `backoff: "linear"`.
 */

import type { BackoffStrategy } from "../../core/canonical-model.js";
import type { AttemptResult, FinalStatus, Verdict } from "../types.js";

/** Default retry config when neither apiwright.config.json nor CLI overrides. */
export const DEFAULT_RETRY_POLICY: ResolvedRetryPolicy = Object.freeze({
  count: 2,
  delay_ms: 1000,
  backoff: "linear",
  strict: false,
});

/** Fully resolved retry policy (no undefined fields). */
export interface ResolvedRetryPolicy {
  /** Max retry attempts (0 = no retries; first attempt always counted). */
  readonly count: number;
  /** Initial delay before first retry, in ms. */
  readonly delay_ms: number;
  /** Backoff strategy: scales `delay_ms` per attempt. */
  readonly backoff: BackoffStrategy;
  /** Strict mode: any first-attempt failure → "fail" regardless of later passes. */
  readonly strict: boolean;
}

/** Caller-supplied function that runs ONE attempt; returns a single trace. */
export type AttemptFn = (attempt: number) => Promise<AttemptResult>;

/** Output of {@link executeWithRetry}. */
export interface RetryOutcome {
  /** Ordered attempt traces, length ≥ 1. */
  readonly attempts: readonly AttemptResult[];
  /** Final status surfaced into the EndpointResult. */
  readonly status: FinalStatus;
  /** True iff status === "flaky". */
  readonly flaky: boolean;
}

/**
 * Executes `attemptFn` up to `policy.count + 1` times until a `pass`
 * verdict is observed. Returns the full attempt history + the post-retry
 * status (pass / fail / flaky).
 * @param attemptFn - The function that runs one attempt; takes the 1-based
 *   attempt number and returns an {@link AttemptResult}.
 * @param policy - The resolved retry policy.
 * @param sleep - Optional injected sleeper (tests use a fake to avoid real waits).
 * @returns The retry outcome with all attempt traces and final status.
 */
export async function executeWithRetry(
  attemptFn: AttemptFn,
  policy: ResolvedRetryPolicy,
  sleep: (ms: number) => Promise<void> = defaultSleep,
): Promise<RetryOutcome> {
  const attempts: AttemptResult[] = [];
  const maxAttempts = policy.count + 1;
  for (let n = 1; n <= maxAttempts; n++) {
    if (n > 1) await sleep(computeDelay(policy, n));
    const trace = await attemptFn(n);
    attempts.push(trace);
    if (trace.verdict === "pass") {
      return finish(attempts, policy);
    }
  }
  return finish(attempts, policy);
}

/**
 * Computes the post-retry status. Strict-mode rule (spec line 661): any
 * first-attempt failure → "fail" regardless of subsequent passes.
 * @param attempts - All attempt traces in execution order.
 * @param policy - The resolved retry policy (carries `strict`).
 * @returns The {@link RetryOutcome} with classification.
 */
function finish(
  attempts: readonly AttemptResult[],
  policy: ResolvedRetryPolicy,
): RetryOutcome {
  const passedSomewhere = attempts.some((a) => a.verdict === "pass");
  const firstAttemptVerdict: Verdict = attempts[0]?.verdict ?? "fail";
  if (!passedSomewhere) {
    return { attempts, status: "fail", flaky: false };
  }
  if (firstAttemptVerdict === "pass") {
    return { attempts, status: "pass", flaky: false };
  }
  // Passed but not on first attempt — flaky (or strict-fail).
  if (policy.strict) {
    return { attempts, status: "fail", flaky: false };
  }
  return { attempts, status: "flaky", flaky: true };
}

/**
 * Computes the pre-attempt delay based on backoff strategy. Attempt 2 uses
 * `delay_ms`; attempt 3 uses 2 × `delay_ms` (linear) or 2² × `delay_ms`
 * (exponential); `none` always returns 0.
 * @param policy - The resolved retry policy.
 * @param attempt - The 1-based attempt number we are ABOUT to execute.
 * @returns Delay in ms before this attempt.
 */
function computeDelay(policy: ResolvedRetryPolicy, attempt: number): number {
  if (policy.backoff === "none") return 0;
  if (policy.backoff === "exponential") {
    return policy.delay_ms * Math.pow(2, attempt - 2);
  }
  // linear
  return policy.delay_ms * (attempt - 1);
}

/**
 * Real `setTimeout`-backed sleep. Tests inject a no-op or counter-only fake.
 * @param ms - Milliseconds to sleep.
 * @returns Promise that resolves after `ms` ms.
 */
function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Resolves the effective retry policy by stacking global + per-endpoint +
 * CLI overrides. CLI wins; per-endpoint wins over global; absent fields
 * fall back to {@link DEFAULT_RETRY_POLICY}.
 * @param global - The apiwright.config.json `retry` block (or undefined).
 * @param endpointOverride - The endpoint's `retry` block (or undefined).
 * @param cliOverride - The `--retries=N` CLI override (or undefined).
 * @returns The resolved policy with no undefined fields.
 */
export function resolveRetryPolicy(
  global: Partial<ResolvedRetryPolicy> | undefined,
  endpointOverride: Partial<ResolvedRetryPolicy> | undefined,
  cliOverride: number | undefined,
): ResolvedRetryPolicy {
  const base = { ...DEFAULT_RETRY_POLICY };
  if (global) Object.assign(base, stripUndefined(global));
  if (endpointOverride) Object.assign(base, stripUndefined(endpointOverride));
  if (cliOverride !== undefined) base.count = cliOverride;
  return base;
}

/**
 * Removes keys whose values are `undefined` so they don't overwrite the
 * base. Returns a shallow copy.
 * @param o - Source object.
 * @returns Shallow copy with undefined values removed.
 */
function stripUndefined<T extends object>(o: T): Partial<T> {
  const out: Partial<T> = {};
  for (const k of Object.keys(o) as (keyof T)[]) {
    if (o[k] !== undefined) out[k] = o[k];
  }
  return out;
}
