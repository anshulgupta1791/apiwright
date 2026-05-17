import { describe, expect, it } from "vitest";

import {
  buildProgram,
  main,
  buildTestStubEnvLoaderFactory,
} from "../../../src/cli/entry.js";
import type { EntryDeps } from "../../../src/cli/entry.js";
import { ExitCode } from "../../../src/cli/exit-codes.js";
import { NotImplementedError } from "../../../src/cli/errors.js";
import { NotImplementedTestRunner } from "../../../src/cli/seams/test-runner.js";
import { NotImplementedDocsGenerator } from "../../../src/cli/seams/docs-generator.js";
import type {
  Importer,
  ImportOutcome,
} from "../../../src/cli/seams/importer.js";
import type { Logger } from "../../../src/cli/logging/logger.js";
import type { ApiwrightConfig } from "../../../src/cli/config/types.js";
import { ConfigLoader } from "../../../src/cli/config/loader.js";
import { ProdSafetyGate } from "../../../src/cli/prod-safety.js";
import { vi } from "vitest";

/**
 * Tests for the updated importer wiring in entry.ts.
 *
 * The design widens EntryDeps.importer from InstanceType<typeof NotImplementedImporter>
 * to the Importer interface. These tests verify:
 *   - makeDeps accepts any Importer implementation (not just NotImplementedImporter)
 *   - import postman exits 0 when a real importer resolves
 *   - import openapi still exits 5 (NotImplementedError) even with CompositePostmanImporter
 *   - CompositePostmanImporter can be wired as the importer dependency
 *
 * Note: These tests use a fake Importer that resolves immediately (avoiding real disk).
 * The actual CompositePostmanImporter wiring is tested in the integration test.
 */

class FakeExitError extends Error {
  constructor(public readonly code: ExitCode) {
    super(`exit(${code})`);
    this.name = "FakeExitError";
  }
}

function makeFakeLogger(): Logger {
  return {
    level: "warn",
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  };
}

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

function makeFakeConfigLoaderFactory(): (configPath?: string) => ConfigLoader {
  return vi.fn(() => ({
    load: vi.fn().mockReturnValue({ valid: true, config: DEFAULT_CONFIG }),
  })) as unknown as (configPath?: string) => ConfigLoader;
}

function makeFakeProdGate(): ProdSafetyGate {
  return {
    evaluate: vi.fn().mockResolvedValue({ allowed: true }),
  } as unknown as ProdSafetyGate;
}

/** A fake Importer that resolves postman() successfully and rejects openapi(). */
function makeFakeRealImporter(outcome?: Partial<ImportOutcome>): Importer {
  return {
    postman: async (): Promise<ImportOutcome> => ({
      written: outcome?.written ?? 3,
      warnings: outcome?.warnings ?? [],
    }),
    openapi: async (): Promise<ImportOutcome> => {
      throw new NotImplementedError("`apiwright import openapi`", 5);
    },
  };
}

function makeDeps(overrides: Partial<EntryDeps> = {}): EntryDeps {
  const exitFn = vi.fn((code: ExitCode): never => {
    throw new FakeExitError(code);
  });
  return {
    configLoaderFactory: makeFakeConfigLoaderFactory(),
    prodSafetyGate: makeFakeProdGate(),
    testRunner: new NotImplementedTestRunner(),
    importer: makeFakeRealImporter(),
    docsGenerator: new NotImplementedDocsGenerator(),
    loggerFactory: makeFakeLogger,
    exit: exitFn,
    env: {},
    environmentLoaderFactory: buildTestStubEnvLoaderFactory(),
    ...overrides,
  };
}

async function runMain(argv: string[], deps: EntryDeps): Promise<ExitCode> {
  try {
    await main(["node", "apiwright", ...argv], deps);
    return ExitCode.SUCCESS;
  } catch (e) {
    if (e instanceof FakeExitError) {
      return e.code;
    }
    throw e;
  }
}

describe("EntryDeps.importer — widened Importer interface", () => {
  it("accepts any Importer implementation (not just NotImplementedImporter)", () => {
    const fakeImporter = makeFakeRealImporter();
    // TypeScript should accept this as Importer type
    const deps = makeDeps({ importer: fakeImporter });
    expect(deps.importer).toBeDefined();
    expect(typeof deps.importer.postman).toBe("function");
    expect(typeof deps.importer.openapi).toBe("function");
  });

  it("importer field satisfies the Importer interface", () => {
    const deps = makeDeps();
    const importer: Importer = deps.importer;
    expect(typeof importer.postman).toBe("function");
    expect(typeof importer.openapi).toBe("function");
  });
});

describe("main() — import postman with real importer (exit 0)", () => {
  it("exits 0 when importer.postman() resolves successfully", async () => {
    const workingImporter = makeFakeRealImporter({ written: 5, warnings: [] });
    const deps = makeDeps({ importer: workingImporter });
    const code = await runMain(
      ["import", "postman", "collection.json", "--output", "./tests"],
      deps,
    );
    expect(code).toBe(ExitCode.SUCCESS);
  });

  it("exits 0 when importer.postman() resolves with warnings (warnings don't cause exit 1)", async () => {
    const warnImporter = makeFakeRealImporter({
      written: 2,
      warnings: ["script outside allowlist", "disabled request skipped"],
    });
    const deps = makeDeps({ importer: warnImporter });
    const code = await runMain(
      ["import", "postman", "collection.json", "--output", "./out"],
      deps,
    );
    expect(code).toBe(ExitCode.SUCCESS);
  });

  it("calls importer.postman() with the correct file and outputDir", async () => {
    let capturedInput: { file: string; outputDir: string } | undefined;
    const capturingImporter: Importer = {
      postman: async (input) => {
        capturedInput = input;
        return { written: 0, warnings: [] };
      },
      openapi: async () => {
        throw new NotImplementedError("`apiwright import openapi`", 5);
      },
    };
    const deps = makeDeps({ importer: capturingImporter });
    await runMain(
      ["import", "postman", "my-collection.json", "--output", "/my/output"],
      deps,
    );
    expect(capturedInput?.file).toBe("my-collection.json");
    expect(capturedInput?.outputDir).toBe("/my/output");
  });
});

describe("main() — import openapi still exits 5 with new wiring", () => {
  it("exits with ExitCode.NOT_IMPLEMENTED (5) for import openapi even with real importer wired", async () => {
    const compositeStyle = makeFakeRealImporter();
    // The openapi() rejects with NotImplementedError
    const deps = makeDeps({ importer: compositeStyle });
    const code = await runMain(
      ["import", "openapi", "spec.yaml", "--output", "./tests"],
      deps,
    );
    expect(code).toBe(ExitCode.NOT_IMPLEMENTED);
  });
});

describe("buildProgram() — accepts Importer-typed importer", () => {
  it("builds successfully when importer is any Importer implementor", () => {
    const deps = makeDeps({ importer: makeFakeRealImporter() });
    const program = buildProgram(deps);
    expect(program).toBeDefined();
    const commands = program.commands.map((c) => c.name());
    expect(commands).toContain("import");
  });
});
