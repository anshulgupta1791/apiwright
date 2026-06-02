/**
 * Integration test for issue #55 — `apiwright run` must exit with the
 * documented exit code (VALIDATION/USAGE/TEST_FAILURE) when a RunnerError
 * is thrown, NOT fall through to INTERNAL (70) with an "unexpected error:"
 * prefix.
 *
 * WHY THIS IS AN INTEGRATION TEST, NOT A UNIT TEST:
 *
 *   The unit tests in `exit-codes.test.ts` verify the RunnerErrorCode →
 *   ExitCode mapping table in isolation, and `error-handler.test.ts`
 *   verifies the "no 'unexpected error:' prefix" branch. But neither
 *   verifies the FULL chain: a TestRunner throws RunnerError →
 *   handleCliError catches → errorToExitCode looks up the code →
 *   process.exit fires with the right number AND the prefix is absent
 *   from logger output. This integration test closes that gap.
 *
 *   Same lesson as issue #42: 95% coverage on isolated pieces missed the
 *   cross-cutting "the chain is plugged in" property. Code-paths exist
 *   that no unit test exercises end-to-end.
 *
 * SEE ALSO:
 *   - tests/unit/cli/exit-codes.test.ts (RunnerErrorCode → ExitCode map)
 *   - tests/unit/cli/error-handler.test.ts (no-"unexpected" branch)
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
import { NotImplementedDocsGenerator } from "../../../src/cli/seams/docs-generator.js";
import { NotImplementedImporter } from "../../../src/cli/seams/importer.js";
import type { TestRunner } from "../../../src/cli/seams/test-runner.js";
import { RunnerError } from "../../../src/runner/errors.js";
import type {
  RunnerErrorCode,
  RunnerPhase,
} from "../../../src/runner/errors.js";

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

function makeRecordingLogger(): {
  logger: Logger;
  errorMessages: string[];
} {
  const errorMessages: string[] = [];
  const logger: Logger = {
    level: "warn",
    error: vi.fn((m: string) => {
      errorMessages.push(m);
    }),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  };
  return { logger, errorMessages };
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

/** Test runner that throws a specific RunnerError instead of returning. */
function makeThrowingRunner(
  code: RunnerErrorCode,
  phase: RunnerPhase,
  message: string,
): TestRunner {
  return {
    run: vi.fn().mockImplementation(() => {
      throw new RunnerError({ code, phase, message });
    }),
  };
}

function makeDeps(runner: TestRunner): {
  deps: EntryDeps;
  exitSpy: ReturnType<typeof vi.fn>;
  errorMessages: string[];
} {
  const exitSpy = vi.fn((code: ExitCode): never => {
    throw new FakeExitError(code);
  });
  const { logger, errorMessages } = makeRecordingLogger();
  const deps: EntryDeps = {
    configLoaderFactory: makeFakeConfigLoaderFactory(),
    prodSafetyGate: makeFakeProdGate(),
    testRunner: runner,
    importer: new NotImplementedImporter(),
    docsGenerator: new NotImplementedDocsGenerator(),
    // EVERY loggerFactory call returns the SAME recording logger so the
    // test sees what the action handler actually emitted.
    loggerFactory: () => logger,
    exit: exitSpy,
    env: {},
    environmentLoaderFactory: buildTestStubEnvLoaderFactory(),
  };
  return { deps, exitSpy, errorMessages };
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

describe("CLI run exit-code — issue #55 (RunnerError end-to-end)", () => {
  it("RUNNER_ENDPOINT_PARSE_FAILED → exit 3 (VALIDATION), same as `apiwright validate`", async () => {
    const { deps, exitSpy } = makeDeps(
      makeThrowingRunner(
        "RUNNER_ENDPOINT_PARSE_FAILED",
        "discovery",
        "Endpoint validation failed (3 file(s))",
      ),
    );
    const code = await runMain(["run", "--env", "qa"], deps);
    expect(code).toBe(ExitCode.VALIDATION);
    expect(code).toBe(3);
    expect(exitSpy).toHaveBeenCalledWith(ExitCode.VALIDATION);
  });

  it("RUNNER_PLAN_EMPTY → exit 2 (USAGE)", async () => {
    const { deps, exitSpy } = makeDeps(
      makeThrowingRunner(
        "RUNNER_PLAN_EMPTY",
        "plan-gen",
        "no tests planned",
      ),
    );
    const code = await runMain(["run", "--env", "qa"], deps);
    expect(code).toBe(ExitCode.USAGE);
    expect(exitSpy).toHaveBeenCalledWith(ExitCode.USAGE);
  });

  it("RUNNER_HTTP_FAILED → exit 1 (TEST_FAILURE, pytest convention)", async () => {
    const { deps, exitSpy } = makeDeps(
      makeThrowingRunner(
        "RUNNER_HTTP_FAILED",
        "execute",
        "network unreachable",
      ),
    );
    const code = await runMain(["run", "--env", "qa"], deps);
    expect(code).toBe(ExitCode.TEST_FAILURE);
    expect(exitSpy).toHaveBeenCalledWith(ExitCode.TEST_FAILURE);
  });

  it("RUNNER_SHARD_INVALID → exit 2 (USAGE)", async () => {
    const { deps, exitSpy } = makeDeps(
      makeThrowingRunner("RUNNER_SHARD_INVALID", "shard", "bad shard"),
    );
    const code = await runMain(["run", "--env", "qa"], deps);
    expect(code).toBe(ExitCode.USAGE);
    expect(exitSpy).toHaveBeenCalledWith(ExitCode.USAGE);
  });

  it("RunnerError NEVER falls through to INTERNAL (70) — regression guard", async () => {
    // Exhaustive: every RunnerErrorCode must map to a non-INTERNAL exit.
    // If a new code is added to RunnerErrorCode but the map isn't updated,
    // this fails. (TypeScript's exhaustiveness on the const map should
    // catch it at compile time, but this test catches mistakes that bypass
    // the type system — e.g. a `as RunnerErrorCode` cast in user code.)
    const ALL_CODES: ReadonlyArray<RunnerErrorCode> = [
      "RUNNER_ASSERTION_PARSE_FAILED",
      "RUNNER_DISCOVERY_FAILED",
      "RUNNER_EMIT_FAILED",
      "RUNNER_ENDPOINT_PARSE_FAILED",
      "RUNNER_HTTP_FAILED",
      "RUNNER_LIFECYCLE_FAILED",
      "RUNNER_PLAN_EMPTY",
      "RUNNER_RETRY_EXHAUSTED",
      "RUNNER_SHARD_INVALID",
    ];
    for (const code of ALL_CODES) {
      const { deps } = makeDeps(makeThrowingRunner(code, "execute", "x"));
      const exitCode = await runMain(["run", "--env", "qa"], deps);
      expect(exitCode).not.toBe(ExitCode.INTERNAL);
    }
  });

  it("error message is logged VERBATIM, without 'unexpected error:' prefix", async () => {
    const { deps, errorMessages } = makeDeps(
      makeThrowingRunner(
        "RUNNER_ENDPOINT_PARSE_FAILED",
        "discovery",
        "Endpoint validation failed (1 file(s)):\n  - 'bad.endpoint.json': schema validation failed",
      ),
    );
    await runMain(["run", "--env", "qa"], deps);
    expect(errorMessages.length).toBeGreaterThan(0);

    // In production, process.exit terminates the process at the first
    // handleCliError call — the user sees ONLY the first error message.
    // In this test, the injected exit seam throws FakeExitError instead,
    // which then propagates through parseAsync and gets caught by main's
    // own try/catch, calling handleCliError a SECOND time on the
    // FakeExitError itself (which isn't a RunnerError). That second
    // message DOES carry the "unexpected error:" prefix — but it's a
    // test-harness artefact, not user-visible behavior.
    //
    // The user-visible contract is the FIRST emitted message. Assert there.
    const firstMessage = (errorMessages[0] as string).toLowerCase();
    expect(firstMessage).not.toContain("unexpected error");
    expect(firstMessage).toContain("endpoint validation failed");
  });
});
