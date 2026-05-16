import { describe, it, expect, vi } from "vitest";

import { DocsCommand } from "../../../../src/cli/commands/docs.js";
import type { DocsCommandOptions } from "../../../../src/cli/commands/docs.js";
import { ConfigLoader } from "../../../../src/cli/config/loader.js";
import { NotImplementedDocsGenerator } from "../../../../src/cli/seams/docs-generator.js";
import type { DocsGenerator } from "../../../../src/cli/seams/docs-generator.js";
import { NotImplementedError } from "../../../../src/cli/errors.js";
import { ExitCode } from "../../../../src/cli/exit-codes.js";
import type { Logger } from "../../../../src/cli/logging/logger.js";
import type { ApiwrightConfig } from "../../../../src/cli/config/types.js";

/**
 * Unit tests for DocsCommand.generate().
 *
 * Verifies delegation to the DocsGenerator seam, config load failure
 * propagation, and that NotImplementedDocsGenerator errors surface correctly.
 */

const DEFAULT_CONFIG: ApiwrightConfig = {
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

function makeFakeConfigLoaderFactory(result: {
  valid: boolean;
  config?: ApiwrightConfig;
  errors?: string[];
}): (configPath?: string) => ConfigLoader {
  return vi.fn((_configPath?: string) => ({
    load: vi.fn().mockReturnValue(result),
  })) as unknown as (configPath?: string) => ConfigLoader;
}

function makeOptions(
  overrides: Partial<DocsCommandOptions> = {},
): DocsCommandOptions {
  return {
    configLoaderFactory: makeFakeConfigLoaderFactory({
      valid: true,
      config: DEFAULT_CONFIG,
    }),
    docsGenerator: new NotImplementedDocsGenerator(),
    loggerFactory: makeFakeLogger,
    ...overrides,
  };
}

describe("DocsCommand — default NotImplementedDocsGenerator seam wiring", () => {
  it("uses NotImplementedDocsGenerator when no docsGenerator option is given", async () => {
    // No docsGenerator injected → default NotImplementedDocsGenerator used.
    const cmd = new DocsCommand({
      configLoaderFactory: makeFakeConfigLoaderFactory({
        valid: true,
        config: DEFAULT_CONFIG,
      }),
      loggerFactory: makeFakeLogger,
    });
    await expect(cmd.generate({ outputDir: "./docs" })).rejects.toThrow(
      NotImplementedError,
    );
  });

  it("rejected error names Task #11 when using default seam", async () => {
    const cmd = new DocsCommand({
      configLoaderFactory: makeFakeConfigLoaderFactory({
        valid: true,
        config: DEFAULT_CONFIG,
      }),
      loggerFactory: makeFakeLogger,
    });
    let caught: unknown;
    try {
      await cmd.generate({ outputDir: "./docs" });
    } catch (e) {
      caught = e;
    }
    expect((caught as NotImplementedError).message).toContain("Task #11");
  });
});

describe("DocsCommand.generate()", () => {
  it("throws NotImplementedError when using default NotImplementedDocsGenerator", async () => {
    const cmd = new DocsCommand(makeOptions());
    await expect(cmd.generate({ outputDir: "./docs" })).rejects.toThrow(
      NotImplementedError,
    );
  });

  it("thrown error names Task #11", async () => {
    const cmd = new DocsCommand(makeOptions());
    let caught: unknown;
    try {
      await cmd.generate({ outputDir: "./docs" });
    } catch (e) {
      caught = e;
    }
    expect((caught as NotImplementedError).message).toContain("Task #11");
  });

  it("thrown error has ExitCode.NOT_IMPLEMENTED (5)", async () => {
    const cmd = new DocsCommand(makeOptions());
    let caught: unknown;
    try {
      await cmd.generate({ outputDir: "./docs" });
    } catch (e) {
      caught = e;
    }
    expect((caught as NotImplementedError).code).toBe(ExitCode.NOT_IMPLEMENTED);
  });

  it("delegates to docsGenerator.generate with sourceDir and outputDir", async () => {
    const fakeGen: DocsGenerator = {
      generate: vi.fn().mockResolvedValue({ written: 5 }),
    };
    const cmd = new DocsCommand(makeOptions({ docsGenerator: fakeGen }));
    await cmd.generate({ outputDir: "./docs" });
    expect(fakeGen.generate).toHaveBeenCalledWith(
      expect.objectContaining({ outputDir: "./docs" }),
    );
  });

  it("delegates with sourceDir from config.tests_dir when no override given", async () => {
    const fakeGen: DocsGenerator = {
      generate: vi.fn().mockResolvedValue({ written: 2 }),
    };
    const cmd = new DocsCommand(makeOptions({ docsGenerator: fakeGen }));
    await cmd.generate({ outputDir: "./docs" });
    expect(fakeGen.generate).toHaveBeenCalledWith(
      expect.objectContaining({ sourceDir: "./tests" }),
    );
  });

  it("throws ConfigError when config load fails", async () => {
    const { ConfigError } = await import("../../../../src/cli/errors.js");
    const opts = makeOptions({
      configLoaderFactory: makeFakeConfigLoaderFactory({
        valid: false,
        errors: ["bad config"],
      }),
    });
    const cmd = new DocsCommand(opts);
    await expect(cmd.generate({ outputDir: "./docs" })).rejects.toThrow(
      ConfigError,
    );
  });

  it("delegates with explicit sourceDir override when provided", async () => {
    const fakeGen: DocsGenerator = {
      generate: vi.fn().mockResolvedValue({ written: 3 }),
    };
    const cmd = new DocsCommand(makeOptions({ docsGenerator: fakeGen }));
    await cmd.generate({ outputDir: "./docs", sourceDir: "./custom-src" });
    expect(fakeGen.generate).toHaveBeenCalledWith(
      expect.objectContaining({ sourceDir: "./custom-src" }),
    );
  });
});
