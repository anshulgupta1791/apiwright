/**
 * Internal helpers for the auth config parser.
 *
 * File-local validators for each validation concern: string shape, header
 * placeholder rules (D16), credentials shape (D14), refresh buffer bounds,
 * and foreign-key rejection (D15). NOT exported from any barrel — consumed
 * only by config-parser.ts.
 *
 * All functions are pure, deterministic, and never throw.
 * @module
 */

import { AUTH_ERROR_CODES, AuthStrategyError } from "./errors.js";
import { parseJsonPath } from "./jsonpath-subset.js";
import type { ParsedJsonPath } from "./jsonpath-subset.js";

/** Default HTTP header name when the config omits the header field (D7). */
export const DEFAULT_HEADER = "Authorization";

/** Default header value template when the config omits header_value (D7). */
export const DEFAULT_HEADER_VALUE = "Bearer ${token}";

/** Default token-refresh lead time in seconds when refresh_buffer_seconds is absent (D6). */
export const DEFAULT_REFRESH_BUFFER_SECONDS = 30;

/** Source string for the placeholder regex — built fresh per call to avoid shared lastIndex. */
const PLACEHOLDER_RE_SOURCE = String.raw`\$\{([^}]*)\}`;

/**
 * DRY constructor for AUTH_CONFIG_INVALID errors in the "config" phase.
 * @param name - The strategy name for the error message prefix.
 * @param msg - The failure detail appended after the strategy name.
 * @returns An AuthStrategyError with code AUTH_CONFIG_INVALID, phase "config".
 */
export function mkConfigError(name: string, msg: string): AuthStrategyError {
  return new AuthStrategyError({
    code: AUTH_ERROR_CODES.AUTH_CONFIG_INVALID,
    phase: "config",
    message: `auth strategy '${name}': ${msg}`,
  });
}

/**
 * Collapses null to undefined so absence checks work uniformly when a YAML
 * loader emits null for an absent key (section 9-e).
 * @param v - The value to coerce.
 * @returns undefined if v is null or undefined, otherwise v unchanged.
 */
export function coerceOptional<T>(v: T | null | undefined): T | undefined {
  return v === null ? undefined : v;
}

/**
 * Validates that a value is a non-empty string without leading or trailing
 * whitespace. Used for token, url, username, password, and header fields.
 * @param name - Strategy name for error messages.
 * @param field - Field name cited in error messages.
 * @param value - The raw value to test.
 * @returns The string on success, or an AUTH_CONFIG_INVALID AuthStrategyError.
 */
export function validateNonEmptyString(
  name: string,
  field: string,
  value: unknown,
): string | AuthStrategyError {
  if (typeof value !== "string") {
    return mkConfigError(name, `'${field}' must be a non-empty string`);
  }
  if (value.length === 0) {
    return mkConfigError(name, `'${field}' must not be empty`);
  }
  if (value !== value.trim()) {
    return mkConfigError(name, `'${field}' must not have leading or trailing whitespace`);
  }
  return value;
}

/**
 * Validates the header_value placeholder rules (D16).
 *
 * Only "${token}" is honored; any other inner name triggers
 * AUTH_HEADER_TEMPLATE_INVALID. The error message cites ONLY the inner
 * placeholder name — never the surrounding header_value text (leak prevention).
 * @param name - Strategy name for error messages.
 * @param headerValue - The header_value string to scan for placeholders.
 * @returns undefined on success, or an AUTH_HEADER_TEMPLATE_INVALID error.
 */
export function validateHeaderValue(
  name: string,
  headerValue: string,
): AuthStrategyError | undefined {
  const re = new RegExp(PLACEHOLDER_RE_SOURCE, "g");
  for (const match of headerValue.matchAll(re)) {
    const inner = match[1] ?? "";
    if (inner !== "token") {
      return new AuthStrategyError({
        code: AUTH_ERROR_CODES.AUTH_HEADER_TEMPLATE_INVALID,
        phase: "config",
        message:
          `auth strategy '${name}': unsupported header_value placeholder` +
          ` '\${${inner}}' (only \${token} is honored in v1.0)`,
      });
    }
  }
  return undefined;
}

/** Valid credentials keys per D14. */
const ALLOWED_CRED_KEYS = new Set(["username", "password"]);

/**
 * Checks for extra credential keys and rejects with a D15 deferral message.
 * @param name - Strategy name for error messages.
 * @param creds - The credentials object to inspect.
 * @returns An error if an extra key is found, or undefined if all keys are allowed.
 */
function rejectExtraCredKey(
  name: string,
  creds: Record<string, unknown>,
): AuthStrategyError | undefined {
  for (const key of Object.keys(creds)) {
    if (!ALLOWED_CRED_KEYS.has(key)) {
      return mkConfigError(
        name,
        `'credentials.${key}' is not supported in v1.0 (deferred to v1.5)`,
      );
    }
  }
  return undefined;
}

/**
 * Validates the D14 credentials shape: exactly {username, password}.
 *
 * Extra keys trigger AUTH_CONFIG_INVALID with a v1.5 deferral note naming the
 * offending key. Arrays are rejected. Missing required keys are named.
 * @param name - Strategy name for error messages.
 * @param raw - The raw credentials value (any shape accepted; validated here).
 * @returns A typed {username, password} on success, or an AUTH_CONFIG_INVALID error.
 */
export function validateCredentials(
  name: string,
  raw: unknown,
): { readonly username: string; readonly password: string } | AuthStrategyError {
  if (raw === null || raw === undefined || typeof raw !== "object" || Array.isArray(raw)) {
    return mkConfigError(name, `'credentials' must be a mapping with exactly username/password`);
  }
  const creds = raw as Record<string, unknown>;

  const extraErr = rejectExtraCredKey(name, creds);
  if (extraErr !== undefined) return extraErr;

  if (!Object.prototype.hasOwnProperty.call(creds, "username")) {
    return mkConfigError(name, `'credentials' must contain 'username'`);
  }
  if (!Object.prototype.hasOwnProperty.call(creds, "password")) {
    return mkConfigError(name, `'credentials' must contain 'password'`);
  }

  const usernameResult = validateNonEmptyString(name, "credentials.username", creds["username"]);
  if (usernameResult instanceof AuthStrategyError) return usernameResult;

  const passwordResult = validateNonEmptyString(name, "credentials.password", creds["password"]);
  if (passwordResult instanceof AuthStrategyError) return passwordResult;

  return { username: usernameResult, password: passwordResult };
}

/**
 * Validates refresh_buffer_seconds: must be a non-negative finite number.
 * @param name - Strategy name for error messages.
 * @param value - The raw value to test.
 * @returns The validated number, or an AUTH_CONFIG_INVALID error.
 */
export function validateRefreshBuffer(name: string, value: unknown): number | AuthStrategyError {
  if (typeof value !== "number") {
    return mkConfigError(name, `'refresh_buffer_seconds' must be a number`);
  }
  if (!Number.isFinite(value)) {
    return mkConfigError(name, `'refresh_buffer_seconds' must be a finite number`);
  }
  if (value < 0) {
    return mkConfigError(name, `'refresh_buffer_seconds' must be non-negative`);
  }
  return value;
}

/**
 * Resolves the header field: returns the validated custom header, or the
 * default "Authorization" when the field is absent.
 * @param name - Strategy name for error messages.
 * @param rawHeader - The raw header field value from the config.
 * @returns The header string on success, or an AUTH_CONFIG_INVALID error.
 */
export function resolveHeader(name: string, rawHeader: unknown): string | AuthStrategyError {
  const coerced = coerceOptional(rawHeader as string | null | undefined);
  if (coerced === undefined) return DEFAULT_HEADER;
  return validateNonEmptyString(name, "header", coerced);
}

/**
 * Resolves the header_value field: returns the validated custom header_value
 * (with placeholder check), or the default "Bearer ${token}" when absent.
 * @param name - Strategy name for error messages.
 * @param rawHV - The raw header_value field value from the config.
 * @returns The header_value string on success, or an AUTH_CONFIG_INVALID /
 *   AUTH_HEADER_TEMPLATE_INVALID error.
 */
export function resolveHeaderValue(name: string, rawHV: unknown): string | AuthStrategyError {
  const coerced = coerceOptional(rawHV as string | null | undefined);
  if (coerced === undefined) return DEFAULT_HEADER_VALUE;
  const hvResult = validateNonEmptyString(name, "header_value", coerced);
  if (hvResult instanceof AuthStrategyError) return hvResult;
  const phErr = validateHeaderValue(name, hvResult);
  if (phErr !== undefined) return phErr;
  return hvResult;
}

/**
 * Parses a required JSONPath field (e.g. token_path): rejects missing/empty
 * strings and bubbles parseJsonPath errors back as config errors.
 * @param name - Strategy name for error messages.
 * @param field - Field name cited in error messages.
 * @param raw - The raw field value from the config.
 * @returns The ParsedJsonPath on success, or an AUTH_CONFIG_INVALID error.
 */
export function parseRequiredJsonPath(
  name: string,
  field: string,
  raw: unknown,
): ParsedJsonPath | AuthStrategyError {
  const coerced = coerceOptional(raw as string | null | undefined);
  if (coerced === undefined || coerced === "") {
    return mkConfigError(name, `'${field}' must be a non-empty string`);
  }
  const result = parseJsonPath(coerced);
  if (result instanceof AuthStrategyError) {
    return mkConfigError(name, result.message);
  }
  return result;
}

/**
 * Parses an optional JSONPath field (e.g. expires_in_path): returns undefined
 * when the field is absent, the parsed path on success, or an error.
 * @param name - Strategy name for error messages.
 * @param field - Field name cited in error messages.
 * @param raw - The raw field value from the config.
 * @returns The ParsedJsonPath, undefined (absent), or an AUTH_CONFIG_INVALID error.
 */
export function parseOptionalJsonPath(
  name: string,
  field: string,
  raw: unknown,
): ParsedJsonPath | undefined | AuthStrategyError {
  const coerced = coerceOptional(raw as string | null | undefined);
  if (coerced === undefined) return undefined;
  if (typeof coerced !== "string" || coerced.length === 0) {
    return mkConfigError(name, `'${field}' must be a non-empty string`);
  }
  const result = parseJsonPath(coerced);
  if (result instanceof AuthStrategyError) {
    return mkConfigError(name, result.message);
  }
  return result;
}
