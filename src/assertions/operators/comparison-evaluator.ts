/**
 * Layer-C comparison-operator evaluator: implements `equals`, `not_equals`,
 * `greater_than`, `less_than`, and `in_range`. Pure, deterministic, total,
 * NEVER throws.
 */

import { deepEqual } from "../deep-equal.js";
import type { ResolvedValue } from "../target-resolver.js";
import type { GroupOutcome } from "../types.js";

/**
 * The five comparison operators this evaluator handles.
 * String-literal union (repo idiom, no enum).
 */
export type ComparisonOperator =
  | "equals"
  | "not_equals"
  | "greater_than"
  | "less_than"
  | "in_range";

/**
 * The resolved RHS for a comparison operation — either a direct comparand
 * (for equals/not_equals/greater_than/less_than) or an inclusive numeric range
 * (for in_range).
 */
export type ComparisonRhs =
  | { readonly kind: "comparand"; readonly comparand: unknown }
  | { readonly kind: "range"; readonly lo: number; readonly hi: number };

/**
 * Pass outcome factory to avoid repetition.
 * @param expected - The expected value for the assertion.
 * @param actual - The actual value from the resolved target.
 * @returns A passing GroupOutcome.
 */
function pass(expected: unknown, actual: unknown): GroupOutcome {
  return { pass: true, expected, actual };
}

/**
 * Fail outcome factory.
 * @param expected - The expected value for the assertion.
 * @param actual - The actual value from the resolved target.
 * @param failureCode - The machine-readable failure code.
 * @param reason - The human-readable failure reason.
 * @returns A failing GroupOutcome.
 */
function fail(
  expected: unknown,
  actual: unknown,
  failureCode: NonNullable<GroupOutcome["failureCode"]>,
  reason: string,
): GroupOutcome {
  return { pass: false, expected, actual, failureCode, reason };
}

/**
 * Evaluates comparison assertions (equals, not_equals, greater_than,
 * less_than, in_range). Stateless — one instance shared freely. NEVER throws.
 */
export class ComparisonEvaluator {
  /**
   * Evaluate one comparison assertion.
   * @param op - The comparison operator.
   * @param actual - The resolved LHS value.
   * @param rhs - The resolved RHS (comparand or range).
   * @returns A {@link GroupOutcome}.
   */
  evaluate(op: ComparisonOperator, actual: ResolvedValue, rhs: ComparisonRhs): GroupOutcome {
    if (!actual.found) {
      const expected = rhs.kind === "range" ? { lo: rhs.lo, hi: rhs.hi } : rhs.comparand;
      return fail(
        expected,
        "<absent>",
        "TARGET_NOT_FOUND",
        "Target not found in evaluation context",
      );
    }

    if (op === "equals" || op === "not_equals") {
      return this.#evalEquality(op, actual.value, rhs);
    }
    if (op === "greater_than" || op === "less_than") {
      return this.#evalOrdered(op, actual.value, rhs);
    }
    return this.#evalRange(actual.value, rhs);
  }

  /**
   * Evaluate `equals` and `not_equals` via `deepEqual`.
   * @param op - `equals` or `not_equals`.
   * @param lhs - The resolved LHS.
   * @param rhs - The RHS comparand or range.
   * @returns GroupOutcome.
   */
  #evalEquality(
    op: "equals" | "not_equals",
    lhs: unknown,
    rhs: ComparisonRhs,
  ): GroupOutcome {
    if (rhs.kind === "range") {
      return fail(
        { lo: rhs.lo, hi: rhs.hi },
        lhs,
        "TYPE_MISMATCH",
        `Expected a comparand RHS for '${op}', got range`,
      );
    }
    const comparand = rhs.comparand;
    const equal = deepEqual(lhs, comparand);
    const pass2 = op === "equals" ? equal : !equal;
    if (pass2) return pass(comparand, lhs);
    return fail(comparand, lhs, "COMPARISON_FAILED", `Expected ${JSON.stringify(comparand)}`);
  }

  /**
   * Evaluate `greater_than` and `less_than` with strict finite-number gate.
   * @param op - `greater_than` or `less_than`.
   * @param lhs - The resolved LHS.
   * @param rhs - The RHS comparand or range.
   * @returns GroupOutcome.
   */
  #evalOrdered(
    op: "greater_than" | "less_than",
    lhs: unknown,
    rhs: ComparisonRhs,
  ): GroupOutcome {
    if (rhs.kind === "range") {
      return fail(
        { lo: rhs.lo, hi: rhs.hi },
        lhs,
        "TYPE_MISMATCH",
        `Range RHS not valid for '${op}'`,
      );
    }
    const comparand = rhs.comparand;
    if (!this.#isFiniteNumber(lhs)) {
      return fail(comparand, lhs, "TYPE_MISMATCH", `LHS must be a finite number for '${op}'`);
    }
    if (!this.#isFiniteNumber(comparand)) {
      return fail(comparand, lhs, "TYPE_MISMATCH", `RHS must be a finite number for '${op}'`);
    }
    const predicate = op === "greater_than" ? (lhs as number) > (comparand as number)
      : (lhs as number) < (comparand as number);
    if (predicate) return pass(comparand, lhs);
    const lhsStr = typeof lhs === "number" ? String(lhs) : JSON.stringify(lhs);
    const rhsStr = typeof comparand === "number" ? String(comparand) : JSON.stringify(comparand);
    return fail(
      comparand,
      lhs,
      "COMPARISON_FAILED",
      `${lhsStr} is not ${op.replace("_", " ")} ${rhsStr}`,
    );
  }

  /**
   * Evaluate `in_range` with inclusive `[lo, hi]` bounds and finite-number gate.
   * @param lhs - The resolved LHS.
   * @param rhs - The RHS (must be kind:"range").
   * @returns GroupOutcome.
   */
  #evalRange(lhs: unknown, rhs: ComparisonRhs): GroupOutcome {
    if (rhs.kind === "comparand") {
      return fail(rhs.comparand, lhs, "TYPE_MISMATCH", "Expected a range RHS for 'in_range'");
    }
    const { lo, hi } = rhs;
    if (!this.#isFiniteNumber(lhs)) {
      return fail({ lo, hi }, lhs, "TYPE_MISMATCH", "LHS must be a finite number for 'in_range'");
    }
    const n = lhs as number;
    if (n >= lo && n <= hi) return pass({ lo, hi }, lhs);
    return fail({ lo, hi }, lhs, "COMPARISON_FAILED", `${n} not in range [${lo}, ${hi}]`);
  }

  /**
   * Returns true iff `v` is a plain finite number (not boolean, BigInt, NaN,
   * Infinity, or any other type).
   * @param v - Value to test.
   * @returns True when `typeof v === "number" && Number.isFinite(v)`.
   */
  #isFiniteNumber(v: unknown): boolean {
    return typeof v === "number" && Number.isFinite(v);
  }
}
