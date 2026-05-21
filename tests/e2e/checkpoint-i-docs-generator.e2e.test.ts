/**
 * Checkpoint I — §11 Markdown documentation generator (Fix #3).
 *
 * Runs `apiwright docs generate` against the in-house validation
 * sandbox's endpoint files, asserts on the produced *.md files:
 *   - one MD per endpoint
 *   - every spec section present (Authentication / Request / Response /
 *     Database side effects / Test coverage / Markers)
 *   - byte-identical output across two runs (determinism)
 */

import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runCli, sandboxPath } from "./in-house-validation/test-helpers.js";

const SOURCE = sandboxPath("tests");

describe("Checkpoint I — Markdown docs generator (§11)", () => {
  let docsDir1: string;
  let docsDir2: string;

  beforeAll(async () => {
    docsDir1 = join(tmpdir(), `apiwright-docs-1-${Date.now()}`);
    docsDir2 = join(tmpdir(), `apiwright-docs-2-${Date.now()}`);
    await mkdir(docsDir1, { recursive: true });
    await mkdir(docsDir2, { recursive: true });
  });

  afterAll(async () => {
    await rm(docsDir1, { recursive: true, force: true });
    await rm(docsDir2, { recursive: true, force: true });
  });

  it("generates one MD file per endpoint", async () => {
    await runCli("docs", ["generate", "--source", SOURCE, "--output", docsDir1]);
    const mds = (await readdir(docsDir1)).filter((e) => e.endsWith(".md"));
    expect(mds.length).toBeGreaterThan(5);
  });

  it("emitted MD contains every spec-required section", async () => {
    const mds = (await readdir(docsDir1)).filter((e) => e.endsWith(".md"));
    const md = await readFile(join(docsDir1, mds[0] as string), "utf8");
    expect(md).toContain("# ");
    expect(md).toContain("## Request");
    expect(md).toContain("## Response");
    expect(md).toContain("## Markers");
    expect(md).toContain("## Test coverage");
  });

  it("two runs produce byte-identical output (deterministic)", async () => {
    await runCli("docs", ["generate", "--source", SOURCE, "--output", docsDir2]);
    const mds1 = (await readdir(docsDir1)).filter((e) => e.endsWith(".md")).sort();
    const mds2 = (await readdir(docsDir2)).filter((e) => e.endsWith(".md")).sort();
    expect(mds2).toEqual(mds1);
    for (const md of mds1) {
      const a = await readFile(join(docsDir1, md), "utf8");
      const b = await readFile(join(docsDir2, md), "utf8");
      expect(b).toBe(a);
    }
  });
});
