/**
 * Regression tests for CONCERN 1:
 * `environmentLoaderFactory` was optional in EntryDeps, allowing a consumer
 * to construct EntryDeps without a factory. The missing factory fell back to
 * `buildStubEnvLoaderFactory`, which fabricated a prod:false environment,
 * potentially bypassing the prod-safety gate.
 *
 * After the fix:
 * - `EntryDeps.environmentLoaderFactory` is REQUIRED (non-optional).
 * - `buildStubEnvLoaderFactory` is removed from the production entry path and
 *   exported as `buildTestStubEnvLoaderFactory` for test use only.
 * - The type system forbids constructing EntryDeps without a factory.
 *
 * These tests confirm:
 * 1. A valid EntryDeps with environmentLoaderFactory passes TypeScript.
 * 2. The exported `buildTestStubEnvLoaderFactory` is usable in tests.
 * 3. When the env is prod:true, the prod-safety gate fires (not bypassed).
 */

import { describe, it, expect, vi } from "vitest";

import {
  buildProgram,
  buildTestStubEnvLoaderFactory,
  type EntryDeps,
} from "../../../../src/cli/entry.js";
import { ExitCode } from "../../../../src/cli/exit-codes.js";
import { ProdSafetyGate } from "../../../../src/cli/prod-safety.js";
import { NotImplementedTestRunner } from "../../../../src/cli/seams/test-runner.js";
import { NotImplementedImporter } from "../../../../src/cli/seams/importer.js";
import { NotImplementedDocsGenerator } from "../../../../src/cli/seams/docs-generator.js";
import { ConfigLoader } from "../../../../src/cli/config/loader.js";
import { EnvironmentLoader } from "../../../../src/env/loader.js";
import type { Logger } from "../../../../src/cli/logging/logger.js";
import type { ApiwrightConfig } from "../../../../src/cli/config/types.js";

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

function makeFakeLogger(): Logger {
  return {
    level: "warn",
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  };
}

function makeFakeConfigLoaderFactory(): (configPath?: string) => ConfigLoader {
  return vi.fn((_?: string) => ({
    load: vi.fn().mockReturnValue({ valid: true, config: BASE_CONFIG }),
  })) as unknown as (configPath?: string) => ConfigLoader;
}

class FakeExitError extends Error {
  constructor(public readonly code: ExitCode) {
    super(`exit(${code})`);
  }
}

describe("CONCERN 1 — environmentLoaderFactory is required in EntryDeps", () => {
  it("EntryDeps type requires environmentLoaderFactory — providing it does not error", () => {
    // TypeScript-level check: constructing a valid EntryDeps with the required
    // factory compiles and runs without runtime error.
    const deps: EntryDeps = {
      configLoaderFactory: makeFakeConfigLoaderFactory(),
      prodSafetyGate: { evaluate: vi.fn() } as unknown as ProdSafetyGate,
      testRunner: new NotImplementedTestRunner(),
      importer: new NotImplementedImporter(),
      docsGenerator: new NotImplementedDocsGenerator(),
      loggerFactory: () => makeFakeLogger(),
      exit: vi.fn((code: ExitCode): never => {
        throw new FakeExitError(code);
      }),
      env: {},
      environmentLoaderFactory: buildTestStubEnvLoaderFactory(),
    };

    // buildProgram uses the factory and should not throw at construction time
    expect(() => buildProgram(deps)).not.toThrow();
  });

  it("buildTestStubEnvLoaderFactory is exported and usable in tests", () => {
    const factory = buildTestStubEnvLoaderFactory();
    expect(typeof factory).toBe("function");

    const loader = factory(".", {});
    expect(typeof loader.load).toBe("function");
  });

  it("stub factory returns valid non-prod env when no YAML file exists", () => {
    const factory = buildTestStubEnvLoaderFactory();
    const loader = factory("/nonexistent/path", {});
    const result = loader.load("qa");
    // Stub falls back to valid=true with prod:false
    expect(result.valid).toBe(true);
    expect(result.environment?.prod).toBe(false);
  });

  it("prod-safety gate fires when env has prod:true (not bypassed by stub)", async () => {
    // This test confirms a prod:true environment (from a real loader) still
    // causes the gate to evaluate — the stub does NOT bypass it because the
    // stub only activates when the real load fails.
    const mockGate = {
      evaluate: vi
        .fn()
        .mockResolvedValue({ allowed: false, reason: "declined" }),
    } as unknown as ProdSafetyGate;

    // Provide a factory that returns a prod:true environment
    const prodEnvFactory = vi.fn(() => ({
      load: vi.fn().mockReturnValue({
        valid: true,
        environment: {
          name: "prod",
          prod: true,
          base_url: "https://prod.example.com",
        },
        secretRegistry: new Map(),
      }),
    })) as unknown as (
      rootDir: string,
      env: NodeJS.ProcessEnv,
    ) => EnvironmentLoader;

    const deps: EntryDeps = {
      configLoaderFactory: makeFakeConfigLoaderFactory(),
      prodSafetyGate: mockGate,
      testRunner: new NotImplementedTestRunner(),
      importer: new NotImplementedImporter(),
      docsGenerator: new NotImplementedDocsGenerator(),
      loggerFactory: () => makeFakeLogger(),
      exit: vi.fn((code: ExitCode): never => {
        throw new FakeExitError(code);
      }),
      env: {},
      environmentLoaderFactory: prodEnvFactory,
    };

    const program = buildProgram(deps);
    try {
      await program.parseAsync([
        "node",
        "apiwright",
        "run",
        "--env=prod",
        "--markers=regression",
      ]);
    } catch {
      // FakeExitError(PROD_SAFETY=4) expected
    }

    // Gate was called (not bypassed) even though markers are non-smoke
    expect(mockGate.evaluate).toHaveBeenCalled();
  });
});
