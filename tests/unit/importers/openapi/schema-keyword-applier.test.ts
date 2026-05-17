import { describe, expect, it } from "vitest";

import { SchemaKeywordApplier } from "../../../../src/importers/openapi/schema-keyword-applier.js";
import type { JsonSchema } from "../../../../src/importers/openapi/types.js";

/**
 * Unit tests for SchemaKeywordApplier.
 *
 * Covers uncovered branches in each apply* method:
 *   - applyComposition: compKey present but value is NOT an array (no-op)
 *   - applyItems: items is an array (map branch) vs single object branch
 *   - applyAdditionalProperties: boolean false branch vs object branch
 *   - applyProperties: malformed properties (array / null) triggers warnFn
 *   - applyType: nullable=true type expansion
 *   - applyScalarKeys: copies scalars verbatim
 */

const identity = (n: unknown): JsonSchema => n as JsonSchema;

describe("SchemaKeywordApplier", () => {
  describe("applyType()", () => {
    it("copies type as-is when nullable is false", () => {
      const applier = new SchemaKeywordApplier();
      const result: Record<string, unknown> = {};
      applier.applyType({ type: "string" }, false, result);
      expect(result["type"]).toBe("string");
    });

    it("expands type to [type,'null'] when nullable is true", () => {
      const applier = new SchemaKeywordApplier();
      const result: Record<string, unknown> = {};
      applier.applyType({ type: "string" }, true, result);
      expect(result["type"]).toEqual(["string", "null"]);
    });

    it("does nothing when raw has no type field", () => {
      const applier = new SchemaKeywordApplier();
      const result: Record<string, unknown> = {};
      applier.applyType({}, false, result);
      expect("type" in result).toBe(false);
    });
  });

  describe("applySimpleKeywords()", () => {
    it("copies format when present", () => {
      const applier = new SchemaKeywordApplier();
      const result: Record<string, unknown> = {};
      applier.applySimpleKeywords({ format: "date-time" }, result);
      expect(result["format"]).toBe("date-time");
    });

    it("copies enum array when present", () => {
      const applier = new SchemaKeywordApplier();
      const result: Record<string, unknown> = {};
      applier.applySimpleKeywords({ enum: ["a", "b"] }, result);
      expect(result["enum"]).toEqual(["a", "b"]);
    });

    it("copies const when present (including falsy values)", () => {
      const applier = new SchemaKeywordApplier();
      const result: Record<string, unknown> = {};
      applier.applySimpleKeywords({ const: 0 }, result);
      expect(result["const"]).toBe(0);
    });
  });

  describe("applyComposition()", () => {
    it("maps allOf subschemas through convertFn", () => {
      const applier = new SchemaKeywordApplier();
      const result: Record<string, unknown> = {};
      applier.applyComposition(
        { allOf: [{ type: "string" }, { type: "integer" }] },
        identity,
        result,
      );
      expect(Array.isArray(result["allOf"])).toBe(true);
      expect((result["allOf"] as unknown[]).length).toBe(2);
    });

    it("does nothing when compKey is present but value is NOT an array — non-array branch", () => {
      const applier = new SchemaKeywordApplier();
      const result: Record<string, unknown> = {};
      // oneOf is present but is an object, not an array
      const raw: Record<string, unknown> = { oneOf: { type: "string" } };
      applier.applyComposition(raw, identity, result);
      // should not set oneOf on result
      expect("oneOf" in result).toBe(false);
    });

    it("does nothing when composition key is absent", () => {
      const applier = new SchemaKeywordApplier();
      const result: Record<string, unknown> = {};
      applier.applyComposition({ type: "object" }, identity, result);
      expect("allOf" in result).toBe(false);
      expect("oneOf" in result).toBe(false);
      expect("anyOf" in result).toBe(false);
    });
  });

  describe("applyProperties()", () => {
    it("converts each property through convertFn", () => {
      const applier = new SchemaKeywordApplier();
      const result: Record<string, unknown> = {};
      const warned: string[] = [];
      applier.applyProperties(
        { properties: { name: { type: "string" } }, required: ["name"] },
        identity,
        (msg) => warned.push(msg),
        result,
      );
      expect(result["properties"]).toBeDefined();
      expect(result["required"]).toEqual(["name"]);
      expect(warned).toHaveLength(0);
    });

    it("calls warnFn and skips when properties is an array — malformed branch", () => {
      const applier = new SchemaKeywordApplier();
      const result: Record<string, unknown> = {};
      const warned: string[] = [];
      applier.applyProperties(
        { properties: ["a", "b"] as unknown },
        identity,
        (msg) => warned.push(msg),
        result,
      );
      expect("properties" in result).toBe(false);
      expect(warned.length).toBeGreaterThan(0);
      expect(warned[0]).toContain("properties");
    });

    it("calls warnFn and skips when properties is null — malformed null branch", () => {
      const applier = new SchemaKeywordApplier();
      const result: Record<string, unknown> = {};
      const warned: string[] = [];
      const raw: Record<string, unknown> = { properties: null };
      applier.applyProperties(
        raw,
        identity,
        (msg) => warned.push(msg),
        result,
      );
      expect("properties" in result).toBe(false);
      expect(warned.length).toBeGreaterThan(0);
    });

    it("does nothing when properties key is absent", () => {
      const applier = new SchemaKeywordApplier();
      const result: Record<string, unknown> = {};
      const warned: string[] = [];
      applier.applyProperties({ type: "object" }, identity, (m) => warned.push(m), result);
      expect("properties" in result).toBe(false);
      expect(warned).toHaveLength(0);
    });
  });

  describe("applyItems()", () => {
    it("maps array items through convertFn — array branch", () => {
      const applier = new SchemaKeywordApplier();
      const result: Record<string, unknown> = {};
      applier.applyItems(
        { items: [{ type: "string" }, { type: "integer" }] },
        identity,
        result,
      );
      expect(Array.isArray(result["items"])).toBe(true);
      expect((result["items"] as unknown[]).length).toBe(2);
    });

    it("converts single items object through convertFn — single object branch", () => {
      const applier = new SchemaKeywordApplier();
      const result: Record<string, unknown> = {};
      applier.applyItems({ items: { type: "string" } }, identity, result);
      expect(result["items"]).toEqual({ type: "string" });
    });

    it("does nothing when items is absent", () => {
      const applier = new SchemaKeywordApplier();
      const result: Record<string, unknown> = {};
      applier.applyItems({ type: "array" }, identity, result);
      expect("items" in result).toBe(false);
    });
  });

  describe("applyAdditionalProperties()", () => {
    it("passes boolean false through", () => {
      const applier = new SchemaKeywordApplier();
      const result: Record<string, unknown> = {};
      applier.applyAdditionalProperties({ additionalProperties: false }, identity, result);
      expect(result["additionalProperties"]).toBe(false);
    });

    it("passes boolean true through", () => {
      const applier = new SchemaKeywordApplier();
      const result: Record<string, unknown> = {};
      applier.applyAdditionalProperties({ additionalProperties: true }, identity, result);
      expect(result["additionalProperties"]).toBe(true);
    });

    it("converts object additionalProperties through convertFn — object branch", () => {
      const applier = new SchemaKeywordApplier();
      const result: Record<string, unknown> = {};
      applier.applyAdditionalProperties(
        { additionalProperties: { type: "string" } },
        identity,
        result,
      );
      expect(result["additionalProperties"]).toEqual({ type: "string" });
    });

    it("does nothing when additionalProperties is absent", () => {
      const applier = new SchemaKeywordApplier();
      const result: Record<string, unknown> = {};
      applier.applyAdditionalProperties({ type: "object" }, identity, result);
      expect("additionalProperties" in result).toBe(false);
    });
  });

  describe("applyScalarKeys()", () => {
    it("copies minimum and maximum", () => {
      const applier = new SchemaKeywordApplier();
      const result: Record<string, unknown> = {};
      applier.applyScalarKeys({ minimum: 1, maximum: 100 }, result);
      expect(result["minimum"]).toBe(1);
      expect(result["maximum"]).toBe(100);
    });

    it("copies pattern, minLength, maxLength", () => {
      const applier = new SchemaKeywordApplier();
      const result: Record<string, unknown> = {};
      applier.applyScalarKeys({ pattern: "^[a-z]+$", minLength: 1, maxLength: 50 }, result);
      expect(result["pattern"]).toBe("^[a-z]+$");
      expect(result["minLength"]).toBe(1);
      expect(result["maxLength"]).toBe(50);
    });

    it("does nothing when no scalar keys present", () => {
      const applier = new SchemaKeywordApplier();
      const result: Record<string, unknown> = {};
      applier.applyScalarKeys({ type: "object" }, result);
      expect(Object.keys(result)).toHaveLength(0);
    });
  });
});
