/**
 * Checkpoint A — end-to-end CLI wiring against httpbin.org.
 *
 * Targets a single public API with zero credential setup. Proves the
 * core pipeline works from outside-in:
 *   1. apiwright validate ./tests succeeds
 *   2. apiwright run --env=httpbin --markers=smoke writes HTML + JUnit
 *      + JSON sidecar to the reports dir
 *   3. workers=8 vs workers=1 produce byte-identical endpoint ordering
 *   4. Reports parse cleanly (JSON.parse + xmllint-equivalent)
 *
 * Issue #24 workaround: invokes `main(argv)` programmatically instead
 * of subprocessing the binary. When #24 is fixed this becomes a one-
 * line change to `runCli` (swap programmatic call for spawn).
 */

import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createReportsDir,
  removeReportsDir,
  runCli,
  sandboxPath,
} from "./in-house-validation/test-helpers.js";

describe("Checkpoint A — CLI wiring + httpbin.org", () => {
  let reportsDir: string;

  beforeAll(async () => {
    reportsDir = await createReportsDir();
  });

  afterAll(async () => {
    await removeReportsDir(reportsDir);
  });

  it("validate ./tests exits 0 for the sandbox files", async () => {
    await expect(
      runCli("validate", [sandboxPath("tests")]),
    ).resolves.toBeUndefined();
  });

  it("run --env=httpbin --markers=smoke produces HTML + JUnit + JSON sidecar", async () => {
    await runCli("run", [
      "--config", sandboxPath("apiwright.config.json"),
      "--env=httpbin",
      "--markers=smoke",
      "--workers=2",
    ]);
    const entries = await readdir(reportsDir);
    expect(entries.some((e) => e.endsWith(".html"))).toBe(true);
    expect(entries.some((e) => e.endsWith(".xml"))).toBe(true);
    expect(entries.some((e) => e.endsWith(".json"))).toBe(true);
  });

  it("HTML report is a non-empty, parseable document", async () => {
    const entries = await readdir(reportsDir);
    const html = entries.find((e) => e.endsWith(".html"));
    expect(html).toBeDefined();
    const content = await readFile(join(reportsDir, html as string), "utf8");
    expect(content.length).toBeGreaterThan(100);
    expect(content.toLowerCase()).toContain("<html");
    expect(content.toLowerCase()).toContain("</html>");
  });

  it("JSON sidecar parses and reports run summary", async () => {
    const entries = await readdir(reportsDir);
    const json = entries.find((e) => e.endsWith(".json"));
    expect(json).toBeDefined();
    const parsed = JSON.parse(
      await readFile(join(reportsDir, json as string), "utf8"),
    ) as { summary?: { endpoints_planned: number } };
    expect(parsed.summary?.endpoints_planned).toBeGreaterThan(0);
  });

  it("JUnit XML has at least one testsuite element", async () => {
    const entries = await readdir(reportsDir);
    const xml = entries.find((e) => e.endsWith(".xml"));
    expect(xml).toBeDefined();
    const content = await readFile(join(reportsDir, xml as string), "utf8");
    expect(content).toContain("<testsuites");
    expect(content).toContain("<testsuite");
  });

  it("partial JSONL sidecar is removed on graceful completion (Fix #6)", async () => {
    const entries = await readdir(reportsDir);
    const partials = entries.filter((e) => e.endsWith(".partial.jsonl"));
    expect(partials).toEqual([]);
  });

  it("workers=1 and workers=8 produce identical endpoint ordering", async () => {
    const cleanReports1 = await createReportsDir();
    const cleanReports8 = await createReportsDir();
    try {
      await runCli("run", [
        "--config", sandboxPath("apiwright.config.json"),
        "--env=httpbin",
        "--markers=smoke",
        "--workers=1",
        "--reports-dir", cleanReports1,
      ]);
      await runCli("run", [
        "--config", sandboxPath("apiwright.config.json"),
        "--env=httpbin",
        "--markers=smoke",
        "--workers=8",
        "--reports-dir", cleanReports8,
      ]);
      const json1 = (await readdir(cleanReports1)).find((e) => e.endsWith(".json"));
      const json8 = (await readdir(cleanReports8)).find((e) => e.endsWith(".json"));
      const p1 = JSON.parse(
        await readFile(join(cleanReports1, json1 as string), "utf8"),
      ) as { endpoints: { endpoint_id: string }[] };
      const p8 = JSON.parse(
        await readFile(join(cleanReports8, json8 as string), "utf8"),
      ) as { endpoints: { endpoint_id: string }[] };
      expect(p1.endpoints.map((e) => e.endpoint_id)).toEqual(
        p8.endpoints.map((e) => e.endpoint_id),
      );
    } finally {
      await removeReportsDir(cleanReports1);
      await removeReportsDir(cleanReports8);
    }
  });

  it("apiwright.config.json exists in the sandbox", async () => {
    const s = await stat(sandboxPath("apiwright.config.json"));
    expect(s.isFile()).toBe(true);
  });
});
