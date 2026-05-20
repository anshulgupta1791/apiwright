import { describe, it, expect } from "vitest";

import { deepEqual } from "../../../src/core/deep-equal.js";

/**
 * Unit tests for deepEqual — Part 2 (advanced cases), promoted to src/core.
 *
 * This file is the RELOCATED + REPOINTED version of
 * `tests/unit/assertions/deep-equal-advanced.test.ts`. The import now targets
 * `src/core/deep-equal.js` (the promoted SSOT). Every assertion, describe
 * block, and it() name is preserved byte-for-byte; only the import specifier
 * changed (from `../../../src/assertions/deep-equal.js` to
 * `../../../src/core/deep-equal.js`).
 *
 * Covers: plain object branch (edge cases 3, 19–24, 31–34), depth guard
 * (edge cases 25–26, both arms: exceeded and boundary), cycle guard (edge
 * cases 27–28: self-referential, copies, and acyclic shared DAG), reflexivity
 * (edge case 35), and out-of-domain totality (Date, function, Symbol).
 *
 * Primitive / array / constant tests are in deep-equal.test.ts (split for
 * the 300-line file cap).
 *
 * RED PHASE: this file imports from src/core/deep-equal.js which does not
 * exist yet. Tests fail with module-not-found until the implementation-engineer
 * creates src/core/deep-equal.ts.
 */
describe("deepEqual — plain objects", () => {
  it("returns true for two empty objects (edge case 3)", () => {
    expect(deepEqual({}, {})).toBe(true);
  });

  it("returns true for objects with same keys in different insertion order (edge case 19)", () => {
    expect(deepEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
  });

  it("returns false when key count differs (edge case 20)", () => {
    expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });

  it("returns false when same key count but different keys (edge case 21)", () => {
    expect(deepEqual({ a: 1 }, { b: 1 })).toBe(false);
  });

  it("returns false when values differ in type at same key (edge case 22)", () => {
    expect(deepEqual({ a: 1 }, { a: "1" })).toBe(false);
  });

  it("returns true for deeply nested mixed structure (edge case 23)", () => {
    const x = { a: { b: [1, { c: 2 }] } };
    const y = { a: { b: [1, { c: 2 }] } };
    expect(deepEqual(x, y)).toBe(true);
  });

  it("returns false for deeply nested structure with type mismatch at leaf (edge case 24)", () => {
    const x = { a: { b: [1, { c: 2 }] } };
    const y = { a: { b: [1, { c: "2" }] } };
    expect(deepEqual(x, y)).toBe(false);
  });

  it("returns true for object with undefined-valued own key vs same (edge case 31)", () => {
    expect(deepEqual({ a: undefined }, { a: undefined })).toBe(true);
  });

  it("returns false for object with undefined own key vs empty object (edge case 32)", () => {
    expect(deepEqual({ a: undefined }, {})).toBe(false);
  });

  it("returns true for null-prototype object vs regular object with same own keys (edge case 33)", () => {
    const nullProtoObj = Object.assign(Object.create(null) as object, { a: 1 });
    expect(deepEqual(nullProtoObj, { a: 1 })).toBe(true);
  });

  it("ignores inherited prototype properties — only own enumerable keys compared (edge case 34)", () => {
    const base = { inherited: "ignored" };
    const child = Object.create(base) as Record<string, unknown>;
    child["own"] = 1;
    expect(deepEqual(child, { own: 1 })).toBe(true);
  });
});

describe("deepEqual — depth guard", () => {
  it("returns false for array nested deeper than maxDepth (edge case 25)", () => {
    // maxDepth:1 — one level of compound; a 3-level array triggers the guard.
    const inner = [99];
    const mid = [inner];
    const outer = [mid];
    expect(deepEqual(outer, outer, { maxDepth: 1 })).toBe(false);
  });

  it("does not throw when array depth exceeds maxDepth", () => {
    const inner = [1];
    const outer = [[inner]];
    expect(() => deepEqual(outer, outer, { maxDepth: 1 })).not.toThrow();
  });

  it("returns false for object nested deeper than maxDepth (edge case 26)", () => {
    const deep = { a: { b: { c: 1 } } };
    const copy = { a: { b: { c: 1 } } };
    expect(deepEqual(deep, copy, { maxDepth: 1 })).toBe(false);
  });

  it("does not throw when object depth exceeds maxDepth", () => {
    const deep = { a: { b: 1 } };
    expect(() => deepEqual(deep, deep, { maxDepth: 1 })).not.toThrow();
  });

  it("compares correctly when structure is exactly at maxDepth boundary — no false negative", () => {
    // maxDepth:2 — depth 0->outer obj, depth 1->inner obj; inner values are
    // primitives so no further descent is required.
    const x = { a: { b: 1 } };
    const y = { a: { b: 1 } };
    expect(deepEqual(x, y, { maxDepth: 2 })).toBe(true);
  });

  it("returns false for objects one level deeper than maxDepth boundary (off-by-one check)", () => {
    // Exactly 3 compound levels: depth 0->outer, 1->mid, 2->inner; maxDepth:2
    // means the guard fires before descending into the third level.
    const x = { a: { b: { c: 1 } } };
    const y = { a: { b: { c: 1 } } };
    expect(deepEqual(x, y, { maxDepth: 2 })).toBe(false);
  });
});

describe("deepEqual — cycle guard", () => {
  it("returns false for a self-referential object compared to itself (edge case 27a)", () => {
    const obj: Record<string, unknown> = { x: 1 };
    obj["self"] = obj;
    expect(deepEqual(obj, obj, { maxDepth: 200 })).toBe(false);
  });

  it("does not hang or throw for a self-referential object (totality guarantee)", () => {
    const obj: Record<string, unknown> = {};
    obj["ref"] = obj;
    expect(() => deepEqual(obj, obj, { maxDepth: 200 })).not.toThrow();
  });

  it("returns false for two distinct self-referential copies (edge case 27b)", () => {
    const a: Record<string, unknown> = { x: 1 };
    a["self"] = a;
    const b: Record<string, unknown> = { x: 1 };
    b["self"] = b;
    expect(deepEqual(a, b, { maxDepth: 200 })).toBe(false);
  });

  it("does not hang for a self-referential array", () => {
    const arr: unknown[] = [1, 2];
    arr.push(arr);
    expect(() => deepEqual(arr, arr, { maxDepth: 200 })).not.toThrow();
  });

  it("compares shared acyclic sub-object (DAG) normally — path-scoped set (edge case 28)", () => {
    // shared is reachable via two paths but not cyclic.
    const shared = { v: 42 };
    const x = { left: shared, right: shared };
    const y = { left: { v: 42 }, right: { v: 42 } };
    expect(deepEqual(x, y)).toBe(true);
  });

  it("returns false for shared acyclic DAG where content differs", () => {
    const shared = { v: 42 };
    const x = { left: shared, right: shared };
    const y = { left: { v: 42 }, right: { v: 99 } };
    expect(deepEqual(x, y)).toBe(false);
  });
});

describe("deepEqual — reflexivity", () => {
  it("returns true when comparing a nested object to itself (edge case 35)", () => {
    const v = { a: [1, { b: true }], c: null };
    expect(deepEqual(v, v)).toBe(true);
  });

  it("returns true when comparing an array to itself", () => {
    const arr = [1, "two", null, { x: 3 }];
    expect(deepEqual(arr, arr)).toBe(true);
  });

  it("returns true for deepEqual(NaN, NaN) — reflexivity holds for NaN", () => {
    expect(deepEqual(NaN, NaN)).toBe(true);
  });
});

describe("deepEqual — out-of-domain inputs (total, no throw)", () => {
  it("compares two Date instances without throwing (plain-object comparison)", () => {
    const d1 = new Date("2024-01-01");
    const d2 = new Date("2024-01-01");
    expect(() => deepEqual(d1, d2)).not.toThrow();
    expect(typeof deepEqual(d1, d2)).toBe("boolean");
  });

  it("compares two functions by identity — same reference returns true, distinct false", () => {
    const fn1 = () => 1;
    const fn2 = () => 1;
    expect(() => deepEqual(fn1, fn2)).not.toThrow();
    expect(deepEqual(fn1, fn1)).toBe(true);
    expect(deepEqual(fn1, fn2)).toBe(false);
  });

  it("compares two Symbols by identity — same reference true, distinct false", () => {
    const s1 = Symbol("s");
    const s2 = Symbol("s");
    expect(() => deepEqual(s1, s2)).not.toThrow();
    expect(deepEqual(s1, s1)).toBe(true);
    expect(deepEqual(s1, s2)).toBe(false);
  });
});
