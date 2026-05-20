import { describe, it, expect } from "vitest";

import {
  deepEqual,
  DEEP_EQUAL_MAX_DEPTH,
} from "../../../src/core/deep-equal.js";

/**
 * Unit tests for deepEqual and DEEP_EQUAL_MAX_DEPTH — promoted to src/core.
 *
 * This file is the RELOCATED + REPOINTED version of
 * `tests/unit/assertions/deep-equal.test.ts`. The import now targets
 * `src/core/deep-equal.js` (the promoted SSOT). Every assertion, describe
 * block, and it() name is preserved byte-for-byte; only the import specifier
 * changed (from `../../../src/assertions/deep-equal.js` to
 * `../../../src/core/deep-equal.js`).
 *
 * Covers: DEEP_EQUAL_MAX_DEPTH constant, default-constant seam (call without
 * options), primitive matrix (same-type equality), type-strict no-coercion
 * cases (design edge cases 4–9, 13, 36), NaN/-0 rules (12, 14), array branch
 * (2, 16–18, 29, 30), and determinism.
 *
 * Depth guard, cycle guard, object branch, category cross-product, out-of-domain
 * totality, and reflexivity are in deep-equal-advanced.test.ts (split for
 * the 300-line file cap).
 *
 * RED PHASE: this file imports from src/core/deep-equal.js which does not
 * exist yet. Tests fail with module-not-found until the implementation-engineer
 * creates src/core/deep-equal.ts.
 */
describe("DEEP_EQUAL_MAX_DEPTH", () => {
  it("exports the depth constant as a plain number equal to 200", () => {
    expect(DEEP_EQUAL_MAX_DEPTH).toBe(200);
    expect(typeof DEEP_EQUAL_MAX_DEPTH).toBe("number");
  });
});

describe("deepEqual", () => {
  // ---- Default constant path (no options) — exercises ?? DEEP_EQUAL_MAX_DEPTH seam ---
  describe("called without options — exercises the default maxDepth seam", () => {
    it("returns true for two equal primitive values without passing options", () => {
      expect(deepEqual(42, 42)).toBe(true);
    });

    it("returns false for two unequal primitives without passing options", () => {
      expect(deepEqual(1, 2)).toBe(false);
    });
  });

  // ---- Primitives: identical value and type (edge case 15) ---------------------------
  describe("primitives — identical value and type", () => {
    it("returns true for equal numbers", () => {
      expect(deepEqual(1, 1)).toBe(true);
    });

    it("returns true for equal strings", () => {
      expect(deepEqual("hello", "hello")).toBe(true);
    });

    it("returns true for equal booleans (true)", () => {
      expect(deepEqual(true, true)).toBe(true);
    });

    it("returns true for equal booleans (false)", () => {
      expect(deepEqual(false, false)).toBe(true);
    });

    it("returns true for null vs null (edge case 10)", () => {
      expect(deepEqual(null, null)).toBe(true);
    });

    it("returns true for undefined vs undefined (edge case 11)", () => {
      expect(deepEqual(undefined, undefined)).toBe(true);
    });
  });

  // ---- Type-strict / no-coercion (edge cases 4–9, 13, 36) ---------------------------
  describe("primitives — type-strict, no coercion", () => {
    it("returns false for number 201 vs string '201' (edge case 4)", () => {
      expect(deepEqual(201, "201")).toBe(false);
    });

    it("returns false for boolean true vs string 'true' (edge case 5)", () => {
      expect(deepEqual(true, "true")).toBe(false);
    });

    it("returns false for number 0 vs boolean false (edge case 6)", () => {
      expect(deepEqual(0, false)).toBe(false);
    });

    it("returns false for number 0 vs empty string (edge case 7)", () => {
      expect(deepEqual(0, "")).toBe(false);
    });

    it("returns false for null vs undefined (edge case 8)", () => {
      expect(deepEqual(null, undefined)).toBe(false);
    });

    it("returns false for null vs number 0 (edge case 9a)", () => {
      expect(deepEqual(null, 0)).toBe(false);
    });

    it("returns false for null vs empty string (edge case 9b)", () => {
      expect(deepEqual(null, "")).toBe(false);
    });

    it("returns false for null vs empty object (edge case 9c)", () => {
      expect(deepEqual(null, {})).toBe(false);
    });

    it("returns false for NaN vs 0 (edge case 13)", () => {
      expect(deepEqual(NaN, 0)).toBe(false);
    });

    it("returns false for bigint 1n vs number 1 (edge case 36, total but out-of-domain)", () => {
      expect(deepEqual(BigInt(1), 1)).toBe(false);
    });
  });

  // ---- NaN reflexivity and -0/+0 (edge cases 12, 14) --------------------------------
  describe("NaN and zero edge cases", () => {
    it("returns true for NaN vs NaN (SameValueZero reflexivity, edge case 12)", () => {
      expect(deepEqual(NaN, NaN)).toBe(true);
    });

    it("returns true for -0 vs +0 (JSON has no negative-zero, edge case 14)", () => {
      expect(deepEqual(-0, +0)).toBe(true);
    });

    it("returns true for +0 vs -0 symmetry", () => {
      expect(deepEqual(+0, -0)).toBe(true);
    });
  });

  // ---- Array branch (edge cases 2, 16–18, 29, 30) ------------------------------------
  describe("arrays", () => {
    it("returns false for empty object vs empty array (edge case 1)", () => {
      expect(deepEqual({}, [])).toBe(false);
    });

    it("returns true for two empty arrays (edge case 2)", () => {
      expect(deepEqual([], [])).toBe(true);
    });

    it("returns false for order-reversed arrays (edge case 16)", () => {
      expect(deepEqual([1, 2, 3], [3, 2, 1])).toBe(false);
    });

    it("returns true for element-wise equal arrays in order (edge case 17)", () => {
      expect(deepEqual([1, 2, 3], [1, 2, 3])).toBe(true);
    });

    it("returns false when arrays have different lengths (edge case 18)", () => {
      expect(deepEqual([1, 2], [1, 2, 3])).toBe(false);
    });

    it("returns true for sparse array hole vs undefined at same index (edge case 29)", () => {
      // eslint-disable-next-line no-sparse-arrays
      expect(deepEqual([, 1], [undefined, 1])).toBe(true);
    });

    it("returns false for sparse array hole vs 0 at same index (edge case 30)", () => {
      // eslint-disable-next-line no-sparse-arrays
      expect(deepEqual([, 1], [0, 1])).toBe(false);
    });

    it("returns true for nested arrays with equal content", () => {
      expect(deepEqual([[1, 2], [3]], [[1, 2], [3]])).toBe(true);
    });

    it("returns false for nested arrays with different content", () => {
      expect(deepEqual([[1, 2], [3]], [[1, 2], [4]])).toBe(false);
    });

    it("returns false for non-empty array vs object with numeric keys", () => {
      expect(deepEqual([1], { 0: 1 })).toBe(false);
    });
  });

  // ---- Determinism --------------------------------------------------------------------
  describe("determinism — identical inputs always yield the same result", () => {
    it("returns the same value on two successive calls with equal arrays", () => {
      const a = [1, { b: 2 }, null];
      const b = [1, { b: 2 }, null];
      const r1 = deepEqual(a, b);
      const r2 = deepEqual(a, b);
      expect(r1).toBe(r2);
    });

    it("returns the same value on two successive calls with unequal objects", () => {
      const r1 = deepEqual({ x: 1 }, { x: 2 });
      const r2 = deepEqual({ x: 1 }, { x: 2 });
      expect(r1).toBe(r2);
      expect(r1).toBe(false);
    });
  });
});
