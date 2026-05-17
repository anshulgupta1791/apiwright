import { describe, expect, it } from "vitest";

import { OperationFlattener } from "../../../../src/importers/openapi/operation-flattener.js";
import type { LoadedSpec } from "../../../../src/importers/openapi/types.js";

/**
 * Unit tests for OperationFlattener.
 *
 * Pure class: exercised by passing literal LoadedSpec objects. Covers: one
 * FlattenedOperation per (path,method), path/operation parameter merge,
 * non-operation keys skipped, no-tags default bucket, multi-tag first-tag
 * placement + warning, 2.0 body/formData normalization, unsupported method
 * skipped with warning, pure (no mutation), returned warnings list.
 */

/** Build a minimal 3.x LoadedSpec with arbitrary paths content. */
function makeSpec3x(
  paths: Record<string, unknown>,
  security?: unknown[],
): LoadedSpec {
  return {
    document: {
      openapi: "3.0.3",
      info: { title: "Test", version: "1.0.0" },
      paths,
      ...(security !== undefined ? { security } : {}),
    },
    flavor: "openapi-3",
    baseUrl: "https://api.example.com/v1",
    sourceId: "spec.json",
    circular: false,
  };
}

/** Build a minimal 2.0 LoadedSpec with arbitrary paths content. */
function makeSpec2x(
  paths: Record<string, unknown>,
  security?: unknown[],
): LoadedSpec {
  return {
    document: {
      swagger: "2.0",
      info: { title: "Test", version: "2.0.0" },
      host: "api.example.com",
      basePath: "/v2",
      schemes: ["https"],
      paths,
      ...(security !== undefined ? { security } : {}),
    },
    flavor: "swagger-2",
    baseUrl: "https://api.example.com/v2",
    sourceId: "swagger.json",
    circular: false,
  };
}

describe("OperationFlattener", () => {
  describe("constructor — default-seam wiring", () => {
    it("constructs with no options and exposes a flatten method", () => {
      const flattener = new OperationFlattener();
      expect(typeof flattener.flatten).toBe("function");
    });
  });

  describe("flatten() — basic operation extraction", () => {
    it("returns one FlattenedOperation for a single GET operation", () => {
      const spec = makeSpec3x({
        "/users": {
          get: {
            operationId: "listUsers",
            summary: "List users",
            tags: ["Users"],
            responses: { "200": { description: "OK" } },
          },
        },
      });
      const flattener = new OperationFlattener();
      const { operations } = flattener.flatten(spec);
      expect(operations).toHaveLength(1);
    });

    it("returns one operation with the correct path and method", () => {
      const spec = makeSpec3x({
        "/users": {
          post: {
            operationId: "createUser",
            tags: ["Users"],
            responses: {},
          },
        },
      });
      const flattener = new OperationFlattener();
      const { operations } = flattener.flatten(spec);
      expect(operations[0].path).toBe("/users");
      expect(operations[0].method).toBe("post");
    });

    it("returns operations for all seven supported HTTP methods", () => {
      const spec = makeSpec3x({
        "/test": {
          get: { tags: ["T"], responses: {} },
          post: { tags: ["T"], responses: {} },
          put: { tags: ["T"], responses: {} },
          patch: { tags: ["T"], responses: {} },
          delete: { tags: ["T"], responses: {} },
          head: { tags: ["T"], responses: {} },
          options: { tags: ["T"], responses: {} },
        },
      });
      const flattener = new OperationFlattener();
      const { operations } = flattener.flatten(spec);
      expect(operations).toHaveLength(7);
    });

    it("returns operations in document (insertion) order", () => {
      const spec = makeSpec3x({
        "/a": { get: { tags: ["T"], responses: {} } },
        "/b": { post: { tags: ["T"], responses: {} } },
        "/c": { delete: { tags: ["T"], responses: {} } },
      });
      const flattener = new OperationFlattener();
      const { operations } = flattener.flatten(spec);
      expect(operations.map((o) => o.path)).toEqual(["/a", "/b", "/c"]);
    });

    it("returns an empty array and no warnings for a spec with no paths", () => {
      const spec = makeSpec3x({});
      const flattener = new OperationFlattener();
      const { operations, warnings } = flattener.flatten(spec);
      expect(operations).toHaveLength(0);
      expect(warnings).toHaveLength(0);
    });

    it("returns operationId when present", () => {
      const spec = makeSpec3x({
        "/users": {
          get: {
            operationId: "getUsers",
            tags: ["T"],
            responses: {},
          },
        },
      });
      const flattener = new OperationFlattener();
      const { operations } = flattener.flatten(spec);
      expect(operations[0].operationId).toBe("getUsers");
    });

    it("returns undefined operationId when not present", () => {
      const spec = makeSpec3x({
        "/users": { get: { tags: ["T"], responses: {} } },
      });
      const flattener = new OperationFlattener();
      const { operations } = flattener.flatten(spec);
      expect(operations[0].operationId).toBeUndefined();
    });

    it("returns summary and description when present", () => {
      const spec = makeSpec3x({
        "/users": {
          get: {
            tags: ["T"],
            summary: "List users",
            description: "Get all users",
            responses: {},
          },
        },
      });
      const flattener = new OperationFlattener();
      const { operations } = flattener.flatten(spec);
      expect(operations[0].summary).toBe("List users");
      expect(operations[0].description).toBe("Get all users");
    });

    it("returns empty string for summary and description when absent", () => {
      const spec = makeSpec3x({
        "/users": { get: { tags: ["T"], responses: {} } },
      });
      const flattener = new OperationFlattener();
      const { operations } = flattener.flatten(spec);
      expect(operations[0].summary).toBe("");
      expect(operations[0].description).toBe("");
    });
  });

  describe("flatten() — non-operation keys are not emitted", () => {
    it("does not emit an operation for the 'parameters' key at path level", () => {
      const spec = makeSpec3x({
        "/users": {
          parameters: [{ name: "id", in: "path", required: true }],
          get: { tags: ["T"], responses: {} },
        },
      });
      const flattener = new OperationFlattener();
      const { operations } = flattener.flatten(spec);
      expect(operations).toHaveLength(1);
      expect(operations[0].method).toBe("get");
    });

    it("does not emit an operation for '$ref' at path item level", () => {
      const spec = makeSpec3x({
        "/ref-path": {
          $ref: "#/components/pathItems/Shared",
          get: { tags: ["T"], responses: {} },
        },
      });
      const flattener = new OperationFlattener();
      const { operations } = flattener.flatten(spec);
      // Only the GET should be emitted, not $ref
      expect(operations.every((o) => o.method !== "$ref")).toBe(true);
    });

    it("does not emit an operation for 'summary' or 'description' keys", () => {
      const spec = makeSpec3x({
        "/users": {
          summary: "User operations",
          description: "CRUD for users",
          get: { tags: ["T"], responses: {} },
        },
      });
      const flattener = new OperationFlattener();
      const { operations } = flattener.flatten(spec);
      expect(operations).toHaveLength(1);
    });

    it("does not emit operations for vendor x-* extension keys", () => {
      const spec = makeSpec3x({
        "/users": {
          "x-internal": true,
          "x-owner": "team-a",
          get: { tags: ["T"], responses: {} },
        },
      });
      const flattener = new OperationFlattener();
      const { operations } = flattener.flatten(spec);
      expect(operations).toHaveLength(1);
    });
  });

  describe("flatten() — unsupported HTTP method", () => {
    it("skips the 'trace' method and emits a warning", () => {
      const spec = makeSpec3x({
        "/users": {
          trace: { tags: ["T"], responses: {} },
          get: { tags: ["T"], responses: {} },
        },
      });
      const flattener = new OperationFlattener();
      const { operations, warnings } = flattener.flatten(spec);
      expect(operations).toHaveLength(1);
      expect(operations[0].method).toBe("get");
      expect(warnings.some((w) => w.toLowerCase().includes("trace"))).toBe(
        true,
      );
    });

    it("warning for unsupported method names the path and method", () => {
      const spec = makeSpec3x({
        "/test": {
          trace: { tags: ["T"], responses: {} },
        },
      });
      const flattener = new OperationFlattener();
      const { warnings } = flattener.flatten(spec);
      expect(warnings.some((w) => w.includes("/test"))).toBe(true);
    });

    it("does not throw when encountering an unsupported method", () => {
      const spec = makeSpec3x({
        "/test": { trace: { tags: ["T"], responses: {} } },
      });
      const flattener = new OperationFlattener();
      expect(() => flattener.flatten(spec)).not.toThrow();
    });
  });

  describe("flatten() — parameter merging", () => {
    it("merges path-level parameters into each operation", () => {
      const spec = makeSpec3x({
        "/users/{id}": {
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "integer" } },
          ],
          get: { tags: ["T"], responses: {} },
        },
      });
      const flattener = new OperationFlattener();
      const { operations } = flattener.flatten(spec);
      expect(operations[0].parameters.some((p) => p.name === "id")).toBe(true);
    });

    it("operation-level parameter overrides path-level parameter with same name+location", () => {
      const spec = makeSpec3x({
        "/users/{id}": {
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
          ],
          get: {
            tags: ["T"],
            parameters: [
              { name: "id", in: "path", required: true, schema: { type: "integer" } },
            ],
            responses: {},
          },
        },
      });
      const flattener = new OperationFlattener();
      const { operations } = flattener.flatten(spec);
      // Should have only one 'id' path param; the operation-level schema (integer) wins
      const idParams = operations[0].parameters.filter((p) => p.name === "id" && p.location === "path");
      expect(idParams).toHaveLength(1);
      expect(idParams[0].schema?.["type"]).toBe("integer");
    });

    it("appends operation-level parameters that do not override any path-level one", () => {
      const spec = makeSpec3x({
        "/users/{id}": {
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "integer" } },
          ],
          get: {
            tags: ["T"],
            parameters: [
              { name: "expand", in: "query", required: false, schema: { type: "string" } },
            ],
            responses: {},
          },
        },
      });
      const flattener = new OperationFlattener();
      const { operations } = flattener.flatten(spec);
      expect(operations[0].parameters).toHaveLength(2);
    });

    it("handles an operation with no parameters (empty array)", () => {
      const spec = makeSpec3x({
        "/users": { get: { tags: ["T"], responses: {} } },
      });
      const flattener = new OperationFlattener();
      const { operations } = flattener.flatten(spec);
      expect(operations[0].parameters).toEqual([]);
    });

    it("classifies path parameters as location 'path'", () => {
      const spec = makeSpec3x({
        "/users/{id}": {
          get: {
            tags: ["T"],
            parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
            responses: {},
          },
        },
      });
      const flattener = new OperationFlattener();
      const { operations } = flattener.flatten(spec);
      expect(operations[0].parameters[0].location).toBe("path");
    });

    it("classifies query parameters as location 'query'", () => {
      const spec = makeSpec3x({
        "/users": {
          get: {
            tags: ["T"],
            parameters: [{ name: "page", in: "query", required: false, schema: { type: "integer" } }],
            responses: {},
          },
        },
      });
      const flattener = new OperationFlattener();
      const { operations } = flattener.flatten(spec);
      expect(operations[0].parameters[0].location).toBe("query");
    });
  });

  describe("flatten() — tags handling", () => {
    it("preserves tags array from the operation", () => {
      const spec = makeSpec3x({
        "/users": {
          get: { tags: ["Users"], responses: {} },
        },
      });
      const flattener = new OperationFlattener();
      const { operations } = flattener.flatten(spec);
      expect(operations[0].tags).toEqual(["Users"]);
    });

    it("assigns a default bucket from the first path segment when tags is empty", () => {
      const spec = makeSpec3x({
        "/users/{id}": { get: { tags: [], responses: {} } },
      });
      const flattener = new OperationFlattener();
      const { operations } = flattener.flatten(spec);
      expect(operations[0].tags).toEqual(["users"]);
    });

    it("assigns 'default' bucket when path has no usable segment", () => {
      const spec = makeSpec3x({
        "/": { get: { responses: {} } },
      });
      const flattener = new OperationFlattener();
      const { operations } = flattener.flatten(spec);
      expect(operations[0].tags).toContain("default");
    });

    it("emits a warning and keeps all tags when operation has multiple tags", () => {
      const spec = makeSpec3x({
        "/users": {
          post: { tags: ["Users", "Admin"], responses: {} },
        },
      });
      const flattener = new OperationFlattener();
      const { operations, warnings } = flattener.flatten(spec);
      expect(operations[0].tags).toEqual(["Users", "Admin"]);
      expect(
        warnings.some((w) => w.toLowerCase().includes("multiple tags")),
      ).toBe(true);
    });

    it("multi-tag warning names the first tag for placement", () => {
      const spec = makeSpec3x({
        "/users": {
          post: { tags: ["Users", "Admin"], responses: {} },
        },
      });
      const flattener = new OperationFlattener();
      const { warnings } = flattener.flatten(spec);
      expect(warnings.some((w) => w.includes("Users"))).toBe(true);
    });

    it("assigns default bucket from first path segment when tags key is absent", () => {
      const spec = makeSpec3x({
        "/products": { get: { responses: {} } },
      });
      const flattener = new OperationFlattener();
      const { operations } = flattener.flatten(spec);
      // First non-empty path segment = "products"
      expect(operations[0].tags[0]).toBe("products");
    });
  });

  describe("flatten() — request body normalization (3.x)", () => {
    it("normalizes 3.x requestBody with application/json content into FlattenedRequestBody", () => {
      const spec = makeSpec3x({
        "/users": {
          post: {
            tags: ["T"],
            requestBody: {
              content: {
                "application/json": {
                  schema: { type: "object" },
                  example: { name: "Alice" },
                },
              },
            },
            responses: {},
          },
        },
      });
      const flattener = new OperationFlattener();
      const { operations } = flattener.flatten(spec);
      expect(operations[0].requestBody).toBeDefined();
      expect(operations[0].requestBody?.mediaType).toBe("application/json");
      expect(operations[0].requestBody?.schema).toMatchObject({ type: "object" });
    });

    it("picks application/json over other media types for 3.x requestBody", () => {
      const spec = makeSpec3x({
        "/upload": {
          post: {
            tags: ["T"],
            requestBody: {
              content: {
                "text/plain": { schema: { type: "string" } },
                "application/json": { schema: { type: "object" } },
              },
            },
            responses: {},
          },
        },
      });
      const flattener = new OperationFlattener();
      const { operations } = flattener.flatten(spec);
      expect(operations[0].requestBody?.mediaType).toBe("application/json");
    });

    it("sets requestBody to undefined when no requestBody is declared (3.x)", () => {
      const spec = makeSpec3x({
        "/users": { get: { tags: ["T"], responses: {} } },
      });
      const flattener = new OperationFlattener();
      const { operations } = flattener.flatten(spec);
      expect(operations[0].requestBody).toBeUndefined();
    });
  });

  describe("flatten() — Swagger 2.0 body/formData normalization", () => {
    it("normalizes a 2.0 body parameter into FlattenedRequestBody", () => {
      const spec = makeSpec2x({
        "/pets": {
          post: {
            operationId: "createPet",
            tags: ["Pets"],
            parameters: [
              {
                name: "body",
                in: "body",
                required: true,
                schema: { type: "object", properties: { name: { type: "string" } } },
              },
            ],
            responses: {},
          },
        },
      });
      const flattener = new OperationFlattener();
      const { operations } = flattener.flatten(spec);
      expect(operations[0].requestBody).toBeDefined();
      expect(operations[0].requestBody?.schema).toMatchObject({ type: "object" });
    });

    it("excludes 2.0 body parameters from the parameters array", () => {
      const spec = makeSpec2x({
        "/pets": {
          post: {
            tags: ["Pets"],
            parameters: [
              { name: "body", in: "body", required: true, schema: { type: "object" } },
              { name: "limit", in: "query", type: "integer" },
            ],
            responses: {},
          },
        },
      });
      const flattener = new OperationFlattener();
      const { operations } = flattener.flatten(spec);
      // body param should not be in parameters; only query param should be
      expect(operations[0].parameters.every((p) => p.location !== "body" as string)).toBe(true);
      expect(operations[0].parameters.some((p) => p.name === "limit")).toBe(true);
    });

    it("normalizes 2.0 formData parameters into a synthesized object schema", () => {
      const spec = makeSpec2x({
        "/upload": {
          post: {
            tags: ["Store"],
            parameters: [
              { name: "file", in: "formData", required: true, type: "string" },
              { name: "description", in: "formData", required: false, type: "string" },
            ],
            responses: {},
          },
        },
      });
      const flattener = new OperationFlattener();
      const { operations } = flattener.flatten(spec);
      expect(operations[0].requestBody).toBeDefined();
      expect(operations[0].requestBody?.schema?.["type"]).toBe("object");
      expect(operations[0].requestBody?.schema?.["properties"]).toBeDefined();
    });

    it("lifts 2.0 inline type keywords into a schema object for path/query params", () => {
      const spec = makeSpec2x({
        "/pets": {
          get: {
            tags: ["T"],
            parameters: [
              { name: "limit", in: "query", type: "integer", format: "int32" },
            ],
            responses: {},
          },
        },
      });
      const flattener = new OperationFlattener();
      const { operations } = flattener.flatten(spec);
      const limitParam = operations[0].parameters.find((p) => p.name === "limit");
      expect(limitParam?.schema?.["type"]).toBe("integer");
    });
  });

  describe("flatten() — security normalization", () => {
    it("sets security from operation-level security array", () => {
      const spec = makeSpec3x({
        "/users": {
          get: {
            tags: ["T"],
            security: [{ bearerAuth: [] }],
            responses: {},
          },
        },
      });
      const flattener = new OperationFlattener();
      const { operations } = flattener.flatten(spec);
      expect(operations[0].security).toBeDefined();
      expect(operations[0].security?.[0].schemeNames).toContain("bearerAuth");
    });

    it("sets security to empty array when operation has explicit empty security: []", () => {
      const spec = makeSpec3x({
        "/health": {
          get: { tags: ["T"], security: [], responses: {} },
        },
      });
      const flattener = new OperationFlattener();
      const { operations } = flattener.flatten(spec);
      expect(operations[0].security).toEqual([]);
    });

    it("falls back to root-level security when operation has no security key", () => {
      const spec = makeSpec3x(
        {
          "/users": { get: { tags: ["T"], responses: {} } },
        },
        [{ bearerAuth: [] }],
      );
      const flattener = new OperationFlattener();
      const { operations } = flattener.flatten(spec);
      expect(operations[0].security).toBeDefined();
      expect(operations[0].security?.[0].schemeNames).toContain("bearerAuth");
    });

    it("sets security to undefined when neither operation nor root has security", () => {
      const spec = makeSpec3x({
        "/users": { get: { tags: ["T"], responses: {} } },
      });
      const flattener = new OperationFlattener();
      const { operations } = flattener.flatten(spec);
      expect(operations[0].security).toBeUndefined();
    });
  });

  describe("flatten() — responses normalization", () => {
    it("returns responses in document order with status keys as written", () => {
      const spec = makeSpec3x({
        "/users": {
          get: {
            tags: ["T"],
            responses: {
              "200": { description: "OK", content: { "application/json": { schema: { type: "array" } } } },
              "404": { description: "Not found" },
            },
          },
        },
      });
      const flattener = new OperationFlattener();
      const { operations } = flattener.flatten(spec);
      expect(operations[0].responses.map((r) => r.statusKey)).toEqual(["200", "404"]);
    });

    it("returns an empty responses array when responses key is absent", () => {
      const spec = makeSpec3x({
        "/metrics": { get: { tags: ["T"] } },
      });
      const flattener = new OperationFlattener();
      const { operations } = flattener.flatten(spec);
      expect(operations[0].responses).toEqual([]);
    });

    it("captures response schema for 3.x application/json media type", () => {
      const spec = makeSpec3x({
        "/users": {
          get: {
            tags: ["T"],
            responses: {
              "200": {
                description: "OK",
                content: {
                  "application/json": {
                    schema: { type: "object", properties: { id: { type: "integer" } } },
                  },
                },
              },
            },
          },
        },
      });
      const flattener = new OperationFlattener();
      const { operations } = flattener.flatten(spec);
      expect(operations[0].responses[0].schema).toMatchObject({ type: "object" });
    });

    it("sets schema to undefined for a 2.0 response with no schema", () => {
      const spec = makeSpec2x({
        "/pets": {
          get: {
            tags: ["T"],
            responses: {
              "204": { description: "No content" },
            },
          },
        },
      });
      const flattener = new OperationFlattener();
      const { operations } = flattener.flatten(spec);
      expect(operations[0].responses[0].schema).toBeUndefined();
    });
  });

  describe("flatten() — edge cases for uncovered branches", () => {
    it("skips a supported method key whose value is not an object", () => {
      const spec = makeSpec3x({
        "/test": {
          get: "not-an-object",  // supported method but non-object value
          post: { tags: ["T"], responses: {} },
        },
      });
      const flattener = new OperationFlattener();
      const { operations } = flattener.flatten(spec);
      // 'get' should be skipped; only 'post' produced
      expect(operations).toHaveLength(1);
      expect(operations[0].method).toBe("post");
    });

    it("preserves parameter example field through the clean-params mapping", () => {
      const spec = makeSpec3x({
        "/users": {
          get: {
            tags: ["T"],
            parameters: [
              {
                name: "q",
                in: "query",
                required: false,
                schema: { type: "string" },
                example: "alice",
              },
            ],
            responses: {},
          },
        },
      });
      const flattener = new OperationFlattener();
      const { operations } = flattener.flatten(spec);
      const qParam = operations[0].parameters.find((p) => p.name === "q");
      expect(qParam?.example).toBe("alice");
    });

    it("falls back to root security as a non-array rootSecurity value", () => {
      // When rootSecurity is not an array (edge case), it is passed directly
      // to asObjectArray which returns [] → empty security requirements array
      const spec: LoadedSpec = {
        document: {
          openapi: "3.0.3",
          security: { bearerAuth: [] },
          paths: {
            "/users": { get: { tags: ["T"], responses: {} } },
          },
        },
        flavor: "openapi-3",
        baseUrl: "/",
        sourceId: "spec.json",
        circular: false,
      };
      const flattener = new OperationFlattener();
      // Should not throw
      expect(() => flattener.flatten(spec)).not.toThrow();
    });
  });

  describe("flatten() — purity guarantee", () => {
    it("does not mutate the LoadedSpec document", () => {
      const doc = {
        openapi: "3.0.3",
        paths: {
          "/users": {
            get: { tags: ["T"], responses: {} },
          },
        },
      };
      const spec: LoadedSpec = {
        document: doc,
        flavor: "openapi-3",
        baseUrl: "/",
        sourceId: "spec.json",
        circular: false,
      };
      const before = JSON.stringify(doc);
      const flattener = new OperationFlattener();
      flattener.flatten(spec);
      expect(JSON.stringify(doc)).toBe(before);
    });
  });
});
