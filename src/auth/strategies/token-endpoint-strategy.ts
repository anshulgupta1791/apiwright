/**
 * The "token_endpoint" AuthStrategy implementation (Task #9, §6, Layer B).
 *
 * Implements the full fetch-extract-cache-refresh lifecycle for an OAuth-style
 * password-grant token endpoint:
 *
 * D5  — Single-flight cold-start: the first apply() triggers one HTTP POST;
 *        concurrent apply() calls coalesce onto the same in-flight Promise.
 * D5  — Eviction-on-reject: a rejected fetch clears the in-flight slot so the
 *        NEXT apply() starts a fresh fetch (no rejection memoization).
 * D5  — close() clears the cached token and in-flight slot; subsequent apply()
 *        triggers a fresh fetch. Synchronous; idempotent.
 * D6  — Response-extracted lazy refresh: when expiresInPath is configured,
 *        expiresAt = fetchTime + expires_in*1000 - refreshBufferSeconds*1000.
 *        Once now() >= expiresAt, the next apply() triggers a refresh.
 *        Omitting expiresInPath means the token is cached for the run duration.
 *        REACTIVE-ON-401 is explicitly OUT OF SCOPE — deferred to Task #10.
 * D7  — Header attach via the shared attachAuthHeader helper (header-attacher.ts).
 * D8  — SecretRegistry.add called immediately after every successful extraction
 *        (cold-start AND every refresh). Old tokens are never removed (append-only).
 * D10 — Exhaustive, redaction-safe error mapping; no credentials/token/body
 *        in any message.
 * D11 — Non-mutating apply(): returns a new AuthorizedRequest; input is untouched.
 * D13 — INTERNAL: NOT re-exported from src/auth/index.ts (barrel). Reachable
 *        only via the deep specifier src/auth/strategies/token-endpoint-strategy.js.
 * D14 — POST body is exactly { username, password }; Content-Type is auto-set
 *        by the HttpFetchSeam (no seam concern for the strategy).
 * D19 — Lazy construction: constructor does NOT fetch; apply() triggers first fetch.
 */

import { SecretRegistry } from "../../env/secrets.js";
import type { ValidatedTokenEndpointSpec } from "../config-parser.js";
import { AUTH_ERROR_CODES, AuthStrategyError } from "../errors.js";
import type { HttpFetchSeam } from "../http-fetch-seam.js";
import { extractByJsonPath } from "../jsonpath-subset.js";
import type {
  AuthStrategy,
  AuthorizedRequest,
  PreparedRequest,
  RunContext,
} from "../types.js";

import { attachAuthHeader } from "./header-attacher.js";

// ---------------------------------------------------------------------------
// Named constants (no magic numbers)
// ---------------------------------------------------------------------------

/** Milliseconds per second — used in expiresAt computation. */
const MS_PER_SECOND = 1000;

// ---------------------------------------------------------------------------
// Internal result type for #fetchAndExtract
// ---------------------------------------------------------------------------

/** Internal result from a successful token fetch + extraction. */
interface FetchExtractResult {
  /** The extracted token string. */
  readonly token: string;
  /**
   * Computed expiresAt (epoch ms) when expiresInPath was configured,
   * or undefined when the token is cached indefinitely.
   */
  readonly nextExpiresAt: number | undefined;
}

/**
 * The "token_endpoint" authentication strategy.
 *
 * Performs a lazy POST to the configured token endpoint on first apply(),
 * extracts the token via JSONPath, caches it, and refreshes lazily when
 * expires_in is configured. Concurrent apply() calls share a single in-flight
 * fetch Promise. close() clears all cached state.
 *
 * INTERNAL: not exported from the auth barrel (D5/D13).
 */
export class TokenEndpointStrategy implements AuthStrategy {
  /** Immutable validated spec; never reassigned after construction. */
  readonly #spec: ValidatedTokenEndpointSpec;
  /** Shared registry for secret redaction; never reassigned. */
  readonly #secrets: SecretRegistry;
  /** Injected HTTP POST seam; never reassigned. */
  readonly #fetchSeam: HttpFetchSeam;
  /** Clock seam for deterministic refresh tests; defaults to Date.now. */
  readonly #now: () => number;

  /** Cached token from the most recent successful fetch; cleared by close(). */
  #cachedToken: string | undefined = undefined;
  /**
   * Epoch-ms at which the cached token should be refreshed (before it expires).
   * Undefined when expiresInPath is not configured (cache forever) or before
   * the first fetch.
   */
  #expiresAt: number | undefined = undefined;
  /**
   * The in-flight fetch Promise during cold-start or refresh. Concurrent
   * apply() calls await this same Promise (single-flight). Cleared on
   * resolve, reject (eviction), or close().
   */
  #inFlight: Promise<string> | undefined = undefined;
  /**
   * Monotonically-increasing serial number incremented on each #startFetch()
   * call AND on close(). Passed into the async body as a const; the commit
   * guard compares it to the current #fetchSerial to detect mid-flight close().
   * Avoids the TypeScript TS2454 "used before assigned" that arises when an
   * async IIFE closes over its own const Promise reference.
   */
  #fetchSerial = 0;

  /**
   * Constructs a TokenEndpointStrategy. Does NOT fetch at construction (D19/D5:
   * fetch is lazy on the first apply() call). Does NOT call secrets.add (D8:
   * registration happens on every successful extraction in #fetchAndExtract).
   * @param spec - The validated token_endpoint spec; all fields readonly.
   * @param secrets - The run-scoped secret registry; tokens added on extraction.
   * @param fetchSeam - Injectable HTTP POST seam (real or test double).
   * @param now - Optional clock seam; defaults to Date.now (YAML AC#8).
   */
  constructor(
    spec: ValidatedTokenEndpointSpec,
    secrets: SecretRegistry,
    fetchSeam: HttpFetchSeam,
    now: () => number = Date.now,
  ) {
    this.#spec = spec;
    this.#secrets = secrets;
    this.#fetchSeam = fetchSeam;
    this.#now = now;
  }

  /**
   * Clears cached token, expiresAt, and in-flight slot. Synchronous and
   * idempotent. The next apply() will trigger a fresh fetch.
   *
   * Does NOT await any in-flight fetch — an in-flight fetch will complete
   * in the background. The defensive commit guard inside #getValidToken
   * ensures that if a fetch resolves after close(), the cache is NOT
   * installed (the in-flight slot identity check fails).
   */
  close(): void {
    this.#cachedToken = undefined;
    this.#expiresAt = undefined;
    this.#inFlight = undefined;
    this.#fetchSerial += 1; // invalidate any in-flight commit guard
  }

  /**
   * Applies this strategy's auth to an outgoing request.
   *
   * Acquires a valid token (from cache or via a new fetch), then delegates
   * to attachAuthHeader for "${token}" substitution and case-insensitive
   * header attachment. Returns a NEW AuthorizedRequest (D11 non-mutation).
   * @param request - The unauth'd prepared request; never mutated.
   * @param _context - Run-scoped context; unused (token is self-contained in
   *   spec and the cached state; the injection point for secrets is #secrets
   *   captured at construction, not at apply time).
   * @returns A promise resolving to a new AuthorizedRequest with auth attached.
   * @throws {@link AuthStrategyError} on fetch failure, non-2xx, token miss,
   *   non-string token, or invalid expires_in. See D10 for full taxonomy.
   */
  async apply(
    request: PreparedRequest,
    _context: RunContext,
  ): Promise<AuthorizedRequest> {
    const token = await this.#getValidToken();
    return attachAuthHeader(
      request,
      this.#spec.header,
      this.#spec.headerValue,
      token,
    );
  }

  /**
   * Returns a valid cached token or starts a new fetch.
   *
   * Branch (a): fresh-cache hit — returns the cached token immediately.
   * Branch (b): in-flight coalesce — if a fetch is in progress, awaits
   *   the same Promise (single-flight, D5).
   * Branch (c): cold-start or refresh — starts a new fetch via an IIFE
   *   Promise that captures its own reference for the defensive commit guard.
   *
   * Eviction-on-reject (D5): if the fetch rejects, the in-flight slot is
   * cleared in the catch block so the NEXT apply() retries fresh.
   *
   * Defensive commit guard (§8): the IIFE checks
   * "this.#inFlight === promise" before installing the cache; if close()
   * was called mid-flight, the identity check fails and the cache is NOT
   * installed (tokens are still registered in secrets per D8 append-only).
   * @returns A promise resolving to the current valid token string.
   * @throws {@link AuthStrategyError} when the fetch or extraction fails.
   */
  async #getValidToken(): Promise<string> {
    // (a) Fresh-cache hit: token cached AND not expired.
    if (this.#cachedToken !== undefined) {
      if (this.#expiresAt === undefined || this.#now() < this.#expiresAt) {
        return this.#cachedToken;
      }
      // Expired — fall through to single-flight refresh.
    }

    // (b) Single-flight coalesce: share an in-flight Promise if one exists.
    if (this.#inFlight !== undefined) return this.#inFlight;

    // (c) Cold-start or refresh: delegate to #startFetch which creates the
    // Promise, registers it as #inFlight, and returns the same reference.
    // The reference is used for the single-flight eviction guard below.
    const activePromise = this.#startFetch();

    try {
      return await activePromise;
    } catch (err: unknown) {
      // D5 eviction: clear in-flight slot BEFORE re-raising so the next
      // apply() starts a fresh fetch rather than memoizing the rejection.
      if (this.#inFlight === activePromise) this.#inFlight = undefined;
      throw err;
    }
  }

  /**
   * Creates the cold-start / refresh fetch Promise, assigns it to #inFlight,
   * and returns the reference. Separated from #getValidToken to keep complexity
   * under the lint limit. Uses #fetchSerial for the commit guard instead of a
   * Promise self-reference, avoiding the TypeScript TS2454 "used before
   * assigned" error and the prefer-const conflict.
   * @returns The newly-created in-flight Promise (same reference as #inFlight).
   */
  #startFetch(): Promise<string> {
    const fetchTime = this.#now(); // captured synchronously BEFORE any await
    this.#fetchSerial += 1;
    const mySerial = this.#fetchSerial; // const: captured in closure, never mutated

    const p = (async (): Promise<string> => {
      const { token, nextExpiresAt } = await this.#fetchAndExtract(fetchTime);

      // D8: register immediately after extraction (append-only; D8 verbatim).
      this.#secrets.add(token);

      // Defensive commit guard: only install the cache if close() has NOT been
      // called mid-flight. close() increments #fetchSerial, so a serial mismatch
      // means the cached state must NOT be installed.
      if (this.#fetchSerial === mySerial) {
        this.#cachedToken = token;
        this.#expiresAt = nextExpiresAt;
        this.#inFlight = undefined;
      }

      return token;
    })();

    this.#inFlight = p;
    return p;
  }

  /**
   * Fetches the token endpoint, extracts the token and optional expires_in,
   * and returns them. Throws {@link AuthStrategyError} on every failure.
   *
   * Fetch phase: delegates to the injected HttpFetchSeam.postJson; the seam
   * pre-builds and throws AUTH_TOKEN_FETCH_FAILED / AUTH_TOKEN_FETCH_NON_2XX
   * errors which propagate verbatim (D10).
   *
   * Extract phase: walks the response body with extractByJsonPath; throws
   * AUTH_TOKEN_NOT_FOUND / AUTH_TOKEN_NOT_STRING / AUTH_EXPIRES_IN_INVALID as
   * appropriate. Error messages NEVER cite the response body, token value,
   * username, or password (D10 no-leak guarantee).
   * @param fetchTime - The epoch-ms timestamp captured BEFORE the seam await,
   *   used for expiresAt = fetchTime + expires_in*1000 - bufferMs (D6).
   * @returns The extracted token and computed expiresAt.
   */
  async #fetchAndExtract(fetchTime: number): Promise<FetchExtractResult> {
    // Fetch (seam pre-wraps network/non-2xx errors per D10; propagated as-is).
    const result = await this.#fetchSeam.postJson({
      url: this.#spec.url,
      body: {
        username: this.#spec.username,
        password: this.#spec.password,
      },
    });

    // Token extraction (D10 extract phase).
    const tokenLookup = extractByJsonPath(result.body, this.#spec.tokenPath);
    if (!tokenLookup.found) {
      throw new AuthStrategyError({
        code: AUTH_ERROR_CODES.AUTH_TOKEN_NOT_FOUND,
        phase: "extract",
        message:
          "Token endpoint response did not contain the configured token field.",
      });
    }
    if (typeof tokenLookup.value !== "string") {
      throw new AuthStrategyError({
        code: AUTH_ERROR_CODES.AUTH_TOKEN_NOT_STRING,
        phase: "extract",
        message:
          `Token endpoint response token field was ${typeof tokenLookup.value}, ` +
          `expected string.`,
      });
    }
    const token = tokenLookup.value;

    // expires_in extraction (D6: only when expiresInPath is configured).
    let nextExpiresAt: number | undefined;
    if (this.#spec.expiresInPath !== undefined) {
      const expLookup = extractByJsonPath(result.body, this.#spec.expiresInPath);
      if (!expLookup.found) {
        throw new AuthStrategyError({
          code: AUTH_ERROR_CODES.AUTH_EXPIRES_IN_INVALID,
          phase: "extract",
          message:
            "Token endpoint response did not contain the configured expires_in field.",
        });
      }
      const v = expLookup.value;
      if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) {
        throw new AuthStrategyError({
          code: AUTH_ERROR_CODES.AUTH_EXPIRES_IN_INVALID,
          phase: "extract",
          message:
            "Token endpoint response expires_in was not a positive finite number.",
        });
      }
      nextExpiresAt =
        fetchTime + v * MS_PER_SECOND - this.#spec.refreshBufferSeconds * MS_PER_SECOND;
    }

    return { token, nextExpiresAt };
  }
}
