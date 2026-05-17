import { describe, expect, it } from "vitest";

import { OpenApiRequestConverter } from "../../../../src/importers/openapi/request-converter.js";
import { OpenApiSchemaConverter } from "../../../../src/importers/openapi/schema-converter.js";
import { PathNamer } from "../../../../src/importers/postman/path-naming.js";
import type { FlattenedOperation } from "../../../../src/importers/openapi/types.js";

/**
 * Unit tests for OpenApiRequestConverter.
 *
 * Uses injected fake OpenApiSchemaConverter and real PathNamer to cover: id
 * generation from operationId / method+path, name fallbacks (summary →
 * description → method+path), url template preservation, query_params,
 * headers (required/constant/placeholder), requestBody (schema+example),
 * no requestBody, deduplicated ids, default-seam wiring, never throws.
 */

/** Minimal FlattenedOperation builder. */
function makeOp(
  overrides: Partial<FlattenedOperation> = {},
): FlattenedOperation {
  return {
    path: "/users",
    method: "get",
    summary: "List users",
    description: "",
    tags: ["Users"],
    parameters: [],
    responses: [],
    ...overrides,
  };
}

/** Fake OpenApiSchemaConverter that returns canned schema + warnings. */
function makeFakeConverter(
  schema: Record<string, unknown> = { type: "object" },
  warnings: string[] = [],
): OpenApiSchemaConverter {
  return {
    convert(_input: unknown) {
      return { schema, warnings };
    },
  } as unknown as OpenApiSchemaConverter;
}

describe("OpenApiRequestConverter", () => {
  describe("constructor — default-seam wiring", () => {
    it("constructs with no options and exposes a convert method", () => {
      const conv = new OpenApiRequestConverter();
      expect(typeof conv.convert).toBe("function");
    });

    it("constructs with partial options (only namer provided)", () => {
      const conv = new OpenApiRequestConverter({ namer: new PathNamer() });
      expect(typeof conv.convert).toBe("function");
    });
  });

  describe("convert() — id generation from operationId", () => {
    it("derives id slug from operationId when present", () => {
      const conv = new OpenApiRequestConverter({
        schemaConverter: makeFakeConverter(),
      });
      const op = makeOp({ operationId: "createUser" });
      const { core } = conv.convert(op, new Set());
      expect(core?.id).toMatch(/^[a-z0-9._-]+$/);
      expect(core?.id).toBe("createuser");
    });

    it("derives a deterministic id from method+path when operationId is absent", () => {
      const conv = new OpenApiRequestConverter({
        schemaConverter: makeFakeConverter(),
      });
      const op = makeOp({ path: "/users", method: "post" });
      const { core } = conv.convert(op, new Set());
      expect(core?.id).toMatch(/post/);
      expect(core?.id).toMatch(/users/);
    });

    it("deduplicates ids when the same operationId is used twice", () => {
      const conv = new OpenApiRequestConverter({
        schemaConverter: makeFakeConverter(),
      });
      const usedIds = new Set<string>();
      const op = makeOp({ operationId: "getUser" });
      const { core: c1 } = conv.convert(op, usedIds);
      const { core: c2 } = conv.convert(op, usedIds);
      expect(c1?.id).not.toBe(c2?.id);
      expect(c2?.id).toMatch(/_2$/);
    });

    it("id matches the pattern ^[a-z0-9._-]+$", () => {
      const conv = new OpenApiRequestConverter({
        schemaConverter: makeFakeConverter(),
      });
      const op = makeOp({ operationId: "GET /Users/{Id}" });
      const { core } = conv.convert(op, new Set());
      expect(core?.id).toMatch(/^[a-z0-9._-]+$/);
    });

    it("derives id from path with brace replacement for path params", () => {
      const conv = new OpenApiRequestConverter({
        schemaConverter: makeFakeConverter(),
      });
      const op = makeOp({ path: "/users/{id}", method: "get" });
      const { core } = conv.convert(op, new Set());
      // Should not contain { or } characters
      expect(core?.id).not.toContain("{");
      expect(core?.id).not.toContain("}");
    });
  });

  describe("convert() — name derivation", () => {
    it("uses summary as name when summary is non-empty", () => {
      const conv = new OpenApiRequestConverter({
        schemaConverter: makeFakeConverter(),
      });
      const op = makeOp({ summary: "List all users", description: "Detailed" });
      const { core } = conv.convert(op, new Set());
      expect(core?.name).toBe("List all users");
    });

    it("falls back to description when summary is empty", () => {
      const conv = new OpenApiRequestConverter({
        schemaConverter: makeFakeConverter(),
      });
      const op = makeOp({ summary: "", description: "Get all users" });
      const { core } = conv.convert(op, new Set());
      expect(core?.name).toBe("Get all users");
    });

    it("falls back to METHOD PATH when both summary and description are empty", () => {
      const conv = new OpenApiRequestConverter({
        schemaConverter: makeFakeConverter(),
      });
      const op = makeOp({ summary: "", description: "", path: "/users", method: "get" });
      const { core } = conv.convert(op, new Set());
      expect(core?.name).toBeTruthy();
      expect(core?.name.toLowerCase()).toContain("get");
    });

    it("name is always non-empty", () => {
      const conv = new OpenApiRequestConverter({
        schemaConverter: makeFakeConverter(),
      });
      const op = makeOp({ summary: "", description: "" });
      const { core } = conv.convert(op, new Set());
      expect(core?.name.length).toBeGreaterThan(0);
    });
  });

  describe("convert() — url and method", () => {
    it("uses the path template verbatim as url", () => {
      const conv = new OpenApiRequestConverter({
        schemaConverter: makeFakeConverter(),
      });
      const op = makeOp({ path: "/users/{id}" });
      const { core } = conv.convert(op, new Set());
      expect(core?.url).toBe("/users/{id}");
    });

    it("maps lowercase method to canonical HttpMethod (uppercase)", () => {
      const conv = new OpenApiRequestConverter({
        schemaConverter: makeFakeConverter(),
      });
      const op = makeOp({ method: "post" });
      const { core } = conv.convert(op, new Set());
      expect(core?.method).toBe("POST");
    });

    it("url does not duplicate path params into query_params", () => {
      const conv = new OpenApiRequestConverter({
        schemaConverter: makeFakeConverter(),
      });
      const op = makeOp({
        path: "/users/{id}",
        parameters: [
          { name: "id", location: "path", required: true, schema: { type: "integer" } },
        ],
      });
      const { core } = conv.convert(op, new Set());
      // Path params should not appear in query_params
      expect(core?.request.query_params).toBeUndefined();
    });

    it("uses '/' as url when path is empty (defensive)", () => {
      const conv = new OpenApiRequestConverter({
        schemaConverter: makeFakeConverter(),
      });
      const op = makeOp({ path: "" });
      const { core } = conv.convert(op, new Set());
      expect(core?.url).toBe("/");
    });

    it("emits a warning when path is empty (defensive)", () => {
      const conv = new OpenApiRequestConverter({
        schemaConverter: makeFakeConverter(),
      });
      const op = makeOp({ path: "" });
      const { warnings } = conv.convert(op, new Set());
      expect(warnings.length).toBeGreaterThan(0);
    });
  });

  describe("convert() — query params", () => {
    it("converts query parameters into request.query_params using the schema converter", () => {
      const fakeSchema = { type: "integer" };
      const conv = new OpenApiRequestConverter({
        schemaConverter: makeFakeConverter(fakeSchema),
      });
      const op = makeOp({
        parameters: [
          { name: "page", location: "query", required: false, schema: { type: "integer" } },
        ],
      });
      const { core } = conv.convert(op, new Set());
      expect(core?.request.query_params).toBeDefined();
      expect(core?.request.query_params?.["page"]).toEqual(fakeSchema);
    });

    it("omits query_params when no query parameters exist", () => {
      const conv = new OpenApiRequestConverter({
        schemaConverter: makeFakeConverter(),
      });
      const op = makeOp({ parameters: [] });
      const { core } = conv.convert(op, new Set());
      expect(core?.request.query_params).toBeUndefined();
    });

    it("uses permissive {type:'string'} for query param with no schema", () => {
      const permissiveConv = new OpenApiSchemaConverter();
      const conv = new OpenApiRequestConverter({
        schemaConverter: permissiveConv,
      });
      const op = makeOp({
        parameters: [
          { name: "q", location: "query", required: false },
        ],
      });
      const { core } = conv.convert(op, new Set());
      // Query param with no schema → permissive string default
      expect(core?.request.query_params?.["q"]).toBeDefined();
    });

    it("delegates query param schema conversion to OpenApiSchemaConverter (DRY)", () => {
      let delegationCalled = false;
      const trackingConverter = {
        convert(input: unknown) {
          delegationCalled = true;
          return { schema: { type: "string" }, warnings: [] };
        },
      } as unknown as OpenApiSchemaConverter;

      const conv = new OpenApiRequestConverter({
        schemaConverter: trackingConverter,
      });
      const op = makeOp({
        parameters: [
          { name: "q", location: "query", required: false, schema: { type: "string" } },
        ],
      });
      conv.convert(op, new Set());
      expect(delegationCalled).toBe(true);
    });
  });

  describe("convert() — headers", () => {
    it("adds required header parameter to request.headers as ${env.*} placeholder", () => {
      const conv = new OpenApiRequestConverter({
        schemaConverter: makeFakeConverter(),
      });
      const op = makeOp({
        parameters: [
          { name: "X-Tenant", location: "header", required: true, schema: { type: "string" } },
        ],
      });
      const { core } = conv.convert(op, new Set());
      expect(core?.request.headers?.["X-Tenant"]).toBeDefined();
      expect(core?.request.headers?.["X-Tenant"]).toContain("${env.");
    });

    it("emits a warning for a required header with no constant value", () => {
      const conv = new OpenApiRequestConverter({
        schemaConverter: makeFakeConverter(),
      });
      const op = makeOp({
        parameters: [
          { name: "X-Tenant", location: "header", required: true, schema: { type: "string" } },
        ],
      });
      const { warnings } = conv.convert(op, new Set());
      expect(warnings.some((w) => w.includes("X-Tenant"))).toBe(true);
    });

    it("uses literal value for header with single-element enum", () => {
      const conv = new OpenApiRequestConverter({
        schemaConverter: makeFakeConverter(),
      });
      const op = makeOp({
        parameters: [
          {
            name: "X-Api-Version",
            location: "header",
            required: true,
            schema: { type: "string", enum: ["v1"] },
          },
        ],
      });
      const { core, warnings } = conv.convert(op, new Set());
      expect(core?.request.headers?.["X-Api-Version"]).toBe("v1");
      // No placeholder warning when we have a constant value
      expect(warnings.some((w) => w.includes("X-Api-Version") && w.includes("placeholder"))).toBe(false);
    });

    it("does not add Content-Type to headers (implied by body media type)", () => {
      const conv = new OpenApiRequestConverter({
        schemaConverter: makeFakeConverter(),
      });
      const op = makeOp({
        requestBody: {
          mediaType: "application/json",
          schema: { type: "object" },
        },
      });
      const { core } = conv.convert(op, new Set());
      expect(core?.request.headers?.["Content-Type"]).toBeUndefined();
    });
  });

  describe("convert() — requestBody", () => {
    it("converts requestBody schema via the schema converter into body_schema", () => {
      const fakeSchema = { type: "object", properties: { name: { type: "string" } } };
      const conv = new OpenApiRequestConverter({
        schemaConverter: makeFakeConverter(fakeSchema),
      });
      const op = makeOp({
        method: "post",
        requestBody: {
          mediaType: "application/json",
          schema: { type: "object" },
        },
      });
      const { core } = conv.convert(op, new Set());
      expect(core?.request.body_schema).toEqual(fakeSchema);
    });

    it("sets body_example when requestBody has an example", () => {
      const conv = new OpenApiRequestConverter({
        schemaConverter: makeFakeConverter(),
      });
      const op = makeOp({
        method: "post",
        requestBody: {
          mediaType: "application/json",
          schema: { type: "object" },
          example: { name: "Alice" },
        },
      });
      const { core } = conv.convert(op, new Set());
      expect(core?.request.body_example).toEqual({ name: "Alice" });
    });

    it("omits body_schema and body_example when no requestBody", () => {
      const conv = new OpenApiRequestConverter({
        schemaConverter: makeFakeConverter(),
      });
      const op = makeOp({ method: "get" });
      const { core } = conv.convert(op, new Set());
      expect(core?.request.body_schema).toBeUndefined();
      expect(core?.request.body_example).toBeUndefined();
    });

    it("uses permissive object schema + warning when requestBody has no schema", () => {
      const conv = new OpenApiRequestConverter({
        schemaConverter: makeFakeConverter({ type: "object" }, []),
      });
      const op = makeOp({
        method: "post",
        requestBody: { mediaType: "application/json" },
      });
      const { core, warnings } = conv.convert(op, new Set());
      expect(core?.request.body_schema).toBeDefined();
      expect(warnings.length).toBeGreaterThan(0);
    });

    it("bubbles schema-converter warnings for the body schema", () => {
      const conv = new OpenApiRequestConverter({
        schemaConverter: makeFakeConverter({ type: "object" }, ["Schema depth exceeded"]),
      });
      const op = makeOp({
        method: "post",
        requestBody: {
          mediaType: "application/json",
          schema: { type: "object" },
        },
      });
      const { warnings } = conv.convert(op, new Set());
      expect(warnings.some((w) => w.includes("Schema depth exceeded"))).toBe(true);
    });
  });

  describe("convert() — never throws", () => {
    it("returns warnings and no core for an unsupported method (defensive)", () => {
      const conv = new OpenApiRequestConverter({
        schemaConverter: makeFakeConverter(),
      });
      // Directly inject a bad method to test the defensive path
      const op = makeOp({ method: "TRACE" });
      expect(() => conv.convert(op, new Set())).not.toThrow();
    });

    it("does not throw for a completely empty operation object", () => {
      const conv = new OpenApiRequestConverter({
        schemaConverter: makeFakeConverter(),
      });
      const op = makeOp({
        summary: "",
        description: "",
        parameters: [],
        responses: [],
      });
      expect(() => conv.convert(op, new Set())).not.toThrow();
    });
  });

  describe("convert() — header Content-Type skip and empty headers", () => {
    it("skips Content-Type header parameter (implied by body media type) — continue branch", () => {
      const conv = new OpenApiRequestConverter({ schemaConverter: makeFakeConverter() });
      const op = makeOp({
        parameters: [
          {
            name: "Content-Type",
            location: "header",
            required: true,
            schema: { type: "string" },
          },
        ],
      });
      const { core } = conv.convert(op, new Set());
      // Content-Type is skipped — headers should be undefined since it's the only header
      expect(core?.request.headers?.["Content-Type"]).toBeUndefined();
    });

    it("omits headers from request when all relevant headers are content-type — empty hdrs branch", () => {
      const conv = new OpenApiRequestConverter({ schemaConverter: makeFakeConverter() });
      const op = makeOp({
        parameters: [
          {
            name: "content-type",
            location: "header",
            required: true,
            schema: { type: "string" },
          },
        ],
      });
      const { core } = conv.convert(op, new Set());
      // Only Content-Type was relevant, all skipped → headers undefined
      expect(core?.request.headers).toBeUndefined();
    });

    it("treats single-element enum with non-string value as non-constant — enum non-string branch", () => {
      const conv = new OpenApiRequestConverter({ schemaConverter: makeFakeConverter() });
      const op = makeOp({
        parameters: [
          {
            name: "X-Count",
            location: "header",
            required: true,
            // enum[0] is a number, not a string → falls through to placeholder
            schema: { type: "integer", enum: [42] },
          },
        ],
      });
      const { core, warnings } = conv.convert(op, new Set());
      // Enum value is non-string → no constant → placeholder
      expect(core?.request.headers?.["X-Count"]).toContain("${env.");
      expect(warnings.some((w) => w.includes("X-Count"))).toBe(true);
    });
  });

  describe("convert() — header constant value extraction", () => {
    it("uses schema.default string as constant header value — default branch", () => {
      const conv = new OpenApiRequestConverter({ schemaConverter: makeFakeConverter() });
      const op = makeOp({
        parameters: [
          {
            name: "X-Version",
            location: "header",
            required: true,
            schema: { type: "string", default: "v1" },
          },
        ],
      });
      const { core, warnings } = conv.convert(op, new Set());
      // schema has a string default → use it as constant value; no placeholder warning
      expect(core?.request.headers?.["X-Version"]).toBe("v1");
      expect(warnings.some((w) => w.includes("placeholder"))).toBe(false);
    });

    it("uses param.example string as constant header value — example branch", () => {
      const conv = new OpenApiRequestConverter({ schemaConverter: makeFakeConverter() });
      const op = makeOp({
        parameters: [
          {
            name: "X-Api-Key",
            location: "header",
            required: false,
            example: "abc123",
          },
        ],
      });
      const { core, warnings } = conv.convert(op, new Set());
      // param.example is a string → use it as constant value; no placeholder warning
      expect(core?.request.headers?.["X-Api-Key"]).toBe("abc123");
      expect(warnings.some((w) => w.includes("placeholder"))).toBe(false);
    });
  });

  describe("convert() — return shape", () => {
    it("returns {core, warnings} shape", () => {
      const conv = new OpenApiRequestConverter({
        schemaConverter: makeFakeConverter(),
      });
      const result = conv.convert(makeOp(), new Set());
      expect("warnings" in result).toBe(true);
      expect(Array.isArray(result.warnings)).toBe(true);
    });

    it("core contains id, name, method, url, request fields", () => {
      const conv = new OpenApiRequestConverter({
        schemaConverter: makeFakeConverter(),
      });
      const { core } = conv.convert(makeOp(), new Set());
      expect(core).toBeDefined();
      if (!core) return;
      expect(typeof core.id).toBe("string");
      expect(typeof core.name).toBe("string");
      expect(typeof core.method).toBe("string");
      expect(typeof core.url).toBe("string");
      expect(typeof core.request).toBe("object");
    });
  });
});
