/**
 * Regression guard for issue #56 — `apiwright validate` must NOT be silent
 * on a successful run.
 *
 * WHY THIS IS A WIRING TEST, NOT A UNIT TEST ON ValidateCommand:
 *
 *   ValidateCommand already emits the summary line via `logger.info(...)` —
 *   that path is covered in tests/unit/cli/commands/validate.test.ts.
 *   The bug (#56) was that entry.ts created the validate logger at "warn"
 *   level, so every info-level message was filtered out and the user saw
 *   nothing on success. None of the existing tests asserted that the
 *   summary line actually reached the user, so the bug slipped past 95%
 *   coverage.
 *
 *   This test wires through main() → action handler → ValidateCommand and
 *   asserts the user-visible logger (the one returned by loggerFactory)
 *   receives the summary message. If the action handler ever drops back
 *   to "warn" level, this trips.
 *
 *   Same lesson class as issue #42 (run exit code) and D3 (import silent
 *   success): per-component unit tests don't catch "the chain doesn't
 *   surface what it computes".
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  main,
  buildTestStubEnvLoaderFactory,
} from "../../../src/cli/entry.js";
import type { EntryDeps } from "../../../src/cli/entry.js";
import type { ApiwrightConfig } from "../../../src/cli/config/types.js";
import { ConfigLoader } from "../../../src/cli/config/loader.js";
import { ExitCode } from "../../../src/cli/exit-codes.js";
import type { Logger } from "../../../src/cli/logging/logger.js";
import { ProdSafetyGate } from "../../../src/cli/prod-safety.js";
import { NotImplementedDocsGenerator } from "../../../src/cli/seams/docs-generator.js";
import { NotImplementedImporter } from "../../../src/cli/seams/importer.js";
import { NotImplementedTestRunner } from "../../../src/cli/seams/test-runner.js";

class FakeExitError extends Error {
  constructor(public readonly code: ExitCode) {
    super(`exit(${code})`);
    this.name = "FakeExitError";
  }
}

const VALID_ENDPOINT = JSON.stringify({
  id: "get_root",
  name: "Get root",
  method: "GET",
  url: "/",
  request: {},
  response: { expected_status: 200 },
});

const SHARED_CONFIG: ApiwrightConfig = {
  tests_dir: "./tests",
  environments_dir: "./environments",
  reports_dir: "./reports",
  default_env: "qa",
  default_markers: ["smoke"],
  log_level: "warn",
  workers: 1,
  retry: { count: 0, delay_ms: 0, backoff: "none", strict: false },
  report: { html: false, json: false, junit_xml: false, output_dir: "./reports" },
};

function makeRecordingLogger(): {
  logger: Logger;
  infoMessages: string[];
  errorMessages: string[];
} {
  const infoMessages: string[] = [];
  const errorMessages: string[] = [];
  const logger: Logger = {
    level: "info",
    error: vi.fn((m: string) => {
      errorMessages.push(m);
    }),
    warn: vi.fn(),
    info: vi.fn((m: string) => {
      infoMessages.push(m);
    }),
    debug: vi.fn(),
  };
  return { logger, infoMessages, errorMessages };
}

function makeFakeConfigLoaderFactory(): (
  configPath?: string,
) => ConfigLoader {
  return vi.fn(() => ({
    load: vi.fn().mockReturnValue({ valid: true, config: SHARED_CONFIG }),
  })) as unknown as (configPath?: string) => ConfigLoader;
}

function makeFakeProdGate(): ProdSafetyGate {
  return {
    evaluate: vi.fn().mockResolvedValue({ allowed: true }),
  } as unknown as ProdSafetyGate;
}

function makeDepsWithSharedLogger(): {
  deps: EntryDeps;
  infoMessages: string[];
  errorMessages: string[];
} {
  const { logger, infoMessages, errorMessages } = makeRecordingLogger();
  const exitFn = vi.fn((code: ExitCode): never => {
    throw new FakeExitError(code);
  });
  const deps: EntryDeps = {
    configLoaderFactory: makeFakeConfigLoaderFactory(),
    prodSafetyGate: makeFakeProdGate(),
    testRunner: new NotImplementedTestRunner(),
    importer: new NotImplementedImporter(),
    docsGenerator: new NotImplementedDocsGenerator(),
    // Every loggerFactory call returns the SAME recording logger so the
    // test sees what the action handler emitted.
    loggerFactory: () => logger,
    exit: exitFn,
    env: {},
    environmentLoaderFactory: buildTestStubEnvLoaderFactory(),
  };
  return { deps, infoMessages, errorMessages };
}

async function runMain(
  argv: readonly string[],
  deps: EntryDeps,
): Promise<ExitCode> {
  try {
    await main(["node", "apiwright", ...argv], deps);
    return ExitCode.SUCCESS;
  } catch (e) {
    if (e instanceof FakeExitError) return e.code;
    throw e;
  }
}

describe("validate command — silent-success regression guard (issue #56)", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "apiwright-validate-summary-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("emits a 'Validated N endpoint file(s) ... — OK' summary on success", async () => {
    writeFileSync(join(dir, "ok.endpoint.json"), VALID_ENDPOINT, "utf8");
    const { deps, infoMessages } = makeDepsWithSharedLogger();
    const code = await runMain(["validate", dir], deps);
    expect(code).toBe(ExitCode.SUCCESS);
    // The user-visible promise: at least ONE info-level message containing
    // the summary line. Before #56, validate's logger was at "warn" so
    // this assertion would have failed (zero info messages).
    const summary = infoMessages.find((m) => m.includes("Validated"));
    expect(summary).toBeDefined();
    expect(summary).toContain("1 endpoint file(s)");
    expect(summary).toContain("— OK");
  });

  it("emits 'PASS <path>' for each valid file (per-file lines visible)", async () => {
    writeFileSync(join(dir, "ok.endpoint.json"), VALID_ENDPOINT, "utf8");
    const { deps, infoMessages } = makeDepsWithSharedLogger();
    await runMain(["validate", dir], deps);
    const passLine = infoMessages.find(
      (m) => m.startsWith("PASS ") && m.includes("ok.endpoint.json"),
    );
    expect(passLine).toBeDefined();
  });

  it("on success, info messages are NEVER zero (broad silent-success guard)", async () => {
    writeFileSync(join(dir, "ok.endpoint.json"), VALID_ENDPOINT, "utf8");
    const { deps, infoMessages } = makeDepsWithSharedLogger();
    await runMain(["validate", dir], deps);
    // Even if the exact wording of summary/PASS lines changes, the user
    // must see SOMETHING on success. This is the broadest regression guard.
    expect(infoMessages.length).toBeGreaterThan(0);
  });

  it("on failure, error messages are non-zero AND summary still prints (existing behavior preserved)", async () => {
    writeFileSync(
      join(dir, "bad.endpoint.json"),
      JSON.stringify({ id: "bad", name: "Bad" }),
      "utf8",
    );
    const { deps, infoMessages, errorMessages } = makeDepsWithSharedLogger();
    const code = await runMain(["validate", dir], deps);
    expect(code).toBe(ExitCode.VALIDATION);
    expect(errorMessages.length).toBeGreaterThan(0);
    // Summary still prints, just with "passed/failed" instead of "OK".
    const summary = infoMessages.find((m) => m.includes("Validated"));
    expect(summary).toBeDefined();
    expect(summary).toContain("failed");
  });

  it("issue #57: env files present but zero endpoints → exit 2 with actionable message", async () => {
    writeFileSync(
      join(dir, "qa.yaml"),
      "name: qa\nbase_url: https://example.com\nprod: false\n",
      "utf8",
    );
    const { deps, errorMessages } = makeDepsWithSharedLogger();
    const code = await runMain(["validate", dir], deps);
    expect(code).toBe(ExitCode.USAGE);
    expect(errorMessages.length).toBeGreaterThan(0);
    // The user-visible promise: message mentions endpoint files + the
    // env-file count + a hint about tests_dir/glob. Without these, a
    // user with a glob mistake just sees "exit 2" with no help.
    const joined = errorMessages.join(" ");
    expect(joined).toContain("*.endpoint.json");
    expect(joined).toContain("environment file(s)");
    expect(joined.toLowerCase()).toContain("tests_dir");
  });
});
