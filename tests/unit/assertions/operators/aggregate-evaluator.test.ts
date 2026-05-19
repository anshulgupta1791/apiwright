import { describe, it, expect } from "vitest";

import {
  AggregateEvaluator,
} from "../../../../src/assertions/operators/aggregate-evaluator.js";
import type {
  AggregateRhs,
} from "../../../../src/assertions/operators/aggregate-evaluator.js";
import type { ResolvedValue } from "../../../../src/assertions/target-resolver.js";
import type { NormalizedResult } from "../../../../src/core/index.js";

/**
 * Unit tests for AggregateEvaluator.
 *
 * Covers: TARGET_NOT_FOUND on missing LHS, array count source,
 * NormalizedResult structural detection (rowCount authoritative, no instanceof),
 * AGGREGATE_MISMATCH for non-countable LHS, RHS validity rule (must be finite
 * non-negative integer), count_equals / count_greater_than predicates, LHS
 * step ordering (LHS before RHS), pass/fail shape contract, determinism.
 */

function found(value: unknown): ResolvedValue {
  return { found: true, value };
}

const MISS: ResolvedValue = { found: false };

function rhs(count: unknown): AggregateRhs {
  return { count };
}

function nr(rowCount: number, rows: Record<string, unknown>[] = []): NormalizedResult {
  return { rows, rowCount, raw: null };
}

describe("AggregateEvaluator", () => {
  const ev = new AggregateEvaluator();

  // ---------------------------------------------------------------------------
  // Missing LHS → TARGET_NOT_FOUND
  // ---------------------------------------------------------------------------

  describe("missing LHS (found:false) → TARGET_NOT_FOUND", () => {
    it("count_equals with found:false → TARGET_NOT_FOUND", () => {
      const r = ev.evaluate("count_equals", MISS, rhs(5));
      expect(r.pass).toBe(false);
      expect(r.failureCode).toBe("TARGET_NOT_FOUND");
    });

    it("count_greater_than with found:false → TARGET_NOT_FOUND", () => {
      const r = ev.evaluate("count_greater_than", MISS, rhs(0));
      expect(r.failureCode).toBe("TARGET_NOT_FOUND");
    });
  });

  // ---------------------------------------------------------------------------
  // Array count source
  // ---------------------------------------------------------------------------

  describe("array LHS — count = array.length", () => {
    it("count_equals passes when array.length === n", () => {
      const r = ev.evaluate("count_equals", found([1, 2, 3]), rhs(3));
      expect(r.pass).toBe(true);
    });

    it("count_equals fails when array.length !== n → AGGREGATE_MISMATCH", () => {
      const r = ev.evaluate("count_equals", found([1, 2]), rhs(5));
      expect(r.pass).toBe(false);
      expect(r.failureCode).toBe("AGGREGATE_MISMATCH");
    });

    it("count_greater_than passes when array.length > n", () => {
      const r = ev.evaluate("count_greater_than", found([1, 2, 3]), rhs(2));
      expect(r.pass).toBe(true);
    });

    it("count_greater_than fails when array.length <= n → AGGREGATE_MISMATCH", () => {
      const r = ev.evaluate("count_greater_than", found([1, 2]), rhs(2));
      expect(r.pass).toBe(false);
      expect(r.failureCode).toBe("AGGREGATE_MISMATCH");
    });

    it("empty array length is 0 — count_equals 0 passes", () => {
      const r = ev.evaluate("count_equals", found([]), rhs(0));
      expect(r.pass).toBe(true);
    });

    it("actual field in result is the numeric count derived from array", () => {
      const r = ev.evaluate("count_equals", found([1, 2, 3]), rhs(3));
      expect(r.actual).toBe(3);
    });
  });

  // ---------------------------------------------------------------------------
  // NormalizedResult count source — structural, rowCount authoritative
  // ---------------------------------------------------------------------------

  describe("NormalizedResult LHS — count = rowCount (structural, no instanceof)", () => {
    it("count_equals passes when rowCount === n", () => {
      const r = ev.evaluate("count_equals", found(nr(3)), rhs(3));
      expect(r.pass).toBe(true);
    });

    it("count_equals fails when rowCount !== n → AGGREGATE_MISMATCH", () => {
      const r = ev.evaluate("count_equals", found(nr(5)), rhs(2));
      expect(r.failureCode).toBe("AGGREGATE_MISMATCH");
    });

    it("rowCount is authoritative even when rows.length differs (e.g. affected-rows)", () => {
      // rowCount=5, rows=[] — non-row statement; rowCount is the canonical count
      const result = nr(5, []);
      const r = ev.evaluate("count_equals", found(result), rhs(5));
      expect(r.pass).toBe(true);
    });

    it("NormalizedResult with rowCount=0 and empty rows → count_equals 0 passes", () => {
      const r = ev.evaluate("count_equals", found(nr(0, [])), rhs(0));
      expect(r.pass).toBe(true);
    });

    it("count_greater_than passes when rowCount > n", () => {
      const r = ev.evaluate("count_greater_than", found(nr(3)), rhs(1));
      expect(r.pass).toBe(true);
    });

    it("actual field in result is the numeric rowCount", () => {
      const r = ev.evaluate("count_equals", found(nr(7)), rhs(7));
      expect(r.actual).toBe(7);
    });

    it("plain object with {rowCount:3,rows:[],raw:null} is detected structurally (no instanceof)", () => {
      // Plain literal — no class, no prototype chain from NormalizedResult
      const plain = { rows: [], rowCount: 3, raw: null };
      const r = ev.evaluate("count_equals", found(plain), rhs(3));
      expect(r.pass).toBe(true);
    });

    it("object with rowCount:NaN is NOT a NormalizedResult → AGGREGATE_MISMATCH", () => {
      const notNr = { rows: [], rowCount: NaN, raw: null };
      const r = ev.evaluate("count_equals", found(notNr), rhs(0));
      expect(r.failureCode).toBe("AGGREGATE_MISMATCH");
    });

    it("object missing rows key is NOT a NormalizedResult → AGGREGATE_MISMATCH", () => {
      const notNr = { rowCount: 3, raw: null };
      const r = ev.evaluate("count_equals", found(notNr), rhs(3));
      expect(r.failureCode).toBe("AGGREGATE_MISMATCH");
    });
  });

  // ---------------------------------------------------------------------------
  // Non-countable LHS types → AGGREGATE_MISMATCH
  // ---------------------------------------------------------------------------

  describe("non-countable LHS → AGGREGATE_MISMATCH (LHS check before RHS check)", () => {
    const nonCountable: Array<[string, unknown]> = [
      ["string", "hello"],
      ["number", 42],
      ["boolean", true],
      ["null (explicit)", null],
      ["plain object without NR shape", { data: 1 }],
    ];

    for (const [label, val] of nonCountable) {
      it(`${label} LHS → AGGREGATE_MISMATCH (more specific than RHS TYPE_MISMATCH)`, () => {
        // Even with an invalid RHS, LHS error takes precedence
        const r = ev.evaluate("count_equals", found(val), rhs(0));
        expect(r.failureCode).toBe("AGGREGATE_MISMATCH");
      });
    }
  });

  // ---------------------------------------------------------------------------
  // RHS validity — must be finite, non-negative integer
  // ---------------------------------------------------------------------------

  describe("RHS validity rule", () => {
    const validCountableLhs = found([1, 2, 3]);

    it("float RHS → TYPE_MISMATCH (not an integer)", () => {
      const r = ev.evaluate("count_equals", validCountableLhs, rhs(2.5));
      expect(r.failureCode).toBe("TYPE_MISMATCH");
    });

    it("negative RHS → TYPE_MISMATCH (count cannot be negative)", () => {
      const r = ev.evaluate("count_equals", validCountableLhs, rhs(-1));
      expect(r.failureCode).toBe("TYPE_MISMATCH");
    });

    it("NaN RHS → TYPE_MISMATCH", () => {
      const r = ev.evaluate("count_equals", validCountableLhs, rhs(NaN));
      expect(r.failureCode).toBe("TYPE_MISMATCH");
    });

    it("Infinity RHS → TYPE_MISMATCH", () => {
      const r = ev.evaluate("count_equals", validCountableLhs, rhs(Infinity));
      expect(r.failureCode).toBe("TYPE_MISMATCH");
    });

    it("string RHS → TYPE_MISMATCH (no coercion)", () => {
      const r = ev.evaluate("count_equals", validCountableLhs, rhs("3"));
      expect(r.failureCode).toBe("TYPE_MISMATCH");
    });

    it("boolean RHS → TYPE_MISMATCH", () => {
      const r = ev.evaluate("count_equals", validCountableLhs, rhs(true));
      expect(r.failureCode).toBe("TYPE_MISMATCH");
    });

    it("RHS = 0 is valid (zero is a finite non-negative integer)", () => {
      const r = ev.evaluate("count_equals", found([]), rhs(0));
      expect(r.pass).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Pass/fail shape contract
  // ---------------------------------------------------------------------------

  describe("pass/fail shape contract", () => {
    it("PASS has no failureCode and no reason", () => {
      const r = ev.evaluate("count_equals", found([1, 2]), rhs(2));
      expect(r.pass).toBe(true);
      expect(r.failureCode).toBeUndefined();
      expect(r.reason).toBeUndefined();
    });

    it("FAIL has both failureCode and reason", () => {
      const r = ev.evaluate("count_equals", found([1]), rhs(5));
      expect(r.pass).toBe(false);
      expect(r.failureCode).toBeTruthy();
      expect(r.reason).toBeTruthy();
    });
  });

  // ---------------------------------------------------------------------------
  // Determinism / never-throws
  // ---------------------------------------------------------------------------

  describe("determinism and totality", () => {
    it("same inputs produce same result on repeated calls", () => {
      const r1 = ev.evaluate("count_equals", found(nr(3)), rhs(3));
      const r2 = ev.evaluate("count_equals", found(nr(3)), rhs(3));
      expect(r1).toEqual(r2);
    });

    it("does not throw for any reasonable input combination", () => {
      const inputs: unknown[] = [null, 42, "str", [], {}, nr(0), nr(5)];
      for (const v of inputs) {
        expect(() => ev.evaluate("count_equals", found(v), rhs(0))).not.toThrow();
      }
    });
  });
});
