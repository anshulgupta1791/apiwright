import { describe, it, expect } from "vitest";

import { parseJson } from "../../../../src/core/safe-json.js";
import {
  ComparisonEvaluator,
} from "../../../../src/assertions/operators/comparison-evaluator.js";
import type {
  ComparisonRhs,
} from "../../../../src/assertions/operators/comparison-evaluator.js";
import type { ResolvedValue } from "../../../../src/assertions/target-resolver.js";

/**
 * Unit tests for ComparisonEvaluator.
 *
 * Covers: all 5 comparison operators, TARGET_NOT_FOUND on missing LHS,
 * TYPE_MISMATCH for non-finite numeric operands, COMPARISON_FAILED on clean
 * mismatches, no-coercion rule (201 vs "201"), inclusive in_range bounds,
 * NaN/Infinity/boolean/bigint/string as TYPE_MISMATCH, -0 edge cases,
 * deepEqual delegation, pass/fail shape contract, JSON round-trip,
 * defensive RHS-kind mismatch, determinism.
 */

function found(value: unknown): ResolvedValue {
  return { found: true, value };
}

const MISS: ResolvedValue = { found: false };

function comparand(v: unknown): ComparisonRhs {
  return { kind: "comparand", comparand: v };
}

function range(lo: number, hi: number): ComparisonRhs {
  return { kind: "range", lo, hi };
}

describe("ComparisonEvaluator", () => {
  const ev = new ComparisonEvaluator();

  // ---------------------------------------------------------------------------
  // Missing LHS — TARGET_NOT_FOUND for every operator
  // ---------------------------------------------------------------------------

  describe("missing LHS (found:false) → TARGET_NOT_FOUND for every operator", () => {
    const operators = ["equals", "not_equals", "greater_than", "less_than", "in_range"] as const;

    for (const op of operators) {
      it(`${op} with found:false → TARGET_NOT_FOUND`, () => {
        const rhs: ComparisonRhs = op === "in_range" ? range(0, 10) : comparand(1);
        const result = ev.evaluate(op, MISS, rhs);
        expect(result.pass).toBe(false);
        expect(result.failureCode).toBe("TARGET_NOT_FOUND");
        expect(result.reason).toBeTruthy();
      });
    }
  });

  // ---------------------------------------------------------------------------
  // equals / not_equals — deepEqual delegation, no coercion
  // ---------------------------------------------------------------------------

  describe("equals", () => {
    it("passes for identical numbers", () => {
      const r = ev.evaluate("equals", found(201), comparand(201));
      expect(r.pass).toBe(true);
      expect(r.failureCode).toBeUndefined();
      expect(r.reason).toBeUndefined();
    });

    it("fails for number vs string (no coercion) → COMPARISON_FAILED", () => {
      const r = ev.evaluate("equals", found(201), comparand("201"));
      expect(r.pass).toBe(false);
      expect(r.failureCode).toBe("COMPARISON_FAILED");
    });

    it("passes for objects with different key order (key-order-independent)", () => {
      const r = ev.evaluate("equals", found({ a: 1, b: 2 }), comparand({ b: 2, a: 1 }));
      expect(r.pass).toBe(true);
    });

    it("fails for arrays with different order", () => {
      const r = ev.evaluate("equals", found([1, 2, 3]), comparand([3, 2, 1]));
      expect(r.pass).toBe(false);
      expect(r.failureCode).toBe("COMPARISON_FAILED");
    });

    it("passes for explicit null equals null (found:true,value:null is NOT missing)", () => {
      const r = ev.evaluate("equals", found(null), comparand(null));
      expect(r.pass).toBe(true);
    });

    it("fails for null vs 0 → COMPARISON_FAILED (type-strict)", () => {
      const r = ev.evaluate("equals", found(null), comparand(0));
      expect(r.pass).toBe(false);
      expect(r.failureCode).toBe("COMPARISON_FAILED");
    });

    it("passes for NaN equals NaN (deepEqual reflexive rule)", () => {
      const r = ev.evaluate("equals", found(NaN), comparand(NaN));
      expect(r.pass).toBe(true);
    });

    it("passes for -0 equals +0 (SameValueZero via deepEqual)", () => {
      const r = ev.evaluate("equals", found(-0), comparand(0));
      expect(r.pass).toBe(true);
    });

    it("expected field is the resolved comparand value", () => {
      const r = ev.evaluate("equals", found(5), comparand(5));
      expect(r.expected).toBe(5);
      expect(r.actual).toBe(5);
    });
  });

  describe("not_equals", () => {
    it("passes for 201 vs \"201\" (exact negation of equals)", () => {
      const r = ev.evaluate("not_equals", found(201), comparand("201"));
      expect(r.pass).toBe(true);
    });

    it("fails when values are equal → COMPARISON_FAILED", () => {
      const r = ev.evaluate("not_equals", found(5), comparand(5));
      expect(r.pass).toBe(false);
      expect(r.failureCode).toBe("COMPARISON_FAILED");
    });

    it("passes for arrays of different length (deepEqual negated)", () => {
      const r = ev.evaluate("not_equals", found([1, 2]), comparand([1, 2, 3]));
      expect(r.pass).toBe(true);
    });

    it("fails for found:true,null vs null (explicit null equals null, negation false)", () => {
      const r = ev.evaluate("not_equals", found(null), comparand(null));
      expect(r.pass).toBe(false);
      expect(r.failureCode).toBe("COMPARISON_FAILED");
    });

    it("does NOT produce TYPE_MISMATCH — type-strictness is just COMPARISON_FAILED", () => {
      const r = ev.evaluate("not_equals", found(1), comparand("1"));
      // passes because they are not equal; no TYPE_MISMATCH either way
      expect(r.pass).toBe(true);
      expect(r.failureCode).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // greater_than / less_than — both-operands-must-be-finite-number rule
  // ---------------------------------------------------------------------------

  describe("greater_than", () => {
    it("passes when actual > comparand (both finite numbers)", () => {
      const r = ev.evaluate("greater_than", found(5), comparand(3));
      expect(r.pass).toBe(true);
    });

    it("fails with COMPARISON_FAILED when predicate false", () => {
      const r = ev.evaluate("greater_than", found(3), comparand(5));
      expect(r.pass).toBe(false);
      expect(r.failureCode).toBe("COMPARISON_FAILED");
    });

    it("fails with TYPE_MISMATCH when actual is a string (no coercion)", () => {
      const r = ev.evaluate("greater_than", found("5"), comparand(3));
      expect(r.pass).toBe(false);
      expect(r.failureCode).toBe("TYPE_MISMATCH");
    });

    it("fails with TYPE_MISMATCH when comparand is a string", () => {
      const r = ev.evaluate("greater_than", found(5), comparand("3"));
      expect(r.pass).toBe(false);
      expect(r.failureCode).toBe("TYPE_MISMATCH");
    });

    it("fails with TYPE_MISMATCH when actual is NaN", () => {
      const r = ev.evaluate("greater_than", found(NaN), comparand(1));
      expect(r.failureCode).toBe("TYPE_MISMATCH");
    });

    it("fails with TYPE_MISMATCH when actual is Infinity", () => {
      const r = ev.evaluate("greater_than", found(Infinity), comparand(1));
      expect(r.failureCode).toBe("TYPE_MISMATCH");
    });

    it("fails with TYPE_MISMATCH when actual is a boolean", () => {
      const r = ev.evaluate("greater_than", found(true), comparand(0));
      expect(r.failureCode).toBe("TYPE_MISMATCH");
    });

    it("fails with TYPE_MISMATCH when actual is a bigint", () => {
      const r = ev.evaluate("greater_than", found(1n), comparand(0));
      expect(r.failureCode).toBe("TYPE_MISMATCH");
    });
  });

  describe("less_than", () => {
    it("passes when actual < comparand", () => {
      const r = ev.evaluate("less_than", found(2), comparand(10));
      expect(r.pass).toBe(true);
    });

    it("fails with TYPE_MISMATCH for boolean actual", () => {
      const r = ev.evaluate("less_than", found(true), comparand(1));
      expect(r.failureCode).toBe("TYPE_MISMATCH");
    });

    it("fails with TYPE_MISMATCH for Infinity actual", () => {
      const r = ev.evaluate("less_than", found(Infinity), comparand(1));
      expect(r.failureCode).toBe("TYPE_MISMATCH");
    });

    it("-0 < 0 is false → COMPARISON_FAILED (not TYPE_MISMATCH; -0 is a valid number)", () => {
      const r = ev.evaluate("less_than", found(-0), comparand(0));
      expect(r.pass).toBe(false);
      expect(r.failureCode).toBe("COMPARISON_FAILED");
    });
  });

  // ---------------------------------------------------------------------------
  // in_range — inclusive [lo, hi]
  // ---------------------------------------------------------------------------

  describe("in_range", () => {
    it("passes at exactly lo (inclusive lower bound)", () => {
      const r = ev.evaluate("in_range", found(100), range(100, 599));
      expect(r.pass).toBe(true);
    });

    it("passes at exactly hi (inclusive upper bound)", () => {
      const r = ev.evaluate("in_range", found(599), range(100, 599));
      expect(r.pass).toBe(true);
    });

    it("passes strictly inside", () => {
      const r = ev.evaluate("in_range", found(300), range(100, 599));
      expect(r.pass).toBe(true);
    });

    it("fails just below lo → COMPARISON_FAILED", () => {
      const r = ev.evaluate("in_range", found(99), range(100, 599));
      expect(r.pass).toBe(false);
      expect(r.failureCode).toBe("COMPARISON_FAILED");
    });

    it("fails just above hi → COMPARISON_FAILED", () => {
      const r = ev.evaluate("in_range", found(600), range(100, 599));
      expect(r.pass).toBe(false);
      expect(r.failureCode).toBe("COMPARISON_FAILED");
    });

    it("passes for degenerate single-point range (lo === hi)", () => {
      const r = ev.evaluate("in_range", found(42), range(42, 42));
      expect(r.pass).toBe(true);
    });

    it("fails with TYPE_MISMATCH for string actual", () => {
      const r = ev.evaluate("in_range", found("300"), range(100, 599));
      expect(r.failureCode).toBe("TYPE_MISMATCH");
    });

    it("fails with TYPE_MISMATCH for boolean actual", () => {
      const r = ev.evaluate("in_range", found(true), range(0, 1));
      expect(r.failureCode).toBe("TYPE_MISMATCH");
    });

    it("fails with TYPE_MISMATCH for NaN actual", () => {
      const r = ev.evaluate("in_range", found(NaN), range(0, 10));
      expect(r.failureCode).toBe("TYPE_MISMATCH");
    });

    it("-0 actual passes in_range [0, 10] (finite; -0 <= 0 <= 10 both true)", () => {
      const r = ev.evaluate("in_range", found(-0), range(0, 10));
      expect(r.pass).toBe(true);
    });

    it("expected field is {lo, hi} object for in_range", () => {
      const r = ev.evaluate("in_range", found(5), range(0, 10));
      expect(r.expected).toEqual({ lo: 0, hi: 10 });
    });
  });

  // ---------------------------------------------------------------------------
  // Pass shape — failureCode and reason ABSENT on pass
  // ---------------------------------------------------------------------------

  describe("pass shape contract", () => {
    it("equals PASS has no failureCode and no reason", () => {
      const r = ev.evaluate("equals", found(1), comparand(1));
      expect(r.pass).toBe(true);
      expect(r.failureCode).toBeUndefined();
      expect(r.reason).toBeUndefined();
    });

    it("in_range PASS has no failureCode and no reason", () => {
      const r = ev.evaluate("in_range", found(5), range(0, 10));
      expect(r.pass).toBe(true);
      expect(r.failureCode).toBeUndefined();
      expect(r.reason).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Defensive: RHS kind mismatch → TYPE_MISMATCH, no throw
  // ---------------------------------------------------------------------------

  describe("defensive RHS-kind mismatch", () => {
    it("in_range with kind:comparand → TYPE_MISMATCH, no throw", () => {
      expect(() => {
        const r = ev.evaluate("in_range", found(5), comparand(5));
        expect(r.failureCode).toBe("TYPE_MISMATCH");
      }).not.toThrow();
    });

    it("equals with kind:range → TYPE_MISMATCH, no throw", () => {
      expect(() => {
        const r = ev.evaluate("equals", found(5), range(0, 10));
        expect(r.failureCode).toBe("TYPE_MISMATCH");
      }).not.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // JSON round-trip of GroupOutcome
  // ---------------------------------------------------------------------------

  describe("JSON round-trip", () => {
    it("pass result round-trips through parseJson", () => {
      const r = ev.evaluate("equals", found(42), comparand(42));
      const parsed = parseJson(JSON.stringify(r));
      expect(parsed.ok).toBe(true);
      if (parsed.ok) {
        expect(parsed.value).toEqual(r);
      }
    });

    it("fail result round-trips through parseJson", () => {
      const r = ev.evaluate("equals", found(1), comparand(2));
      const parsed = parseJson(JSON.stringify(r));
      expect(parsed.ok).toBe(true);
      if (parsed.ok) {
        expect(parsed.value).toEqual(r);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Determinism
  // ---------------------------------------------------------------------------

  describe("determinism", () => {
    it("identical inputs produce identical result on repeated calls", () => {
      const r1 = ev.evaluate("in_range", found(200), range(100, 300));
      const r2 = ev.evaluate("in_range", found(200), range(100, 300));
      expect(r1).toEqual(r2);
    });
  });
});
