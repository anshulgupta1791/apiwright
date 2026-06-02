/**
 * Lens 0 pre-release metadata invariants.
 *
 * These tests pin every Lens 0 blocker fix that lives in package.json or the
 * adjacent prepare-husky bootstrap script. If any of these regress the team
 * is shipping a tarball that mis-installs, mis-versions, or carries dead
 * weight — exactly the failure mode that the Lens 0 sweep exists to prevent.
 *
 * Lens 0 blockers exercised here:
 *   - B1  Version bumped to 1.0.0 in package.json + Dockerfile comments
 *   - B2  @playwright/test removed from dependencies
 *   - B3  gitleaks removed from devDependencies
 *   - B4  prepublishOnly script gates `npm publish` on lint+typecheck+build+test
 *   - B6  CHANGELOG.md exists at repo root
 *   - B8  README cookbook list includes preparing-to-import + migrating-from-openapi
 *   - B12 / B5  `prepare` script no-ops on user installs (no .git) and in CI
 */

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(__filename, "../../../../");

interface PackageJson {
  name: string;
  version: string;
  private?: boolean;
  files?: string[];
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  keywords?: string[];
}

function readPkg(): PackageJson {
  const raw = readFileSync(join(REPO_ROOT, "package.json"), "utf8");
  return JSON.parse(raw) as PackageJson;
}

// ---- B1 — version bump ---------------------------------------------------
describe("Lens 0 / B1 — version is on the 1.x line, never the 0.x pre-1.0 version", () => {
  // We no longer hardcode "1.0.0" — that turned every PATCH bump into a
  // coordinated assertion edit. Instead, pin the SHAPE (1.x.y) and pin
  // that the pre-1.0 placeholder (0.1.0) never resurfaces.
  it("package.json version is on the 1.x.y line", () => {
    expect(readPkg().version).toMatch(/^1\.\d+\.\d+/);
  });

  it("package-lock.json mirrors the package.json version", () => {
    const pkgVersion = readPkg().version;
    const lock = JSON.parse(
      readFileSync(join(REPO_ROOT, "package-lock.json"), "utf8"),
    ) as { version: string; packages: Record<string, { version?: string }> };
    expect(lock.version).toBe(pkgVersion);
    expect(lock.packages[""]?.version).toBe(pkgVersion);
  });

  it("Dockerfile build/run comments reference the current package version, not the 0.1.0 placeholder", () => {
    const dockerfile = readFileSync(join(REPO_ROOT, "Dockerfile"), "utf8");
    const pkgVersion = readPkg().version;
    expect(dockerfile).toContain(`apiwright:${pkgVersion}`);
    expect(dockerfile).not.toContain("apiwright:0.1.0");
  });
});

// ---- B2 — @playwright/test removed --------------------------------------
describe("Lens 0 / B2 — @playwright/test removed from dependencies", () => {
  it("dependencies block does not include @playwright/test", () => {
    const pkg = readPkg();
    expect(pkg.dependencies?.["@playwright/test"]).toBeUndefined();
  });

  it("devDependencies block does not include @playwright/test either", () => {
    const pkg = readPkg();
    expect(pkg.devDependencies?.["@playwright/test"]).toBeUndefined();
  });

  it("keywords no longer advertises 'playwright' as a feature", () => {
    const pkg = readPkg();
    expect(pkg.keywords ?? []).not.toContain("playwright");
  });
});

// ---- B3 — gitleaks npm dep removed --------------------------------------
describe("Lens 0 / B3 — typosquat-shaped gitleaks npm dep removed", () => {
  it("devDependencies does not include the gitleaks npm package", () => {
    const pkg = readPkg();
    expect(pkg.devDependencies?.gitleaks).toBeUndefined();
  });
});

// ---- B4 — prepublishOnly gate -------------------------------------------
describe("Lens 0 / B4 — prepublishOnly script gates publish", () => {
  it("scripts.prepublishOnly is defined", () => {
    const pkg = readPkg();
    expect(pkg.scripts?.prepublishOnly).toBeDefined();
  });

  it("prepublishOnly runs lint, typecheck, build, and test", () => {
    const cmd = readPkg().scripts?.prepublishOnly ?? "";
    expect(cmd).toContain("lint");
    expect(cmd).toContain("typecheck");
    expect(cmd).toContain("build");
    expect(cmd).toMatch(/\btest\b/);
  });
});

// ---- B6 — CHANGELOG.md exists -------------------------------------------
describe("Lens 0 / B6 — CHANGELOG.md exists", () => {
  it("CHANGELOG.md exists at repo root", () => {
    expect(existsSync(join(REPO_ROOT, "CHANGELOG.md"))).toBe(true);
  });

  it("CHANGELOG.md contains a [1.0.0] section heading", () => {
    const txt = readFileSync(join(REPO_ROOT, "CHANGELOG.md"), "utf8");
    expect(txt).toMatch(/##\s+\[1\.0\.0\]/);
  });

  it("CHANGELOG.md is included in the published files allowlist", () => {
    const pkg = readPkg();
    expect(pkg.files ?? []).toContain("CHANGELOG.md");
  });

  it("CHANGELOG.md follows Keep a Changelog conventions (Unreleased section)", () => {
    const txt = readFileSync(join(REPO_ROOT, "CHANGELOG.md"), "utf8");
    expect(txt).toMatch(/##\s+\[Unreleased\]/);
  });
});

// ---- B8 — README cookbook list ------------------------------------------
describe("Lens 0 / B8 — README cookbook list includes new recipes", () => {
  const readme = readFileSync(join(REPO_ROOT, "README.md"), "utf8");

  it("links to preparing-to-import.md", () => {
    expect(readme).toContain("preparing-to-import.md");
  });

  it("links to migrating-from-openapi.md", () => {
    expect(readme).toContain("migrating-from-openapi.md");
  });

  it("still links to the original four core recipes", () => {
    expect(readme).toContain("quickstart.md");
    expect(readme).toContain("crud-api.md");
    expect(readme).toContain("authenticated-api.md");
    expect(readme).toContain("db-side-effects.md");
  });
});

// ---- B12 / B5 — husky prepare guard -------------------------------------
describe("Lens 0 / B12 — husky prepare guard", () => {
  const scriptPath = join(REPO_ROOT, "scripts/prepare-husky.mjs");

  it("scripts/prepare-husky.mjs exists", () => {
    expect(existsSync(scriptPath)).toBe(true);
  });

  it("package.json prepare script delegates to scripts/prepare-husky.mjs", () => {
    expect(readPkg().scripts?.prepare).toBe("node scripts/prepare-husky.mjs");
  });

  it("exits 0 quickly when CI=true (skips husky install)", () => {
    // Run in a tmp dir so the script can't see a .git directory
    const tmp = mkdtempSync(join(tmpdir(), "apiwright-husky-ci-"));
    const out = execFileSync(process.execPath, [scriptPath], {
      cwd: tmp,
      env: { ...process.env, CI: "true" },
      encoding: "utf8",
      timeout: 5_000,
    });
    // Should not print "husky install" output (which would mention .husky/)
    expect(out).not.toContain(".husky");
  });

  it("exits 0 quickly when there is no .git directory (user-install case)", () => {
    const tmp = mkdtempSync(join(tmpdir(), "apiwright-husky-nogit-"));
    // Explicitly unset CI so we exercise the no-.git branch, not the CI branch
    const env = { ...process.env };
    delete env.CI;
    const out = execFileSync(process.execPath, [scriptPath], {
      cwd: tmp,
      env,
      encoding: "utf8",
      timeout: 5_000,
    });
    expect(out).not.toContain(".husky");
  });

  it("runs husky install when .git exists and CI is unset (developer-install case)", () => {
    // Sandbox: create a tmp project with a fake .git dir + a local 'husky'
    // shim that just prints a marker so we can assert it ran.
    const tmp = mkdtempSync(join(tmpdir(), "apiwright-husky-dev-"));
    mkdirSync(join(tmp, ".git"));
    mkdirSync(join(tmp, "node_modules/.bin"), { recursive: true });
    const shim = join(tmp, "node_modules/.bin/husky");
    writeFileSync(
      shim,
      "#!/usr/bin/env node\nconsole.log('HUSKY_SHIM_RAN');\n",
      { mode: 0o755 },
    );

    const env = { ...process.env };
    delete env.CI;
    // Put the shim's directory at the front of PATH so `husky install`
    // resolves to our shim, not the global one.
    env.PATH = `${join(tmp, "node_modules/.bin")}:${env.PATH ?? ""}`;

    const out = execFileSync(process.execPath, [scriptPath], {
      cwd: tmp,
      env,
      encoding: "utf8",
      timeout: 5_000,
    });
    expect(out).toContain("HUSKY_SHIM_RAN");
  });
});
