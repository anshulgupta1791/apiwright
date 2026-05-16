import { describe, it, expect } from "vitest";

import { NotImplementedDocsGenerator } from "../../../../src/cli/seams/docs-generator.js";
import type {
  DocsGenerator,
  DocsOutcome,
} from "../../../../src/cli/seams/docs-generator.js";
import { NotImplementedError } from "../../../../src/cli/errors.js";
import { ExitCode } from "../../../../src/cli/exit-codes.js";

/**
 * Unit tests for the DocsGenerator seam.
 *
 * Verifies: NotImplementedDocsGenerator throws NotImplementedError naming
 * Task #11 with ExitCode.NOT_IMPLEMENTED when generate() is called.
 */
describe("NotImplementedDocsGenerator", () => {
  it("implements the DocsGenerator interface (has a generate method)", () => {
    const gen: DocsGenerator = new NotImplementedDocsGenerator();
    expect(typeof gen.generate).toBe("function");
  });

  it("throws NotImplementedError when generate() is called", async () => {
    const gen = new NotImplementedDocsGenerator();
    await expect(
      gen.generate({ sourceDir: "./tests", outputDir: "./docs" }),
    ).rejects.toThrow(NotImplementedError);
  });

  it("thrown error names Task #11 in the message", async () => {
    const gen = new NotImplementedDocsGenerator();
    let caught: unknown;
    try {
      await gen.generate({ sourceDir: "./tests", outputDir: "./docs" });
    } catch (e) {
      caught = e;
    }
    expect((caught as NotImplementedError).message).toContain("Task #11");
  });

  it("thrown error has ExitCode.NOT_IMPLEMENTED (5)", async () => {
    const gen = new NotImplementedDocsGenerator();
    let caught: unknown;
    try {
      await gen.generate({ sourceDir: "./tests", outputDir: "./docs" });
    } catch (e) {
      caught = e;
    }
    expect((caught as NotImplementedError).code).toBe(ExitCode.NOT_IMPLEMENTED);
  });

  it("thrown error message contains 'not yet implemented'", async () => {
    const gen = new NotImplementedDocsGenerator();
    let caught: unknown;
    try {
      await gen.generate({ sourceDir: "./tests", outputDir: "./docs" });
    } catch (e) {
      caught = e;
    }
    expect((caught as NotImplementedError).message.toLowerCase()).toContain(
      "not yet implemented",
    );
  });

  describe("DocsOutcome type — structural check via fake", () => {
    it("DocsGenerator interface can be implemented returning DocsOutcome", async () => {
      const fakeGen: DocsGenerator = {
        generate: async (): Promise<DocsOutcome> => ({ written: 12 }),
      };
      const out = await fakeGen.generate({
        sourceDir: "./tests",
        outputDir: "./docs",
      });
      expect(out.written).toBe(12);
    });
  });
});
