/**
 * Error taxonomy for the §9 Test Runner (Task #10).
 *
 * Mirrors the Task 8 DbConnectorError + Task 9 AuthStrategyError pattern:
 * one Error subclass + one frozen RUNNER_ERROR_CODES table + one
 * isRunnerError type guard. Secret-safe by construction — callers are
 * responsible for sanitizing values before passing them as `init.message`.
 */

/** The lifecycle phase the failure occurred in (§9 spec ordering). */
export type RunnerPhase =
  | "discovery"
  | "plan-gen"
  | "filter"
  | "shard"
  | "setup"
  | "execute"
  | "teardown"
  | "emit";

/** Every runner error code, in alphabetical order. */
export type RunnerErrorCode =
  | "RUNNER_ASSERTION_PARSE_FAILED"
  | "RUNNER_DISCOVERY_FAILED"
  | "RUNNER_EMIT_FAILED"
  | "RUNNER_ENDPOINT_PARSE_FAILED"
  | "RUNNER_HTTP_FAILED"
  | "RUNNER_LIFECYCLE_FAILED"
  | "RUNNER_PLAN_EMPTY"
  | "RUNNER_RETRY_EXHAUSTED"
  | "RUNNER_SHARD_INVALID";

/** Frozen const map: every RunnerErrorCode → its literal string value. */
export const RUNNER_ERROR_CODES: { readonly [K in RunnerErrorCode]: K } =
  Object.freeze({
    RUNNER_ASSERTION_PARSE_FAILED: "RUNNER_ASSERTION_PARSE_FAILED",
    RUNNER_DISCOVERY_FAILED: "RUNNER_DISCOVERY_FAILED",
    RUNNER_EMIT_FAILED: "RUNNER_EMIT_FAILED",
    RUNNER_ENDPOINT_PARSE_FAILED: "RUNNER_ENDPOINT_PARSE_FAILED",
    RUNNER_HTTP_FAILED: "RUNNER_HTTP_FAILED",
    RUNNER_LIFECYCLE_FAILED: "RUNNER_LIFECYCLE_FAILED",
    RUNNER_PLAN_EMPTY: "RUNNER_PLAN_EMPTY",
    RUNNER_RETRY_EXHAUSTED: "RUNNER_RETRY_EXHAUSTED",
    RUNNER_SHARD_INVALID: "RUNNER_SHARD_INVALID",
  } as const);

/** Constructor input for RunnerError; matches the AuthStrategyError pattern. */
export interface RunnerErrorInit {
  /** One of the literal codes from {@link RUNNER_ERROR_CODES}. */
  readonly code: RunnerErrorCode;
  /** The lifecycle phase the failure occurred in. */
  readonly phase: RunnerPhase;
  /**
   * Human-readable message. The caller is responsible for ensuring it carries
   * no credentials, resolved tokens, or other secret values.
   */
  readonly message: string;
  /** Optional underlying cause (preserves `Error.cause` chain). */
  readonly cause?: unknown;
}

/**
 * The single error class for the §9 runner.
 *
 * Subclass of native Error so `instanceof Error` is true; carries `code`
 * + `phase` for structured downstream handling. Stored verbatim — the
 * caller pre-sanitizes the message.
 */
export class RunnerError extends Error {
  /** Classification code; one of {@link RUNNER_ERROR_CODES}. */
  readonly code: RunnerErrorCode;
  /** The lifecycle phase the failure occurred in. */
  readonly phase: RunnerPhase;

  /**
   * Builds a redaction-safe runner error.
   * @param init - The classified, pre-sanitized failure description.
   */
  constructor(init: RunnerErrorInit) {
    super(init.message, { cause: init.cause });
    this.name = new.target.name;
    this.code = init.code;
    this.phase = init.phase;
  }
}

/**
 * Type guard: narrows an unknown caught value to {@link RunnerError}.
 * Uses `instanceof` (not duck-typing) so a structural POJO with matching
 * fields MUST fail this guard.
 * @param value - The caught value to test.
 * @returns `true` iff `value` is a {@link RunnerError} instance.
 */
export function isRunnerError(value: unknown): value is RunnerError {
  return value instanceof RunnerError;
}
