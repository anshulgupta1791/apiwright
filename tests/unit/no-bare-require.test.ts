import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

import { describe, it, expect } from "vitest";

/**
 * Regression guard for GitHub issue #25.
 *
 * Bare `require(...)` at the top level of an ESM module works under Node
 * 22 (which kept a permissive `require` shim in ESM scope) but throws
 * `ReferenceError: require is not defined` under Node 26+. Every CJS
 * interop in this codebase MUST go through `createRequire(import.meta.url)`.
 *
 * This test scans every `src/**.ts` file and fails if it finds a
 * `require(` call that is NOT bound to a `createRequire(...)` handle.
 * It runs on any Node version (it's a static scan), so CI's Node 22
 * catches Node-26 regressions before they ship.
 */

const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src");

/** Recursively collects every `.ts` file under `dir`. */
async function collectTsFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await collectTsFiles(full)));
    } else if (entry.name.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Returns the line numbers in `content` that call `require(` without
 * going through a `createRequire`-bound handle. Lines that define the
 * handle itself (`const x = createRequire(...)`) are allowed.
 */
function findBareRequires(content: string): number[] {
  const offenders: number[] = [];
  const lines = content.split("\n");
  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    // Skip comment lines: line comments (//), block-comment bodies (*),
    // and JSDoc/block openers (/* , /**). A JSDoc line that mentions the
    // word "require (...)" is documentation, not a call.
    if (
      trimmed.startsWith("//") ||
      trimmed.startsWith("*") ||
      trimmed.startsWith("/*")
    ) {
      return;
    }
    // Allow the createRequire handle definition itself.
    if (trimmed.includes("createRequire(")) return;
    // Flag a global `require(` call. The char before "require" must be
    // start-of-line or a non-word, non-dot, non-quote char. This excludes:
    //   - `requireFn(` / `_require(` / `requireCjs(`  (word char before)
    //   - `obj.require(`                              (dot before)
    //   - `"require("` / `'require('`  string literal (quote before)
    if (/(^|[^.\w"'`])require\s*\(/.test(line)) {
      offenders.push(idx + 1);
    }
  });
  return offenders;
}

describe("no bare require() in src/ (issue #25 Node 26 ESM guard)", () => {
  it("every CJS interop uses createRequire(import.meta.url), never bare require()", async () => {
    const files = await collectTsFiles(SRC_DIR);
    expect(files.length).toBeGreaterThan(0);
    const violations: string[] = [];
    for (const file of files) {
      const content = await readFile(file, "utf8");
      const bare = findBareRequires(content);
      if (bare.length > 0) {
        const rel = file.slice(file.indexOf("/src/") + 1);
        violations.push(`${rel}: lines ${bare.join(", ")}`);
      }
    }
    expect(violations, `bare require() found (breaks Node 26):\n${violations.join("\n")}`).toEqual([]);
  });
});
