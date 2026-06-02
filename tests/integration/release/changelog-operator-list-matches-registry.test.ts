/**
 * v1.0.1 regression guard — CHANGELOG operator list must match the
 * registry.
 *
 * The v1.0.0 release shipped with the CHANGELOG `[1.0.0]` entry naming
 * `type_is`, `between`, `in`, `not_null`, `count_less_than` — none of
 * which exist in `src/assertions/operator-registry.ts`. The first
 * adopter following the changelog hit `Unknown operator 'type_is'` on
 * their first assertion. This test pins the contract so that doc-vs-
 * impl drift on this surface fails CI, not the user.
 *
 * Scope: every operator name backticked in the `[1.0.0]` or `[1.0.1]`
 * "20 declarative assertion operators" bullet MUST be a registered
 * operator. Conversely, every registered operator MUST appear at
 * least once in the bullet block. Strict bidirectional check.
 */

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";

import { OPERATOR_REGISTRY } from "../../../src/assertions/operator-registry.js";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(__filename, "../../../../");

/** All operator names declared in the runtime registry. */
const REGISTRY_NAMES: ReadonlySet<string> = new Set(
  Object.values(OPERATOR_REGISTRY).map((op) => op.name),
);

/**
 * Pulls every backticked operator-shaped name out of the CHANGELOG's
 * "declarative assertion operators" bullet block(s) only. We anchor on
 * the bullet's leading text so narrative paragraphs elsewhere in the
 * CHANGELOG (e.g. v1.0.1's "Fixed" section explaining which old names
 * were wrong) don't count as authoritative operator listings.
 */
function extractChangelogOperatorMentions(): Set<string> {
  const text = readFileSync(join(REPO_ROOT, "CHANGELOG.md"), "utf8");
  const mentions = new Set<string>();
  // Match the "declarative assertion operators" bullet content. The
  // bullet spans from the marker through to the next blank line OR the
  // next top-level bullet/heading. Conservatively grab to the next
  // double-newline.
  const bulletRe =
    /\*\*\d+ declarative assertion operators\*\*([\s\S]*?)(?=\n\n|\n## |\n- \*\*|$)/g;
  let m: RegExpExecArray | null;
  while ((m = bulletRe.exec(text)) !== null) {
    const bullet = m[1] ?? "";
    const backticks = [...bullet.matchAll(/`([a-z][a-z0-9_]*)`/g)];
    for (const b of backticks) {
      const name = b[1];
      if (name && REGISTRY_NAMES.has(name)) mentions.add(name);
    }
  }
  return mentions;
}

/**
 * Returns the slice of CHANGELOG.md inside the "declarative assertion
 * operators" bullet(s). Used by the ghost-name check so narrative
 * explanations elsewhere don't trip the guard.
 */
function changelogOperatorBulletSlice(): string {
  const text = readFileSync(join(REPO_ROOT, "CHANGELOG.md"), "utf8");
  const slices: string[] = [];
  const bulletRe =
    /\*\*\d+ declarative assertion operators\*\*([\s\S]*?)(?=\n\n|\n## |\n- \*\*|$)/g;
  let m: RegExpExecArray | null;
  while ((m = bulletRe.exec(text)) !== null) {
    if (m[1]) slices.push(m[1]);
  }
  return slices.join("\n");
}

describe("v1.0.1 — CHANGELOG operator list ↔ operator registry parity", () => {
  it("every operator in the registry appears in CHANGELOG.md (impl → docs)", () => {
    const mentioned = extractChangelogOperatorMentions();
    const missing = [...REGISTRY_NAMES].filter((name) => !mentioned.has(name));
    expect(missing).toEqual([]);
  });

  it("the operator-bullet block(s) do not list non-existent operators (regression guard)", () => {
    // The v1.0.0 CHANGELOG bullet mentioned five names that don't exist.
    // We pin the narrower check on the bullet slice only — narrative
    // paragraphs elsewhere in the CHANGELOG (e.g. v1.0.1's Fixed
    // section explaining which old names were wrong) legitimately
    // mention those names and should not trip this guard.
    const bulletSlice = changelogOperatorBulletSlice();
    const ghosts = ["type_is", "between", "count_less_than", "not_null"];
    const ghostHits: string[] = [];
    for (const ghost of ghosts) {
      const re = new RegExp("`" + ghost + "`");
      if (re.test(bulletSlice)) ghostHits.push(ghost);
    }
    if (/`in`/.test(bulletSlice)) ghostHits.push("in");
    expect(ghostHits).toEqual([]);
  });

  it("docs/assertions.md is in sync with the registry (defense in depth)", () => {
    // The CHANGELOG drift slipped through partly because docs/assertions.md
    // wasn't cross-checked at release time. Pin both.
    const text = readFileSync(join(REPO_ROOT, "docs/assertions.md"), "utf8");
    const docMentions = new Set<string>();
    const allBackticks = [...text.matchAll(/`([a-z][a-z0-9_]*)`/g)];
    for (const m of allBackticks) {
      const name = m[1];
      if (name && REGISTRY_NAMES.has(name)) docMentions.add(name);
    }
    const missing = [...REGISTRY_NAMES].filter((n) => !docMentions.has(n));
    expect(missing).toEqual([]);
  });
});
