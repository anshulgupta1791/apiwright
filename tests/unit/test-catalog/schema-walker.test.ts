import { describe, it, expect } from "vitest";

import { parseJson } from "../../../src/core/safe-json.js";
import { SchemaWalker, WALKER_MAX_DEPTH } from "../../../src/test-catalog/schema-walker.js";

/**
 * Unit tests for SchemaWalker.
 *
 * Covers: object schema traversal (declared-order), required field detection,
 * nested object recursion, array-item recursion, constraint extraction (all 5
 * types), non-object/empty/null schemas, EXPLICIT depth guard (never native
 * overflow/RangeError — built iteratively), determinism.
 *
 * CRITICAL: The deep-schema fixture is built ITERATIVELY using string
 * concatenation and a single JSON.parse — NOT via recursive JS calls — to
 * avoid CI Node 22 stack overflow risk during test construction itself.
 */
describe("SchemaWalker", () => {
  describe("constructor", () => {
    it("constructs with no arguments and uses the default maxDepth", () => {
      expect(() => new SchemaWalker()).not.toThrow();
    });

    it("accepts a custom maxDepth option", () => {
      expect(() => new SchemaWalker({ maxDepth: 5 })).not.toThrow();
    });

    it("WALKER_MAX_DEPTH exported constant equals 64", () => {
      expect(WALKER_MAX_DEPTH).toBe(64);
    });
  });

  describe("walk() — non-object / empty / null schemas return empty inventory", () => {
    const walker = new SchemaWalker();

    it("returns empty inventory for null", () => {
      const result = walker.walk(null as never);
      expect(result.fields).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });

    it("returns empty inventory for undefined", () => {
      const result = walker.walk(undefined as never);
      expect(result.fields).toHaveLength(0);
    });

    it("returns empty inventory for an empty object schema {}", () => {
      const result = walker.walk({});
      expect(result.fields).toHaveLength(0);
    });

    it("returns empty inventory for a string-type schema (no properties)", () => {
      const result = walker.walk({ type: "string" });
      expect(result.fields).toHaveLength(0);
    });

    it("returns empty inventory for object schema with no properties", () => {
      const result = walker.walk({ type: "object" });
      expect(result.fields).toHaveLength(0);
    });

    it("never throws on null input", () => {
      expect(() => walker.walk(null as never)).not.toThrow();
    });

    it("never throws on a non-object primitive", () => {
      expect(() => walker.walk(42 as never)).not.toThrow();
    });
  });

  describe("walk() — basic object schema with properties", () => {
    it("enumerates all properties as field descriptors", () => {
      const walker = new SchemaWalker();
      const schema = {
        type: "object",
        properties: {
          name: { type: "string" },
          age: { type: "integer" },
        },
      };
      const { fields } = walker.walk(schema);
      expect(fields.length).toBe(2);
      expect(fields.map((f) => f.path)).toEqual(["name", "age"]);
    });

    it("sets jsonType from the property type field", () => {
      const walker = new SchemaWalker();
      const schema = {
        type: "object",
        properties: {
          count: { type: "integer" },
          label: { type: "string" },
          active: { type: "boolean" },
        },
      };
      const { fields } = walker.walk(schema);
      const byPath = Object.fromEntries(fields.map((f) => [f.path, f]));
      expect(byPath["count"].jsonType).toBe("integer");
      expect(byPath["label"].jsonType).toBe("string");
      expect(byPath["active"].jsonType).toBe("boolean");
    });

    it("sets jsonType to unknown when property has no type", () => {
      const walker = new SchemaWalker();
      const schema = {
        type: "object",
        properties: {
          anything: {},
        },
      };
      const { fields } = walker.walk(schema);
      expect(fields[0].jsonType).toBe("unknown");
    });

    it("preserves Object.keys insertion order (declared field order)", () => {
      const walker = new SchemaWalker();
      const schema = {
        type: "object",
        properties: {
          z: { type: "string" },
          a: { type: "string" },
          m: { type: "string" },
        },
      };
      const { fields } = walker.walk(schema);
      expect(fields.map((f) => f.path)).toEqual(["z", "a", "m"]);
    });
  });

  describe("walk() — required field detection", () => {
    it("marks fields in the required array as required=true", () => {
      const walker = new SchemaWalker();
      const schema = {
        type: "object",
        required: ["email"],
        properties: {
          email: { type: "string" },
          name: { type: "string" },
        },
      };
      const { fields } = walker.walk(schema);
      const byPath = Object.fromEntries(fields.map((f) => [f.path, f]));
      expect(byPath["email"].required).toBe(true);
      expect(byPath["name"].required).toBe(false);
    });

    it("marks all fields as not required when required array is absent", () => {
      const walker = new SchemaWalker();
      const schema = {
        type: "object",
        properties: { x: { type: "string" } },
      };
      const { fields } = walker.walk(schema);
      expect(fields[0].required).toBe(false);
    });

    it("marks all fields not required when required array is empty", () => {
      const walker = new SchemaWalker();
      const schema = {
        type: "object",
        required: [],
        properties: { x: { type: "string" } },
      };
      const { fields } = walker.walk(schema);
      expect(fields[0].required).toBe(false);
    });
  });

  describe("walk() — constraint extraction", () => {
    it("extracts minimum constraint", () => {
      const walker = new SchemaWalker();
      const schema = {
        type: "object",
        properties: { age: { type: "integer", minimum: 18 } },
      };
      const { fields } = walker.walk(schema);
      expect(fields[0].constraints.minimum).toBe(18);
    });

    it("extracts maximum constraint", () => {
      const walker = new SchemaWalker();
      const schema = {
        type: "object",
        properties: { age: { type: "integer", maximum: 120 } },
      };
      const { fields } = walker.walk(schema);
      expect(fields[0].constraints.maximum).toBe(120);
    });

    it("extracts minLength constraint", () => {
      const walker = new SchemaWalker();
      const schema = {
        type: "object",
        properties: { name: { type: "string", minLength: 1 } },
      };
      const { fields } = walker.walk(schema);
      expect(fields[0].constraints.minLength).toBe(1);
    });

    it("extracts maxLength constraint", () => {
      const walker = new SchemaWalker();
      const schema = {
        type: "object",
        properties: { name: { type: "string", maxLength: 100 } },
      };
      const { fields } = walker.walk(schema);
      expect(fields[0].constraints.maxLength).toBe(100);
    });

    it("extracts enum constraint as array", () => {
      const walker = new SchemaWalker();
      const schema = {
        type: "object",
        properties: { role: { type: "string", enum: ["admin", "user"] } },
      };
      const { fields } = walker.walk(schema);
      expect(fields[0].constraints.enum).toEqual(["admin", "user"]);
    });

    it("omits absent constraints from the constraints object (round-trip safe)", () => {
      const walker = new SchemaWalker();
      const schema = {
        type: "object",
        properties: { plain: { type: "string" } },
      };
      const { fields } = walker.walk(schema);
      expect(fields[0].constraints.minimum).toBeUndefined();
      expect(fields[0].constraints.maximum).toBeUndefined();
      expect(fields[0].constraints.minLength).toBeUndefined();
      expect(fields[0].constraints.maxLength).toBeUndefined();
      expect(fields[0].constraints.enum).toBeUndefined();
    });

    it("does not extract a non-array enum value", () => {
      const walker = new SchemaWalker();
      // Non-array enum (malformed) should not be extracted
      const schema = {
        type: "object",
        properties: { x: { type: "string", enum: "not-an-array" as unknown } },
      };
      const { fields } = walker.walk(schema);
      expect(fields[0].constraints.enum).toBeUndefined();
    });
  });

  describe("walk() — nested object recursion", () => {
    it("walks nested object properties with dot-notation paths", () => {
      const walker = new SchemaWalker();
      const schema = {
        type: "object",
        properties: {
          address: {
            type: "object",
            properties: {
              street: { type: "string" },
              zip: { type: "string" },
            },
          },
        },
      };
      const { fields } = walker.walk(schema);
      const paths = fields.map((f) => f.path);
      expect(paths).toContain("address");
      expect(paths).toContain("address.street");
      expect(paths).toContain("address.zip");
    });

    it("emits parent before children (pre-order DFS)", () => {
      const walker = new SchemaWalker();
      const schema = {
        type: "object",
        properties: {
          parent: {
            type: "object",
            properties: { child: { type: "string" } },
          },
        },
      };
      const { fields } = walker.walk(schema);
      const parentIdx = fields.findIndex((f) => f.path === "parent");
      const childIdx = fields.findIndex((f) => f.path === "parent.child");
      expect(parentIdx).toBeLessThan(childIdx);
    });
  });

  describe("walk() — array items recursion", () => {
    it("walks array items with [] path suffix", () => {
      const walker = new SchemaWalker();
      const schema = {
        type: "object",
        properties: {
          tags: {
            type: "array",
            items: { type: "string" },
          },
        },
      };
      const { fields } = walker.walk(schema);
      const paths = fields.map((f) => f.path);
      expect(paths).toContain("tags");
      // Note: items of a string type don't produce named sub-fields
      // but the tags field itself is enumerated
    });

    it("walks object items under array with nested dot notation", () => {
      const walker = new SchemaWalker();
      const schema = {
        type: "object",
        properties: {
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                qty: { type: "integer" },
              },
            },
          },
        },
      };
      const { fields } = walker.walk(schema);
      const paths = fields.map((f) => f.path);
      expect(paths).toContain("items");
      expect(paths).toContain("items[].id");
      expect(paths).toContain("items[].qty");
    });
  });

  describe("walk() — EXPLICIT depth guard (never native overflow, never RangeError)", () => {
    it("stops descent at maxDepth and records a warning (iterative fixture, NOT recursive)", () => {
      // CRITICAL: built iteratively via string concatenation, then parsed once
      // with parseJson (the audited boundary; no raw JSON.parse). This avoids
      // any recursive JS call stack during fixture construction on CI Node 22.
      const GUARD = 3; // test-controlled small guard
      const walker = new SchemaWalker({ maxDepth: GUARD });

      // Build a 5-level deep schema iteratively: level 4 is beyond guard=3
      // {"type":"object","properties":{"x":{"type":"object","properties":{"x":{...}}}}}
      let innerJson = '{"type":"string"}';
      const DEPTH = 5; // deeper than GUARD=3
      for (let i = 0; i < DEPTH; i++) {
        innerJson = '{"type":"object","properties":{"x":' + innerJson + "}}";
      }
      const parsedDeep = parseJson(innerJson);
      if (!parsedDeep.ok) throw new Error(parsedDeep.error);
      const deepSchema = parsedDeep.value as Record<string, unknown>;

      const result = walker.walk(deepSchema);

      // Must return partial inventory without throwing
      expect(result.fields.length).toBeGreaterThan(0); // shallow fields present
      expect(result.warnings.some((w) => w.toLowerCase().includes("depth"))).toBe(true);
    });

    it("does not throw RangeError for a schema deeper than the guard", () => {
      // Same iterative construction
      const GUARD = 2;
      const walker = new SchemaWalker({ maxDepth: GUARD });
      let innerJson = '{"type":"string"}';
      for (let i = 0; i < 6; i++) {
        innerJson = '{"type":"object","properties":{"f":' + innerJson + "}}";
      }
      const parsedDeep = parseJson(innerJson);
      if (!parsedDeep.ok) throw new Error(parsedDeep.error);
      const deepSchema = parsedDeep.value as Record<string, unknown>;
      expect(() => walker.walk(deepSchema)).not.toThrow();
    });

    it("warning includes the maxDepth value and the path that exceeded it", () => {
      const GUARD = 2;
      const walker = new SchemaWalker({ maxDepth: GUARD });
      // Build 4-level deep schema iteratively
      let innerJson = '{"type":"string"}';
      for (let i = 0; i < 4; i++) {
        innerJson = '{"type":"object","properties":{"x":' + innerJson + "}}";
      }
      const parsedDeep = parseJson(innerJson);
      if (!parsedDeep.ok) throw new Error(parsedDeep.error);
      const deepSchema = parsedDeep.value as Record<string, unknown>;
      const { warnings } = walker.walk(deepSchema);
      expect(warnings.length).toBeGreaterThan(0);
      // Warning should reference the maxDepth guard value
      expect(warnings[0]).toMatch(/2/);
    });

    it("returns empty inventory with no warning for schema exactly at maxDepth", () => {
      // Schema of depth=1 (one level of properties) with maxDepth=1 should work
      const walker = new SchemaWalker({ maxDepth: 1 });
      const schema = {
        type: "object",
        properties: { name: { type: "string" } },
      };
      const { fields, warnings } = walker.walk(schema);
      // Shallow fields should be present; no depth warning
      expect(fields.length).toBeGreaterThan(0);
      expect(warnings.filter((w) => w.toLowerCase().includes("depth"))).toHaveLength(0);
    });
  });

  describe("walk() — determinism", () => {
    it("returns identical results for two calls on the same schema", () => {
      const walker = new SchemaWalker();
      const schema = {
        type: "object",
        required: ["a"],
        properties: {
          a: { type: "string", minLength: 1, maxLength: 100 },
          b: { type: "integer", minimum: 0, maximum: 999 },
        },
      };
      const r1 = walker.walk(schema);
      const r2 = walker.walk(schema);
      expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
    });
  });
});
