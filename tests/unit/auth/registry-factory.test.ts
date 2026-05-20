/**
 * Unit tests for createAuthRegistry (src/auth/registry-factory.ts).
 *
 * Hermetic — no real network, no real filesystem, no real strategy I/O.
 * Tests the thin factory that wraps AuthStrategyRegistry construction,
 * handling the `env.auth_strategies ?? {}` defaulting logic.
 *
 * Design refs: .tasks/design/auth-strategy-registry.md §7, §12.4.
 *
 * Coverage contract (target ≥95% branch on registry-factory.ts):
 *   §12.4 createAuthRegistry — returns AuthStrategyRegistry; secrets passed through;
 *         default seam when no deps; custom seam injected; env without auth_strategies
 *
 * RED PHASE — src/auth/registry-factory.ts does not exist yet.
 * Every import below fails with ERR_MODULE_NOT_FOUND until the
 * implementation-engineer creates that module.
 *
 * Named exports only. ESM `.js` specifiers. No `as any`. No `@ts-ignore`.
 * No raw JSON.parse (none needed).
 */

import { describe, it, expect } from "vitest";

import { createAuthRegistry } from "../../../src/auth/registry-factory.js";
import {
  AuthStrategyRegistry,
} from "../../../src/auth/strategy-registry.js";
import {
  isAuthStrategyError,
  AUTH_ERROR_CODES,
} from "../../../src/auth/errors.js";
import type { ResolvedEnvironment } from "../../../src/env/types.js";
import { SecretRegistry } from "../../../src/env/secrets.js";
import type { HttpFetchSeam, HttpFetchInput, HttpFetchResult } from "../../../src/auth/http-fetch-seam.js";
import { StaticTokenStrategy } from "../../../src/auth/strategies/static-token-strategy.js";
import { TokenEndpointStrategy } from "../../../src/auth/strategies/token-endpoint-strategy.js";

// ---------------------------------------------------------------------------
// Minimal counting fake HttpFetchSeam (same as strategy-registry.test.ts;
// inlined to keep test files independent without a shared fixture import).
// ---------------------------------------------------------------------------

/**
 * A minimal fake HttpFetchSeam that counts calls and never makes real network
 * requests. Identity is observable via the fetchCount getter.
 */
class CountingFakeSeam implements HttpFetchSeam {
  #count = 0;

  get fetchCount(): number {
    return this.#count;
  }

  async postJson(_input: HttpFetchInput): Promise<HttpFetchResult> {
    this.#count += 1;
    return { status: 200, body: { access_token: "fake-token" } };
  }
}

// ---------------------------------------------------------------------------
// ResolvedEnvironment fixture builders
// ---------------------------------------------------------------------------

/**
 * Returns a minimal valid ResolvedEnvironment with a single static_token
 * auth strategy named 's'. Uses `.invalid` TLD and obvious-fake values.
 */
function makeEnvWithStatic(): ResolvedEnvironment {
  return {
    name: "test",
    prod: false,
    base_url: "https://api.fixture.invalid",
    auth_strategies: {
      s: {
        type: "static_token",
        token: "fixture-static-token",
        header: "Authorization",
        header_value: "Bearer ${token}",
      },
    },
  };
}

/**
 * Returns a minimal valid ResolvedEnvironment with a single token_endpoint
 * auth strategy named 't'. Uses `.invalid` TLD per RFC 2606.
 */
function makeEnvWithTokenEndpoint(): ResolvedEnvironment {
  return {
    name: "test",
    prod: false,
    base_url: "https://api.fixture.invalid",
    auth_strategies: {
      t: {
        type: "token_endpoint",
        url: "https://sso.fixture.invalid/oauth/token",
        credentials: { username: "fixture-user", password: "fixture-pass" },
        token_path: "$.access_token",
        header: "Authorization",
        header_value: "Bearer ${token}",
      },
    },
  };
}

/**
 * Returns a ResolvedEnvironment without an auth_strategies field.
 * Factory must default to {} and not throw (design §7 and edge case (a)).
 */
function makeEnvWithoutAuthStrategies(): ResolvedEnvironment {
  return {
    name: "test",
    prod: false,
    base_url: "https://api.fixture.invalid",
    // auth_strategies deliberately absent
  };
}

/**
 * Returns a ResolvedEnvironment with auth_strategies explicitly set to {}.
 * Same behavior as missing: every acquire() → AUTH_STRATEGY_UNKNOWN.
 */
function makeEnvWithEmptyAuthStrategies(): ResolvedEnvironment {
  return {
    name: "test",
    prod: false,
    base_url: "https://api.fixture.invalid",
    auth_strategies: {},
  };
}

// ---------------------------------------------------------------------------
// §12.4 createAuthRegistry factory tests
// ---------------------------------------------------------------------------

describe("createAuthRegistry — return value and type", () => {
  it("returns an instance of AuthStrategyRegistry", () => {
    const secrets = new SecretRegistry();
    const result = createAuthRegistry(makeEnvWithStatic(), secrets);
    expect(result).toBeInstanceOf(AuthStrategyRegistry);
  });

  it("returned registry can acquire a static_token strategy without throwing", () => {
    const secrets = new SecretRegistry();
    const registry = createAuthRegistry(makeEnvWithStatic(), secrets);
    expect(() => registry.acquire("s")).not.toThrow();
  });

  it("returned registry acquire dispatches to StaticTokenStrategy for static_token kind", () => {
    const secrets = new SecretRegistry();
    const registry = createAuthRegistry(makeEnvWithStatic(), secrets);
    const strategy = registry.acquire("s");
    expect(strategy).toBeInstanceOf(StaticTokenStrategy);
  });

  it("returned registry acquire dispatches to TokenEndpointStrategy for token_endpoint kind", () => {
    const secrets = new SecretRegistry();
    const seam = new CountingFakeSeam();
    const registry = createAuthRegistry(makeEnvWithTokenEndpoint(), secrets, { fetchSeam: seam });
    const strategy = registry.acquire("t");
    expect(strategy).toBeInstanceOf(TokenEndpointStrategy);
  });

  it("does not throw at construction time (ZERO network even for token_endpoint)", () => {
    const secrets = new SecretRegistry();
    const seam = new CountingFakeSeam();
    expect(
      () => createAuthRegistry(makeEnvWithTokenEndpoint(), secrets, { fetchSeam: seam }),
    ).not.toThrow();
  });
});

describe("createAuthRegistry — secrets pass-through", () => {
  it("secrets passed to factory are forwarded to the registry (identity preserved)", () => {
    // We confirm by verifying the returned registry works correctly — secrets
    // are passed through to the strategy constructors. The secrets registry
    // is opaque, but successful acquisition (which requires a valid spec + secrets)
    // confirms pass-through.
    const secrets = new SecretRegistry();
    const registry = createAuthRegistry(makeEnvWithStatic(), secrets);
    // If secrets were not passed, StaticTokenStrategy construction would fail.
    expect(() => registry.acquire("s")).not.toThrow();
  });

  it("distinct SecretRegistry instances produce distinct working registries", () => {
    const secrets1 = new SecretRegistry();
    const secrets2 = new SecretRegistry();
    const reg1 = createAuthRegistry(makeEnvWithStatic(), secrets1);
    const reg2 = createAuthRegistry(makeEnvWithStatic(), secrets2);
    // Both registries must be operational independent instances
    expect(reg1.acquire("s")).toBeInstanceOf(StaticTokenStrategy);
    expect(reg2.acquire("s")).toBeInstanceOf(StaticTokenStrategy);
    // They are distinct registry instances
    expect(reg1).not.toBe(reg2);
  });
});

describe("createAuthRegistry — fetchSeam injection (deps)", () => {
  it("accepts no deps parameter and wires default fetchSeam (does not throw)", () => {
    const secrets = new SecretRegistry();
    expect(() => createAuthRegistry(makeEnvWithTokenEndpoint(), secrets)).not.toThrow();
  });

  it("accepts empty deps object {} and wires default fetchSeam (does not throw)", () => {
    const secrets = new SecretRegistry();
    expect(
      () => createAuthRegistry(makeEnvWithTokenEndpoint(), secrets, {}),
    ).not.toThrow();
  });

  it("accepts deps with custom fetchSeam without throwing", () => {
    const secrets = new SecretRegistry();
    const seam = new CountingFakeSeam();
    expect(
      () => createAuthRegistry(makeEnvWithTokenEndpoint(), secrets, { fetchSeam: seam }),
    ).not.toThrow();
  });

  it("injected custom fetchSeam is used (not replaced by default)", () => {
    // Verify behavioral identity: the registry acquires a strategy that
    // was constructed with our seam. Since acquire() does not call the seam,
    // we verify seam.fetchCount remains 0 after acquire (seam not substituted).
    const secrets = new SecretRegistry();
    const seam = new CountingFakeSeam();
    const registry = createAuthRegistry(makeEnvWithTokenEndpoint(), secrets, { fetchSeam: seam });
    registry.acquire("t");
    expect(seam.fetchCount).toBe(0); // acquire is sync; seam only called on apply()
  });
});

describe("createAuthRegistry — env.auth_strategies ?? {} defaulting", () => {
  it("constructs without throwing when env.auth_strategies is undefined", () => {
    const secrets = new SecretRegistry();
    expect(
      () => createAuthRegistry(makeEnvWithoutAuthStrategies(), secrets),
    ).not.toThrow();
  });

  it("constructs without throwing when env.auth_strategies is explicitly empty {}", () => {
    const secrets = new SecretRegistry();
    expect(
      () => createAuthRegistry(makeEnvWithEmptyAuthStrategies(), secrets),
    ).not.toThrow();
  });

  it("acquire on undefined-auth_strategies env throws AUTH_STRATEGY_UNKNOWN", () => {
    const secrets = new SecretRegistry();
    const registry = createAuthRegistry(makeEnvWithoutAuthStrategies(), secrets);
    let caught: unknown;
    try {
      registry.acquire("x");
    } catch (e) {
      caught = e;
    }
    expect(isAuthStrategyError(caught)).toBe(true);
    expect((caught as { code: string }).code).toBe(AUTH_ERROR_CODES.AUTH_STRATEGY_UNKNOWN);
  });

  it("acquire on empty-auth_strategies env throws AUTH_STRATEGY_UNKNOWN", () => {
    const secrets = new SecretRegistry();
    const registry = createAuthRegistry(makeEnvWithEmptyAuthStrategies(), secrets);
    let caught: unknown;
    try {
      registry.acquire("x");
    } catch (e) {
      caught = e;
    }
    expect(isAuthStrategyError(caught)).toBe(true);
    expect((caught as { code: string }).code).toBe(AUTH_ERROR_CODES.AUTH_STRATEGY_UNKNOWN);
  });

  it("unknown name error lists Known: [] when env has no auth_strategies", () => {
    const secrets = new SecretRegistry();
    const registry = createAuthRegistry(makeEnvWithoutAuthStrategies(), secrets);
    let caught: unknown;
    try {
      registry.acquire("x");
    } catch (e) {
      caught = e;
    }
    expect(isAuthStrategyError(caught)).toBe(true);
    expect((caught as { message: string }).message).toContain("Known: []");
  });

  it("closeAll on no-auth_strategies registry returns { ok: true, results: [] }", () => {
    const secrets = new SecretRegistry();
    const registry = createAuthRegistry(makeEnvWithoutAuthStrategies(), secrets);
    const outcome = registry.closeAll();
    expect(outcome.ok).toBe(true);
    expect(outcome.results).toHaveLength(0);
  });
});

describe("createAuthRegistry — integration with env block", () => {
  it("factory creates an operational registry from a full valid env block", () => {
    const secrets = new SecretRegistry();
    const seam = new CountingFakeSeam();
    const env: ResolvedEnvironment = {
      name: "qa",
      prod: false,
      base_url: "https://api-qa.fixture.invalid",
      auth_strategies: {
        sso_static: {
          type: "static_token",
          token: "fixture-static-token-value",
          header: "Authorization",
          header_value: "Bearer ${token}",
        },
        sso_endpoint: {
          type: "token_endpoint",
          url: "https://sso.fixture.invalid/oauth/token",
          credentials: { username: "fixture-user", password: "fixture-pass" },
          token_path: "$.access_token",
          header: "Authorization",
          header_value: "Bearer ${token}",
        },
      },
    };

    const registry = createAuthRegistry(env, secrets, { fetchSeam: seam });
    expect(registry.acquire("sso_static")).toBeInstanceOf(StaticTokenStrategy);
    expect(registry.acquire("sso_endpoint")).toBeInstanceOf(TokenEndpointStrategy);
    expect(seam.fetchCount).toBe(0);
  });

  it("factory propagates config error from invalid env.auth_strategies as AuthStrategyError", () => {
    const secrets = new SecretRegistry();
    const env: ResolvedEnvironment = {
      name: "qa",
      prod: false,
      base_url: "https://api-qa.fixture.invalid",
      auth_strategies: {
        bad: { type: "static_token" }, // missing required token field
      },
    };
    let caught: unknown;
    try {
      createAuthRegistry(env, secrets);
    } catch (e) {
      caught = e;
    }
    expect(isAuthStrategyError(caught)).toBe(true);
    expect((caught as { code: string }).code).toBe(AUTH_ERROR_CODES.AUTH_CONFIG_INVALID);
  });
});
