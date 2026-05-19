/**
 * Layer-C existence-operator evaluator: implements `exists`, `not_exists`,
 * `is_null`, and `is_not_null`. Pure, deterministic, total, NEVER throws.
 *
 * Locked decision #6: explicit-null is NOT missing. `found:true,value:null`
 * is present-and-null; `found:false` is absent.
 */

import type { ResolvedValue } from "../target-resolver.js";
import type { GroupOutcome } from "../types.js";

/**
 * The four existence operators this evaluator handles.
 * String-literal union (repo idiom, no enum).
 */
export type ExistenceOperator = "exists" | "not_exists" | "is_null" | "is_not_null";

/** Maximum length of the type descriptor appended to FAIL actual fields. */
const MAX_DESCRIPTOR_LENGTH = 120;

/** Sentinel descriptor for a missing (not-found) target. */
const ABSENT_DESCRIPTOR = "<absent>";

/**
 * Derive a safe, bounded string descriptor of a found value for use in
 * `actual` fields (never dumps large payloads).
 * @param value - The resolved value.
 * @returns A short string description.
 */
function safeDescriptor(value: unknown): string {
  if (value === null) return "null";
  const t = typeof value;
  if (t === "string") {
    const s = value as string;
    return s.length > MAX_DESCRIPTOR_LENGTH ? `${s.slice(0, MAX_DESCRIPTOR_LENGTH)}…` : s;
  }
  if (t === "number") return JSON.stringify(value);
  if (t === "boolean") return JSON.stringify(value);
  const tag = Array.isArray(value) ? "array" : "object";
  return `<${tag}>`;
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
 * Evaluates existence assertions (`exists`, `not_exists`, `is_null`,
 * `is_not_null`). Stateless — one instance shared freely. NEVER throws.
 * Implements the full 4×3 truth table from locked decision #6.
 */
export class ExistenceEvaluator {
  /**
   * Evaluate one existence assertion.
   * @param op - The existence operator.
   * @param resolved - The resolved LHS value.
   * @returns A {@link GroupOutcome}.
   */
  evaluate(op: ExistenceOperator, resolved: ResolvedValue): GroupOutcome {
    if (op === "exists") return this.#evalExists(resolved);
    if (op === "not_exists") return this.#evalNotExists(resolved);
    if (op === "is_null") return this.#evalIsNull(resolved);
    return this.#evalIsNotNull(resolved);
  }

  /**
   * `exists`: absent → FAIL TARGET_NOT_FOUND; present (any value) → PASS.
   * @param resolved - The resolved LHS.
   * @returns GroupOutcome.
   */
  #evalExists(resolved: ResolvedValue): GroupOutcome {
    if (!resolved.found) {
      return failWith(
        "present",
        ABSENT_DESCRIPTOR,
        "TARGET_NOT_FOUND",
        "Target does not exist in evaluation context",
      );
    }
    return passOk("present", safeDescriptor(resolved.value));
  }

  /**
   * `not_exists`: absent → PASS; present (any value, including null) → FAIL.
   * @param resolved - The resolved LHS.
   * @returns GroupOutcome.
   */
  #evalNotExists(resolved: ResolvedValue): GroupOutcome {
    if (!resolved.found) {
      return passOk("absent", ABSENT_DESCRIPTOR);
    }
    return failWith(
      "absent",
      safeDescriptor(resolved.value),
      "COMPARISON_FAILED",
      "Target exists but was expected to be absent",
    );
  }

  /**
   * `is_null`: absent → FAIL TARGET_NOT_FOUND; null → PASS; non-null → FAIL.
   * @param resolved - The resolved LHS.
   * @returns GroupOutcome.
   */
  #evalIsNull(resolved: ResolvedValue): GroupOutcome {
    if (!resolved.found) {
      return failWith(
        "null",
        ABSENT_DESCRIPTOR,
        "TARGET_NOT_FOUND",
        "Target is missing, not null",
      );
    }
    if (resolved.value === null) {
      return passOk("null", "null");
    }
    return failWith(
      "null",
      safeDescriptor(resolved.value),
      "COMPARISON_FAILED",
      `Target is not null (got ${safeDescriptor(resolved.value)})`,
    );
  }

  /**
   * `is_not_null`: absent → FAIL TARGET_NOT_FOUND; null → FAIL; non-null → PASS.
   * Treats `undefined` as non-null (defensive, per test spec).
   * @param resolved - The resolved LHS.
   * @returns GroupOutcome.
   */
  #evalIsNotNull(resolved: ResolvedValue): GroupOutcome {
    if (!resolved.found) {
      return failWith(
        "non-null",
        ABSENT_DESCRIPTOR,
        "TARGET_NOT_FOUND",
        "Target is missing",
      );
    }
    if (resolved.value === null) {
      return failWith(
        "non-null",
        "null",
        "COMPARISON_FAILED",
        "Target is null but was expected to be non-null",
      );
    }
    return passOk("non-null", safeDescriptor(resolved.value));
  }
}
