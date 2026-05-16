import { describe, it, expect, vi } from "vitest";

import { ImportCommand } from "../../../../src/cli/commands/import.js";
import type { ImportCommandOptions } from "../../../../src/cli/commands/import.js";
import { ConfigLoader } from "../../../../src/cli/config/loader.js";
import { NotImplementedImporter } from "../../../../src/cli/seams/importer.js";
import type { Importer } from "../../../../src/cli/seams/importer.js";
import { NotImplementedError } from "../../../../src/cli/errors.js";
import { ExitCode } from "../../../../src/cli/exit-codes.js";
import type { Logger } from "../../../../src/cli/logging/logger.js";
import type { ApiwrightConfig } from "../../../../src/cli/config/types.js";

/**
 * Unit tests for ImportCommand.postman() and ImportCommand.openapi().
 *
 * Verifies delegation to the Importer seam, config load failure propagation,
 * and that NotImplementedImporter errors surface correctly.
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
  overrides: Partial<ImportCommandOptions> = {},
): ImportCommandOptions {
  return {
    configLoaderFactory: makeFakeConfigLoaderFactory({
      valid: true,
      config: DEFAULT_CONFIG,
    }),
    importer: new NotImplementedImporter(),
    loggerFactory: makeFakeLogger,
    ...overrides,
  };
}

describe("ImportCommand.postman()", () => {
  it("throws NotImplementedError when using default NotImplementedImporter", async () => {
    const cmd = new ImportCommand(makeOptions());
    await expect(
      cmd.postman("collection.json", { outputDir: "./tests" }),
    ).rejects.toThrow(NotImplementedError);
  });

  it("thrown error names Task #4", async () => {
    const cmd = new ImportCommand(makeOptions());
    let caught: unknown;
    try {
      await cmd.postman("x.json", { outputDir: "./out" });
    } catch (e) {
      caught = e;
    }
    expect((caught as NotImplementedError).message).toContain("Task #4");
  });

  it("thrown error has ExitCode.NOT_IMPLEMENTED (5)", async () => {
    const cmd = new ImportCommand(makeOptions());
    let caught: unknown;
    try {
      await cmd.postman("x.json", { outputDir: "./out" });
    } catch (e) {
      caught = e;
    }
    expect((caught as NotImplementedError).code).toBe(ExitCode.NOT_IMPLEMENTED);
  });

  it("delegates to importer.postman with correct args", async () => {
    const fakeImporter: Importer = {
      postman: vi.fn().mockResolvedValue({ written: 3, warnings: [] }),
      openapi: vi.fn(),
    };
    const cmd = new ImportCommand(makeOptions({ importer: fakeImporter }));
    await cmd.postman("collection.json", { outputDir: "./tests" });
    expect(fakeImporter.postman).toHaveBeenCalledWith(
      expect.objectContaining({
        file: "collection.json",
        outputDir: "./tests",
      }),
    );
  });

  it("throws ConfigError when config load fails", async () => {
    const { ConfigError } = await import("../../../../src/cli/errors.js");
    const opts = makeOptions({
      configLoaderFactory: makeFakeConfigLoaderFactory({
        valid: false,
        errors: ["invalid config"],
      }),
    });
    const cmd = new ImportCommand(opts);
    await expect(cmd.postman("x.json", { outputDir: "./out" })).rejects.toThrow(
      ConfigError,
    );
  });
});

describe("ImportCommand — default NotImplementedImporter seam wiring", () => {
  it("uses NotImplementedImporter when no importer option is given (postman rejects)", async () => {
    // No importer injected → default NotImplementedImporter used.
    const cmd = new ImportCommand({
      configLoaderFactory: makeFakeConfigLoaderFactory({
        valid: true,
        config: DEFAULT_CONFIG,
      }),
      loggerFactory: makeFakeLogger,
    });
    await expect(
      cmd.postman("collection.json", { outputDir: "./out" }),
    ).rejects.toThrow(NotImplementedError);
  });

  it("uses NotImplementedImporter when no importer option is given (openapi rejects)", async () => {
    // No importer injected → default NotImplementedImporter used.
    const cmd = new ImportCommand({
      configLoaderFactory: makeFakeConfigLoaderFactory({
        valid: true,
        config: DEFAULT_CONFIG,
      }),
      loggerFactory: makeFakeLogger,
    });
    await expect(
      cmd.openapi("spec.yaml", { outputDir: "./out" }),
    ).rejects.toThrow(NotImplementedError);
  });
});

describe("ImportCommand.openapi()", () => {
  it("throws NotImplementedError when using default NotImplementedImporter", async () => {
    const cmd = new ImportCommand(makeOptions());
    await expect(
      cmd.openapi("openapi.yaml", { outputDir: "./tests" }),
    ).rejects.toThrow(NotImplementedError);
  });

  it("thrown error names Task #5", async () => {
    const cmd = new ImportCommand(makeOptions());
    let caught: unknown;
    try {
      await cmd.openapi("spec.yaml", { outputDir: "./out" });
    } catch (e) {
      caught = e;
    }
    expect((caught as NotImplementedError).message).toContain("Task #5");
  });

  it("thrown error has ExitCode.NOT_IMPLEMENTED (5)", async () => {
    const cmd = new ImportCommand(makeOptions());
    let caught: unknown;
    try {
      await cmd.openapi("spec.yaml", { outputDir: "./out" });
    } catch (e) {
      caught = e;
    }
    expect((caught as NotImplementedError).code).toBe(ExitCode.NOT_IMPLEMENTED);
  });

  it("delegates to importer.openapi with correct args", async () => {
    const fakeImporter: Importer = {
      postman: vi.fn(),
      openapi: vi.fn().mockResolvedValue({ written: 7, warnings: [] }),
    };
    const cmd = new ImportCommand(makeOptions({ importer: fakeImporter }));
    await cmd.openapi("https://example.com/api.json", { outputDir: "./tests" });
    expect(fakeImporter.openapi).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "https://example.com/api.json",
        outputDir: "./tests",
      }),
    );
  });
});
