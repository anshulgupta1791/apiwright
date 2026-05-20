import { describe, it, expect } from "vitest";

import { bindMongo } from "../../../../../src/db/templating/mongo-binder.js";
import type { MongoBoundQuery } from "../../../../../src/db/templating/engine-binding-types.js";
import type { NeutralQuery, BoundValue } from "../../../../../src/db/templating/types.js";
import { NEUTRAL_PLACEHOLDER_PREFIX } from "../../../../../src/db/templating/ref-extractor.js";

/**
 * Unit tests for bindMongo (src/db/templating/mongo-binder.ts).
 *
 * Covers: zero refs (deep-clone, structurally equal, input not mutated);
 * whole-token leaf → raw typed value (number/object/null preserved);
 * embedded sentinel → String(value) substitution (null→""); nested object
 * and array leaves; reused ref across leaves (each resolved from de-duped
 * values); D3 pin ($where / $ne injection-style value stays as a VALUE leaf,
 * never becomes a key); proto-safety (__proto__ key document); defensive
 * string-neutral input → ok:false; no-throw contract.
 *
 * RED PHASE: src/db/templating/mongo-binder.ts does not exist yet.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const P = NEUTRAL_PLACEHOLDER_PREFIX;

/** Whole-token sentinel exactly as the upstream extractor embeds it. */
function sentinel(i: number): string {
  return ` ${P}${i} `;
}

function makeValues(values: unknown[]): readonly BoundValue[] {
  return values.map((v, i) => ({ index: i, value: v }));
}

function assertOkMongo(result: ReturnType<typeof bindMongo>): MongoBoundQuery {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`Expected ok:true, got: ${result.error.message}`);
  expect(result.query.engine).toBe("mongodb");
  return result.query.bound as MongoBoundQuery;
}

// ---------------------------------------------------------------------------
// Zero refs — deep-clone, structurally equal, input not mutated
// ---------------------------------------------------------------------------

describe("bindMongo", () => {
  describe("zero refs — deep-clone, structurally equal, input not mutated", () => {
    it("returns ok:true with document structurally equal to the input", () => {
      const doc = { find: "users", filter: { active: true } };
      const neutral: NeutralQuery = {
        neutralQuery: doc,
        refs: [],
        occurrences: [],
      };
      const bound = assertOkMongo(bindMongo(neutral, []));
      expect(bound.document).toEqual(doc);
    });

    it("does not mutate the input neutral document", () => {
      const doc = { find: "users", filter: { name: "Alice" } };
      const neutral: NeutralQuery = {
        neutralQuery: doc,
        refs: [],
        occurrences: [],
      };
      bindMongo(neutral, []);
      expect(doc.filter.name).toBe("Alice");
    });

    it("returns a different object reference (deep-clone)", () => {
      const doc = { find: "users" };
      const neutral: NeutralQuery = { neutralQuery: doc, refs: [], occurrences: [] };
      const bound = assertOkMongo(bindMongo(neutral, []));
      expect(bound.document).not.toBe(doc);
    });
  });

  // ---------------------------------------------------------------------------
  // Whole-token leaf — raw typed value (type-preserving)
  // ---------------------------------------------------------------------------

  describe("whole-token leaf — replaces the entire leaf with the raw typed value", () => {
    it("number value: bound document contains the number (not a string)", () => {
      const neutral: NeutralQuery = {
        neutralQuery: { age: sentinel(0) },
        refs: [{ index: 0, path: "request.body.age", namespace: "request" }],
        occurrences: [{ refIndex: 0 }],
      };
      const bound = assertOkMongo(bindMongo(neutral, makeValues([42])));
      expect((bound.document as Record<string, unknown>)["age"]).toBe(42);
      expect(typeof (bound.document as Record<string, unknown>)["age"]).toBe("number");
    });

    it("object value: bound document contains the object verbatim (not a string)", () => {
      const subDoc = { nested: true, count: 3 };
      const neutral: NeutralQuery = {
        neutralQuery: { filter: sentinel(0) },
        refs: [{ index: 0, path: "request.body.filter", namespace: "request" }],
        occurrences: [{ refIndex: 0 }],
      };
      const bound = assertOkMongo(bindMongo(neutral, makeValues([subDoc])));
      expect((bound.document as Record<string, unknown>)["filter"]).toEqual(subDoc);
    });

    it("null value: bound document leaf is exactly null (not a string)", () => {
      const neutral: NeutralQuery = {
        neutralQuery: { name: sentinel(0) },
        refs: [{ index: 0, path: "env.name", namespace: "env" }],
        occurrences: [{ refIndex: 0 }],
      };
      const bound = assertOkMongo(bindMongo(neutral, makeValues([null])));
      expect((bound.document as Record<string, unknown>)["name"]).toBeNull();
    });

    it("boolean value: bound document leaf is the boolean (not a string)", () => {
      const neutral: NeutralQuery = {
        neutralQuery: { active: sentinel(0) },
        refs: [{ index: 0, path: "env.flag", namespace: "env" }],
        occurrences: [{ refIndex: 0 }],
      };
      const bound = assertOkMongo(bindMongo(neutral, makeValues([false])));
      expect((bound.document as Record<string, unknown>)["active"]).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Embedded sentinel — String(value) substitution, null → ""
  // ---------------------------------------------------------------------------

  describe("embedded sentinel — String(value) substitution", () => {
    it("embedded in a string prefix: concatenates String(value) in the string", () => {
      // e.g. regex value: "^" + sentinel(0) + "$"
      const neutral: NeutralQuery = {
        neutralQuery: { pattern: `^${sentinel(0)}$` },
        refs: [{ index: 0, path: "request.body.prefix", namespace: "request" }],
        occurrences: [{ refIndex: 0 }],
      };
      const bound = assertOkMongo(bindMongo(neutral, makeValues(["alice"])));
      const pattern = (bound.document as Record<string, unknown>)["pattern"] as string;
      expect(pattern).toContain("alice");
      expect(pattern).toMatch(/^\^.*\$$/);
      expect(pattern).not.toContain(P);
    });

    it("embedded sentinel with null value: substitutes empty string (env parity)", () => {
      const neutral: NeutralQuery = {
        neutralQuery: { pattern: `prefix_${sentinel(0)}_suffix` },
        refs: [{ index: 0, path: "env.x", namespace: "env" }],
        occurrences: [{ refIndex: 0 }],
      };
      const bound = assertOkMongo(bindMongo(neutral, makeValues([null])));
      const pattern = (bound.document as Record<string, unknown>)["pattern"] as string;
      // null → "" in embedded context
      expect(pattern).toBe("prefix__suffix");
    });

    it("embedded sentinel with number value: substitutes String(number)", () => {
      const neutral: NeutralQuery = {
        neutralQuery: { label: `item_${sentinel(0)}` },
        refs: [{ index: 0, path: "env.id", namespace: "env" }],
        occurrences: [{ refIndex: 0 }],
      };
      const bound = assertOkMongo(bindMongo(neutral, makeValues([99])));
      const label = (bound.document as Record<string, unknown>)["label"] as string;
      expect(label).toBe("item_99");
    });

    it("embedded sentinel with boolean value: substitutes String(boolean)", () => {
      // A boolean flag embedded in a string prefix is a real behavior path —
      // e.g. building a dynamic regex pattern that includes a flag value.
      const neutral: NeutralQuery = {
        neutralQuery: { pattern: `active:${sentinel(0)}` },
        refs: [{ index: 0, path: "env.flag", namespace: "env" }],
        occurrences: [{ refIndex: 0 }],
      };
      const bound = assertOkMongo(bindMongo(neutral, makeValues([false])));
      const pattern = (bound.document as Record<string, unknown>)["pattern"] as string;
      expect(pattern).toBe("active:false");
    });

    it("embedded sentinel with object value: substitutes JSON.stringify(object)", () => {
      // An object value embedded in a string leaf → JSON string (embedded context).
      const neutral: NeutralQuery = {
        neutralQuery: { query: `filter:${sentinel(0)}` },
        refs: [{ index: 0, path: "env.obj", namespace: "env" }],
        occurrences: [{ refIndex: 0 }],
      };
      const subObj = { x: 1 };
      const bound = assertOkMongo(bindMongo(neutral, makeValues([subObj])));
      const query = (bound.document as Record<string, unknown>)["query"] as string;
      expect(query).toBe(`filter:${JSON.stringify(subObj)}`);
    });
  });

  // ---------------------------------------------------------------------------
  // Nested object and array value leaves
  // ---------------------------------------------------------------------------

  describe("nested object and array leaves — deep substitution", () => {
    it("substitutes a sentinel in a nested object leaf", () => {
      const neutral: NeutralQuery = {
        neutralQuery: { filter: { user: { name: sentinel(0) } } },
        refs: [{ index: 0, path: "env.name", namespace: "env" }],
        occurrences: [{ refIndex: 0 }],
      };
      const bound = assertOkMongo(bindMongo(neutral, makeValues(["Alice"])));
      const doc = bound.document as Record<string, unknown>;
      const filter = doc["filter"] as Record<string, unknown>;
      const user = filter["user"] as Record<string, unknown>;
      expect(user["name"]).toBe("Alice");
    });

    it("substitutes a sentinel in an array element position", () => {
      const neutral: NeutralQuery = {
        neutralQuery: { $in: [sentinel(0), sentinel(1)] },
        refs: [
          { index: 0, path: "env.a", namespace: "env" },
          { index: 1, path: "env.b", namespace: "env" },
        ],
        occurrences: [{ refIndex: 0 }, { refIndex: 1 }],
      };
      const bound = assertOkMongo(bindMongo(neutral, makeValues([10, 20])));
      const doc = bound.document as Record<string, unknown>;
      const arr = doc["$in"] as unknown[];
      expect(arr[0]).toBe(10);
      expect(arr[1]).toBe(20);
    });
  });

  // ---------------------------------------------------------------------------
  // Reused ref across multiple leaves
  // ---------------------------------------------------------------------------

  describe("reused ref across multiple value leaves — each resolved from de-duped values", () => {
    it("two leaves with the same sentinel resolve to the same value", () => {
      const neutral: NeutralQuery = {
        neutralQuery: { a: sentinel(0), b: sentinel(0) },
        refs: [{ index: 0, path: "env.x", namespace: "env" }],
        occurrences: [{ refIndex: 0 }, { refIndex: 0 }],
      };
      const bound = assertOkMongo(bindMongo(neutral, makeValues(["shared"])));
      const doc = bound.document as Record<string, unknown>;
      expect(doc["a"]).toBe("shared");
      expect(doc["b"]).toBe("shared");
    });
  });

  // ---------------------------------------------------------------------------
  // D3 pin — injection-style value is a VALUE leaf, never becomes a key
  // ---------------------------------------------------------------------------

  describe("D3 structural pin — injection-style value is a value leaf, never a key", () => {
    it("$where payload stays as a value leaf, document keys unchanged", () => {
      const injection = { $where: "function() { return true; }" };
      const neutral: NeutralQuery = {
        neutralQuery: { find: "users", filter: { data: sentinel(0) } },
        refs: [{ index: 0, path: "request.body.data", namespace: "request" }],
        occurrences: [{ refIndex: 0 }],
      };
      const bound = assertOkMongo(bindMongo(neutral, makeValues([injection])));
      const doc = bound.document as Record<string, unknown>;
      // The key "filter" is still "filter" — the key is NEVER derived from the value
      expect("filter" in doc).toBe(true);
      const filter = doc["filter"] as Record<string, unknown>;
      expect(filter["data"]).toEqual(injection);
      // The $where payload is a value — it did NOT become a top-level key
      expect("$where" in doc).toBe(false);
    });

    it("$ne injection value stays at the leaf, does not become an operator key", () => {
      const injection = { $ne: "safe" };
      const neutral: NeutralQuery = {
        neutralQuery: { status: sentinel(0) },
        refs: [{ index: 0, path: "request.body.status", namespace: "request" }],
        occurrences: [{ refIndex: 0 }],
      };
      const bound = assertOkMongo(bindMongo(neutral, makeValues([injection])));
      const doc = bound.document as Record<string, unknown>;
      expect(doc["status"]).toEqual(injection);
      // The operator $ne must NOT appear at the top level as a key
      expect("$ne" in doc).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // __proto__ safety — prototype-safe deep clone
  // ---------------------------------------------------------------------------

  describe("__proto__ safety — prototype-safe deep clone via mapTree", () => {
    it("document with __proto__ key does not pollute Object.prototype", () => {
      const doc = JSON.parse('{"__proto__":{"poisoned":true},"safe":true}') as
        Record<string, unknown>;
      const neutral: NeutralQuery = { neutralQuery: doc, refs: [], occurrences: [] };
      bindMongo(neutral, []);
      // If __proto__ was handled unsafely, Object.prototype would be mutated
      expect((Object.prototype as Record<string, unknown>)["poisoned"]).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Keys with ${...} literal text — left untouched (keys are never walked)
  // ---------------------------------------------------------------------------

  describe("document KEY that looks like a template ref — left untouched", () => {
    it("a key literally named '${env.x}' is preserved as-is", () => {
      // The upstream extractor only walks VALUE positions; this test confirms
      // the binder also never modifies keys
      const doc = { "${env.x}": "some-value", regularKey: "other" };
      const neutral: NeutralQuery = { neutralQuery: doc, refs: [], occurrences: [] };
      const bound = assertOkMongo(bindMongo(neutral, []));
      const result = bound.document as Record<string, unknown>;
      expect("${env.x}" in result).toBe(true);
      expect(result["${env.x}"]).toBe("some-value");
    });
  });

  // ---------------------------------------------------------------------------
  // Defensive: string neutral → ok:false
  // ---------------------------------------------------------------------------

  describe("defensive: string neutralQuery → ok:false DB_PARAM_NOT_BINDABLE", () => {
    it("returns ok:false when neutralQuery is a string (invalid for Mongo binder)", () => {
      const neutral: NeutralQuery = {
        neutralQuery: "SELECT 1",  // string is invalid for mongo — should be object/array
        refs: [],
        occurrences: [],
      };
      const result = bindMongo(neutral, []);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("DB_PARAM_NOT_BINDABLE");
      }
    });
  });

  // ---------------------------------------------------------------------------
  // No-throw contract
  // ---------------------------------------------------------------------------

  describe("no-throw contract — never throws regardless of input", () => {
    it("never throws on empty neutral with empty values", () => {
      const neutral: NeutralQuery = { neutralQuery: {}, refs: [], occurrences: [] };
      expect(() => bindMongo(neutral, [])).not.toThrow();
    });

    it("never throws on values.length mismatch", () => {
      const neutral: NeutralQuery = {
        neutralQuery: { age: sentinel(0) },
        refs: [{ index: 0, path: "env.age", namespace: "env" }],
        occurrences: [{ refIndex: 0 }],
      };
      expect(() => bindMongo(neutral, [])).not.toThrow();
    });
  });
});
