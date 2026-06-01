#!/usr/bin/env node
/**
 * Guarded husky bootstrap.
 *
 * Husky's `install` registers git hooks via core.hooksPath. That is correct
 * behaviour for developers working inside the apiwright repo, but it must
 * not run in two other contexts:
 *
 *   1. When apiwright is installed as a transitive dependency in someone
 *      else's project (no `.git` in the install root). Running `husky
 *      install` there would either no-op noisily or fail the install,
 *      depending on the version. Either way it surfaces irrelevant output
 *      in user installs and breaks the `npm pack && npm install` rehearsal.
 *   2. In CI runs that already check out the repo with hooks intentionally
 *      bypassed (e.g. release-publish flows that set `CI=true`). Running
 *      hooks there would slow the run for no benefit.
 *
 * This script keeps the developer ergonomics (auto-install on `npm
 * install` inside the repo) while keeping consumers and CI quiet.
 *
 * Lens 0 blocker B12/B5 closer.
 */

import { existsSync } from "node:fs";
import { execSync } from "node:child_process";

if (process.env.CI === "true") {
  // CI runs do not need git hooks; the workflow runs lint/test directly.
  process.exit(0);
}

if (!existsSync(".git")) {
  // Installed as a dependency or downloaded as a tarball — there is no git
  // repo here, so there are no hooks to register.
  process.exit(0);
}

try {
  execSync("husky install", { stdio: "inherit" });
} catch (err) {
  // Failing to register hooks should never break `npm install`. Print and
  // continue so the developer sees the warning but can keep working.
  console.warn("[apiwright] husky install failed:", err?.message ?? err);
  process.exit(0);
}
