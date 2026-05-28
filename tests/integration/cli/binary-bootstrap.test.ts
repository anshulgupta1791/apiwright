import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { beforeAll, describe, expect, it } from "vitest";

/**
 * Regression guard for GitHub issue #24 — "CLI binary is a no-op".
 *
 * `src/cli/entry.ts` defines `main()` but, before the fix, never invoked
 * it at module top level. The compiled binary therefore loaded its
 * dependency graph and exited 0 with NO output — every `apiwright …`
 * command (and the published Docker image) did nothing.
 *
 * Unit/integration tests that import `main()` and call it directly CANNOT
 * catch this: the gap is specifically the missing top-level invocation
 * when the file is executed as a process. This test is the only one that
 * spawns the built binary as a subprocess and asserts it actually runs.
 *
 * It builds `dist/` in `beforeAll` so it validates the real compiled
 * artifact regardless of whether the environment pre-built it.
 */

const execFileP = promisify(execFile);
const REPO_ROOT = join(__dirname, "..", "..", "..");
const ENTRY = join(REPO_ROOT, "dist", "cli", "entry.js");

/** Runs the built binary with args; returns { stdout, stderr, code }. */
async function runBinary(
  args: readonly string[],
): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const { stdout, stderr } = await execFileP("node", [ENTRY, ...args], {
      cwd: REPO_ROOT,
      timeout: 30_000,
    });
    return { stdout, stderr, code: 0 };
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string; code?: number };
    return { stdout: err.stdout ?? "", stderr: err.stderr ?? "", code: err.code ?? 1 };
  }
}

describe("CLI binary bootstrap (issue #24 regression guard)", () => {
  beforeAll(async () => {
    // Ensure the compiled binary exists; build if missing.
    try {
      await access(ENTRY);
    } catch {
      await execFileP("npm", ["run", "build"], { cwd: REPO_ROOT, timeout: 120_000 });
    }
  }, 130_000);

  it("`--version` prints the version and exits 0 (not a silent no-op)", async () => {
    const { stdout, code } = await runBinary(["--version"]);
    expect(code).toBe(0);
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("`--help` prints usage and exits 0", async () => {
    const { stdout, code } = await runBinary(["--help"]);
    expect(code).toBe(0);
    expect(stdout).toContain("Usage:");
    expect(stdout).toContain("apiwright");
    // Every documented subcommand surfaces in help.
    expect(stdout).toContain("validate");
    expect(stdout).toContain("run");
    expect(stdout).toContain("import");
    expect(stdout).toContain("docs");
  });

  it("`validate` on a missing directory exits non-zero with an error", async () => {
    const { stderr, stdout, code } = await runBinary([
      "validate",
      join(REPO_ROOT, "this-path-does-not-exist-apiwright"),
    ]);
    expect(code).not.toBe(0);
    expect(`${stdout}${stderr}`.toLowerCase()).toContain("not found");
  });

  it("an unknown command exits non-zero (commander error surfaces, not swallowed)", async () => {
    const { code } = await runBinary(["totally-unknown-subcommand"]);
    expect(code).not.toBe(0);
  });

  it("`run --workers=banana` rejects the bad flag with a non-zero exit", async () => {
    const { stdout, stderr, code } = await runBinary(["run", "--workers=banana"]);
    expect(code).not.toBe(0);
    expect(`${stdout}${stderr}`.toLowerCase()).toContain("workers");
  });
});
