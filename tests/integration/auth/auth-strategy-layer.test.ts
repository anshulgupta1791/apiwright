/**
 * §6 Auth Strategy Layer — Hermetic GATED integration test.
 *
 * DESIGN CONTRACT: every group maps to a YAML AC and/or locked decision.
 * See `.tasks/design/auth-fixture-and-hermetic-integration.md` for the
 * full 12-group specification (groups A–L).
 *
 * Import discipline (LOCKED):
 * - ALL §6 value + type imports come from `src/auth/index.js` (barrel-only).
 * - ONE documented exception: groups F + G deep-import `TokenEndpointStrategy`
 *   directly from `src/auth/strategies/token-endpoint-strategy.js` to inject
 *   a custom `now()` seam for refresh-timing tests. The registry's `deps`
 *   parameter carries only `fetchSeam`; widening it to include `now` was
 *   rejected as out-of-scope architectural churn (design §6 option (b)).
 * - `SecretRegistry` imported from `src/env/secrets.js` (barrel does NOT
 *   re-export it per barrel design §8 row (l)).
 * - `src/db`, `src/assertions`, `src/cli` — NOT touched.
 *
 * Hermetic guarantees:
 * - No real network. All URLs end in `.invalid` (RFC 2606).
 * - No real `Date.now` in refresh tests (groups F/G inject a counter).
 * - No real filesystem, no process.env, no randomness.
 * - Runs in the gated `npm test` suite; counts toward 95% global coverage.
 *
 * AC mapping: AC#1→fixtures, AC#2→groups B–I, AC#3→groups A/I,
 * AC#4→group J, AC#5→group K, AC#6→coverage gate, AC#7→no src/ change,
 * AC#8→TSDoc + line limits + ESM + strict TS.
 *
 * D5 (single-flight)→group D, D6 (lazy-refresh)→group F, D8 (SecretRegistry
 * add)→groups B/C/F/H, D9 Approach C→group H row 3,
 * D10 (secret-free codes)→group J, D19 (aggregated fail-fast)→group A.
 */

import { describe, it, expect, beforeEach } from "vitest";

// ─── Barrel imports (ALL §6 values + types except deep-import exception) ─────

import {
  createAuthRegistry,
  wrapForMarker,
  AUTH_ERROR_CODES,
  isAuthStrategyError,
  AuthStrategyError,
} from "../../../src/auth/index.js";
import type {
  HttpFetchSeam,
  HttpFetchInput,
  HttpFetchResult,
  PreparedRequest,
  AuthorizedRequest,
  AuthStrategy,
  AuthErrorCode,
  CloseAllOutcome,
} from "../../../src/auth/index.js";

// ─── Deep-import exception: TokenEndpointStrategy for groups F + G only ──────
// Justified: `now` injection requires direct construction; registry `deps`
// does not forward `now`. See design §6 option (b) for full rationale.

import { TokenEndpointStrategy } from "../../../src/auth/strategies/token-endpoint-strategy.js";

// Deep-import for parseJsonPath (groups F + G need pre-parsed paths for
// TokenEndpointStrategy direct construction; the barrel does not re-export
// parseJsonPath since it is an INTERNAL helper).
import { parseJsonPath } from "../../../src/auth/jsonpath-subset.js";

// ─── SecretRegistry: NOT in barrel; import from env directly ─────────────────

import { SecretRegistry } from "../../../src/env/secrets.js";

// ─── Fixture imports ──────────────────────────────────────────────────────────

import {
  VALID_ENV,
  MARKER_SECRET_SUBSTRINGS,
  FETCHED_TOKEN_T1,
  FETCHED_TOKEN_T2,
  SAMPLE_REQUEST,
} from "../../fixtures/auth/environment.js";
import {
  INVALID_ENV,
  MALFORMED_NAMES,
} from "../../fixtures/auth/invalid-environment.js";
import {
  CountingFakeHttpFetchSeam,
  makeFakeSeamWithToken,
  makeDeferredSignal,
  secretRegistryWithDecoy,
} from "../../fixtures/auth/fake-http-fetch-seam.js";

// ─── Suppress unused-type lint warnings for imported types used only as
//     type annotations within test closures ──────────────────────────────────
type _Suppress =
  | HttpFetchSeam
  | HttpFetchInput
  | HttpFetchResult
  | PreparedRequest
   
  | AuthStrategy
  | AuthErrorCode
  | CloseAllOutcome;
const _suppress: _Suppress = null as unknown as _Suppress;
void _suppress;

// ─── Shared helpers ───────────────────────────────────────────────────────────

/**
 * Asserts that no string in `MARKER_SECRET_SUBSTRINGS` appears in any
 * serializable field of a thrown value. Used by every group-J sub-test.
 *
 * Checked fields: `.message`, `.code`, `.phase`, `.name`, and the full
 * `JSON.stringify(err)` serialisation.
 * @param err - The thrown value to inspect (expected to be `AuthStrategyError`).
 */
function assertSecretFree(err: unknown): void {
  for (const secret of MARKER_SECRET_SUBSTRINGS) {
    if (typeof err === "object" && err !== null) {
      const e = err as Record<string, unknown>;
      if (typeof e["message"] === "string") {
        expect(e["message"], `secret '${secret}' in .message`).not.toContain(secret);
      }
      if (typeof e["code"] === "string") {
        expect(e["code"], `secret '${secret}' in .code`).not.toContain(secret);
      }
      if (typeof e["phase"] === "string") {
        expect(e["phase"], `secret '${secret}' in .phase`).not.toContain(secret);
      }
      if (typeof e["name"] === "string") {
        expect(e["name"], `secret '${secret}' in .name`).not.toContain(secret);
      }
    }
    try {
      const json = JSON.stringify(err);
      expect(json, `secret '${secret}' in JSON.stringify`).not.toContain(secret);
    } catch {
      // JSON.stringify may throw for non-serializable values; ignore.
    }
  }
}

// ─── Shared test state (fresh per test via beforeEach) ───────────────────────

let secrets: SecretRegistry;
let seam: CountingFakeHttpFetchSeam;

beforeEach(() => {
  secrets = new SecretRegistry();
  seam = new CountingFakeHttpFetchSeam();
});

// ============================================================================
// Group A — Registry construction + fail-fast (AC#2 + AC#3)
// ============================================================================

describe("Group A — registry construction + fail-fast (AC#2/AC#3/D19)", () => {
  it("builds a registry from VALID_ENV without throwing", () => {
    expect(() =>
      createAuthRegistry(VALID_ENV, secrets, { fetchSeam: seam }),
    ).not.toThrow();
  });

  it("does not call the fake seam at construction even with token_endpoint entries", () => {
    createAuthRegistry(VALID_ENV, secrets, { fetchSeam: seam });
    expect(seam.fetchCount).toBe(0);
  });

  it("building a registry from INVALID_ENV throws exactly one AuthStrategyError", () => {
    expect(() =>
      createAuthRegistry(INVALID_ENV, secrets, { fetchSeam: seam }),
    ).toThrow(AuthStrategyError);
  });

  it("the aggregated error from INVALID_ENV has code AUTH_CONFIG_INVALID", () => {
    let thrown: unknown;
    try {
      createAuthRegistry(INVALID_ENV, secrets, { fetchSeam: seam });
    } catch (err) {
      thrown = err;
    }
    expect(isAuthStrategyError(thrown)).toBe(true);
    if (isAuthStrategyError(thrown)) {
      expect(thrown.code).toBe(AUTH_ERROR_CODES.AUTH_CONFIG_INVALID);
    }
  });

  it("the aggregated error message names all three malformed strategy entries", () => {
    let thrown: unknown;
    try {
      createAuthRegistry(INVALID_ENV, secrets, { fetchSeam: seam });
    } catch (err) {
      thrown = err;
    }
    if (!isAuthStrategyError(thrown)) {
      expect.fail("Expected AuthStrategyError");
      return;
    }
    for (const name of MALFORMED_NAMES) {
      expect(thrown.message).toContain(name);
    }
  });

  it("aggregated error names appear in env-insertion order (D19)", () => {
    let thrown: unknown;
    try {
      createAuthRegistry(INVALID_ENV, secrets, { fetchSeam: seam });
    } catch (err) {
      thrown = err;
    }
    if (!isAuthStrategyError(thrown)) {
      expect.fail("Expected AuthStrategyError");
      return;
    }
    const msg = thrown.message;
    const idx0 = msg.indexOf(MALFORMED_NAMES[0]);
    const idx1 = msg.indexOf(MALFORMED_NAMES[1]);
    const idx2 = msg.indexOf(MALFORMED_NAMES[2]);
    expect(idx0).toBeGreaterThan(-1);
    expect(idx1).toBeGreaterThan(idx0);
    expect(idx2).toBeGreaterThan(idx1);
  });

  it("empty auth_strategies map builds successfully; acquire unknown name throws AUTH_STRATEGY_UNKNOWN", () => {
    const envEmpty = { ...VALID_ENV, auth_strategies: {} };
    const registry = createAuthRegistry(envEmpty, secrets, { fetchSeam: seam });
    expect(() => registry.acquire("anything")).toThrow(AuthStrategyError);
    let thrown: unknown;
    try {
      registry.acquire("anything");
    } catch (err) {
      thrown = err;
    }
    if (isAuthStrategyError(thrown)) {
      expect(thrown.code).toBe(AUTH_ERROR_CODES.AUTH_STRATEGY_UNKNOWN);
    }
  });

  it("missing auth_strategies (undefined) builds successfully; acquire unknown name throws AUTH_STRATEGY_UNKNOWN", () => {
    const envNoStrategies = { ...VALID_ENV, auth_strategies: undefined };
    const registry = createAuthRegistry(envNoStrategies, secrets, { fetchSeam: seam });
    expect(() => registry.acquire("anything")).toThrow(AuthStrategyError);
  });
});

// ============================================================================
// Group B — Static-token end-to-end (AC#2(b)(c))
// ============================================================================

describe("Group B — static_token end-to-end (AC#2(b)(c) + D8)", () => {
  it("acquire('sso_static') returns a defined AuthStrategy instance", () => {
    const registry = createAuthRegistry(VALID_ENV, secrets, { fetchSeam: seam });
    const strategy = registry.acquire("sso_static");
    expect(strategy).toBeDefined();
    expect(typeof strategy.apply).toBe("function");
  });

  it("static token is registered in SecretRegistry at construction (D8)", () => {
    createAuthRegistry(VALID_ENV, secrets, { fetchSeam: seam });
    expect(secrets.values().has("fixture-static-token-value")).toBe(true);
  });

  it("apply() attaches the configured Authorization header (AC#2(c))", async () => {
    const registry = createAuthRegistry(VALID_ENV, secrets, { fetchSeam: seam });
    const strategy = registry.acquire("sso_static");
    const ctx = { env: VALID_ENV, secrets };
    const output: AuthorizedRequest = await strategy.apply(SAMPLE_REQUEST, ctx);
    expect(output.headers["Authorization"]).toBe(
      "Bearer fixture-static-token-value",
    );
  });

  it("5 sequential acquire('sso_static') calls return the SAME instance (AC#2(b))", () => {
    const registry = createAuthRegistry(VALID_ENV, secrets, { fetchSeam: seam });
    const first = registry.acquire("sso_static");
    for (let i = 0; i < 4; i++) {
      expect(registry.acquire("sso_static")).toBe(first);
    }
  });

  it("closeAll() returns ok:true and includes sso_static result (static has no close())", async () => {
    const registry = createAuthRegistry(VALID_ENV, secrets, { fetchSeam: seam });
    registry.acquire("sso_static");
    const outcome: CloseAllOutcome = registry.closeAll();
    expect(outcome.ok).toBe(true);
    const staticResult = outcome.results.find((r) => r.name === "sso_static");
    expect(staticResult).toBeDefined();
    expect(staticResult?.ok).toBe(true);
  });
});

// ============================================================================
// Group C — Token-endpoint cold-start (AC#2(c)(d))
// ============================================================================

describe("Group C — token_endpoint cold-start (AC#2(c)(d))", () => {
  it("acquire('sso_endpoint_no_refresh') triggers ZERO fetches before apply()", () => {
    const registry = createAuthRegistry(VALID_ENV, secrets, { fetchSeam: seam });
    registry.acquire("sso_endpoint_no_refresh");
    expect(seam.fetchCount).toBe(0);
  });

  it("first apply() on token_endpoint triggers exactly ONE fetch", async () => {
    seam.enqueueResponse(200, { access_token: FETCHED_TOKEN_T1 });
    const registry = createAuthRegistry(VALID_ENV, secrets, { fetchSeam: seam });
    const strategy = registry.acquire("sso_endpoint_no_refresh");
    const ctx = { env: VALID_ENV, secrets };
    await strategy.apply(SAMPLE_REQUEST, ctx);
    expect(seam.fetchCount).toBe(1);
  });

  it("apply() attaches fetched token in Authorization header", async () => {
    seam.enqueueResponse(200, { access_token: FETCHED_TOKEN_T1 });
    const registry = createAuthRegistry(VALID_ENV, secrets, { fetchSeam: seam });
    const strategy = registry.acquire("sso_endpoint_no_refresh");
    const ctx = { env: VALID_ENV, secrets };
    const output = await strategy.apply(SAMPLE_REQUEST, ctx);
    expect(output.headers["Authorization"]).toBe(`Bearer ${FETCHED_TOKEN_T1}`);
  });

  it("apply() registers the fetched token in SecretRegistry (D8)", async () => {
    seam.enqueueResponse(200, { access_token: FETCHED_TOKEN_T1 });
    const registry = createAuthRegistry(VALID_ENV, secrets, { fetchSeam: seam });
    const strategy = registry.acquire("sso_endpoint_no_refresh");
    const ctx = { env: VALID_ENV, secrets };
    await strategy.apply(SAMPLE_REQUEST, ctx);
    expect(secrets.values().has(FETCHED_TOKEN_T1)).toBe(true);
  });

  it("seam lastInput carries the posted credentials (URL + username + password)", async () => {
    seam.enqueueResponse(200, { access_token: FETCHED_TOKEN_T1 });
    const registry = createAuthRegistry(VALID_ENV, secrets, { fetchSeam: seam });
    const strategy = registry.acquire("sso_endpoint_no_refresh");
    const ctx = { env: VALID_ENV, secrets };
    await strategy.apply(SAMPLE_REQUEST, ctx);
    const input = seam.lastInput;
    expect(input).toBeDefined();
    expect(input?.url).toBe("https://sso.fixture.invalid/oauth/token");
    const body = input?.body as Record<string, unknown>;
    expect(body?.["username"]).toBe("fixture-username-value");
    expect(body?.["password"]).toBe("fixture-password-value");
  });
});

// ============================================================================
// Group D — Single-flight (AC#2(d) / D5)
// ============================================================================

describe("Group D — single-flight cold-start (AC#2(d) / D5)", () => {
  it("5 concurrent apply() calls on a fresh token_endpoint trigger exactly ONE fetch", async () => {
    const { signal, resolve } = makeDeferredSignal();
    seam.enqueueDelayedResponse(200, { access_token: FETCHED_TOKEN_T1 }, signal);
    const registry = createAuthRegistry(VALID_ENV, secrets, { fetchSeam: seam });
    const strategy = registry.acquire("sso_endpoint_no_refresh");
    const ctx = { env: VALID_ENV, secrets };

    // Launch 5 concurrent applies — all must share the same in-flight Promise.
    const applyPromises = Array.from({ length: 5 }, () =>
      strategy.apply(SAMPLE_REQUEST, ctx),
    );
    // Unblock the single deferred response.
    resolve();
    const results = await Promise.all(applyPromises);

    expect(seam.fetchCount).toBe(1);
    for (const output of results) {
      expect(output.headers["Authorization"]).toBe(`Bearer ${FETCHED_TOKEN_T1}`);
    }
  });
});

// ============================================================================
// Group E — Failure eviction (AC#2(e) / D5)
// ============================================================================

describe("Group E — failure eviction (AC#2(e) / D5)", () => {
  it("first apply() rejects; second apply() triggers a fresh fetch and succeeds", async () => {
    seam.enqueueNetworkFail();
    seam.enqueueResponse(200, { access_token: FETCHED_TOKEN_T1 });
    const registry = createAuthRegistry(VALID_ENV, secrets, { fetchSeam: seam });
    const strategy = registry.acquire("sso_endpoint_no_refresh");
    const ctx = { env: VALID_ENV, secrets };

    await expect(strategy.apply(SAMPLE_REQUEST, ctx)).rejects.toSatisfy(
      isAuthStrategyError,
    );
    const output = await strategy.apply(SAMPLE_REQUEST, ctx);
    expect(output.headers["Authorization"]).toBe(`Bearer ${FETCHED_TOKEN_T1}`);
    expect(seam.fetchCount).toBe(2);
  });
});

// ============================================================================
// Group F — Lazy refresh (AC#2(f) / D6) — uses deep-imported TokenEndpointStrategy
// ============================================================================
//
// Hand-coded ValidatedTokenEndpointSpec literal (design §6 sub-decision (ii)):
// avoids test-side dependency on `parseAuthStrategyConfig`; documents the
// kebab→camel mapping (token_path → tokenPath, etc.) inline.

describe("Group F — lazy refresh (AC#2(f) / D6) — deep-imported strategy", () => {
  it("advances now() past expiresAt triggers a refresh fetch (D6)", async () => {
    let fakeNow = 0;
    const fakeClock = (): number => fakeNow;

    // Build the parsed JSONPath for access_token and expires_in.
    // Since parseJsonPath is internal-only, we replicate the ParsedJsonPath
    // shape expected by TokenEndpointStrategy: an array of segment strings.
    // The token-endpoint strategy calls extractByJsonPath(body, tokenPath).
    // We need to pre-parse. Use the deep-import from jsonpath-subset.
    // parseJsonPath imported at top of file (deep-import exception for groups F+G).
    const tokenPathResult = parseJsonPath("$.access_token");
    const expiresPathResult = parseJsonPath("$.expires_in");
    if (isAuthStrategyError(tokenPathResult) || isAuthStrategyError(expiresPathResult)) {
      expect.fail("parseJsonPath failed on known-good paths");
      return;
    }

    const spec = {
      kind: "token_endpoint" as const,
      name: "sso_endpoint_refresh",
      url: "https://sso.fixture.invalid/oauth/token",
      username: "fixture-username-value",
      password: "fixture-password-value",
      tokenPath: tokenPathResult,
      expiresInPath: expiresPathResult,
      refreshBufferSeconds: 0,
      header: "Authorization",
      headerValue: "Bearer ${token}",
    };

    seam.enqueueResponse(200, { access_token: FETCHED_TOKEN_T1, expires_in: 100 });
    seam.enqueueResponse(200, { access_token: FETCHED_TOKEN_T2, expires_in: 100 });

    const strategy = new TokenEndpointStrategy(spec, secrets, seam, fakeClock);
    const ctx = { env: VALID_ENV, secrets };

    // now=0: cold-start fetch, expect T1
    fakeNow = 0;
    const out1 = await strategy.apply(SAMPLE_REQUEST, ctx);
    expect(seam.fetchCount).toBe(1);
    expect(out1.headers["Authorization"]).toBe(`Bearer ${FETCHED_TOKEN_T1}`);

    // now=50000 (< expiresAt=100*1000): cache hit, still T1
    fakeNow = 50_000;
    const out2 = await strategy.apply(SAMPLE_REQUEST, ctx);
    expect(seam.fetchCount).toBe(1);
    expect(out2.headers["Authorization"]).toBe(`Bearer ${FETCHED_TOKEN_T1}`);

    // now=100001 (> expiresAt=100*1000): expired, refresh to T2
    fakeNow = 100_001;
    const out3 = await strategy.apply(SAMPLE_REQUEST, ctx);
    expect(seam.fetchCount).toBe(2);
    expect(out3.headers["Authorization"]).toBe(`Bearer ${FETCHED_TOKEN_T2}`);
  });

  it("both tokens T1 and T2 appear in SecretRegistry after refresh (D8 append-only)", async () => {
    let fakeNow = 0;
    const fakeClock = (): number => fakeNow;

    // parseJsonPath imported at top of file (deep-import exception for groups F+G).
    const tokenPathResult = parseJsonPath("$.access_token");
    const expiresPathResult = parseJsonPath("$.expires_in");
    if (isAuthStrategyError(tokenPathResult) || isAuthStrategyError(expiresPathResult)) {
      expect.fail("parseJsonPath failed");
      return;
    }

    const spec = {
      kind: "token_endpoint" as const,
      name: "sso_endpoint_refresh",
      url: "https://sso.fixture.invalid/oauth/token",
      username: "fixture-username-value",
      password: "fixture-password-value",
      tokenPath: tokenPathResult,
      expiresInPath: expiresPathResult,
      refreshBufferSeconds: 0,
      header: "Authorization",
      headerValue: "Bearer ${token}",
    };

    seam.enqueueResponse(200, { access_token: FETCHED_TOKEN_T1, expires_in: 100 });
    seam.enqueueResponse(200, { access_token: FETCHED_TOKEN_T2, expires_in: 100 });

    const strategy = new TokenEndpointStrategy(spec, secrets, seam, fakeClock);
    const ctx = { env: VALID_ENV, secrets };

    fakeNow = 0;
    await strategy.apply(SAMPLE_REQUEST, ctx);
    fakeNow = 100_001;
    await strategy.apply(SAMPLE_REQUEST, ctx);

    expect(secrets.values().has(FETCHED_TOKEN_T1)).toBe(true);
    expect(secrets.values().has(FETCHED_TOKEN_T2)).toBe(true);
  });
});

// ============================================================================
// Group G — No refresh when expires_in_path omitted (AC#2(g))
// ============================================================================

describe("Group G — no refresh when expires_in_path omitted (AC#2(g))", () => {
  it("advancing now() by 1_000_000_000 ms still yields exactly 1 fetch", async () => {
    let fakeNow = 0;
    const fakeClock = (): number => fakeNow;

    // parseJsonPath imported at top of file (deep-import exception for groups F+G).
    const tokenPathResult = parseJsonPath("$.access_token");
    if (isAuthStrategyError(tokenPathResult)) {
      expect.fail("parseJsonPath failed");
      return;
    }

    // No expiresInPath — the cached-for-run path.
    const spec = {
      kind: "token_endpoint" as const,
      name: "sso_endpoint_no_refresh",
      url: "https://sso.fixture.invalid/oauth/token",
      username: "fixture-username-value",
      password: "fixture-password-value",
      tokenPath: tokenPathResult,
      refreshBufferSeconds: 0,
      header: "Authorization",
      headerValue: "Bearer ${token}",
    };

    seam.enqueueResponse(200, { access_token: FETCHED_TOKEN_T1 });

    const strategy = new TokenEndpointStrategy(spec, secrets, seam, fakeClock);
    const ctx = { env: VALID_ENV, secrets };

    fakeNow = 0;
    await strategy.apply(SAMPLE_REQUEST, ctx);
    expect(seam.fetchCount).toBe(1);

    fakeNow = 1_000_000_000;
    await strategy.apply(SAMPLE_REQUEST, ctx);
    expect(seam.fetchCount).toBe(1);
  });
});

// ============================================================================
// Group H — Negative-marker wrappers (AC#2(h)(i)(j) + D9 Approach C)
// ============================================================================

describe("Group H — negative-marker wrappers (AC#2(h)(i)(j) + D9 Approach C)", () => {
  it("wrapForMarker(static, 'no_auth_returns_401') → no auth header; input ref unchanged", async () => {
    const registry = createAuthRegistry(VALID_ENV, secrets, { fetchSeam: seam });
    const strategy = registry.acquire("sso_static");
    const staticSpec = VALID_ENV.auth_strategies?.["sso_static"];
    expect(staticSpec).toBeDefined();
    if (!staticSpec) return;

    const wrapped = wrapForMarker(strategy, "no_auth_returns_401", staticSpec as Parameters<typeof wrapForMarker>[2]);
    const ctx = { env: VALID_ENV, secrets };
    const output = await wrapped.apply(SAMPLE_REQUEST, ctx);
    expect(output.headers["Authorization"]).toBeUndefined();
    expect(output).toBe(SAMPLE_REQUEST);
  });

  it("wrapForMarker(static, 'garbage_token_returns_401') → header is 'Bearer garbage_token_value'", async () => {
    const registry = createAuthRegistry(VALID_ENV, secrets, { fetchSeam: seam });
    const strategy = registry.acquire("sso_static");
    const staticSpec = VALID_ENV.auth_strategies?.["sso_static"];
    if (!staticSpec) { expect.fail("spec missing"); return; }

    const wrapped = wrapForMarker(strategy, "garbage_token_returns_401", staticSpec as Parameters<typeof wrapForMarker>[2]);
    const ctx = { env: VALID_ENV, secrets };
    const output = await wrapped.apply(SAMPLE_REQUEST, ctx);
    expect(output.headers["Authorization"]).toBe("Bearer garbage_token_value");
  });

  it("CRITICAL (Approach C): GarbageTokenMangle on token_endpoint — inner.apply IS invoked (seam gets 1 call)", async () => {
    seam.enqueueResponse(200, { access_token: FETCHED_TOKEN_T1 });
    const registry = createAuthRegistry(VALID_ENV, secrets, { fetchSeam: seam });
    const strategy = registry.acquire("sso_endpoint_no_refresh");
    const endpointSpec = VALID_ENV.auth_strategies?.["sso_endpoint_no_refresh"];
    if (!endpointSpec) { expect.fail("spec missing"); return; }

    const wrapped = wrapForMarker(strategy, "garbage_token_returns_401", endpointSpec as Parameters<typeof wrapForMarker>[2]);
    const ctx = { env: VALID_ENV, secrets };
    const output = await wrapped.apply(SAMPLE_REQUEST, ctx);

    // Approach C: inner DID call seam (real fetch happened)
    expect(seam.fetchCount).toBe(1);
    // But the wire carries GARBAGE, not the real token
    expect(output.headers["Authorization"]).toBe("Bearer garbage_token_value");
    // Real token was registered for redaction (D8 still fires)
    expect(secrets.values().has(FETCHED_TOKEN_T1)).toBe(true);
  });

  it("wrapForMarker(strategy, 'unknown_marker', spec) returns the original strategy (identity branch)", () => {
    const registry = createAuthRegistry(VALID_ENV, secrets, { fetchSeam: seam });
    const strategy = registry.acquire("sso_static");
    const staticSpec = VALID_ENV.auth_strategies?.["sso_static"];
    if (!staticSpec) { expect.fail("spec missing"); return; }

    const wrapped = wrapForMarker(strategy, "unknown_marker", staticSpec as Parameters<typeof wrapForMarker>[2]);
    expect(wrapped).toBe(strategy);
  });

  it("wrapForMarker(strategy, '', spec) returns the original strategy (empty-marker identity branch)", () => {
    const registry = createAuthRegistry(VALID_ENV, secrets, { fetchSeam: seam });
    const strategy = registry.acquire("sso_static");
    const staticSpec = VALID_ENV.auth_strategies?.["sso_static"];
    if (!staticSpec) { expect.fail("spec missing"); return; }

    const wrapped = wrapForMarker(strategy, "", staticSpec as Parameters<typeof wrapForMarker>[2]);
    expect(wrapped).toBe(strategy);
  });
});

// ============================================================================
// Group I — closeAll() (AC#3(c))
// ============================================================================

describe("Group I — closeAll() lifecycle (AC#3(c))", () => {
  it("closeAll() after acquiring static + token_endpoint returns ok:true with both results", async () => {
    seam.enqueueResponse(200, { access_token: FETCHED_TOKEN_T1 });
    const registry = createAuthRegistry(VALID_ENV, secrets, { fetchSeam: seam });
    registry.acquire("sso_static");
    const tokenStrategy = registry.acquire("sso_endpoint_no_refresh");
    const ctx = { env: VALID_ENV, secrets };
    await tokenStrategy.apply(SAMPLE_REQUEST, ctx);

    const outcome = registry.closeAll();
    expect(outcome.ok).toBe(true);
    expect(outcome.results.length).toBe(2);
  });

  it("subsequent apply() on token_endpoint after closeAll() triggers a fresh fetch (cache cleared)", async () => {
    seam.enqueueResponse(200, { access_token: FETCHED_TOKEN_T1 });
    seam.enqueueResponse(200, { access_token: FETCHED_TOKEN_T2 });
    const registry = createAuthRegistry(VALID_ENV, secrets, { fetchSeam: seam });
    const strategy = registry.acquire("sso_endpoint_no_refresh");
    const ctx = { env: VALID_ENV, secrets };
    await strategy.apply(SAMPLE_REQUEST, ctx);
    expect(seam.fetchCount).toBe(1);

    registry.closeAll();

    // After closeAll, re-acquire triggers a fresh fetch on next apply()
    const freshStrategy = registry.acquire("sso_endpoint_no_refresh");
    await freshStrategy.apply(SAMPLE_REQUEST, ctx);
    expect(seam.fetchCount).toBe(2);
  });

  it("second closeAll() with no intervening acquire returns ok:true with empty results (idempotent)", () => {
    const registry = createAuthRegistry(VALID_ENV, secrets, { fetchSeam: seam });
    registry.acquire("sso_static");
    registry.closeAll();
    const second = registry.closeAll();
    expect(second.ok).toBe(true);
    expect(second.results).toEqual([]);
  });

  it("closeAll() before any acquire returns ok:true with empty results", () => {
    const registry = createAuthRegistry(VALID_ENV, secrets, { fetchSeam: seam });
    const outcome = registry.closeAll();
    expect(outcome.ok).toBe(true);
    expect(outcome.results).toEqual([]);
  });
});

// ============================================================================
// Group J — Secret-free error guarantee (AC#4 + D10)
// ============================================================================

describe("Group J — secret-free error guarantee (AC#4 + D10)", () => {
  it("AUTH_CONFIG_INVALID from INVALID_ENV contains no secret substrings", () => {
    let thrown: unknown;
    try {
      createAuthRegistry(INVALID_ENV, secrets, { fetchSeam: seam });
    } catch (err) {
      thrown = err;
    }
    expect(isAuthStrategyError(thrown)).toBe(true);
    assertSecretFree(thrown);
  });

  it("AUTH_TOKEN_FETCH_FAILED (fake network failure) contains no secret substrings", async () => {
    seam.enqueueNetworkFail();
    const registry = createAuthRegistry(VALID_ENV, secrets, { fetchSeam: seam });
    const strategy = registry.acquire("sso_endpoint_no_refresh");
    const ctx = { env: VALID_ENV, secrets };
    let thrown: unknown;
    try {
      await strategy.apply(SAMPLE_REQUEST, ctx);
    } catch (err) {
      thrown = err;
    }
    expect(isAuthStrategyError(thrown)).toBe(true);
    assertSecretFree(thrown);
  });

  it("AUTH_TOKEN_FETCH_NON_2XX (status 500) contains no secret substrings", async () => {
    seam.enqueueNon2xx(500);
    const registry = createAuthRegistry(VALID_ENV, secrets, { fetchSeam: seam });
    const strategy = registry.acquire("sso_endpoint_no_refresh");
    const ctx = { env: VALID_ENV, secrets };
    let thrown: unknown;
    try {
      await strategy.apply(SAMPLE_REQUEST, ctx);
    } catch (err) {
      thrown = err;
    }
    expect(isAuthStrategyError(thrown)).toBe(true);
    if (isAuthStrategyError(thrown)) {
      expect(thrown.code).toBe(AUTH_ERROR_CODES.AUTH_TOKEN_FETCH_NON_2XX);
    }
    assertSecretFree(thrown);
  });

  it("AUTH_TOKEN_NOT_FOUND (JSONPath miss) contains no secret substrings; phase is 'extract'", async () => {
    seam.enqueueResponse(200, { other: "x" });
    const registry = createAuthRegistry(VALID_ENV, secrets, { fetchSeam: seam });
    const strategy = registry.acquire("sso_endpoint_no_refresh");
    const ctx = { env: VALID_ENV, secrets };
    let thrown: unknown;
    try {
      await strategy.apply(SAMPLE_REQUEST, ctx);
    } catch (err) {
      thrown = err;
    }
    expect(isAuthStrategyError(thrown)).toBe(true);
    if (isAuthStrategyError(thrown)) {
      expect(thrown.code).toBe(AUTH_ERROR_CODES.AUTH_TOKEN_NOT_FOUND);
      expect(thrown.phase).toBe("extract");
    }
    assertSecretFree(thrown);
  });

  it("AUTH_TOKEN_NOT_STRING (numeric access_token) contains no secret substrings; message cites 'number'", async () => {
    seam.enqueueResponse(200, { access_token: 123 });
    const registry = createAuthRegistry(VALID_ENV, secrets, { fetchSeam: seam });
    const strategy = registry.acquire("sso_endpoint_no_refresh");
    const ctx = { env: VALID_ENV, secrets };
    let thrown: unknown;
    try {
      await strategy.apply(SAMPLE_REQUEST, ctx);
    } catch (err) {
      thrown = err;
    }
    expect(isAuthStrategyError(thrown)).toBe(true);
    if (isAuthStrategyError(thrown)) {
      expect(thrown.code).toBe(AUTH_ERROR_CODES.AUTH_TOKEN_NOT_STRING);
      expect(thrown.message).toContain("number");
      // The numeric VALUE (123) must not appear in the message:
      expect(thrown.message).not.toContain("123");
    }
    assertSecretFree(thrown);
  });

  it("AUTH_EXPIRES_IN_INVALID (negative expires_in) contains no secret substrings", async () => {
    seam.enqueueResponse(200, { access_token: FETCHED_TOKEN_T1, expires_in: -1 });
    const registry = createAuthRegistry(VALID_ENV, secrets, { fetchSeam: seam });
    // Use the refresh-enabled strategy (sso_endpoint_refresh) to exercise this path.
    const strategy = registry.acquire("sso_endpoint_refresh");
    const ctx = { env: VALID_ENV, secrets };
    let thrown: unknown;
    try {
      await strategy.apply(SAMPLE_REQUEST, ctx);
    } catch (err) {
      thrown = err;
    }
    expect(isAuthStrategyError(thrown)).toBe(true);
    if (isAuthStrategyError(thrown)) {
      expect(thrown.code).toBe(AUTH_ERROR_CODES.AUTH_EXPIRES_IN_INVALID);
    }
    assertSecretFree(thrown);
  });

  it("AUTH_HEADER_TEMPLATE_INVALID (inline fixture with bad placeholder) throws at construction", () => {
    // Inline minimal env — NOT INVALID_ENV (which would push aggregator count
    // above 3 and break group A assertions). Created here for this one error code.
    const envWithBadHeader = {
      ...VALID_ENV,
      auth_strategies: {
        bad_template: {
          type: "static_token" as const,
          token: "fixture-static-token-value",
          header: "Authorization",
          // The placeholder ${secret_LEAK_marker} is not ${token} — invalid.
          header_value: "Bearer ${secret_LEAK_marker}",
        },
      },
    };
    let thrown: unknown;
    try {
      createAuthRegistry(envWithBadHeader, secrets, { fetchSeam: seam });
    } catch (err) {
      thrown = err;
    }
    expect(isAuthStrategyError(thrown)).toBe(true);
    if (isAuthStrategyError(thrown)) {
      expect(thrown.code).toBe(AUTH_ERROR_CODES.AUTH_HEADER_TEMPLATE_INVALID);
    }
    assertSecretFree(thrown);
  });

  it("AUTH_STRATEGY_UNKNOWN contains no secret substrings; message lists known names", () => {
    const registry = createAuthRegistry(VALID_ENV, secrets, { fetchSeam: seam });
    let thrown: unknown;
    try {
      registry.acquire("nonexistent_strategy_name");
    } catch (err) {
      thrown = err;
    }
    expect(isAuthStrategyError(thrown)).toBe(true);
    if (isAuthStrategyError(thrown)) {
      expect(thrown.code).toBe(AUTH_ERROR_CODES.AUTH_STRATEGY_UNKNOWN);
      // Message must list at least one known name.
      expect(thrown.message).toContain("sso_static");
    }
    assertSecretFree(thrown);
  });
});

// ============================================================================
// Group K — Determinism (AC#5)
// ============================================================================

describe("Group K — determinism: corpus runs twice yield identical results (AC#5)", () => {
  /**
   * Runs the positive corpus (groups B/C happy paths) once with fresh state,
   * returns a JSON-stringified snapshot.
   */
  async function runCorpus(): Promise<string> {
    const localSecrets = new SecretRegistry();
    const localSeam = new CountingFakeHttpFetchSeam();

    // Static token apply
    const reg1 = createAuthRegistry(VALID_ENV, localSecrets, {
      fetchSeam: localSeam,
    });
    const staticStrategy = reg1.acquire("sso_static");
    const ctx = { env: VALID_ENV, secrets: localSecrets };
    const staticOut = await staticStrategy.apply(SAMPLE_REQUEST, ctx);

    // Token-endpoint cold-start apply
    localSeam.enqueueResponse(200, { access_token: FETCHED_TOKEN_T1 });
    const reg2 = createAuthRegistry(VALID_ENV, localSecrets, {
      fetchSeam: localSeam,
    });
    const tokenStrategy = reg2.acquire("sso_endpoint_no_refresh");
    const tokenOut = await tokenStrategy.apply(SAMPLE_REQUEST, ctx);

    return JSON.stringify({
      staticHeader: staticOut.headers["Authorization"],
      tokenHeader: tokenOut.headers["Authorization"],
      fetchCount: localSeam.fetchCount,
      staticTokenRegistered: localSecrets.values().has("fixture-static-token-value"),
      fetchedTokenRegistered: localSecrets.values().has(FETCHED_TOKEN_T1),
    });
  }

  it("running the corpus twice yields JSON-stringify-identical results", async () => {
    const run1 = await runCorpus();
    const run2 = await runCorpus();
    expect(run1).toBe(run2);
  });

  it("every failure becomes a typed AuthStrategyError (no raw throws)", async () => {
    seam.enqueueNetworkFail();
    const registry = createAuthRegistry(VALID_ENV, secrets, { fetchSeam: seam });
    const strategy = registry.acquire("sso_endpoint_no_refresh");
    const ctx = { env: VALID_ENV, secrets };
    let thrown: unknown;
    try {
      await strategy.apply(SAMPLE_REQUEST, ctx);
    } catch (err) {
      thrown = err;
    }
    expect(isAuthStrategyError(thrown)).toBe(true);
  });

  it("no real network used: all URLs end in .invalid (guaranteed DNS-fail if seam bypassed)", () => {
    // Structural: verify fixture URLs
    expect(VALID_ENV.base_url).toContain(".invalid");
    expect(VALID_ENV.auth_strategies?.["sso_endpoint_refresh"]?.url).toContain(".invalid");
    expect(VALID_ENV.auth_strategies?.["sso_endpoint_no_refresh"]?.url).toContain(".invalid");
  });

  it("seam.reset() clears counters, inputs, and queue between runs", async () => {
    seam.enqueueResponse(200, { access_token: FETCHED_TOKEN_T1 });
    const registry = createAuthRegistry(VALID_ENV, secrets, { fetchSeam: seam });
    const strategy = registry.acquire("sso_endpoint_no_refresh");
    const ctx = { env: VALID_ENV, secrets };
    await strategy.apply(SAMPLE_REQUEST, ctx);
    expect(seam.fetchCount).toBe(1);

    seam.reset();
    expect(seam.fetchCount).toBe(0);
    expect(seam.allInputs.length).toBe(0);
    expect(seam.lastInput).toBeUndefined();
  });
});

// ============================================================================
// Group L — Coverage gate (AC#7) — meta-assertion placeholder
// ============================================================================

describe("Group L — coverage gate placeholder (AC#7)", () => {
  // The 95% global coverage threshold is checked by Vitest's threshold gate
  // (configs/vitest.config.ts:35-41). This group documents the cross-task
  // obligation; no runtime assertion is needed here.
  it.todo(
    "coverage gate satisfied by suite combination: this gated integration suite + per-task unit suites yield ≥95% global",
  );
});
