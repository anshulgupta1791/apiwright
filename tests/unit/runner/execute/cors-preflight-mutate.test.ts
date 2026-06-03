/**
 * Unit tests for the cors_preflight mutateRequest arm and the private
 * `applyCorsPreflightHeaders` helper (tested indirectly via mutateRequest).
 *
 * Covers §6 items 18–24 from v1.0.2-pr6-cors-preflight.md:
 *   18. Base headers empty + all three arrays → out has Origin, ACRM, ACRH.
 *   19. Base headers contain user 'Origin: foo' + cors allow_origins=["bar"]
 *       → out has Origin: bar (preflight WINS per DD-13).
 *   20. allow_headers empty → Access-Control-Request-Headers NOT in out.
 *   21. allow_methods: ["GET","POST","PUT"] → ACRM = "GET,POST,PUT" (no spaces).
 *   22. allow_headers: ["Authorization","Content-Type"] → ACRH = "Authorization,Content-Type".
 *   23. Method, URL, body of base request unchanged (mutator only touches headers).
 *   24. Base headers like {"X-Custom": "v"} survive in out (overlay, not replace).
 *
 * Design decisions pinned:
 *   DD-2  Access-Control-Request-Method = allow_methods.join(","); ACRH omitted when empty.
 *   DD-13 Preflight request headers WIN over user-supplied values.
 *
 * Category: Unit.
 * Expected initial failure: 'cors_preflight' arm missing from mutateRequest in
 *   '../../../../src/runner/execute/case-runners.js'
 */

import { describe, it, expect } from "vitest";

import { mutateRequest } from "../../../../src/runner/execute/case-runners.js";
import type { RequestRecord } from "../../../../src/runner/types.js";
import type { TestCase } from "../../../../src/test-catalog/types.js";
import type { CorsPreflightParams } from "../../../../src/test-catalog/test-case-params.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCorsCase(
  allow_origins: readonly string[],
  allow_methods: readonly string[],
  allow_headers: readonly string[],
): TestCase {
  const params: CorsPreflightParams = {
    kind: "cors_preflight",
    allow_origins,
    allow_methods,
    allow_headers,
  };
  return {
    id: "ep.cors.0",
    endpoint_id: "ep.cors",
    type: "cors_preflight",
    marker: "smoke",
    title: "CORS preflight for EP",
    prod_safe: true,
    params,
  };
}

function makeBaseRequest(overrides: Partial<RequestRecord> = {}): RequestRecord {
  return {
    method: "OPTIONS",
    url: "https://api.example.com/api/resource",
    headers: {},
    body: undefined,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("mutateRequest — cors_preflight arm (applyCorsPreflightHeaders)", () => {

  /**
   * Item 18: Base headers empty + all three arrays → out has all three CORS headers.
   */
  describe("item 18 — empty base headers with all arrays populated", () => {
    it("output contains Origin header", () => {
      const base = makeBaseRequest({ headers: {} });
      const tc = makeCorsCase(
        ["https://app.example.com"],
        ["GET", "POST"],
        ["Authorization", "Content-Type"],
      );
      const result = mutateRequest(base, tc);
      expect(result.headers["Origin"]).toBe("https://app.example.com");
    });

    it("output contains Access-Control-Request-Method header", () => {
      const base = makeBaseRequest({ headers: {} });
      const tc = makeCorsCase(
        ["https://app.example.com"],
        ["GET", "POST"],
        ["Authorization", "Content-Type"],
      );
      const result = mutateRequest(base, tc);
      expect(result.headers["Access-Control-Request-Method"]).toBe("GET,POST");
    });

    it("output contains Access-Control-Request-Headers header", () => {
      const base = makeBaseRequest({ headers: {} });
      const tc = makeCorsCase(
        ["https://app.example.com"],
        ["GET", "POST"],
        ["Authorization", "Content-Type"],
      );
      const result = mutateRequest(base, tc);
      expect(result.headers["Access-Control-Request-Headers"]).toBe("Authorization,Content-Type");
    });
  });

  /**
   * Item 19: User-supplied Origin in base headers → preflight Origin WINS (DD-13).
   */
  describe("item 19 — preflight Origin overwrites user-supplied Origin (DD-13)", () => {
    it("preflight Origin 'bar' overwrites user-supplied 'Origin: foo'", () => {
      const base = makeBaseRequest({
        headers: { "Origin": "https://user-supplied.com" },
      });
      const tc = makeCorsCase(
        ["https://cors-declared.com"],
        ["GET"],
        [],
      );
      const result = mutateRequest(base, tc);
      expect(result.headers["Origin"]).toBe("https://cors-declared.com");
    });

    it("preflight ACRM overwrites user-supplied Access-Control-Request-Method", () => {
      const base = makeBaseRequest({
        headers: { "Access-Control-Request-Method": "DELETE" },
      });
      const tc = makeCorsCase(
        ["https://app.example.com"],
        ["GET", "POST"],
        [],
      );
      const result = mutateRequest(base, tc);
      expect(result.headers["Access-Control-Request-Method"]).toBe("GET,POST");
    });
  });

  /**
   * Item 20: allow_headers empty → Access-Control-Request-Headers NOT in output (DD-2).
   */
  describe("item 20 — allow_headers empty → ACRH header OMITTED", () => {
    it("does not add Access-Control-Request-Headers when allow_headers is empty", () => {
      const base = makeBaseRequest({ headers: {} });
      const tc = makeCorsCase(["https://a.com"], ["GET"], []);
      const result = mutateRequest(base, tc);
      expect("Access-Control-Request-Headers" in result.headers).toBe(false);
    });

    it("does not add ACRH even when base had no ACRH (DD-2: omit, not empty-string)", () => {
      const base = makeBaseRequest({
        headers: { "X-Custom": "value" },
      });
      const tc = makeCorsCase(["https://a.com"], ["GET"], []);
      const result = mutateRequest(base, tc);
      expect(result.headers["Access-Control-Request-Headers"]).toBeUndefined();
    });
  });

  /**
   * Item 21: allow_methods joined with "," and no spaces (DD-2).
   */
  describe("item 21 — methods joined verbatim with comma, no spaces", () => {
    it("ACRM = 'GET,POST,PUT' (no spaces) for allow_methods ['GET','POST','PUT']", () => {
      const base = makeBaseRequest({ headers: {} });
      const tc = makeCorsCase(["https://a.com"], ["GET", "POST", "PUT"], []);
      const result = mutateRequest(base, tc);
      expect(result.headers["Access-Control-Request-Method"]).toBe("GET,POST,PUT");
    });

    it("ACRM = 'DELETE' for single-element allow_methods ['DELETE']", () => {
      const base = makeBaseRequest({ headers: {} });
      const tc = makeCorsCase(["https://a.com"], ["DELETE"], []);
      const result = mutateRequest(base, tc);
      expect(result.headers["Access-Control-Request-Method"]).toBe("DELETE");
    });
  });

  /**
   * Item 22: allow_headers joined with "," and no spaces.
   */
  describe("item 22 — headers joined verbatim with comma, no spaces", () => {
    it("ACRH = 'Authorization,Content-Type' for allow_headers ['Authorization','Content-Type']", () => {
      const base = makeBaseRequest({ headers: {} });
      const tc = makeCorsCase(
        ["https://a.com"],
        ["GET"],
        ["Authorization", "Content-Type"],
      );
      const result = mutateRequest(base, tc);
      expect(result.headers["Access-Control-Request-Headers"]).toBe("Authorization,Content-Type");
    });
  });

  /**
   * Item 23: Method, URL, body of base request unchanged.
   */
  describe("item 23 — method, URL, body remain unchanged", () => {
    it("request method is unchanged after cors_preflight mutation", () => {
      const base = makeBaseRequest({ method: "OPTIONS" });
      const tc = makeCorsCase(["https://a.com"], ["GET"], []);
      const result = mutateRequest(base, tc);
      expect(result.method).toBe("OPTIONS");
    });

    it("request URL is unchanged after cors_preflight mutation", () => {
      const base = makeBaseRequest({ url: "https://api.example.com/api/resource" });
      const tc = makeCorsCase(["https://a.com"], ["GET"], []);
      const result = mutateRequest(base, tc);
      expect(result.url).toBe("https://api.example.com/api/resource");
    });

    it("request body is unchanged (undefined) after cors_preflight mutation", () => {
      const base = makeBaseRequest({ body: undefined });
      const tc = makeCorsCase(["https://a.com"], ["GET"], []);
      const result = mutateRequest(base, tc);
      expect(result.body).toBeUndefined();
    });
  });

  /**
   * Item 24: Base headers survive in output (overlay, not replace).
   */
  describe("item 24 — existing base headers survive the overlay", () => {
    it("base header 'X-Custom: v' is preserved in output after mutation", () => {
      const base = makeBaseRequest({
        headers: { "X-Custom": "v", "Content-Type": "application/json" },
      });
      const tc = makeCorsCase(["https://a.com"], ["GET"], []);
      const result = mutateRequest(base, tc);
      expect(result.headers["X-Custom"]).toBe("v");
    });

    it("base Content-Type header survives alongside injected CORS headers", () => {
      const base = makeBaseRequest({
        headers: { "Content-Type": "application/json" },
      });
      const tc = makeCorsCase(["https://a.com"], ["GET"], []);
      const result = mutateRequest(base, tc);
      expect(result.headers["Content-Type"]).toBe("application/json");
    });

    it("multiple existing headers all survive alongside CORS headers", () => {
      const base = makeBaseRequest({
        headers: {
          "X-Custom-1": "a",
          "X-Custom-2": "b",
          "Authorization": "Bearer tok",
        },
      });
      const tc = makeCorsCase(["https://a.com"], ["GET", "POST"], ["Authorization"]);
      const result = mutateRequest(base, tc);
      expect(result.headers["X-Custom-1"]).toBe("a");
      expect(result.headers["X-Custom-2"]).toBe("b");
      // Note: Authorization was in base AND in ACRH; Origin is the overwritten header
      // The base Authorization header should survive (it's a request auth header, not CORS)
      expect(result.headers["Authorization"]).toBe("Bearer tok");
    });
  });

  /**
   * Mutation returns a NEW object (never mutates the input).
   */
  describe("mutateRequest — immutability", () => {
    it("returns a new object and does not mutate the base request headers", () => {
      const baseHeaders = { "X-Custom": "original" };
      const base = makeBaseRequest({ headers: baseHeaders });
      const tc = makeCorsCase(["https://a.com"], ["GET"], []);
      mutateRequest(base, tc);
      // base.headers should remain unchanged
      expect(base.headers["Origin"]).toBeUndefined();
      expect(base.headers["X-Custom"]).toBe("original");
    });

    it("returned object is a different reference from the base", () => {
      const base = makeBaseRequest({ headers: {} });
      const tc = makeCorsCase(["https://a.com"], ["GET"], []);
      const result = mutateRequest(base, tc);
      expect(result).not.toBe(base);
    });
  });
});
