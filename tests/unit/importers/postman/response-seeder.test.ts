import { describe, expect, it } from "vitest";

import { JsonSchemaInferrer } from "../../../../src/importers/postman/schema-infer.js";
import { PostmanResponseSeeder } from "../../../../src/importers/postman/response-seeder.js";
import type {
  FlattenedRequest,
  FlattenedResponse,
} from "../../../../src/importers/types.js";

/**
 * Unit tests for PostmanResponseSeeder.
 *
 * Covers: no examples (default 200 + empty schema + warning), 2xx preference,
 * non-2xx fallback + warning, multiple examples (pick first 2xx), out-of-range
 * status (0 / 700), non-JSON body → permissive schema + warning, empty body →
 * empty schema + warning, JSON body → inferred schema, default-seam wiring.
 */

function makeRequest(
  name: string,
  responses: FlattenedResponse[],
): FlattenedRequest {
  return {
    postmanId: "req-1",
    name,
    folderPath: [],
    method: "GET",
    rawUrl: "https://example.com",
    headers: [],
    query: [],
    preRequestScript: "",
    responses,
    disabled: false,
    variables: {},
  };
}

describe("PostmanResponseSeeder", () => {
  describe("constructor — default-seam wiring", () => {
    it("constructs with no options and exposes a seed method", () => {
      const seeder = new PostmanResponseSeeder();
      expect(typeof seeder.seed).toBe("function");
    });

    it("default-seam seeder seeds a response without injected inferrer", () => {
      const seeder = new PostmanResponseSeeder();
      const result = seeder.seed(makeRequest("Test", []));
      expect(result.response).toBeDefined();
    });
  });

  describe("seed() — no examples", () => {
    it("returns expected_status 200 when no examples provided", () => {
      const seeder = new PostmanResponseSeeder();
      const result = seeder.seed(makeRequest("No Examples", []));
      expect(result.response.expected_status).toBe(200);
    });

    it("returns empty schema {} when no examples provided", () => {
      const seeder = new PostmanResponseSeeder();
      const result = seeder.seed(makeRequest("No Examples", []));
      expect(result.response.schema).toEqual({});
    });

    it("emits a manual-review warning when no examples provided", () => {
      const seeder = new PostmanResponseSeeder();
      const result = seeder.seed(makeRequest("No Examples", []));
      expect(
        result.warnings.some((w) => w.toLowerCase().includes("no example")),
      ).toBe(true);
    });

    it("warning mentions the request name when no examples provided", () => {
      const seeder = new PostmanResponseSeeder();
      const result = seeder.seed(makeRequest("My Request", []));
      expect(result.warnings.some((w) => w.includes("My Request"))).toBe(true);
    });
  });

  describe("seed() — 2xx preference", () => {
    it("picks the first 2xx example (200) from a single example", () => {
      const seeder = new PostmanResponseSeeder();
      const result = seeder.seed(
        makeRequest("Single 2xx", [{ code: 200, body: '{"ok":true}' }]),
      );
      expect(result.response.expected_status).toBe(200);
    });

    it("picks the first 2xx from [500, 200] → picks 200", () => {
      const seeder = new PostmanResponseSeeder();
      const result = seeder.seed(
        makeRequest("Non-2xx First", [
          { code: 500, body: '{"error":"fail"}' },
          { code: 200, body: '{"ok":true}' },
        ]),
      );
      expect(result.response.expected_status).toBe(200);
      // No "no 2xx" warning since we found one
      expect(result.warnings.every((w) => !w.includes("no 2xx"))).toBe(true);
    });

    it("picks a 201 example correctly", () => {
      const seeder = new PostmanResponseSeeder();
      const result = seeder.seed(
        makeRequest("Created", [{ code: 201, body: '{"id":1}' }]),
      );
      expect(result.response.expected_status).toBe(201);
    });

    it("picks first 2xx and infers schema from its body", () => {
      const seeder = new PostmanResponseSeeder();
      const result = seeder.seed(
        makeRequest("With Body", [
          { code: 200, body: '{"id":42,"name":"Alice"}' },
        ]),
      );
      const schema = result.response.schema as Record<string, unknown>;
      expect(schema["type"]).toBe("object");
    });
  });

  describe("seed() — non-2xx fallback", () => {
    it("picks the first example when no 2xx example exists", () => {
      const seeder = new PostmanResponseSeeder();
      const result = seeder.seed(
        makeRequest("Non-2xx Only", [
          { code: 301, body: "" },
          { code: 404, body: '{"error":"not found"}' },
        ]),
      );
      expect(result.response.expected_status).toBe(301);
    });

    it("emits a warning naming the status when using non-2xx example", () => {
      const seeder = new PostmanResponseSeeder();
      const result = seeder.seed(
        makeRequest("Non-2xx Only", [{ code: 404, body: "{}" }]),
      );
      expect(
        result.warnings.some((w) => w.includes("2xx") || w.includes("404")),
      ).toBe(true);
    });
  });

  describe("seed() — out-of-range status codes", () => {
    it("defaults status to 200 when example code is 0", () => {
      const seeder = new PostmanResponseSeeder();
      const result = seeder.seed(
        makeRequest("Zero Status", [{ code: 0, body: "{}" }]),
      );
      expect(result.response.expected_status).toBe(200);
    });

    it("emits a warning when status code 0 is out of range", () => {
      const seeder = new PostmanResponseSeeder();
      const result = seeder.seed(
        makeRequest("Zero Status", [{ code: 0, body: "{}" }]),
      );
      expect(result.warnings.some((w) => w.includes("out of range"))).toBe(
        true,
      );
    });

    it("defaults status to 200 when example code is 700 (out of range)", () => {
      const seeder = new PostmanResponseSeeder();
      const result = seeder.seed(
        makeRequest("High Status", [{ code: 700, body: "{}" }]),
      );
      expect(result.response.expected_status).toBe(200);
    });
  });

  describe("seed() — non-JSON body", () => {
    it("uses {type:'object'} permissive schema for non-JSON body", () => {
      const seeder = new PostmanResponseSeeder();
      const result = seeder.seed(
        makeRequest("HTML Response", [{ code: 200, body: "<html>ok</html>" }]),
      );
      expect(result.response.schema).toEqual({ type: "object" });
    });

    it("emits a warning for non-JSON response body", () => {
      const seeder = new PostmanResponseSeeder();
      const result = seeder.seed(
        makeRequest("HTML Response", [{ code: 200, body: "<html>" }]),
      );
      expect(
        result.warnings.some(
          (w) =>
            w.toLowerCase().includes("not valid json") ||
            w.toLowerCase().includes("non-json"),
        ),
      ).toBe(true);
    });
  });

  describe("seed() — empty body", () => {
    it("uses {} schema for empty body", () => {
      const seeder = new PostmanResponseSeeder();
      const result = seeder.seed(
        makeRequest("Empty Body", [{ code: 200, body: "" }]),
      );
      expect(result.response.schema).toEqual({});
    });

    it("emits a warning for empty response body", () => {
      const seeder = new PostmanResponseSeeder();
      const result = seeder.seed(
        makeRequest("Empty Body", [{ code: 200, body: "" }]),
      );
      expect(
        result.warnings.some(
          (w) =>
            w.toLowerCase().includes("no body") ||
            w.toLowerCase().includes("empty"),
        ),
      ).toBe(true);
    });
  });

  describe("seed() — inferred JSON schema", () => {
    it("infers object schema from JSON object body", () => {
      const seeder = new PostmanResponseSeeder();
      const result = seeder.seed(
        makeRequest("JSON Body", [
          { code: 200, body: '{"users":[{"id":1}],"total":1}' },
        ]),
      );
      const schema = result.response.schema as Record<string, unknown>;
      expect(schema["type"]).toBe("object");
    });

    it("uses the SAME JsonSchemaInferrer via injection for DRY", () => {
      const sharedInferrer = new JsonSchemaInferrer();
      const seeder = new PostmanResponseSeeder({ inferrer: sharedInferrer });
      const result = seeder.seed(
        makeRequest("Infer Test", [{ code: 200, body: '{"n":1.5}' }]),
      );
      const schema = result.response.schema as Record<string, unknown>;
      const props = schema["properties"] as Record<
        string,
        Record<string, unknown>
      >;
      expect(props["n"]["type"]).toBe("number");
    });
  });

  describe("seed() — always returns a response", () => {
    it("never returns undefined for response", () => {
      const seeder = new PostmanResponseSeeder();
      const result = seeder.seed(makeRequest("Any", []));
      expect(result.response).toBeDefined();
      expect(typeof result.response.expected_status).toBe("number");
    });

    it("never throws", () => {
      const seeder = new PostmanResponseSeeder();
      expect(() =>
        seeder.seed(makeRequest("Any", [{ code: 0, body: "" }])),
      ).not.toThrow();
    });
  });
});
