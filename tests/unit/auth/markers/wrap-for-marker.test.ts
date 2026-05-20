import { describe, it, expect } from "vitest";

import {
  wrapForMarker,
  NEGATIVE_AUTH_MARKERS,
} from "../../../../src/auth/markers/wrap-for-marker.js";
import { NoAuthBypass } from "../../../../src/auth/markers/no-auth-bypass.js";
import { GarbageTokenMangle, GARBAGE_TOKEN_VALUE } from "../../../../src/auth/markers/garbage-token-mangle.js";
import type { NegativeAuthMarker } from "../../../../src/auth/markers/wrap-for-marker.js";
import type {
  AuthStrategy,
  AuthorizedRequest,
  PreparedRequest,
  RunContext,
} from "../../../../src/auth/types.js";
import type {
  ValidatedStaticTokenSpec,
  ValidatedTokenEndpointSpec,
  ValidatedStrategySpec,
} from "../../../../src/auth/config-parser.js";
import { SecretRegistry } from "../../../../src/env/secrets.js";

/**
 * Unit tests for wrapForMarker + NEGATIVE_AUTH_MARKERS + NegativeAuthMarker
 * (src/auth/markers/wrap-for-marker.ts).
 *
 * wrapForMarker dispatches a §3 negative-auth marker name to its wrapper:
 * - "no_auth_returns_401"     → new NoAuthBypass(strategy)
 * - "garbage_token_returns_401" → new GarbageTokenMangle(strategy, spec.header, spec.headerValue)
 * - any other string         → strategy unchanged (identity branch, D9)
 *
 * NEGATIVE_AUTH_MARKERS is the closed set ["no_auth_returns_401",
 * "garbage_token_returns_401"] as const. NegativeAuthMarker is its indexed-
 * access type union.
 *
 * Key non-obvious design choices under test:
 * - wrapForMarker does NOT call strategy.apply() at dispatch time (only the
 *   returned wrapper calls apply() when invoked by the runner).
 * - Identity branch (unknown / empty marker) preserves object identity.
 * - GarbageTokenMangle constructor is seeded with spec.header + spec.headerValue
 *   (not some runtime-derived value) — confirmed by calling apply() on the
 *   returned wrapper and checking the header name and garbage value.
 *
 * RED PHASE: src/auth/markers/ modules do not exist yet. This file fails at
 * import time (ERR_MODULE_NOT_FOUND). That is the desired red-phase outcome.
 */

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * Counts every call to apply() so tests can assert dispatch-time non-invocation.
 */
class CountingFakeStrategy implements AuthStrategy {
  applyCount = 0;

  async apply(
    req: PreparedRequest,
    _ctx: RunContext,
  ): Promise<AuthorizedRequest> {
    this.applyCount++;
    return { ...req, headers: { ...req.headers, "X-Inner": "called" } };
  }
}

/** static_token spec with Authorization / Bearer template. */
const STATIC_SPEC: ValidatedStaticTokenSpec = {
  kind: "static_token",
  name: "my_static",
  token: "real-static-token",
  header: "Authorization",
  headerValue: "Bearer ${token}",
};

/** token_endpoint spec with X-Auth / Token template. */
const TOKEN_ENDPOINT_SPEC: ValidatedTokenEndpointSpec = {
  kind: "token_endpoint",
  name: "my_endpoint",
  url: "https://auth.example.com/token",
  username: "user",
  password: "pass",
  tokenPath: [{ kind: "key", key: "access_token" }],
  header: "X-Auth",
  headerValue: "Token ${token}",
  refreshBufferSeconds: 30,
};

/** Minimal PreparedRequest for apply() smoke-tests. */
function makeSampleRequest(): PreparedRequest {
  return {
    method: "GET",
    url: "https://api.example.com/resource",
    headers: {},
  };
}

/** Minimal RunContext. */
function makeSampleContext(): RunContext {
  return {
    env: {
      name: "test",
      prod: false,
      base_url: "https://api.example.com",
      default_sla_ms: 1000,
    },
    secrets: new SecretRegistry(),
  };
}

// ---------------------------------------------------------------------------
// NEGATIVE_AUTH_MARKERS const
// ---------------------------------------------------------------------------

describe("NEGATIVE_AUTH_MARKERS", () => {
  it("has exactly 2 entries", () => {
    expect(NEGATIVE_AUTH_MARKERS).toHaveLength(2);
  });

  it("first entry is 'no_auth_returns_401'", () => {
    expect(NEGATIVE_AUTH_MARKERS[0]).toBe("no_auth_returns_401");
  });

  it("second entry is 'garbage_token_returns_401'", () => {
    expect(NEGATIVE_AUTH_MARKERS[1]).toBe("garbage_token_returns_401");
  });

  it("contains both expected marker strings in order", () => {
    expect([...NEGATIVE_AUTH_MARKERS]).toEqual([
      "no_auth_returns_401",
      "garbage_token_returns_401",
    ]);
  });

  it("every entry dispatches to a WRAPPER (not the identity strategy)", () => {
    const strategy = new CountingFakeStrategy();
    for (const marker of NEGATIVE_AUTH_MARKERS) {
      const result = wrapForMarker(strategy, marker, STATIC_SPEC);
      expect(result).not.toBe(strategy);
    }
  });

  it("is an array (readonly tuple at runtime)", () => {
    expect(Array.isArray(NEGATIVE_AUTH_MARKERS)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// NegativeAuthMarker type — compile-time narrowness
// ---------------------------------------------------------------------------

describe("NegativeAuthMarker type", () => {
  it("allows assignment of 'no_auth_returns_401' to NegativeAuthMarker", () => {
    // If this compiles, the type union includes 'no_auth_returns_401'.
    const m: NegativeAuthMarker = "no_auth_returns_401";
    expect(m).toBe("no_auth_returns_401");
  });

  it("allows assignment of 'garbage_token_returns_401' to NegativeAuthMarker", () => {
    const m: NegativeAuthMarker = "garbage_token_returns_401";
    expect(m).toBe("garbage_token_returns_401");
  });

  it("rejects 'bogus' assignment at the type level", () => {
    // @ts-expect-error - 'bogus' is not assignable to NegativeAuthMarker
    const bad: NegativeAuthMarker = "bogus";
    // The @ts-expect-error above is the assertion; this line is never reached
    // in a correctly typed codebase, but we consume `bad` to avoid unused-var.
    expect(typeof bad).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// wrapForMarker — dispatch to NoAuthBypass
// ---------------------------------------------------------------------------

describe("wrapForMarker", () => {
  describe("dispatch: 'no_auth_returns_401' → NoAuthBypass", () => {
    it("returns an instance of NoAuthBypass", () => {
      const strategy = new CountingFakeStrategy();
      const result = wrapForMarker(strategy, "no_auth_returns_401", STATIC_SPEC);
      expect(result).toBeInstanceOf(NoAuthBypass);
    });

    it("returned NoAuthBypass.apply() does NOT call the original strategy.apply()", async () => {
      const strategy = new CountingFakeStrategy();
      const wrapper = wrapForMarker(strategy, "no_auth_returns_401", STATIC_SPEC);
      await wrapper.apply(makeSampleRequest(), makeSampleContext());
      expect(strategy.applyCount).toBe(0);
    });

    it("returned NoAuthBypass.apply() returns the input request unchanged", async () => {
      const strategy = new CountingFakeStrategy();
      const wrapper = wrapForMarker(strategy, "no_auth_returns_401", STATIC_SPEC);
      const req = makeSampleRequest();
      const output = await wrapper.apply(req, makeSampleContext());
      expect(output).toBe(req);
    });

    it("does NOT call strategy.apply() at dispatch time (only when wrapper.apply() is invoked)", () => {
      const strategy = new CountingFakeStrategy();
      wrapForMarker(strategy, "no_auth_returns_401", STATIC_SPEC);
      expect(strategy.applyCount).toBe(0);
    });

    it("works identically for static_token spec and token_endpoint spec", () => {
      const strategy = new CountingFakeStrategy();
      const r1 = wrapForMarker(strategy, "no_auth_returns_401", STATIC_SPEC);
      const r2 = wrapForMarker(strategy, "no_auth_returns_401", TOKEN_ENDPOINT_SPEC);
      expect(r1).toBeInstanceOf(NoAuthBypass);
      expect(r2).toBeInstanceOf(NoAuthBypass);
    });
  });

  // -------------------------------------------------------------------------
  // wrapForMarker — dispatch to GarbageTokenMangle
  // -------------------------------------------------------------------------

  describe("dispatch: 'garbage_token_returns_401' → GarbageTokenMangle", () => {
    it("returns an instance of GarbageTokenMangle", () => {
      const strategy = new CountingFakeStrategy();
      const result = wrapForMarker(
        strategy,
        "garbage_token_returns_401",
        STATIC_SPEC,
      );
      expect(result).toBeInstanceOf(GarbageTokenMangle);
    });

    it("does NOT call strategy.apply() at dispatch time", () => {
      const strategy = new CountingFakeStrategy();
      wrapForMarker(strategy, "garbage_token_returns_401", STATIC_SPEC);
      expect(strategy.applyCount).toBe(0);
    });

    it("calls inner strategy.apply() exactly once when wrapper.apply() is called", async () => {
      const strategy = new CountingFakeStrategy();
      const wrapper = wrapForMarker(
        strategy,
        "garbage_token_returns_401",
        STATIC_SPEC,
      );
      await wrapper.apply(makeSampleRequest(), makeSampleContext());
      expect(strategy.applyCount).toBe(1);
    });

    it("uses STATIC spec's header 'Authorization' — output has Authorization: Bearer garbage_token_value", async () => {
      const strategy = new CountingFakeStrategy();
      const wrapper = wrapForMarker(
        strategy,
        "garbage_token_returns_401",
        STATIC_SPEC,
      );
      const output = await wrapper.apply(makeSampleRequest(), makeSampleContext());
      expect(output.headers["Authorization"]).toBe(
        `Bearer ${GARBAGE_TOKEN_VALUE}`,
      );
    });

    it("uses TOKEN_ENDPOINT spec's header 'X-Auth' — output has X-Auth: Token garbage_token_value", async () => {
      const strategy = new CountingFakeStrategy();
      const wrapper = wrapForMarker(
        strategy,
        "garbage_token_returns_401",
        TOKEN_ENDPOINT_SPEC,
      );
      const output = await wrapper.apply(makeSampleRequest(), makeSampleContext());
      expect(output.headers["X-Auth"]).toBe(`Token ${GARBAGE_TOKEN_VALUE}`);
    });

    it("pulls header config from spec (static arm) — not hardcoded to 'Authorization'", async () => {
      const customSpec: ValidatedStaticTokenSpec = {
        ...STATIC_SPEC,
        header: "X-Custom-Auth",
        headerValue: "Custom ${token}",
      };
      const strategy = new CountingFakeStrategy();
      const wrapper = wrapForMarker(
        strategy,
        "garbage_token_returns_401",
        customSpec,
      );
      const output = await wrapper.apply(makeSampleRequest(), makeSampleContext());
      expect(output.headers["X-Custom-Auth"]).toBe(
        `Custom ${GARBAGE_TOKEN_VALUE}`,
      );
    });

    it("works for both ValidatedStaticTokenSpec and ValidatedTokenEndpointSpec arms", () => {
      const strategy = new CountingFakeStrategy();
      const r1 = wrapForMarker(
        strategy,
        "garbage_token_returns_401",
        STATIC_SPEC,
      );
      const r2 = wrapForMarker(
        strategy,
        "garbage_token_returns_401",
        TOKEN_ENDPOINT_SPEC,
      );
      expect(r1).toBeInstanceOf(GarbageTokenMangle);
      expect(r2).toBeInstanceOf(GarbageTokenMangle);
    });
  });

  // -------------------------------------------------------------------------
  // wrapForMarker — identity branch
  // -------------------------------------------------------------------------

  describe("dispatch: unknown / empty marker name → identity (D9)", () => {
    it("returns the SAME strategy object for an unknown marker string", () => {
      const strategy = new CountingFakeStrategy();
      const result = wrapForMarker(strategy, "some_other_marker", STATIC_SPEC);
      expect(result).toBe(strategy);
    });

    it("returns the SAME strategy object for an empty-string marker", () => {
      const strategy = new CountingFakeStrategy();
      const result = wrapForMarker(strategy, "", STATIC_SPEC);
      expect(result).toBe(strategy);
    });

    it("returns the SAME strategy object for a marker that is close but not exact", () => {
      const strategy = new CountingFakeStrategy();
      // Prefixed variant — must NOT match
      const result = wrapForMarker(strategy, "no_auth_returns_401_extra", STATIC_SPEC);
      expect(result).toBe(strategy);
    });

    it("returns the SAME strategy object for 'garbage_token_returns_400' (wrong status code suffix)", () => {
      const strategy = new CountingFakeStrategy();
      const result = wrapForMarker(strategy, "garbage_token_returns_400", STATIC_SPEC);
      expect(result).toBe(strategy);
    });

    it("does NOT call strategy.apply() at dispatch time for identity branch", () => {
      const strategy = new CountingFakeStrategy();
      wrapForMarker(strategy, "totally_unknown", STATIC_SPEC);
      expect(strategy.applyCount).toBe(0);
    });

    it("fuzz: 200 random-looking marker names all return identity", () => {
      const strategy = new CountingFakeStrategy();
      const fuzzMarkers: readonly string[] = [
        ...Array.from({ length: 200 }, (_, i) => `fuzz_marker_${i}`),
      ];
      for (const marker of fuzzMarkers) {
        const result = wrapForMarker(strategy, marker, STATIC_SPEC);
        expect(result).toBe(strategy);
      }
    });
  });

  // -------------------------------------------------------------------------
  // wrapForMarker — dispatch is pure (never calls strategy.apply at dispatch)
  // -------------------------------------------------------------------------

  describe("dispatch is pure — strategy.apply() is never called at dispatch time", () => {
    it("does not call strategy.apply() when dispatching 'no_auth_returns_401'", () => {
      const strategy = new CountingFakeStrategy();
      wrapForMarker(strategy, "no_auth_returns_401", STATIC_SPEC);
      expect(strategy.applyCount).toBe(0);
    });

    it("does not call strategy.apply() when dispatching 'garbage_token_returns_401'", () => {
      const strategy = new CountingFakeStrategy();
      wrapForMarker(strategy, "garbage_token_returns_401", STATIC_SPEC);
      expect(strategy.applyCount).toBe(0);
    });

    it("does not call strategy.apply() when dispatching an unknown marker (identity)", () => {
      const strategy = new CountingFakeStrategy();
      wrapForMarker(strategy, "never_heard_of_it", STATIC_SPEC);
      expect(strategy.applyCount).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // wrapForMarker — determinism
  // -------------------------------------------------------------------------

  describe("dispatch — determinism", () => {
    it("returns the same class type for 'no_auth_returns_401' across two calls", () => {
      const s1 = new CountingFakeStrategy();
      const s2 = new CountingFakeStrategy();
      const r1 = wrapForMarker(s1, "no_auth_returns_401", STATIC_SPEC);
      const r2 = wrapForMarker(s2, "no_auth_returns_401", STATIC_SPEC);
      expect(r1.constructor).toBe(r2.constructor);
    });

    it("returns the same class type for 'garbage_token_returns_401' across two calls", () => {
      const s1 = new CountingFakeStrategy();
      const s2 = new CountingFakeStrategy();
      const r1 = wrapForMarker(s1, "garbage_token_returns_401", STATIC_SPEC);
      const r2 = wrapForMarker(s2, "garbage_token_returns_401", STATIC_SPEC);
      expect(r1.constructor).toBe(r2.constructor);
    });

    it("produces identical apply() output for same marker + same request across two instantiations", async () => {
      const s1 = new CountingFakeStrategy();
      const s2 = new CountingFakeStrategy();
      const w1 = wrapForMarker(s1, "garbage_token_returns_401", STATIC_SPEC);
      const w2 = wrapForMarker(s2, "garbage_token_returns_401", STATIC_SPEC);
      const req = makeSampleRequest();
      const ctx = makeSampleContext();
      const out1 = await w1.apply(req, ctx);
      const out2 = await w2.apply(makeSampleRequest(), makeSampleContext());
      expect(JSON.stringify(out1)).toBe(JSON.stringify(out2));
    });
  });

  // -------------------------------------------------------------------------
  // wrapForMarker — does not throw for any marker name
  // -------------------------------------------------------------------------

  describe("dispatch — does not throw for any marker name", () => {
    it("does not throw for 'no_auth_returns_401'", () => {
      const strategy = new CountingFakeStrategy();
      expect(() =>
        wrapForMarker(strategy, "no_auth_returns_401", STATIC_SPEC),
      ).not.toThrow();
    });

    it("does not throw for 'garbage_token_returns_401'", () => {
      const strategy = new CountingFakeStrategy();
      expect(() =>
        wrapForMarker(strategy, "garbage_token_returns_401", STATIC_SPEC),
      ).not.toThrow();
    });

    it("does not throw for an unknown marker name", () => {
      const strategy = new CountingFakeStrategy();
      expect(() =>
        wrapForMarker(strategy, "totally_unknown_marker", STATIC_SPEC),
      ).not.toThrow();
    });

    it("does not throw for an empty marker name", () => {
      const strategy = new CountingFakeStrategy();
      expect(() => wrapForMarker(strategy, "", STATIC_SPEC)).not.toThrow();
    });
  });
});
