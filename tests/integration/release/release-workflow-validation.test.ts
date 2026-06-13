import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, it, expect } from "vitest";

// js-yaml is a CommonJS module — match the require() shim convention used
// in src/env/yaml-reader.ts.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const yaml = require("js-yaml") as {
  load: (input: string, opts?: { schema?: unknown }) => unknown;
  JSON_SCHEMA: unknown;
};

const REPO_ROOT = join(__dirname, "..", "..", "..");
const WORKFLOW_PATH = join(REPO_ROOT, ".github", "workflows", "release.yml");

interface ReleaseWorkflow {
  name?: string;
  // 'on' is parsed but accessed via bracket notation due to YAML truthiness quirks.
  jobs?: { publish?: { steps?: Array<{ uses?: string; name?: string; run?: string }> } };
  permissions?: Record<string, string>;
  env?: Record<string, string | number>;
}

describe(".github/workflows/release.yml", () => {
  let raw: string;
  let doc: ReleaseWorkflow;
  let triggerSection: unknown;

  it("parses as valid YAML under the safe JSON_SCHEMA", async () => {
    raw = await readFile(WORKFLOW_PATH, "utf8");
    const parsed = yaml.load(raw, { schema: yaml.JSON_SCHEMA });
    expect(parsed).toBeTypeOf("object");
    doc = parsed as ReleaseWorkflow;
    // YAML "on" parses to boolean `true` under the default schema; under
    // JSON_SCHEMA it stays the string "on" — accept either form.
    triggerSection = (parsed as Record<string, unknown>)["on"] ?? (parsed as Record<string, unknown>)["true"];
    expect(triggerSection).toBeDefined();
  });

  it("triggers on tag pushes matching `v*`", () => {
    expect(raw).toMatch(/on:\s*\n\s+push:\s*\n\s+tags:\s*\n\s+-\s+"v\*"/);
  });

  it("declares packages:write permission for GHCR push", () => {
    expect(doc.permissions).toBeDefined();
    expect(doc.permissions?.["packages"]).toBe("write");
    expect(doc.permissions?.["contents"]).toBe("read");
  });

  it("targets ghcr.io as the registry", () => {
    expect(doc.env?.["REGISTRY"]).toBe("ghcr.io");
    expect(raw).toContain("registry: ${{ env.REGISTRY }}");
  });

  it("authenticates via docker/login-action with GITHUB_TOKEN", () => {
    expect(raw).toContain("uses: docker/login-action@v3");
    expect(raw).toContain("password: ${{ secrets.GITHUB_TOKEN }}");
  });

  it("uses docker/build-push-action@v6 to build + push", () => {
    expect(raw).toContain("uses: docker/build-push-action@v6");
    expect(raw).toMatch(/push:\s*true/);
  });

  it("builds the repository Dockerfile (multi-stage prod image)", () => {
    expect(raw).toMatch(/file:\s*\.\/Dockerfile/);
    expect(raw).toMatch(/context:\s*\./);
  });

  it("publishes all three spec-mandated tags: version, latest, sha", () => {
    expect(raw).toContain("type=raw,value=${{ steps.version.outputs.version }}");
    expect(raw).toContain("type=raw,value=latest");
    expect(raw).toContain("type=sha,format=long");
  });

  it("derives version from the tag by stripping the leading `v`", () => {
    expect(raw).toMatch(/version="\$\{tag#v\}"/);
  });

  it("attaches OCI image metadata via docker/metadata-action", () => {
    expect(raw).toContain("uses: docker/metadata-action@v5");
    expect(raw).toContain("org.opencontainers.image.title=APIWright");
    expect(raw).toContain("org.opencontainers.image.licenses=Apache-2.0");
    expect(raw).toContain("org.opencontainers.image.source=https://github.com/${{ github.repository }}");
  });

  it("enforces an image-size ceiling that gates accidental regressions (M8-deep)", () => {
    // After M8-deep (drivers moved to optionalDependencies + date-fns
    // drop), the v1.0 image measures ~248 MB. The CI ceiling sits above
    // that with headroom but well below the pre-M8 baseline (330 MB),
    // so a regression that re-introduces a heavy dep is caught.
    const limit = Number(doc.env?.["IMAGE_SIZE_LIMIT_MB"]);
    expect(limit).toBeGreaterThan(200);
    expect(limit).toBeLessThanOrEqual(300);
    expect(raw).toContain("Verify image size");
    expect(raw).toContain('if [ "${size_mb}" -gt "${IMAGE_SIZE_LIMIT_MB}" ]');
    expect(raw).toContain("exit 1");
  });

  it("enables provenance + SBOM attestations for supply-chain transparency", () => {
    expect(raw).toMatch(/provenance:\s*true/);
    expect(raw).toMatch(/sbom:\s*true/);
  });

  it("sets up Buildx + QEMU for reproducible builds", () => {
    expect(raw).toContain("uses: docker/setup-buildx-action@v3");
    expect(raw).toContain("uses: docker/setup-qemu-action@v4");
  });

  it("emits a release summary referencing all three tag forms", () => {
    expect(raw).toContain("$GITHUB_STEP_SUMMARY");
    expect(raw).toContain("docker pull ${REGISTRY}/${IMAGE_NAME}:${{ steps.version.outputs.version }}");
    expect(raw).toContain("docker pull ${REGISTRY}/${IMAGE_NAME}:latest");
    expect(raw).toContain("docker pull ${REGISTRY}/${IMAGE_NAME}:sha-${GITHUB_SHA}");
  });

  it("declares a single job named `publish`", () => {
    expect(doc.jobs).toBeDefined();
    expect(Object.keys(doc.jobs ?? {})).toEqual(["publish"]);
  });

  it("runs on ubuntu-latest (the only image hosting Docker by default)", () => {
    expect(raw).toContain("runs-on: ubuntu-latest");
  });
});
