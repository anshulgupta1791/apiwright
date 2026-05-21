/**
 * Bounded-concurrency limiter for the §9 runner's promise pool.
 *
 * Returns a callable `limit(fn)` that runs `fn` immediately when fewer than
 * `n` invocations are in flight, or queues it otherwise. The returned
 * promise settles with the same value (or rejection) the wrapped function
 * would have produced — the limiter is transparent to errors.
 *
 * Semantics (verified by `tests/unit/runner/execute/concurrency-limiter.test.ts`):
 *   1. Concurrency cap: at any instant, at most `n` tasks are in flight.
 *   2. FIFO queueing: when the cap is saturated, tasks resume in submission order.
 *   3. Error transparency: a rejecting task frees its slot exactly like a
 *      resolving one — the next queued task starts as soon as the slot is
 *      released, regardless of the previous task's outcome.
 *   4. `n = 1` reduces to sequential execution, identical to a plain `for await`.
 *   5. `n` ≥ task count reduces to unbounded concurrency.
 *
 * Why a hand-rolled limiter instead of `p-limit`: the v1.0 codebase keeps
 * its runtime dep set deliberately small (see V1_BUILD_SPEC.md §15 — the
 * `Dependency Rationale Table`). The implementation here is ~30 effective
 * lines and exhaustively tested; adding a third-party dep for a 30-line
 * primitive does not earn its keep.
 */

/** The shape of a function the limiter wraps. */
export type LimitedFn<T> = () => Promise<T>;

/** Function returned by {@link createLimit}. */
export type Limit = <T>(fn: LimitedFn<T>) => Promise<T>;

/**
 * Builds a bounded-concurrency limiter.
 * @param maxConcurrent - Maximum number of tasks that may be in flight at
 *   any instant. Must be a positive integer.
 * @returns A `limit(fn)` function that runs `fn` immediately when there is
 *   capacity, or queues it FIFO when saturated.
 * @throws {RangeError} when `maxConcurrent` is not a positive integer.
 */
export function createLimit(maxConcurrent: number): Limit {
  if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1) {
    throw new RangeError(
      `createLimit: maxConcurrent must be a positive integer, got ${String(maxConcurrent)}.`,
    );
  }

  let active = 0;
  const queue: Array<() => void> = [];

  /** Releases a slot and starts the next queued task, if any. */
  const release = (): void => {
    active--;
    const next = queue.shift();
    if (next) next();
  };

  /**
   * Acquires a slot, blocking via promise when saturated.
   * @returns A promise that resolves once a slot is free for the caller.
   */
  const acquire = (): Promise<void> => {
    if (active < maxConcurrent) {
      active++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      queue.push(() => {
        active++;
        resolve();
      });
    });
  };

  return async function limit<T>(fn: LimitedFn<T>): Promise<T> {
    await acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  };
}
