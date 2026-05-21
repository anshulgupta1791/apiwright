/**
 * Checkpoint H — Postman + OpenAPI importers (§1) end-to-end.
 *
 * Each importer is invoked via the CLI against a real fixture file
 * (committed under tests/e2e/in-house-validation/fixtures/). The
 * generated *.endpoint.json files are then validated against the
 * meta-schema and pattern-checked for shape correctness.
 *
 * Together with Checkpoint A (which runs validate ./tests), this
 * proves the full author-once / generate-many lifecycle:
 *   external spec  →  apiwright import  →  *.endpoint.json
 *                  →  apiwright validate  →  green
 *                  →  apiwright run       →  real HTTP
 */

import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runCli, sandboxPath } from "./in-house-validation/test-helpers.js";

describe("Checkpoint H — Postman + OpenAPI importers", () => {
  let outputDir: string;

  beforeEach(async () => {
    outputDir = join(tmpdir(), `apiwright-h-${Date.now()}-${Math.random()}`);
    await mkdir(outputDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(outputDir, { recursive: true, force: true });
  });

  it("imports a Postman v2.1 collection into validate-able *.endpoint.json files", async () => {
    await runCli("import", [
      "postman",
      sandboxPath("fixtures", "sample.postman_collection.json"),
      "--output", outputDir,
    ]);
    const entries = await readdir(outputDir, { recursive: true });
    const endpoints = entries.filter((e) => e.endsWith(".endpoint.json"));
    expect(endpoints.length).toBeGreaterThanOrEqual(3);

    // Each emitted file parses and has the required canonical shape.
    for (const rel of endpoints) {
      const content = await readFile(join(outputDir, rel), "utf8");
      const parsed = JSON.parse(content) as { id?: string; method?: string; url?: string };
      expect(parsed.id).toBeTypeOf("string");
      expect(parsed.method).toBeTypeOf("string");
      expect(parsed.url).toBeTypeOf("string");
    }

    // The framework's own validate accepts the imported files.
    await expect(runCli("validate", [outputDir])).resolves.toBeUndefined();
  });

  it("imports an OpenAPI 3.1 spec into validate-able *.endpoint.json files", async () => {
    await runCli("import", [
      "openapi",
      sandboxPath("fixtures", "sample.openapi.yaml"),
      "--output", outputDir,
    ]);
    const entries = await readdir(outputDir, { recursive: true });
    const endpoints = entries.filter((e) => e.endsWith(".endpoint.json"));
    expect(endpoints.length).toBeGreaterThanOrEqual(3);

    await expect(runCli("validate", [outputDir])).resolves.toBeUndefined();
  });
});
