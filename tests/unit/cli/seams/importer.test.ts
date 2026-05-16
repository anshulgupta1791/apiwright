import { describe, it, expect } from "vitest";

import { NotImplementedImporter } from "../../../../src/cli/seams/importer.js";
import type {
  Importer,
  ImportOutcome,
} from "../../../../src/cli/seams/importer.js";
import { NotImplementedError } from "../../../../src/cli/errors.js";
import { ExitCode } from "../../../../src/cli/exit-codes.js";

/**
 * Unit tests for the Importer seam.
 *
 * Verifies: NotImplementedImporter throws NotImplementedError naming Task #4
 * for postman() and Task #5 for openapi(), both with ExitCode.NOT_IMPLEMENTED.
 */
describe("NotImplementedImporter", () => {
  describe("postman()", () => {
    it("implements the Importer interface (has postman and openapi methods)", () => {
      const imp: Importer = new NotImplementedImporter();
      expect(typeof imp.postman).toBe("function");
      expect(typeof imp.openapi).toBe("function");
    });

    it("throws NotImplementedError when postman() is called", async () => {
      const imp = new NotImplementedImporter();
      await expect(
        imp.postman({ file: "collection.json", outputDir: "./tests" }),
      ).rejects.toThrow(NotImplementedError);
    });

    it("thrown error from postman() names Task #4", async () => {
      const imp = new NotImplementedImporter();
      let caught: unknown;
      try {
        await imp.postman({ file: "x.json", outputDir: "./out" });
      } catch (e) {
        caught = e;
      }
      expect((caught as NotImplementedError).message).toContain("Task #4");
    });

    it("thrown error from postman() has ExitCode.NOT_IMPLEMENTED (5)", async () => {
      const imp = new NotImplementedImporter();
      let caught: unknown;
      try {
        await imp.postman({ file: "x.json", outputDir: "./out" });
      } catch (e) {
        caught = e;
      }
      expect((caught as NotImplementedError).code).toBe(
        ExitCode.NOT_IMPLEMENTED,
      );
    });

    it("thrown error from postman() message contains 'not yet implemented'", async () => {
      const imp = new NotImplementedImporter();
      let caught: unknown;
      try {
        await imp.postman({ file: "x.json", outputDir: "./out" });
      } catch (e) {
        caught = e;
      }
      expect((caught as NotImplementedError).message.toLowerCase()).toContain(
        "not yet implemented",
      );
    });
  });

  describe("openapi()", () => {
    it("throws NotImplementedError when openapi() is called", async () => {
      const imp = new NotImplementedImporter();
      await expect(
        imp.openapi({
          source: "https://example.com/openapi.json",
          outputDir: "./tests",
        }),
      ).rejects.toThrow(NotImplementedError);
    });

    it("thrown error from openapi() names Task #5", async () => {
      const imp = new NotImplementedImporter();
      let caught: unknown;
      try {
        await imp.openapi({ source: "openapi.yaml", outputDir: "./out" });
      } catch (e) {
        caught = e;
      }
      expect((caught as NotImplementedError).message).toContain("Task #5");
    });

    it("thrown error from openapi() has ExitCode.NOT_IMPLEMENTED (5)", async () => {
      const imp = new NotImplementedImporter();
      let caught: unknown;
      try {
        await imp.openapi({ source: "openapi.yaml", outputDir: "./out" });
      } catch (e) {
        caught = e;
      }
      expect((caught as NotImplementedError).code).toBe(
        ExitCode.NOT_IMPLEMENTED,
      );
    });
  });

  describe("ImportOutcome type — structural check via fake", () => {
    it("Importer interface can be implemented with a fake returning ImportOutcome", async () => {
      const fakeImporter: Importer = {
        postman: async (): Promise<ImportOutcome> => ({
          written: 5,
          warnings: [],
        }),
        openapi: async (): Promise<ImportOutcome> => ({
          written: 3,
          warnings: ["unparseable script"],
        }),
      };
      const postmanOut = await fakeImporter.postman({
        file: "x",
        outputDir: "y",
      });
      expect(postmanOut.written).toBe(5);
      expect(postmanOut.warnings).toEqual([]);
      const openapiOut = await fakeImporter.openapi({
        source: "z",
        outputDir: "y",
      });
      expect(openapiOut.written).toBe(3);
      expect(openapiOut.warnings).toHaveLength(1);
    });
  });
});
