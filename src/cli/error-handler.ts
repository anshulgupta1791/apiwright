/**
 * Top-level CLI error handler.
 *
 * Logs the failure through the Logger (message only unless debug level,
 * then full stack) and exits with the appropriate code. The `exit` seam
 * is injectable so every branch is deterministically testable without
 * terminating the Vitest worker.
 */

import { CliError } from "./errors.js";
import { ExitCode, errorToExitCode } from "./exit-codes.js";
import type { Logger } from "./logging/logger.js";

/**
 * Options for {@link handleCliError}.
 */
export interface ErrorHandlerOptions {
  /** Logger to format the failure through. */
  logger: Logger;
  /**
   * Exit side-effect seam. Default (code) => process.exit(code).
   * Injectable so mapping is unit-tested without killing the runner.
   * @returns never — process.exit terminates the process.
   */
  exit?: (code: ExitCode) => never;
}

/**
 * Logs the failure and exits with the mapped code. Returns never.
 *
 * - CliError → `logger.error(err.message)`.
 * - Non-CliError → `logger.error("unexpected error: <message>")`.
 * - When `logger.level === "debug"`, also emits the stack via `logger.debug`.
 * - Never leaks stack traces at non-debug log levels.
 * @param err - The thrown value (may be any type).
 * @param opts - Logger and optional exit seam.
 * @returns never — always calls exit.
 */
export function handleCliError(err: unknown, opts: ErrorHandlerOptions): never {
  const { logger } = opts;
  /* istanbul ignore next — ternary operator line; real coverage is on the branches below */
  const exitFn: (code: ExitCode) => never =
    opts.exit ??
    /* istanbul ignore next — process.exit terminates the Vitest worker;
       behavior covered via injected exit seam */
    ((code) => process.exit(code));

  const exitCode = errorToExitCode(err);

  if (err instanceof CliError) {
    logger.error(err.message);
    if (logger.level === "debug") {
      logger.debug(err.stack ?? "");
    }
  } else {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`unexpected error: ${message}`);
    if (logger.level === "debug") {
      const stack = err instanceof Error ? (err.stack ?? "") : String(err);
      logger.debug(stack);
    }
  }

  return exitFn(exitCode);
}
