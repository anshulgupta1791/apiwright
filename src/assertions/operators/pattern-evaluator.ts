/**
 * Layer-C pattern-operator evaluator: implements `matches`, `contains`,
 * `starts_with`, and `ends_with`. Pure, deterministic, total, NEVER throws.
 *
 * `matches` enforces the ReDoS guard: target strings longer than
 * `MAX_REGEX_TARGET_LENGTH` return `REGEX_NO_MATCH` without running the regex.
 * `contains` on an array performs deep-equal membership (type-strict).
 */

import { deepEqual } from "../../core/deep-equal.js";
import { MAX_REGEX_TARGET_LENGTH } from "../regex-operand.js";
import type { ResolvedValue } from "../target-resolver.js";
import type { GroupOutcome, RegexOperand } from "../types.js";

/**
 * The four pattern operators this evaluator handles.
 * String-literal union (repo idiom, no enum).
 */
export type PatternOperator = "matches" | "contains" | "starts_with" | "ends_with";

/**
 * The resolved RHS for a pattern operation: either a regex operand
 * (for `matches`) or a plain value (for `contains`, `starts_with`, `ends_with`).
 */
export type ResolvedPatternRhs =
  | { readonly operator: "matches"; readonly operand: RegexOperand }
  | { readonly operator: "contains"; readonly value: unknown }
  | { readonly operator: "starts_with"; readonly value: unknown }
  | { readonly operator: "ends_with"; readonly value: unknown };

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
 * Evaluates pattern assertions. Stateless; one instance shared freely.
 * NEVER throws.
 */
export class PatternEvaluator {
  /**
   * Evaluate one pattern assertion.
   * @param op - The pattern operator.
   * @param lhs - The resolved LHS value.
   * @param rhs - The resolved RHS.
   * @returns A {@link GroupOutcome}.
   */
  evaluate(op: PatternOperator, lhs: ResolvedValue, rhs: ResolvedPatternRhs): GroupOutcome {
    if (!lhs.found) {
      return failWith(undefined, undefined, "TARGET_NOT_FOUND", `Target not found for '${op}'`);
    }
    const value = lhs.value;

    if (op === "matches") return this.#evalMatches(value, rhs);
    if (op === "contains") return this.#evalContains(value, rhs);
    if (op === "starts_with") return this.#evalStartsWith(value, rhs);
    return this.#evalEndsWith(value, rhs);
  }

  /**
   * `matches`: type gate (string only), length cap, then regex test.
   * @param lhs - The resolved LHS.
   * @param rhs - The RHS (must be operator:"matches").
   * @returns GroupOutcome.
   */
  #evalMatches(lhs: unknown, rhs: ResolvedPatternRhs): GroupOutcome {
    if (typeof lhs !== "string") {
      return failWith(
        "string",
        typeof lhs,
        "TYPE_MISMATCH",
        `'matches' requires a string, got '${typeof lhs}'`,
      );
    }
    if (rhs.operator !== "matches") {
      return failWith("regex", typeof lhs, "TYPE_MISMATCH", "RHS is not a regex operand");
    }
    const operand = rhs.operand;
    const expectedStr = `/${operand.source}/${operand.rawFlags}`;

    if (lhs.length > MAX_REGEX_TARGET_LENGTH) {
      return failWith(
        expectedStr,
        `<string of length ${lhs.length}>`,
        "REGEX_NO_MATCH",
        `Target string length ${lhs.length} exceeded the ` +
        `${MAX_REGEX_TARGET_LENGTH}-code-unit limit`,
      );
    }

    const re = new RegExp(operand.source, operand.rawFlags);
    if (re.test(lhs)) return passOk(expectedStr, lhs);
    return failWith(
      expectedStr,
      lhs,
      "REGEX_NO_MATCH",
      `String does not match ${expectedStr}`,
    );
  }

  /**
   * `contains`: string → substring check; array → deepEqual membership;
   * anything else → TYPE_MISMATCH.
   * @param lhs - The resolved LHS.
   * @param rhs - The RHS (must be operator:"contains").
   * @returns GroupOutcome.
   */
  #evalContains(lhs: unknown, rhs: ResolvedPatternRhs): GroupOutcome {
    if (rhs.operator !== "contains") {
      return failWith(undefined, lhs, "TYPE_MISMATCH", "Unexpected RHS kind for 'contains'");
    }
    const needle = rhs.value;

    if (typeof lhs === "string") {
      if (typeof needle !== "string") {
          return failWith(
          "string RHS",
          typeof needle,
          "TYPE_MISMATCH",
          "'contains' with string LHS requires string RHS",
        );
      }
      if (lhs.includes(needle)) return passOk(needle, lhs);
      return failWith(needle, lhs, "REGEX_NO_MATCH", `String does not contain '${needle}'`);
    }

    if (Array.isArray(lhs)) {
      const found = lhs.some((item) => deepEqual(item, needle));
      if (found) return passOk(needle, `<array[${lhs.length}]>`);
      return failWith(
        needle,
        `<array[${lhs.length}]>`,
        "REGEX_NO_MATCH",
        "Array does not contain the value",
      );
    }

    return failWith(
      "string or array",
      typeof lhs,
      "TYPE_MISMATCH",
      `'contains' requires string or array, got '${typeof lhs}'`,
    );
  }

  /**
   * `starts_with`: both LHS and RHS must be strings; uses `String.startsWith`.
   * @param lhs - The resolved LHS.
   * @param rhs - The RHS (must be operator:"starts_with").
   * @returns GroupOutcome.
   */
  #evalStartsWith(lhs: unknown, rhs: ResolvedPatternRhs): GroupOutcome {
    if (rhs.operator !== "starts_with") {
      return failWith(undefined, lhs, "TYPE_MISMATCH", "Unexpected RHS kind for 'starts_with'");
    }
    const prefix = rhs.value;
    if (typeof lhs !== "string") {
      return failWith("string", typeof lhs, "TYPE_MISMATCH", `'starts_with' requires string LHS`);
    }
    if (typeof prefix !== "string") {
      return failWith(
        "string operand",
        typeof prefix,
        "TYPE_MISMATCH",
        `'starts_with' requires string operand`,
      );
    }
    if (lhs.startsWith(prefix)) return passOk(prefix, lhs);
    return failWith(prefix, lhs, "REGEX_NO_MATCH", `String does not start with '${prefix}'`);
  }

  /**
   * `ends_with`: both LHS and RHS must be strings; uses `String.endsWith`.
   * @param lhs - The resolved LHS.
   * @param rhs - The RHS (must be operator:"ends_with").
   * @returns GroupOutcome.
   */
  #evalEndsWith(lhs: unknown, rhs: ResolvedPatternRhs): GroupOutcome {
    if (rhs.operator !== "ends_with") {
      return failWith(undefined, lhs, "TYPE_MISMATCH", "Unexpected RHS kind for 'ends_with'");
    }
    const suffix = rhs.value;
    if (typeof lhs !== "string") {
      return failWith("string", typeof lhs, "TYPE_MISMATCH", `'ends_with' requires string LHS`);
    }
    if (typeof suffix !== "string") {
      return failWith(
        "string operand",
        typeof suffix,
        "TYPE_MISMATCH",
        `'ends_with' requires string operand`,
      );
    }
    if (lhs.endsWith(suffix)) return passOk(suffix, lhs);
    return failWith(suffix, lhs, "REGEX_NO_MATCH", `String does not end with '${suffix}'`);
  }
}
