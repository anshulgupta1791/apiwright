import { describe, expect, it } from "vitest";

import { JsonSchemaInferrer } from "../../../../src/importers/postman/schema-infer.js";

/**
 * Unit tests for JsonSchemaInferrer.
 *
 * Covers the recursive inference algorithm precisely:
 *   null → {type:"null"}
 *   boolean → {type:"boolean"}
 *   integer → {type:"integer"}
 *   non-integer number → {type:"number"}
 *   string → {type:"string"}
 *   empty array → {type:"array", items:{}}
 *   non-empty uniform array → {type:"array", items:<element-schema>}
 *   non-empty heterogeneous array → oneOf (first-seen order, deduped)
 *   empty object → {type:"object", properties:{}, required:[]}
 *   non-empty object → properties+required in insertion order
 *   nested objects/arrays → recursive
 *   determinism: same input → byte-identical output
 *   undefined → {} (defensive; tested as sparse array value)
 */
describe("JsonSchemaInferrer", () => {
  const inferrer = new JsonSchemaInferrer();

  describe("infer() — null", () => {
    it("returns {type:'null'} for null", () => {
      expect(inferrer.infer(null)).toEqual({ type: "null" });
    });
  });

  describe("infer() — boolean", () => {
    it("returns {type:'boolean'} for true", () => {
      expect(inferrer.infer(true)).toEqual({ type: "boolean" });
    });

    it("returns {type:'boolean'} for false", () => {
      expect(inferrer.infer(false)).toEqual({ type: "boolean" });
    });
  });

  describe("infer() — number (integer vs float)", () => {
    it("returns {type:'integer'} for integer 0", () => {
      expect(inferrer.infer(0)).toEqual({ type: "integer" });
    });

    it("returns {type:'integer'} for positive integer 42", () => {
      expect(inferrer.infer(42)).toEqual({ type: "integer" });
    });

    it("returns {type:'integer'} for negative integer -5", () => {
      expect(inferrer.infer(-5)).toEqual({ type: "integer" });
    });

    it("returns {type:'number'} for a float 3.14", () => {
      expect(inferrer.infer(3.14)).toEqual({ type: "number" });
    });

    it("returns {type:'number'} for negative float -0.5", () => {
      expect(inferrer.infer(-0.5)).toEqual({ type: "number" });
    });

    it("returns {type:'integer'} for large integer 1000000", () => {
      expect(inferrer.infer(1000000)).toEqual({ type: "integer" });
    });
  });

  describe("infer() — string", () => {
    it("returns {type:'string'} for an empty string", () => {
      expect(inferrer.infer("")).toEqual({ type: "string" });
    });

    it("returns {type:'string'} for a non-empty string", () => {
      expect(inferrer.infer("hello")).toEqual({ type: "string" });
    });

    it("returns {type:'string'} for a UUID string", () => {
      expect(inferrer.infer("550e8400-e29b-41d4-a716-446655440000")).toEqual({
        type: "string",
      });
    });
  });

  describe("infer() — empty array", () => {
    it("returns {type:'array', items:{}} for an empty array", () => {
      expect(inferrer.infer([])).toEqual({ type: "array", items: {} });
    });
  });

  describe("infer() — non-empty uniform array", () => {
    it("returns items:string-schema for array of strings", () => {
      expect(inferrer.infer(["a", "b", "c"])).toEqual({
        type: "array",
        items: { type: "string" },
      });
    });

    it("returns items:integer-schema for array of integers", () => {
      expect(inferrer.infer([1, 2, 3])).toEqual({
        type: "array",
        items: { type: "integer" },
      });
    });

    it("returns items:boolean-schema for array of booleans", () => {
      expect(inferrer.infer([true, false, true])).toEqual({
        type: "array",
        items: { type: "boolean" },
      });
    });

    it("returns items:object-schema for uniform array of identical objects", () => {
      const result = inferrer.infer([{ id: 1 }, { id: 2 }]);
      expect(result).toMatchObject({ type: "array" });
      const items = (result as Record<string, unknown>)["items"] as Record<
        string,
        unknown
      >;
      expect(items["type"]).toBe("object");
    });
  });

  describe("infer() — heterogeneous array (oneOf)", () => {
    it("returns oneOf for array with string and integer elements", () => {
      const result = inferrer.infer(["hello", 42]);
      const items = (result as Record<string, unknown>)["items"] as Record<
        string,
        unknown
      >;
      expect(Array.isArray(items["oneOf"])).toBe(true);
      const oneOf = items["oneOf"] as unknown[];
      expect(oneOf).toContainEqual({ type: "string" });
      expect(oneOf).toContainEqual({ type: "integer" });
    });

    it("deduplicates identical schemas in oneOf", () => {
      // ["a", "b", 1] → string appears twice; oneOf should have string+integer only
      const result = inferrer.infer(["a", "b", 1]);
      const items = (result as Record<string, unknown>)["items"] as Record<
        string,
        unknown
      >;
      const oneOf = items["oneOf"] as unknown[];
      const stringCount = oneOf.filter(
        (s) => (s as Record<string, unknown>)["type"] === "string",
      ).length;
      expect(stringCount).toBe(1);
    });

    it("preserves first-seen order in oneOf", () => {
      // integer first, then string
      const result = inferrer.infer([1, "hello"]);
      const items = (result as Record<string, unknown>)["items"] as Record<
        string,
        unknown
      >;
      const oneOf = items["oneOf"] as Array<Record<string, unknown>>;
      expect(oneOf[0]["type"]).toBe("integer");
      expect(oneOf[1]["type"]).toBe("string");
    });

    it("handles array containing null elements", () => {
      const result = inferrer.infer([null, "foo"]);
      const items = (result as Record<string, unknown>)["items"] as Record<
        string,
        unknown
      >;
      const oneOf = items["oneOf"] as Array<Record<string, unknown>>;
      expect(oneOf.some((s) => s["type"] === "null")).toBe(true);
    });
  });

  describe("infer() — empty object", () => {
    it("returns {type:'object', properties:{}, required:[]} for {}", () => {
      expect(inferrer.infer({})).toEqual({
        type: "object",
        properties: {},
        required: [],
      });
    });
  });

  describe("infer() — non-empty object", () => {
    it("generates properties with correct key schemas", () => {
      const result = inferrer.infer({ name: "Alice", age: 30 });
      const schema = result as {
        type: string;
        properties: Record<string, unknown>;
        required: string[];
      };
      expect(schema.type).toBe("object");
      expect(schema.properties["name"]).toEqual({ type: "string" });
      expect(schema.properties["age"]).toEqual({ type: "integer" });
    });

    it("required array contains all keys from the example object", () => {
      const result = inferrer.infer({ a: 1, b: "x", c: true });
      const schema = result as { required: string[] };
      expect(schema.required).toContain("a");
      expect(schema.required).toContain("b");
      expect(schema.required).toContain("c");
    });

    it("preserves key insertion order in properties", () => {
      const example = { z: 1, a: 2, m: 3 };
      const result = inferrer.infer(example) as {
        properties: Record<string, unknown>;
        required: string[];
      };
      const propKeys = Object.keys(result.properties);
      expect(propKeys).toEqual(["z", "a", "m"]);
    });

    it("preserves key insertion order in required array", () => {
      const example = { z: 1, a: 2, m: 3 };
      const result = inferrer.infer(example) as { required: string[] };
      expect(result.required).toEqual(["z", "a", "m"]);
    });

    it("recursively infers nested object schemas", () => {
      const result = inferrer.infer({ user: { id: 1, name: "Alice" } }) as {
        properties: Record<string, unknown>;
      };
      const userSchema = result.properties["user"] as Record<string, unknown>;
      expect(userSchema["type"]).toBe("object");
      const userProps = userSchema["properties"] as Record<string, unknown>;
      expect(userProps["id"]).toEqual({ type: "integer" });
      expect(userProps["name"]).toEqual({ type: "string" });
    });

    it("recursively infers nested array schemas", () => {
      const result = inferrer.infer({ tags: ["a", "b"] }) as {
        properties: Record<string, unknown>;
      };
      const tagsSchema = result.properties["tags"] as Record<string, unknown>;
      expect(tagsSchema["type"]).toBe("array");
      expect((tagsSchema["items"] as Record<string, unknown>)["type"]).toBe(
        "string",
      );
    });
  });

  describe("infer() — real-world examples", () => {
    it("infers the canonical Create User example schema", () => {
      const example = {
        id: 42,
        email: "user@example.com",
        name: "Test User",
        role: "viewer",
        createdAt: "2024-01-01T00:00:00Z",
        active: true,
      };
      const result = inferrer.infer(example) as {
        type: string;
        properties: Record<string, { type: string }>;
        required: string[];
      };
      expect(result.type).toBe("object");
      expect(result.properties["id"].type).toBe("integer");
      expect(result.properties["email"].type).toBe("string");
      expect(result.properties["active"].type).toBe("boolean");
      expect(result.required).toEqual([
        "id",
        "email",
        "name",
        "role",
        "createdAt",
        "active",
      ]);
    });

    it("handles object with a null value for a property", () => {
      const result = inferrer.infer({ value: null }) as {
        properties: Record<string, unknown>;
      };
      expect(result.properties["value"]).toEqual({ type: "null" });
    });

    it("handles deeply nested structure without stack overflow", () => {
      const deep = { l1: { l2: { l3: { l4: { value: "deep" } } } } };
      expect(() => inferrer.infer(deep)).not.toThrow();
    });
  });

  describe("infer() — determinism", () => {
    it("produces byte-identical output for the same input on repeated calls", () => {
      const example = { b: 2, a: 1, c: [1, 2] };
      const first = JSON.stringify(inferrer.infer(example));
      const second = JSON.stringify(inferrer.infer(example));
      expect(first).toBe(second);
    });

    it("produces byte-identical output regardless of call order on different inputs", () => {
      const input = { z: "last", a: "first" };
      const r1 = JSON.stringify(inferrer.infer(input));
      // Call with a different object in between
      inferrer.infer({ x: 1 });
      const r2 = JSON.stringify(inferrer.infer(input));
      expect(r1).toBe(r2);
    });
  });

  describe("infer() — undefined (defensive guard)", () => {
    it("returns {} for undefined (matches anything)", () => {
      // undefined is only reachable through sparse arrays or programmatic call
      expect(inferrer.infer(undefined)).toEqual({});
    });
  });

  describe("infer() — never throws", () => {
    it("does not throw for any JSON-compatible value", () => {
      const values = [
        null,
        true,
        false,
        0,
        -1,
        3.14,
        "",
        "str",
        [],
        {},
        [1, "a", null],
      ];
      for (const v of values) {
        expect(() => inferrer.infer(v)).not.toThrow();
      }
    });
  });
});
