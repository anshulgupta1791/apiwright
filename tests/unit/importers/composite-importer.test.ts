import { describe, expect, it } from "vitest";

import { CompositePostmanImporter } from "../../../src/importers/composite-importer.js";
import { OpenApiImporter } from "../../../src/importers/openapi/openapi-importer.js";
import { PostmanImporter } from "../../../src/importers/postman/postman-importer.js";
import type {
  Importer,
  ImportOutcome,
} from "../../../src/cli/seams/importer.js";
import type { ImporterFileSystem } from "../../../src/importers/types.js";

/**
 * Unit tests for CompositePostmanImporter.
 *
 * Covers: implements Importer interface, postman() delegates to PostmanImporter,
 * openapi() delegates to OpenApiImporter (Task #5), default-seam
 * constructor wiring (no injected PostmanImporter), ImportOutcome passthrough.
 */

function makeFakeFs(files: Record<string, string> = {}): ImporterFileSystem {
  return {
    readFile(path: string): string {
      if (path in files) return files[path];
      const err = new Error(`ENOENT: ${path}`) as Error & { code: string };
      err.code = "ENOENT";
      throw err;
    },
    mkdirp(): void {},
    writeFile(): void {},
  };
}

describe("CompositePostmanImporter", () => {
  describe("interface conformance", () => {
    it("satisfies the Importer interface (has postman and openapi methods)", () => {
      const composite: Importer = new CompositePostmanImporter();
      expect(typeof composite.postman).toBe("function");
      expect(typeof composite.openapi).toBe("function");
    });
  });

  describe("constructor — default-seam wiring", () => {
    it("constructs with no options", () => {
      expect(() => new CompositePostmanImporter()).not.toThrow();
    });

    it("default-seam delegates to PostmanImporter (resolves for missing file with written:0)", async () => {
      // With no injected importer, the default PostmanImporter should be used
      const composite = new CompositePostmanImporter();
      const result = await composite.postman({
        file: "/definitely-missing.json",
        outputDir: "/tmp/out",
      });
      // Default PostmanImporter resolves written:0 for missing file
      expect(result.written).toBe(0);
    });
  });

  describe("postman() — delegation", () => {
    it("delegates to the injected PostmanImporter and passes through the outcome", async () => {
      const fakeOutcome: ImportOutcome = {
        written: 3,
        warnings: ["test warning"],
      };
      const fakeImporter = {
        postman: async () => fakeOutcome,
      } as unknown as PostmanImporter;
      const composite = new CompositePostmanImporter({
        postmanImporter: fakeImporter,
      });
      const result = await composite.postman({
        file: "/col.json",
        outputDir: "/out",
      });
      expect(result).toEqual(fakeOutcome);
    });

    it("passes input.file and input.outputDir to the underlying PostmanImporter", async () => {
      let capturedInput: { file: string; outputDir: string } | undefined;
      const fakeImporter = {
        postman: async (input: { file: string; outputDir: string }) => {
          capturedInput = input;
          return { written: 0, warnings: [] };
        },
      } as unknown as PostmanImporter;
      const composite = new CompositePostmanImporter({
        postmanImporter: fakeImporter,
      });
      await composite.postman({
        file: "/my/collection.json",
        outputDir: "/my/output",
      });
      expect(capturedInput?.file).toBe("/my/collection.json");
      expect(capturedInput?.outputDir).toBe("/my/output");
    });

    it("passes through warnings unchanged from the underlying importer", async () => {
      const warnings = ["script outside allowlist", "disabled request skipped"];
      const fakeImporter = {
        postman: async () => ({ written: 2, warnings }),
      } as unknown as PostmanImporter;
      const composite = new CompositePostmanImporter({
        postmanImporter: fakeImporter,
      });
      const result = await composite.postman({
        file: "/col.json",
        outputDir: "/out",
      });
      expect(result.warnings).toEqual(warnings);
    });
  });

  describe("openapi() — delegates to OpenApiImporter (Task #5 implemented)", () => {
    it("resolves (does not reject) when openapi() is called", async () => {
      const fakeFs = makeFakeFs();
      const composite = new CompositePostmanImporter({
        openApiImporter: new OpenApiImporter({ fs: fakeFs }),
      });
      await expect(
        composite.openapi({ source: "/non-existent.yaml", outputDir: "/out" }),
      ).resolves.toBeDefined();
    });

    it("delegates to the injected OpenApiImporter and passes through the outcome", async () => {
      const fakeOutcome: ImportOutcome = {
        written: 5,
        warnings: ["openapi warning"],
      };
      const fakeImporter = {
        openapi: async () => fakeOutcome,
      } as unknown as OpenApiImporter;
      const composite = new CompositePostmanImporter({
        openApiImporter: fakeImporter,
      });
      const result = await composite.openapi({
        source: "/spec.yaml",
        outputDir: "/out",
      });
      expect(result).toEqual(fakeOutcome);
    });

    it("passes input.source and input.outputDir to the underlying OpenApiImporter", async () => {
      let capturedInput: { source: string; outputDir: string } | undefined;
      const fakeImporter = {
        openapi: async (input: { source: string; outputDir: string }) => {
          capturedInput = input;
          return { written: 0, warnings: [] };
        },
      } as unknown as OpenApiImporter;
      const composite = new CompositePostmanImporter({
        openApiImporter: fakeImporter,
      });
      await composite.openapi({
        source: "/my/spec.yaml",
        outputDir: "/my/output",
      });
      expect(capturedInput?.source).toBe("/my/spec.yaml");
      expect(capturedInput?.outputDir).toBe("/my/output");
    });

    it("passes through warnings unchanged from the underlying OpenApiImporter", async () => {
      const warnings = ["circular ref bundled", "unmapped security scheme"];
      const fakeImporter = {
        openapi: async () => ({ written: 2, warnings }),
      } as unknown as OpenApiImporter;
      const composite = new CompositePostmanImporter({
        openApiImporter: fakeImporter,
      });
      const result = await composite.openapi({
        source: "/spec.yaml",
        outputDir: "/out",
      });
      expect(result.warnings).toEqual(warnings);
    });
  });
});
