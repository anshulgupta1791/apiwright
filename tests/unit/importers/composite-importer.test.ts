import { describe, expect, it } from "vitest";

import { CompositePostmanImporter } from "../../../src/importers/composite-importer.js";
import { PostmanImporter } from "../../../src/importers/postman/postman-importer.js";
import { NotImplementedError } from "../../../src/cli/errors.js";
import { ExitCode } from "../../../src/cli/exit-codes.js";
import type {
  Importer,
  ImportOutcome,
} from "../../../src/cli/seams/importer.js";
import type { ImporterFileSystem } from "../../../src/importers/types.js";

/**
 * Unit tests for CompositePostmanImporter.
 *
 * Covers: implements Importer interface, postman() delegates to PostmanImporter,
 * openapi() rejects with NotImplementedError naming Task #5, default-seam
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

  describe("openapi() — always rejects with NotImplementedError", () => {
    it("rejects with NotImplementedError when openapi() is called", async () => {
      const composite = new CompositePostmanImporter();
      await expect(
        composite.openapi({ source: "spec.yaml", outputDir: "/out" }),
      ).rejects.toThrow(NotImplementedError);
    });

    it("error names Task #5", async () => {
      const composite = new CompositePostmanImporter();
      let caught: unknown;
      try {
        await composite.openapi({ source: "spec.yaml", outputDir: "/out" });
      } catch (e) {
        caught = e;
      }
      expect((caught as NotImplementedError).message).toContain("Task #5");
    });

    it("error has ExitCode.NOT_IMPLEMENTED (5)", async () => {
      const composite = new CompositePostmanImporter();
      let caught: unknown;
      try {
        await composite.openapi({ source: "spec.yaml", outputDir: "/out" });
      } catch (e) {
        caught = e;
      }
      expect((caught as NotImplementedError).code).toBe(
        ExitCode.NOT_IMPLEMENTED,
      );
    });

    it("rejects even when a valid PostmanImporter is injected", async () => {
      const fakeImporter = {
        postman: async () => ({ written: 0, warnings: [] }),
      } as unknown as PostmanImporter;
      const composite = new CompositePostmanImporter({
        postmanImporter: fakeImporter,
      });
      await expect(
        composite.openapi({ source: "x", outputDir: "/out" }),
      ).rejects.toThrow(NotImplementedError);
    });
  });
});
