import { describe, it, expect, beforeEach } from "vitest";

import {
  GarbageTokenMangle,
  GARBAGE_TOKEN_VALUE,
} from "../../../../src/auth/markers/garbage-token-mangle.js";
import {
  AUTH_ERROR_CODES,
  AuthStrategyError,
} from "../../../../src/auth/errors.js";
import type {
  AuthStrategy,
  AuthorizedRequest,
  PreparedRequest,
  RunContext,
} from "../../../../src/auth/types.js";
import { SecretRegistry } from "../../../../src/env/secrets.js";

/**
 * Unit tests for GarbageTokenMangle + GARBAGE_TOKEN_VALUE const
 * (src/auth/markers/garbage-token-mangle.ts).
 *
 * GarbageTokenMangle is the §3 negative-auth marker wrapper implementing
 * `garbage_token_returns_401` via Approach C (gate-locked):
 * 1. Calls the wrapped strategy's apply() (triggering any inner side effects).
 * 2. Re-renders the configured header by substituting ${token} with
 *    GARBAGE_TOKEN_VALUE = "garbage_token_value" via attachAuthHeader SSOT.
 * 3. Returns the resulting AuthorizedRequest with ONLY the target header
 *    replaced; all other headers from the inner result pass through unchanged.
 *
 * Approach C implications tested:
 * - inner.applyCount === 1 after one outer apply() (D9 literal "calls wrapped
 *   strategy then replaces").
 * - Inner-attached auth header is REPLACED by the garbage value (not added on
 *   top of it). Case-insensitive collision arm of attachAuthHeader is tested.
 * - Inner throws → wrapper propagates (no catch in wrapper; D9 locked).
 *
 * RED PHASE: src/auth/markers/garbage-token-mangle.ts does not exist yet.
 * This file fails at import time (ERR_MODULE_NOT_FOUND) until the
 * implementation-engineer creates that module. That is the desired outcome.
 */

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * Counts apply() calls. Optionally adds extra headers to the returned
 * AuthorizedRequest to verify pass-through behavior.
 */
class CountingFakeStrategy implements AuthStrategy {
  applyCount = 0;
  readonly #extraHeaders: Record<string, string>;

  constructor(extraHeaders: Record<string, string> = {}) {
    this.#extraHeaders = extraHeaders;
  }

  async apply(
    req: PreparedRequest,
    _ctx: RunContext,
  ): Promise<AuthorizedRequest> {
    this.applyCount++;
    return { ...req, headers: { ...req.headers, ...this.#extraHeaders } };
  }
}

/**
 * Inner strategy that attaches the Authorization header with the given value,
 * simulating what static_token / token_endpoint strategies do.
 */
class AuthAttachingStrategy implements AuthStrategy {
  readonly #headerName: string;
  readonly #headerValue: string;

  constructor(headerName: string, headerValue: string) {
    this.#headerName = headerName;
    this.#headerValue = headerValue;
  }

  async apply(
    req: PreparedRequest,
    _ctx: RunContext,
  ): Promise<AuthorizedRequest> {
    return {
      ...req,
      headers: { ...req.headers, [this.#headerName]: this.#headerValue },
    };
  }
}

/** Base PreparedRequest used in most tests. */
function makeSampleRequest(): PreparedRequest {
  return {
    method: "GET",
    url: "https://api.example.com/resource",
    headers: { "X-Other": "ok" },
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
// GARBAGE_TOKEN_VALUE const
// ---------------------------------------------------------------------------

describe("GARBAGE_TOKEN_VALUE", () => {
  it("equals the literal string 'garbage_token_value'", () => {
    expect(GARBAGE_TOKEN_VALUE).toBe("garbage_token_value");
  });

  it("is a non-empty string (not a real credential)", () => {
    expect(typeof GARBAGE_TOKEN_VALUE).toBe("string");
    expect(GARBAGE_TOKEN_VALUE.length).toBeGreaterThan(0);
  });

  it("does not contain characters that would break header values", () => {
    // HTTP header values must not contain CR or LF
    expect(GARBAGE_TOKEN_VALUE).not.toMatch(/[\r\n]/);
  });
});

// ---------------------------------------------------------------------------
// GarbageTokenMangle — constructor
// ---------------------------------------------------------------------------

describe("GarbageTokenMangle", () => {
  describe("constructor", () => {
    it("constructs without throwing given valid inner, headerName, and template", () => {
      const inner = new CountingFakeStrategy();
      expect(
        () => new GarbageTokenMangle(inner, "Authorization", "Bearer ${token}"),
      ).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // apply() — garbage header attachment
  // -------------------------------------------------------------------------

  describe("apply() — garbage header attachment (Bearer Authorization)", () => {
    let inner: CountingFakeStrategy;
    let mangler: GarbageTokenMangle;
    let request: PreparedRequest;
    let context: RunContext;

    beforeEach(() => {
      inner = new CountingFakeStrategy();
      mangler = new GarbageTokenMangle(
        inner,
        "Authorization",
        "Bearer ${token}",
      );
      request = makeSampleRequest();
      context = makeSampleContext();
    });

    it("attaches 'Bearer garbage_token_value' to Authorization header", async () => {
      const output = await mangler.apply(request, context);
      expect(output.headers["Authorization"]).toBe(
        `Bearer ${GARBAGE_TOKEN_VALUE}`,
      );
    });

    it("output headers contain the Authorization key", async () => {
      const output = await mangler.apply(request, context);
      expect(Object.keys(output.headers)).toContain("Authorization");
    });

    it("calls inner.apply() exactly once per outer apply() call", async () => {
      await mangler.apply(request, context);
      expect(inner.applyCount).toBe(1);
    });

    it("calls inner.apply() exactly twice when outer apply() is called twice", async () => {
      await mangler.apply(request, context);
      await mangler.apply(request, context);
      expect(inner.applyCount).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // apply() — custom header name
  // -------------------------------------------------------------------------

  describe("apply() — custom header name (X-Auth)", () => {
    it("uses the configured header name 'X-Auth' with value '${token}'", async () => {
      const inner = new CountingFakeStrategy();
      const mangler = new GarbageTokenMangle(inner, "X-Auth", "${token}");
      const output = await mangler.apply(makeSampleRequest(), makeSampleContext());
      expect(output.headers["X-Auth"]).toBe(GARBAGE_TOKEN_VALUE);
    });

    it("attaches 'Token garbage_token_value' for template 'Token ${token}'", async () => {
      const inner = new CountingFakeStrategy();
      const mangler = new GarbageTokenMangle(inner, "X-Api-Key", "Token ${token}");
      const output = await mangler.apply(makeSampleRequest(), makeSampleContext());
      expect(output.headers["X-Api-Key"]).toBe(`Token ${GARBAGE_TOKEN_VALUE}`);
    });
  });

  // -------------------------------------------------------------------------
  // apply() — pass-through of inner's other headers
  // -------------------------------------------------------------------------

  describe("apply() — pass-through of inner-attached non-target headers", () => {
    it("preserves X-Inner header added by the inner strategy", async () => {
      const inner = new CountingFakeStrategy({ "X-Inner": "called" });
      const mangler = new GarbageTokenMangle(
        inner,
        "Authorization",
        "Bearer ${token}",
      );
      const output = await mangler.apply(makeSampleRequest(), makeSampleContext());
      expect(output.headers["X-Inner"]).toBe("called");
    });

    it("preserves pre-existing X-Other header from the original request", async () => {
      const inner = new CountingFakeStrategy();
      const mangler = new GarbageTokenMangle(
        inner,
        "Authorization",
        "Bearer ${token}",
      );
      const output = await mangler.apply(makeSampleRequest(), makeSampleContext());
      expect(output.headers["X-Other"]).toBe("ok");
    });

    it("output contains X-Other, X-Inner, AND Authorization with garbage value", async () => {
      const inner = new CountingFakeStrategy({ "X-Inner": "fromInner" });
      const mangler = new GarbageTokenMangle(
        inner,
        "Authorization",
        "Bearer ${token}",
      );
      const output = await mangler.apply(makeSampleRequest(), makeSampleContext());
      expect(output.headers["X-Other"]).toBe("ok");
      expect(output.headers["X-Inner"]).toBe("fromInner");
      expect(output.headers["Authorization"]).toBe(
        `Bearer ${GARBAGE_TOKEN_VALUE}`,
      );
    });
  });

  // -------------------------------------------------------------------------
  // apply() — inner's attached auth header REPLACED, not doubled
  // -------------------------------------------------------------------------

  describe("apply() — inner's real auth header replaced by garbage (not duplicated)", () => {
    it("replaces Authorization: 'realToken' from inner with the garbage value", async () => {
      const inner = new AuthAttachingStrategy("Authorization", "Bearer realToken");
      const mangler = new GarbageTokenMangle(
        inner,
        "Authorization",
        "Bearer ${token}",
      );
      const output = await mangler.apply(makeSampleRequest(), makeSampleContext());
      expect(output.headers["Authorization"]).toBe(
        `Bearer ${GARBAGE_TOKEN_VALUE}`,
      );
      expect(output.headers["Authorization"]).not.toContain("realToken");
    });

    it("output has exactly ONE Authorization header (no duplicate from inner)", async () => {
      const inner = new AuthAttachingStrategy("Authorization", "Bearer realToken");
      const mangler = new GarbageTokenMangle(
        inner,
        "Authorization",
        "Bearer ${token}",
      );
      const output = await mangler.apply(makeSampleRequest(), makeSampleContext());
      const authKeys = Object.keys(output.headers).filter(
        (k) => k.toLowerCase() === "authorization",
      );
      expect(authKeys).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // apply() — case-insensitive collision: lowercase inner header
  // -------------------------------------------------------------------------

  describe("apply() — case-insensitive collision (inner attaches lowercase)", () => {
    it("drops inner's lowercase 'authorization' and re-attaches at configured casing", async () => {
      // Inner attaches lowercase 'authorization', mangler targets 'Authorization'
      const inner = new AuthAttachingStrategy(
        "authorization",
        "Bearer leaked-real-token",
      );
      const mangler = new GarbageTokenMangle(
        inner,
        "Authorization",
        "Bearer ${token}",
      );
      const output = await mangler.apply(makeSampleRequest(), makeSampleContext());
      // lowercase variant must be gone
      expect(output.headers["authorization"]).toBeUndefined();
      // configured-casing variant has garbage value (real token NOT present)
      expect(output.headers["Authorization"]).toBe(
        `Bearer ${GARBAGE_TOKEN_VALUE}`,
      );
      expect(output.headers["Authorization"]).not.toContain("leaked-real-token");
    });

    it("does not leak the real token value through any case variant", async () => {
      const inner = new AuthAttachingStrategy(
        "AUTHORIZATION",
        "Bearer super-secret-real-token",
      );
      const mangler = new GarbageTokenMangle(
        inner,
        "Authorization",
        "Bearer ${token}",
      );
      const output = await mangler.apply(makeSampleRequest(), makeSampleContext());
      const allValues = Object.values(output.headers);
      const leaks = allValues.filter((v) =>
        v.includes("super-secret-real-token"),
      );
      expect(leaks).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // apply() — template with no ${token} placeholder
  // -------------------------------------------------------------------------

  describe("apply() — template with no ${token} placeholder", () => {
    it("attaches the literal template verbatim when template has no ${token}", async () => {
      const inner = new AuthAttachingStrategy(
        "Authorization",
        "Bearer realToken",
      );
      const mangler = new GarbageTokenMangle(
        inner,
        "Authorization",
        "Basic Zm9v",
      );
      const output = await mangler.apply(makeSampleRequest(), makeSampleContext());
      // The literal template is attached; inner's 'Bearer realToken' is replaced
      expect(output.headers["Authorization"]).toBe("Basic Zm9v");
      expect(output.headers["Authorization"]).not.toContain("realToken");
    });
  });

  // -------------------------------------------------------------------------
  // apply() — template with multiple ${token} placeholders
  // -------------------------------------------------------------------------

  describe("apply() — template with multiple ${token} placeholders", () => {
    it("replaces ALL occurrences of ${token} with GARBAGE_TOKEN_VALUE", async () => {
      const inner = new CountingFakeStrategy();
      const mangler = new GarbageTokenMangle(
        inner,
        "Authorization",
        "Bearer ${token}, ID ${token}",
      );
      const output = await mangler.apply(makeSampleRequest(), makeSampleContext());
      const expected = `Bearer ${GARBAGE_TOKEN_VALUE}, ID ${GARBAGE_TOKEN_VALUE}`;
      expect(output.headers["Authorization"]).toBe(expected);
    });
  });

  // -------------------------------------------------------------------------
  // apply() — inner throws → wrapper propagates
  // -------------------------------------------------------------------------

  describe("apply() — inner throws → wrapper propagates unchanged", () => {
    it("rejects with the same AuthStrategyError when inner.apply() rejects with AUTH_TOKEN_FETCH_FAILED", async () => {
      const fetchError = new AuthStrategyError({
        code: AUTH_ERROR_CODES.AUTH_TOKEN_FETCH_FAILED,
        phase: "fetch",
        message: "token endpoint unreachable",
      });
      const rejectingInner: AuthStrategy = {
        async apply(): Promise<AuthorizedRequest> {
          throw fetchError;
        },
      };
      const mangler = new GarbageTokenMangle(
        rejectingInner,
        "Authorization",
        "Bearer ${token}",
      );
      await expect(
        mangler.apply(makeSampleRequest(), makeSampleContext()),
      ).rejects.toThrow(fetchError);
    });

    it("propagates without wrapping or transforming the original error", async () => {
      const originalError = new AuthStrategyError({
        code: AUTH_ERROR_CODES.AUTH_TOKEN_NOT_FOUND,
        phase: "extract",
        message: "token path did not match",
      });
      const rejectingInner: AuthStrategy = {
        async apply(): Promise<AuthorizedRequest> {
          throw originalError;
        },
      };
      const mangler = new GarbageTokenMangle(
        rejectingInner,
        "Authorization",
        "Bearer ${token}",
      );
      let caught: unknown;
      try {
        await mangler.apply(makeSampleRequest(), makeSampleContext());
      } catch (e) {
        caught = e;
      }
      expect(caught).toBe(originalError);
    });
  });

  // -------------------------------------------------------------------------
  // apply() — determinism
  // -------------------------------------------------------------------------

  describe("apply() — determinism", () => {
    it("produces JSON.stringify-identical results for two calls with the same inputs", async () => {
      const inner1 = new CountingFakeStrategy();
      const inner2 = new CountingFakeStrategy();
      const mangler1 = new GarbageTokenMangle(
        inner1,
        "Authorization",
        "Bearer ${token}",
      );
      const mangler2 = new GarbageTokenMangle(
        inner2,
        "Authorization",
        "Bearer ${token}",
      );
      const out1 = await mangler1.apply(makeSampleRequest(), makeSampleContext());
      const out2 = await mangler2.apply(makeSampleRequest(), makeSampleContext());
      expect(JSON.stringify(out1)).toBe(JSON.stringify(out2));
    });
  });

  // -------------------------------------------------------------------------
  // apply() — non-mutation of the original request
  // -------------------------------------------------------------------------

  describe("apply() — non-mutation of original input request", () => {
    it("returns a DIFFERENT object reference than the input request", async () => {
      const inner = new CountingFakeStrategy();
      const mangler = new GarbageTokenMangle(
        inner,
        "Authorization",
        "Bearer ${token}",
      );
      const req = makeSampleRequest();
      const output = await mangler.apply(req, makeSampleContext());
      expect(output).not.toBe(req);
    });

    it("output.headers is a DIFFERENT reference than input.headers", async () => {
      const inner = new CountingFakeStrategy();
      const mangler = new GarbageTokenMangle(
        inner,
        "Authorization",
        "Bearer ${token}",
      );
      const req = makeSampleRequest();
      const output = await mangler.apply(req, makeSampleContext());
      expect(output.headers).not.toBe(req.headers);
    });

    it("does not modify the original request's headers after apply()", async () => {
      const inner = new CountingFakeStrategy();
      const mangler = new GarbageTokenMangle(
        inner,
        "Authorization",
        "Bearer ${token}",
      );
      const req = makeSampleRequest();
      const headersBefore = { ...req.headers };
      await mangler.apply(req, makeSampleContext());
      expect(req.headers).toEqual(headersBefore);
    });

    it("does not modify the original request's method or url after apply()", async () => {
      const inner = new CountingFakeStrategy();
      const mangler = new GarbageTokenMangle(
        inner,
        "Authorization",
        "Bearer ${token}",
      );
      const req = makeSampleRequest();
      const methodBefore = req.method;
      const urlBefore = req.url;
      await mangler.apply(req, makeSampleContext());
      expect(req.method).toBe(methodBefore);
      expect(req.url).toBe(urlBefore);
    });
  });

  // -------------------------------------------------------------------------
  // AuthStrategy conformance
  // -------------------------------------------------------------------------

  describe("AuthStrategy conformance", () => {
    it("is assignable to AuthStrategy (interface conformance verified at runtime)", () => {
      const inner = new CountingFakeStrategy();
      const strategy: AuthStrategy = new GarbageTokenMangle(
        inner,
        "Authorization",
        "Bearer ${token}",
      );
      expect(strategy).toBeDefined();
      expect(typeof strategy.apply).toBe("function");
    });

    it("does not implement close() (stateless decorator)", () => {
      const inner = new CountingFakeStrategy();
      const mangler = new GarbageTokenMangle(
        inner,
        "Authorization",
        "Bearer ${token}",
      );
      expect((mangler as AuthStrategy).close).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // apply() — adversarial inputs (no extra throws from the wrapper itself)
  // -------------------------------------------------------------------------

  describe("apply() — adversarial templates do not introduce new throws", () => {
    const adversarialTemplates = [
      "",
      "${token}",
      "no-placeholder-at-all",
      "${token}${token}${token}",
      "prefix-${token}-middle-${token}-suffix",
      "Bearer $$-escaped",
      "Bearer $&-ref",
    ];

    for (const template of adversarialTemplates) {
      it(`resolves without throwing for template '${template}'`, async () => {
        const inner = new CountingFakeStrategy();
        const mangler = new GarbageTokenMangle(inner, "Authorization", template);
        await expect(
          mangler.apply(makeSampleRequest(), makeSampleContext()),
        ).resolves.toBeDefined();
      });
    }
  });
});
