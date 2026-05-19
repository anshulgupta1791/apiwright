/**
 * Layer-C aggregate-operator evaluator: implements `count_equals` and
 * `count_greater_than`. Pure, deterministic, total, NEVER throws.
 *
 * Count sources (checked in LHS step — before RHS validity):
 * - `Array` → `array.length`
 * - Structural `NormalizedResult` ({ rows: unknown[]; rowCount: number; raw: unknown }) →
 *   `rowCount` (authoritative; detected structurally, no instanceof).
 * - Anything else → `AGGREGATE_MISMATCH`.
 */

import type { ResolvedValue } from "../target-resolver.js";
import type { GroupOutcome } from "../types.js";

/**
 * The two aggregate operators this evaluator handles.
 * String-literal union (repo idiom, no enum).
 */
export type AggregateOperator = "count_equals" | "count_greater_than";

/**
 * The resolved RHS for an aggregate operation: a `count` value
 * (validated as a finite non-negative integer within the evaluator).
 */
export interface AggregateRhs {
  /** The expected count. May be any type; validity is checked at eval time. */
  readonly count: unknown;
}

/**
 * Build a passing GroupOutcome.
 * @param expected - The expected value for the assertion.
 * @param actual - The actual value from the resolved target.
 * @returns A passing GroupOutcome.
 */
function passOk(expected: unknown, actual: unknown): GroupOutcome {
  return { pass: true, expected, actual };
}

/**
 * Build a failing GroupOutcome.
 * @param expected - The expected value for the assertion.
 * @param actual - The actual value from the resolved target.
 * @param failureCode - The machine-readable failure code.
 * @param reason - The human-readable failure reason.
 * @returns A failing GroupOutcome.
 */
function failWith(
  expected: unknown,
  actual: unknown,
  failureCode: NonNullable<GroupOutcome["failureCode"]>,
  reason: string,
): GroupOutcome {
  return { pass: false, expected, actual, failureCode, reason };
}

/**
 * Structural check for a NormalizedResult without instanceof. Requires:
 * - `value` is a non-null object
 * - has own `rows` key that is an array
 * - has own `rowCount` key that is a finite integer
 * @param value - The value to test.
 * @returns True when structurally a NormalizedResult with valid rowCount.
 */
function isNormalizedResult(
  value: unknown,
): value is { rows: unknown[]; rowCount: number; raw: unknown } {
  if (value === null || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  if (!Object.prototype.hasOwnProperty.call(obj, "rows")) return false;
  if (!Object.prototype.hasOwnProperty.call(obj, "rowCount")) return false;
  if (!Array.isArray(obj["rows"])) return false;
  const rc = obj["rowCount"];
  return typeof rc === "number" && Number.isFinite(rc) && Number.isInteger(rc);
}

/**
 * Evaluates aggregate assertions (`count_equals`, `count_greater_than`).
 * Stateless — one instance shared freely. NEVER throws.
 */
export class AggregateEvaluator {
  /**
   * Evaluate one aggregate assertion. LHS step (count derivation) before RHS
   * step (validity check) before predicate.
   * @param op - The aggregate operator.
   * @param lhs - The resolved LHS value.
   * @param rhs - The resolved RHS (`{ count: unknown }`).
   * @returns A {@link GroupOutcome}.
   */
  evaluate(op: AggregateOperator, lhs: ResolvedValue, rhs: AggregateRhs): GroupOutcome {
    if (!lhs.found) {
      return failWith(
        rhs.count,
        "<absent>",
        "TARGET_NOT_FOUND",
        `Target not found for '${op}'`,
      );
    }

    // Step 1: derive count from LHS (before validating RHS)
    const countResult = this.#deriveCount(lhs.value);
    if (!countResult.ok) return countResult.outcome;

    const count = countResult.count;

    // Step 2: validate RHS
    const rhsCount = rhs.count;
    if (!this.#isValidCount(rhsCount)) {
      return failWith(
        "finite non-negative integer",
        rhsCount,
        "TYPE_MISMATCH",
        `RHS count must be a finite non-negative integer, ` +
        `got ${typeof rhsCount}: ${String(rhsCount)}`,
      );
    }

    // Step 3: evaluate predicate
    return this.#evalPredicate(op, count, rhsCount as number);
  }

  /**
   * Derive the count from the LHS value. Returns either a count (number) or
   * an AGGREGATE_MISMATCH outcome.
   * @param value - The resolved LHS value.
   * @returns An ok result with `count`, or a `{ ok:false; outcome }` failure.
   */
  #deriveCount(
    value: unknown,
  ): { ok: true; count: number } | { ok: false; outcome: GroupOutcome } {
    if (Array.isArray(value)) {
      return { ok: true, count: value.length };
    }
    if (isNormalizedResult(value)) {
      return { ok: true, count: value.rowCount };
    }
    return {
      ok: false,
      outcome: failWith(
        "array or NormalizedResult",
        typeof value,
        "AGGREGATE_MISMATCH",
        `LHS must be an array or NormalizedResult for aggregate operators`,
      ),
    };
  }

  /**
   * Check that a RHS count value is a finite, non-negative integer.
   * @param count - The raw RHS count value.
   * @returns True when valid.
   */
  #isValidCount(count: unknown): boolean {
    return (
      typeof count === "number" &&
      Number.isFinite(count) &&
      Number.isInteger(count) &&
      count >= 0
    );
  }

  /**
   * Apply the aggregate predicate.
   * @param op - The operator.
   * @param actual - The derived count (valid finite integer).
   * @param expected - The RHS count (valid finite integer).
   * @returns GroupOutcome.
   */
  #evalPredicate(op: AggregateOperator, actual: number, expected: number): GroupOutcome {
    if (op === "count_equals") {
      if (actual === expected) return passOk(expected, actual);
      return failWith(expected, actual, "AGGREGATE_MISMATCH", `Count ${actual} !== ${expected}`);
    }
    // count_greater_than
    if (actual > expected) return passOk(expected, actual);
    return failWith(expected, actual, "AGGREGATE_MISMATCH", `Count ${actual} is not > ${expected}`);
  }
}
