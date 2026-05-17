import { describe, expect, it } from "vitest";

import { OpenApiSchemaConverter } from "../../../../src/importers/openapi/schema-converter.js";

/**
 * Unit tests for OpenApiSchemaConverter.
 *
 * Pure class: exercised with literal spec schema objects. Covers: object with
 * properties+required, nullable:true normalization, allOf/oneOf/anyOf, items
 * array, carried-through scalar keywords, empty/null/non-object fallback,
 * depth bound at 256 (permissive fallback — NO throw, NO overflow), malformed
 * keyword drop + warning, vendor x-* drop, integer formats, determinism
 * (byte-identical output), default-seam wiring.
 *
 * CRITICAL: the depth-bound test builds a nested schema ITERATIVELY (not
 * recursively) to avoid stack overflow on CI's Node 22 smaller stack.
 * The schema is built as a flat object with iteratively appended nesting,
 * NOT via a recursive JS function.
 */
describe("OpenApiSchemaConverter", () => {
  describe("constructor — default-seam wiring", () => {
    it("constructs with no arguments and exposes a convert method", () => {
      const conv = new OpenApiSchemaConverter();
      expect(typeof conv.convert).toBe("function");
    });
  });

  describe("convert() — basic object schema", () => {
    it("preserves type, properties, and required list", () => {
      const conv = new OpenApiSchemaConverter();
      const { schema } = conv.convert({
        type: "object",
        properties: {
          id: { type: "integer" },
          name: { type: "string" },
        },
        required: ["id", "name"],
      });
      expect(schema["type"]).toBe("object");
      expect(schema["required"]).toEqual(["id", "name"]);
      expect(
        (schema["properties"] as Record<string, unknown>)["id"],
      ).toBeDefined();
    });

    it("recursively converts nested property schemas", () => {
      const conv = new OpenApiSchemaConverter();
      const { schema } = conv.convert({
        type: "object",
        properties: {
          address: {
            type: "object",
            properties: { street: { type: "string" } },
          },
        },
      });
      const props = schema["properties"] as Record<string, unknown>;
      expect(props["address"]).toBeDefined();
    });

    it("preserves required array in source order", () => {
      const conv = new OpenApiSchemaConverter();
      const { schema } = conv.convert({
        type: "object",
        required: ["c", "a", "b"],
        properties: { a: {}, b: {}, c: {} },
      });
      expect(schema["required"]).toEqual(["c", "a", "b"]);
    });

    it("returns no warnings for a clean object schema", () => {
      const conv = new OpenApiSchemaConverter();
      const { warnings } = conv.convert({ type: "object", properties: {} });
      expect(warnings).toEqual([]);
    });
  });

  describe("convert() — string and primitive schemas", () => {
    it("converts a simple string schema", () => {
      const conv = new OpenApiSchemaConverter();
      const { schema } = conv.convert({ type: "string" });
      expect(schema["type"]).toBe("string");
    });

    it("converts an integer schema with format", () => {
      const conv = new OpenApiSchemaConverter();
      const { schema } = conv.convert({ type: "integer", format: "int64" });
      expect(schema["type"]).toBe("integer");
      expect(schema["format"]).toBe("int64");
    });

    it("carries through enum keyword", () => {
      const conv = new OpenApiSchemaConverter();
      const { schema } = conv.convert({ type: "string", enum: ["a", "b"] });
      expect(schema["enum"]).toEqual(["a", "b"]);
    });
  });

  describe("convert() — nullable:true (OpenAPI 3.0 normalization)", () => {
    it("converts {type:'string', nullable:true} to type array including 'null'", () => {
      const conv = new OpenApiSchemaConverter();
      const { schema } = conv.convert({ type: "string", nullable: true });
      const type = schema["type"];
      expect(Array.isArray(type)).toBe(true);
      expect((type as string[]).includes("null")).toBe(true);
      expect((type as string[]).includes("string")).toBe(true);
    });

    it("preserves the original type first, then 'null'", () => {
      const conv = new OpenApiSchemaConverter();
      const { schema } = conv.convert({ type: "integer", nullable: true });
      const type = schema["type"] as string[];
      expect(type[0]).toBe("integer");
      expect(type[1]).toBe("null");
    });

    it("drops the nullable keyword from the output", () => {
      const conv = new OpenApiSchemaConverter();
      const { schema } = conv.convert({ type: "string", nullable: true });
      expect("nullable" in schema).toBe(false);
    });

    it("does not emit a warning for nullable:true (lossless normalization)", () => {
      const conv = new OpenApiSchemaConverter();
      const { warnings } = conv.convert({ type: "string", nullable: true });
      expect(warnings).toEqual([]);
    });

    it("passes through 3.1 type array including null unchanged", () => {
      const conv = new OpenApiSchemaConverter();
      const { schema } = conv.convert({ type: ["string", "null"] });
      expect(schema["type"]).toEqual(["string", "null"]);
    });
  });

  describe("convert() — allOf / oneOf / anyOf", () => {
    it("converts allOf subschemas recursively", () => {
      const conv = new OpenApiSchemaConverter();
      const { schema } = conv.convert({
        allOf: [{ type: "object", properties: { a: { type: "string" } } }],
      });
      const allOf = schema["allOf"] as unknown[];
      expect(Array.isArray(allOf)).toBe(true);
      expect(allOf).toHaveLength(1);
    });

    it("converts oneOf subschemas recursively", () => {
      const conv = new OpenApiSchemaConverter();
      const { schema } = conv.convert({
        oneOf: [{ type: "string" }, { type: "integer" }],
      });
      const oneOf = schema["oneOf"] as unknown[];
      expect(oneOf).toHaveLength(2);
    });

    it("converts anyOf subschemas recursively", () => {
      const conv = new OpenApiSchemaConverter();
      const { schema } = conv.convert({
        anyOf: [{ type: "boolean" }, { type: "null" }],
      });
      const anyOf = schema["anyOf"] as unknown[];
      expect(anyOf).toHaveLength(2);
    });

    it("preserves document order of allOf array", () => {
      const conv = new OpenApiSchemaConverter();
      const { schema } = conv.convert({
        allOf: [{ type: "string" }, { type: "integer" }, { type: "boolean" }],
      });
      const allOf = schema["allOf"] as Array<Record<string, unknown>>;
      expect(allOf.map((s) => s["type"])).toEqual(["string", "integer", "boolean"]);
    });

    it("keeps type alongside allOf when both are present", () => {
      const conv = new OpenApiSchemaConverter();
      const { schema } = conv.convert({
        type: "object",
        allOf: [{ required: ["id"] }],
      });
      expect(schema["type"]).toBe("object");
      expect(schema["allOf"]).toBeDefined();
    });
  });

  describe("convert() — array items", () => {
    it("converts items schema recursively for array type", () => {
      const conv = new OpenApiSchemaConverter();
      const { schema } = conv.convert({
        type: "array",
        items: { type: "string" },
      });
      expect(schema["type"]).toBe("array");
      const items = schema["items"] as Record<string, unknown>;
      expect(items["type"]).toBe("string");
    });

    it("converts tuple items (array form) recursively", () => {
      const conv = new OpenApiSchemaConverter();
      const { schema } = conv.convert({
        type: "array",
        items: [{ type: "string" }, { type: "integer" }],
      });
      const items = schema["items"] as Array<Record<string, unknown>>;
      expect(Array.isArray(items)).toBe(true);
      expect(items).toHaveLength(2);
    });
  });

  describe("convert() — scalar/pass-through keywords", () => {
    it("carries through minimum and maximum", () => {
      const conv = new OpenApiSchemaConverter();
      const { schema } = conv.convert({ type: "integer", minimum: 0, maximum: 100 });
      expect(schema["minimum"]).toBe(0);
      expect(schema["maximum"]).toBe(100);
    });

    it("carries through minLength and maxLength", () => {
      const conv = new OpenApiSchemaConverter();
      const { schema } = conv.convert({ type: "string", minLength: 1, maxLength: 255 });
      expect(schema["minLength"]).toBe(1);
      expect(schema["maxLength"]).toBe(255);
    });

    it("carries through pattern", () => {
      const conv = new OpenApiSchemaConverter();
      const { schema } = conv.convert({ type: "string", pattern: "^[a-z]+$" });
      expect(schema["pattern"]).toBe("^[a-z]+$");
    });

    it("drops example keyword from the output (not a JSON Schema keyword)", () => {
      const conv = new OpenApiSchemaConverter();
      const { schema } = conv.convert({ type: "object", example: { id: 1 } });
      expect("example" in schema).toBe(false);
    });

    it("drops examples keyword from the output", () => {
      const conv = new OpenApiSchemaConverter();
      const { schema } = conv.convert({ type: "string", examples: ["foo"] });
      expect("examples" in schema).toBe(false);
    });

    it("drops vendor x-* keys silently", () => {
      const conv = new OpenApiSchemaConverter();
      const { schema, warnings } = conv.convert({
        type: "string",
        "x-deprecated": true,
        "x-owner": "team-a",
      });
      expect("x-deprecated" in schema).toBe(false);
      expect("x-owner" in schema).toBe(false);
      // No warning for silently dropped vendor keys
      expect(warnings.every((w) => !w.includes("x-deprecated"))).toBe(true);
    });

    it("carries through additionalProperties when it is a boolean", () => {
      const conv = new OpenApiSchemaConverter();
      const { schema } = conv.convert({ type: "object", additionalProperties: false });
      expect(schema["additionalProperties"]).toBe(false);
    });

    it("recurses additionalProperties when it is a schema object", () => {
      const conv = new OpenApiSchemaConverter();
      const { schema } = conv.convert({
        type: "object",
        additionalProperties: { type: "string" },
      });
      const ap = schema["additionalProperties"] as Record<string, unknown>;
      expect(ap["type"]).toBe("string");
    });

    it("carries through const keyword", () => {
      const conv = new OpenApiSchemaConverter();
      const { schema } = conv.convert({ type: "string", const: "fixed" });
      expect(schema["const"]).toBe("fixed");
    });

    it("carries through default keyword", () => {
      const conv = new OpenApiSchemaConverter();
      const { schema } = conv.convert({ type: "integer", default: 42 });
      expect(schema["default"]).toBe(42);
    });

    it("carries through minItems and maxItems for arrays", () => {
      const conv = new OpenApiSchemaConverter();
      const { schema } = conv.convert({ type: "array", items: { type: "string" }, minItems: 1, maxItems: 10 });
      expect(schema["minItems"]).toBe(1);
      expect(schema["maxItems"]).toBe(10);
    });
  });

  describe("convert() — empty / null / unrecognizable schema fallback", () => {
    it("returns permissive {type:'object'} for an empty object schema", () => {
      const conv = new OpenApiSchemaConverter();
      const { schema } = conv.convert({});
      expect(schema).toMatchObject({ type: "object" });
    });

    it("emits a warning for an empty schema", () => {
      const conv = new OpenApiSchemaConverter();
      const { warnings } = conv.convert({});
      expect(warnings.length).toBeGreaterThan(0);
    });

    it("returns permissive {type:'object'} for null input", () => {
      const conv = new OpenApiSchemaConverter();
      const { schema } = conv.convert(null);
      expect(schema).toMatchObject({ type: "object" });
    });

    it("returns permissive {type:'object'} for undefined input", () => {
      const conv = new OpenApiSchemaConverter();
      const { schema } = conv.convert(undefined);
      expect(schema).toMatchObject({ type: "object" });
    });

    it("returns permissive {type:'object'} for a string input", () => {
      const conv = new OpenApiSchemaConverter();
      const { schema } = conv.convert("not a schema");
      expect(schema).toMatchObject({ type: "object" });
    });

    it("returns permissive {type:'object'} for an array input", () => {
      const conv = new OpenApiSchemaConverter();
      const { schema } = conv.convert([1, 2, 3]);
      expect(schema).toMatchObject({ type: "object" });
    });

    it("never throws for any non-object input", () => {
      const conv = new OpenApiSchemaConverter();
      expect(() => conv.convert(null)).not.toThrow();
      expect(() => conv.convert(undefined)).not.toThrow();
      expect(() => conv.convert("garbage")).not.toThrow();
      expect(() => conv.convert(42)).not.toThrow();
    });
  });

  describe("convert() — malformed keyword drop + warning", () => {
    it("drops malformed 'properties' (string) and emits a warning", () => {
      const conv = new OpenApiSchemaConverter();
      const { schema, warnings } = conv.convert({
        type: "object",
        properties: "not-an-object",
      });
      expect("properties" in schema).toBe(false);
      expect(warnings.some((w) => w.toLowerCase().includes("properties"))).toBe(
        true,
      );
    });

    it("continues converting recognized keywords when one keyword is malformed", () => {
      const conv = new OpenApiSchemaConverter();
      const { schema } = conv.convert({
        type: "object",
        properties: "bad",
        required: ["a"],
      });
      // type and required should still be in the output
      expect(schema["type"]).toBe("object");
    });

    it("never throws for a malformed keyword", () => {
      const conv = new OpenApiSchemaConverter();
      expect(() =>
        conv.convert({ type: "object", properties: "bad" }),
      ).not.toThrow();
    });
  });

  describe("convert() — depth bound at 256", () => {
    it("returns permissive {type:'object'} and a warning for a schema nested > 256 levels deep (built iteratively)", () => {
      // CRITICAL: built iteratively NOT recursively to avoid CI stack overflow.
      // We create the deeply-nested structure using a loop, appending string
      // segments to build the JSON manually, then parse it back with parseJson.
      // This avoids any recursive JS call stack overhead during test construction.

      // Build a JSON string for 260 levels of nesting iteratively:
      // {"type":"object","properties":{"x":{"type":"object","properties":{"x":{...}}}}}
      const DEPTH = 260; // > 256 limit
      let innerJson = '{"type":"string"}';
      for (let i = 0; i < DEPTH; i++) {
        innerJson =
          '{"type":"object","properties":{"x":' + innerJson + "}}";
      }
      // Parse the built JSON without recursion
      const schema = JSON.parse(innerJson) as unknown;

      const conv = new OpenApiSchemaConverter();
      const { schema: result, warnings } = conv.convert(schema);

      // Must return permissive fallback and a warning — never throw
      expect(result).toMatchObject({ type: "object" });
      expect(warnings.some((w) => w.toLowerCase().includes("depth"))).toBe(true);
    });

    it("does not throw — inverted failure mode vs JsonSchemaInferrer (fallback, never overflow)", () => {
      // The contract is clear: depth exceeded → permissive fallback, no throw.
      // Build depth 257 iteratively.
      let innerJson = '{"type":"string"}';
      for (let i = 0; i < 257; i++) {
        innerJson =
          '{"type":"object","properties":{"x":' + innerJson + "}}";
      }
      const schema = JSON.parse(innerJson) as unknown;
      const conv = new OpenApiSchemaConverter();
      expect(() => conv.convert(schema)).not.toThrow();
    });
  });

  describe("convert() — determinism (identical input → byte-identical output)", () => {
    it("produces byte-identical JSON.stringify output for the same input called twice", () => {
      const conv = new OpenApiSchemaConverter();
      const input = {
        type: "object",
        properties: {
          b: { type: "string" },
          a: { type: "integer" },
        },
        required: ["a", "b"],
        nullable: true,
      };
      const { schema: s1 } = conv.convert(input);
      const { schema: s2 } = conv.convert(input);
      expect(JSON.stringify(s1)).toBe(JSON.stringify(s2));
    });

    it("emits keys in the fixed canonical schema-key order (type before properties)", () => {
      const conv = new OpenApiSchemaConverter();
      const { schema } = conv.convert({
        required: ["a"],
        properties: { a: { type: "string" } },
        type: "object",
      });
      const keys = Object.keys(schema);
      const typeIdx = keys.indexOf("type");
      const propsIdx = keys.indexOf("properties");
      expect(typeIdx).toBeLessThan(propsIdx);
    });
  });

  describe("convert() — pure: does not mutate input", () => {
    it("does not modify the input schema object", () => {
      const conv = new OpenApiSchemaConverter();
      const input = { type: "object", nullable: true, "x-foo": "bar" };
      const before = JSON.stringify(input);
      conv.convert(input);
      expect(JSON.stringify(input)).toBe(before);
    });
  });

  describe("convert() — return shape", () => {
    it("always returns {schema, warnings} shape", () => {
      const conv = new OpenApiSchemaConverter();
      const result = conv.convert({ type: "string" });
      expect(typeof result).toBe("object");
      expect("schema" in result).toBe(true);
      expect("warnings" in result).toBe(true);
      expect(Array.isArray(result.warnings)).toBe(true);
    });

    it("never returns a schema with $ref strings (no pass-through of $ref)", () => {
      const conv = new OpenApiSchemaConverter();
      // After dereference, $ref nodes should not appear; but if one slips through
      // to the converter, it should NOT be passed to the output.
      const { schema } = conv.convert({ $ref: "#/components/schemas/User" });
      expect(JSON.stringify(schema)).not.toContain("$ref");
    });
  });
});
