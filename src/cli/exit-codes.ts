/**
 * Process exit codes for the APIWright CLI.
 *
 * Codes are distinct, non-overlapping, and documented. Code 70 maps to
 * sysexits EX_SOFTWARE for unexpected errors. Code `1` is the canonical
 * "tests ran but at least one failed" code (matches the convention of
 * pytest, vitest, mocha, gtest, etc.) so CI tooling Just Works.
 */

import type { CliError } from "./errors.js";

/** Exit code for `run` when at least one test failed (matches pytest/vitest convention). */
const TEST_FAILURE_CODE = 1;
/** Exit code for "validate" failures. */
const VALIDATION_CODE = 3;
/** Exit code for prod-safety gate failures. */
const PROD_SAFETY_CODE = 4;
/** Exit code for not-yet-implemented features. */
const NOT_IMPLEMENTED_CODE = 5;
/** Exit code for unexpected internal errors (sysexits EX_SOFTWARE). */
const INTERNAL_CODE = 70;

/** Process exit codes. Documented contract for CI scripts and test assertions. */
export enum ExitCode {
  /** Success. */
  SUCCESS = 0,
  /**
   * `apiwright run` completed but at least one test case failed after retries.
   * Matches the convention of pytest / vitest / mocha (exit 1 == tests failed),
   * so CI tooling that expects "exit 0 = green, non-zero = red" Just Works.
   */
  TEST_FAILURE = TEST_FAILURE_CODE,
  /**
   * Usage/config error: bad flag, malformed or schema-invalid config,
   * unknown command, missing required argument.
   */
  USAGE = 2,
  /** `validate` found at least one invalid file. */
  VALIDATION = VALIDATION_CODE,
  /** Prod-safety gate declined or CI fail-fast. */
  PROD_SAFETY = PROD_SAFETY_CODE,
  /** A deferred seam (run/import/docs) invoked before its engine exists. */
  NOT_IMPLEMENTED = NOT_IMPLEMENTED_CODE,
  /** Unexpected/uncaught internal error (sysexits EX_SOFTWARE). */
  INTERNAL = INTERNAL_CODE,
}

/**
 * Maps any thrown value to an {@link ExitCode}.
 *
 * CliError instances → their declared `.code`; anything else → INTERNAL.
 * Pure; has no side effects.
 * @param err - The value thrown (may be any type).
 * @returns The appropriate exit code.
 */
export function errorToExitCode(err: unknown): ExitCode {
  if (isCliError(err)) {
    return err.code;
  }
  return ExitCode.INTERNAL;
}

/**
 * Type guard for CliError instances.
 * @param err - The value to test.
 * @returns True when err is a CliError (has a numeric code property).
 */
function isCliError(err: unknown): err is CliError {
  return (
    err instanceof Error &&
    "code" in err &&
    typeof (err as Record<string, unknown>)["code"] === "number"
  );
}
