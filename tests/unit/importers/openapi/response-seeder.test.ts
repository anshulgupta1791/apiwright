import { describe, expect, it } from "vitest";

import { OpenApiResponseSeeder } from "../../../../src/importers/openapi/response-seeder.js";
import { OpenApiSchemaConverter } from "../../../../src/importers/openapi/schema-converter.js";
import type { FlattenedOperation } from "../../../../src/importers/openapi/types.js";

/**
 * Unit tests for OpenApiResponseSeeder.
 *
 * Uses injected fake OpenApiSchemaConverter to cover: lowest 2xx preference,
 * first non-2xx when no 2xx, default-only response (synthetic 200), no
 * responses (manual-review default), response with no schema (permissive),
 * schema conversion delegation (DRY), default-seam wiring, never throws.
 */

/** Minimal FlattenedOperation builder. */
function makeOp(
  overrides: Partial<FlattenedOperation> = {},
): FlattenedOperation {
  return {
    path: "/users",
    method: "GET",
    summary: "List users",
    description: "",
    tags: ["T"],
    parameters: [],
    responses: [],
    ...overrides,
  };
}

/** Fake OpenApiSchemaConverter that returns canned schema. */
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

describe("OpenApiResponseSeeder", () => {
  describe("constructor — default-seam wiring", () => {
    it("constructs with no options and exposes a seed method", () => {
      const seeder = new OpenApiResponseSeeder();
      expect(typeof seeder.seed).toBe("function");
    });

    it("constructs with injected schemaConverter", () => {
      const seeder = new OpenApiResponseSeeder({
        schemaConverter: makeFakeConverter(),
      });
      expect(typeof seeder.seed).toBe("function");
    });
  });

  describe("seed() — lowest 2xx preference", () => {
    it("selects the 200 response when present", () => {
      const seeder = new OpenApiResponseSeeder({
        schemaConverter: makeFakeConverter(),
      });
      const op = makeOp({
        responses: [
          { statusKey: "200", mediaType: "application/json", schema: { type: "object" } },
          { statusKey: "404", mediaType: "application/json", schema: { type: "object" } },
        ],
      });
      const { response } = seeder.seed(op);
      expect(response.expected_status).toBe(200);
    });

    it("selects status 201 over 404 when only 201 and 404 are present", () => {
      const seeder = new OpenApiResponseSeeder({
        schemaConverter: makeFakeConverter(),
      });
      const op = makeOp({
        responses: [
          { statusKey: "201", mediaType: "application/json", schema: { type: "object" } },
          { statusKey: "400", mediaType: "application/json", schema: { type: "object" } },
        ],
      });
      const { response } = seeder.seed(op);
      expect(response.expected_status).toBe(201);
    });

    it("picks the numerically lowest 2xx when multiple 2xx responses are declared", () => {
      const seeder = new OpenApiResponseSeeder({
        schemaConverter: makeFakeConverter(),
      });
      const op = makeOp({
        responses: [
          { statusKey: "204", mediaType: "", schema: undefined },
          { statusKey: "200", mediaType: "application/json", schema: { type: "array" } },
          { statusKey: "201", mediaType: "application/json", schema: { type: "object" } },
        ],
      });
      const { response } = seeder.seed(op);
      expect(response.expected_status).toBe(200);
    });

    it("converts the chosen response schema via the schema converter", () => {
      const fakeSchema = { type: "array", items: { type: "string" } };
      const seeder = new OpenApiResponseSeeder({
        schemaConverter: makeFakeConverter(fakeSchema),
      });
      const op = makeOp({
        responses: [
          { statusKey: "200", mediaType: "application/json", schema: { type: "array" } },
        ],
      });
      const { response } = seeder.seed(op);
      expect(response.schema).toEqual(fakeSchema);
    });

    it("returns no choice-related warning when a 2xx is available", () => {
      const seeder = new OpenApiResponseSeeder({
        schemaConverter: makeFakeConverter(),
      });
      const op = makeOp({
        responses: [
          { statusKey: "200", mediaType: "application/json", schema: { type: "object" } },
        ],
      });
      const { warnings } = seeder.seed(op);
      // No "no 2xx response" or "used status" warning
      expect(warnings.every((w) => !w.includes("no 2xx"))).toBe(true);
    });
  });

  describe("seed() — first non-2xx when no 2xx response", () => {
    it("selects the first declared response when no 2xx exists", () => {
      const seeder = new OpenApiResponseSeeder({
        schemaConverter: makeFakeConverter(),
      });
      const op = makeOp({
        responses: [
          { statusKey: "301", mediaType: "application/json", schema: { type: "object" } },
          { statusKey: "404", mediaType: "application/json", schema: { type: "object" } },
        ],
      });
      const { response } = seeder.seed(op);
      expect(response.expected_status).toBe(301);
    });

    it("emits a warning when no 2xx response is available", () => {
      const seeder = new OpenApiResponseSeeder({
        schemaConverter: makeFakeConverter(),
      });
      const op = makeOp({
        responses: [
          { statusKey: "500", mediaType: "application/json", schema: { type: "object" } },
        ],
      });
      const { warnings } = seeder.seed(op);
      expect(warnings.some((w) => w.includes("500"))).toBe(true);
    });
  });

  describe("seed() — default-only response", () => {
    it("uses synthetic status 200 when only a 'default' response is declared", () => {
      const seeder = new OpenApiResponseSeeder({
        schemaConverter: makeFakeConverter(),
      });
      const op = makeOp({
        responses: [
          { statusKey: "default", mediaType: "application/json", schema: { type: "object" } },
        ],
      });
      const { response } = seeder.seed(op);
      expect(response.expected_status).toBe(200);
    });

    it("emits a warning for synthetic-status derivation from 'default' only", () => {
      const seeder = new OpenApiResponseSeeder({
        schemaConverter: makeFakeConverter(),
      });
      const op = makeOp({
        responses: [
          { statusKey: "default", mediaType: "application/json", schema: { type: "object" } },
        ],
      });
      const { warnings } = seeder.seed(op);
      expect(warnings.some((w) => w.toLowerCase().includes("default"))).toBe(true);
    });
  });

  describe("seed() — no declared responses", () => {
    it("defaults to expected_status 200 when no responses are declared", () => {
      const seeder = new OpenApiResponseSeeder({
        schemaConverter: makeFakeConverter(),
      });
      const op = makeOp({ responses: [] });
      const { response } = seeder.seed(op);
      expect(response.expected_status).toBe(200);
    });

    it("defaults schema to permissive {type:'object'} when no responses are declared", () => {
      const seeder = new OpenApiResponseSeeder({
        schemaConverter: makeFakeConverter({ type: "object" }),
      });
      const op = makeOp({ responses: [] });
      const { response } = seeder.seed(op);
      expect(response.schema).toMatchObject({ type: "object" });
    });

    it("emits a manual-review warning when no responses are declared", () => {
      const seeder = new OpenApiResponseSeeder({
        schemaConverter: makeFakeConverter(),
      });
      const op = makeOp({ responses: [] });
      const { warnings } = seeder.seed(op);
      expect(warnings.some((w) => w.toLowerCase().includes("no responses") || w.toLowerCase().includes("manual"))).toBe(true);
    });

    it("warning for no responses names the operation path and method", () => {
      const seeder = new OpenApiResponseSeeder({
        schemaConverter: makeFakeConverter(),
      });
      const op = makeOp({ path: "/users", method: "GET", responses: [] });
      const { warnings } = seeder.seed(op);
      expect(
        warnings.some((w) => w.includes("/users") || w.includes("GET")),
      ).toBe(true);
    });
  });

  describe("seed() — response with no schema", () => {
    it("uses permissive {type:'object'} when response has no schema (undefined)", () => {
      const seeder = new OpenApiResponseSeeder({
        schemaConverter: makeFakeConverter({ type: "object" }),
      });
      const op = makeOp({
        responses: [
          { statusKey: "204", mediaType: "", schema: undefined },
        ],
      });
      const { response } = seeder.seed(op);
      expect(response.schema).toMatchObject({ type: "object" });
    });

    it("emits a warning when response has no JSON schema", () => {
      const seeder = new OpenApiResponseSeeder({
        schemaConverter: makeFakeConverter({ type: "object" }),
      });
      const op = makeOp({
        responses: [
          { statusKey: "200", mediaType: "", schema: undefined },
        ],
      });
      const { warnings } = seeder.seed(op);
      expect(warnings.length).toBeGreaterThan(0);
    });
  });

  describe("seed() — schema conversion delegation (DRY)", () => {
    it("delegates schema conversion to OpenApiSchemaConverter (not duplicated)", () => {
      let delegationCalled = false;
      const trackingConverter = {
        convert(_input: unknown) {
          delegationCalled = true;
          return { schema: { type: "object" }, warnings: [] };
        },
      } as unknown as OpenApiSchemaConverter;

      const seeder = new OpenApiResponseSeeder({
        schemaConverter: trackingConverter,
      });
      const op = makeOp({
        responses: [
          { statusKey: "200", mediaType: "application/json", schema: { type: "object" } },
        ],
      });
      seeder.seed(op);
      expect(delegationCalled).toBe(true);
    });

    it("bubbles schema-converter warnings for the response schema", () => {
      const seeder = new OpenApiResponseSeeder({
        schemaConverter: makeFakeConverter({ type: "object" }, ["Depth exceeded"]),
      });
      const op = makeOp({
        responses: [
          { statusKey: "200", mediaType: "application/json", schema: { type: "object" } },
        ],
      });
      const { warnings } = seeder.seed(op);
      expect(warnings.some((w) => w.includes("Depth exceeded"))).toBe(true);
    });
  });

  describe("seed() — non-numeric statusKey for non-2xx chosen response", () => {
    it("uses the raw statusKey string when statusKey is non-numeric ('5XX') — isNaN branch", () => {
      const seeder = new OpenApiResponseSeeder({ schemaConverter: makeFakeConverter() });
      const op = makeOp({
        responses: [
          { statusKey: "5XX", mediaType: "application/json", schema: { type: "object" } },
        ],
      });
      const { warnings } = seeder.seed(op);
      // Warning should mention the raw "5XX" status key (not a number)
      expect(warnings.some((w) => w.includes("5XX"))).toBe(true);
    });

    it("includes the raw non-numeric status string in the no-2xx warning", () => {
      const seeder = new OpenApiResponseSeeder({ schemaConverter: makeFakeConverter() });
      const op = makeOp({
        responses: [
          { statusKey: "4XX", mediaType: "application/json", schema: { type: "object" } },
        ],
      });
      const { warnings } = seeder.seed(op);
      expect(warnings.some((w) => w.includes("no 2xx") || w.includes("4XX"))).toBe(true);
    });

    it("uses the numeric string version ('500') when status is numeric — String(n) branch", () => {
      const seeder = new OpenApiResponseSeeder({ schemaConverter: makeFakeConverter() });
      const op = makeOp({
        responses: [
          { statusKey: "500", mediaType: "application/json", schema: { type: "object" } },
        ],
      });
      const { response, warnings } = seeder.seed(op);
      expect(response.expected_status).toBe(500);
      expect(warnings.some((w) => w.includes("500") || w.includes("no 2xx"))).toBe(true);
    });
  });

  describe("seed() — return shape and never throws", () => {
    it("always returns {response, warnings} shape", () => {
      const seeder = new OpenApiResponseSeeder({
        schemaConverter: makeFakeConverter(),
      });
      const result = seeder.seed(makeOp());
      expect("response" in result).toBe(true);
      expect("warnings" in result).toBe(true);
      expect(Array.isArray(result.warnings)).toBe(true);
    });

    it("response always has expected_status and schema fields", () => {
      const seeder = new OpenApiResponseSeeder({
        schemaConverter: makeFakeConverter(),
      });
      const { response } = seeder.seed(makeOp());
      expect(typeof response.expected_status).toBe("number");
      expect(typeof response.schema).toBe("object");
    });

    it("never throws for any operation shape", () => {
      const seeder = new OpenApiResponseSeeder({
        schemaConverter: makeFakeConverter(),
      });
      expect(() => seeder.seed(makeOp({ responses: [] }))).not.toThrow();
      expect(() =>
        seeder.seed(
          makeOp({
            responses: [{ statusKey: "default", mediaType: "", schema: undefined }],
          }),
        ),
      ).not.toThrow();
    });

    it("handles a range-form status key '2XX' as non-2xx (warning if chosen)", () => {
      const seeder = new OpenApiResponseSeeder({
        schemaConverter: makeFakeConverter(),
      });
      // "2XX" is not a 3-digit integer so it's treated as non-numeric / non-2xx
      const op = makeOp({
        responses: [
          { statusKey: "2XX", mediaType: "application/json", schema: { type: "object" } },
        ],
      });
      // Should not throw; should produce a sensible result
      expect(() => seeder.seed(op)).not.toThrow();
      const { response } = seeder.seed(op);
      expect(typeof response.expected_status).toBe("number");
    });
  });
});
