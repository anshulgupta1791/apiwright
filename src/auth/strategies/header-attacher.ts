/**
 * Shared header-attachment helper for §6 authentication strategies.
 *
 * Implements the "${token}" substitution and case-insensitive header-collision
 * algorithm used identically by StaticTokenStrategy and TokenEndpointStrategy
 * (D7 + D16). Extracting into a single file prevents semantic drift between
 * the two strategies — one code path, one test suite.
 *
 * Substitution uses the function-form of String.replaceAll so that special
 * replacement patterns in the token value ($&, $$, $`, $') are treated as
 * literals and never interpreted as backreferences.
 *
 * Case-insensitive collision: ALL existing headers whose lowercase name matches
 * the target header are removed before the strategy's header is appended at
 * the configured casing (RFC 7230 §3.2: header names are case-insensitive;
 * strategy wins per AC#4).
 *
 * Non-mutating: returns a NEW top-level object and a NEW headers map; the input
 * PreparedRequest is never modified (D11).
 */

import type { AuthorizedRequest, PreparedRequest } from "../types.js";

/** Placeholder literal replaced in the header value template (D7 + D16). */
const TOKEN_PLACEHOLDER = "${token}";

/**
 * Applies a configured auth header to a request, returning a new
 * {@link AuthorizedRequest}.
 *
 * Steps:
 * 1. Substitute all occurrences of "${token}" in `headerValueTemplate` with
 *    the literal `token` string (function-form replaceAll; $-escape safe).
 * 2. Remove ALL case-variants of `headerName` from the input headers (RFC 7230
 *    case-insensitive header semantics; strategy header wins).
 * 3. Append `headerName` with the resolved value.
 * 4. Return `{ ...request, headers: newHeaders }` — a new top-level object
 *    whose headers map is also new (D11 structural non-mutation).
 * @param request - The unauth'd prepared request; never mutated.
 * @param headerName - The header name at the strategy's configured casing.
 * @param headerValueTemplate - The value template, may contain "${token}".
 * @param token - The resolved token string to substitute for "${token}".
 * @returns A new AuthorizedRequest with the auth header attached.
 */
export function attachAuthHeader(
  request: PreparedRequest,
  headerName: string,
  headerValueTemplate: string,
  token: string,
): AuthorizedRequest {
  // Step 1: function-form replacement guarantees literal substitution
  // regardless of $ special chars in token (e.g. $$, $&, $`, $').
  const resolvedHeaderValue = headerValueTemplate.replaceAll(
    TOKEN_PLACEHOLDER,
    () => token,
  );

  // Step 2+3: filter out ALL case-variants of headerName, then append at the
  // configured casing. Object.entries preserves insertion order (ES2015+).
  const targetLower = headerName.toLowerCase();
  const filteredEntries = Object.entries(request.headers).filter(
    ([k]) => k.toLowerCase() !== targetLower,
  );
  const newHeaders: Record<string, string> = Object.fromEntries([
    ...filteredEntries,
    [headerName, resolvedHeaderValue],
  ]);

  // Step 4: spread produces a new top-level object; headers is replaced by
  // newHeaders (also new). D11: input is never mutated.
  return { ...request, headers: newHeaders };
}
