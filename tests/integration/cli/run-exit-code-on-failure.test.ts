/**
 * Integration test for issue #42 — `apiwright run` must exit non-zero when
 * tests fail. Closes the gap that 95% unit-test coverage missed.
 *
 * WHY THIS IS AN INTEGRATION TEST, NOT A UNIT TEST:
 *
 *   The unit tests in `run.test.ts` verify that RunCommand.execute throws
 *   RunFailedError when `outcome.failed > 0`, and `exit-codes.test.ts`
 *   verifies the mapping RunFailedError → ExitCode.TEST_FAILURE. But neither
 *   verifies the FULL chain: `program.parseAsync → action → RunCommand.execute
 *   throws → handleCliError catches → resolved.exit(ExitCode.TEST_FAILURE)
 *   actually fires`. The bug was that the throw never happened — every line
 *   was covered, but a missing branch had no test because there was no code
 *   to cover. Coverage at 95% measured behaviour-that-existed, not
 *   behaviour-that-should-exist.
 *
 *   This integration test goes through `main(argv, deps)` end-to-end with
 *   an injected TestRunner that returns `{failed: > 0}` and a recording
 *   exit seam. If the chain ever breaks again (someone removes the
 *   `failIfAnyTestsFailed` call, the catch swallows the error, the
 *   error→code mapping drops TEST_FAILURE, etc.) THIS test trips —
 *   regardless of what the unit tests still pass.
 *
 * SEE ALSO:
 *   - tests/unit/cli/commands/run.test.ts (unit-level coverage of step 6)
 *   - tests/unit/cli/exit-codes.test.ts (unit-level mapping)
 *   - apiwright-testing tests/api/apiwright_meta/test_exit_codes.py (e2e
 *     against the real built binary)
 *   - ~/.claude/.../memory/lesson_unit_tests_miss_seam_shape.md (root cause)
 */

import { describe, expect, it, vi } from "vitest";

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
import {
  NotImplementedDocsGenerator,
} from "../../../src/cli/seams/docs-generator.js";
import {
  NotImplementedImporter,
} from "../../../src/cli/seams/importer.js";
import type { TestRunner } from "../../../src/cli/seams/test-runner.js";

class FakeExitError extends Error {
  constructor(public readonly code: ExitCode) {
    super(`exit(${code})`);
    this.name = "FakeExitError";
  }
}

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

function makeFakeLogger(): Logger {
  return {
    level: "warn",
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  };
}

function makeFakeConfigLoaderFactory(): (
  configPath?: string,
) => ConfigLoader {
  return vi.fn((_configPath?: string) => ({
    load: vi.fn().mockReturnValue({ valid: true, config: SHARED_CONFIG }),
  })) as unknown as (configPath?: string) => ConfigLoader;
}

function makeFakeProdGate(): ProdSafetyGate {
  return {
    evaluate: vi.fn().mockResolvedValue({ allowed: true }),
  } as unknown as ProdSafetyGate;
}

function makeFakeRunner(opts: {
  passed: number;
  failed: number;
  flaky?: number;
}): TestRunner {
  return {
    run: vi.fn().mockResolvedValue({
      total: opts.passed + opts.failed,
      passed: opts.passed,
      failed: opts.failed,
      flaky: opts.flaky ?? 0,
    }),
  };
}

function makeDeps(runner: TestRunner): {
  deps: EntryDeps;
  exitSpy: ReturnType<typeof vi.fn>;
} {
  const exitSpy = vi.fn((code: ExitCode): never => {
    throw new FakeExitError(code);
  });
  const deps: EntryDeps = {
    configLoaderFactory: makeFakeConfigLoaderFactory(),
    prodSafetyGate: makeFakeProdGate(),
    testRunner: runner,
    importer: new NotImplementedImporter(),
    docsGenerator: new NotImplementedDocsGenerator(),
    loggerFactory: makeFakeLogger,
    exit: exitSpy,
    env: {},
    environmentLoaderFactory: buildTestStubEnvLoaderFactory(),
  };
  return { deps, exitSpy };
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

describe("CLI run exit-code — issue #42 (end-to-end main() chain)", () => {
  it("emits ExitCode.TEST_FAILURE (1) when any test fails", async () => {
    const { deps, exitSpy } = makeDeps(
      makeFakeRunner({ passed: 4, failed: 1 }),
    );
    const code = await runMain(["run", "--env", "qa"], deps);
    expect(code).toBe(ExitCode.TEST_FAILURE);
    expect(code).toBe(1);
    // exit is called by both the action's try/catch AND main's try/catch
    // when the action throws (the action calls handleCliError which calls
    // exit which throws FakeExitError; that throw propagates through
    // parseAsync and main catches it again). In production process.exit
    // never returns so the second call is unreachable — but the test seam
    // sees both. Pinning the user-visible contract: at least one call with
    // TEST_FAILURE, and all calls agree on the code.
    expect(exitSpy).toHaveBeenCalledWith(ExitCode.TEST_FAILURE);
    for (const call of exitSpy.mock.calls) {
      expect(call).toEqual([ExitCode.TEST_FAILURE]);
    }
  });

  it("emits ExitCode.SUCCESS (0) when every test passes", async () => {
    const { deps, exitSpy } = makeDeps(
      makeFakeRunner({ passed: 5, failed: 0 }),
    );
    const code = await runMain(["run", "--env", "qa"], deps);
    expect(code).toBe(ExitCode.SUCCESS);
    // main() does NOT call exit on a clean run — it just returns.
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("one failure out of many is enough to fail the run (boundary)", async () => {
    const { deps, exitSpy } = makeDeps(
      makeFakeRunner({ passed: 999, failed: 1 }),
    );
    const code = await runMain(["run", "--env", "qa"], deps);
    expect(code).toBe(ExitCode.TEST_FAILURE);
    expect(exitSpy).toHaveBeenCalledWith(ExitCode.TEST_FAILURE);
  });

  it("flaky-only is GREEN per spec — does not trip TEST_FAILURE", async () => {
    // The spec defines flaky as pass-after-retry. They MUST NOT fail the
    // run. Pins this so a misguided "all flaky = fail" change trips here.
    const { deps, exitSpy } = makeDeps(
      makeFakeRunner({ passed: 5, failed: 0, flaky: 3 }),
    );
    const code = await runMain(["run", "--env", "qa"], deps);
    expect(code).toBe(ExitCode.SUCCESS);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("exit-code chain is intact across the full main() pipeline (regression guard)", async () => {
    // Locks the WHOLE chain: parseAsync → action → RunCommand → throw
    // RunFailedError → handleCliError → errorToExitCode → exit. If anything
    // in this chain breaks (most likely: someone swallows the exception, or
    // the error→code mapping loses the entry), this trips.
    const { deps, exitSpy } = makeDeps(
      makeFakeRunner({ passed: 0, failed: 10 }),
    );
    const code = await runMain(["run", "--env", "qa", "--markers", "smoke"], deps);
    expect(code).toBe(ExitCode.TEST_FAILURE);
    // Same caveat as the first test: exit is called from two sites in the
    // error pipeline. Assert all calls agree, not the count.
    expect(exitSpy).toHaveBeenCalledWith(ExitCode.TEST_FAILURE);
    for (const call of exitSpy.mock.calls) {
      expect(call).toEqual([ExitCode.TEST_FAILURE]);
    }
  });
});
