/**
 * Injectable HTTP POST-JSON seam for the §6 token-endpoint authentication strategy.
 *
 * Design refs: auth-http-fetch-seam.md §6, D2 (Alpaca hybrid / injectable), D3 (no new
 * prod deps), D14 (JSON-only; Content-Type: application/json auto-injected and wins on
 * conflict). Carries NO auth logic, NO JSONPath, NO caching, NO retry, NO timeout —
 * those are sibling-task concerns.
 *
 * Lazy-fetch contract: "globalThis.fetch" is resolved inside "postJson" only. Importing
 * this module and calling the factory do NOT touch globalThis.fetch. A test environment
 * that imports the module without ever calling "postJson" will NOT fail even if
 * globalThis.fetch is undefined (see design §7).
 */

import { AUTH_ERROR_CODES, AuthStrategyError } from "./errors.js";

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

/**
 * Inputs for a single JSON POST request through the seam.
 *
 * "body" is "unknown" — the seam JSON-serializes it via "JSON.stringify" and
 * passes the result verbatim. Callers are responsible for supplying a
 * JSON-serializable value; passing a non-serializable value (e.g. BigInt,
 * circular reference) is a programming error that surfaces as a synchronous
 * "TypeError" from "JSON.stringify" (see design edge-case g).
 */
export interface HttpFetchInput {
  /** Absolute URL of the token endpoint. Passed through as-is to "fetch". */
  readonly url: string;
  /**
   * Request body to JSON-serialize. Must be JSON-serializable; passing a
   * non-serializable value propagates a raw "TypeError" from "JSON.stringify".
   */
  readonly body: unknown;
  /**
   * Optional caller-supplied headers merged into the request. Content-Type
   * set here is silently overridden by the seam's auto-injected
   * "application/json" value (D14 hard-lock; design edge-case e).
   */
  readonly headers?: Readonly<Record<string, string>>;
}

/**
 * The result of a successful (2xx) JSON POST through the seam.
 *
 * "body" is "unknown" — the seam calls "response.json()" and returns the
 * parsed value without narrowing. The caller (token-endpoint strategy) owns
 * JSONPath extraction and type-narrowing.
 */
export interface HttpFetchResult {
  /** HTTP status code returned by the server (always in the 2xx range). */
  readonly status: number;
  /** Parsed JSON body returned by the server. May be "null" or "undefined". */
  readonly body: unknown;
}

/**
 * Pluggable seam for a single JSON POST request to a token endpoint.
 *
 * The default implementation wraps Node 22's native "globalThis.fetch" (D3).
 * Test doubles are plain object literals with a "vi.fn()" for "postJson".
 *
 * "Content-Type: application/json" is auto-injected by the default impl (D14);
 * caller headers may ADD other headers but the seam's built-in Content-Type wins
 * on conflict (design edge-case e). Custom implementations are not required to
 * enforce this — they own their own wire format.
 */
export interface HttpFetchSeam {
  /**
   * Sends a JSON POST to "input.url" and returns the parsed 2xx body.
   * @param input - URL, body, and optional extra headers for the request.
   * @returns Resolves with the HTTP status and parsed JSON body on 2xx.
   * @throws {@link AuthStrategyError} with code "AUTH_TOKEN_FETCH_FAILED" when
   *   the underlying fetch call rejects (network error, DNS failure, connection
   *   refused, cert error, undefined "globalThis.fetch") or when the 2xx
   *   response body is not valid JSON.
   * @throws {@link AuthStrategyError} with code "AUTH_TOKEN_FETCH_NON_2XX" when
   *   the server returns any status outside the 200-299 range.
   */
  postJson(input: HttpFetchInput): Promise<HttpFetchResult>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Lower bound of the 2xx success range (inclusive). */
const HTTP_2XX_MIN = 200;
/** Upper bound of the 2xx success range (exclusive). */
const HTTP_2XX_MAX = 300;

/** Fixed message for fetch-transport failures (AC#3, D10 no-leak). */
const MSG_FETCH_FAILED = "Token endpoint fetch failed.";

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates a fresh default {@link HttpFetchSeam} backed by Node 22's native
 * "globalThis.fetch" (D3 — zero new prod deps).
 *
 * Each call returns a distinct object (no shared singleton) so injection points
 * stay independent and stateless.
 *
 * Lazy-fetch: the factory does NOT resolve "globalThis.fetch" at call time.
 * "globalThis.fetch" is dereferenced only inside "postJson" so the factory
 * succeeds even when "globalThis.fetch" is undefined (design §7).
 *
 * Error mapping:
 * - Fetch rejects (any cause) → "AUTH_TOKEN_FETCH_FAILED", phase "fetch", cause attached.
 * - 2xx body not valid JSON → "AUTH_TOKEN_FETCH_FAILED", phase "fetch", cause attached.
 * - Non-2xx status → "AUTH_TOKEN_FETCH_NON_2XX", phase "fetch", NO cause (D10: response
 * body may carry secrets).
 * @returns A new {@link HttpFetchSeam} instance.
 */
export function createDefaultHttpFetchSeam(): HttpFetchSeam {
  return {
    /**
     * Sends a JSON POST and returns the parsed 2xx response body.
     * @param input - The URL, body, and optional headers for the request.
     * @returns Resolves with status + parsed body on 2xx.
     * @throws {@link AuthStrategyError} on fetch failure, non-2xx, or JSON parse failure.
     */
    async postJson(input: HttpFetchInput): Promise<HttpFetchResult> {
      const mergedHeaders: Record<string, string> = {
        ...(input.headers ?? {}),
        "Content-Type": "application/json",
      };

      const init: RequestInit = {
        method: "POST",
        headers: mergedHeaders,
        body: JSON.stringify(input.body),
      };

      let response: Response;
      try {
        response = await globalThis.fetch(input.url, init);
      } catch (cause: unknown) {
        throw new AuthStrategyError({
          code: AUTH_ERROR_CODES.AUTH_TOKEN_FETCH_FAILED,
          phase: "fetch",
          message: MSG_FETCH_FAILED,
          cause,
        });
      }

      if (response.status < HTTP_2XX_MIN || response.status >= HTTP_2XX_MAX) {
        throw new AuthStrategyError({
          code: AUTH_ERROR_CODES.AUTH_TOKEN_FETCH_NON_2XX,
          phase: "fetch",
          message: `Token endpoint returned non-2xx status ${response.status}.`,
        });
      }

      let parsedBody: unknown;
      try {
        parsedBody = await response.json();
      } catch (cause: unknown) {
        throw new AuthStrategyError({
          code: AUTH_ERROR_CODES.AUTH_TOKEN_FETCH_FAILED,
          phase: "fetch",
          message: MSG_FETCH_FAILED,
          cause,
        });
      }

      return { status: response.status, body: parsedBody };
    },
  };
}
