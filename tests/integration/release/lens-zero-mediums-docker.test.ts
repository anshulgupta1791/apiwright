/**
 * Lens 0 medium-priority invariants — Docker image + release workflow.
 *
 * Pins:
 *   - Docker-build regression fix: the `npm ci` inside the builder stage
 *     must not fail because `scripts/prepare-husky.mjs` is missing from
 *     the build context. PR #90 introduced the husky bootstrap script
 *     but didn't update the Dockerfile to COPY it before npm ci, which
 *     broke the build entirely (caught while measuring for M8).
 *   - M2  Release workflow builds for both linux/amd64 and linux/arm64
 *         so Apple-Silicon developers + ARM cloud users (AWS Graviton,
 *         Oracle Ampere, etc.) get a native image instead of being
 *         QEMU-emulated.
 *   - M8  Image-size guard reflects realistic v1.0 baseline (320 MB
 *         ceiling for a ~290 MB image). The original 200 MB target
 *         was unachievable without moving DB drivers behind
 *         `optionalDependencies`, which is a v1.1 task.
 *   - M8  Unused `date-fns` dependency (38.9 MB on disk) removed.
 */

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(__filename, "../../../../");

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function readPkg(): PackageJson {
  return JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as PackageJson;
}

// ---- Docker-build regression --------------------------------------------
describe("Lens 0 / Docker build regression (PR #90 husky-script fallout)", () => {
  const dockerfile = readFileSync(join(REPO_ROOT, "Dockerfile"), "utf8");

  it("Dockerfile COPYs scripts/ into the builder stage before `RUN npm ci`", () => {
    // Without this, `npm ci` invokes the `prepare` lifecycle script
    // defined in package.json, which calls `node scripts/prepare-husky.mjs`
    // — a file that wouldn't exist in the build context yet. Search
    // for `RUN npm ci` (the command invocation) rather than the bare
    // string `npm ci`, because the Dockerfile's narrative comments
    // also mention `npm ci`.
    const copyIdx = dockerfile.indexOf("COPY scripts ./scripts");
    const runNpmCiIdx = dockerfile.indexOf("RUN npm ci");
    expect(copyIdx).toBeGreaterThan(-1);
    expect(runNpmCiIdx).toBeGreaterThan(copyIdx);
  });
});

// ---- M2 — multi-arch release ------------------------------------------
describe("Lens 0 / M2 — release workflow builds multi-arch images", () => {
  const releaseYml = readFileSync(
    join(REPO_ROOT, ".github/workflows/release.yml"),
    "utf8",
  );

  it("build step declares platforms: linux/amd64 and linux/arm64", () => {
    expect(releaseYml).toMatch(/platforms:\s*linux\/amd64,\s*linux\/arm64/);
  });

  it("QEMU setup-action is still wired (provides foreign-arch emulation)", () => {
    expect(releaseYml).toContain("docker/setup-qemu-action@v4");
  });

  it("Buildx setup-action is still wired", () => {
    expect(releaseYml).toContain("docker/setup-buildx-action@v3");
  });
});

// ---- M8 — image-size guard reflects v1.0 reality ----------------------
describe("Lens 0 / M8 — image-size guard reflects v1.0 baseline", () => {
  const releaseYml = readFileSync(
    join(REPO_ROOT, ".github/workflows/release.yml"),
    "utf8",
  );

  it("IMAGE_SIZE_LIMIT_MB env var raised from the unachievable 200 MB target", () => {
    // Extract the numeric limit; must be at least 250 (the unachievable
    // original) and at most 400 (a sane upper bound — if we exceed
    // this we have a regression worth investigating).
    const match = releaseYml.match(/IMAGE_SIZE_LIMIT_MB:\s*(\d+)/);
    expect(match).not.toBeNull();
    const limit = Number(match?.[1]);
    expect(limit).toBeGreaterThan(250);
    expect(limit).toBeLessThanOrEqual(400);
  });

  it("the env-var section explains why the limit is what it is", () => {
    // A bare numeric bump would be a coverup. The CI ceiling must come
    // with a comment block explaining the v1.1 path to a smaller image.
    expect(releaseYml).toMatch(/optionalDependencies/);
  });

  it("Dockerfile size-budget comment reflects the new baseline", () => {
    const dockerfile = readFileSync(join(REPO_ROOT, "Dockerfile"), "utf8");
    // The comment may say "Size:" (post-M8-deep) or "Size budget"
    // (M8-shallow). Either is acceptable — the important part is that
    // it numerically references the realistic post-M8 size + calls out
    // the optionalDependencies story.
    expect(dockerfile).toMatch(/Size[:\s]/);
    expect(dockerfile).toMatch(/optionalDependencies/);
  });
});

// ---- M8 — unused date-fns dep removed ---------------------------------
describe("Lens 0 / M8 — unused date-fns dependency removed", () => {
  it("date-fns is not in dependencies (it was unused; 38.9 MB on disk)", () => {
    const pkg = readPkg();
    expect(pkg.dependencies?.["date-fns"]).toBeUndefined();
  });

  it("date-fns is not in devDependencies either", () => {
    const pkg = readPkg();
    expect(pkg.devDependencies?.["date-fns"]).toBeUndefined();
  });
});

// ---- v1.0 limitations doc records the trade-off -------------------------
describe("Lens 0 / docs — limitations.md records the image-size trade-off", () => {
  const limitations = readFileSync(join(REPO_ROOT, "docs/limitations.md"), "utf8");

  it("notes the actual v1.0 image baseline (~248 MB post-M8-deep, ~290 MB pre)", () => {
    expect(limitations).toMatch(/Docker image under 200 MB/);
    // Accept either the M8-shallow (~290 MB) or post-M8-deep (~248 MB)
    // figure — both are honest snapshots of where the image stands at
    // that point in the v1.0 release process.
    expect(limitations).toMatch(/24[0-9]\s*MB|290\s*MB/);
  });

  it("calls out the v1.1 path via optionalDependencies", () => {
    expect(limitations).toMatch(/optionalDependencies/);
  });
});
