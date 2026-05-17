import { describe, expect, it } from "vitest";

import { SpecAccess } from "../../../../src/importers/openapi/spec-access.js";

/**
 * Unit tests for SpecAccess.
 *
 * Covers all type-narrowing methods: isObject, asString, asObjectArray,
 * asRecord, getPaths, getServers, getComponentsSchemas, getDefinitions,
 * getSecuritySchemes, getSecurityDefinitions, detectFlavor. Pure class,
 * no seams required.
 */
describe("SpecAccess", () => {
  describe("constructor — default-seam wiring", () => {
    it("constructs with no arguments", () => {
      const acc = new SpecAccess();
      expect(acc).toBeDefined();
    });
  });

  describe("isObject()", () => {
    it("returns true for a plain object", () => {
      const acc = new SpecAccess();
      expect(acc.isObject({ a: 1 })).toBe(true);
    });

    it("returns false for null", () => {
      const acc = new SpecAccess();
      expect(acc.isObject(null)).toBe(false);
    });

    it("returns false for an array", () => {
      const acc = new SpecAccess();
      expect(acc.isObject([1, 2, 3])).toBe(false);
    });

    it("returns false for a string", () => {
      const acc = new SpecAccess();
      expect(acc.isObject("hello")).toBe(false);
    });

    it("returns false for a number", () => {
      const acc = new SpecAccess();
      expect(acc.isObject(42)).toBe(false);
    });

    it("returns false for undefined", () => {
      const acc = new SpecAccess();
      expect(acc.isObject(undefined)).toBe(false);
    });
  });

  describe("asString()", () => {
    it("returns the string when value is a string", () => {
      const acc = new SpecAccess();
      expect(acc.asString("hello")).toBe("hello");
    });

    it("returns undefined when value is not a string", () => {
      const acc = new SpecAccess();
      expect(acc.asString(42)).toBeUndefined();
    });

    it("returns undefined for null", () => {
      const acc = new SpecAccess();
      expect(acc.asString(null)).toBeUndefined();
    });

    it("returns an empty string when the value is an empty string", () => {
      const acc = new SpecAccess();
      expect(acc.asString("")).toBe("");
    });
  });

  describe("asObjectArray()", () => {
    it("returns the array when value is an array", () => {
      const acc = new SpecAccess();
      const arr = [{ a: 1 }, { b: 2 }];
      expect(acc.asObjectArray(arr)).toEqual(arr);
    });

    it("returns an empty array when value is not an array", () => {
      const acc = new SpecAccess();
      expect(acc.asObjectArray("not-array")).toEqual([]);
    });

    it("returns an empty array for null", () => {
      const acc = new SpecAccess();
      expect(acc.asObjectArray(null)).toEqual([]);
    });

    it("returns an empty array when value is an object", () => {
      const acc = new SpecAccess();
      expect(acc.asObjectArray({ a: 1 })).toEqual([]);
    });

    it("returns the empty array when value is an empty array", () => {
      const acc = new SpecAccess();
      expect(acc.asObjectArray([])).toEqual([]);
    });
  });

  describe("asRecord()", () => {
    it("returns the object when value is a plain object", () => {
      const acc = new SpecAccess();
      const obj = { key: "value" };
      expect(acc.asRecord(obj)).toEqual(obj);
    });

    it("returns an empty record for null", () => {
      const acc = new SpecAccess();
      expect(acc.asRecord(null)).toEqual({});
    });

    it("returns an empty record for an array", () => {
      const acc = new SpecAccess();
      expect(acc.asRecord([1, 2])).toEqual({});
    });

    it("returns an empty record for a string", () => {
      const acc = new SpecAccess();
      expect(acc.asRecord("str")).toEqual({});
    });
  });

  describe("getPaths()", () => {
    it("returns paths object when present", () => {
      const acc = new SpecAccess();
      const doc = { paths: { "/users": { get: {} } } };
      expect(acc.getPaths(doc)).toEqual({ "/users": { get: {} } });
    });

    it("returns an empty object when paths key is absent", () => {
      const acc = new SpecAccess();
      expect(acc.getPaths({})).toEqual({});
    });

    it("returns an empty object when paths is not an object", () => {
      const acc = new SpecAccess();
      expect(acc.getPaths({ paths: "not-object" })).toEqual({});
    });
  });

  describe("getServers()", () => {
    it("returns servers array when present", () => {
      const acc = new SpecAccess();
      const doc = { servers: [{ url: "https://example.com" }] };
      expect(acc.getServers(doc)).toEqual([{ url: "https://example.com" }]);
    });

    it("returns an empty array when servers key is absent", () => {
      const acc = new SpecAccess();
      expect(acc.getServers({})).toEqual([]);
    });

    it("returns an empty array when servers is not an array", () => {
      const acc = new SpecAccess();
      expect(acc.getServers({ servers: "not-array" })).toEqual([]);
    });
  });

  describe("getComponentsSchemas()", () => {
    it("returns schemas from components when present", () => {
      const acc = new SpecAccess();
      const doc = {
        components: { schemas: { User: { type: "object" } } },
      };
      expect(acc.getComponentsSchemas(doc)).toEqual({
        User: { type: "object" },
      });
    });

    it("returns an empty record when components is absent", () => {
      const acc = new SpecAccess();
      expect(acc.getComponentsSchemas({})).toEqual({});
    });

    it("returns an empty record when components.schemas is absent", () => {
      const acc = new SpecAccess();
      expect(acc.getComponentsSchemas({ components: {} })).toEqual({});
    });
  });

  describe("getDefinitions()", () => {
    it("returns definitions when present", () => {
      const acc = new SpecAccess();
      const doc = { definitions: { Pet: { type: "object" } } };
      expect(acc.getDefinitions(doc)).toEqual({ Pet: { type: "object" } });
    });

    it("returns an empty record when definitions is absent", () => {
      const acc = new SpecAccess();
      expect(acc.getDefinitions({})).toEqual({});
    });
  });

  describe("getSecuritySchemes()", () => {
    it("returns securitySchemes from components when present", () => {
      const acc = new SpecAccess();
      const doc = {
        components: {
          securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } },
        },
      };
      expect(acc.getSecuritySchemes(doc)).toEqual({
        bearerAuth: { type: "http", scheme: "bearer" },
      });
    });

    it("returns an empty record when components.securitySchemes is absent", () => {
      const acc = new SpecAccess();
      expect(acc.getSecuritySchemes({})).toEqual({});
    });
  });

  describe("getSecurityDefinitions()", () => {
    it("returns securityDefinitions when present", () => {
      const acc = new SpecAccess();
      const doc = { securityDefinitions: { basicAuth: { type: "basic" } } };
      expect(acc.getSecurityDefinitions(doc)).toEqual({
        basicAuth: { type: "basic" },
      });
    });

    it("returns an empty record when securityDefinitions is absent", () => {
      const acc = new SpecAccess();
      expect(acc.getSecurityDefinitions({})).toEqual({});
    });
  });

  describe("detectFlavor()", () => {
    it("returns openapi-3 for a document with openapi starting with 3.", () => {
      const acc = new SpecAccess();
      expect(acc.detectFlavor({ openapi: "3.0.3" })).toBe("openapi-3");
    });

    it("returns openapi-3 for openapi 3.1.0", () => {
      const acc = new SpecAccess();
      expect(acc.detectFlavor({ openapi: "3.1.0" })).toBe("openapi-3");
    });

    it("returns swagger-2 for a document with swagger === '2.0'", () => {
      const acc = new SpecAccess();
      expect(acc.detectFlavor({ swagger: "2.0" })).toBe("swagger-2");
    });

    it("returns swagger-2 for swagger version starting with 2.", () => {
      const acc = new SpecAccess();
      expect(acc.detectFlavor({ swagger: "2.1" })).toBe("swagger-2");
    });

    it("returns undefined when neither openapi nor swagger fields are present", () => {
      const acc = new SpecAccess();
      expect(acc.detectFlavor({})).toBeUndefined();
    });

    it("returns undefined when openapi version does not start with 3", () => {
      const acc = new SpecAccess();
      expect(acc.detectFlavor({ openapi: "2.0" })).toBeUndefined();
    });

    it("returns undefined when openapi field is not a string", () => {
      const acc = new SpecAccess();
      expect(acc.detectFlavor({ openapi: 3 })).toBeUndefined();
    });
  });
});
