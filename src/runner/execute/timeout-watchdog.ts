/**
 * Per-endpoint wall-clock timeout watchdog.
 *
 * Each endpoint dispatched by the §9 promise pool is given a dedicated
 * `AbortController` and a `setTimeout(...)`. If the endpoint finishes
 * before the timer fires, the timer is cleared and nothing is aborted.
 * If the timer fires first, `controller.abort()` cancels the in-flight
 * HTTP request (the HTTP client honors `AbortSignal`), the executor's
 * per-attempt catch records a fail-attempt with a clear "endpoint
 * timeout exceeded" message, and the pool slot is released so siblings
 * keep running.
 *
 * Why this lives in its own module:
 *   - Easy to unit-test without touching the runner.
 *   - The runner imports a single `withEndpointTimeout` helper; the
 *     controller/timer plumbing stays out of the runner's main path.
 *
 * Defaults (verified by tests/unit/runner/execute/timeout-watchdog.test.ts):
 *   - `DEFAULT_ENDPOINT_TIMEOUT_MS = 30_000`. Generous enough for slow
 *     CI infrastructure; aggressive enough that a stuck endpoint does
 *     not wedge the pool indefinitely.
 */

/** Spec default for the per-endpoint wall-clock budget. */
export const DEFAULT_ENDPOINT_TIMEOUT_MS = 30_000;

/** Outcome of {@link withEndpointTimeout}. */
export interface WithTimeoutResult<T> {
  /** The inner promise's resolved value, if it completed in time. */
  readonly value: T;
  /** True iff the watchdog fired (in which case the inner promise itself rejected). */
  readonly timedOut: boolean;
}

/**
 * Runs `task(signal)` with a wall-clock timeout. Returns the task's
 * resolved value and a `timedOut` flag.
 *
 * On timeout: the AbortController is aborted (the task's HTTP work
 * unwinds via the AbortSignal); the watchdog then awaits the (now
 * settled) task and returns whatever value/rejection the task produced.
 * Callers MUST forward the inner abort by accepting `signal` and passing
 * it to anything that takes one (e.g., `fetch`, the HttpClientSeam).
 *
 * The returned promise NEVER rejects from the timeout itself — the
 * inner task is responsible for surfacing the abort as a fail-result.
 * This keeps timeout semantics symmetric with all other executor errors.
 * @param timeoutMs - Wall-clock budget. Must be a positive integer.
 * @param task - Async work that receives the abort signal.
 * @returns A WithTimeoutResult.
 */
export async function withEndpointTimeout<T>(
  timeoutMs: number,
  task: (signal: AbortSignal) => Promise<T>,
): Promise<WithTimeoutResult<T>> {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    throw new RangeError(
      `withEndpointTimeout: timeoutMs must be a positive integer, got ${String(timeoutMs)}.`,
    );
  }
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  // unref so the timer alone never holds Node alive past the run.
  if (typeof timer === "object" && timer !== null && "unref" in timer) {
    /* istanbul ignore next — non-Node hosts skip unref; Node always has it. */
    (timer as { unref?: () => void }).unref?.();
  }
  try {
    const value = await task(controller.signal);
    return { value, timedOut };
  } finally {
    clearTimeout(timer);
  }
}
