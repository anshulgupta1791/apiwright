import { describe, it, expect } from "vitest";

import {
  walkPath,
  MAX_PATH_WALK_DEPTH,
} from "../../../src/core/path-walk.js";
import type { WalkSegment } from "../../../src/core/path-walk.js";

/**
 * Unit tests for the promoted core path-walk primitive.
 *
 * Pins every observable behavior of `walkPath` and `MAX_PATH_WALK_DEPTH` as
 * specified in the db-promote-path-walk-to-core design. The core module does
 * not yet exist; these tests fail with module-not-found until the
 * implementation-engineer creates src/core/path-walk.ts.
 *
 * Coverage obligation: every branch of every conditional in path-walk.ts must
 * be reachable from this file (95% branch threshold enforced by vitest config).
 * The design enumerates: empty/undefined path; undefined root; found keys and
 * indices; missing key; OOB index; negative index; key-on-array; index-on-non-
 * array; descent-through-null (non-final); descent into primitive; depth guard
 * (256 = found, 257 = not-found); prototype-pollution guards; never-throws.
 */

// ---------------------------------------------------------------------------
// Helpers — build WalkSegment arrays from convenient notation
// ---------------------------------------------------------------------------

function key(k: string): WalkSegment {
  return { kind: "key", key: k };
}

function idx(i: number): WalkSegment {
  return { kind: "index", index: i };
}

// ---------------------------------------------------------------------------
// MAX_PATH_WALK_DEPTH constant
// ---------------------------------------------------------------------------

describe("MAX_PATH_WALK_DEPTH", () => {
  it("exports the depth constant as a plain number equal to 256", () => {
    expect(MAX_PATH_WALK_DEPTH).toBe(256);
    expect(typeof MAX_PATH_WALK_DEPTH).toBe("number");
  });
});

// ---------------------------------------------------------------------------
// Empty / undefined path
// ---------------------------------------------------------------------------

describe("walkPath — empty and undefined segments", () => {
  it("returns found:true with the root value for an empty segment array", () => {
    const result = walkPath({ a: 1 }, []);
    expect(result).toEqual({ found: true, value: { a: 1 } });
  });

  it("returns found:true with the root value for undefined segments", () => {
    const result = walkPath({ x: 42 }, undefined);
    expect(result).toEqual({ found: true, value: { x: 42 } });
  });

  it("returns found:false when root is undefined and segments is empty array", () => {
    const result = walkPath(undefined, []);
    expect(result).toEqual({ found: false });
  });

  it("returns found:false when root is undefined and segments is undefined", () => {
    const result = walkPath(undefined, undefined);
    expect(result).toEqual({ found: false });
  });

  it("returns found:true with null root when segments is empty (null is a real value)", () => {
    // null root with no segments -> found:true,value:null per design (empty-path
    // rule: only undefined root -> not-found; null is a real JSON value)
    const result = walkPath(null, []);
    expect(result).toEqual({ found: true, value: null });
  });
});

// ---------------------------------------------------------------------------
// Happy-path: key descent
// ---------------------------------------------------------------------------

describe("walkPath — object key descent", () => {
  it("resolves a single-level key path to its value", () => {
    const result = walkPath({ name: "alice" }, [key("name")]);
    expect(result).toEqual({ found: true, value: "alice" });
  });

  it("resolves a two-level key path", () => {
    const result = walkPath({ user: { age: 30 } }, [key("user"), key("age")]);
    expect(result).toEqual({ found: true, value: 30 });
  });

  it("resolves a three-level key path to a boolean leaf", () => {
    const root = { a: { b: { c: true } } };
    const result = walkPath(root, [key("a"), key("b"), key("c")]);
    expect(result).toEqual({ found: true, value: true });
  });

  it("returns found:true with value:null for explicit JSON null at final segment", () => {
    // A null LEAF (final segment resolved) is a real value — found:true,value:null
    const result = walkPath({ status: null }, [key("status")]);
    expect(result).toEqual({ found: true, value: null });
  });

  it("returns found:true with value:0 for numeric zero leaf (falsy but real)", () => {
    const result = walkPath({ count: 0 }, [key("count")]);
    expect(result).toEqual({ found: true, value: 0 });
  });

  it("returns found:true with value:false for boolean false leaf", () => {
    const result = walkPath({ active: false }, [key("active")]);
    expect(result).toEqual({ found: true, value: false });
  });

  it("returns found:true with value empty string for empty-string leaf", () => {
    const result = walkPath({ label: "" }, [key("label")]);
    expect(result).toEqual({ found: true, value: "" });
  });
});

// ---------------------------------------------------------------------------
// Happy-path: array index descent
// ---------------------------------------------------------------------------

describe("walkPath — array index descent", () => {
  it("resolves index 0 on a non-empty array", () => {
    const result = walkPath([10, 20, 30], [idx(0)]);
    expect(result).toEqual({ found: true, value: 10 });
  });

  it("resolves index 2 on a three-element array", () => {
    const result = walkPath([10, 20, 30], [idx(2)]);
    expect(result).toEqual({ found: true, value: 30 });
  });

  it("resolves a key then an index (mixed path)", () => {
    const root = { items: [{ id: 1 }, { id: 2 }] };
    const result = walkPath(root, [key("items"), idx(1), key("id")]);
    expect(result).toEqual({ found: true, value: 2 });
  });

  it("resolves index then key then index (compound mixed path)", () => {
    const root = [{ tags: ["alpha", "beta"] }, { tags: ["gamma"] }];
    const result = walkPath(root, [idx(0), key("tags"), idx(1)]);
    expect(result).toEqual({ found: true, value: "beta" });
  });

  it("returns found:true with value:null for null at array index (null is a real value)", () => {
    const result = walkPath([null, 1, 2], [idx(0)]);
    expect(result).toEqual({ found: true, value: null });
  });
});

// ---------------------------------------------------------------------------
// Not-found: missing key
// ---------------------------------------------------------------------------

describe("walkPath — missing key returns not-found", () => {
  it("returns found:false for a key that does not exist on the object", () => {
    const result = walkPath({ a: 1 }, [key("b")]);
    expect(result).toEqual({ found: false });
  });

  it("returns found:false for nested path where an intermediate key is missing", () => {
    const result = walkPath({ a: {} }, [key("a"), key("missing"), key("x")]);
    expect(result).toEqual({ found: false });
  });

  it("returns found:false for a key path into an empty object", () => {
    const result = walkPath({}, [key("anything")]);
    expect(result).toEqual({ found: false });
  });
});

// ---------------------------------------------------------------------------
// Not-found: OOB index and negative index
// ---------------------------------------------------------------------------

describe("walkPath — out-of-bounds and negative index returns not-found", () => {
  it("returns found:false for index equal to array length (OOB)", () => {
    const result = walkPath([1, 2, 3], [idx(3)]);
    expect(result).toEqual({ found: false });
  });

  it("returns found:false for index greater than array length", () => {
    const result = walkPath([1], [idx(99)]);
    expect(result).toEqual({ found: false });
  });

  it("returns found:false for a negative index", () => {
    const result = walkPath([1, 2, 3], [idx(-1)]);
    expect(result).toEqual({ found: false });
  });

  it("returns found:false for index 0 on an empty array", () => {
    const result = walkPath([], [idx(0)]);
    expect(result).toEqual({ found: false });
  });
});

// ---------------------------------------------------------------------------
// Not-found: wrong-type descent
// ---------------------------------------------------------------------------

describe("walkPath — wrong-type descent returns not-found", () => {
  it("returns found:false for key segment on an array value", () => {
    // Arrays are not key-addressable via key-kind segments
    const result = walkPath({ items: [1, 2, 3] }, [key("items"), key("length")]);
    expect(result).toEqual({ found: false });
  });

  it("returns found:false for index segment on a plain object value", () => {
    const result = walkPath({ x: { a: 1 } }, [key("x"), idx(0)]);
    expect(result).toEqual({ found: false });
  });

  it("returns found:false for key descent into a number primitive", () => {
    const result = walkPath({ val: 42 }, [key("val"), key("toFixed")]);
    expect(result).toEqual({ found: false });
  });

  it("returns found:false for key descent into a string primitive", () => {
    const result = walkPath({ s: "hello" }, [key("s"), key("length")]);
    expect(result).toEqual({ found: false });
  });

  it("returns found:false for key descent into a boolean primitive", () => {
    const result = walkPath({ flag: true }, [key("flag"), key("valueOf")]);
    expect(result).toEqual({ found: false });
  });

  it("returns found:false for index descent into a number", () => {
    const result = walkPath(42, [idx(0)]);
    expect(result).toEqual({ found: false });
  });
});

// ---------------------------------------------------------------------------
// Not-found: descent through null mid-path
// ---------------------------------------------------------------------------

describe("walkPath — descent through null mid-path returns not-found", () => {
  it("returns found:false when descending through null (non-final segment)", () => {
    // null at a non-final position: the walk cannot descend further
    const result = walkPath({ a: null }, [key("a"), key("b")]);
    expect(result).toEqual({ found: false });
  });

  it("returns found:false when descending through null two levels before end", () => {
    const result = walkPath({ x: null }, [key("x"), key("y"), key("z")]);
    expect(result).toEqual({ found: false });
  });
});

// ---------------------------------------------------------------------------
// Depth guard: boundary at MAX_PATH_WALK_DEPTH (256)
// ---------------------------------------------------------------------------

describe("walkPath — depth guard", () => {
  it("resolves a path of exactly MAX_PATH_WALK_DEPTH segments without throwing", () => {
    // Build a nested object MAX_PATH_WALK_DEPTH levels deep and a matching path.
    let root: unknown = "leaf";
    const segs: WalkSegment[] = [];
    for (let i = 0; i < MAX_PATH_WALK_DEPTH; i++) {
      root = { k: root };
      segs.unshift(key("k"));
    }
    const result = walkPath(root, segs);
    // 256 segments on a 256-level object -> found (the guard fires only at >256)
    expect(result.found).toBe(true);
    if (result.found) {
      expect(result.value).toBe("leaf");
    }
  });

  it("returns found:false for a path of MAX_PATH_WALK_DEPTH + 1 segments", () => {
    // One segment beyond the limit -> the guard branch fires -> not-found, no throw
    let root: unknown = "leaf";
    const segs: WalkSegment[] = [];
    for (let i = 0; i < MAX_PATH_WALK_DEPTH + 1; i++) {
      root = { k: root };
      segs.unshift(key("k"));
    }
    const result = walkPath(root, segs);
    expect(result).toEqual({ found: false });
  });

  it("does not throw for an over-depth path (no RangeError, walk is iterative)", () => {
    const segs = Array.from({ length: MAX_PATH_WALK_DEPTH + 10 }, () => key("x"));
    expect(() => walkPath({}, segs)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Prototype-pollution safety
// ---------------------------------------------------------------------------

describe("walkPath — prototype-pollution safety", () => {
  it("returns found:false for __proto__ string key on a normal object (not an own data prop)", () => {
    // A normal object literal's __proto__ is NOT an own enumerable data property —
    // hasOwnProperty.call returns false for it.
    const obj = { a: 1 };
    const result = walkPath(obj, [key("__proto__")]);
    expect(result).toEqual({ found: false });
  });

  it("returns found:false for constructor key on a plain object literal (inherited, not own)", () => {
    const obj = { a: 1 };
    const result = walkPath(obj, [key("constructor")]);
    expect(result).toEqual({ found: false });
  });

  it("returns found:true for __proto__ defined as an OWN data property on a null-prototype object", () => {
    // Object.create(null) has no prototype; assigning __proto__ creates a real own data property.
    // stepKey reads via getOwnPropertyDescriptor, so this OWN data property IS reachable.
    const obj = Object.create(null) as Record<string, unknown>;
    obj["__proto__"] = "my-data";
    const result = walkPath(obj, [key("__proto__")]);
    expect(result).toEqual({ found: true, value: "my-data" });
  });

  it("returns found:false for toString key on a plain object (inherited, not own)", () => {
    const obj = { a: 1 };
    const result = walkPath(obj, [key("toString")]);
    expect(result).toEqual({ found: false });
  });
});

// ---------------------------------------------------------------------------
// Never-throws (total function)
// ---------------------------------------------------------------------------

describe("walkPath — never throws (total function)", () => {
  it("does not throw for a garbage primitive root with a key path", () => {
    expect(() => walkPath(42, [key("a"), key("b")])).not.toThrow();
  });

  it("does not throw for a null root with a non-empty path", () => {
    expect(() => walkPath(null, [key("a")])).not.toThrow();
  });

  it("does not throw for undefined root with a non-empty path", () => {
    expect(() => walkPath(undefined, [key("a")])).not.toThrow();
  });

  it("does not throw for a cyclic object root", () => {
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic["self"] = cyclic;
    expect(() => walkPath(cyclic, [key("self"), key("self"), key("a")])).not.toThrow();
  });

  it("does not throw for a cyclic array root", () => {
    const arr: unknown[] = [1];
    arr.push(arr);
    expect(() => walkPath(arr, [idx(1), idx(1), idx(0)])).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe("walkPath — determinism", () => {
  it("returns equal results on two successive calls with the same inputs", () => {
    const root = { users: [{ id: 1 }, { id: 2 }] };
    const segs = [key("users"), idx(1), key("id")];
    const r1 = walkPath(root, segs);
    const r2 = walkPath(root, segs);
    expect(r1).toEqual(r2);
  });

  it("returns equal not-found results on two successive missing-key calls", () => {
    const root = { a: 1 };
    const r1 = walkPath(root, [key("b")]);
    const r2 = walkPath(root, [key("b")]);
    expect(r1).toEqual(r2);
    expect(r1).toEqual({ found: false });
  });
});
