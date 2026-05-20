/**
 * The structured, **redaction-safe** error taxonomy every §6 authentication
 * strategy / parser / registry rejects with. One concrete `Error` subclass
 * ({@link AuthStrategyError}) carrying a stable machine-readable
 * {@link AuthErrorCode}, the failing {@link AuthPhase}, and an optional
 * `cause`. The §10 reporting layer reads `code`/`phase`/`name`/`message`;
 * `cause` is intentionally NOT serialised (it may carry secrets).
 *
 * **Secret-safety invariant (ties to §6 / AC#5):** an `AuthStrategyError`
 * `message`, `code`, `phase`, and `name` are constructed to NEVER contain a
 * credentials body, a resolved token / access_token / bearer string, or any
 * `${secret.*}`-resolved value. The CALLER is the contract enforcer — this
 * class stores `init.message` verbatim (defense in depth, NOT reliance on
 * transformation). Application of `redactSecrets()` to log/report output is
 * Task #10's wiring concern; this taxonomy is intentionally zero-dependency.
 *
 * Mirrors the APPROVED Task #8 precedent (`src/db/errors.ts`) verbatim down
 * to variable-naming style: one class + a discriminant code + a frozen
 * surrogate + a type guard — NOT a hierarchy.
 */

/**
 * The §6 lifecycle phase an {@link AuthStrategyError} occurred in.
 * String-literal union (repo idiom — never a numeric enum; `no-magic-numbers`).
 *
 * - `"config"` — credential / config validation rejected.
 * - `"fetch"` — token-endpoint HTTP call failed or returned non-2xx.
 * - `"extract"` — token-response parsing / JSONPath extraction failed.
 * - `"attach"` — final header attachment / templating failed at apply time.
 */
export type AuthPhase = "config" | "fetch" | "extract" | "attach";

/**
 * Stable, machine-readable classification of a §6 auth strategy failure.
 * String-literal union, extensible only in code, never configurable.
 * All eight D10 codes; listed alphabetically for stable diffs.
 *
 * - `"AUTH_CONFIG_INVALID"` — credential / config validation rejected (config phase).
 * - `"AUTH_EXPIRES_IN_INVALID"` — `expires_in` field in token response is invalid
 *   (extract phase).
 * - `"AUTH_HEADER_TEMPLATE_INVALID"` — the configured header template is malformed
 *   (config or attach phase).
 * - `"AUTH_STRATEGY_UNKNOWN"` — the requested strategy name is not registered
 *   (config phase).
 * - `"AUTH_TOKEN_FETCH_FAILED"` — token-endpoint HTTP call failed (fetch phase).
 * - `"AUTH_TOKEN_FETCH_NON_2XX"` — token endpoint returned a non-2xx status
 *   (fetch phase).
 * - `"AUTH_TOKEN_NOT_FOUND"` — JSONPath / field extraction found no token in the
 *   response (extract phase).
 * - `"AUTH_TOKEN_NOT_STRING"` — extracted token value is not a string (extract phase).
 */
export type AuthErrorCode =
  | "AUTH_CONFIG_INVALID"
  | "AUTH_EXPIRES_IN_INVALID"
  | "AUTH_HEADER_TEMPLATE_INVALID"
  | "AUTH_STRATEGY_UNKNOWN"
  | "AUTH_TOKEN_FETCH_FAILED"
  | "AUTH_TOKEN_FETCH_NON_2XX"
  | "AUTH_TOKEN_NOT_FOUND"
  | "AUTH_TOKEN_NOT_STRING";

/**
 * Value-side surrogate for {@link AuthErrorCode} so emitting code references
 * `AUTH_ERROR_CODES.AUTH_CONFIG_INVALID` instead of bare string literals
 * (one edit point; no magic strings). Frozen at runtime; keys === values ===
 * the union members. The mapped-type annotation enforces key/value identity
 * at compile time; `Object.freeze` enforces it at runtime.
 */
export const AUTH_ERROR_CODES: { readonly [K in AuthErrorCode]: K } =
  Object.freeze({
    AUTH_CONFIG_INVALID: "AUTH_CONFIG_INVALID",
    AUTH_EXPIRES_IN_INVALID: "AUTH_EXPIRES_IN_INVALID",
    AUTH_HEADER_TEMPLATE_INVALID: "AUTH_HEADER_TEMPLATE_INVALID",
    AUTH_STRATEGY_UNKNOWN: "AUTH_STRATEGY_UNKNOWN",
    AUTH_TOKEN_FETCH_FAILED: "AUTH_TOKEN_FETCH_FAILED",
    AUTH_TOKEN_FETCH_NON_2XX: "AUTH_TOKEN_FETCH_NON_2XX",
    AUTH_TOKEN_NOT_FOUND: "AUTH_TOKEN_NOT_FOUND",
    AUTH_TOKEN_NOT_STRING: "AUTH_TOKEN_NOT_STRING",
  } as const);

/**
 * Construction inputs for an {@link AuthStrategyError}.
 *
 * The caller is responsible for ensuring `message` is pre-sanitized and
 * contains NO credential. See {@link AuthStrategyErrorInit.message} for the
 * full contract.
 */
export interface AuthStrategyErrorInit {
  /** Stable machine-readable classification. */
  readonly code: AuthErrorCode;
  /** The lifecycle phase the failure occurred in. */
  readonly phase: AuthPhase;
  /**
   * A pre-sanitized, human-readable explanation.
   *
   * **MAY contain:** the strategy name (e.g. `"token-endpoint"`), an HTTP
   * response status code (e.g. `"401"`), a field name or JSONPath expression
   * that *failed* to resolve (e.g. `"$.access_token"` — the expression, NOT
   * the resolved value), a structural description of the failure.
   *
   * **MUST NOT contain:** the credentials body (POSTed to a token endpoint),
   * the resolved token / access_token / bearer string, or any
   * `${secret.*}`-resolved value.
   *
   * The CALLER is the contract enforcer. {@link AuthStrategyError} stores
   * this value verbatim — it performs no inspection, transformation, or
   * redaction.
   */
  readonly message: string;
  /**
   * Optional underlying error for debugging, attached as `Error.cause`.
   * Typed `unknown` (ECMAScript 2022 spec) because driver libraries and fetch
   * wrappers may throw non-`Error` shapes.
   *
   * NOTE: `cause` is intentionally NOT serialised by §10 reporting — it may
   * carry secrets such as a raw fetch response body or a connection URL.
   * Only `code`/`phase`/`name`/`message` are report-safe.
   */
  readonly cause?: unknown;
}

/**
 * The single error type every §6 strategy / parser / registry rejects with.
 * A concrete `Error` subclass (NOT abstract, NOT a hierarchy — D10 decision):
 * failures are distinguished by the `code` DATA field, not by subtype
 * behaviour. `instanceof AuthStrategyError` (or {@link isAuthStrategyError})
 * lets the §10 runner reliably catch auth failures and convert them to failed
 * tests rather than crashing the process.
 *
 * Sets `name` to the runtime class name via `new.target.name` so logs show
 * the exact type. Uses native ECMAScript 2022 `Error` `cause` for the
 * optional underlying error. The constructed `message` is contractually
 * secret-free — see {@link AuthStrategyErrorInit.message} for the full MAY /
 * MUST-NOT contract.
 *
 * **Mirrors:** `DbConnectorError` in `src/db/errors.ts` (Task #8 precedent).
 */
export class AuthStrategyError extends Error {
  /** Stable machine-readable classification. */
  readonly code: AuthErrorCode;
  /** The lifecycle phase the failure occurred in. */
  readonly phase: AuthPhase;

  /**
   * Builds a redaction-safe auth-strategy error.
   * @param init - The classified, pre-sanitized failure description.
   *   `init.message` is stored verbatim; the caller is responsible for
   *   ensuring it carries no credentials, resolved token, or secret value.
   */
  constructor(init: AuthStrategyErrorInit) {
    super(init.message, { cause: init.cause });
    this.name = new.target.name;
    this.code = init.code;
    this.phase = init.phase;
  }
}

/**
 * Type guard: narrows an unknown caught value to {@link AuthStrategyError}.
 * Uses `instanceof` (NOT duck-typing) — a structural POJO with matching fields
 * MUST fail this guard. This is a security property: callers cannot fabricate
 * a fake `AuthStrategyError` via object-literal construction.
 * Mirrors `isDbConnectorError` in `src/db/errors.ts`.
 * @param value - The caught value to test.
 * @returns `true` iff `value` is an {@link AuthStrategyError} instance.
 */
export function isAuthStrategyError(
  value: unknown,
): value is AuthStrategyError {
  return value instanceof AuthStrategyError;
}
