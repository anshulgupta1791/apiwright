/**
 * Pure per-entry validator that turns one raw AuthStrategyConfig into a
 * ValidatedStrategySpec discriminated union, or returns an AuthStrategyError.
 *
 * Encodes locked decisions D6, D7, D8, D14, D15, D16, D19:
 *   D6  — expires_in_path optional JSONPath; refresh_buffer_seconds non-negative, default 30.
 *   D7  — header defaults to "Authorization"; header_value defaults to "Bearer ${token}".
 *   D8  — parser surfaces the resolved token string; SecretRegistry is the strategy's job.
 *   D14 — credentials EXACTLY {username, password}; any extra key rejected.
 *   D15 — grant_type / pkce / extra credentials keys rejected (v1.5 deferral).
 *   D16 — only ${token} placeholder honored in header_value.
 *   D19 — per-entry only; the registry aggregates across entries.
 *
 * Pure + deterministic: no Date, no random, no I/O, never throws.
 * @module
 */

import type { AuthStrategyConfig } from "../env/types.js";

import {
  DEFAULT_REFRESH_BUFFER_SECONDS,
  coerceOptional,
  mkConfigError,
  parseOptionalJsonPath,
  parseRequiredJsonPath,
  resolveHeader,
  resolveHeaderValue,
  validateCredentials,
  validateNonEmptyString,
  validateRefreshBuffer,
} from "./config-parser-helpers.js";
import { AuthStrategyError } from "./errors.js";
import type { ParsedJsonPath } from "./jsonpath-subset.js";

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

/**
 * The validated, typed spec for a "static_token" auth strategy.
 *
 * All fields are readonly: the spec is consumed by a long-lived
 * StaticTokenStrategy instance; mutation post-construction is a category error.
 * Discriminated on "kind" (not "type" from the raw config) so consumers cannot
 * accidentally pass the unvalidated input where a validated spec is expected.
 *
 * D7: "header" defaults to "Authorization"; "headerValue" defaults to
 * "Bearer ${token}". D8: "token" is surfaced here and registered with
 * SecretRegistry by the strategy at instantiation, not by this parser.
 */
export interface ValidatedStaticTokenSpec {
  /** Discriminant field — always "static_token". */
  readonly kind: "static_token";
  /** The strategy name as provided by the caller (env-layer map key). */
  readonly name: string;
  /** The resolved bearer token string (non-empty, no surrounding whitespace). */
  readonly token: string;
  /** HTTP header name to attach (defaults to "Authorization"). */
  readonly header: string;
  /**
   * Header value template. May contain "${token}" which the strategy
   * replaces at apply() time. Defaults to "Bearer ${token}".
   */
  readonly headerValue: string;
}

/**
 * The validated, typed spec for a "token_endpoint" auth strategy.
 *
 * All fields are readonly. "expiresInPath" is optional per D6.
 * Discriminated on "kind".
 */
export interface ValidatedTokenEndpointSpec {
  /** Discriminant field — always "token_endpoint". */
  readonly kind: "token_endpoint";
  /** The strategy name as provided by the caller (env-layer map key). */
  readonly name: string;
  /** Token endpoint URL (non-empty, no surrounding whitespace). */
  readonly url: string;
  /** Username credential for the token endpoint. */
  readonly username: string;
  /** Password credential for the token endpoint. */
  readonly password: string;
  /** Pre-parsed JSONPath to the token in the response (D6). */
  readonly tokenPath: ParsedJsonPath;
  /** HTTP header name to attach the resolved token to. */
  readonly header: string;
  /** Header value template. May contain "${token}". */
  readonly headerValue: string;
  /**
   * Pre-parsed JSONPath to the expires_in field; absent when the endpoint
   * does not return a TTL (D6 optional).
   */
  readonly expiresInPath?: ParsedJsonPath;
  /**
   * Seconds before expiry at which to proactively refresh the token.
   * Defaults to 30 (D6). Zero is accepted (non-negative means >= 0).
   */
  readonly refreshBufferSeconds: number;
}

/**
 * Discriminated union of all validated strategy specs. The "kind" field
 * narrows to the correct arm.
 */
export type ValidatedStrategySpec =
  | ValidatedStaticTokenSpec
  | ValidatedTokenEndpointSpec;

// ---------------------------------------------------------------------------
// D15 forbidden-field checker (shared by both arm validators)
// ---------------------------------------------------------------------------

/**
 * Checks for D15 forbidden fields (grant_type, pkce) on any arm.
 * @param name - Strategy name for error messages.
 * @param raw - The raw config to inspect.
 * @returns An AUTH_CONFIG_INVALID error if a forbidden field is present, or undefined.
 */
function rejectD15Fields(
  name: string,
  raw: AuthStrategyConfig,
): AuthStrategyError | undefined {
  if (coerceOptional(raw["grant_type"]) !== undefined) {
    return mkConfigError(name, `'grant_type' is not supported in v1.0 (deferred to v1.5)`);
  }
  if (coerceOptional(raw["pkce"]) !== undefined) {
    return mkConfigError(name, `'pkce' is not supported in v1.0 (deferred to v1.5)`);
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// static_token arm validator
// ---------------------------------------------------------------------------

/**
 * Checks static_token foreign-key fields that must not be present.
 * @param name - Strategy name for error messages.
 * @param raw - The raw config to inspect.
 * @returns An AUTH_CONFIG_INVALID error if a forbidden field is present, or undefined.
 */
function rejectStaticForeignKeys(
  name: string,
  raw: AuthStrategyConfig,
): AuthStrategyError | undefined {
  if (coerceOptional(raw["url"]) !== undefined) {
    return mkConfigError(name, `'url' is not allowed on a static_token strategy`);
  }
  if (coerceOptional(raw["credentials"]) !== undefined) {
    return mkConfigError(name, `'credentials' is not allowed on a static_token strategy`);
  }
  if (coerceOptional(raw["token_path"]) !== undefined) {
    return mkConfigError(name, `'token_path' is not allowed on a static_token strategy`);
  }
  if (coerceOptional(raw["expires_in_path"]) !== undefined) {
    return mkConfigError(name, `'expires_in_path' is not allowed on a static_token strategy`);
  }
  if (coerceOptional(raw["refresh_buffer_seconds"]) !== undefined) {
    return mkConfigError(
      name,
      `'refresh_buffer_seconds' is not allowed on a static_token strategy`,
    );
  }
  return undefined;
}

/**
 * Validates a raw config against the static_token arm rules (section 6.1).
 *
 * Returns a ValidatedStaticTokenSpec on success or an AuthStrategyError on
 * the first validation failure. Never throws.
 * @param name - The strategy name; included in every error message.
 * @param raw - The raw AuthStrategyConfig for a static_token entry.
 * @returns A ValidatedStaticTokenSpec on success, or an AuthStrategyError.
 */
function validateStaticToken(
  name: string,
  raw: AuthStrategyConfig,
): ValidatedStaticTokenSpec | AuthStrategyError {
  const d15Err = rejectD15Fields(name, raw);
  if (d15Err !== undefined) return d15Err;

  const foreignErr = rejectStaticForeignKeys(name, raw);
  if (foreignErr !== undefined) return foreignErr;

  const tokenResult = validateNonEmptyString(name, "token", coerceOptional(raw.token));
  if (tokenResult instanceof AuthStrategyError) return tokenResult;

  const headerResult = resolveHeader(name, raw.header);
  if (headerResult instanceof AuthStrategyError) return headerResult;

  const headerValueResult = resolveHeaderValue(name, raw.header_value);
  if (headerValueResult instanceof AuthStrategyError) return headerValueResult;

  return {
    kind: "static_token",
    name,
    token: tokenResult,
    header: headerResult,
    headerValue: headerValueResult,
  };
}

// ---------------------------------------------------------------------------
// token_endpoint arm validator helpers
// ---------------------------------------------------------------------------

/**
 * Resolves the optional refresh_buffer_seconds field for the token_endpoint arm.
 *
 * Returns the default 30 when the field is absent, or validates and returns
 * the provided value.
 * @param name - Strategy name for error messages.
 * @param raw - The raw config to read from.
 * @returns The refresh buffer in seconds, or an AUTH_CONFIG_INVALID error.
 */
function resolveRefreshBuffer(name: string, raw: AuthStrategyConfig): number | AuthStrategyError {
  const rawRBS = coerceOptional(raw["refresh_buffer_seconds"]);
  if (rawRBS === undefined) return DEFAULT_REFRESH_BUFFER_SECONDS;
  return validateRefreshBuffer(name, rawRBS);
}

/**
 * Validates the core required fields of a token_endpoint config (url, credentials,
 * token_path). Extracted to keep validateTokenEndpoint within complexity bounds.
 * @param name - Strategy name for error messages.
 * @param raw - The raw AuthStrategyConfig for a token_endpoint entry.
 * @returns An object with url, credentials, and tokenPath on success, or an error.
 */
function validateTokenEndpointCore(
  name: string,
  raw: AuthStrategyConfig,
): {
  readonly url: string;
  readonly username: string;
  readonly password: string;
  readonly tokenPath: ParsedJsonPath;
} | AuthStrategyError {
  const urlResult = validateNonEmptyString(name, "url", coerceOptional(raw.url));
  if (urlResult instanceof AuthStrategyError) return urlResult;

  const credsResult = validateCredentials(name, coerceOptional(raw.credentials));
  if (credsResult instanceof AuthStrategyError) return credsResult;

  const tokenPathResult = parseRequiredJsonPath(name, "token_path", raw.token_path);
  if (tokenPathResult instanceof AuthStrategyError) return tokenPathResult;

  return {
    url: urlResult,
    username: credsResult.username,
    password: credsResult.password,
    tokenPath: tokenPathResult,
  };
}

/**
 * Validates a raw config against the token_endpoint arm rules (section 6.2).
 *
 * Returns a ValidatedTokenEndpointSpec on success or an AuthStrategyError on
 * the first validation failure. Never throws.
 * @param name - The strategy name; included in every error message.
 * @param raw - The raw AuthStrategyConfig for a token_endpoint entry.
 * @returns A ValidatedTokenEndpointSpec on success, or an AuthStrategyError.
 */
function validateTokenEndpoint(
  name: string,
  raw: AuthStrategyConfig,
): ValidatedTokenEndpointSpec | AuthStrategyError {
  const d15Err = rejectD15Fields(name, raw);
  if (d15Err !== undefined) return d15Err;

  if (coerceOptional(raw["token"]) !== undefined) {
    return mkConfigError(name, `'token' is not allowed on a token_endpoint strategy`);
  }

  const coreResult = validateTokenEndpointCore(name, raw);
  if (coreResult instanceof AuthStrategyError) return coreResult;

  const eipResult = parseOptionalJsonPath(name, "expires_in_path", raw["expires_in_path"]);
  if (eipResult instanceof AuthStrategyError) return eipResult;

  const rbsResult = resolveRefreshBuffer(name, raw);
  if (rbsResult instanceof AuthStrategyError) return rbsResult;

  const headerResult = resolveHeader(name, raw.header);
  if (headerResult instanceof AuthStrategyError) return headerResult;

  const headerValueResult = resolveHeaderValue(name, raw.header_value);
  if (headerValueResult instanceof AuthStrategyError) return headerValueResult;

  const spec: ValidatedTokenEndpointSpec = {
    kind: "token_endpoint",
    name,
    url: coreResult.url,
    username: coreResult.username,
    password: coreResult.password,
    tokenPath: coreResult.tokenPath,
    header: headerResult,
    headerValue: headerValueResult,
    refreshBufferSeconds: rbsResult,
  };

  if (eipResult !== undefined) {
    return { ...spec, expiresInPath: eipResult };
  }
  return spec;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Pure per-entry validator: turns one raw AuthStrategyConfig into a
 * ValidatedStrategySpec, or returns an AuthStrategyError for the first failure.
 *
 * Never throws. Same input produces JSON-stringify-identical output (pure +
 * deterministic). Does not iterate the auth_strategies map (D19).
 * @param name - The strategy name (the auth_strategies map key); included in
 *   every error message for traceability.
 * @param raw - The raw AuthStrategyConfig from the env-layer (post env/secret
 *   resolution, post AJV type check).
 * @returns A ValidatedStrategySpec on success, or an AuthStrategyError on the
 *   first validation failure (code AUTH_CONFIG_INVALID or
 *   AUTH_HEADER_TEMPLATE_INVALID, phase "config").
 */
export function parseAuthStrategyConfig(
  name: string,
  raw: AuthStrategyConfig,
): ValidatedStrategySpec | AuthStrategyError {
  // Defensive: type may be absent if caller bypasses AJV (section 9-b)
  if (raw.type === undefined) {
    return mkConfigError(name, `missing required field 'type'`);
  }
  if (raw.type === "static_token") return validateStaticToken(name, raw);
  if (raw.type === "token_endpoint") return validateTokenEndpoint(name, raw);
  return mkConfigError(
    name,
    `unknown type '${String(raw.type)}' (v1.5: oauth_user_flow, session_cookie, hmac_sigv4)`,
  );
}
