import { describe, expect, it } from "vitest";

import { OperationResponseExtractor } from "../../../../src/importers/openapi/operation-response-extractor.js";

/**
 * Unit tests for OperationResponseExtractor.
 *
 * Covers branches in:
 *   - normalizeResponses: responses absent, responses with non-object entry (skipped)
 *   - #extractResponseSchema 3.x: empty content (mediaType null → schema undefined),
 *     mtObj["schema"] not an object (schema undefined)
 *   - #extractResponseSchema 2.0: schema present, schema absent
 */

describe("OperationResponseExtractor", () => {
  describe("normalizeResponses() — basic", () => {
    it("returns empty array when responses is absent", () => {
      const extractor = new OperationResponseExtractor();
      const result = extractor.normalizeResponses({}, "openapi-3");
      expect(result).toEqual([]);
    });

    it("returns empty array when responses is not an object", () => {
      const extractor = new OperationResponseExtractor();
      const result = extractor.normalizeResponses({ responses: "not-object" }, "openapi-3");
      expect(result).toEqual([]);
    });

    it("skips non-object entries in the responses map — isObject false branch", () => {
      const extractor = new OperationResponseExtractor();
      const result = extractor.normalizeResponses(
        { responses: { "200": "a string, not an object", "404": { description: "Not found" } } },
        "openapi-3",
      );
      // "200" is not an object — skipped; "404" is an object but has no content
      expect(result).toHaveLength(1);
      expect(result[0]?.statusKey).toBe("404");
    });

    it("normalizes 3.x response with application/json schema", () => {
      const extractor = new OperationResponseExtractor();
      const result = extractor.normalizeResponses(
        {
          responses: {
            "200": {
              content: { "application/json": { schema: { type: "object" } } },
            },
          },
        },
        "openapi-3",
      );
      expect(result).toHaveLength(1);
      expect(result[0]?.statusKey).toBe("200");
      expect(result[0]?.schema).toMatchObject({ type: "object" });
    });
  });

  describe("normalizeResponses() — 3.x empty content", () => {
    it("returns response with empty mediaType when content is empty (mediaType null) — null branch", () => {
      const extractor = new OperationResponseExtractor();
      const result = extractor.normalizeResponses(
        { responses: { "204": { content: {} } } },
        "openapi-3",
      );
      expect(result).toHaveLength(1);
      expect(result[0]?.mediaType).toBe("");
      expect(result[0]?.schema).toBeUndefined();
    });

    it("returns schema undefined when mtObj has no schema object — schema not object branch", () => {
      const extractor = new OperationResponseExtractor();
      const result = extractor.normalizeResponses(
        {
          responses: {
            "200": {
              content: { "application/json": { example: { id: 1 } } },
            },
          },
        },
        "openapi-3",
      );
      // content["application/json"].schema is absent → schema undefined
      expect(result[0]?.schema).toBeUndefined();
      expect(result[0]?.mediaType).toBe("application/json");
    });
  });

  describe("normalizeResponses() — 2.0 path", () => {
    it("captures schema directly from 2.0 response", () => {
      const extractor = new OperationResponseExtractor();
      const result = extractor.normalizeResponses(
        {
          responses: {
            "200": { schema: { type: "array", items: { type: "string" } } },
          },
        },
        "swagger-2",
      );
      expect(result[0]?.schema).toMatchObject({ type: "array" });
      expect(result[0]?.mediaType).toBe("application/json");
    });

    it("returns empty mediaType when 2.0 response has no schema", () => {
      const extractor = new OperationResponseExtractor();
      const result = extractor.normalizeResponses(
        { responses: { "204": { description: "No content" } } },
        "swagger-2",
      );
      expect(result[0]?.schema).toBeUndefined();
      expect(result[0]?.mediaType).toBe("");
    });
  });
});
