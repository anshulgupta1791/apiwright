/**
 * Markdown link integrity check across all repo documentation.
 *
 * Every Markdown file in the repo is scanned for inline links of the form
 * `[text](path.md)` (and `path.md#anchor`). Relative paths must resolve to
 * an existing file. External `http(s)://` links are out of scope here —
 * those would need network access; we cover them with a separate offline-
 * friendly heuristic if/when added.
 *
 * Lens 0 blocker B9 closer: an earlier sweep found 11 dead references
 * pointing to never-written companion files (`auth-strategies.md`,
 * `connectors.md`, `authoring-endpoints.md`, `assertions-reference.md`,
 * `ci-integration.md`). This guard prevents the regression.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(__filename, "../../../../");

const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  ".git",
  "coverage",
  "reports",
]);

/** Recursively collect every *.md file under REPO_ROOT, skipping noise. */
function listMarkdownFiles(root: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(root)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(root, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...listMarkdownFiles(full));
    } else if (st.isFile() && entry.endsWith(".md")) {
      out.push(full);
    }
  }
  return out;
}

const INLINE_LINK = /\]\(([^)]+)\)/g;

interface BrokenLink {
  file: string;
  lineno: number;
  target: string;
}

/** Returns true when `ref` is a relative *.md (or directory) link we should check. */
function isCheckableMdRef(ref: string): boolean {
  if (!ref) return false;
  if (ref.startsWith("http://") || ref.startsWith("https://")) return false;
  if (ref.startsWith("mailto:")) return false;
  return ref.endsWith(".md") || ref.endsWith("/");
}

/** Normalises a raw inline-link target by stripping `#anchor` and trailing title text. */
function normaliseRef(rawRef: string): string {
  return rawRef.split("#")[0]?.split(" ")[0] ?? "";
}

function targetExists(fromFile: string, ref: string): boolean {
  const targetPath = normalize(join(dirname(fromFile), ref));
  try {
    statSync(targetPath);
    return true;
  } catch {
    return false;
  }
}

function scanFile(file: string, broken: BrokenLink[]): void {
  const text = readFileSync(file, "utf8");
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    INLINE_LINK.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = INLINE_LINK.exec(line)) !== null) {
      const ref = normaliseRef(m[1] ?? "");
      if (!isCheckableMdRef(ref)) continue;
      if (!targetExists(file, ref))
        broken.push({ file, lineno: i + 1, target: ref });
    }
  }
}

function findBrokenLinks(): BrokenLink[] {
  const broken: BrokenLink[] = [];
  for (const file of listMarkdownFiles(REPO_ROOT)) scanFile(file, broken);
  return broken;
}

describe("Lens 0 / B9 — Markdown link integrity", () => {
  it("no markdown file links to a non-existent *.md (or directory) target", () => {
    const broken = findBrokenLinks();
    if (broken.length > 0) {
      const summary = broken
        .map(
          (b) =>
            `  ${b.file.replace(REPO_ROOT + "/", "")}:${b.lineno} -> ${b.target}`,
        )
        .join("\n");
      // eslint-disable-next-line no-console
      console.error(`\nBroken markdown links:\n${summary}\n`);
    }
    expect(broken).toEqual([]);
  });

  it("does not regress on the 5 previously-broken filenames", () => {
    const blocked = [
      "auth-strategies.md",
      "connectors.md",
      "authoring-endpoints.md",
      "assertions-reference.md",
      "ci-integration.md",
    ];
    const offenders: string[] = [];
    for (const file of listMarkdownFiles(REPO_ROOT)) {
      const text = readFileSync(file, "utf8");
      for (const name of blocked) {
        const linkPattern = new RegExp(`\\]\\([^)]*${name}[^)]*\\)`);
        if (linkPattern.test(text)) {
          offenders.push(`${file.replace(REPO_ROOT + "/", "")} -> ${name}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
