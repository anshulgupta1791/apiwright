/**
 * v1.0.1 regression guard — Dockerfile ENTRYPOINT + HEALTHCHECK
 * must use absolute paths to the CLI entry.
 *
 * The v1.0.0 image shipped with a relative-path ENTRYPOINT
 * (`node dist/cli/entry.js`), which fails with
 * `Cannot find module '/work/dist/cli/entry.js'` the moment the user
 * runs the image with a working-directory override (`docker run -v
 * $PWD:/work -w /work ...`). The CI workflow template in
 * docs/cookbook/quickstart.md uses that `-w` pattern, so this
 * affected the very first install path a CI-adopter would try.
 *
 * Pinned both ENTRYPOINT and HEALTHCHECK because both have the same
 * resolution issue.
 */

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(__filename, "../../../../");

const dockerfile = readFileSync(join(REPO_ROOT, "Dockerfile"), "utf8");

describe("v1.0.1 — Dockerfile entrypoint absolute-path regression guard", () => {
  it("ENTRYPOINT references the CLI by absolute path /app/dist/cli/entry.js", () => {
    expect(dockerfile).toMatch(
      /ENTRYPOINT\s*\[[^\]]*"\/app\/dist\/cli\/entry\.js"/,
    );
  });

  it("ENTRYPOINT does NOT reference the CLI by the relative path dist/cli/entry.js", () => {
    // Match the literal token inside JSON-array ENTRYPOINT
    expect(dockerfile).not.toMatch(
      /ENTRYPOINT\s*\[[^\]]*"dist\/cli\/entry\.js"/,
    );
  });

  it("HEALTHCHECK invokes the CLI by absolute path /app/dist/cli/entry.js", () => {
    // HEALTHCHECK CMD `node /app/dist/cli/entry.js --version`. The shell-
    // form CMD doesn't have JSON brackets, so we match the path directly.
    expect(dockerfile).toMatch(
      /HEALTHCHECK[\s\S]*?node\s+\/app\/dist\/cli\/entry\.js\s+--version/,
    );
  });

  it("HEALTHCHECK does NOT use the relative path dist/cli/entry.js", () => {
    expect(dockerfile).not.toMatch(
      /HEALTHCHECK[\s\S]*?node\s+dist\/cli\/entry\.js\s+--version/,
    );
  });
});
