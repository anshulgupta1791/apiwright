/**
 * Regression guard for issue #61 — the exit-codes tables in docs/cli.md
 * must list every value of the ExitCode enum (and not contain stale
 * "intentionally unused" claims). Without this, the docs silently drift
 * the moment a new ExitCode value ships.
 *
 * WHY THIS TEST EXISTS:
 *   The §2 audit retro (Lens 6: Documentation drift) found 4 BLOCKERs
 *   in docs/cli.md, including "exit code 1 is intentionally unused"
 *   that contradicted PR #45 (run exits 1 on failure). The 95%-coverage
 *   unit suite caught zero of those — there was no test asserting that
 *   the docs match the enum. This test fills that gap.
 *
 *   This is NOT a Lens 6 substitute (only the human reading the prose
 *   can confirm wording is correct). It IS a backstop for the worst
 *   class — exit code documented vs. enum value drift.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ExitCode } from "../../../src/cli/exit-codes.js";

const CLI_DOCS_PATH = join(process.cwd(), "docs", "cli.md");
const CLI_DOCS = readFileSync(CLI_DOCS_PATH, "utf8");

describe("docs/cli.md exit-codes table — regression guard for issue #61", () => {
  it("documents every ExitCode enum numeric value", () => {
    // Every enum value must appear as `| N |` (table row) in the docs.
    // Build expected rows from the enum so adding a new ExitCode forces
    // a docs update.
    const enumValues = Object.values(ExitCode).filter(
      (v): v is number => typeof v === "number",
    );
    for (const code of enumValues) {
      const expectedRow = `| ${code} |`;
      expect(CLI_DOCS).toContain(expectedRow);
    }
  });

  it("does NOT contain the stale 'exit code 1 is intentionally unused' note", () => {
    // PR #45 made `apiwright run` exit 1 on test failure (pytest
    // convention). The old note that 1 was reserved must stay deleted.
    expect(CLI_DOCS).not.toContain("exit code 1 is intentionally unused");
    expect(CLI_DOCS).not.toContain("exit code 1 is reserved");
  });

  it("documents the TEST_FAILURE row with code 1 in the global table", () => {
    // Strict: the global exit-codes table at the bottom of cli.md MUST
    // have a `| 1 | TEST_FAILURE` row. This is the single most-checked
    // exit code in CI scripts.
    expect(CLI_DOCS).toMatch(/\|\s*1\s*\|\s*TEST_FAILURE\s*\|/);
  });

  it("documents the VALIDATION row with code 3 in the global table", () => {
    // PR #58: `apiwright run` exits 3 (VALIDATION) when endpoint JSONs
    // are schema-invalid at startup. The global table must reflect.
    expect(CLI_DOCS).toMatch(/\|\s*3\s*\|\s*VALIDATION\s*\|/);
  });

  it("does NOT document the non-existent `apiwright validate --config <path>` example", () => {
    // §2-D3: validate does not accept --config. Repro:
    //   apiwright validate /tmp/foo --config /tmp/bar.json
    //   → error: unknown option '--config'
    // The example must stay deleted from cli.md.
    expect(CLI_DOCS).not.toMatch(/apiwright validate [^\n]* --config/);
  });

  it("validate command's exit-codes table mentions the empty-endpoints case (#57 / PR #60)", () => {
    // The `apiwright validate` exit-code 2 row must describe BOTH the
    // truly-empty case AND the env-files-present-but-no-endpoints case
    // (the §2-B3 fix from PR #60).
    const validateSection = CLI_DOCS.split("### `apiwright validate")[1];
    expect(validateSection).toBeDefined();
    expect(validateSection).toMatch(/no validatable files|environment YAML but zero/i);
  });
});
