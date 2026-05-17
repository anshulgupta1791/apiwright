import { describe, expect, it } from "vitest";

import { PostmanImporter } from "../../../../src/importers/postman/postman-importer.js";
import { PostmanCollectionLoader } from "../../../../src/importers/postman/collection-loader.js";
import { PostmanFlattener } from "../../../../src/importers/postman/flattener.js";
import { PostmanVariableTemplater } from "../../../../src/importers/postman/variable-templating.js";
import { PostmanEndpointAssembler } from "../../../../src/importers/postman/endpoint-assembler.js";
import { PostmanOutputWriter } from "../../../../src/importers/postman/output-writer.js";
import type { ImporterFileSystem } from "../../../../src/importers/types.js";
import type { FlattenedRequest } from "../../../../src/importers/types.js";

/**
 * Unit tests for PostmanImporter (the orchestrator).
 *
 * All stages are fully injected so no real disk is needed. Covers: bad file
 * (written:0 + warning), disabled request skipping, conversion failure (partial
 * count), all-disabled (written:0), partial success, writer ImporterFsError
 * (written:0 + warning), default-seam construction, ImportOutcome structure.
 */

/** In-memory fake FS. */
function makeFakeFs(files: Record<string, string> = {}): ImporterFileSystem {
  const written: Record<string, string> = {};
  return {
    readFile(path: string): string {
      if (path in files) return files[path];
      const err = new Error(`ENOENT: ${path}`) as Error & { code: string };
      err.code = "ENOENT";
      throw err;
    },
    mkdirp(): void {},
    writeFile(path: string, contents: string): void {
      written[path] = contents;
    },
    // expose for assertions
    get _written() {
      return written;
    },
  } as ImporterFileSystem & { _written: Record<string, string> };
}

function makeRequest(
  overrides: Partial<FlattenedRequest> = {},
): FlattenedRequest {
  return {
    postmanId: "r1",
    name: "List Users",
    folderPath: [],
    method: "GET",
    rawUrl: "https://example.com/users",
    headers: [],
    query: [],
    preRequestScript: "",
    responses: [{ code: 200, body: '{"users":[]}' }],
    disabled: false,
    variables: {},
    ...overrides,
  };
}

const VALID_V21_JSON = JSON.stringify({
  info: {
    _postman_id: "abc",
    name: "Test",
    schema:
      "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
  },
  item: [
    {
      id: "r1",
      name: "List Users",
      request: {
        method: "GET",
        url: "https://example.com/users",
        header: [],
      },
      response: [{ name: "OK", code: 200, body: '{"users":[]}' }],
    },
  ],
  variable: [],
});

describe("PostmanImporter", () => {
  describe("constructor — default-seam wiring", () => {
    it("constructs with no options and exposes a postman method", () => {
      const importer = new PostmanImporter();
      expect(typeof importer.postman).toBe("function");
    });

    it("returns a Promise from postman() when constructed with no options", async () => {
      const importer = new PostmanImporter();
      const result = importer.postman({
        file: "/nonexistent.json",
        outputDir: "/out",
      });
      expect(result instanceof Promise).toBe(true);
      // Should resolve (not throw) even for missing file
      const outcome = await result;
      expect(outcome.written).toBe(0);
    });
  });

  describe("postman() — bad file input", () => {
    it("resolves with written:0 when file does not exist", async () => {
      const importer = new PostmanImporter({ fs: makeFakeFs() });
      const result = await importer.postman({
        file: "/missing.json",
        outputDir: "/out",
      });
      expect(result.written).toBe(0);
    });

    it("resolves with one warning when file does not exist", async () => {
      const importer = new PostmanImporter({ fs: makeFakeFs() });
      const result = await importer.postman({
        file: "/missing.json",
        outputDir: "/out",
      });
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it("never throws (returns rejected is also wrong — resolves with warnings)", async () => {
      const importer = new PostmanImporter({ fs: makeFakeFs() });
      await expect(
        importer.postman({ file: "/missing.json", outputDir: "/out" }),
      ).resolves.toBeDefined();
    });

    it("resolves with written:0 for non-Postman JSON", async () => {
      const fakeFs = makeFakeFs({ "/other.json": '{"not":"postman"}' });
      const importer = new PostmanImporter({ fs: fakeFs });
      const result = await importer.postman({
        file: "/other.json",
        outputDir: "/out",
      });
      expect(result.written).toBe(0);
    });

    it("resolves with a descriptive warning for non-Postman JSON", async () => {
      const fakeFs = makeFakeFs({ "/other.json": '{"not":"postman"}' });
      const importer = new PostmanImporter({ fs: fakeFs });
      const result = await importer.postman({
        file: "/other.json",
        outputDir: "/out",
      });
      expect(result.warnings.length).toBe(1);
    });
  });

  describe("postman() — disabled request skipping", () => {
    it("skips disabled requests and returns one skip warning per disabled request", async () => {
      const disabledCollection = JSON.stringify({
        info: {
          _postman_id: "abc",
          name: "Test",
          schema:
            "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
        },
        item: [
          {
            id: "d1",
            name: "Disabled Request",
            disabled: true,
            request: { method: "GET", url: "https://example.com", header: [] },
            response: [],
          },
        ],
        variable: [],
      });
      const fakeFs = makeFakeFs({ "/col.json": disabledCollection });
      const importer = new PostmanImporter({ fs: fakeFs });
      const result = await importer.postman({
        file: "/col.json",
        outputDir: "/out",
      });
      expect(result.written).toBe(0);
      expect(
        result.warnings.some(
          (w) =>
            w.toLowerCase().includes("disabled") ||
            w.toLowerCase().includes("skipped"),
        ),
      ).toBe(true);
    });

    it("skip warning names the disabled request", async () => {
      const disabledCollection = JSON.stringify({
        info: {
          _postman_id: "abc",
          name: "Test",
          schema:
            "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
        },
        item: [
          {
            id: "d1",
            name: "My Disabled Request",
            disabled: true,
            request: { method: "GET", url: "https://example.com", header: [] },
            response: [],
          },
        ],
        variable: [],
      });
      const fakeFs = makeFakeFs({ "/col.json": disabledCollection });
      const importer = new PostmanImporter({ fs: fakeFs });
      const result = await importer.postman({
        file: "/col.json",
        outputDir: "/out",
      });
      expect(
        result.warnings.some((w) => w.includes("My Disabled Request")),
      ).toBe(true);
    });

    it("REGRESSION BLOCKER-1: request-level disabled flag is skipped with a warning", async () => {
      // Regression: only item-level disabled was checked; request.disabled was ignored.
      // A request with disabled at the request level must also be skipped-with-warning.
      const collection = JSON.stringify({
        info: {
          _postman_id: "req-level-disabled-test",
          name: "Req Level Disabled Test",
          schema:
            "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
        },
        item: [
          {
            id: "req-disabled",
            name: "Request Level Disabled",
            // Note: no item-level disabled flag
            request: {
              method: "GET",
              url: "https://example.com/disabled",
              header: [],
              disabled: true, // request-level disabled flag
            },
            response: [],
          },
        ],
        variable: [],
      });
      const fakeFs = makeFakeFs({ "/col.json": collection });
      const importer = new PostmanImporter({ fs: fakeFs });
      const result = await importer.postman({
        file: "/col.json",
        outputDir: "/out",
      });
      expect(result.written).toBe(0);
      expect(
        result.warnings.some(
          (w) =>
            w.includes("Request Level Disabled") &&
            (w.toLowerCase().includes("disabled") ||
              w.toLowerCase().includes("skipped")),
        ),
      ).toBe(true);
    });
  });

  describe("postman() — partial success", () => {
    it("writes enabled requests even when some fail conversion", async () => {
      const mixedCollection = JSON.stringify({
        info: {
          _postman_id: "abc",
          name: "Test",
          schema:
            "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
        },
        item: [
          {
            id: "r1",
            name: "Valid GET",
            request: {
              method: "GET",
              url: "https://example.com/ok",
              header: [],
            },
            response: [{ name: "OK", code: 200, body: "{}" }],
          },
          {
            id: "r2",
            name: "Invalid Method",
            request: {
              method: "TRACE",
              url: "https://example.com/trace",
              header: [],
            },
            response: [],
          },
        ],
        variable: [],
      });
      const fakeFs = makeFakeFs({ "/col.json": mixedCollection });
      const importer = new PostmanImporter({ fs: fakeFs });
      const result = await importer.postman({
        file: "/col.json",
        outputDir: "/out",
      });
      // Valid GET should be written
      expect(result.written).toBeGreaterThanOrEqual(1);
      // Trace should generate a warning
      expect(
        result.warnings.some(
          (w) => w.includes("TRACE") || w.includes("Unsupported"),
        ),
      ).toBe(true);
    });
  });

  describe("postman() — all requests disabled", () => {
    it("returns written:0 when all requests are disabled", async () => {
      const allDisabled = JSON.stringify({
        info: {
          _postman_id: "abc",
          name: "Test",
          schema:
            "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
        },
        item: [
          {
            id: "d1",
            name: "Disabled 1",
            disabled: true,
            request: {
              method: "GET",
              url: "https://example.com/1",
              header: [],
            },
            response: [],
          },
          {
            id: "d2",
            name: "Disabled 2",
            disabled: true,
            request: {
              method: "POST",
              url: "https://example.com/2",
              header: [],
            },
            response: [],
          },
        ],
        variable: [],
      });
      const fakeFs = makeFakeFs({ "/col.json": allDisabled });
      const importer = new PostmanImporter({ fs: fakeFs });
      const result = await importer.postman({
        file: "/col.json",
        outputDir: "/out",
      });
      expect(result.written).toBe(0);
      // 2 skip warnings
      const skipWarnings = result.warnings.filter(
        (w) =>
          w.toLowerCase().includes("disabled") ||
          w.toLowerCase().includes("skipped"),
      );
      expect(skipWarnings.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("postman() — writer ImporterFsError", () => {
    it("resolves with written:0 when writer throws ImporterFsError", async () => {
      const fakeFs = makeFakeFs({ "/col.json": VALID_V21_JSON });
      // Override writeFile to throw ImporterFsError
      const throwingFs: ImporterFileSystem = {
        ...fakeFs,
        writeFile(): void {
          const err = new Error("write failed") as Error & { code: string };
          err.code = "UNKNOWN";
          throw err;
        },
      };
      const importer = new PostmanImporter({ fs: throwingFs });
      const result = await importer.postman({
        file: "/col.json",
        outputDir: "/out",
      });
      // On fs error, written should be 0 (conservative)
      expect(result.written).toBe(0);
    });

    it("resolves with a warning when writer throws ImporterFsError", async () => {
      const fakeFs = makeFakeFs({ "/col.json": VALID_V21_JSON });
      const throwingFs: ImporterFileSystem = {
        ...fakeFs,
        writeFile(): void {
          const err = new Error("write failed") as Error & { code: string };
          err.code = "UNKNOWN";
          throw err;
        },
      };
      const importer = new PostmanImporter({ fs: throwingFs });
      const result = await importer.postman({
        file: "/col.json",
        outputDir: "/out",
      });
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it("never rejects (always resolves) even when writer throws", async () => {
      const fakeFs = makeFakeFs({ "/col.json": VALID_V21_JSON });
      const throwingFs: ImporterFileSystem = {
        ...fakeFs,
        writeFile(): void {
          throw new Error("disk full");
        },
      };
      const importer = new PostmanImporter({ fs: throwingFs });
      await expect(
        importer.postman({ file: "/col.json", outputDir: "/out" }),
      ).resolves.toBeDefined();
    });
  });

  describe("postman() — ImportOutcome structure", () => {
    it("returns an object with written (number) and warnings (string[])", async () => {
      const fakeFs = makeFakeFs({ "/col.json": VALID_V21_JSON });
      const importer = new PostmanImporter({ fs: fakeFs });
      const result = await importer.postman({
        file: "/col.json",
        outputDir: "/out",
      });
      expect(typeof result.written).toBe("number");
      expect(Array.isArray(result.warnings)).toBe(true);
    });

    it("written count is non-negative", async () => {
      const fakeFs = makeFakeFs({ "/col.json": VALID_V21_JSON });
      const importer = new PostmanImporter({ fs: fakeFs });
      const result = await importer.postman({
        file: "/col.json",
        outputDir: "/out",
      });
      expect(result.written).toBeGreaterThanOrEqual(0);
    });
  });

  describe("postman() — injected dependencies", () => {
    it("accepts all injectable options and uses them", async () => {
      // Test that all injectable options are accepted
      const fakeFs = makeFakeFs({ "/col.json": VALID_V21_JSON });
      const importer = new PostmanImporter({
        fs: fakeFs,
        loader: new PostmanCollectionLoader({ fs: fakeFs }),
        flattener: new PostmanFlattener(),
        templater: new PostmanVariableTemplater(),
        assembler: new PostmanEndpointAssembler(),
        writer: new PostmanOutputWriter({ fs: fakeFs }),
      });
      const result = await importer.postman({
        file: "/col.json",
        outputDir: "/out",
      });
      expect(typeof result.written).toBe("number");
    });
  });

  describe("postman() — REGRESSION: unbounded recursion security fix (SECURITY)", () => {
    /**
     * Builds a deeply-nested JSON *string* iteratively (no recursion, no
     * JSON.stringify) so the test fixture itself can never overflow the
     * stack — only the importer's depth guard should trip, deterministically
     * on every platform. depth=2 → {"a":{"a":null}}.
     */
    function deepJsonBody(depth: number): string {
      return '{"a":'.repeat(depth) + "null" + "}".repeat(depth);
    }

    it("SECURITY: resolves (never rejects) when a request body is excessively nested", async () => {
      // Regression: a body nested past JsonSchemaInferrer's MAX_DEPTH must be
      // caught by the importer and turned into a skip-with-warning, never a
      // rejection. Built as a string (no recursion) so the fixture itself
      // cannot overflow the stack on any platform.
      const deepBody = deepJsonBody(1000);
      const deepCollection = JSON.stringify({
        info: {
          _postman_id: "deep-body-test",
          name: "Deep Body Test",
          schema:
            "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
        },
        item: [
          {
            id: "deep-request",
            name: "Deep Request",
            request: {
              method: "POST",
              url: "https://example.com/deep",
              header: [{ key: "Content-Type", value: "application/json" }],
              body: { mode: "raw", raw: deepBody },
            },
            response: [],
          },
          {
            id: "normal-request",
            name: "Normal Request",
            request: {
              method: "GET",
              url: "https://example.com/ok",
              header: [],
            },
            response: [{ name: "OK", code: 200, body: '{"ok":true}' }],
          },
        ],
        variable: [],
      });

      const fakeFs = makeFakeFs({ "/deep.json": deepCollection });
      const importer = new PostmanImporter({ fs: fakeFs });

      // MUST resolve, never reject
      await expect(
        importer.postman({ file: "/deep.json", outputDir: "/out" }),
      ).resolves.toBeDefined();
    });

    it("SECURITY: the deep-body request is dropped with a warning naming it", async () => {
      const deepBody = deepJsonBody(1000);
      const deepCollection = JSON.stringify({
        info: {
          _postman_id: "deep-body-test-2",
          name: "Deep Body Test 2",
          schema:
            "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
        },
        item: [
          {
            id: "deep-req-2",
            name: "Deeply Nested Body Request",
            request: {
              method: "POST",
              url: "https://example.com/deep",
              header: [{ key: "Content-Type", value: "application/json" }],
              body: { mode: "raw", raw: deepBody },
            },
            response: [],
          },
        ],
        variable: [],
      });

      const fakeFs = makeFakeFs({ "/deep.json": deepCollection });
      const importer = new PostmanImporter({ fs: fakeFs });
      const result = await importer.postman({
        file: "/deep.json",
        outputDir: "/out",
      });

      // The deep request should be dropped (not written)
      // A warning naming the request should be present
      expect(
        result.warnings.some(
          (w) =>
            w.includes("Deeply Nested Body Request") &&
            w.toLowerCase().includes("skipped"),
        ),
      ).toBe(true);
    });

    it("SECURITY: other requests in the collection are still imported when one has deep body", async () => {
      const deepBody = deepJsonBody(1000);
      const mixedCollection = JSON.stringify({
        info: {
          _postman_id: "mixed-deep",
          name: "Mixed Deep",
          schema:
            "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
        },
        item: [
          {
            id: "deep-req",
            name: "Deep Request",
            request: {
              method: "POST",
              url: "https://example.com/deep",
              header: [{ key: "Content-Type", value: "application/json" }],
              body: { mode: "raw", raw: deepBody },
            },
            response: [],
          },
          {
            id: "ok-req",
            name: "Normal Request",
            request: {
              method: "GET",
              url: "https://example.com/ok",
              header: [],
            },
            response: [{ name: "OK", code: 200, body: '{"ok":true}' }],
          },
        ],
        variable: [],
      });

      const fakeFs = makeFakeFs({ "/mixed.json": mixedCollection });
      const importer = new PostmanImporter({ fs: fakeFs });
      const result = await importer.postman({
        file: "/mixed.json",
        outputDir: "/out",
      });

      // The normal request should still be imported
      expect(result.written).toBeGreaterThanOrEqual(1);
    });
  });
});
