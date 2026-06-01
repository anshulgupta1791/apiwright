/**
 * M8-deep — DB drivers moved from `dependencies` to `optionalDependencies`.
 *
 * Pins the migration so a future "this dep tree feels wrong, let me move
 * pg back to dependencies" PR gets flagged. The four drivers ship as
 * optional because most users only verify against one (or zero) of the
 * four supported databases, and shipping all four to everyone bloated
 * the published Docker image by ~45 MB on top of the date-fns drop.
 */

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(__filename, "../../../../");

interface PackageJson {
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

function readPkg(): PackageJson {
  return JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as PackageJson;
}

const OPTIONAL_DRIVERS = ["mongodb", "mysql2", "neo4j-driver", "pg"] as const;

describe("Lens 0 / M8-deep — DB drivers are optionalDependencies", () => {
  it("package.json declares an optionalDependencies block", () => {
    expect(readPkg().optionalDependencies).toBeDefined();
  });

  it.each(OPTIONAL_DRIVERS)(
    "%s is listed in optionalDependencies",
    (driver) => {
      expect(readPkg().optionalDependencies?.[driver]).toBeDefined();
    },
  );

  it.each(OPTIONAL_DRIVERS)(
    "%s is NOT in regular dependencies (otherwise the move did nothing)",
    (driver) => {
      expect(readPkg().dependencies?.[driver]).toBeUndefined();
    },
  );

  it("Dockerfile passes --omit=optional to `npm ci` so the image skips drivers", () => {
    const dockerfile = readFileSync(join(REPO_ROOT, "Dockerfile"), "utf8");
    expect(dockerfile).toMatch(/npm ci[^\n]*--omit=optional/);
  });

  it("Dockerfile passes --omit=optional to `npm prune` as defense-in-depth", () => {
    const dockerfile = readFileSync(join(REPO_ROOT, "Dockerfile"), "utf8");
    expect(dockerfile).toMatch(/npm prune[^\n]*--omit=optional/);
  });

  it("release.yml IMAGE_SIZE_LIMIT_MB reflects the smaller post-optional baseline", () => {
    const yml = readFileSync(
      join(REPO_ROOT, ".github/workflows/release.yml"),
      "utf8",
    );
    const m = yml.match(/IMAGE_SIZE_LIMIT_MB:\s*(\d+)/);
    expect(m).not.toBeNull();
    const limit = Number(m?.[1]);
    // Should be tighter than the 320 MB v1.0 ceiling that PR #92 set;
    // the M8-deep changes bring the measured size to ~248 MB.
    expect(limit).toBeLessThanOrEqual(280);
    expect(limit).toBeGreaterThan(200);
  });

  it("docs/db-verify.md documents the per-driver install pattern", () => {
    const md = readFileSync(join(REPO_ROOT, "docs/db-verify.md"), "utf8");
    expect(md).toMatch(/optional dependencies/i);
    for (const driver of OPTIONAL_DRIVERS) {
      expect(md).toContain(`npm install ${driver}`);
    }
  });

  it("docs/db-verify.md surfaces the actionable missing-driver error message", () => {
    const md = readFileSync(join(REPO_ROOT, "docs/db-verify.md"), "utf8");
    expect(md).toMatch(/DB_CONNECTION_FAILED/);
    expect(md).toMatch(/not installed/);
  });
});

describe("Lens 0 / M8-deep — each driver seam still carries an actionable install hint", () => {
  it.each([
    ["postgres", "src/db/drivers/postgres-seam.ts", "npm install pg"],
    ["mysql", "src/db/drivers/mysql-seam.ts", "npm install mysql2"],
    ["mongodb", "src/db/drivers/mongodb-seam.ts", "npm install mongodb"],
    ["neo4j", "src/db/drivers/neo4j-seam.ts", "npm install neo4j-driver"],
  ])("%s seam carries an `%s` install hint", (_engine, path, hint) => {
    const seam = readFileSync(join(REPO_ROOT, path), "utf8");
    expect(seam).toContain(hint);
  });
});
