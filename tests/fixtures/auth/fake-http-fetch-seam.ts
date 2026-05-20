/**
 * Injected counting fake `HttpFetchSeam` for the §6 Auth Strategy Layer corpus.
 *
 * `CountingFakeHttpFetchSeam` implements `HttpFetchSeam` with a FIFO response
 * queue, per-call and per-URL counters, captured-input recording, programmable
 * rejections, and a delayed-response mode for single-flight concurrency tests.
 * It throws a test-infrastructure `Error` (NOT an `AuthStrategyError`) when
 * `postJson` is called with an empty queue — this surfaces test-author mistakes
 * immediately rather than silently returning wrong data.
 *
 * Helper factories (`makeFakeSeamWithToken`, `makeDeferredSignal`,
 * `secretRegistryWithDecoy`) cover the common test-setup patterns.
 *
 * No real network. No randomness. No clock. Named exports only; no default
 * export.
 */

import {
  AUTH_ERROR_CODES,
  AuthStrategyError,
} from "../../../src/auth/index.js";
import type {
  HttpFetchSeam,
  HttpFetchInput,
  HttpFetchResult,
} from "../../../src/auth/index.js";
import { SecretRegistry } from "../../../src/env/secrets.js";

// ─── Internal queue item discriminated union ────────────────────────────────

/** A queued item that resolves immediately with a response. */
interface QueuedResponse {
  readonly kind: "response";
  readonly status: number;
  readonly body: unknown;
}

/** A queued item that resolves only after the given signal resolves. */
interface QueuedDelayed {
  readonly kind: "delayed";
  readonly status: number;
  readonly body: unknown;
  readonly signal: Promise<void>;
}

/** A queued item that rejects with the given error. */
interface QueuedReject {
  readonly kind: "reject";
  readonly err: AuthStrategyError;
}

type Queued = QueuedResponse | QueuedDelayed | QueuedReject;

// ─── CountingFakeHttpFetchSeam ───────────────────────────────────────────────

/**
 * Deterministic, counting, injectable fake `HttpFetchSeam` for §6 tests.
 *
 * Queue is FIFO; `postJson` dequeues one item per call. Throws a
 * test-infrastructure `Error` when the queue is empty (not an
 * `AuthStrategyError`) so test-author mistakes surface immediately.
 *
 * Use `reset()` between determinism runs (group K) to clear counters,
 * captures, and the queue.
 */
export class CountingFakeHttpFetchSeam implements HttpFetchSeam {
  readonly #queue: Queued[] = [];
  readonly #inputs: HttpFetchInput[] = [];
  readonly #urlCounts = new Map<string, number>();
  #total = 0;

  /** Total number of `postJson` calls across all URLs. */
  get fetchCount(): number {
    return this.#total;
  }

  /**
   * Number of `postJson` calls for a specific URL.
   * @param url - The URL to count calls for.
   * @returns The count, or `0` if never called.
   */
  fetchCountForUrl(url: string): number {
    return this.#urlCounts.get(url) ?? 0;
  }

  /** All captured `postJson` inputs in call order (FIFO). */
  get allInputs(): readonly HttpFetchInput[] {
    return this.#inputs;
  }

  /**
   * The most-recently captured `postJson` input, or `undefined` if never
   * called.
   */
  get lastInput(): HttpFetchInput | undefined {
    return this.#inputs.at(-1);
  }

  /**
   * Enqueues one immediate-response item. `postJson` will return
   * `{ status, body }` when this item is dequeued.
   * @param status - HTTP status code for the synthetic response.
   * @param body - Response body (any value).
   * @returns `this` for chaining.
   */
  enqueueResponse(status: number, body: unknown): this {
    this.#queue.push({ kind: "response", status, body });
    return this;
  }

  /**
   * Enqueues one rejection item. `postJson` will throw `err` when this item
   * is dequeued (re-thrown as-is, so the caller sees the original
   * `AuthStrategyError`).
   * @param err - The `AuthStrategyError` to throw.
   * @returns `this` for chaining.
   */
  enqueueRejection(err: AuthStrategyError): this {
    this.#queue.push({ kind: "reject", err });
    return this;
  }

  /**
   * Enqueues one delayed-response item. `postJson` awaits `resolveSignal`
   * before returning the response — used by single-flight concurrency tests
   * (group D) to hold all concurrent callers suspended until a test-controlled
   * `resolve()` fires.
   * @param status - HTTP status code.
   * @param body - Response body.
   * @param resolveSignal - A `Promise<void>` that, when resolved, unblocks the
   *   response.
   * @returns `this` for chaining.
   */
  enqueueDelayedResponse(
    status: number,
    body: unknown,
    resolveSignal: Promise<void>,
  ): this {
    this.#queue.push({ kind: "delayed", status, body, signal: resolveSignal });
    return this;
  }

  /**
   * Convenience preset: enqueues a network-failure rejection with code
   * `AUTH_TOKEN_FETCH_FAILED` and phase `"fetch"` via a thrown
   * `AuthStrategyError`.
   *
   * Callers import this to trigger the `AUTH_TOKEN_FETCH_FAILED` error path
   * without constructing the error manually.
   * @returns `this` for chaining.
   */
  enqueueNetworkFail(): this {
    const err = new AuthStrategyError({
      code: AUTH_ERROR_CODES.AUTH_TOKEN_FETCH_FAILED,
      phase: "fetch",
      message: "Token endpoint fetch failed (fake network failure).",
    });
    return this.enqueueRejection(err);
  }

  /**
   * Convenience preset: enqueues a non-2xx response rejection with code
   * `AUTH_TOKEN_FETCH_NON_2XX` and the given HTTP status code.
   * @param status - HTTP status code to embed in the error message.
   * @returns `this` for chaining.
   */
  enqueueNon2xx(status: number): this {
    const err = new AuthStrategyError({
      code: AUTH_ERROR_CODES.AUTH_TOKEN_FETCH_NON_2XX,
      phase: "fetch",
      message: `Token endpoint returned non-2xx status ${status}.`,
    });
    return this.enqueueRejection(err);
  }

  /**
   * Resets all counters, captured inputs, and the response queue.
   * Call between determinism runs (group K) so the second run starts clean.
   */
  reset(): void {
    this.#queue.length = 0;
    this.#inputs.length = 0;
    this.#urlCounts.clear();
    this.#total = 0;
  }

  /**
   * Implements `HttpFetchSeam.postJson`. Dequeues the next item and:
   * - Returns `{ status, body }` for `"response"` items.
   * - Awaits the signal then returns for `"delayed"` items.
   * - Throws the queued `AuthStrategyError` for `"reject"` items.
   * - Throws a test-infrastructure `Error` when the queue is empty.
   * @param input - The HTTP fetch input (URL + body + optional headers).
   * @returns The synthetic `HttpFetchResult`.
   */
  async postJson(input: HttpFetchInput): Promise<HttpFetchResult> {
    this.#total++;
    this.#urlCounts.set(input.url, (this.#urlCounts.get(input.url) ?? 0) + 1);
    this.#inputs.push(input);

    const next = this.#queue.shift();
    if (next === undefined) {
      throw new Error(
        `CountingFakeHttpFetchSeam: no response queued for ${input.url}`,
      );
    }
    if (next.kind === "reject") {
      throw next.err;
    }
    if (next.kind === "delayed") {
      await next.signal;
      return { status: next.status, body: next.body };
    }
    return { status: next.status, body: next.body };
  }
}

// ─── Helper factories ────────────────────────────────────────────────────────

/**
 * Builds a fresh `CountingFakeHttpFetchSeam` pre-loaded with one successful
 * token-endpoint response.
 * @param token - The access token string the fake response body carries under
 *   `$.access_token`.
 * @param expiresIn - Optional `expires_in` value (seconds). When provided the
 *   response body also carries `$.expires_in` — used by refresh-path tests.
 * @returns A seam with one queued `{ status: 200, body: { access_token, ...} }`
 *   response.
 */
export function makeFakeSeamWithToken(
  token: string,
  expiresIn?: number,
): CountingFakeHttpFetchSeam {
  const seam = new CountingFakeHttpFetchSeam();
  const body: Record<string, unknown> = { access_token: token };
  if (expiresIn !== undefined) {
    body["expires_in"] = expiresIn;
  }
  seam.enqueueResponse(200, body);
  return seam;
}

/**
 * A deferred signal used to hold a `CountingFakeHttpFetchSeam` delayed
 * response suspended until the test explicitly resolves it.
 */
export interface DeferredSignal {
  /** The `Promise<void>` passed to `enqueueDelayedResponse`. */
  readonly signal: Promise<void>;
  /** Call to unblock all callers awaiting `signal`. */
  readonly resolve: () => void;
}

/**
 * Creates a `{ signal, resolve }` pair for single-flight concurrency tests.
 *
 * Pass `signal` to `enqueueDelayedResponse(status, body, signal)` to hold
 * all concurrent `apply()` callers suspended. Call `resolve()` to unblock
 * them simultaneously, then `await Promise.all(...)` to assert that exactly
 * ONE fetch was made.
 * @returns A `DeferredSignal` with `signal` and `resolve`.
 */
export function makeDeferredSignal(): DeferredSignal {
  let resolveRef: (() => void) | undefined;
  const signal = new Promise<void>((res) => {
    resolveRef = res;
  });
  return {
    signal,
    resolve: () => {
      resolveRef?.();
    },
  };
}

/**
 * Returns a real `SecretRegistry` instance pre-loaded with a decoy string.
 *
 * The decoy (`"fixture-decoy-secret-value"`) verifies that the strategy adds
 * its OWN secret via `secrets.add()` — not the one already in the registry.
 * Tests that assert `secrets.values().has(FETCHED_TOKEN_T1)` can
 * simultaneously assert the decoy is still present (registry is append-only).
 * @returns A `SecretRegistry` with one pre-added entry.
 */
export function secretRegistryWithDecoy(): SecretRegistry {
  const reg = new SecretRegistry();
  reg.add("fixture-decoy-secret-value");
  return reg;
}
