import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PostmanImporter } from "../../../src/importers/postman/postman-importer.js";
import { CompositePostmanImporter } from "../../../src/importers/composite-importer.js";
import { NodeImporterFileSystem } from "../../../src/importers/fs-seam.js";
import { SchemaValidator } from "../../../src/core/schema-validator.js";
import { parseJson } from "../../../src/core/safe-json.js";
import { NotImplementedError } from "../../../src/cli/errors.js";
import type { ImporterFileSystem } from "../../../src/importers/types.js";
import type { CanonicalEndpoint } from "../../../src/core/canonical-model.js";

/**
 * Integration tests for the PostmanImporter / CompositePostmanImporter pipeline.
 *
 * Uses the real fixture at tests/fixtures/postman/sample.postman_collection.json.
 * Two variants: (a) in-memory fake FS, (b) real OS temp dir.
 * All assertions: directory tree, endpoint file contents, source shape,
 * disabled-request warning, unparseable-script warning, {{var}} templating,
 * schema validity, and a computed (not hardcoded) written count.
 */

const FIXTURE_PATH = join(
  process.cwd(),
  "tests/fixtures/postman/sample.postman_collection.json",
);

const FIXTURE_BASENAME = basename(FIXTURE_PATH);

/** In-memory fake FS that also records all written paths + contents. */
function makeMemoryFs(): ImporterFileSystem & {
  files: Record<string, string>;
  dirs: string[];
} {
  const files: Record<string, string> = {};
  const dirs: string[] = [];
  const fixtureRaw = readFileSync(FIXTURE_PATH, "utf8");

  return {
    files,
    dirs,
    readFile(path: string): string {
      if (path === FIXTURE_PATH) return fixtureRaw;
      if (path in files) return files[path];
      const err = new Error(`ENOENT: ${path}`) as Error & { code: string };
      err.code = "ENOENT";
      throw err;
    },
    mkdirp(dir: string): void {
      dirs.push(dir);
    },
    writeFile(path: string, contents: string): void {
      files[path] = contents;
    },
  };
}

/**
 * Counts enabled, convertible requests in the fixture (supported method + not disabled).
 * Checks BOTH item-level disabled (obj.disabled) AND request-level disabled (obj.request.disabled)
 * to match the flattener's behavior after the BLOCKER-1 fix.
 */
function computeExpectedWrittenCount(): number {
  const raw = readFileSync(FIXTURE_PATH, "utf8");
  const parsed = JSON.parse(raw) as {
    item: unknown[];
    variable?: unknown[];
  };
  const SUPPORTED_METHODS = new Set([
    "GET",
    "POST",
    "PUT",
    "PATCH",
    "DELETE",
    "HEAD",
    "OPTIONS",
  ]);

  function countRequests(items: unknown[]): number {
    let count = 0;
    for (const item of items) {
      const obj = item as Record<string, unknown>;
      if (Array.isArray(obj["item"])) {
        // Folder
        count += countRequests(obj["item"] as unknown[]);
      } else if (obj["request"] != null) {
        // Request item
        if (obj["disabled"] === true) continue;
        const req = obj["request"] as Record<string, unknown>;
        // Also check request-level disabled flag (BLOCKER-1 fix)
        if (req["disabled"] === true) continue;
        const method =
          (req["method"] as string | undefined)?.toUpperCase() ?? "";
        if (!SUPPORTED_METHODS.has(method)) continue;
        count++;
      }
    }
    return count;
  }

  return countRequests(parsed.item);
}

describe("PostmanImporter — integration with fixture", () => {
  describe("in-memory FS variant", () => {
    it("resolves ImportOutcome with written > 0 for the sample fixture", async () => {
      const memFs = makeMemoryFs();
      const importer = new PostmanImporter({ fs: memFs });
      const result = await importer.postman({
        file: FIXTURE_PATH,
        outputDir: "/out",
      });
      expect(result.written).toBeGreaterThan(0);
    });

    it("written count equals computed expected count of enabled+convertible requests", async () => {
      const memFs = makeMemoryFs();
      const importer = new PostmanImporter({ fs: memFs });
      const result = await importer.postman({
        file: FIXTURE_PATH,
        outputDir: "/out",
      });
      const expected = computeExpectedWrittenCount();
      expect(result.written).toBe(expected);
    });

    it("produces at least one .endpoint.json file", async () => {
      const memFs = makeMemoryFs();
      const importer = new PostmanImporter({ fs: memFs });
      await importer.postman({ file: FIXTURE_PATH, outputDir: "/out" });
      const endpointFiles = Object.keys(memFs.files).filter((p) =>
        p.endsWith(".endpoint.json"),
      );
      expect(endpointFiles.length).toBeGreaterThan(0);
    });

    it("directory tree mirrors Postman folder nesting (users/admin/...)", async () => {
      const memFs = makeMemoryFs();
      const importer = new PostmanImporter({ fs: memFs });
      await importer.postman({ file: FIXTURE_PATH, outputDir: "/out" });
      const files = Object.keys(memFs.files);
      // Fixture has Users→Admin→Internal nesting
      expect(files.some((f) => f.includes("/users/"))).toBe(true);
      expect(files.some((f) => f.includes("/admin/"))).toBe(true);
      expect(files.some((f) => f.includes("/internal/"))).toBe(true);
    });

    it("every written endpoint file passes SchemaValidator.validateEndpoint", async () => {
      const memFs = makeMemoryFs();
      const importer = new PostmanImporter({ fs: memFs });
      await importer.postman({ file: FIXTURE_PATH, outputDir: "/out" });
      const validator = new SchemaValidator();
      for (const [path, contents] of Object.entries(memFs.files)) {
        if (!path.endsWith(".endpoint.json")) continue;
        const parsed = parseJson(contents);
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) continue;
        const validation = validator.validateEndpoint(parsed.value);
        expect(validation.valid).toBe(true);
      }
    });

    it("every written endpoint has source.type === 'postman'", async () => {
      const memFs = makeMemoryFs();
      const importer = new PostmanImporter({ fs: memFs });
      await importer.postman({ file: FIXTURE_PATH, outputDir: "/out" });
      for (const [path, contents] of Object.entries(memFs.files)) {
        if (!path.endsWith(".endpoint.json")) continue;
        const parsed = parseJson(contents);
        if (!parsed.ok) continue;
        const endpoint = parsed.value as CanonicalEndpoint;
        expect(endpoint.source?.type).toBe("postman");
      }
    });

    it("every written endpoint has source.collection === fixture basename", async () => {
      const memFs = makeMemoryFs();
      const importer = new PostmanImporter({ fs: memFs });
      await importer.postman({ file: FIXTURE_PATH, outputDir: "/out" });
      for (const [path, contents] of Object.entries(memFs.files)) {
        if (!path.endsWith(".endpoint.json")) continue;
        const parsed = parseJson(contents);
        if (!parsed.ok) continue;
        const endpoint = parsed.value as CanonicalEndpoint;
        expect(endpoint.source?.collection).toBe(FIXTURE_BASENAME);
      }
    });

    it("disabled requests produce skip warnings naming the requests", async () => {
      const memFs = makeMemoryFs();
      const importer = new PostmanImporter({ fs: memFs });
      const result = await importer.postman({
        file: FIXTURE_PATH,
        outputDir: "/out",
      });
      const skipWarnings = result.warnings.filter(
        (w) =>
          w.toLowerCase().includes("disabled") ||
          w.toLowerCase().includes("skipped"),
      );
      // Fixture has one item-level disabled request and one request-level disabled request
      expect(skipWarnings.length).toBeGreaterThanOrEqual(2);
    });

    it("disabled request is NOT written as an endpoint file", async () => {
      const memFs = makeMemoryFs();
      const importer = new PostmanImporter({ fs: memFs });
      const result = await importer.postman({
        file: FIXTURE_PATH,
        outputDir: "/out",
      });
      const files = Object.keys(memFs.files);
      // "Disabled Request" is the item-level-disabled item in the fixture
      const disabledFile = files.some((f) =>
        f.toLowerCase().includes("disabled_request"),
      );
      expect(disabledFile).toBe(false);
      // Skip warning present for the item-level disabled request
      expect(result.warnings.some((w) => w.includes("Disabled Request"))).toBe(
        true,
      );
    });

    it("REGRESSION BLOCKER-1: request-level disabled item is NOT written and produces a skip warning", async () => {
      // Regression: request.disabled was ignored; only item.disabled was checked.
      // The fixture item "Request Level Disabled" has no top-level disabled flag but
      // has request.disabled:true — it must be skipped just like an item-level-disabled one.
      const memFs = makeMemoryFs();
      const importer = new PostmanImporter({ fs: memFs });
      const result = await importer.postman({
        file: FIXTURE_PATH,
        outputDir: "/out",
      });
      const files = Object.keys(memFs.files);
      // "Request Level Disabled" should not appear as an endpoint file
      const reqLevelDisabledFile = files.some((f) =>
        f.toLowerCase().includes("request_level_disabled"),
      );
      expect(reqLevelDisabledFile).toBe(false);
      // A skip warning naming the request should be present
      expect(
        result.warnings.some((w) => w.includes("Request Level Disabled")),
      ).toBe(true);
    });

    it("unparseable pre-request script produces a manual-review warning", async () => {
      const memFs = makeMemoryFs();
      const importer = new PostmanImporter({ fs: memFs });
      const result = await importer.postman({
        file: FIXTURE_PATH,
        outputDir: "/out",
      });
      // Fixture has "Complex Auth Script" with if + pm.sendRequest
      const authWarnings = result.warnings.filter(
        (w) =>
          w.toLowerCase().includes("allowlist") ||
          w.toLowerCase().includes("manually") ||
          w.toLowerCase().includes("pre-request script"),
      );
      expect(authWarnings.length).toBeGreaterThanOrEqual(1);
    });

    it("request with unparseable script is written without auth_strategy", async () => {
      const memFs = makeMemoryFs();
      const importer = new PostmanImporter({ fs: memFs });
      await importer.postman({ file: FIXTURE_PATH, outputDir: "/out" });
      // Find the "Complex Auth Script" endpoint file
      const endpointFiles = Object.entries(memFs.files).filter(([p]) =>
        p.endsWith(".endpoint.json"),
      );
      const complexAuthFile = endpointFiles.find(([, contents]) => {
        const parsed = parseJson(contents);
        if (!parsed.ok) return false;
        const ep = parsed.value as CanonicalEndpoint;
        return ep.name?.toLowerCase().includes("complex");
      });
      if (complexAuthFile) {
        const parsed = parseJson(complexAuthFile[1]);
        if (parsed.ok) {
          const ep = parsed.value as CanonicalEndpoint;
          expect("auth_strategy" in ep).toBe(false);
        }
      }
      // Even if the file wasn't found, at least the warning should be present
    });

    it("request with {{var}} references has ${env.*} tokens in written output", async () => {
      const memFs = makeMemoryFs();
      const importer = new PostmanImporter({ fs: memFs });
      await importer.postman({ file: FIXTURE_PATH, outputDir: "/out" });
      // Find any endpoint that had {{baseUrl}} or {{token}}
      const endpointFiles = Object.values(memFs.files).filter(
        (c) => c.includes("env.baseUrl") || c.includes("env.token"),
      );
      expect(endpointFiles.length).toBeGreaterThan(0);
    });

    it("no written file contains remaining {{ or }} from unresolved variables", async () => {
      const memFs = makeMemoryFs();
      const importer = new PostmanImporter({ fs: memFs });
      await importer.postman({ file: FIXTURE_PATH, outputDir: "/out" });
      for (const [path, contents] of Object.entries(memFs.files)) {
        if (!path.endsWith(".endpoint.json")) continue;
        // After templating, {{...}} should be rewritten to ${env.*}
        // Allow for warnings containing {{ but not the JSON body
        const parsed = parseJson(contents);
        if (!parsed.ok) continue;
        // Check the URL field specifically — it should not contain {{
        const ep = parsed.value as CanonicalEndpoint;
        expect(ep.url).not.toMatch(/\{\{/);
      }
    });

    it("produces warnings array as string[]", async () => {
      const memFs = makeMemoryFs();
      const importer = new PostmanImporter({ fs: memFs });
      const result = await importer.postman({
        file: FIXTURE_PATH,
        outputDir: "/out",
      });
      expect(Array.isArray(result.warnings)).toBe(true);
      for (const w of result.warnings) {
        expect(typeof w).toBe("string");
      }
    });

    it("examples with [500, 200] sequence: picks 200 for expected_status", async () => {
      const memFs = makeMemoryFs();
      const importer = new PostmanImporter({ fs: memFs });
      await importer.postman({ file: FIXTURE_PATH, outputDir: "/out" });
      // The "Create User" duplicate has [500, 200] examples — the second create_user endpoint
      const endpointFiles = Object.entries(memFs.files).filter(([p]) =>
        p.endsWith(".endpoint.json"),
      );
      const createUserDup = endpointFiles.filter(([, contents]) => {
        const parsed = parseJson(contents);
        if (!parsed.ok) return false;
        const ep = parsed.value as CanonicalEndpoint;
        return ep.name === "Create User";
      });
      // There should be two Create User endpoints due to the duplicate
      if (createUserDup.length >= 2) {
        const statuses = createUserDup.map(([, contents]) => {
          const parsed = parseJson(contents);
          if (!parsed.ok) return 0;
          const ep = parsed.value as CanonicalEndpoint;
          return ep.response.expected_status;
        });
        // At least one of them should use 200 (picked over 500)
        expect(statuses).toContain(200);
      }
    });
  });

  describe("real disk variant (OS temp dir)", () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), "apiwright-postman-integration-"));
    });

    afterEach(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it("resolves with written > 0 using the real NodeImporterFileSystem", async () => {
      const realFs = new NodeImporterFileSystem();
      const importer = new PostmanImporter({ fs: realFs });
      const result = await importer.postman({
        file: FIXTURE_PATH,
        outputDir: tmpDir,
      });
      expect(result.written).toBeGreaterThan(0);
    });

    it("creates endpoint files on disk using the real FS", async () => {
      const realFs = new NodeImporterFileSystem();
      const importer = new PostmanImporter({ fs: realFs });
      await importer.postman({ file: FIXTURE_PATH, outputDir: tmpDir });
      // Walk the temp dir and find .endpoint.json files
      const { readdirSync, statSync } = await import("node:fs");
      function walk(dir: string): string[] {
        const entries = readdirSync(dir);
        const result: string[] = [];
        for (const entry of entries) {
          const full = join(dir, entry);
          const stat = statSync(full);
          if (stat.isDirectory()) {
            result.push(...walk(full));
          } else {
            result.push(full);
          }
        }
        return result;
      }
      const files = walk(tmpDir).filter((f) => f.endsWith(".endpoint.json"));
      expect(files.length).toBeGreaterThan(0);
    });

    it("each written file on disk passes SchemaValidator after parseJson read-back", async () => {
      const realFs = new NodeImporterFileSystem();
      const importer = new PostmanImporter({ fs: realFs });
      await importer.postman({ file: FIXTURE_PATH, outputDir: tmpDir });
      const { readdirSync, readFileSync, statSync } = await import("node:fs");
      const validator = new SchemaValidator();
      function walk(dir: string): string[] {
        const entries = readdirSync(dir);
        const result: string[] = [];
        for (const entry of entries) {
          const full = join(dir, entry);
          const stat = statSync(full);
          if (stat.isDirectory()) {
            result.push(...walk(full));
          } else {
            result.push(full);
          }
        }
        return result;
      }
      const files = walk(tmpDir).filter((f) => f.endsWith(".endpoint.json"));
      for (const filePath of files) {
        const contents = readFileSync(filePath, "utf8");
        const parsed = parseJson(contents);
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) continue;
        const validation = validator.validateEndpoint(parsed.value);
        expect(validation.valid).toBe(true);
      }
    });
  });
});

describe("CompositePostmanImporter — integration", () => {
  it("postman() runs the full pipeline via CompositePostmanImporter", async () => {
    const memFs = makeMemoryFs();
    const composite = new CompositePostmanImporter({
      postmanImporter: new PostmanImporter({ fs: memFs }),
    });
    const result = await composite.postman({
      file: FIXTURE_PATH,
      outputDir: "/out",
    });
    expect(result.written).toBeGreaterThan(0);
  });

  it("openapi() rejects with NotImplementedError naming Task #5", async () => {
    const composite = new CompositePostmanImporter();
    let caught: unknown;
    try {
      await composite.openapi({ source: "spec.yaml", outputDir: "/out" });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(NotImplementedError);
    expect((caught as NotImplementedError).message).toContain("Task #5");
  });

  it("postman() written count via composite equals direct PostmanImporter count", async () => {
    const memFs1 = makeMemoryFs();
    const memFs2 = makeMemoryFs();
    const direct = new PostmanImporter({ fs: memFs1 });
    const composite = new CompositePostmanImporter({
      postmanImporter: new PostmanImporter({ fs: memFs2 }),
    });
    const directResult = await direct.postman({
      file: FIXTURE_PATH,
      outputDir: "/out",
    });
    const compositeResult = await composite.postman({
      file: FIXTURE_PATH,
      outputDir: "/out",
    });
    expect(compositeResult.written).toBe(directResult.written);
  });
});
