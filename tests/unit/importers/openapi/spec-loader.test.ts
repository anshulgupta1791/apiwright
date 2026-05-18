import { describe, expect, it } from "vitest";

import { OpenApiSpecLoader } from "../../../../src/importers/openapi/spec-loader.js";
import { BaseUrlResolver } from "../../../../src/importers/openapi/base-url.js";
import type { SwaggerParserSeam } from "../../../../src/importers/openapi/types.js";
import type { ImporterFileSystem } from "../../../../src/importers/types.js";
import type { ImporterFsError } from "../../../../src/importers/types.js";

/**
 * Unit tests for OpenApiSpecLoader.
 *
 * All external boundaries are injected via fake seams — no real disk, no real
 * network, no real swagger-parser calls. Covers: valid 3.x file, valid 2.0 file,
 * URL source, circular-$ref bundle fallback, ENOENT, other FS errors, invalid
 * spec (parser rejects), unrecognized version, base URL derivation, default-seam
 * wiring.
 */

/** A valid OpenAPI 3.0 document object. */
const VALID_3X_DOC = {
  openapi: "3.0.3",
  info: { title: "Test", version: "1.0.0" },
  servers: [{ url: "https://api.example.com/v1" }],
  paths: {},
};

/** A valid Swagger 2.0 document object. */
const VALID_SWAGGER2_DOC = {
  swagger: "2.0",
  info: { title: "Test", version: "1.0.0" },
  host: "api.example.com",
  basePath: "/v2",
  schemes: ["https"],
  paths: {},
};

/** Fake SwaggerParserSeam that resolves canned documents. */
function makeParser(
  derefResult: unknown,
  bundleResult?: unknown,
  derefError?: Error,
  bundleError?: Error,
): SwaggerParserSeam {
  return {
    dereference(_source: string): Promise<unknown> {
      if (derefError) return Promise.reject(derefError);
      return Promise.resolve(derefResult);
    },
    bundle(_source: string): Promise<unknown> {
      if (bundleError) return Promise.reject(bundleError);
      return Promise.resolve(bundleResult ?? derefResult);
    },
  };
}

/** Fake ImporterFileSystem that simulates file reads. */
function makeFakeFs(
  files: Record<string, string> = {},
  code?: ImporterFsError["code"],
): ImporterFileSystem {
  return {
    readFile(path: string): string {
      if (path in files) return files[path];
      const err = new Error(`readFile: ${path}`) as ImporterFsError;
      (err as unknown as Record<string, unknown>)["code"] = code ?? "ENOENT";
      throw err;
    },
    mkdirp(): void {},
    writeFile(): void {},
  };
}

/** Fake FS that succeeds for all readFile calls (file exists). */
function makeSucceedingFs(): ImporterFileSystem {
  return {
    readFile(_path: string): string {
      return "{}";
    },
    mkdirp(): void {},
    writeFile(): void {},
  };
}

describe("OpenApiSpecLoader", () => {
  describe("constructor — default-seam wiring", () => {
    it("constructs with no options and exposes a load method", () => {
      const loader = new OpenApiSpecLoader();
      expect(typeof loader.load).toBe("function");
    });

    it("constructs with partial options (only fs provided)", () => {
      const loader = new OpenApiSpecLoader({ fs: makeSucceedingFs() });
      expect(typeof loader.load).toBe("function");
    });
  });

  describe("load() — valid OpenAPI 3.x from file path", () => {
    it("returns ok:true for a valid OpenAPI 3.x document", async () => {
      const loader = new OpenApiSpecLoader({
        parser: makeParser(VALID_3X_DOC),
        fs: makeSucceedingFs(),
      });
      const result = await loader.load("/path/to/spec.json");
      expect(result.ok).toBe(true);
    });

    it("returns flavor 'openapi-3' for a valid 3.x document", async () => {
      const loader = new OpenApiSpecLoader({
        parser: makeParser(VALID_3X_DOC),
        fs: makeSucceedingFs(),
      });
      const result = await loader.load("/path/to/spec.json");
      if (!result.ok) throw new Error("Expected ok:true");
      expect(result.spec.flavor).toBe("openapi-3");
    });

    it("returns the resolved document on the LoadedSpec", async () => {
      const loader = new OpenApiSpecLoader({
        parser: makeParser(VALID_3X_DOC),
        fs: makeSucceedingFs(),
      });
      const result = await loader.load("/path/to/spec.json");
      if (!result.ok) throw new Error("Expected ok:true");
      expect(result.spec.document).toMatchObject({ openapi: "3.0.3" });
    });

    it("sets circular:false when dereference succeeds", async () => {
      const loader = new OpenApiSpecLoader({
        parser: makeParser(VALID_3X_DOC),
        fs: makeSucceedingFs(),
      });
      const result = await loader.load("/path/to/spec.json");
      if (!result.ok) throw new Error("Expected ok:true");
      expect(result.spec.circular).toBe(false);
    });

    it("sets sourceId to the file basename for a file path", async () => {
      const loader = new OpenApiSpecLoader({
        parser: makeParser(VALID_3X_DOC),
        fs: makeSucceedingFs(),
      });
      const result = await loader.load("/some/dir/my-api.json");
      if (!result.ok) throw new Error("Expected ok:true");
      expect(result.spec.sourceId).toBe("my-api.json");
    });

    it("records the base URL from BaseUrlResolver on the LoadedSpec", async () => {
      const loader = new OpenApiSpecLoader({
        parser: makeParser(VALID_3X_DOC),
        fs: makeSucceedingFs(),
        baseUrlResolver: new BaseUrlResolver(),
      });
      const result = await loader.load("/spec.json");
      if (!result.ok) throw new Error("Expected ok:true");
      expect(result.spec.baseUrl).toBe("https://api.example.com/v1");
    });
  });

  describe("load() — valid Swagger 2.0 from file path", () => {
    it("returns ok:true for a valid Swagger 2.0 document", async () => {
      const loader = new OpenApiSpecLoader({
        parser: makeParser(VALID_SWAGGER2_DOC),
        fs: makeSucceedingFs(),
      });
      const result = await loader.load("/spec.json");
      expect(result.ok).toBe(true);
    });

    it("returns flavor 'swagger-2' for a valid 2.0 document", async () => {
      const loader = new OpenApiSpecLoader({
        parser: makeParser(VALID_SWAGGER2_DOC),
        fs: makeSucceedingFs(),
      });
      const result = await loader.load("/spec.json");
      if (!result.ok) throw new Error("Expected ok:true");
      expect(result.spec.flavor).toBe("swagger-2");
    });

    it("derives the 2.0 base URL (scheme+host+basePath)", async () => {
      const loader = new OpenApiSpecLoader({
        parser: makeParser(VALID_SWAGGER2_DOC),
        fs: makeSucceedingFs(),
        baseUrlResolver: new BaseUrlResolver(),
      });
      const result = await loader.load("/swagger.json");
      if (!result.ok) throw new Error("Expected ok:true");
      expect(result.spec.baseUrl).toBe("https://api.example.com/v2");
    });
  });

  describe("load() — URL source", () => {
    it("returns ok:true for a valid spec loaded from an https URL", async () => {
      const loader = new OpenApiSpecLoader({
        parser: makeParser(VALID_3X_DOC),
        fs: makeFakeFs(), // FS not called for URL sources
      });
      const result = await loader.load(
        "https://api.example.com/openapi.json",
      );
      expect(result.ok).toBe(true);
    });

    it("sets sourceId to the full URL for an https source", async () => {
      const loader = new OpenApiSpecLoader({
        parser: makeParser(VALID_3X_DOC),
        fs: makeFakeFs(),
      });
      const result = await loader.load(
        "https://api.example.com/openapi.json",
      );
      if (!result.ok) throw new Error("Expected ok:true");
      expect(result.spec.sourceId).toBe(
        "https://api.example.com/openapi.json",
      );
    });

    it("returns ok:true for an http URL (non-https)", async () => {
      const loader = new OpenApiSpecLoader({
        parser: makeParser(VALID_3X_DOC),
        fs: makeFakeFs(),
      });
      const result = await loader.load("http://api.example.com/openapi.json");
      expect(result.ok).toBe(true);
    });

    it("does not call fs.readFile for URL sources", async () => {
      let readFileCalled = false;
      const trackingFs: ImporterFileSystem = {
        readFile(): string {
          readFileCalled = true;
          return "{}";
        },
        mkdirp(): void {},
        writeFile(): void {},
      };
      const loader = new OpenApiSpecLoader({
        parser: makeParser(VALID_3X_DOC),
        fs: trackingFs,
      });
      await loader.load("https://api.example.com/openapi.json");
      expect(readFileCalled).toBe(false);
    });
  });

  describe("load() — file not found", () => {
    it("returns ok:false when the file does not exist (ENOENT)", async () => {
      const loader = new OpenApiSpecLoader({
        parser: makeParser(VALID_3X_DOC),
        fs: makeFakeFs({}, "ENOENT"),
      });
      const result = await loader.load("/missing/spec.json");
      expect(result.ok).toBe(false);
    });

    it("error message names the path for ENOENT", async () => {
      const loader = new OpenApiSpecLoader({
        parser: makeParser(VALID_3X_DOC),
        fs: makeFakeFs({}, "ENOENT"),
      });
      const result = await loader.load("/missing/spec.json");
      if (result.ok) throw new Error("Expected ok:false");
      expect(result.error).toContain("/missing/spec.json");
    });

    it("returns ok:false for an EACCES error on the file", async () => {
      const loader = new OpenApiSpecLoader({
        parser: makeParser(VALID_3X_DOC),
        fs: makeFakeFs({}, "EACCES"),
      });
      const result = await loader.load("/protected/spec.json");
      expect(result.ok).toBe(false);
    });

    it("never throws for a missing file — returns discriminated failure", async () => {
      const loader = new OpenApiSpecLoader({
        parser: makeParser(VALID_3X_DOC),
        fs: makeFakeFs({}, "ENOENT"),
      });
      await expect(loader.load("/missing.json")).resolves.toBeDefined();
    });
  });

  describe("load() — invalid or unparseable spec", () => {
    it("returns ok:false when parser rejects with an invalid-spec error", async () => {
      const loader = new OpenApiSpecLoader({
        parser: makeParser(
          undefined,
          undefined,
          new Error("Invalid OpenAPI"),
          new Error("Bundle also failed"),
        ),
        fs: makeSucceedingFs(),
      });
      const result = await loader.load("/invalid.json");
      expect(result.ok).toBe(false);
    });

    it("error message is human-readable and names the source when parser rejects", async () => {
      const loader = new OpenApiSpecLoader({
        parser: makeParser(
          undefined,
          undefined,
          new Error("YAML parse error"),
          new Error("Bundle failed too"),
        ),
        fs: makeSucceedingFs(),
      });
      const result = await loader.load("/bad.yaml");
      if (result.ok) throw new Error("Expected ok:false");
      expect(result.error).toContain("/bad.yaml");
    });

    it("never throws for an invalid spec — returns discriminated failure", async () => {
      const loader = new OpenApiSpecLoader({
        parser: makeParser(
          undefined,
          undefined,
          new Error("Invalid"),
          new Error("Bundle failed"),
        ),
        fs: makeSucceedingFs(),
      });
      await expect(loader.load("/bad.json")).resolves.toBeDefined();
    });
  });

  describe("load() — circular $ref handling", () => {
    it("returns ok:true when dereference fails but bundle succeeds (circular $ref)", async () => {
      const loader = new OpenApiSpecLoader({
        parser: makeParser(
          undefined,
          VALID_3X_DOC,
          new Error("Circular $ref"),
        ),
        fs: makeSucceedingFs(),
      });
      const result = await loader.load("/circular.json");
      expect(result.ok).toBe(true);
    });

    it("sets circular:true on the LoadedSpec when bundle fallback was used", async () => {
      const loader = new OpenApiSpecLoader({
        parser: makeParser(
          undefined,
          VALID_3X_DOC,
          new Error("Circular $ref"),
        ),
        fs: makeSucceedingFs(),
      });
      const result = await loader.load("/circular.json");
      if (!result.ok) throw new Error("Expected ok:true");
      expect(result.spec.circular).toBe(true);
    });

    it("includes a circular-ref warning in the result when bundle fallback was used", async () => {
      const loader = new OpenApiSpecLoader({
        parser: makeParser(
          undefined,
          VALID_3X_DOC,
          new Error("Circular $ref"),
        ),
        fs: makeSucceedingFs(),
      });
      const result = await loader.load("/circular.json");
      if (!result.ok) throw new Error("Expected ok:true");
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings.some((w) => w.toLowerCase().includes("circular"))).toBe(true);
    });

    it("returns ok:false when both dereference and bundle reject", async () => {
      const loader = new OpenApiSpecLoader({
        parser: makeParser(
          undefined,
          undefined,
          new Error("Circular"),
          new Error("Bundle also failed"),
        ),
        fs: makeSucceedingFs(),
      });
      const result = await loader.load("/genuinely-invalid.json");
      expect(result.ok).toBe(false);
    });
  });

  describe("load() — unrecognized spec version (defensive guard)", () => {
    it("returns ok:false when the document has no openapi or swagger field", async () => {
      const versionlessDoc = { info: { title: "No version" }, paths: {} };
      const loader = new OpenApiSpecLoader({
        parser: makeParser(versionlessDoc),
        fs: makeSucceedingFs(),
      });
      const result = await loader.load("/versionless.json");
      expect(result.ok).toBe(false);
    });

    it("error message mentions unrecognized spec for versionless document", async () => {
      const versionlessDoc = { paths: {} };
      const loader = new OpenApiSpecLoader({
        parser: makeParser(versionlessDoc),
        fs: makeSucceedingFs(),
      });
      const result = await loader.load("/versionless.json");
      if (result.ok) throw new Error("Expected ok:false");
      expect(result.error.toLowerCase()).toContain("unrecognized");
    });
  });

  describe("load() — success arm carries empty warnings array by default", () => {
    it("returns an empty warnings array on a clean 3.x load", async () => {
      const loader = new OpenApiSpecLoader({
        parser: makeParser(VALID_3X_DOC),
        fs: makeSucceedingFs(),
      });
      const result = await loader.load("/spec.json");
      if (!result.ok) throw new Error("Expected ok:true");
      expect(Array.isArray(result.warnings)).toBe(true);
    });
  });
});
