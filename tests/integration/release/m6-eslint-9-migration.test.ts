/**
 * M6 — ESLint 8 → 9 flat-config migration invariants.
 *
 * Pins the migration so a future "just bump eslint" attempt that
 * reverts to legacy config or removes the flat config gets flagged.
 */

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(__filename, "../../../../");

interface PackageJson {
  devDependencies?: Record<string, string>;
}

function readPkg(): PackageJson {
  return JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as PackageJson;
}

describe("Lens 0 / M6 — ESLint 9 flat-config migration", () => {
  it("eslint.config.mjs exists (flat config) at repo root", () => {
    expect(existsSync(join(REPO_ROOT, "eslint.config.mjs"))).toBe(true);
  });

  it("legacy .eslintrc.json has been removed", () => {
    expect(existsSync(join(REPO_ROOT, ".eslintrc.json"))).toBe(false);
  });

  it("devDependencies pin eslint to ^9.x (not the EOL 8.x line)", () => {
    const v = readPkg().devDependencies?.eslint ?? "";
    expect(v).toMatch(/^\^?9\./);
  });

  it("devDependencies use the unified `typescript-eslint` package (not the split 7.x form)", () => {
    const deps = readPkg().devDependencies ?? {};
    expect(deps["typescript-eslint"]).toBeDefined();
    // The legacy `@typescript-eslint/eslint-plugin` and `@typescript-eslint/parser`
    // packages are subsumed by the single `typescript-eslint` package; they
    // should NOT be listed separately any more.
    expect(deps["@typescript-eslint/eslint-plugin"]).toBeUndefined();
    expect(deps["@typescript-eslint/parser"]).toBeUndefined();
  });

  it("eslint.config.mjs imports the flat-config plugin entry points", () => {
    const cfg = readFileSync(join(REPO_ROOT, "eslint.config.mjs"), "utf8");
    expect(cfg).toMatch(/from "@eslint\/js"/);
    expect(cfg).toMatch(/from "typescript-eslint"/);
    expect(cfg).toMatch(/from "eslint-plugin-import"/);
    expect(cfg).toMatch(/from "eslint-plugin-jsdoc"/);
    expect(cfg).toMatch(/from "eslint-config-prettier"/);
  });

  it("eslint.config.mjs uses the recommended type-checked tseslint preset", () => {
    const cfg = readFileSync(join(REPO_ROOT, "eslint.config.mjs"), "utf8");
    expect(cfg).toMatch(/tseslint\.configs\.recommendedTypeChecked/);
  });

  it("eslint.config.mjs preserves the project-wide max-len 100 / max-lines 500 budget", () => {
    const cfg = readFileSync(join(REPO_ROOT, "eslint.config.mjs"), "utf8");
    expect(cfg).toMatch(/"max-len"[\s\S]*?code:\s*100/);
    expect(cfg).toMatch(/"max-lines"[\s\S]*?max:\s*500/);
  });

  it("eslint.config.mjs preserves the test-tree override that relaxes rules", () => {
    const cfg = readFileSync(join(REPO_ROOT, "eslint.config.mjs"), "utf8");
    expect(cfg).toMatch(/files:\s*\["tests\/\*\*\/\*\.ts"/);
    expect(cfg).toMatch(/jsdoc\/require-jsdoc.*off/);
  });

  it("eslint.config.mjs preserves the src/cli/ override that allows console.*", () => {
    const cfg = readFileSync(join(REPO_ROOT, "eslint.config.mjs"), "utf8");
    expect(cfg).toMatch(/files:\s*\["src\/cli\/\*\*\/\*\.ts"\]/);
    expect(cfg).toMatch(/"no-console":\s*"off"/);
  });
});
