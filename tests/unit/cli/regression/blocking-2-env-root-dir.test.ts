/**
 * Regression tests for BLOCKING 2:
 * `environments_dir` was wrongly passed as EnvironmentLoader rootDir.
 *
 * With the canonical layout `./environments/qa.yaml` and config
 * `environments_dir: "./environments"`, the old code passed `"./environments"`
 * as `rootDir`. EnvironmentLoader then looked for
 * `"./environments/environments/qa.yaml"` — never finding `"./environments/qa.yaml"`.
 *
 * The fix: pass `dirname(resolve(config.environments_dir))` so the loader's
 * appended `environments/` segment lands on the configured dir.
 *
 * These tests use the REAL EnvironmentLoader (no fake factory) to confirm the
 * production wiring. They FAIL against the pre-fix code and PASS after the fix.
 */

import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { vi } from "vitest";

import { RunCommand } from "../../../../src/cli/commands/run.js";
import { ProdSafetyGate } from "../../../../src/cli/prod-safety.js";
import { NotImplementedTestRunner } from "../../../../src/cli/seams/test-runner.js";
import {
  NotImplementedError,
  ConfigError,
} from "../../../../src/cli/errors.js";
import type { Logger } from "../../../../src/cli/logging/logger.js";
import type { ApiwrightConfig } from "../../../../src/cli/config/types.js";
import { ConfigLoader } from "../../../../src/cli/config/loader.js";

function makeFakeLogger(): Logger {
  return {
    level: "warn",
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  };
}

function makeFakeProdGate(): ProdSafetyGate {
  return {
    evaluate: vi.fn().mockResolvedValue({ allowed: true }),
  } as unknown as ProdSafetyGate;
}

const BASE_CONFIG: ApiwrightConfig = {
  tests_dir: "./tests",
  environments_dir: "./environments",
  reports_dir: "./reports",
  default_env: "qa",
  default_markers: ["smoke"],
  log_level: "warn",
  workers: 8,
  retry: { count: 2, delay_ms: 1000, backoff: "linear", strict: false },
  report: { html: true, json: true, junit_xml: true, output_dir: "./reports" },
};

describe("BLOCKING 2 — environments_dir rootDir computation with real EnvironmentLoader", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "apiwright-b2-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("finds qa.yaml at <tmpDir>/environments/qa.yaml when environments_dir=<tmpDir>/environments", async () => {
    // This is the spec-canonical layout: environments/ dir contains qa.yaml.
    // environments_dir points AT the environments/ dir.
    // After the fix: rootDir = dirname(resolve(environments_dir)) = tmpDir
    // EnvironmentLoader looks for: tmpDir/.env.qa.yaml (miss) and
    //   tmpDir/environments/qa.yaml (HIT).
    const envsDir = join(tmpDir, "environments");
    mkdirSync(envsDir);
    writeFileSync(
      join(envsDir, "qa.yaml"),
      "name: qa\nprod: false\nbase_url: https://api.example.com\n",
      "utf8",
    );

    const cmd = new RunCommand({
      configLoaderFactory: (_?: string) =>
        ({
          load: vi.fn().mockReturnValue({
            valid: true,
            config: { ...BASE_CONFIG, environments_dir: envsDir },
          }),
        }) as unknown as ConfigLoader,
      prodSafetyGate: makeFakeProdGate(),
      // No environmentLoaderFactory → uses the REAL default factory
      testRunner: new NotImplementedTestRunner(),
      loggerFactory: makeFakeLogger,
    });

    // If rootDir is wrong, EnvironmentLoader would look for
    // <envsDir>/environments/qa.yaml → not found → ConfigError.
    // If rootDir is correct (tmpDir), it finds <tmpDir>/environments/qa.yaml
    // → env loads → reaches seam → NotImplementedError.
    await expect(cmd.execute({})).rejects.toThrow(NotImplementedError);
  });

  it("finds .env.qa.yaml at <tmpDir>/.env.qa.yaml when environments_dir=<tmpDir>/environments", async () => {
    // The dot-file layout: .env.qa.yaml lives at rootDir (= tmpDir).
    // environments_dir still points to <tmpDir>/environments (canonical default).
    // After fix: rootDir = tmpDir → loader finds tmpDir/.env.qa.yaml.
    const envsDir = join(tmpDir, "environments");
    writeFileSync(
      join(tmpDir, ".env.qa.yaml"),
      "name: qa\nprod: false\nbase_url: https://api.example.com\n",
      "utf8",
    );

    const cmd = new RunCommand({
      configLoaderFactory: (_?: string) =>
        ({
          load: vi.fn().mockReturnValue({
            valid: true,
            config: { ...BASE_CONFIG, environments_dir: envsDir },
          }),
        }) as unknown as ConfigLoader,
      prodSafetyGate: makeFakeProdGate(),
      testRunner: new NotImplementedTestRunner(),
      loggerFactory: makeFakeLogger,
    });

    await expect(cmd.execute({})).rejects.toThrow(NotImplementedError);
  });

  it("fails with ConfigError (not crashes) when the env file is absent", async () => {
    // No env file at all → EnvironmentLoader returns valid=false → ConfigError.
    const envsDir = join(tmpDir, "environments");

    const cmd = new RunCommand({
      configLoaderFactory: (_?: string) =>
        ({
          load: vi.fn().mockReturnValue({
            valid: true,
            config: { ...BASE_CONFIG, environments_dir: envsDir },
          }),
        }) as unknown as ConfigLoader,
      prodSafetyGate: makeFakeProdGate(),
      testRunner: new NotImplementedTestRunner(),
      loggerFactory: makeFakeLogger,
    });

    await expect(cmd.execute({})).rejects.toThrow(ConfigError);
  });

  it("prod-safety gate fires correctly with real env marked prod:true", async () => {
    // Confirm the entire pipeline works end-to-end:
    // real env file with prod:true → gate evaluates → prod:true passed.
    const envsDir = join(tmpDir, "environments");
    mkdirSync(envsDir);
    writeFileSync(
      join(envsDir, "qa.yaml"),
      "name: qa\nprod: true\nbase_url: https://prod.example.com\n",
      "utf8",
    );

    const mockGate = {
      evaluate: vi.fn().mockResolvedValue({ allowed: true }),
    } as unknown as ProdSafetyGate;

    const cmd = new RunCommand({
      configLoaderFactory: (_?: string) =>
        ({
          load: vi.fn().mockReturnValue({
            valid: true,
            config: { ...BASE_CONFIG, environments_dir: envsDir },
          }),
        }) as unknown as ConfigLoader,
      prodSafetyGate: mockGate,
      testRunner: new NotImplementedTestRunner(),
      loggerFactory: makeFakeLogger,
    });

    try {
      await cmd.execute({ markers: "smoke" });
    } catch {
      // NotImplementedError expected
    }

    // Gate was called with prodEnvironment: true (read from the real env file)
    expect(mockGate.evaluate).toHaveBeenCalledWith(
      expect.objectContaining({ prodEnvironment: true }),
    );
  });
});
