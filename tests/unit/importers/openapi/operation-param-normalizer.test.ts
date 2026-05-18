import { describe, expect, it } from "vitest";

import { OperationParamNormalizer } from "../../../../src/importers/openapi/operation-param-normalizer.js";

/**
 * Unit tests for OperationParamNormalizer.
 *
 * Covers branches in:
 *   - normalizeParameters: unknown "in" value returns null (skipped)
 *   - #lift2xInlineSchema: type=undefined + schema object present (returns schema),
 *     type=undefined + no schema (returns undefined)
 *   - mergeParameters: override and append paths
 */

describe("OperationParamNormalizer", () => {
  describe("normalizeParameters() — 3.x", () => {
    it("normalizes a single path param", () => {
      const norm = new OperationParamNormalizer();
      const params = norm.normalizeParameters(
        [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        "openapi-3",
      );
      expect(params).toHaveLength(1);
      expect(params[0]?.location).toBe("path");
      expect(params[0]?.required).toBe(true);
    });

    it("normalizes a query param and a header param", () => {
      const norm = new OperationParamNormalizer();
      const params = norm.normalizeParameters(
        [
          { name: "limit", in: "query", required: false, schema: { type: "integer" } },
          { name: "X-Custom", in: "header", required: false, schema: { type: "string" } },
        ],
        "openapi-3",
      );
      expect(params).toHaveLength(2);
      expect(params[0]?.location).toBe("query");
      expect(params[1]?.location).toBe("header");
    });

    it("skips params with unrecognized 'in' value — null branch", () => {
      const norm = new OperationParamNormalizer();
      const params = norm.normalizeParameters(
        [{ name: "x", in: "cookie", required: false }],
        "openapi-3",
      );
      // 'cookie' is not a supported location; param is dropped
      expect(params).toHaveLength(0);
    });

    it("skips non-object entries in rawParams array", () => {
      const norm = new OperationParamNormalizer();
      const params = norm.normalizeParameters(
        ["not-an-object", null, 42],
        "openapi-3",
      );
      expect(params).toHaveLength(0);
    });
  });

  describe("normalizeParameters() — 2.0 body/formData routing", () => {
    it("routes body param with _raw2xIn='body'", () => {
      const norm = new OperationParamNormalizer();
      const params = norm.normalizeParameters(
        [{ name: "body", in: "body", required: true, schema: { type: "object" } }],
        "swagger-2",
      );
      expect(params).toHaveLength(1);
      expect(params[0]?._raw2xIn).toBe("body");
    });

    it("routes formData param with _raw2xIn='formData'", () => {
      const norm = new OperationParamNormalizer();
      const params = norm.normalizeParameters(
        [{ name: "file", in: "formData", required: true, type: "string" }],
        "swagger-2",
      );
      expect(params).toHaveLength(1);
      expect(params[0]?._raw2xIn).toBe("formData");
    });

    it("captures schema from 2.0 body param when present — schema branch", () => {
      const norm = new OperationParamNormalizer();
      const params = norm.normalizeParameters(
        [{ name: "payload", in: "body", required: true, schema: { type: "object" } }],
        "swagger-2",
      );
      expect(params[0]?.schema).toMatchObject({ type: "object" });
    });

    it("captures x-example from 2.0 body param when present — example branch", () => {
      const norm = new OperationParamNormalizer();
      const params = norm.normalizeParameters(
        [{ name: "payload", in: "body", required: true, "x-example": { id: 1 } }],
        "swagger-2",
      );
      expect(params[0]?.example).toEqual({ id: 1 });
    });
  });

  describe("normalizeParameters() — 2.0 inline schema lifting", () => {
    it("lifts inline type keywords into a schema object for 2.0 query params", () => {
      const norm = new OperationParamNormalizer();
      const params = norm.normalizeParameters(
        [{ name: "limit", in: "query", type: "integer", format: "int32" }],
        "swagger-2",
      );
      expect(params[0]?.schema?.["type"]).toBe("integer");
      expect(params[0]?.schema?.["format"]).toBe("int32");
    });

    it("lifts 2.0 formData param without type but with schema — schema object branch", () => {
      const norm = new OperationParamNormalizer();
      // formData param without 'type' but with 'schema' — lift2xInlineSchema schema branch
      const params = norm.normalizeParameters(
        [{ name: "data", in: "formData", required: true, schema: { type: "object" } }],
        "swagger-2",
      );
      expect(params[0]?._raw2xIn).toBe("formData");
      expect(params[0]?.schema).toMatchObject({ type: "object" });
    });

    it("returns undefined schema for 2.0 formData param with no type and no schema", () => {
      const norm = new OperationParamNormalizer();
      const params = norm.normalizeParameters(
        [{ name: "data", in: "formData", required: false }],
        "swagger-2",
      );
      expect(params[0]?.schema).toBeUndefined();
    });

    it("lifts items when it is an array of schemas — Array.isArray branch", () => {
      const norm = new OperationParamNormalizer();
      const params = norm.normalizeParameters(
        [{ name: "tags", in: "query", type: "array", items: [{ type: "string" }] }],
        "swagger-2",
      );
      expect(params[0]?.schema?.["items"]).toEqual([{ type: "string" }]);
    });

    it("lifts items when it is a single schema object — isObject branch", () => {
      const norm = new OperationParamNormalizer();
      const params = norm.normalizeParameters(
        [{ name: "tags", in: "query", type: "array", items: { type: "string" } }],
        "swagger-2",
      );
      expect(params[0]?.schema?.["items"]).toEqual({ type: "string" });
    });

    it("lifts enum array from 2.0 inline schema", () => {
      const norm = new OperationParamNormalizer();
      const params = norm.normalizeParameters(
        [{ name: "status", in: "query", type: "string", enum: ["active", "inactive"] }],
        "swagger-2",
      );
      expect(params[0]?.schema?.["enum"]).toEqual(["active", "inactive"]);
    });
  });

  describe("mergeParameters()", () => {
    it("appends operation params not already in path params", () => {
      const norm = new OperationParamNormalizer();
      const pathParams = [
        { name: "id", location: "path" as const, required: true },
      ];
      const opParams = [
        { name: "expand", location: "query" as const, required: false },
      ];
      const merged = norm.mergeParameters(pathParams, opParams);
      expect(merged).toHaveLength(2);
    });

    it("operation-level param overrides path-level with same name+location", () => {
      const norm = new OperationParamNormalizer();
      const pathParams = [
        { name: "id", location: "path" as const, required: true, schema: { type: "string" } },
      ];
      const opParams = [
        { name: "id", location: "path" as const, required: true, schema: { type: "integer" } },
      ];
      const merged = norm.mergeParameters(pathParams, opParams);
      expect(merged).toHaveLength(1);
      expect(merged[0]?.schema?.["type"]).toBe("integer");
    });
  });
});
