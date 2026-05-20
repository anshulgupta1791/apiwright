/**
 * The structured, **redaction-safe** error taxonomy every §5 connector
 * rejects with. One concrete `Error` subclass ({@link DbConnectorError})
 * carrying a stable machine-readable {@link DbErrorCode}, the failing
 * {@link DbPhase}, and the {@link DbEngine}. The connection pool / Task #10
 * runner catch this and convert a failed verification query into a failed
 * test (never a process crash); §10 reporting reads `code`/`phase`/`engine`.
 *
 * **Secret-safety invariant (ties to §8):** a `DbConnectorError` message,
 * `code`, `phase`, and `engine` are constructed to NEVER contain a
 * connection string, credential, query text, or parameter value. Callers
 * additionally pass every serialized log/report through `redactSecrets`
 * (`src/env`), but this class is engineered to never put a secret in the
 * message in the first place — defense in depth, not reliance on redaction.
 *
 * Carries one trivial runtime const record ({@link DB_ERROR_CODES}) plus
 * the class and a type guard; the rest of §5's vocabulary is the
 * declaration-only `./types.ts`.
 */

import type { DbEngine } from "./types.js";

/**
 * The connector lifecycle phase a {@link DbConnectorError} occurred in.
 * String-literal union (repo idiom — never a numeric enum;
 * `no-magic-numbers`). `"bind"` is the D3 security boundary: a parameter set
 * that cannot be bound *natively* (i.e. would require unsafe string
 * interpolation) is a connector-authoring rejection, not a driver error.
 */
export type DbPhase = "connect" | "execute" | "bind" | "disconnect";

/**
 * Stable, machine-readable classification of a connector failure. Mirrors
 * the `FailureCode` / `YamlReadFailureKind` repo idiom (string-literal
 * union, extensible only in code, never configurable). Exactly these four
 * members satisfy the task's "at least: connection failure, query-execution
 * failure, non-bindable-template rejection" requirement, plus disconnect.
 */
export type DbErrorCode =
  /** `connect()` failed: host unreachable, auth rejected, bad/missing config. */
  | "DB_CONNECTION_FAILED"
  /** `execute()` failed inside the driver / engine (bad query, timeout). */
  | "DB_QUERY_FAILED"
  /**
   * `execute()` `params` cannot be bound natively — the D3 non-bindable
   * template authoring rejection (would require unsafe interpolation).
   */
  | "DB_PARAM_NOT_BINDABLE"
  /** `disconnect()` teardown failed. */
  | "DB_DISCONNECT_FAILED";

/**
 * Value-side surrogate for {@link DbErrorCode} so emitting code references
 * `DB_ERROR_CODES.DB_QUERY_FAILED` instead of bare string literals (one edit
 * point; no magic strings — cf. `FAILURE_CODES` in `src/assertions`).
 * Frozen; keys === values === the union. One of the two runtime exports a
 * unit test exercises (key/value identity + `Object.freeze`).
 */
export const DB_ERROR_CODES: { readonly [K in DbErrorCode]: K } =
  Object.freeze({
    DB_CONNECTION_FAILED: "DB_CONNECTION_FAILED",
    DB_QUERY_FAILED: "DB_QUERY_FAILED",
    DB_PARAM_NOT_BINDABLE: "DB_PARAM_NOT_BINDABLE",
    DB_DISCONNECT_FAILED: "DB_DISCONNECT_FAILED",
  } as const);

/** Construction inputs for a {@link DbConnectorError}. */
export interface DbConnectorErrorInit {
  /** Stable machine-readable classification. */
  readonly code: DbErrorCode;
  /** The lifecycle phase the failure occurred in. */
  readonly phase: DbPhase;
  /** The engine whose connector raised the failure. */
  readonly engine: DbEngine;
  /**
   * A pre-sanitized, human-readable explanation. The CALLER (the connector)
   * is responsible for ensuring this string contains NO credential,
   * connection string, query text, or parameter value before constructing.
   */
  readonly message: string;
  /**
   * Optional underlying driver error for debugging, attached as
   * `Error.cause`. NOTE: `cause` is intentionally NOT serialized by §10
   * reporting (it may carry secrets); only `code`/`phase`/`engine`/`message`
   * are report-safe.
   */
  readonly cause?: unknown;
}

/**
 * The single error type every §5 connector rejects with. A concrete
 * `Error` subclass (NOT abstract, NOT a hierarchy): unlike the §-CLI
 * `CliError` family, §5 failures are distinguished by the `code` DATA field,
 * not by subtype behavior — one class + a discriminant code is the right
 * model and keeps the taxonomy in one closed union. `instanceof
 * DbConnectorError` (or {@link isDbConnectorError}) lets the pool / Task #10
 * runner reliably catch connector failures and turn a failed verification
 * query into a failed test rather than crashing the process.
 *
 * Sets `name` to the class name (cf. `CliError`) so logs show the exact
 * type. Uses native `Error` `cause` for the optional underlying driver
 * error. The constructed `message` is contractually secret-free.
 */
export class DbConnectorError extends Error {
  /** Stable machine-readable classification. */
  readonly code: DbErrorCode;
  /** The lifecycle phase the failure occurred in. */
  readonly phase: DbPhase;
  /** The engine whose connector raised the failure. */
  readonly engine: DbEngine;

  /**
   * Builds a redaction-safe connector error.
   * @param init - The classified, pre-sanitized failure description.
   */
  constructor(init: DbConnectorErrorInit) {
    super(init.message, { cause: init.cause });
    this.name = new.target.name;
    this.code = init.code;
    this.phase = init.phase;
    this.engine = init.engine;
  }
}

/**
 * Type guard: narrows an unknown caught value to {@link DbConnectorError}.
 * Lets the pool / runner branch on connector failures without an unguarded
 * `instanceof` at every catch site. The second runtime export a unit test
 * exercises.
 * @param value - The caught value to test.
 * @returns True iff `value` is a {@link DbConnectorError}.
 */
export function isDbConnectorError(
  value: unknown,
): value is DbConnectorError {
  return value instanceof DbConnectorError;
}
