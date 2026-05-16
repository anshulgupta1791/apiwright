/**
 * CliError hierarchy for the APIWright CLI.
 *
 * Each subclass maps to a distinct exit code. Inheritance is justified here:
 * these are pure error data types (each adds only a literal `code`), not
 * pluggable behavior strategies. The abstract base enables `instanceof` checks
 * and the exit-code mapping in error-handler.ts.
 */

import { ExitCode } from "./exit-codes.js";

/**
 * Base class for every CLI-recognized failure.
 *
 * Carries the exit code and sets `this.name` to the concrete class name so
 * stack traces and logs show the exact error type.
 */
export abstract class CliError extends Error {
  /** The exit code this error maps to. */
  abstract readonly code: ExitCode;

  /**
   * Stores the message and sets the error name to the concrete subclass name.
   * @param message - Human-readable error description.
   */
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/**
 * Bad flag, malformed/invalid config, unknown command, or missing required
 * argument. Maps to {@link ExitCode.USAGE} (2).
 */
export class ConfigError extends CliError {
  /** @inheritdoc */
  override readonly code = ExitCode.USAGE;
}

/**
 * `validate` found one or more invalid files.
 * Maps to {@link ExitCode.VALIDATION} (3).
 */
export class ValidationFailedError extends CliError {
  /** @inheritdoc */
  override readonly code = ExitCode.VALIDATION;
}

/**
 * Prod-safety gate declined or CI fail-fast.
 * Maps to {@link ExitCode.PROD_SAFETY} (4).
 */
export class ProdSafetyAbortError extends CliError {
  /** @inheritdoc */
  override readonly code = ExitCode.PROD_SAFETY;
}

/**
 * A deferred seam was invoked before its engine has been implemented.
 * Maps to {@link ExitCode.NOT_IMPLEMENTED} (5).
 *
 * The message always contains "not yet implemented (Task #<n>)" so CI
 * output clearly names the responsible future task.
 */
export class NotImplementedError extends CliError {
  /** @inheritdoc */
  override readonly code = ExitCode.NOT_IMPLEMENTED;

  /**
   * Builds the "not yet implemented" message with the task number.
   * @param feature - Human-readable feature name, e.g. "`apiwright run`".
   * @param taskNumber - The task number that will implement this feature.
   */
  constructor(feature: string, taskNumber: number) {
    super(`${feature} is not yet implemented (Task #${taskNumber})`);
  }
}
