import { describe, it, expect, beforeEach, vi } from "vitest";

import {
  TokenEndpointStrategy,
} from "../../../../src/auth/strategies/token-endpoint-strategy.js";
import {
  AUTH_ERROR_CODES,
  AuthStrategyError,
} from "../../../../src/auth/errors.js";
import type {
  HttpFetchSeam,
  HttpFetchInput,
  HttpFetchResult,
} from "../../../../src/auth/http-fetch-seam.js";
import type {
  PreparedRequest,
  AuthorizedRequest,
  RunContext,
} from "../../../../src/auth/types.js";
import type {
  ValidatedTokenEndpointSpec,
} from "../../../../src/auth/config-parser.js";
import type { ParsedJsonPath } from "../../../../src/auth/jsonpath-subset.js";
import { SecretRegistry } from "../../../../src/env/secrets.js";

/**
 * Unit tests for `TokenEndpointStrategy` (Part 1 of 2).
 *
 * Covers: cold-start single-flight, cache-hit, concurrent single-flight,
 * failure eviction, lazy refresh (with and without expiresInPath),
 * SecretRegistry.add timing, close() lifecycle, and non-mutation contract (D11).
 *
 * Part 2 (`token-endpoint-strategy-errors.test.ts`) covers all D10 error
 * paths and the secret-free guarantee.
 *
 * RED PHASE: `src/auth/strategies/token-endpoint-strategy.ts` does not exist.
 * This file fails with ERR_MODULE_NOT_FOUND until the implementation-engineer
 * creates it. That import-failure is the intended red-phase outcome.
 *
 * REACTIVE-ON-401 is explicitly OUT OF SCOPE (Task #10 concern). No test for
 * it here.
 *
 * Coverage obligation: every branch of every conditional in
 * token-endpoint-strategy.ts must be reachable across this file + Part 2
 * (95% branch threshold per vitest config). Branches enumerated in design §6,
 * §7, §8: cache-hit; in-flight coalesce; cold-start; eviction; commit-guard;
 * close-mid-flight; expiresAt undefined / defined / expired; expiresInPath
 * present / absent; token found / not found / non-string; expires_in found /
 * not found / NaN / zero / negative / string / null / Infinity; seam throw.
 */

// ---------------------------------------------------------------------------
// Counting-fake HttpFetchSeam
// ---------------------------------------------------------------------------

/**
 * Programmed fake for `HttpFetchSeam`.  Each `postJson()` call increments
 * `fetchCount`, appends the input to `capturedInputs`, then dequeues and
 * returns (or throws) the next queued response.
 *
 * Queue entries:
 * - `{kind:"response", status, body}` — resolves immediately.
 * - `{kind:"delayed", status, body, signal}` — awaits `signal` before
 *   resolving; used by concurrent single-flight tests.
 * - `{kind:"reject", err}` — throws the error directly; used for seam-level
 *   network / non-2xx failures.
 *
 * Throws a plain `Error` (not `AuthStrategyError`) if the queue is empty when
 * `postJson` is called — surfaces test-author mistakes immediately.
 */
type QueuedEntry =
  | { kind: "response"; status: number; body: unknown }
  | { kind: "delayed"; status: number; body: unknown; signal: Promise<void> }
  | { kind: "reject"; err: AuthStrategyError };

class CountingFakeSeam implements HttpFetchSeam {
  fetchCount = 0;
  readonly capturedInputs: HttpFetchInput[] = [];
  private readonly queue: QueuedEntry[] = [];

  /** Enqueue a successful JSON response. */
  enqueueResponse(status: number, body: unknown): void {
    this.queue.push({ kind: "response", status, body });
  }

  /**
   * Enqueue a response that resolves only after `signal` settles.
   * Used for concurrent single-flight tests (§11.3, §11.7).
   */
  enqueueDelayed(
    status: number,
    body: unknown,
    signal: Promise<void>,
  ): void {
    this.queue.push({ kind: "delayed", status, body, signal });
  }

  /** Enqueue a rejection (seam-level failure). */
  enqueueRejection(err: AuthStrategyError): void {
    this.queue.push({ kind: "reject", err });
  }

  async postJson(input: HttpFetchInput): Promise<HttpFetchResult> {
    this.fetchCount++;
    this.capturedInputs.push(input);
    const next = this.queue.shift();
    if (next === undefined) {
      throw new Error(
        `CountingFakeSeam: no response queued for ${input.url}`,
      );
    }
    if (next.kind === "reject") throw next.err;
    if (next.kind === "delayed") {
      await next.signal;
      return { status: next.status, body: next.body };
    }
    return { status: next.status, body: next.body };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Creates a deferred signal: a Promise + its resolve function, used to control
 * when a `enqueueDelayed` response resolves in concurrent tests.
 * @returns Object containing `signal` (Promise) and `resolve` (callback).
 */
function makeDeferredSignal(): { signal: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const signal = new Promise<void>((r) => {
    resolve = r;
  });
  return { signal, resolve };
}

/**
 * Builds the minimal `ValidatedTokenEndpointSpec` used across most tests.
 * Overrides can be merged in via the optional parameter.
 * @param overrides - Partial spec fields to merge over the base fixture.
 * @returns A fully-typed ValidatedTokenEndpointSpec.
 */
function makeSpec(
  overrides: Partial<ValidatedTokenEndpointSpec> = {},
): ValidatedTokenEndpointSpec {
  return {
    kind: "token_endpoint",
    url: "https://sso.fixture.invalid/oauth/token",
    username: "fixture-username",
    password: "fixture-password",
    tokenPath: [{ kind: "key", key: "access_token" }] as ParsedJsonPath,
    expiresInPath: undefined,
    refreshBufferSeconds: 0,
    header: "Authorization",
    headerValue: "Bearer ${token}",
    ...overrides,
  };
}

/**
 * Builds a minimal PreparedRequest.
 * @param headers - Optional extra headers to include.
 */
function makeRequest(
  headers: Record<string, string> = {},
): PreparedRequest {
  return {
    method: "GET",
    url: "https://api.fixture.invalid/resource",
    headers,
  };
}

/**
 * Builds a stub RunContext (unused by the strategy — it reads only from spec
 * and #secrets captured at construction).
 */
function makeContext(): RunContext {
  return {
    env: {
      name: "test",
      prod: false,
      base_url: "https://api.fixture.invalid",
      default_sla_ms: 1000,
      auth_strategies: {},
    },
    secrets: new SecretRegistry(),
  };
}

/** Token value used as the "happy-path" fetch response. */
const FETCHED_TOKEN = "fixture-fetched-token-T1";

/** A second token value for refresh tests. */
const FETCHED_TOKEN_2 = "fixture-fetched-token-T2";

/** Body shape that satisfies the tokenPath `$.access_token`. */
const successBody = (token: string, expiresIn?: number): Record<string, unknown> => ({
  access_token: token,
  ...(expiresIn !== undefined ? { expires_in: expiresIn } : {}),
});

// ---------------------------------------------------------------------------
// describe: TokenEndpointStrategy — constructor
// ---------------------------------------------------------------------------

/**
 * Tests for constructor behaviour (§4): lazy construction, no fetch at ctor
 * time (D19/D5), no secrets.add at ctor time (D8), and `now` seam injection.
 */
describe("TokenEndpointStrategy — constructor", () => {
  it("constructs without throwing given valid spec, secrets, and seam", () => {
    const seam = new CountingFakeSeam();
    const secrets = new SecretRegistry();
    expect(() => new TokenEndpointStrategy(makeSpec(), secrets, seam)).not.toThrow();
  });

  it("does NOT call seam.postJson at construction (lazy fetch — D19/D5)", () => {
    const seam = new CountingFakeSeam();
    const secrets = new SecretRegistry();
    new TokenEndpointStrategy(makeSpec(), secrets, seam);
    expect(seam.fetchCount).toBe(0);
  });

  it("does NOT call secrets.add at construction (D8: register on extraction only)", () => {
    const seam = new CountingFakeSeam();
    const secrets = new SecretRegistry();
    new TokenEndpointStrategy(makeSpec(), secrets, seam);
    expect(secrets.size).toBe(0);
  });

  it("accepts a custom now() seam via the fourth constructor argument", () => {
    const seam = new CountingFakeSeam();
    const secrets = new SecretRegistry();
    const now = vi.fn(() => 99999);
    // Construction must succeed; now is only CALLED during apply(), not at ctor
    expect(
      () => new TokenEndpointStrategy(makeSpec(), secrets, seam, now),
    ).not.toThrow();
    expect(now).not.toHaveBeenCalled();
  });

  it("defaults now() to Date.now when the fourth argument is omitted", () => {
    // Tested indirectly: constructing without the arg must not throw and must
    // produce valid results. A deeper test (refresh math) appears in the
    // lazy-refresh describe block using an injected now.
    const seam = new CountingFakeSeam();
    seam.enqueueResponse(200, successBody(FETCHED_TOKEN));
    const secrets = new SecretRegistry();
    const strategy = new TokenEndpointStrategy(makeSpec(), secrets, seam);
    // apply() must succeed without the injected now
    return expect(strategy.apply(makeRequest(), makeContext())).resolves.toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// describe: TokenEndpointStrategy — cold-start (AC#1 + AC#2)
// ---------------------------------------------------------------------------

/**
 * Tests for the first-call fetch path (§6 §7). Verifies that exactly one HTTP
 * request is made, the request body carries the spec credentials (D14), the
 * response body is walked via extractByJsonPath, and the extracted token is
 * attached via the configured header template (D7/D16).
 */
describe("TokenEndpointStrategy — cold-start", () => {
  let seam: CountingFakeSeam;
  let secrets: SecretRegistry;
  let strategy: TokenEndpointStrategy;

  beforeEach(() => {
    seam = new CountingFakeSeam();
    secrets = new SecretRegistry();
    strategy = new TokenEndpointStrategy(makeSpec(), secrets, seam);
  });

  it("triggers exactly one fetch on the first apply() (AC#1)", async () => {
    seam.enqueueResponse(200, successBody(FETCHED_TOKEN));
    await strategy.apply(makeRequest(), makeContext());
    expect(seam.fetchCount).toBe(1);
  });

  it("posts to spec.url (D14)", async () => {
    seam.enqueueResponse(200, successBody(FETCHED_TOKEN));
    await strategy.apply(makeRequest(), makeContext());
    expect(seam.capturedInputs[0]?.url).toBe(
      "https://sso.fixture.invalid/oauth/token",
    );
  });

  it("posts {username, password} as the request body from the spec (D14)", async () => {
    seam.enqueueResponse(200, successBody(FETCHED_TOKEN));
    await strategy.apply(makeRequest(), makeContext());
    const input = seam.capturedInputs[0];
    expect(input?.body).toEqual({
      username: "fixture-username",
      password: "fixture-password",
    });
  });

  it("attaches the extracted token to the configured header (D7/D16)", async () => {
    seam.enqueueResponse(200, successBody(FETCHED_TOKEN));
    const result: AuthorizedRequest = await strategy.apply(
      makeRequest(),
      makeContext(),
    );
    expect(result.headers["Authorization"]).toBe(`Bearer ${FETCHED_TOKEN}`);
  });

  it("returns a new AuthorizedRequest referencing the prepared request's url and method", async () => {
    seam.enqueueResponse(200, successBody(FETCHED_TOKEN));
    const req = makeRequest();
    const result = await strategy.apply(req, makeContext());
    expect(result.url).toBe(req.url);
    expect(result.method).toBe(req.method);
  });
});

// ---------------------------------------------------------------------------
// describe: TokenEndpointStrategy — cache hit (no second fetch)
// ---------------------------------------------------------------------------

/**
 * Tests verifying that a second apply() within the validity window does NOT
 * trigger another HTTP fetch (§6 cache-hit branch).
 */
describe("TokenEndpointStrategy — cache hit", () => {
  it("does NOT fetch on the second apply() when the token is still fresh (no expiresInPath)", async () => {
    const seam = new CountingFakeSeam();
    seam.enqueueResponse(200, successBody(FETCHED_TOKEN));
    const strategy = new TokenEndpointStrategy(
      makeSpec(), // no expiresInPath → permanent cache
      new SecretRegistry(),
      seam,
    );
    await strategy.apply(makeRequest(), makeContext());
    await strategy.apply(makeRequest(), makeContext());
    expect(seam.fetchCount).toBe(1);
  });

  it("returns the cached token on the second apply() (same header value)", async () => {
    const seam = new CountingFakeSeam();
    seam.enqueueResponse(200, successBody(FETCHED_TOKEN));
    const strategy = new TokenEndpointStrategy(makeSpec(), new SecretRegistry(), seam);
    const r1 = await strategy.apply(makeRequest(), makeContext());
    const r2 = await strategy.apply(makeRequest(), makeContext());
    expect(r1.headers["Authorization"]).toBe(r2.headers["Authorization"]);
    expect(r2.headers["Authorization"]).toBe(`Bearer ${FETCHED_TOKEN}`);
  });

  it("does NOT fetch while now() < expiresAt (within refresh window)", async () => {
    let fakeNow = 0;
    const seam = new CountingFakeSeam();
    const expiresIn = 100; // seconds
    seam.enqueueResponse(200, successBody(FETCHED_TOKEN, expiresIn));
    const expiresInPath: ParsedJsonPath = [{ kind: "key", key: "expires_in" }];
    const strategy = new TokenEndpointStrategy(
      makeSpec({ expiresInPath, refreshBufferSeconds: 0 }),
      new SecretRegistry(),
      seam,
      () => fakeNow,
    );
    // First apply — cold start at now=0; expiresAt = 0 + 100*1000 - 0 = 100_000
    await strategy.apply(makeRequest(), makeContext());
    expect(seam.fetchCount).toBe(1);

    // now=50_000 → still within window
    fakeNow = 50_000;
    await strategy.apply(makeRequest(), makeContext());
    expect(seam.fetchCount).toBe(1); // cache hit
  });
});

// ---------------------------------------------------------------------------
// describe: TokenEndpointStrategy — single-flight cold-start (AC#3)
// ---------------------------------------------------------------------------

/**
 * Tests for the single-flight coalescing of concurrent apply() calls during
 * cold start (§6 branch b). Five concurrent callers must share ONE fetch.
 */
describe("TokenEndpointStrategy — single-flight cold-start (AC#3)", () => {
  it("fires exactly ONE fetch when 5 concurrent apply() calls overlap during cold start", async () => {
    const { signal, resolve } = makeDeferredSignal();
    const seam = new CountingFakeSeam();
    seam.enqueueDelayed(200, successBody(FETCHED_TOKEN), signal);
    const strategy = new TokenEndpointStrategy(makeSpec(), new SecretRegistry(), seam);
    const ctx = makeContext();
    const req = makeRequest();

    const concurrentApplies = Promise.all([
      strategy.apply(req, ctx),
      strategy.apply(req, ctx),
      strategy.apply(req, ctx),
      strategy.apply(req, ctx),
      strategy.apply(req, ctx),
    ]);
    // Allow microtasks to settle so all 5 queue on the same in-flight promise
    await Promise.resolve();
    resolve();
    const results = await concurrentApplies;

    expect(seam.fetchCount).toBe(1);
    for (const r of results) {
      expect(r.headers["Authorization"]).toBe(`Bearer ${FETCHED_TOKEN}`);
    }
  });
});

// ---------------------------------------------------------------------------
// describe: TokenEndpointStrategy — failure eviction (AC#3)
// ---------------------------------------------------------------------------

/**
 * Tests that a rejected fetch EVICTS the in-flight slot, so the NEXT apply()
 * starts a fresh fetch rather than re-rejecting with the memoized error (D5).
 */
describe("TokenEndpointStrategy — failure eviction (AC#3)", () => {
  it("evicts the in-flight slot on rejection so the next apply() retries fresh", async () => {
    const seam = new CountingFakeSeam();
    const fetchError = new AuthStrategyError({
      code: AUTH_ERROR_CODES.AUTH_TOKEN_FETCH_FAILED,
      phase: "fetch",
      message: "network failure",
    });
    seam.enqueueRejection(fetchError);
    seam.enqueueResponse(200, successBody(FETCHED_TOKEN));

    const strategy = new TokenEndpointStrategy(makeSpec(), new SecretRegistry(), seam);
    const ctx = makeContext();

    await expect(strategy.apply(makeRequest(), ctx)).rejects.toThrow();
    expect(seam.fetchCount).toBe(1);

    // Second apply must trigger a fresh fetch (not re-reject with memoized error)
    const result = await strategy.apply(makeRequest(), ctx);
    expect(seam.fetchCount).toBe(2);
    expect(result.headers["Authorization"]).toBe(`Bearer ${FETCHED_TOKEN}`);
  });

  it("re-raises the original AuthStrategyError on the first apply() that fails", async () => {
    const seam = new CountingFakeSeam();
    const fetchError = new AuthStrategyError({
      code: AUTH_ERROR_CODES.AUTH_TOKEN_FETCH_FAILED,
      phase: "fetch",
      message: "network timeout",
    });
    seam.enqueueRejection(fetchError);

    const strategy = new TokenEndpointStrategy(makeSpec(), new SecretRegistry(), seam);
    await expect(strategy.apply(makeRequest(), makeContext())).rejects.toBe(fetchError);
  });
});

// ---------------------------------------------------------------------------
// describe: TokenEndpointStrategy — lazy refresh (AC#4)
// ---------------------------------------------------------------------------

/**
 * Tests for the response-extracted lazy refresh mechanism (§6 §7 D6).
 * Refresh fires when now() >= expiresAt; old token stays in registry (D8
 * append-only); no refresh occurs when expiresInPath is omitted.
 */
describe("TokenEndpointStrategy — lazy refresh (AC#4)", () => {
  it("triggers a refresh when now() >= expiresAt", async () => {
    let fakeNow = 0;
    const seam = new CountingFakeSeam();
    const expiresIn = 100; // seconds
    seam.enqueueResponse(200, successBody(FETCHED_TOKEN, expiresIn));
    seam.enqueueResponse(200, successBody(FETCHED_TOKEN_2, expiresIn));

    const expiresInPath: ParsedJsonPath = [{ kind: "key", key: "expires_in" }];
    const strategy = new TokenEndpointStrategy(
      makeSpec({ expiresInPath, refreshBufferSeconds: 0 }),
      new SecretRegistry(),
      seam,
      () => fakeNow,
    );
    const ctx = makeContext();

    // Cold start at now=0; expiresAt = 0 + 100*1000 = 100_000
    const r1 = await strategy.apply(makeRequest(), ctx);
    expect(seam.fetchCount).toBe(1);
    expect(r1.headers["Authorization"]).toBe(`Bearer ${FETCHED_TOKEN}`);

    // Advance past expiresAt → refresh must fire
    fakeNow = 100_001;
    const r2 = await strategy.apply(makeRequest(), ctx);
    expect(seam.fetchCount).toBe(2);
    expect(r2.headers["Authorization"]).toBe(`Bearer ${FETCHED_TOKEN_2}`);
  });

  it("computes expiresAt using fetchTime (captured BEFORE await) + expires_in*1000 - bufferMs", async () => {
    let nowCalls = 0;
    // First call (fetchTime capture): returns 12345
    // Second call (expiry check before refresh): must be >= expiresAt to trigger
    const fakeNow = (): number => {
      nowCalls++;
      // Call 1: fetchTime = 12345
      // Call 2+: return just past expiresAt so refresh fires next check
      return nowCalls === 1 ? 12_345 : 12_345 + 100 * 1000 + 1;
    };

    const seam = new CountingFakeSeam();
    seam.enqueueResponse(200, successBody(FETCHED_TOKEN, 100));
    seam.enqueueResponse(200, successBody(FETCHED_TOKEN_2, 100));

    const expiresInPath: ParsedJsonPath = [{ kind: "key", key: "expires_in" }];
    const strategy = new TokenEndpointStrategy(
      makeSpec({ expiresInPath, refreshBufferSeconds: 0 }),
      new SecretRegistry(),
      seam,
      fakeNow,
    );
    const ctx = makeContext();

    await strategy.apply(makeRequest(), ctx); // cold-start; fetchTime=12345; expiresAt=112345
    // fakeNow for check returns 12345+100000+1=112346 > 112345 → refresh
    const r2 = await strategy.apply(makeRequest(), ctx);
    expect(seam.fetchCount).toBe(2);
    expect(r2.headers["Authorization"]).toBe(`Bearer ${FETCHED_TOKEN_2}`);
  });

  it("applies refreshBufferSeconds by subtracting from expiresAt", async () => {
    let fakeNow = 0;
    const seam = new CountingFakeSeam();
    // expires_in=100s, buffer=10s → expiresAt = 0 + 100_000 - 10_000 = 90_000
    seam.enqueueResponse(200, successBody(FETCHED_TOKEN, 100));
    seam.enqueueResponse(200, successBody(FETCHED_TOKEN_2, 100));

    const expiresInPath: ParsedJsonPath = [{ kind: "key", key: "expires_in" }];
    const strategy = new TokenEndpointStrategy(
      makeSpec({ expiresInPath, refreshBufferSeconds: 10 }),
      new SecretRegistry(),
      seam,
      () => fakeNow,
    );
    const ctx = makeContext();

    await strategy.apply(makeRequest(), ctx); // cold start; expiresAt=90_000
    fakeNow = 89_999; // before buffer-adjusted expiry → cache hit
    await strategy.apply(makeRequest(), ctx);
    expect(seam.fetchCount).toBe(1);

    fakeNow = 90_001; // past buffer-adjusted expiry → refresh
    await strategy.apply(makeRequest(), ctx);
    expect(seam.fetchCount).toBe(2);
  });

  it("retains BOTH old and new tokens in SecretRegistry after a refresh (D8 append-only)", async () => {
    let fakeNow = 0;
    const seam = new CountingFakeSeam();
    seam.enqueueResponse(200, successBody(FETCHED_TOKEN, 100));
    seam.enqueueResponse(200, successBody(FETCHED_TOKEN_2, 100));

    const expiresInPath: ParsedJsonPath = [{ kind: "key", key: "expires_in" }];
    const secrets = new SecretRegistry();
    const strategy = new TokenEndpointStrategy(
      makeSpec({ expiresInPath, refreshBufferSeconds: 0 }),
      secrets,
      seam,
      () => fakeNow,
    );
    const ctx = makeContext();

    await strategy.apply(makeRequest(), ctx);
    fakeNow = 100_001;
    await strategy.apply(makeRequest(), ctx);

    expect(secrets.values().has(FETCHED_TOKEN)).toBe(true);   // old token preserved
    expect(secrets.values().has(FETCHED_TOKEN_2)).toBe(true); // new token added
  });

  it("does NOT refresh when expiresInPath is omitted, even after advancing now() far ahead (AC#4)", async () => {
    let fakeNow = 0;
    const seam = new CountingFakeSeam();
    seam.enqueueResponse(200, successBody(FETCHED_TOKEN));

    const strategy = new TokenEndpointStrategy(
      makeSpec({ expiresInPath: undefined }),
      new SecretRegistry(),
      seam,
      () => fakeNow,
    );
    const ctx = makeContext();

    await strategy.apply(makeRequest(), ctx);
    fakeNow = 1_000_000_000; // 1 billion ms ahead
    await strategy.apply(makeRequest(), ctx);
    await strategy.apply(makeRequest(), ctx);
    expect(seam.fetchCount).toBe(1); // token cached for run duration
  });

  it("single-flights concurrent refresh attempts (§11.7)", async () => {
    let fakeNow = 0;
    const { signal, resolve } = makeDeferredSignal();
    const seam = new CountingFakeSeam();
    seam.enqueueResponse(200, successBody(FETCHED_TOKEN, 100));
    seam.enqueueDelayed(200, successBody(FETCHED_TOKEN_2, 100), signal);

    const expiresInPath: ParsedJsonPath = [{ kind: "key", key: "expires_in" }];
    const strategy = new TokenEndpointStrategy(
      makeSpec({ expiresInPath, refreshBufferSeconds: 0 }),
      new SecretRegistry(),
      seam,
      () => fakeNow,
    );
    const ctx = makeContext();
    const req = makeRequest();

    // Cold start
    await strategy.apply(req, ctx);
    expect(seam.fetchCount).toBe(1);

    // Advance past expiresAt and fire 5 concurrent refreshes
    fakeNow = 100_001;
    const refreshes = Promise.all([
      strategy.apply(req, ctx),
      strategy.apply(req, ctx),
      strategy.apply(req, ctx),
      strategy.apply(req, ctx),
      strategy.apply(req, ctx),
    ]);
    await Promise.resolve();
    resolve();
    await refreshes;

    expect(seam.fetchCount).toBe(2); // exactly one refresh fetch shared
  });
});

// ---------------------------------------------------------------------------
// describe: TokenEndpointStrategy — SecretRegistry.add timing (AC#2 + D8)
// ---------------------------------------------------------------------------

/**
 * Tests asserting that secrets.add is called AFTER fetch resolves (not at
 * construction) and BEFORE apply() returns, and accumulates over refreshes.
 */
describe("TokenEndpointStrategy — SecretRegistry.add timing (D8)", () => {
  it("calls secrets.add exactly once on the first apply(), with the extracted token", async () => {
    const seam = new CountingFakeSeam();
    seam.enqueueResponse(200, successBody(FETCHED_TOKEN));
    const secrets = new SecretRegistry();
    const strategy = new TokenEndpointStrategy(makeSpec(), secrets, seam);

    expect(secrets.size).toBe(0); // not registered at ctor

    await strategy.apply(makeRequest(), makeContext());

    expect(secrets.size).toBe(1);
    expect(secrets.values().has(FETCHED_TOKEN)).toBe(true);
  });

  it("calls secrets.add with the NEW token on refresh (total 2 calls, 2 distinct tokens)", async () => {
    let fakeNow = 0;
    const seam = new CountingFakeSeam();
    seam.enqueueResponse(200, successBody(FETCHED_TOKEN, 100));
    seam.enqueueResponse(200, successBody(FETCHED_TOKEN_2, 100));

    const expiresInPath: ParsedJsonPath = [{ kind: "key", key: "expires_in" }];
    const secrets = new SecretRegistry();
    const strategy = new TokenEndpointStrategy(
      makeSpec({ expiresInPath, refreshBufferSeconds: 0 }),
      secrets,
      seam,
      () => fakeNow,
    );
    const ctx = makeContext();

    await strategy.apply(makeRequest(), ctx);
    expect(secrets.size).toBe(1);

    fakeNow = 100_001;
    await strategy.apply(makeRequest(), ctx);
    expect(secrets.size).toBe(2);
  });

  it("does NOT call secrets.add on a cache-hit apply() (no second registration)", async () => {
    const seam = new CountingFakeSeam();
    seam.enqueueResponse(200, successBody(FETCHED_TOKEN));
    const secrets = new SecretRegistry();
    const strategy = new TokenEndpointStrategy(makeSpec(), secrets, seam);
    const ctx = makeContext();

    await strategy.apply(makeRequest(), ctx);
    const sizeAfterFirst = secrets.size;
    await strategy.apply(makeRequest(), ctx);
    expect(secrets.size).toBe(sizeAfterFirst); // unchanged
  });
});

// ---------------------------------------------------------------------------
// describe: TokenEndpointStrategy — close() lifecycle (AC#3)
// ---------------------------------------------------------------------------

/**
 * Tests for the public `close()` method (§8). Close must clear the cached
 * token and in-flight slot so the next apply() starts a fresh fetch (D5).
 */
describe("TokenEndpointStrategy — close() lifecycle (AC#3)", () => {
  it("exposes a public close() method", () => {
    const seam = new CountingFakeSeam();
    const strategy = new TokenEndpointStrategy(makeSpec(), new SecretRegistry(), seam);
    expect(typeof strategy.close).toBe("function");
  });

  it("close() is synchronous and does not throw", () => {
    const seam = new CountingFakeSeam();
    const strategy = new TokenEndpointStrategy(makeSpec(), new SecretRegistry(), seam);
    expect(() => strategy.close()).not.toThrow();
  });

  it("close() is idempotent — calling N times is safe", () => {
    const seam = new CountingFakeSeam();
    const strategy = new TokenEndpointStrategy(makeSpec(), new SecretRegistry(), seam);
    expect(() => {
      strategy.close();
      strategy.close();
      strategy.close();
    }).not.toThrow();
  });

  it("apply() after close() triggers a fresh fetch (cache cleared)", async () => {
    const seam = new CountingFakeSeam();
    seam.enqueueResponse(200, successBody(FETCHED_TOKEN));
    seam.enqueueResponse(200, successBody(FETCHED_TOKEN_2));
    const strategy = new TokenEndpointStrategy(makeSpec(), new SecretRegistry(), seam);
    const ctx = makeContext();

    await strategy.apply(makeRequest(), ctx);
    expect(seam.fetchCount).toBe(1);

    strategy.close();

    const r2 = await strategy.apply(makeRequest(), ctx);
    expect(seam.fetchCount).toBe(2);
    expect(r2.headers["Authorization"]).toBe(`Bearer ${FETCHED_TOKEN_2}`);
  });

  it("close() mid-flight: the in-flight apply() still resolves with the fetched token", async () => {
    const { signal, resolve } = makeDeferredSignal();
    const seam = new CountingFakeSeam();
    seam.enqueueDelayed(200, successBody(FETCHED_TOKEN), signal);

    const secrets = new SecretRegistry();
    const strategy = new TokenEndpointStrategy(makeSpec(), secrets, seam);
    const ctx = makeContext();

    // Start apply without awaiting
    const applyPromise = strategy.apply(makeRequest(), ctx);
    await Promise.resolve(); // let the fetch start

    // Close while fetch is in-flight
    strategy.close();

    // Resolve the delayed seam response
    resolve();
    const result = await applyPromise;

    // The in-flight apply() MUST resolve successfully (not throw)
    expect(result.headers["Authorization"]).toBe(`Bearer ${FETCHED_TOKEN}`);
  });

  it("close() mid-flight: secrets.add IS still called (D8 append-only, §8)", async () => {
    const { signal, resolve } = makeDeferredSignal();
    const seam = new CountingFakeSeam();
    seam.enqueueDelayed(200, successBody(FETCHED_TOKEN), signal);

    const secrets = new SecretRegistry();
    const strategy = new TokenEndpointStrategy(makeSpec(), secrets, seam);

    const applyPromise = strategy.apply(makeRequest(), makeContext());
    await Promise.resolve();
    strategy.close();
    resolve();
    await applyPromise;

    expect(secrets.values().has(FETCHED_TOKEN)).toBe(true);
  });

  it("close() mid-flight: subsequent apply() triggers a FRESH fetch (commit guard, §8)", async () => {
    const { signal, resolve } = makeDeferredSignal();
    const seam = new CountingFakeSeam();
    seam.enqueueDelayed(200, successBody(FETCHED_TOKEN), signal);
    seam.enqueueResponse(200, successBody(FETCHED_TOKEN_2));

    const strategy = new TokenEndpointStrategy(makeSpec(), new SecretRegistry(), seam);
    const ctx = makeContext();

    const applyPromise = strategy.apply(makeRequest(), ctx);
    await Promise.resolve();
    strategy.close();
    resolve();
    await applyPromise;

    // The commit guard must NOT have installed the cache (close() cleared #inFlight)
    // so the next apply() MUST trigger fetch #2
    const r2 = await strategy.apply(makeRequest(), ctx);
    expect(seam.fetchCount).toBe(2);
    expect(r2.headers["Authorization"]).toBe(`Bearer ${FETCHED_TOKEN_2}`);
  });
});

// ---------------------------------------------------------------------------
// describe: TokenEndpointStrategy — non-mutation contract (D11)
// ---------------------------------------------------------------------------

/**
 * Tests for the structural non-mutation guarantee (D11). apply() must return
 * a NEW object whose headers is a NEW map; the input PreparedRequest must be
 * identical to its pre-call snapshot.
 */
describe("TokenEndpointStrategy — non-mutation contract (D11)", () => {
  let seam: CountingFakeSeam;
  let strategy: TokenEndpointStrategy;

  beforeEach(() => {
    seam = new CountingFakeSeam();
    seam.enqueueResponse(200, successBody(FETCHED_TOKEN));
    strategy = new TokenEndpointStrategy(makeSpec(), new SecretRegistry(), seam);
  });

  it("returns a new AuthorizedRequest object (not the same reference as input)", async () => {
    const req = makeRequest();
    const result = await strategy.apply(req, makeContext());
    expect(result).not.toBe(req);
  });

  it("returns a new headers map (not the same reference as input.headers)", async () => {
    const req = makeRequest({ Accept: "application/json" });
    const result = await strategy.apply(req, makeContext());
    expect(result.headers).not.toBe(req.headers);
  });

  it("does not modify input.headers in place", async () => {
    const headers = { Accept: "application/json" };
    const req = makeRequest(headers);
    const snapshot = { ...headers };
    await strategy.apply(req, makeContext());
    expect(req.headers).toEqual(snapshot);
    expect("Authorization" in req.headers).toBe(false);
  });

  it("does not modify input.method, input.url, or input.body", async () => {
    const req: PreparedRequest = {
      method: "POST",
      url: "https://api.fixture.invalid/data",
      headers: {},
      body: { key: "value" },
    };
    const result = await strategy.apply(req, makeContext());
    expect(result.method).toBe("POST");
    expect(result.url).toBe("https://api.fixture.invalid/data");
    expect(result.body).toEqual({ key: "value" });
    expect(req.method).toBe("POST");
    expect(req.url).toBe("https://api.fixture.invalid/data");
  });
});

// ---------------------------------------------------------------------------
// describe: TokenEndpointStrategy — determinism
// ---------------------------------------------------------------------------

/**
 * Tests verifying that the same inputs + same now() + same seam produce the
 * same output on two successive runs (§11.15).
 */
describe("TokenEndpointStrategy — determinism", () => {
  it("same spec + same seam responses + same now → identical header output on two runs", async () => {
    const buildAndRun = async (): Promise<string> => {
      const seam = new CountingFakeSeam();
      seam.enqueueResponse(200, successBody("token-deterministic"));
      const strategy = new TokenEndpointStrategy(
        makeSpec(),
        new SecretRegistry(),
        seam,
        () => 0,
      );
      const result = await strategy.apply(makeRequest(), makeContext());
      return result.headers["Authorization"] ?? "";
    };

    const run1 = await buildAndRun();
    const run2 = await buildAndRun();
    expect(run1).toBe(run2);
  });
});

// ---------------------------------------------------------------------------
// describe: TokenEndpointStrategy — header attach smoke tests (D7/D16)
// ---------------------------------------------------------------------------

/**
 * A focused set of header-attachment smoke tests from the strategy side
 * (§11.14). Full suite lives in header-attacher.test.ts; these verify the
 * strategy correctly delegates to attachAuthHeader.
 */
describe("TokenEndpointStrategy — header attach via spec.headerValue (D7/D16)", () => {
  it("attaches Authorization: Bearer <token> for the standard Bearer template", async () => {
    const seam = new CountingFakeSeam();
    seam.enqueueResponse(200, successBody("TK"));
    const strategy = new TokenEndpointStrategy(
      makeSpec({ headerValue: "Bearer ${token}" }),
      new SecretRegistry(),
      seam,
    );
    const result = await strategy.apply(makeRequest(), makeContext());
    expect(result.headers["Authorization"]).toBe("Bearer TK");
  });

  it("substitutes multiple ${token} placeholders in the header value", async () => {
    const seam = new CountingFakeSeam();
    seam.enqueueResponse(200, successBody("TK"));
    const strategy = new TokenEndpointStrategy(
      makeSpec({ header: "X-Dual", headerValue: "${token}::${token}" }),
      new SecretRegistry(),
      seam,
    );
    const result = await strategy.apply(makeRequest(), makeContext());
    expect(result.headers["X-Dual"]).toBe("TK::TK");
  });

  it("handles a token containing $$ without double-substituting", async () => {
    const seam = new CountingFakeSeam();
    seam.enqueueResponse(200, successBody("tok$$en"));
    const strategy = new TokenEndpointStrategy(makeSpec(), new SecretRegistry(), seam);
    const result = await strategy.apply(makeRequest(), makeContext());
    expect(result.headers["Authorization"]).toBe("Bearer tok$$en");
  });

  it("wins case-insensitive collision: existing 'authorization' is replaced by 'Authorization'", async () => {
    const seam = new CountingFakeSeam();
    seam.enqueueResponse(200, successBody("TK"));
    const strategy = new TokenEndpointStrategy(makeSpec(), new SecretRegistry(), seam);
    const req = makeRequest({ authorization: "Bearer old" });
    const result = await strategy.apply(req, makeContext());
    expect(result.headers["Authorization"]).toBe("Bearer TK");
    expect("authorization" in result.headers).toBe(false);
  });
});
