import { describe, expect, it } from "vitest";

import { OperationBodyNormalizer } from "../../../../src/importers/openapi/operation-body-normalizer.js";

/**
 * Unit tests for OperationBodyNormalizer.
 *
 * Covers all branches in:
 *   - normalizeRequestBody (3.x and 2.0 paths)
 *   - #bodyParamToRequestBody: consumes with non-string elements filtered out,
 *     json consumes pick, default fallback
 *   - #formDataToRequestBody: consumes "multipart/form-data" find() match
 *   - #pickJsonMediaType: jsonish branch, keys[0] fallback, empty returns null
 *   - #pickJsonFromList: json match in list, undefined when no match
 */

describe("OperationBodyNormalizer", () => {
  describe("normalizeRequestBody() — 3.x paths", () => {
    it("returns undefined when operation has no requestBody", () => {
      const normalizer = new OperationBodyNormalizer();
      const result = normalizer.normalizeRequestBody({}, [], [], "openapi-3");
      expect(result).toBeUndefined();
    });

    it("returns undefined when requestBody is not an object", () => {
      const normalizer = new OperationBodyNormalizer();
      const result = normalizer.normalizeRequestBody(
        { requestBody: "not-an-object" }, [], [], "openapi-3",
      );
      expect(result).toBeUndefined();
    });

    it("returns undefined when content is empty for 3.x requestBody", () => {
      const normalizer = new OperationBodyNormalizer();
      const result = normalizer.normalizeRequestBody(
        { requestBody: { content: {} } }, [], [], "openapi-3",
      );
      expect(result).toBeUndefined();
    });

    it("picks application/json media type for 3.x requestBody", () => {
      const normalizer = new OperationBodyNormalizer();
      const result = normalizer.normalizeRequestBody(
        {
          requestBody: {
            content: {
              "application/json": { schema: { type: "object" } },
            },
          },
        },
        [], [], "openapi-3",
      );
      expect(result?.mediaType).toBe("application/json");
      expect(result?.schema).toMatchObject({ type: "object" });
    });

    it("picks vnd.api+json (jsonish) when application/json not present — jsonish branch", () => {
      const normalizer = new OperationBodyNormalizer();
      const result = normalizer.normalizeRequestBody(
        {
          requestBody: {
            content: {
              "application/vnd.api+json": { schema: { type: "object" } },
            },
          },
        },
        [], [], "openapi-3",
      );
      expect(result?.mediaType).toBe("application/vnd.api+json");
    });

    it("picks first entry (text/plain) when no json media type present — keys[0] fallback", () => {
      const normalizer = new OperationBodyNormalizer();
      const result = normalizer.normalizeRequestBody(
        {
          requestBody: {
            content: {
              "text/plain": { schema: { type: "string" } },
            },
          },
        },
        [], [], "openapi-3",
      );
      expect(result?.mediaType).toBe("text/plain");
    });

    it("includes example from media type object when present", () => {
      const normalizer = new OperationBodyNormalizer();
      const result = normalizer.normalizeRequestBody(
        {
          requestBody: {
            content: {
              "application/json": { schema: { type: "object" }, example: { id: 1 } },
            },
          },
        },
        [], [], "openapi-3",
      );
      expect(result?.example).toEqual({ id: 1 });
    });

    it("returns schema undefined when media type entry has no schema object — false branch", () => {
      const normalizer = new OperationBodyNormalizer();
      const result = normalizer.normalizeRequestBody(
        {
          requestBody: {
            content: {
              "application/json": { example: { id: 1 } },
            },
          },
        },
        [], [], "openapi-3",
      );
      // mtObj["schema"] is absent → schema undefined
      expect(result?.schema).toBeUndefined();
      expect(result?.mediaType).toBe("application/json");
      expect(result?.example).toEqual({ id: 1 });
    });
  });

  describe("normalizeRequestBody() — 2.0 body param path", () => {
    it("returns undefined when no body and no formData params", () => {
      const normalizer = new OperationBodyNormalizer();
      const result = normalizer.normalizeRequestBody({}, [], [], "swagger-2");
      expect(result).toBeUndefined();
    });

    it("uses application/json when consumes not declared — default fallback", () => {
      const normalizer = new OperationBodyNormalizer();
      const bodyParam = {
        name: "body", location: "path" as const, required: true,
        schema: { type: "object" },
      };
      const result = normalizer.normalizeRequestBody({}, [bodyParam], [], "swagger-2");
      expect(result?.mediaType).toBe("application/json");
    });

    it("filters out non-string elements from consumes — consumes non-string branch", () => {
      const normalizer = new OperationBodyNormalizer();
      const bodyParam = {
        name: "body", location: "path" as const, required: true,
        schema: { type: "object" },
      };
      // consumes contains a non-string (number) that should be filtered out
      const result = normalizer.normalizeRequestBody(
        { consumes: [42, "application/json"] },
        [bodyParam], [], "swagger-2",
      );
      // The non-string is filtered; application/json is kept
      expect(result?.mediaType).toBe("application/json");
    });

    it("uses body param schema when schema is present", () => {
      const normalizer = new OperationBodyNormalizer();
      const bodyParam = {
        name: "body", location: "path" as const, required: true,
        schema: { type: "object", properties: { name: { type: "string" } } },
      };
      const result = normalizer.normalizeRequestBody({}, [bodyParam], [], "swagger-2");
      expect(result?.schema).toMatchObject({ type: "object" });
    });

    it("includes example from body param when present", () => {
      const normalizer = new OperationBodyNormalizer();
      const bodyParam = {
        name: "body", location: "path" as const, required: true,
        example: { name: "Alice" },
      };
      const result = normalizer.normalizeRequestBody({}, [bodyParam], [], "swagger-2");
      expect(result?.example).toEqual({ name: "Alice" });
    });
  });

  describe("normalizeRequestBody() — 2.0 formData path", () => {
    it("synthesizes object schema from formData params", () => {
      const normalizer = new OperationBodyNormalizer();
      const formDataParams = [
        { name: "file", location: "path" as const, required: true, schema: { type: "string" } },
        { name: "desc", location: "path" as const, required: false },
      ];
      const result = normalizer.normalizeRequestBody({}, [], formDataParams, "swagger-2");
      expect(result?.schema?.["type"]).toBe("object");
      expect(result?.schema?.["properties"]).toBeDefined();
    });

    it("uses default application/x-www-form-urlencoded when consumes is not set", () => {
      const normalizer = new OperationBodyNormalizer();
      const formDataParams = [
        { name: "field", location: "path" as const, required: false },
      ];
      const result = normalizer.normalizeRequestBody({}, [], formDataParams, "swagger-2");
      expect(result?.mediaType).toBe("application/x-www-form-urlencoded");
    });

    it("uses multipart/form-data when consumes includes it — find() match branch", () => {
      const normalizer = new OperationBodyNormalizer();
      const formDataParams = [
        { name: "file", location: "path" as const, required: true },
      ];
      const result = normalizer.normalizeRequestBody(
        { consumes: ["multipart/form-data"] },
        [], formDataParams, "swagger-2",
      );
      expect(result?.mediaType).toBe("multipart/form-data");
    });

    it("uses application/x-www-form-urlencoded when consumes includes it — find() urlencoded branch", () => {
      const normalizer = new OperationBodyNormalizer();
      const formDataParams = [
        { name: "field", location: "path" as const, required: false },
      ];
      const result = normalizer.normalizeRequestBody(
        { consumes: ["application/x-www-form-urlencoded"] },
        [], formDataParams, "swagger-2",
      );
      expect(result?.mediaType).toBe("application/x-www-form-urlencoded");
    });

    it("includes required fields in synthesized schema", () => {
      const normalizer = new OperationBodyNormalizer();
      const formDataParams = [
        { name: "name", location: "path" as const, required: true },
      ];
      const result = normalizer.normalizeRequestBody({}, [], formDataParams, "swagger-2");
      expect(result?.schema?.["required"]).toEqual(["name"]);
    });
  });

  describe("pickJsonMediaType() — public method branches", () => {
    it("returns null for empty content object", () => {
      const normalizer = new OperationBodyNormalizer();
      expect(normalizer.pickJsonMediaType({})).toBeNull();
    });

    it("returns application/json when present", () => {
      const normalizer = new OperationBodyNormalizer();
      expect(normalizer.pickJsonMediaType({ "application/json": {} })).toBe("application/json");
    });

    it("returns first jsonish key when application/json absent — jsonish branch", () => {
      const normalizer = new OperationBodyNormalizer();
      const result = normalizer.pickJsonMediaType({
        "application/vnd.api+json": {},
        "text/plain": {},
      });
      expect(result).toBe("application/vnd.api+json");
    });

    it("returns first key when no json media type present — keys[0] fallback branch", () => {
      const normalizer = new OperationBodyNormalizer();
      const result = normalizer.pickJsonMediaType({ "text/plain": {}, "image/png": {} });
      expect(result).toBe("text/plain");
    });
  });
});
