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

describe("main() — import prints outcome (D3 fix: silent-success regression guard)", () => {
  /**
   * Builds deps where every loggerFactory() call returns the SAME logger
   * instance so the test can assert on the calls the import action made.
   */
  function makeDepsWithSharedLogger(
    importer: Importer,
  ): { deps: EntryDeps; logger: Logger } {
    const logger = makeFakeLogger();
    const exitFn = vi.fn((code: ExitCode): never => {
      throw new FakeExitError(code);
    });
    const deps: EntryDeps = {
      configLoaderFactory: makeFakeConfigLoaderFactory(),
      prodSafetyGate: makeFakeProdGate(),
      testRunner: new NotImplementedTestRunner(),
      importer,
      docsGenerator: new NotImplementedDocsGenerator(),
      loggerFactory: () => logger,
      exit: exitFn,
      env: {},
      environmentLoaderFactory: buildTestStubEnvLoaderFactory(),
    };
    return { deps, logger };
  }

  it("postman: logs 'Wrote N endpoint file(s) to <dir>' via logger.info()", async () => {
    const importer = makeFakeRealImporter({ written: 7, warnings: [] });
    const { deps, logger } = makeDepsWithSharedLogger(importer);
    await runMain(
      ["import", "postman", "c.json", "--output", "./out-dir"],
      deps,
    );
    const infoCalls = (logger.info as ReturnType<typeof vi.fn>).mock.calls;
    const infoMessages = infoCalls.map((c) => c[0] as string);
    expect(
      infoMessages.some((m) => m.includes("Wrote 7 endpoint file(s)")),
    ).toBe(true);
    expect(infoMessages.some((m) => m.includes("./out-dir"))).toBe(true);
  });

  it("postman: logs each warning from the outcome via logger.warn()", async () => {
    const importer = makeFakeRealImporter({
      written: 2,
      warnings: [
        "Skipped disabled request 'Foo'",
        "Imported endpoints reference these env variables — define them in your environments/<name>.yaml before running: api_token, base_url",
      ],
    });
    const { deps, logger } = makeDepsWithSharedLogger(importer);
    await runMain(
      ["import", "postman", "c.json", "--output", "./out"],
      deps,
    );
    const warnCalls = (logger.warn as ReturnType<typeof vi.fn>).mock.calls;
    const warnMessages = warnCalls.map((c) => c[0] as string);
    expect(warnMessages).toContain("Skipped disabled request 'Foo'");
    expect(
      warnMessages.some((m) =>
        m.startsWith("Imported endpoints reference these env variables"),
      ),
    ).toBe(true);
  });

  it("postman: prints info line even when warnings array is empty", async () => {
    const importer = makeFakeRealImporter({ written: 1, warnings: [] });
    const { deps, logger } = makeDepsWithSharedLogger(importer);
    await runMain(
      ["import", "postman", "c.json", "--output", "./out"],
      deps,
    );
    const infoCalls = (logger.info as ReturnType<typeof vi.fn>).mock.calls;
    expect(infoCalls.length).toBeGreaterThanOrEqual(1);
    const warnCalls = (logger.warn as ReturnType<typeof vi.fn>).mock.calls;
    expect(warnCalls.length).toBe(0);
  });

  it("openapi: ALSO prints outcome (shared printImportOutcome helper)", async () => {
    // OpenAPI side: the fake importer rejects, so openapi() throws and the
    // print path is not reached. To exercise the OpenAPI print path, build
    // a custom Importer where openapi() resolves with a real outcome.
    const importer: Importer = {
      postman: async () => ({ written: 0, warnings: [] }),
      openapi: async () => ({ written: 4, warnings: ["security scheme X unmapped"] }),
    };
    const { deps, logger } = makeDepsWithSharedLogger(importer);
    await runMain(
      ["import", "openapi", "spec.yaml", "--output", "./oa-out"],
      deps,
    );
    const infoMessages = (logger.info as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => c[0] as string,
    );
    const warnMessages = (logger.warn as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => c[0] as string,
    );
    expect(
      infoMessages.some((m) => m.includes("Wrote 4 endpoint file(s)")),
    ).toBe(true);
    expect(warnMessages).toContain("security scheme X unmapped");
  });
});
