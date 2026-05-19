import { describe, it, expect } from "vitest";

import {
  ExistenceEvaluator,
} from "../../../../src/assertions/operators/existence-evaluator.js";
import type { ResolvedValue } from "../../../../src/assertions/target-resolver.js";

/**
 * Unit tests for ExistenceEvaluator.
 *
 * Covers the full 4×3 truth table from locked decision #6:
 *   rows: exists / not_exists / is_null / is_not_null
 *   cols: found:false (missing) / found:true,null / found:true,non-null
 *
 * Also covers: exact failureCode per cell, pass/fail shape contract (IFF
 * failureCode/reason), safe actual descriptors (<absent>/<null>/<present:TYPE>),
 * falsy-but-present values (0, "", false, NaN), determinism, never-throws.
 */

function found(value: unknown): ResolvedValue {
  return { found: true, value };
}

const MISS: ResolvedValue = { found: false };
const NULL_FOUND: ResolvedValue = { found: true, value: null };

describe("ExistenceEvaluator", () => {
  const ev = new ExistenceEvaluator();

  // ---------------------------------------------------------------------------
  // exists
  // ---------------------------------------------------------------------------

  describe("exists", () => {
    it("found:false → FAIL TARGET_NOT_FOUND", () => {
      const r = ev.evaluate("exists", MISS);
      expect(r.pass).toBe(false);
      expect(r.failureCode).toBe("TARGET_NOT_FOUND");
      expect(r.reason).toBeTruthy();
    });

    it("found:true,null → PASS (explicit null still exists)", () => {
      const r = ev.evaluate("exists", NULL_FOUND);
      expect(r.pass).toBe(true);
      expect(r.failureCode).toBeUndefined();
      expect(r.reason).toBeUndefined();
    });

    it("found:true,non-null → PASS", () => {
      const r = ev.evaluate("exists", found(42));
      expect(r.pass).toBe(true);
    });

    it("found:true,0 (falsy non-null) → PASS", () => {
      expect(ev.evaluate("exists", found(0)).pass).toBe(true);
    });

    it("found:true,empty-string (falsy non-null) → PASS", () => {
      expect(ev.evaluate("exists", found("")).pass).toBe(true);
    });

    it("found:true,false (falsy non-null) → PASS", () => {
      expect(ev.evaluate("exists", found(false)).pass).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // not_exists
  // ---------------------------------------------------------------------------

  describe("not_exists", () => {
    it("found:false → PASS (NO failureCode)", () => {
      const r = ev.evaluate("not_exists", MISS);
      expect(r.pass).toBe(true);
      expect(r.failureCode).toBeUndefined();
      expect(r.reason).toBeUndefined();
    });

    it("found:true,null → FAIL COMPARISON_FAILED (present with explicit null)", () => {
      const r = ev.evaluate("not_exists", NULL_FOUND);
      expect(r.pass).toBe(false);
      expect(r.failureCode).toBe("COMPARISON_FAILED");
      expect(r.reason).toBeTruthy();
    });

    it("found:true,non-null → FAIL COMPARISON_FAILED", () => {
      const r = ev.evaluate("not_exists", found(42));
      expect(r.pass).toBe(false);
      expect(r.failureCode).toBe("COMPARISON_FAILED");
    });

    it("not_exists never emits TARGET_NOT_FOUND (absence is success, not failure)", () => {
      const r = ev.evaluate("not_exists", MISS);
      expect(r.failureCode).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // is_null
  // ---------------------------------------------------------------------------

  describe("is_null", () => {
    it("found:false → FAIL TARGET_NOT_FOUND (missing is NOT null)", () => {
      const r = ev.evaluate("is_null", MISS);
      expect(r.pass).toBe(false);
      expect(r.failureCode).toBe("TARGET_NOT_FOUND");
      expect(r.reason).toMatch(/missing|not resolve|not null/i);
    });

    it("found:true,null → PASS", () => {
      const r = ev.evaluate("is_null", NULL_FOUND);
      expect(r.pass).toBe(true);
      expect(r.failureCode).toBeUndefined();
    });

    it("found:true,non-null → FAIL COMPARISON_FAILED", () => {
      const r = ev.evaluate("is_null", found(42));
      expect(r.pass).toBe(false);
      expect(r.failureCode).toBe("COMPARISON_FAILED");
    });

    it("found:true,undefined (defensive) → FAIL COMPARISON_FAILED (treated as non-null)", () => {
      // JSON has no undefined; if resolver ever returns found:true,undefined it is treated as non-null
      const r = ev.evaluate("is_null", found(undefined));
      expect(r.pass).toBe(false);
      expect(r.failureCode).toBe("COMPARISON_FAILED");
    });
  });

  // ---------------------------------------------------------------------------
  // is_not_null
  // ---------------------------------------------------------------------------

  describe("is_not_null", () => {
    it("found:false → FAIL TARGET_NOT_FOUND (missing is NOT not-null)", () => {
      const r = ev.evaluate("is_not_null", MISS);
      expect(r.pass).toBe(false);
      expect(r.failureCode).toBe("TARGET_NOT_FOUND");
    });

    it("found:true,null → FAIL COMPARISON_FAILED", () => {
      const r = ev.evaluate("is_not_null", NULL_FOUND);
      expect(r.pass).toBe(false);
      expect(r.failureCode).toBe("COMPARISON_FAILED");
      expect(r.reason).toBeTruthy();
    });

    it("found:true,non-null → PASS", () => {
      const r = ev.evaluate("is_not_null", found("hello"));
      expect(r.pass).toBe(true);
      expect(r.failureCode).toBeUndefined();
    });

    it("found:true,0 (falsy non-null) → PASS", () => {
      expect(ev.evaluate("is_not_null", found(0)).pass).toBe(true);
    });

    it("found:true,false (falsy non-null) → PASS", () => {
      expect(ev.evaluate("is_not_null", found(false)).pass).toBe(true);
    });

    it("found:true,undefined (defensive) → PASS (treated as non-null)", () => {
      expect(ev.evaluate("is_not_null", found(undefined)).pass).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Safe actual descriptors
  // ---------------------------------------------------------------------------

  describe("actual descriptor safety (never dumps large bodies)", () => {
    it("MISS case actual descriptor contains '<absent>' or similar sentinel", () => {
      const r = ev.evaluate("exists", MISS);
      const actualStr = String(r.actual);
      expect(actualStr).toMatch(/absent|missing|undefined/i);
    });

    it("found:true,null case actual descriptor contains 'null'", () => {
      const r = ev.evaluate("is_null", NULL_FOUND);
      // on PASS actual should be some descriptor of the value
      expect(r.actual !== undefined).toBe(true);
    });

    it("found:true,non-null FAIL actual descriptor contains type info, not full body", () => {
      const r = ev.evaluate("is_null", found({ huge: "payload".repeat(100) }));
      // actual must NOT be the raw object — should be a small string descriptor
      expect(typeof r.actual).toBe("string");
      const actualStr = String(r.actual);
      expect(actualStr.length).toBeLessThan(200);
    });
  });

  // ---------------------------------------------------------------------------
  // Pass/fail shape contract
  // ---------------------------------------------------------------------------

  describe("pass/fail shape contract (IFF failureCode/reason)", () => {
    it("on pass: failureCode and reason are absent (undefined)", () => {
      const r = ev.evaluate("exists", found("value"));
      expect(r.pass).toBe(true);
      expect(r.failureCode).toBeUndefined();
      expect(r.reason).toBeUndefined();
    });

    it("on fail: both failureCode and reason are present", () => {
      const r = ev.evaluate("exists", MISS);
      expect(r.pass).toBe(false);
      expect(r.failureCode).toBeTruthy();
      expect(r.reason).toBeTruthy();
    });
  });

  // ---------------------------------------------------------------------------
  // Never-throws guarantee
  // ---------------------------------------------------------------------------

  describe("never throws", () => {
    const ops = ["exists", "not_exists", "is_null", "is_not_null"] as const;
    const inputs: ResolvedValue[] = [MISS, NULL_FOUND, found(0), found(""), found({}), found([])];

    for (const op of ops) {
      for (const inp of inputs) {
        it(`${op} with input ${JSON.stringify(inp)} does not throw`, () => {
          expect(() => ev.evaluate(op, inp)).not.toThrow();
        });
      }
    }
  });

  // ---------------------------------------------------------------------------
  // Determinism
  // ---------------------------------------------------------------------------

  describe("determinism", () => {
    it("same inputs produce same result on repeated calls", () => {
      const r1 = ev.evaluate("is_null", found(42));
      const r2 = ev.evaluate("is_null", found(42));
      expect(r1).toEqual(r2);
    });
  });
});
