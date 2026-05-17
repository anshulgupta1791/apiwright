import { describe, expect, it } from "vitest";

import { BaseUrlResolver } from "../../../../src/importers/openapi/base-url.js";

/**
 * Unit tests for BaseUrlResolver.
 *
 * Covers OpenAPI 3.x (servers array) and Swagger 2.0 (host+basePath+schemes)
 * base-URL derivation, including all documented fallback branches. Pure class,
 * no seams required.
 */
describe("BaseUrlResolver", () => {
  describe("constructor — default-seam wiring", () => {
    it("constructs with no arguments and exposes a resolve method", () => {
      const resolver = new BaseUrlResolver();
      expect(typeof resolver.resolve).toBe("function");
    });
  });

  describe("resolve() — OpenAPI 3.x (openapi-3 flavor)", () => {
    it("returns the first server url when servers array is present", () => {
      const resolver = new BaseUrlResolver();
      const doc = { servers: [{ url: "https://api.example.com/v1" }] };
      expect(resolver.resolve(doc, "openapi-3")).toBe(
        "https://api.example.com/v1",
      );
    });

    it("returns '/' when servers array is empty", () => {
      const resolver = new BaseUrlResolver();
      const doc = { servers: [] };
      expect(resolver.resolve(doc, "openapi-3")).toBe("/");
    });

    it("returns '/' when servers key is absent", () => {
      const resolver = new BaseUrlResolver();
      const doc = {};
      expect(resolver.resolve(doc, "openapi-3")).toBe("/");
    });

    it("returns '/' when servers is not an array", () => {
      const resolver = new BaseUrlResolver();
      const doc = { servers: "not-an-array" };
      expect(resolver.resolve(doc, "openapi-3")).toBe("/");
    });

    it("returns the first server url even when multiple servers are present", () => {
      const resolver = new BaseUrlResolver();
      const doc = {
        servers: [
          { url: "https://prod.example.com" },
          { url: "https://staging.example.com" },
        ],
      };
      expect(resolver.resolve(doc, "openapi-3")).toBe(
        "https://prod.example.com",
      );
    });

    it("returns a server-variable template URL verbatim without substitution", () => {
      const resolver = new BaseUrlResolver();
      const doc = { servers: [{ url: "https://{tenant}.example.com/v1" }] };
      expect(resolver.resolve(doc, "openapi-3")).toBe(
        "https://{tenant}.example.com/v1",
      );
    });

    it("returns '/' when the first server entry has no url field", () => {
      const resolver = new BaseUrlResolver();
      const doc = { servers: [{ description: "no url" }] };
      expect(resolver.resolve(doc, "openapi-3")).toBe("/");
    });
  });

  describe("resolve() — Swagger 2.0 (swagger-2 flavor)", () => {
    it("returns schemes+host+basePath combined when all three are present", () => {
      const resolver = new BaseUrlResolver();
      const doc = {
        schemes: ["https"],
        host: "api.example.com",
        basePath: "/v2",
      };
      expect(resolver.resolve(doc, "swagger-2")).toBe(
        "https://api.example.com/v2",
      );
    });

    it("uses the first scheme when multiple schemes are listed", () => {
      const resolver = new BaseUrlResolver();
      const doc = {
        schemes: ["https", "http"],
        host: "api.example.com",
        basePath: "/v2",
      };
      expect(resolver.resolve(doc, "swagger-2")).toBe(
        "https://api.example.com/v2",
      );
    });

    it("defaults to https scheme when host is present but schemes is absent", () => {
      const resolver = new BaseUrlResolver();
      const doc = { host: "api.example.com", basePath: "/v2" };
      expect(resolver.resolve(doc, "swagger-2")).toBe(
        "https://api.example.com/v2",
      );
    });

    it("returns basePath alone when host is absent", () => {
      const resolver = new BaseUrlResolver();
      const doc = { basePath: "/v2" };
      expect(resolver.resolve(doc, "swagger-2")).toBe("/v2");
    });

    it("returns '/' when both host and basePath are absent", () => {
      const resolver = new BaseUrlResolver();
      const doc = {};
      expect(resolver.resolve(doc, "swagger-2")).toBe("/");
    });

    it("returns '/' when host is absent and basePath is also absent even with schemes", () => {
      const resolver = new BaseUrlResolver();
      const doc = { schemes: ["https"] };
      expect(resolver.resolve(doc, "swagger-2")).toBe("/");
    });

    it("handles http scheme correctly", () => {
      const resolver = new BaseUrlResolver();
      const doc = {
        schemes: ["http"],
        host: "api.example.com",
        basePath: "/v1",
      };
      expect(resolver.resolve(doc, "swagger-2")).toBe(
        "http://api.example.com/v1",
      );
    });

    it("handles empty basePath by returning just the scheme+host", () => {
      const resolver = new BaseUrlResolver();
      const doc = {
        schemes: ["https"],
        host: "api.example.com",
        basePath: "",
      };
      const result = resolver.resolve(doc, "swagger-2");
      expect(result).toContain("api.example.com");
    });
  });

  describe("resolve() — never throws", () => {
    it("does not throw for any combination of missing fields", () => {
      const resolver = new BaseUrlResolver();
      expect(() => resolver.resolve({}, "openapi-3")).not.toThrow();
      expect(() => resolver.resolve({}, "swagger-2")).not.toThrow();
      expect(() =>
        resolver.resolve({ servers: null }, "openapi-3"),
      ).not.toThrow();
    });
  });
});
