import { describe, it, expect } from "vitest";

import { ExitCode, errorToExitCode } from "../../../src/cli/exit-codes.js";
import {
  ConfigError,
  ValidationFailedError,
  ProdSafetyAbortError,
  NotImplementedError,
  RunFailedError,
} from "../../../src/cli/errors.js";
import { RunnerError } from "../../../src/runner/errors.js";

/**
 * Unit tests for the ExitCode enum and errorToExitCode().
 *
 * Verifies each code's numeric value, that the mapping function correctly
 * routes CliError subclasses to their declared code and any non-CliError to
 * INTERNAL, and edge cases (thrown string, thrown number).
 */
describe("ExitCode enum", () => {
  it("SUCCESS is 0", () => {
    expect(ExitCode.SUCCESS).toBe(0);
  });

  it("TEST_FAILURE is 1 (matches pytest/vitest/mocha convention)", () => {
    expect(ExitCode.TEST_FAILURE).toBe(1);
  });

  it("USAGE is 2", () => {
    expect(ExitCode.USAGE).toBe(2);
  });

  it("VALIDATION is 3", () => {
    expect(ExitCode.VALIDATION).toBe(3);
  });

  it("PROD_SAFETY is 4", () => {
    expect(ExitCode.PROD_SAFETY).toBe(4);
  });

  it("NOT_IMPLEMENTED is 5", () => {
    expect(ExitCode.NOT_IMPLEMENTED).toBe(5);
  });

  it("INTERNAL is 70", () => {
    expect(ExitCode.INTERNAL).toBe(70);
  });

  it("codes are all distinct values", () => {
    const codes = [
      ExitCode.SUCCESS,
      ExitCode.TEST_FAILURE,
      ExitCode.USAGE,
      ExitCode.VALIDATION,
      ExitCode.PROD_SAFETY,
      ExitCode.NOT_IMPLEMENTED,
      ExitCode.INTERNAL,
    ];
    const unique = new Set(codes);
    expect(unique.size).toBe(codes.length);
  });
});

describe("errorToExitCode()", () => {
  it("maps ConfigError → ExitCode.USAGE", () => {
    expect(errorToExitCode(new ConfigError("bad"))).toBe(ExitCode.USAGE);
  });

  it("maps ValidationFailedError → ExitCode.VALIDATION", () => {
    expect(errorToExitCode(new ValidationFailedError("invalid"))).toBe(
      ExitCode.VALIDATION,
    );
  });

  it("maps ProdSafetyAbortError → ExitCode.PROD_SAFETY", () => {
    expect(errorToExitCode(new ProdSafetyAbortError("abort"))).toBe(
      ExitCode.PROD_SAFETY,
    );
  });

  it("maps NotImplementedError → ExitCode.NOT_IMPLEMENTED", () => {
    expect(errorToExitCode(new NotImplementedError("f", 10))).toBe(
      ExitCode.NOT_IMPLEMENTED,
    );
  });

  it("maps RunFailedError → ExitCode.TEST_FAILURE (issue #42 fix)", () => {
    expect(errorToExitCode(new RunFailedError("3 of 5 failed"))).toBe(
      ExitCode.TEST_FAILURE,
    );
  });

  it("maps a plain Error to ExitCode.INTERNAL", () => {
    expect(errorToExitCode(new Error("unexpected"))).toBe(ExitCode.INTERNAL);
  });

  it("maps a thrown string to ExitCode.INTERNAL", () => {
    expect(errorToExitCode("something exploded")).toBe(ExitCode.INTERNAL);
  });

  it("maps a thrown number to ExitCode.INTERNAL", () => {
    expect(errorToExitCode(42)).toBe(ExitCode.INTERNAL);
  });

  it("maps null to ExitCode.INTERNAL", () => {
    expect(errorToExitCode(null)).toBe(ExitCode.INTERNAL);
  });

  it("maps undefined to ExitCode.INTERNAL", () => {
    expect(errorToExitCode(undefined)).toBe(ExitCode.INTERNAL);
  });

  it("maps a plain object to ExitCode.INTERNAL", () => {
    expect(errorToExitCode({ code: 1, msg: "oops" })).toBe(ExitCode.INTERNAL);
  });

  it("is a pure function — has no side effects", () => {
    const err = new ConfigError("x");
    // calling twice returns same result
    expect(errorToExitCode(err)).toBe(errorToExitCode(err));
  });
});

describe("errorToExitCode() — RunnerError mapping (issue #55)", () => {
  // Pre-flight RunnerErrors (config-time validation) → VALIDATION/USAGE
  // so `apiwright run` exits the same as `apiwright validate` on identical
  // bad input.
  const PRE_FLIGHT_VALIDATION = [
    "RUNNER_ENDPOINT_PARSE_FAILED",
    "RUNNER_DISCOVERY_FAILED",
    "RUNNER_ASSERTION_PARSE_FAILED",
  ] as const;
  const PRE_FLIGHT_USAGE = [
    "RUNNER_PLAN_EMPTY",
    "RUNNER_SHARD_INVALID",
  ] as const;
  // Runtime RunnerErrors (during execute/teardown/emit) → TEST_FAILURE
  // (matches pytest/vitest exit-1 convention).
  const RUNTIME_TEST_FAILURE = [
    "RUNNER_HTTP_FAILED",
    "RUNNER_LIFECYCLE_FAILED",
    "RUNNER_RETRY_EXHAUSTED",
    "RUNNER_EMIT_FAILED",
  ] as const;

  for (const code of PRE_FLIGHT_VALIDATION) {
    it(`maps RunnerError(${code}) → ExitCode.VALIDATION (3)`, () => {
      const err = new RunnerError({
        code,
        phase: "discovery",
        message: `simulated ${code}`,
      });
      expect(errorToExitCode(err)).toBe(ExitCode.VALIDATION);
    });
  }

  for (const code of PRE_FLIGHT_USAGE) {
    it(`maps RunnerError(${code}) → ExitCode.USAGE (2)`, () => {
      const err = new RunnerError({
        code,
        phase: "shard",
        message: `simulated ${code}`,
      });
      expect(errorToExitCode(err)).toBe(ExitCode.USAGE);
    });
  }

  for (const code of RUNTIME_TEST_FAILURE) {
    it(`maps RunnerError(${code}) → ExitCode.TEST_FAILURE (1)`, () => {
      const err = new RunnerError({
        code,
        phase: "execute",
        message: `simulated ${code}`,
      });
      expect(errorToExitCode(err)).toBe(ExitCode.TEST_FAILURE);
    });
  }

  it("does NOT fall through to INTERNAL for any RunnerError code (regression guard)", () => {
    // Exhaustive: every RunnerErrorCode value must produce a non-INTERNAL exit.
    const allCodes = [
      ...PRE_FLIGHT_VALIDATION,
      ...PRE_FLIGHT_USAGE,
      ...RUNTIME_TEST_FAILURE,
    ];
    for (const code of allCodes) {
      const err = new RunnerError({
        code,
        phase: "execute",
        message: "x",
      });
      expect(errorToExitCode(err)).not.toBe(ExitCode.INTERNAL);
    }
  });
});
