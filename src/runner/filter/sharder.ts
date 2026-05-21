/**
 * Deterministic test-plan sharding per V1_BUILD_SPEC.md §9 line 639.
 *
 * `--shard=N/M` splits the deterministically-ordered test plan across M
 * parallel CI jobs; shard N runs its slice; results merged post-run.
 *
 * Ordering is alphabetical by `endpoint_id` (then by case id within an
 * endpoint, which the planner already produces deterministically), so the
 * same input set produces the same shard slicing across runs and machines.
 *
 * Slice boundaries use `Math.floor((shardIdx - 1) * n / total)` /
 * `Math.floor(shardIdx * n / total)` so the union of all M shards equals
 * the full set and no case is duplicated or dropped.
 */

import { RUNNER_ERROR_CODES, RunnerError } from "../errors.js";
import type { PlannedTestCase } from "../types.js";

/** Optional sharding tuple: `{ index, total }` with 1 ≤ index ≤ total. */
export interface ShardSpec {
  /** 1-based shard index. */
  readonly index: number;
  /** Total number of shards. */
  readonly total: number;
}

/**
 * Returns the slice of `cases` that belongs to shard `(index, total)`.
 * @param cases - The planned cases (filter has already run).
 * @param shard - The shard tuple; `null` returns `cases` unchanged.
 * @returns The slice belonging to this shard.
 * @throws {RunnerError} code `RUNNER_SHARD_INVALID` when `index` or `total`
 *   is non-integer, `total` is zero, or `index ∉ [1, total]`.
 */
export function shardCases(
  cases: readonly PlannedTestCase[],
  shard: ShardSpec | null,
): readonly PlannedTestCase[] {
  if (shard === null) return sortDeterministic(cases);
  validateShard(shard);
  const sorted = sortDeterministic(cases);
  const n = sorted.length;
  const start = Math.floor(((shard.index - 1) * n) / shard.total);
  const end = Math.floor((shard.index * n) / shard.total);
  return sorted.slice(start, end);
}

/**
 * Deterministically sorts cases by `endpoint_id`, then `case.id` within a
 * given endpoint. Pure — does not mutate the input.
 * @param cases - The cases to sort.
 * @returns A new array sorted by `(endpoint_id, case.id)`.
 */
function sortDeterministic(cases: readonly PlannedTestCase[]): readonly PlannedTestCase[] {
  return [...cases].sort((a, b) => {
    const epCmp = a.endpoint_id.localeCompare(b.endpoint_id);
    if (epCmp !== 0) return epCmp;
    return a.case.id.localeCompare(b.case.id);
  });
}

/**
 * Validates a {@link ShardSpec} tuple. Throws a {@link RunnerError} on
 * failure with a clear message.
 * @param shard - The shard tuple to validate.
 * @throws {RunnerError} code `RUNNER_SHARD_INVALID` on any violation.
 */
function validateShard(shard: ShardSpec): void {
  const { index, total } = shard;
  if (!Number.isInteger(index) || !Number.isInteger(total)) {
    throw new RunnerError({
      code: RUNNER_ERROR_CODES.RUNNER_SHARD_INVALID,
      phase: "shard",
      message: `Shard --shard=N/M requires integer N and M (got N=${index}, M=${total}).`,
    });
  }
  if (total < 1) {
    throw new RunnerError({
      code: RUNNER_ERROR_CODES.RUNNER_SHARD_INVALID,
      phase: "shard",
      message: `Shard total must be >= 1 (got M=${total}).`,
    });
  }
  if (index < 1 || index > total) {
    throw new RunnerError({
      code: RUNNER_ERROR_CODES.RUNNER_SHARD_INVALID,
      phase: "shard",
      message:
        `Shard index must be in [1, ${total}] (got N=${index}, M=${total}).`,
    });
  }
}
