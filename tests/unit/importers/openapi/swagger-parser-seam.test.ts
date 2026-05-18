import { describe, expect, it } from "vitest";

import { DefaultSwaggerParserSeam } from "../../../../src/importers/openapi/swagger-parser-seam.js";

/**
 * Unit tests for DefaultSwaggerParserSeam.
 *
 * The DefaultSwaggerParserSeam is a thin adapter over @apidevtools/swagger-parser.
 * The real parser library does disk/network I/O so we inject a fake "parserLib"
 * constructor parameter to unit-test the adapter's forwarding methods and the
 * default-require fallback without touching real files or the network.
 *
 * This covers: dereference forwarding, bundle forwarding, default-lib fallback
 * (constructed with no parserLib), and the adapter's own two methods.
 */

/** A minimal fake SwaggerParser-like library object. */
function makeFakeParserLib(
  derefResult?: unknown,
  bundleResult?: unknown,
  derefError?: Error,
  bundleError?: Error,
): {
  dereference: (source: string) => Promise<unknown>;
  bundle: (source: string) => Promise<unknown>;
} {
  return {
    dereference(_source: string): Promise<unknown> {
      if (derefError) return Promise.reject(derefError);
      return Promise.resolve(derefResult ?? { openapi: "3.0.3" });
    },
    bundle(_source: string): Promise<unknown> {
      if (bundleError) return Promise.reject(bundleError);
      return Promise.resolve(bundleResult ?? { openapi: "3.0.3" });
    },
  };
}

describe("DefaultSwaggerParserSeam", () => {
  describe("constructor — default-seam wiring", () => {
    it("constructs with no options and exposes dereference and bundle methods", () => {
      const seam = new DefaultSwaggerParserSeam();
      expect(typeof seam.dereference).toBe("function");
      expect(typeof seam.bundle).toBe("function");
    });

    it("constructs with a fake parserLib and exposes both methods", () => {
      const seam = new DefaultSwaggerParserSeam({
        parserLib: makeFakeParserLib(),
      });
      expect(typeof seam.dereference).toBe("function");
      expect(typeof seam.bundle).toBe("function");
    });
  });

  describe("dereference()", () => {
    it("forwards to parserLib.dereference and resolves the result", async () => {
      const fakeResult = { openapi: "3.0.3", paths: {} };
      const seam = new DefaultSwaggerParserSeam({
        parserLib: makeFakeParserLib(fakeResult),
      });
      const result = await seam.dereference("/some/spec.json");
      expect(result).toEqual(fakeResult);
    });

    it("rejects when parserLib.dereference rejects", async () => {
      const err = new Error("Invalid spec");
      const seam = new DefaultSwaggerParserSeam({
        parserLib: makeFakeParserLib(undefined, undefined, err),
      });
      await expect(seam.dereference("/bad/spec.json")).rejects.toThrow(
        "Invalid spec",
      );
    });

    it("passes the source string through to parserLib.dereference", async () => {
      let capturedSource = "";
      const lib = {
        dereference(source: string) {
          capturedSource = source;
          return Promise.resolve({ openapi: "3.0.3" });
        },
        bundle(_source: string) {
          return Promise.resolve({ openapi: "3.0.3" });
        },
      };
      const seam = new DefaultSwaggerParserSeam({ parserLib: lib });
      await seam.dereference("/spec/file.yaml");
      expect(capturedSource).toBe("/spec/file.yaml");
    });
  });

  describe("bundle()", () => {
    it("forwards to parserLib.bundle and resolves the result", async () => {
      const fakeResult = { swagger: "2.0", paths: {} };
      const seam = new DefaultSwaggerParserSeam({
        parserLib: makeFakeParserLib(undefined, fakeResult),
      });
      const result = await seam.bundle("/some/spec.json");
      expect(result).toEqual(fakeResult);
    });

    it("rejects when parserLib.bundle rejects", async () => {
      const err = new Error("Bundle failed");
      const seam = new DefaultSwaggerParserSeam({
        parserLib: makeFakeParserLib(undefined, undefined, undefined, err),
      });
      await expect(seam.bundle("/bad/spec.json")).rejects.toThrow(
        "Bundle failed",
      );
    });

    it("passes the source string through to parserLib.bundle", async () => {
      let capturedSource = "";
      const lib = {
        dereference(_source: string) {
          return Promise.resolve({ openapi: "3.0.3" });
        },
        bundle(source: string) {
          capturedSource = source;
          return Promise.resolve({ openapi: "3.0.3" });
        },
      };
      const seam = new DefaultSwaggerParserSeam({ parserLib: lib });
      await seam.bundle("https://example.com/openapi.json");
      expect(capturedSource).toBe("https://example.com/openapi.json");
    });
  });
});
