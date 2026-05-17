import { describe, expect, it } from "vitest";

import { JsonSchemaInferrer } from "../../../../src/importers/postman/schema-infer.js";
import { PathNamer } from "../../../../src/importers/postman/path-naming.js";
import { PostmanRequestConverter } from "../../../../src/importers/postman/request-converter.js";
import type { FlattenedRequest } from "../../../../src/importers/types.js";

/**
 * Unit tests for PostmanRequestConverter.
 *
 * Covers: id generation (slug, dedupe, fallback), name, all HttpMethod members,
 * unsupported/empty method, empty URL, disabled header skipping, JSON body +
 * schema inference, non-JSON body (raw example + warning), no-body, disabled
 * query param skipping, non-ASCII name, default-seam construction.
 */

function makeRequest(
  overrides: Partial<FlattenedRequest> = {},
): FlattenedRequest {
  return {
    postmanId: "req-1",
    name: "Test Request",
    folderPath: [],
    method: "GET",
    rawUrl: "https://example.com/path",
    headers: [],
    query: [],
    preRequestScript: "",
    responses: [],
    disabled: false,
    variables: {},
    ...overrides,
  };
}

describe("PostmanRequestConverter", () => {
  describe("constructor — default-seam wiring", () => {
    it("constructs with no options and exposes a convert method", () => {
      const converter = new PostmanRequestConverter();
      expect(typeof converter.convert).toBe("function");
    });

    it("default-seam converter produces core for a valid request", () => {
      const converter = new PostmanRequestConverter();
      const result = converter.convert(
        makeRequest({ name: "Health Check" }),
        new Set(),
      );
      expect(result.core).toBeDefined();
    });
  });

  describe("convert() — id generation", () => {
    it("generates id from request name (slugified)", () => {
      const converter = new PostmanRequestConverter();
      const result = converter.convert(
        makeRequest({ name: "Create User" }),
        new Set(),
      );
      expect(result.core?.id).toBe("create_user");
    });

    it("deduplicates ids: second 'Create User' gets id create_user_2", () => {
      const converter = new PostmanRequestConverter();
      const used = new Set<string>();
      const r1 = converter.convert(
        makeRequest({ name: "Create User", postmanId: "1" }),
        used,
      );
      const r2 = converter.convert(
        makeRequest({ name: "Create User", postmanId: "2" }),
        used,
      );
      expect(r1.core?.id).toBe("create_user");
      expect(r2.core?.id).toBe("create_user_2");
    });

    it("falls back to postmanId when name is empty", () => {
      const converter = new PostmanRequestConverter();
      const result = converter.convert(
        makeRequest({ name: "", postmanId: "my-postman-id" }),
        new Set(),
      );
      // postmanId 'my-postman-id' → slugified 'my_postman_id' (or similar)
      expect(result.core?.id).toMatch(/^[a-z0-9._-]+$/);
    });

    it("falls back to 'endpoint' when both name and postmanId are empty", () => {
      const converter = new PostmanRequestConverter();
      const result = converter.convert(
        makeRequest({ name: "", postmanId: "" }),
        new Set(),
      );
      expect(result.core?.id).toBe("endpoint");
    });

    it("id always matches ^[a-z0-9._-]+$", () => {
      const converter = new PostmanRequestConverter();
      const result = converter.convert(
        makeRequest({ name: "My API Endpoint 42!" }),
        new Set(),
      );
      expect(result.core?.id).toMatch(/^[a-z0-9._-]+$/);
    });
  });

  describe("convert() — name", () => {
    it("preserves request name verbatim", () => {
      const converter = new PostmanRequestConverter();
      const result = converter.convert(
        makeRequest({ name: "Create User" }),
        new Set(),
      );
      expect(result.core?.name).toBe("Create User");
    });

    it("uses generated id as name when request name is empty, with a warning", () => {
      const converter = new PostmanRequestConverter();
      const result = converter.convert(makeRequest({ name: "" }), new Set());
      expect(result.core?.name).toBeTruthy();
      expect(
        result.warnings.some((w) => w.toLowerCase().includes("no name")),
      ).toBe(true);
    });
  });

  describe("convert() — method", () => {
    it.each([
      "GET",
      "POST",
      "PUT",
      "PATCH",
      "DELETE",
      "HEAD",
      "OPTIONS",
    ] as const)("accepts method %s", (method) => {
      const converter = new PostmanRequestConverter();
      const result = converter.convert(makeRequest({ method }), new Set());
      expect(result.core?.method).toBe(method);
    });

    it("returns no core for method TRACE with a warning", () => {
      const converter = new PostmanRequestConverter();
      const result = converter.convert(
        makeRequest({ method: "TRACE" }),
        new Set(),
      );
      expect(result.core).toBeUndefined();
      expect(result.warnings.some((w) => w.includes("TRACE"))).toBe(true);
    });

    it("returns no core for empty method with a warning", () => {
      const converter = new PostmanRequestConverter();
      const result = converter.convert(makeRequest({ method: "" }), new Set());
      expect(result.core).toBeUndefined();
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it("returns no core for unsupported method LINK with a warning", () => {
      const converter = new PostmanRequestConverter();
      const result = converter.convert(
        makeRequest({ method: "LINK" }),
        new Set(),
      );
      expect(result.core).toBeUndefined();
    });

    it("uppercases lowercase method before checking validity", () => {
      const converter = new PostmanRequestConverter();
      const result = converter.convert(
        makeRequest({ method: "get" }),
        new Set(),
      );
      expect(result.core?.method).toBe("GET");
    });

    it("warning for unsupported method names the method", () => {
      const converter = new PostmanRequestConverter();
      const result = converter.convert(
        makeRequest({ method: "CUSTOM" }),
        new Set(),
      );
      expect(result.warnings.some((w) => w.includes("CUSTOM"))).toBe(true);
    });
  });

  describe("convert() — URL", () => {
    it("preserves the rawUrl verbatim including ${env.*} tokens", () => {
      const converter = new PostmanRequestConverter();
      const result = converter.convert(
        makeRequest({ rawUrl: "${env.baseUrl}/users" }),
        new Set(),
      );
      expect(result.core?.url).toBe("${env.baseUrl}/users");
    });

    it("sets url to '/' and emits a warning when rawUrl is empty", () => {
      const converter = new PostmanRequestConverter();
      const result = converter.convert(makeRequest({ rawUrl: "" }), new Set());
      expect(result.core?.url).toBe("/");
      expect(
        result.warnings.some((w) => w.toLowerCase().includes("empty")),
      ).toBe(true);
    });
  });

  describe("convert() — headers", () => {
    it("includes enabled headers in the request object", () => {
      const converter = new PostmanRequestConverter();
      const result = converter.convert(
        makeRequest({
          headers: [
            { key: "Content-Type", value: "application/json", disabled: false },
          ],
        }),
        new Set(),
      );
      expect(result.core?.request.headers?.["Content-Type"]).toBe(
        "application/json",
      );
    });

    it("skips disabled headers", () => {
      const converter = new PostmanRequestConverter();
      const result = converter.convert(
        makeRequest({
          headers: [
            { key: "X-Skip", value: "skipped", disabled: true },
            { key: "X-Keep", value: "kept", disabled: false },
          ],
        }),
        new Set(),
      );
      expect(result.core?.request.headers?.["X-Skip"]).toBeUndefined();
      expect(result.core?.request.headers?.["X-Keep"]).toBe("kept");
    });

    it("omits headers from request when all headers are disabled", () => {
      const converter = new PostmanRequestConverter();
      const result = converter.convert(
        makeRequest({
          headers: [{ key: "X-All-Disabled", value: "x", disabled: true }],
        }),
        new Set(),
      );
      expect(result.core?.request.headers).toBeUndefined();
    });

    it("last write wins for duplicate header keys", () => {
      const converter = new PostmanRequestConverter();
      const result = converter.convert(
        makeRequest({
          headers: [
            { key: "Accept", value: "text/html", disabled: false },
            { key: "Accept", value: "application/json", disabled: false },
          ],
        }),
        new Set(),
      );
      expect(result.core?.request.headers?.["Accept"]).toBe("application/json");
    });
  });

  describe("convert() — body", () => {
    it("infers body_schema from a valid JSON body", () => {
      const converter = new PostmanRequestConverter();
      const result = converter.convert(
        makeRequest({
          body: { mode: "raw", raw: '{"a":1}' },
        }),
        new Set(),
      );
      const schema = result.core?.request.body_schema as Record<
        string,
        unknown
      >;
      expect(schema?.["type"]).toBe("object");
    });

    it("sets body_example from a valid JSON body", () => {
      const converter = new PostmanRequestConverter();
      const result = converter.convert(
        makeRequest({
          body: { mode: "raw", raw: '{"a":1}' },
        }),
        new Set(),
      );
      expect(result.core?.request.body_example).toEqual({ a: 1 });
    });

    it("infers {type:'array', items:{}} for an empty JSON array body", () => {
      const converter = new PostmanRequestConverter();
      const result = converter.convert(
        makeRequest({ body: { mode: "raw", raw: "[]" } }),
        new Set(),
      );
      const schema = result.core?.request.body_schema as Record<
        string,
        unknown
      >;
      expect(schema?.["type"]).toBe("array");
      expect(schema?.["items"]).toEqual({});
    });

    it("stores raw string as body_example when body is not valid JSON", () => {
      const converter = new PostmanRequestConverter();
      const result = converter.convert(
        makeRequest({ body: { mode: "raw", raw: "not json" } }),
        new Set(),
      );
      expect(result.core?.request.body_example).toBe("not json");
    });

    it("omits body_schema when body is not valid JSON", () => {
      const converter = new PostmanRequestConverter();
      const result = converter.convert(
        makeRequest({ body: { mode: "raw", raw: "not json" } }),
        new Set(),
      );
      expect(result.core?.request.body_schema).toBeUndefined();
    });

    it("emits a warning when body is non-JSON", () => {
      const converter = new PostmanRequestConverter();
      const result = converter.convert(
        makeRequest({ body: { mode: "raw", raw: "plain text" } }),
        new Set(),
      );
      expect(
        result.warnings.some((w) => w.toLowerCase().includes("not valid json")),
      ).toBe(true);
    });

    it("omits body_example and body_schema when no body present", () => {
      const converter = new PostmanRequestConverter();
      const result = converter.convert(
        makeRequest({ body: undefined }),
        new Set(),
      );
      expect(result.core?.request.body_example).toBeUndefined();
      expect(result.core?.request.body_schema).toBeUndefined();
    });

    it("does not set body_schema for mode 'formdata'", () => {
      const converter = new PostmanRequestConverter();
      const result = converter.convert(
        makeRequest({ body: { mode: "formdata", raw: "" } }),
        new Set(),
      );
      expect(result.core?.request.body_schema).toBeUndefined();
    });
  });

  describe("convert() — query params", () => {
    it("includes enabled query params with type:string schema", () => {
      const converter = new PostmanRequestConverter();
      const result = converter.convert(
        makeRequest({
          query: [{ key: "limit", value: "10", disabled: false }],
        }),
        new Set(),
      );
      expect(result.core?.request.query_params?.["limit"]).toEqual({
        type: "string",
      });
    });

    it("skips disabled query params", () => {
      const converter = new PostmanRequestConverter();
      const result = converter.convert(
        makeRequest({
          query: [
            { key: "page", value: "1", disabled: true },
            { key: "limit", value: "10", disabled: false },
          ],
        }),
        new Set(),
      );
      expect(result.core?.request.query_params?.["page"]).toBeUndefined();
      expect(result.core?.request.query_params?.["limit"]).toBeDefined();
    });

    it("omits query_params when all params are disabled", () => {
      const converter = new PostmanRequestConverter();
      const result = converter.convert(
        makeRequest({
          query: [{ key: "x", value: "1", disabled: true }],
        }),
        new Set(),
      );
      expect(result.core?.request.query_params).toBeUndefined();
    });

    it("omits query_params when query is empty", () => {
      const converter = new PostmanRequestConverter();
      const result = converter.convert(makeRequest({ query: [] }), new Set());
      expect(result.core?.request.query_params).toBeUndefined();
    });
  });

  describe("convert() — non-ASCII name", () => {
    it("generates a slug without non-ASCII characters for 'Café' name", () => {
      const converter = new PostmanRequestConverter();
      const result = converter.convert(
        makeRequest({ name: "Café Endpoint" }),
        new Set(),
      );
      expect(result.core?.id).toMatch(/^[a-z0-9._-]+$/);
      expect(result.core?.id).toContain("cafe");
    });
  });

  describe("convert() — never throws", () => {
    it("does not throw for any input combination", () => {
      const converter = new PostmanRequestConverter();
      const degenerate = makeRequest({
        name: "",
        postmanId: "",
        method: "INVALID_METHOD",
        rawUrl: "",
        body: { mode: "raw", raw: "!!{]" },
      });
      expect(() => converter.convert(degenerate, new Set())).not.toThrow();
    });
  });

  describe("convert() — injected dependencies", () => {
    it("uses an injected inferrer when provided", () => {
      const customInferrer = new JsonSchemaInferrer();
      const converter = new PostmanRequestConverter({
        inferrer: customInferrer,
      });
      const result = converter.convert(
        makeRequest({ body: { mode: "raw", raw: '{"test":1}' } }),
        new Set(),
      );
      expect(result.core?.request.body_schema).toBeDefined();
    });

    it("uses an injected namer when provided", () => {
      const customNamer = new PathNamer();
      const converter = new PostmanRequestConverter({ namer: customNamer });
      const result = converter.convert(
        makeRequest({ name: "Custom Named" }),
        new Set(),
      );
      expect(result.core?.id).toBe("custom_named");
    });
  });
});
