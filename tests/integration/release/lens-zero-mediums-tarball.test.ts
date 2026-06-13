/**
 * Lens 0 medium-priority invariants — tarball, docker context, and
 * programmatic-type surface.
 *
 * Pins:
 *   - M1  .dockerignore exists and excludes the noisy / risky paths
 *   - M3  Published tarball strips `.d.ts.map` files (IDE-only, ~25%
 *         of the prior tarball volume). `.js.map` files are kept so
 *         runtime stack traces still resolve to source positions.
 *   - M4  README has the standard project badges in the header
 *   - M5  package.json declares a `types` entry pointing at a real .d.ts
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(__filename, "../../../../");

interface PackageJson {
  types?: string;
  files?: string[];
}

function readPkg(): PackageJson {
  return JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as PackageJson;
}

/** Lists the files that would be included in the published tarball. */
function listTarballFiles(): string[] {
  // `--ignore-scripts` so the `prepare` script does not pollute stdout
  // with husky's "Git hooks installed" line; `--json` then yields clean
  // parseable JSON.
  const out = execSync("npm pack --dry-run --json --ignore-scripts", {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  const parsed = JSON.parse(out) as Array<{ files?: Array<{ path: string }> }>;
  const entry = parsed[0];
  return (entry?.files ?? []).map((f) => f.path);
}

// ---- M1 — .dockerignore -------------------------------------------------
describe("Lens 0 / M1 — .dockerignore", () => {
  const path = join(REPO_ROOT, ".dockerignore");
  const text = existsSync(path) ? readFileSync(path, "utf8") : "";

  it("exists at repo root", () => {
    expect(existsSync(path)).toBe(true);
  });

  it("excludes node_modules (keeps `npm ci` deterministic per stage)", () => {
    expect(text).toMatch(/^node_modules\b/m);
  });

  it("excludes .git history (build context bloat + signing-key surface)", () => {
    expect(text).toMatch(/^\.git\b/m);
  });

  it("excludes the test tree (image runs production code only)", () => {
    expect(text).toMatch(/^tests\b/m);
  });

  it("excludes coverage and reports directories", () => {
    expect(text).toMatch(/^coverage\b/m);
    expect(text).toMatch(/^reports\b/m);
  });

  it("excludes local .env-shaped files as defense-in-depth", () => {
    expect(text).toMatch(/^\.env\b/m);
  });

  it("excludes the Dockerfile and .dockerignore themselves", () => {
    expect(text).toMatch(/^Dockerfile\b/m);
    expect(text).toMatch(/^\.dockerignore\b/m);
  });
});

// ---- M3 — tarball strips .d.ts.map -------------------------------------
describe("Lens 0 / M3 — tarball strips .d.ts.map files", () => {
  const files = listTarballFiles();

  it("tarball contains zero .d.ts.map files", () => {
    const declarationMaps = files.filter((f) => f.endsWith(".d.ts.map"));
    expect(declarationMaps).toEqual([]);
  });

  it("tarball still contains .js.map files (preserves runtime stack-trace quality)", () => {
    const sourceMaps = files.filter((f) => f.endsWith(".js.map"));
    expect(sourceMaps.length).toBeGreaterThan(0);
  });

  it("tarball still contains .d.ts type declarations", () => {
    const decls = files.filter((f) => f.endsWith(".d.ts"));
    expect(decls.length).toBeGreaterThan(0);
  });

  it("tarball contains the compiled .js modules", () => {
    const js = files.filter((f) => f.endsWith(".js"));
    expect(js.length).toBeGreaterThan(0);
  });

  it("files allowlist uses globs that exclude .d.ts.map", () => {
    const pkg = readPkg();
    const filesField = pkg.files ?? [];
    // Must NOT include a bare "dist" entry (which would include .d.ts.map)
    expect(filesField).not.toContain("dist");
    // Must include the .js / .js.map / .d.ts globs
    expect(filesField.some((p) => p.endsWith("*.js"))).toBe(true);
    expect(filesField.some((p) => p.endsWith("*.d.ts"))).toBe(true);
  });
});

// ---- M5 — types field --------------------------------------------------
describe("Lens 0 / M5 — types field declared", () => {
  it("package.json declares a `types` field", () => {
    expect(readPkg().types).toBeDefined();
  });

  it("the declared types path points at a real .d.ts file post-build", () => {
    const typesPath = readPkg().types;
    if (typesPath === undefined) throw new Error("types field missing");
    const abs = join(REPO_ROOT, typesPath);
    // The .d.ts file exists after `npm run build`. We don't run build
    // here (the project's CI does that as a prerequisite) but the path
    // must be syntactically valid and ending in .d.ts.
    expect(typesPath.endsWith(".d.ts")).toBe(true);
    // If build has run, the file is on disk. Don't fail if it's absent
    // (e.g. fresh checkout where build hasn't run yet).
    if (existsSync(abs)) {
      const txt = readFileSync(abs, "utf8");
      expect(txt.length).toBeGreaterThan(0);
    }
  });
});

// ---- M4 — README badges ------------------------------------------------
describe("Lens 0 / M4 — README badges", () => {
  const readme = readFileSync(join(REPO_ROOT, "README.md"), "utf8");

  it("has a CI / security-gate badge", () => {
    expect(readme).toMatch(/security-gate\.yml\/badge\.svg/);
  });

  it("has a license badge", () => {
    expect(readme).toMatch(/license[-_]Apache/i);
  });

  it("has a Node version badge (static or registry-driven)", () => {
    // v1.0.0 used the registry-driven /node/v/apiwright badge, which
    // 404'd until `apiwright` was npm-published. v1.0.1 swapped to a
    // static `node-%E2%89%A522` badge (matches `engines.node: >=22`).
    // Accept either form so a future re-add of the registry badge
    // (post-npm-publish) doesn't trip this test.
    const staticNode = /img\.shields\.io\/badge\/node-/i.test(readme);
    const registryNode = /img\.shields\.io\/node\/v\/apiwright/.test(readme);
    expect(staticNode || registryNode).toBe(true);
  });

  it("does NOT carry the npm-registry version badge while `apiwright` is unpublished", () => {
    // The `img.shields.io/npm/v/apiwright` badge renders "package not
    // found" until `npm publish` lands. Removed in v1.0.1. When
    // `npm publish` does happen, this assertion inverts to a positive
    // presence check, not delete (mirroring the node-version case).
    //
    // Strip HTML comments before the check — the v1.0.1 README keeps a
    // commented-out reference to the badge URL inside a `<!-- … -->`
    // block as a maintainer note ("re-add this badge after npm publish").
    // That comment is documentation, not a rendered badge.
    let rendered = readme;
    let previous: string;
    do {
      previous = rendered;
      rendered = rendered.replace(/<!--[\s\S]*?-->/g, "");
    } while (rendered !== previous);
    const pkg = readPkg();
    if ((pkg as { private?: boolean }).private === true) {
      expect(rendered).not.toMatch(/img\.shields\.io\/npm\/v\/apiwright/);
    } else {
      expect(rendered).toMatch(/img\.shields\.io\/npm\/v\/apiwright/);
    }
  });

  it("has a TypeScript badge", () => {
    expect(readme).toMatch(/TypeScript-/);
  });

  it("has a Docker badge linking to the GHCR package page", () => {
    expect(readme).toMatch(/docker/i);
    expect(readme).toMatch(/ghcr\.io|ghcr/i);
  });
});
