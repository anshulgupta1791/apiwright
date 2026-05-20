/**
 * Façade integration test for the §6 Authentication Strategy Layer barrel
 * (`src/auth/index.ts`). Mandated by YAML AC#5 and design §7.
 *
 * PROPERTIES PINNED:
 *   (1) Façade-only imports — every named/typed import in this file resolves
 *       through `src/auth/index.js`. No deep `src/auth/**` import. The
 *       `src/env` imports (`SecretRegistry`, `ResolvedEnvironment`) are the
 *       expected consumer pattern: callers carry an env fixture from a higher
 *       layer; the §6 barrel does not own env types.
 *   (2) Hermetic — no real network. The fake `HttpFetchSeam` returns a
 *       deterministic body; `static_token` never calls the seam at all.
 *   (3) Full lifecycle via barrel: `createAuthRegistry` → `acquire` →
 *       `apply` → header attached → `wrapForMarker` → mangled header →
 *       unknown name → `AuthStrategyError` thrown + `isAuthStrategyError`
 *       narrows + `AUTH_ERROR_CODES` key matches.
 *   (4) Both strategies (`static_token` + `token_endpoint`) exercised.
 *   (5) The marker dispatcher (`wrapForMarker`) exercised for
 *       `garbage_token_returns_401`.
 *   (6) `no_auth_returns_401` marker exercised (no-auth bypass path).
 *   (7) `closeAll` / `StrategyCloseResult` / `CloseAllOutcome` types are
 *       accessible via the barrel (compile-time pin + runtime call).
 *   (8) An env with NO `auth_strategies:` block produces a registry where
 *       `acquire` throws `AUTH_STRATEGY_UNKNOWN` (design AC#3 thin-factory).
 *
 * RED PHASE — `src/auth/index.ts` does not exist. ALL tests fail with
 * module-not-found at the top-level import statements.
 *
 * Named exports only; ESM `.js` specifiers; no raw JSON.parse; no `as any`;
 * no `@ts-ignore`; no `eslint-disable`.
 */

import { describe, it, expect } from "vitest";

import {
  createAuthRegistry,
  wrapForMarker,
  AUTH_ERROR_CODES,
  isAuthStrategyError,
  NEGATIVE_AUTH_MARKERS,
  AuthStrategyRegistry,
} from "../../../src/auth/index.js";
import type {
  HttpFetchSeam,
  HttpFetchInput,
  HttpFetchResult,
  PreparedRequest,
  AuthorizedRequest,
  CloseAllOutcome,
  StrategyCloseResult,
} from "../../../src/auth/index.js";

import { SecretRegistry } from "../../../src/env/secrets.js";
import type { ResolvedEnvironment } from "../../../src/env/types.js";

// ---------------------------------------------------------------------------
// Compile-time pin — type-only re-exports are reachable
// ---------------------------------------------------------------------------

// These aliases cause the TS compiler to resolve each type from the barrel.
// If any type is absent the file fails to compile.
type _PinCloseAllOutcome = CloseAllOutcome;
type _PinStrategyCloseResult = StrategyCloseResult;
type _PinPreparedRequest = PreparedRequest;
type _PinAuthorizedRequest = AuthorizedRequest;
type _PinHttpFetchSeam = HttpFetchSeam;
type _PinHttpFetchInput = HttpFetchInput;
type _PinHttpFetchResult = HttpFetchResult;

declare function _usePins(
  _a: _PinCloseAllOutcome,
  _b: _PinStrategyCloseResult,
  _c: _PinPreparedRequest,
  _d: _PinAuthorizedRequest,
  _e: _PinHttpFetchSeam,
  _f: _PinHttpFetchInput,
  _g: _PinHttpFetchResult,
): void;

// _usePins is a `declare function` — erased at runtime. Its parameter list
// satisfies noUnusedLocals at compile time. No runtime statement needed.

// ---------------------------------------------------------------------------
// Fixtures — deterministic, no I/O
// ---------------------------------------------------------------------------

/** Static bearer token present in the env fixture. */
const STATIC_TOKEN = "STATIC_TOKEN_xyz";

/** Token returned by the deterministic fake seam for token_endpoint. */
const FETCHED_TOKEN = "FETCHED_TOKEN_abc";

/** Mangled header value produced by GarbageTokenMangle (design §2.4). */
const EXPECTED_MANGLED_HEADER = "Bearer garbage_token_value";

/**
 * Synthetic resolved environment with one static_token and one token_endpoint
 * strategy. Mirrors the design §7.1 fixture exactly.
 */
const SYNTH_ENV_WITH_AUTH: ResolvedEnvironment = {
  name: "qa",
  prod: false,
  base_url: "https://api.example.com",
  default_sla_ms: 1000,
  auth_strategies: {
    sso_static: {
      type: "static_token",
      token: STATIC_TOKEN,
      header: "Authorization",
      header_value: "Bearer ${token}",
    },
    sso_endpoint: {
      type: "token_endpoint",
      url: "https://sso.example.com/oauth/token",
      credentials: { username: "u", password: "p" },
      token_path: "$.access_token",
      header: "Authorization",
      header_value: "Bearer ${token}",
    },
  },
};

/**
 * Synthetic env with NO auth_strategies block — exercises the thin-factory
 * path where the registry holds zero strategies (YAML AC#3).
 */
const SYNTH_ENV_NO_AUTH: ResolvedEnvironment = {
  name: "empty",
  prod: false,
  base_url: "https://api.example.com",
};

/**
 * A deterministic `HttpFetchSeam` that returns a fixed token-endpoint body.
 * No real network is involved.
 * @param _input - Unused; present to satisfy the `HttpFetchSeam` interface.
 * @returns A fixed 200 response with `access_token`.
 */
const fakeSeam: HttpFetchSeam = {
  async postJson(_input: HttpFetchInput): Promise<HttpFetchResult> {
    return {
      status: 200,
      body: { access_token: FETCHED_TOKEN, expires_in: 3600 },
    };
  },
};

/** Sample request passed to every `strategy.apply()` call. */
const SAMPLE_REQUEST: PreparedRequest = {
  method: "GET",
  url: "https://api.example.com/users",
  headers: {},
};

// ---------------------------------------------------------------------------
// Build shared fixtures once (construction does no I/O, no network)
// ---------------------------------------------------------------------------

const secrets = new SecretRegistry();
const registry = createAuthRegistry(SYNTH_ENV_WITH_AUTH, secrets, {
  fetchSeam: fakeSeam,
});

// ===========================================================================
// 1. createAuthRegistry — construction via barrel
// ===========================================================================

/**
 * Verifies that `createAuthRegistry` re-exported from the barrel constructs an
 * `AuthStrategyRegistry` instance without throwing, and that the result is an
 * instance of the barrel-exported `AuthStrategyRegistry` class (AC#3 thin
 * factory + D13 single construction path).
 */
describe("createAuthRegistry() — construction via barrel (AC#3)", () => {
  it("returns an AuthStrategyRegistry instance", () => {
    expect(registry).toBeInstanceOf(AuthStrategyRegistry);
  });

  it("does not throw during construction", () => {
    expect(() =>
      createAuthRegistry(SYNTH_ENV_WITH_AUTH, secrets, { fetchSeam: fakeSeam }),
    ).not.toThrow();
  });

  it("env with no auth_strategies block does not throw during construction", () => {
    expect(() => createAuthRegistry(SYNTH_ENV_NO_AUTH, new SecretRegistry())).not.toThrow();
  });

  it("env with no auth_strategies block returns an AuthStrategyRegistry", () => {
    const emptyRegistry = createAuthRegistry(SYNTH_ENV_NO_AUTH, new SecretRegistry());
    expect(emptyRegistry).toBeInstanceOf(AuthStrategyRegistry);
  });
});

// ===========================================================================
// 2. static_token strategy — acquire and apply via barrel
// ===========================================================================

/**
 * Exercises the static_token strategy path end-to-end through the barrel:
 * registry.acquire → strategy.apply → header asserted. The static_token
 * strategy never calls the HttpFetchSeam (AC#3, AC#4).
 */
describe("static_token strategy — acquire and apply via barrel (AC#5)", () => {
  it("acquire('sso_static') does not throw", () => {
    expect(() => registry.acquire("sso_static")).not.toThrow();
  });

  it("apply() attaches 'Bearer <token>' to the Authorization header", async () => {
    const strategy = registry.acquire("sso_static");
    const ctx = { env: SYNTH_ENV_WITH_AUTH, secrets };
    const out: AuthorizedRequest = await strategy.apply(SAMPLE_REQUEST, ctx);
    expect(out.headers["Authorization"]).toBe(`Bearer ${STATIC_TOKEN}`);
  });

  it("apply() preserves other request fields (method, url)", async () => {
    const strategy = registry.acquire("sso_static");
    const ctx = { env: SYNTH_ENV_WITH_AUTH, secrets };
    const out: AuthorizedRequest = await strategy.apply(SAMPLE_REQUEST, ctx);
    expect(out.method).toBe(SAMPLE_REQUEST.method);
    expect(out.url).toBe(SAMPLE_REQUEST.url);
  });

  it("apply() does not mutate the original request object", async () => {
    const strategy = registry.acquire("sso_static");
    const ctx = { env: SYNTH_ENV_WITH_AUTH, secrets };
    const originalHeaders = { ...SAMPLE_REQUEST.headers };
    await strategy.apply(SAMPLE_REQUEST, ctx);
    expect(SAMPLE_REQUEST.headers).toEqual(originalHeaders);
  });
});

// ===========================================================================
// 3. token_endpoint strategy — acquire and apply via barrel with fake seam
// ===========================================================================

/**
 * Exercises the token_endpoint strategy path through the barrel.
 * The fake seam returns `{ access_token: FETCHED_TOKEN }`.
 * The strategy should use the seam, extract the token via JSONPath, and
 * attach `Bearer <FETCHED_TOKEN>` to the Authorization header.
 */
describe("token_endpoint strategy — acquire and apply via barrel (AC#5)", () => {
  it("acquire('sso_endpoint') does not throw", () => {
    expect(() => registry.acquire("sso_endpoint")).not.toThrow();
  });

  it("apply() fetches via fake seam and attaches 'Bearer <fetched-token>'", async () => {
    const strategy = registry.acquire("sso_endpoint");
    const ctx = { env: SYNTH_ENV_WITH_AUTH, secrets };
    const out: AuthorizedRequest = await strategy.apply(SAMPLE_REQUEST, ctx);
    expect(out.headers["Authorization"]).toBe(`Bearer ${FETCHED_TOKEN}`);
  });

  it("apply() preserves method and url from the original request", async () => {
    const strategy = registry.acquire("sso_endpoint");
    const ctx = { env: SYNTH_ENV_WITH_AUTH, secrets };
    const out: AuthorizedRequest = await strategy.apply(SAMPLE_REQUEST, ctx);
    expect(out.method).toBe(SAMPLE_REQUEST.method);
    expect(out.url).toBe(SAMPLE_REQUEST.url);
  });
});

// ===========================================================================
// 4. wrapForMarker — garbage_token_returns_401 (design §7.1 + AC#5)
// ===========================================================================

/**
 * Verifies the `wrapForMarker` dispatcher re-exported from the barrel.
 * When wrapped with `garbage_token_returns_401` the strategy's `apply` result
 * should carry the mangled header value instead of the real token.
 */
describe("wrapForMarker('garbage_token_returns_401') — mangled header (AC#5, D9)", () => {
  it("wrapped strategy apply() returns the mangled Authorization header", async () => {
    const strategy = registry.acquire("sso_endpoint");
    const wrapped = wrapForMarker(strategy, "garbage_token_returns_401");
    const ctx = { env: SYNTH_ENV_WITH_AUTH, secrets };
    const out = await wrapped.apply(SAMPLE_REQUEST, ctx);
    expect(out.headers["Authorization"]).toBe(EXPECTED_MANGLED_HEADER);
  });

  it("wrapForMarker does not mutate the underlying strategy", async () => {
    const strategy = registry.acquire("sso_endpoint");
    wrapForMarker(strategy, "garbage_token_returns_401");
    // The original strategy still returns the real token.
    const ctx = { env: SYNTH_ENV_WITH_AUTH, secrets };
    const out = await strategy.apply(SAMPLE_REQUEST, ctx);
    expect(out.headers["Authorization"]).toBe(`Bearer ${FETCHED_TOKEN}`);
  });

  it("wrapped strategy preserves method and url", async () => {
    const strategy = registry.acquire("sso_endpoint");
    const wrapped = wrapForMarker(strategy, "garbage_token_returns_401");
    const ctx = { env: SYNTH_ENV_WITH_AUTH, secrets };
    const out = await wrapped.apply(SAMPLE_REQUEST, ctx);
    expect(out.method).toBe(SAMPLE_REQUEST.method);
    expect(out.url).toBe(SAMPLE_REQUEST.url);
  });
});

// ===========================================================================
// 5. wrapForMarker — no_auth_returns_401 (no-auth bypass path, D9)
// ===========================================================================

/**
 * Verifies the `no_auth_returns_401` marker wrapper path: the Authorization
 * header should be absent (or empty) from the applied result, signalling the
 * runner that this request intentionally carries no auth.
 */
describe("wrapForMarker('no_auth_returns_401') — no auth header (D9)", () => {
  it("wrapped static_token strategy apply() does not attach the real token", async () => {
    const strategy = registry.acquire("sso_static");
    const wrapped = wrapForMarker(strategy, "no_auth_returns_401");
    const ctx = { env: SYNTH_ENV_WITH_AUTH, secrets };
    const out = await wrapped.apply(SAMPLE_REQUEST, ctx);
    // No-auth bypass: Authorization header must be absent or empty.
    const authHeader = out.headers["Authorization"];
    const isAbsentOrEmpty =
      authHeader === undefined || authHeader === null || authHeader === "";
    expect(isAbsentOrEmpty).toBe(true);
  });

  it("NEGATIVE_AUTH_MARKERS includes 'no_auth_returns_401'", () => {
    expect(NEGATIVE_AUTH_MARKERS).toContain("no_auth_returns_401");
  });
});

// ===========================================================================
// 6. acquire unknown name — throws AuthStrategyError via barrel (AC#5, D5)
// ===========================================================================

/**
 * Verifies the error path: `registry.acquire("nope")` throws an
 * `AuthStrategyError` with code `AUTH_STRATEGY_UNKNOWN`. Both
 * `isAuthStrategyError` and `AUTH_ERROR_CODES` are consumed via barrel only.
 */
describe("registry.acquire() unknown name — throws AuthStrategyError (AC#5)", () => {
  it("throws when the strategy name is not registered", () => {
    expect(() => registry.acquire("nope")).toThrow();
  });

  it("thrown error satisfies isAuthStrategyError (barrel re-export)", () => {
    let caught: unknown;
    try {
      registry.acquire("nope");
    } catch (err: unknown) {
      caught = err;
    }
    expect(isAuthStrategyError(caught)).toBe(true);
  });

  it("thrown error has code AUTH_STRATEGY_UNKNOWN via AUTH_ERROR_CODES", () => {
    let caught: unknown;
    try {
      registry.acquire("nope");
    } catch (err: unknown) {
      caught = err;
    }
    if (isAuthStrategyError(caught)) {
      expect(caught.code).toBe(AUTH_ERROR_CODES.AUTH_STRATEGY_UNKNOWN);
    } else {
      // Force failure — isAuthStrategyError must have returned true above.
      expect(isAuthStrategyError(caught)).toBe(true);
    }
  });

  it("acquire unknown name on no-auth-strategies env throws AUTH_STRATEGY_UNKNOWN", () => {
    const emptyRegistry = createAuthRegistry(SYNTH_ENV_NO_AUTH, new SecretRegistry());
    let caught: unknown;
    try {
      emptyRegistry.acquire("anything");
    } catch (err: unknown) {
      caught = err;
    }
    expect(isAuthStrategyError(caught)).toBe(true);
    if (isAuthStrategyError(caught)) {
      expect(caught.code).toBe(AUTH_ERROR_CODES.AUTH_STRATEGY_UNKNOWN);
    }
  });
});

// ===========================================================================
// 7. closeAll — outcome types accessible via barrel (AC#1, open-q (a))
// ===========================================================================

/**
 * Verifies that `AuthStrategyRegistry.closeAll()` is callable and returns an
 * object with the `CloseAllOutcome` shape (accessible via barrel type imports).
 * The compile-time pin at the top of this file ensures the types compile.
 */
describe("registry.closeAll() — CloseAllOutcome shape via barrel (AC#1)", () => {
  it("closeAll() resolves without throwing on an unused registry", async () => {
    const r = createAuthRegistry(SYNTH_ENV_WITH_AUTH, new SecretRegistry(), {
      fetchSeam: fakeSeam,
    });
    expect(() => r.closeAll()).not.toThrow();
  });

  it("closeAll() returns an object with a results array", () => {
    const r = createAuthRegistry(SYNTH_ENV_WITH_AUTH, new SecretRegistry(), {
      fetchSeam: fakeSeam,
    });
    const outcome: CloseAllOutcome = r.closeAll();
    expect(outcome).toHaveProperty("results");
    expect(Array.isArray(outcome.results)).toBe(true);
  });

  it("closeAll() on a registry where strategies were acquired includes StrategyCloseResult entries", async () => {
    const r = createAuthRegistry(SYNTH_ENV_WITH_AUTH, new SecretRegistry(), {
      fetchSeam: fakeSeam,
    });
    const ctx = { env: SYNTH_ENV_WITH_AUTH, secrets: new SecretRegistry() };
    // Acquire both strategies to make them "known" to the registry.
    r.acquire("sso_static");
    const ep = r.acquire("sso_endpoint");
    await ep.apply(SAMPLE_REQUEST, ctx);
    const outcome: CloseAllOutcome = r.closeAll();
    // Each result must have at minimum a `name` field.
    for (const result of outcome.results) {
      const r2: StrategyCloseResult = result;
      expect(typeof r2.name).toBe("string");
    }
  });
});

// ===========================================================================
// 8. Fake HttpFetchSeam — type-compatible construction from barrel types only
// ===========================================================================

/**
 * Verifies the consumer ergonomics documented in design §2.3 §IMPORTANT:
 * a typed `HttpFetchSeam` can be declared using only barrel-imported types.
 * This test constructs a second fake seam using explicitly typed parameters
 * from the barrel, then exercises it through `createAuthRegistry`.
 */
describe("HttpFetchSeam + HttpFetchInput + HttpFetchResult — typed from barrel (AC#1, §2.3)", () => {
  it("a barrel-typed fake seam can be used with createAuthRegistry", async () => {
    // Typed explicitly with barrel-imported types (not inferred).
    const typedFakeSeam: HttpFetchSeam = {
      async postJson(input: HttpFetchInput): Promise<HttpFetchResult> {
        void input;
        return { status: 200, body: { access_token: "TYPED_SEAM_TOKEN" } };
      },
    };

    const r = createAuthRegistry(SYNTH_ENV_WITH_AUTH, new SecretRegistry(), {
      fetchSeam: typedFakeSeam,
    });
    const strategy = r.acquire("sso_endpoint");
    const ctx = { env: SYNTH_ENV_WITH_AUTH, secrets: new SecretRegistry() };
    const out: AuthorizedRequest = await strategy.apply(SAMPLE_REQUEST, ctx);
    expect(out.headers["Authorization"]).toBe("Bearer TYPED_SEAM_TOKEN");
  });

  it("seam receives postJson call with correct url from env config", async () => {
    const capturedInputs: HttpFetchInput[] = [];
    const capturingSeam: HttpFetchSeam = {
      async postJson(input: HttpFetchInput): Promise<HttpFetchResult> {
        capturedInputs.push(input);
        return { status: 200, body: { access_token: "CAP_TOKEN" } };
      },
    };

    const r = createAuthRegistry(SYNTH_ENV_WITH_AUTH, new SecretRegistry(), {
      fetchSeam: capturingSeam,
    });
    const strategy = r.acquire("sso_endpoint");
    const ctx = { env: SYNTH_ENV_WITH_AUTH, secrets: new SecretRegistry() };
    await strategy.apply(SAMPLE_REQUEST, ctx);

    expect(capturedInputs).toHaveLength(1);
    const firstInput = capturedInputs[0];
    expect(firstInput).toBeDefined();
    if (firstInput !== undefined) {
      expect(firstInput.url).toBe("https://sso.example.com/oauth/token");
    }
  });
});
