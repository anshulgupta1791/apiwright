import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, it, expect } from "vitest";

// js-yaml is a CommonJS module — match the require() shim convention used
// in src/env/yaml-reader.ts.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const yaml = require("js-yaml") as {
  load: (input: string, opts?: { schema?: unknown }) => unknown;
  loadAll: (input: string, iter: (doc: unknown) => void, opts?: { schema?: unknown }) => void;
  JSON_SCHEMA: unknown;
};

const REPO_ROOT = join(__dirname, "..", "..", "..");
const EXAMPLES_DIR = join(REPO_ROOT, "examples");
const CI_DIR = join(EXAMPLES_DIR, "ci");

/** The four secret env vars every example must forward into the container. */
const REQUIRED_SECRETS = ["QA_DB_USER", "QA_DB_PASSWORD", "QA_USER", "QA_PASSWORD"];

/** The image coordinates documented in §13. */
const PUBLISHED_IMAGE = "ghcr.io/<org>/apiwright:1.0.0";

/** Mounts that surface tests/ + environments/ + reports/. */
const REQUIRED_MOUNTS = ["/app/tests", "/app/environments", "/app/reports"];

/** Reads a CI example as a string. */
async function read(file: string): Promise<string> {
  return readFile(join(CI_DIR, file), "utf8");
}

describe("examples/README.md", () => {
  it("exists and documents every CI platform shipped under examples/ci/", async () => {
    const md = await readFile(join(EXAMPLES_DIR, "README.md"), "utf8");
    expect(md).toContain("GitHub Actions");
    expect(md).toContain("Jenkins");
    expect(md).toContain("GitLab CI");
    expect(md).toContain("Azure Pipelines");
    expect(md).toContain("ci/github-actions.yml");
    expect(md).toContain("ci/Jenkinsfile");
    expect(md).toContain("ci/gitlab-ci.yml");
    expect(md).toContain("ci/azure-pipelines.yml");
  });

  it("warns readers to replace placeholders before committing", async () => {
    const md = await readFile(join(EXAMPLES_DIR, "README.md"), "utf8");
    expect(md.toLowerCase()).toContain("placeholder");
    expect(md).toContain("ghcr.io/<org>/apiwright:1.0.0");
  });
});

describe("examples/ci/github-actions.yml", () => {
  let text: string;
  let doc: Record<string, unknown>;

  it("parses as valid YAML", async () => {
    text = await read("github-actions.yml");
    doc = yaml.load(text, { schema: yaml.JSON_SCHEMA }) as Record<string, unknown>;
    expect(doc).toBeTypeOf("object");
    expect(doc["jobs"]).toBeDefined();
  });

  it("declares push + pull_request triggers on main", () => {
    expect(text).toMatch(/push:\s*\n\s*branches:\s*\[main\]/);
    expect(text).toMatch(/pull_request:\s*\n\s*branches:\s*\[main\]/);
  });

  it("runs the published Docker image", () => {
    expect(text).toContain(PUBLISHED_IMAGE);
  });

  it("forwards every required secret to the container", () => {
    for (const secret of REQUIRED_SECRETS) {
      expect(text).toContain(`${secret}: \${{ secrets.${secret} }}`);
      expect(text).toMatch(new RegExp(`-e\\s+${secret}`));
    }
  });

  it("mounts tests/ + environments/ + reports/", () => {
    for (const mount of REQUIRED_MOUNTS) {
      expect(text).toContain(mount);
    }
  });

  it("publishes the JUnit XML via dorny/test-reporter", () => {
    expect(text).toContain("dorny/test-reporter");
    expect(text).toContain("reports/*.xml");
  });

  it("uploads the reports/ directory as a build artifact", () => {
    expect(text).toContain("actions/upload-artifact");
    expect(text).toMatch(/path:\s*reports\//);
  });

  it("runs publishers on `always()` so failed runs still archive artifacts", () => {
    const matches = text.match(/if:\s*always\(\)/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });
});

describe("examples/ci/Jenkinsfile", () => {
  let text: string;

  it("loads as a non-empty file", async () => {
    text = await read("Jenkinsfile");
    expect(text.length).toBeGreaterThan(0);
  });

  it("declares a declarative pipeline with `agent any`", () => {
    expect(text).toContain("pipeline {");
    expect(text).toContain("agent any");
  });

  it("runs the published Docker image", () => {
    expect(text).toContain(PUBLISHED_IMAGE);
  });

  it("declares every secret in the environment{} block via credentials()", () => {
    for (const secret of REQUIRED_SECRETS) {
      expect(text).toMatch(new RegExp(`${secret}\\s*=\\s*credentials\\(`));
      expect(text).toMatch(new RegExp(`-e\\s+${secret}`));
    }
  });

  it("mounts tests/ + environments/ + reports/", () => {
    for (const mount of REQUIRED_MOUNTS) {
      expect(text).toContain(mount);
    }
  });

  it("publishes JUnit XML via the built-in `junit` step", () => {
    expect(text).toMatch(/junit\s+[^\n]*reports\/\*\.xml/);
  });

  it("archives the reports/ directory via archiveArtifacts", () => {
    expect(text).toContain("archiveArtifacts");
    expect(text).toContain("reports/**");
  });

  it("uses `post { always {} }` so artifacts are kept on failure too", () => {
    expect(text).toMatch(/post\s*\{[^}]*always\s*\{/s);
  });
});

describe("examples/ci/gitlab-ci.yml", () => {
  let text: string;
  let doc: Record<string, unknown>;

  it("parses as valid YAML", async () => {
    text = await read("gitlab-ci.yml");
    doc = yaml.load(text, { schema: yaml.JSON_SCHEMA }) as Record<string, unknown>;
    expect(doc).toBeTypeOf("object");
    expect(doc["stages"]).toBeDefined();
  });

  it("runs on the docker:24-cli image with the docker-in-docker service", () => {
    expect(text).toContain("image: docker:24-cli");
    expect(text).toContain("docker:24-dind");
  });

  it("runs the published Docker image", () => {
    expect(text).toContain(PUBLISHED_IMAGE);
  });

  it("passes every secret through `-e` (values injected by GitLab CI/CD vars)", () => {
    for (const secret of REQUIRED_SECRETS) {
      expect(text).toMatch(new RegExp(`-e\\s+${secret}`));
    }
  });

  it("mounts tests/ + environments/ + reports/", () => {
    for (const mount of REQUIRED_MOUNTS) {
      expect(text).toContain(mount);
    }
  });

  it("registers reports/*.xml as the JUnit artifact for the MR widget", () => {
    expect(text).toMatch(/reports:\s*\n\s+junit:\s*reports\/\*\.xml/);
  });

  it("archives the reports/ directory (when: always)", () => {
    expect(text).toMatch(/paths:\s*\n\s+-\s+reports\//);
    expect(text).toContain("when: always");
  });

  it("triggers on push + merge requests", () => {
    expect(text).toContain('$CI_PIPELINE_SOURCE == "push"');
    expect(text).toContain('$CI_PIPELINE_SOURCE == "merge_request_event"');
  });
});

describe("examples/ci/azure-pipelines.yml", () => {
  let text: string;
  let doc: Record<string, unknown>;

  it("parses as valid YAML", async () => {
    text = await read("azure-pipelines.yml");
    doc = yaml.load(text, { schema: yaml.JSON_SCHEMA }) as Record<string, unknown>;
    expect(doc).toBeTypeOf("object");
    expect(doc["steps"]).toBeDefined();
  });

  it("targets the ubuntu-latest hosted pool", () => {
    expect(text).toContain("vmImage: ubuntu-latest");
  });

  it("runs the published Docker image", () => {
    expect(text).toContain(PUBLISHED_IMAGE);
  });

  it("maps every pipeline secret into the docker run env block", () => {
    for (const secret of REQUIRED_SECRETS) {
      expect(text).toMatch(new RegExp(`${secret}:\\s+\\$\\(${secret}\\)`));
      expect(text).toMatch(new RegExp(`-e\\s+${secret}`));
    }
  });

  it("mounts tests/ + environments/ + reports/", () => {
    for (const mount of REQUIRED_MOUNTS) {
      expect(text).toContain(mount);
    }
  });

  it("publishes JUnit results via the PublishTestResults@2 task", () => {
    expect(text).toContain("PublishTestResults@2");
    expect(text).toContain("testResultsFormat: JUnit");
    expect(text).toContain("testResultsFiles: reports/*.xml");
  });

  it("publishes the reports/ directory via PublishBuildArtifacts@1", () => {
    expect(text).toContain("PublishBuildArtifacts@1");
    expect(text).toMatch(/pathToPublish:\s*reports/);
  });

  it("runs publishers on `condition: always()` so failed runs still archive", () => {
    const matches = text.match(/condition:\s*always\(\)/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });
});

describe("All CI examples — invariants", () => {
  const yamlFiles = ["github-actions.yml", "gitlab-ci.yml", "azure-pipelines.yml"];

  it("every YAML file parses cleanly under the safe JSON_SCHEMA", async () => {
    for (const f of yamlFiles) {
      const text = await read(f);
      expect(() => yaml.load(text, { schema: yaml.JSON_SCHEMA })).not.toThrow();
    }
  });

  it("every example references the spec-mandated image coordinates", async () => {
    for (const f of [...yamlFiles, "Jenkinsfile"]) {
      const text = await read(f);
      expect(text, `${f} missing ${PUBLISHED_IMAGE}`).toContain(PUBLISHED_IMAGE);
    }
  });

  it("every example archives JUnit XML AND publishes the HTML report (spec §14)", async () => {
    for (const f of [...yamlFiles, "Jenkinsfile"]) {
      const text = await read(f);
      // JUnit XML — the file name is always reports/*.xml regardless of platform.
      expect(text, `${f} missing JUnit XML reference`).toMatch(/reports\/\*\.xml|reports\/\*\*\.xml|reports\*\.xml|reports\/\*\*/);
      // HTML report ships inside reports/ — archiving the directory satisfies the rule.
      expect(text, `${f} missing reports/ artifact`).toMatch(/reports\b/);
    }
  });
});
