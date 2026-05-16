/**
 * Regression tests for CONCERN 3:
 * `docs generate` handler supported sourceDir but entry.ts never wired --source.
 *
 * Before the fix, `apiwright docs generate --source ./x --output ./y` had no
 * `--source` option registered, so commander would reject the flag as unknown.
 * After the fix, `--source <dir>` is wired on `docs generate` and forwarded to
 * DocsCommand.generate({ sourceDir }) which passes it to the DocsGenerator seam.
 *
 * These tests confirm:
 * 1. `docs generate --source ./x --output ./y` reaches the seam with sourceDir=./x.
 * 2. Without --source, sourceDir falls back to config.tests_dir.
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
import { ConfigLoader } from "../../../../src/cli/config/loader.js";
import type {
  DocsGenerator,
  DocsOutcome,
} from "../../../../src/cli/seams/docs-generator.js";
import { NotImplementedDocsGenerator } from "../../../../src/cli/seams/docs-generator.js";
import type { Logger } from "../../../../src/cli/logging/logger.js";
import type { ApiwrightConfig } from "../../../../src/cli/config/types.js";

const BASE_CONFIG: ApiwrightConfig = {
  tests_dir: "./default-tests",
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

function makeDeps(docsGenerator: DocsGenerator): EntryDeps {
  return {
    configLoaderFactory: makeFakeConfigLoaderFactory(),
    prodSafetyGate: { evaluate: vi.fn() } as unknown as ProdSafetyGate,
    testRunner: new NotImplementedTestRunner(),
    importer: new NotImplementedImporter(),
    docsGenerator,
    loggerFactory: () => makeFakeLogger(),
    exit: vi.fn((code: ExitCode): never => {
      throw new FakeExitError(code);
    }),
    env: {},
    environmentLoaderFactory: buildTestStubEnvLoaderFactory(),
  };
}

describe("CONCERN 3 — docs generate --source forwards sourceDir to seam", () => {
  it("forwards --source to DocsGenerator.generate as sourceDir", async () => {
    const capturedInputs: Array<{ sourceDir: string; outputDir: string }> = [];

    const fakeGen: DocsGenerator = {
      generate: vi.fn(
        async (input: {
          sourceDir: string;
          outputDir: string;
        }): Promise<DocsOutcome> => {
          capturedInputs.push(input);
          return { written: 0 };
        },
      ),
    };

    const program = buildProgram(makeDeps(fakeGen));

    await program.parseAsync([
      "node",
      "apiwright",
      "docs",
      "generate",
      "--source",
      "./custom-source",
      "--output",
      "./custom-output",
    ]);

    expect(capturedInputs).toHaveLength(1);
    expect(capturedInputs[0]?.sourceDir).toBe("./custom-source");
    expect(capturedInputs[0]?.outputDir).toBe("./custom-output");
  });

  it("uses config.tests_dir as sourceDir when --source is absent", async () => {
    const capturedInputs: Array<{ sourceDir: string; outputDir: string }> = [];

    const fakeGen: DocsGenerator = {
      generate: vi.fn(
        async (input: {
          sourceDir: string;
          outputDir: string;
        }): Promise<DocsOutcome> => {
          capturedInputs.push(input);
          return { written: 0 };
        },
      ),
    };

    const program = buildProgram(makeDeps(fakeGen));

    await program.parseAsync([
      "node",
      "apiwright",
      "docs",
      "generate",
      "--output",
      "./docs",
    ]);

    expect(capturedInputs).toHaveLength(1);
    // Falls back to config.tests_dir = "./default-tests"
    expect(capturedInputs[0]?.sourceDir).toBe("./default-tests");
  });

  it("does NOT reject --source as an unknown option (pre-fix: no such option was registered)", async () => {
    // Before the fix, this would throw/error with an unknown option message.
    // After the fix, it runs cleanly and reaches the seam.
    const fakeGen: DocsGenerator = {
      generate: vi.fn(async (): Promise<DocsOutcome> => ({ written: 0 })),
    };

    const program = buildProgram(makeDeps(fakeGen));

    // Should resolve without throwing a CommanderError about unknown options
    await expect(
      program.parseAsync([
        "node",
        "apiwright",
        "docs",
        "generate",
        "--source",
        "./x",
        "--output",
        "./y",
      ]),
    ).resolves.not.toThrow();

    expect(fakeGen.generate).toHaveBeenCalledWith(
      expect.objectContaining({ sourceDir: "./x", outputDir: "./y" }),
    );
  });

  it("NotImplementedDocsGenerator still surfaces exit code 5 with --source flag", async () => {
    const deps = makeDeps(new NotImplementedDocsGenerator());

    const program = buildProgram(deps);
    let caughtCode: ExitCode | undefined;
    try {
      await program.parseAsync([
        "node",
        "apiwright",
        "docs",
        "generate",
        "--source",
        "./src",
        "--output",
        "./out",
      ]);
    } catch (e) {
      if (e instanceof FakeExitError) {
        caughtCode = e.code;
      }
    }

    expect(caughtCode).toBe(ExitCode.NOT_IMPLEMENTED);
  });
});
