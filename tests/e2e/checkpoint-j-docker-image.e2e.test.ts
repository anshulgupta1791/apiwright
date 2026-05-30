/**
 * Checkpoint J — Docker packaging (§13).
 *
 * Builds the repository's Dockerfile locally, then invokes the resulting
 * image against the in-house validation sandbox via mounted volumes —
 * exactly the way the published `ghcr.io/<org>/apiwright:<ver>` image
 * is intended to be used per §13.
 *
 * Self-skips when Docker is not available (e.g. CI runner without
 * docker-in-docker).
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { sandboxPath } from "./in-house-validation/test-helpers.js";

const execFileP = promisify(execFile);

async function dockerAvailable(): Promise<boolean> {
  try {
    await execFileP("docker", ["version", "--format", "{{.Server.Version}}"]);
    return true;
  } catch {
    return false;
  }
}

const DOCKER_PRESENT = await dockerAvailable();

describe.skipIf(!DOCKER_PRESENT)("Checkpoint J — Docker image packaging (§13)", () => {
  const imageTag = "apiwright:e2e-checkpoint-j";

  it("builds Dockerfile locally without error", async () => {
    await execFileP("docker", ["build", "-t", imageTag, "."], {
      cwd: process.cwd(),
      maxBuffer: 1024 * 1024 * 50,
    });
  }, 600_000);

  it("the built image is under the 200MB spec limit (§13)", async () => {
    const { stdout } = await execFileP("docker", [
      "image", "inspect", imageTag, "--format", "{{.Size}}",
    ]);
    const sizeBytes = Number(stdout.trim());
    const sizeMb = Math.floor(sizeBytes / 1024 / 1024);
    expect(sizeMb).toBeLessThanOrEqual(200);
  });

  it("running the image with --version exits 0 with non-empty stdout (proves binary bootstrap)", async () => {
    // NOTE: while issue #24 (CLI no-op) is open, this test demonstrates
    // the regression — stdout will be empty and the assertion will fail.
    // That is the intended behavior: this checkpoint is the regression
    // canary for #24.
    const { stdout } = await execFileP("docker", [
      "run", "--rm", imageTag, "--version",
    ]);
    expect(stdout.trim().length).toBeGreaterThan(0);
  });

  it("validate command works inside the container with mounted tests", async () => {
    await execFileP("docker", [
      "run", "--rm",
      "-v", `${sandboxPath("tests")}:/app/tests:ro`,
      imageTag,
      "validate", "/app/tests",
    ]);
  });
});

describe("Checkpoint J — Docker availability check", () => {
  it("reports whether Docker is available", () => {
    if (!DOCKER_PRESENT) {
      // eslint-disable-next-line no-console
      console.log("  ↪ Docker not available; install Docker Desktop or docker-in-docker in CI to run J");
    }
    expect(true).toBe(true);
  });
});
