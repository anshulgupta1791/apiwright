/**
 * Regression tests for BLOCKING 1:
 * `--config <path>` flag is parsed but was never reaching ConfigLoader.
 *
 * These tests confirm that `apiwright run --config ./custom.json` causes the
 * loader to be built with `configPath = "./custom.json"` (not the default).
 *
 * Prior to the fix, RunCommand held a pre-built ConfigLoader with no configPath,
 * so the custom path was silently discarded. After the fix, commands accept a
 * configLoaderFactory and forward flags.config on each invocation.
 */

import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";

import { RunCommand } from "../../../../src/cli/commands/run.js";
import { ImportCommand } from "../../../../src/cli/commands/import.js";
import { DocsCommand } from "../../../../src/cli/commands/docs.js";
import { ConfigLoader } from "../../../../src/cli/config/loader.js";
import { ProdSafetyGate } from "../../../../src/cli/prod-safety.js";
import { NotImplementedTestRunner } from "../../../../src/cli/seams/test-runner.js";
import { NotImplementedDocsGenerator } from "../../../../src/cli/seams/docs-generator.js";
import { NotImplementedImporter } from "../../../../src/cli/seams/importer.js";
import { NotImplementedError } from "../../../../src/cli/errors.js";
import { EnvironmentLoader } from "../../../../src/env/loader.js";
import type { Logger } from "../../../../src/cli/logging/logger.js";
import type { ApiwrightConfig } from "../../../../src/cli/config/types.js";
import {
  buildProgram,
  buildTestStubEnvLoaderFactory,
  type EntryDeps,
} from "../../../../src/cli/entry.js";
import { ExitCode } from "../../../../src/cli/exit-codes.js";

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

function makeFakeEnvLoaderFactory(): (rootDir: string) => EnvironmentLoader {
  return vi.fn(() => ({
    load: vi.fn().mockReturnValue({
      valid: true,
      environment: { name: "qa", prod: false, base_url: "https://example.com" },
      secretRegistry: new Map(),
    }),
  })) as unknown as (rootDir: string) => EnvironmentLoader;
}

describe("BLOCKING 1 — RunCommand: --config path reaches configLoaderFactory", () => {
  it("forwards flags.config to configLoaderFactory as configPath", async () => {
    const capturedPaths: Array<string | undefined> = [];
    const factory = vi.fn((configPath?: string) => {
      capturedPaths.push(configPath);
      return {
        load: vi.fn().mockReturnValue({ valid: true, config: BASE_CONFIG }),
      } as unknown as ConfigLoader;
    });

    const cmd = new RunCommand({
      configLoaderFactory: factory,
      prodSafetyGate: {
        evaluate: vi.fn().mockResolvedValue({ allowed: true }),
      } as unknown as ProdSafetyGate,
      environmentLoaderFactory: makeFakeEnvLoaderFactory(),
      testRunner: new NotImplementedTestRunner(),
      loggerFactory: makeFakeLogger,
    });

    try {
      await cmd.execute({ config: "./custom.json" });
    } catch {
      // NotImplementedError expected
    }

    expect(capturedPaths).toContain("./custom.json");
  });

  it("loads from the custom config file when --config path is a real file in a tmp dir", async () => {
    // This test confirms the real wiring — not a fake — so a real ConfigLoader
    // pointed at a custom-named file gets its values.
    const tmpDir = mkdtempSync(join(tmpdir(), "apiwright-b1-"));
    try {
      const customConfig: Partial<ApiwrightConfig> = {
        workers: 3,
        log_level: "debug",
      };
      const customPath = join(tmpDir, "my-apiwright.config.json");
      writeFileSync(customPath, JSON.stringify(customConfig), "utf8");

      // Real ConfigLoader factory that honours configPath
      const factory = (configPath?: string) => new ConfigLoader({ configPath });

      let receivedWorkers: number | undefined;
      const captureRunner = {
        run: vi
          .fn()
          .mockImplementation(async (input: { settings: ApiwrightConfig }) => {
            // The settings.config (originally the loaded config) carries workers
            receivedWorkers = (
              input as { settings: { config: ApiwrightConfig } }
            ).settings.config.workers;
            return { total: 0, passed: 0, failed: 0, flaky: 0 };
          }),
      };

      const cmd = new RunCommand({
        configLoaderFactory: factory,
        prodSafetyGate: {
          evaluate: vi.fn().mockResolvedValue({ allowed: true }),
        } as unknown as ProdSafetyGate,
        environmentLoaderFactory: makeFakeEnvLoaderFactory(),
        testRunner: captureRunner,
        loggerFactory: makeFakeLogger,
      });

      await cmd.execute({ config: customPath });

      // custom config has workers=3, not the default 8
      expect(receivedWorkers).toBe(3);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("without --config, configLoaderFactory receives undefined (uses default path)", async () => {
    const capturedPaths: Array<string | undefined> = [];
    const factory = vi.fn((configPath?: string) => {
      capturedPaths.push(configPath);
      return {
        load: vi.fn().mockReturnValue({ valid: true, config: BASE_CONFIG }),
      } as unknown as ConfigLoader;
    });

    const cmd = new RunCommand({
      configLoaderFactory: factory,
      prodSafetyGate: {
        evaluate: vi.fn().mockResolvedValue({ allowed: true }),
      } as unknown as ProdSafetyGate,
      environmentLoaderFactory: makeFakeEnvLoaderFactory(),
      testRunner: new NotImplementedTestRunner(),
      loggerFactory: makeFakeLogger,
    });

    try {
      await cmd.execute({});
    } catch {
      // NotImplementedError expected
    }

    expect(capturedPaths).toContain(undefined);
  });
});

describe("BLOCKING 1 — entry.ts: --config flag wired through to configLoaderFactory", () => {
  let tmpDir: string;
  class FakeExitError extends Error {
    constructor(public readonly code: ExitCode) {
      super(`exit(${code})`);
    }
  }

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "apiwright-b1-entry-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("run --config ./x.json passes './x.json' to configLoaderFactory", async () => {
    const capturedPaths: Array<string | undefined> = [];

    const deps: EntryDeps = {
      configLoaderFactory: vi.fn((configPath?: string) => {
        capturedPaths.push(configPath);
        return {
          load: vi.fn().mockReturnValue({ valid: true, config: BASE_CONFIG }),
        } as unknown as ConfigLoader;
      }),
      prodSafetyGate: {
        evaluate: vi.fn().mockResolvedValue({ allowed: true }),
      } as unknown as ProdSafetyGate,
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

    const program = buildProgram(deps);
    try {
      await program.parseAsync([
        "node",
        "apiwright",
        "run",
        "--config",
        "./x.json",
      ]);
    } catch {
      // FakeExitError expected (NOT_IMPLEMENTED)
    }

    expect(capturedPaths).toContain("./x.json");
  });
});
