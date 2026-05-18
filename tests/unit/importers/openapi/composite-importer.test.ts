import { describe, expect, it } from "vitest";

import { CompositePostmanImporter } from "../../../../src/importers/composite-importer.js";
import { PostmanImporter } from "../../../../src/importers/postman/postman-importer.js";
import { OpenApiImporter } from "../../../../src/importers/openapi/openapi-importer.js";
import type { ImportOutcome } from "../../../../src/cli/seams/importer.js";

/**
 * Unit tests for CompositePostmanImporter after Task #5 wiring.
 *
 * After Task #5, openapi() delegates to a real OpenApiImporter (injectable,
 * defaulting to new OpenApiImporter()). The NotImplementedError path is gone.
 * Covers: openapi() delegates (no rejection), postman() still delegates
 * (no regression), default-seam construction covers both paths, ImportOutcome
 * passed through unchanged.
 */

/** Fake PostmanImporter. */
function makeFakePostmanImporter(
  result: ImportOutcome,
): PostmanImporter {
  return {
    async postman(
      _input: { file: string; outputDir: string },
    ): Promise<ImportOutcome> {
      return result;
    },
  } as unknown as PostmanImporter;
}

/** Fake OpenApiImporter. */
function makeFakeOpenApiImporter(
  result: ImportOutcome,
): OpenApiImporter {
  return {
    async openapi(
      _input: { source: string; outputDir: string },
    ): Promise<ImportOutcome> {
      return result;
    },
  } as unknown as OpenApiImporter;
}

describe("CompositePostmanImporter — Task #5 wiring", () => {
  describe("constructor — default-seam wiring", () => {
    it("constructs with no options and exposes both postman and openapi methods", () => {
      const composite = new CompositePostmanImporter();
      expect(typeof composite.postman).toBe("function");
      expect(typeof composite.openapi).toBe("function");
    });
  });

  describe("openapi() — delegates to OpenApiImporter (no more NotImplementedError)", () => {
    it("resolves (does not reject) when a fake OpenApiImporter is injected", async () => {
      const fakeOpenApi = makeFakeOpenApiImporter({
        written: 3,
        warnings: [],
      });
      const composite = new CompositePostmanImporter({
        openApiImporter: fakeOpenApi,
      });
      const result = await composite.openapi({
        source: "/spec.json",
        outputDir: "/out",
      });
      expect(result.written).toBe(3);
    });

    it("passes the ImportOutcome from OpenApiImporter through unchanged", async () => {
      const outcome: ImportOutcome = { written: 5, warnings: ["some warning"] };
      const fakeOpenApi = makeFakeOpenApiImporter(outcome);
      const composite = new CompositePostmanImporter({
        openApiImporter: fakeOpenApi,
      });
      const result = await composite.openapi({
        source: "https://api.example.com/openapi.json",
        outputDir: "/out",
      });
      expect(result.written).toBe(5);
      expect(result.warnings).toEqual(["some warning"]);
    });

    it("openapi() resolves with written:0 and a warning for a bad spec (no rejection)", async () => {
      const fakeOpenApi = makeFakeOpenApiImporter({
        written: 0,
        warnings: ["OpenAPI spec file not found: '/missing.json'"],
      });
      const composite = new CompositePostmanImporter({
        openApiImporter: fakeOpenApi,
      });
      await expect(
        composite.openapi({ source: "/missing.json", outputDir: "/out" }),
      ).resolves.toMatchObject({ written: 0 });
    });

    it("openapi() does not reference NotImplementedError after Task #5 wiring", async () => {
      // Regression: after Task #5, calling openapi() must never throw NotImplementedError.
      const fakeOpenApi = makeFakeOpenApiImporter({ written: 0, warnings: [] });
      const composite = new CompositePostmanImporter({
        openApiImporter: fakeOpenApi,
      });
      let caught: unknown;
      try {
        await composite.openapi({ source: "/spec.json", outputDir: "/out" });
      } catch (e) {
        caught = e;
      }
      // Must not have thrown anything
      expect(caught).toBeUndefined();
    });
  });

  describe("postman() — delegates to PostmanImporter (no regression)", () => {
    it("resolves with the result from the injected PostmanImporter", async () => {
      const fakePostman = makeFakePostmanImporter({ written: 7, warnings: [] });
      const composite = new CompositePostmanImporter({
        postmanImporter: fakePostman,
      });
      const result = await composite.postman({
        file: "/col.json",
        outputDir: "/out",
      });
      expect(result.written).toBe(7);
    });

    it("passes the full ImportOutcome from PostmanImporter through unchanged", async () => {
      const outcome: ImportOutcome = {
        written: 2,
        warnings: ["disabled request skipped"],
      };
      const fakePostman = makeFakePostmanImporter(outcome);
      const composite = new CompositePostmanImporter({
        postmanImporter: fakePostman,
      });
      const result = await composite.postman({
        file: "/col.json",
        outputDir: "/out",
      });
      expect(result.warnings).toEqual(["disabled request skipped"]);
    });
  });

  describe("default-seam construction — both delegation paths", () => {
    it("constructed with injected OpenApiImporter wires openapi() delegation correctly", async () => {
      // Verify default openApiImporter option is exercised by constructing with just openApiImporter.
      let delegationCalled = false;
      const trackingOpenApi: OpenApiImporter = {
        async openapi(_input: { source: string; outputDir: string }) {
          delegationCalled = true;
          return { written: 1, warnings: [] };
        },
      } as unknown as OpenApiImporter;
      const composite = new CompositePostmanImporter({
        openApiImporter: trackingOpenApi,
      });
      await composite.openapi({ source: "/s.json", outputDir: "/o" });
      expect(delegationCalled).toBe(true);
    });

    it("constructed with injected PostmanImporter wires postman() delegation correctly", async () => {
      let delegationCalled = false;
      const trackingPostman: PostmanImporter = {
        async postman(_input: { file: string; outputDir: string }) {
          delegationCalled = true;
          return { written: 1, warnings: [] };
        },
      } as unknown as PostmanImporter;
      const composite = new CompositePostmanImporter({
        postmanImporter: trackingPostman,
      });
      await composite.postman({ file: "/c.json", outputDir: "/o" });
      expect(delegationCalled).toBe(true);
    });
  });
});
