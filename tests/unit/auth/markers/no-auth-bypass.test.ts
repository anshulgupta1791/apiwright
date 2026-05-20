import { describe, it, expect, beforeEach } from "vitest";

import { NoAuthBypass } from "../../../../src/auth/markers/no-auth-bypass.js";
import type {
  AuthStrategy,
  AuthorizedRequest,
  PreparedRequest,
  RunContext,
} from "../../../../src/auth/types.js";
import { SecretRegistry } from "../../../../src/env/secrets.js";

/**
 * Unit tests for NoAuthBypass (src/auth/markers/no-auth-bypass.ts).
 *
 * NoAuthBypass is a §3 negative-auth marker wrapper implementing the
 * `no_auth_returns_401` attack vector: it returns the input PreparedRequest
 * UNCHANGED, never calling the wrapped strategy's apply() (D9).
 *
 * Design decisions under test:
 * - Reference equality: output === input (intentional, D11-lawful alias).
 * - Inner strategy apply() is NEVER invoked (D9 locked).
 * - Determinism: identical inputs produce JSON.stringify-identical outputs.
 * - AuthStrategy conformance: compiles as an `AuthStrategy` assignment.
 *
 * RED PHASE: src/auth/markers/no-auth-bypass.ts does not exist yet. This
 * file fails at import time (ERR_MODULE_NOT_FOUND) until the implementation-
 * engineer creates that module. The import failure is the desired outcome.
 */

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * Counts every call to apply() so tests can assert it was never invoked.
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

/** Minimal PreparedRequest with a known extra header for mutation checks. */
function makeSampleRequest(): PreparedRequest {
  return {
    method: "GET",
    url: "https://api.example.com/resource",
    headers: { "X-Other": "ok" },
  };
}

/** Minimal RunContext (NoAuthBypass never reads it). */
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
// NoAuthBypass — constructor
// ---------------------------------------------------------------------------

describe("NoAuthBypass", () => {
  describe("constructor", () => {
    it("constructs without throwing given a valid inner strategy", () => {
      const inner = new CountingFakeStrategy();
      expect(() => new NoAuthBypass(inner)).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // apply() — return value
  // -------------------------------------------------------------------------

  describe("apply()", () => {
    let inner: CountingFakeStrategy;
    let bypass: NoAuthBypass;
    let request: PreparedRequest;
    let context: RunContext;

    beforeEach(() => {
      inner = new CountingFakeStrategy();
      bypass = new NoAuthBypass(inner);
      request = makeSampleRequest();
      context = makeSampleContext();
    });

    it("returns the SAME object reference as the input request (no clone)", async () => {
      const output = await bypass.apply(request, context);
      expect(output).toBe(request);
    });

    it("returns an object that satisfies the AuthorizedRequest shape", async () => {
      const output = await bypass.apply(request, context);
      expect(output).toHaveProperty("method");
      expect(output).toHaveProperty("url");
      expect(output).toHaveProperty("headers");
    });

    it("output.headers is the SAME reference as input.headers (no clone)", async () => {
      const output = await bypass.apply(request, context);
      expect(output.headers).toBe(request.headers);
    });

    it("preserves all pre-existing headers without modification", async () => {
      const output = await bypass.apply(request, context);
      expect(output.headers).toEqual({ "X-Other": "ok" });
    });

    it("does NOT attach any auth header", async () => {
      const output = await bypass.apply(request, context);
      const keys = Object.keys(output.headers ?? {});
      const hasAuthVariant = keys.some(
        (k) =>
          k.toLowerCase() === "authorization" ||
          k.toLowerCase() === "x-api-key" ||
          k.toLowerCase() === "x-auth",
      );
      expect(hasAuthVariant).toBe(false);
    });

    it("preserves method and url without modification", async () => {
      const output = await bypass.apply(request, context);
      expect(output.method).toBe("GET");
      expect(output.url).toBe("https://api.example.com/resource");
    });

    it("preserves optional body when present", async () => {
      const reqWithBody: PreparedRequest = {
        ...request,
        body: { name: "alice" },
      };
      const wrappedBypass = new NoAuthBypass(inner);
      const output = await wrappedBypass.apply(reqWithBody, context);
      expect(output.body).toStrictEqual({ name: "alice" });
    });

    it("resolves (does not reject) when the inner strategy would have rejected", async () => {
      const rejectingInner: AuthStrategy = {
        async apply(): Promise<AuthorizedRequest> {
          throw new Error("inner strategy failure");
        },
      };
      const bypassWithRejectingInner = new NoAuthBypass(rejectingInner);
      // NoAuthBypass never calls inner, so no rejection propagates
      await expect(
        bypassWithRejectingInner.apply(request, context),
      ).resolves.toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // apply() — inner.apply() is NEVER called
  // -------------------------------------------------------------------------

  describe("apply() — inner strategy invocation", () => {
    it("never calls inner.apply() — applyCount stays zero after one call", async () => {
      const inner = new CountingFakeStrategy();
      const bypass = new NoAuthBypass(inner);
      await bypass.apply(makeSampleRequest(), makeSampleContext());
      expect(inner.applyCount).toBe(0);
    });

    it("never calls inner.apply() — applyCount stays zero after multiple calls", async () => {
      const inner = new CountingFakeStrategy();
      const bypass = new NoAuthBypass(inner);
      const req = makeSampleRequest();
      const ctx = makeSampleContext();
      await bypass.apply(req, ctx);
      await bypass.apply(req, ctx);
      await bypass.apply(req, ctx);
      expect(inner.applyCount).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // apply() — determinism
  // -------------------------------------------------------------------------

  describe("apply() — determinism", () => {
    it("produces JSON.stringify-identical results for two calls with the same request", async () => {
      const inner = new CountingFakeStrategy();
      const bypass = new NoAuthBypass(inner);
      const req = makeSampleRequest();
      const ctx = makeSampleContext();
      const out1 = await bypass.apply(req, ctx);
      const out2 = await bypass.apply(req, ctx);
      expect(JSON.stringify(out1)).toBe(JSON.stringify(out2));
    });
  });

  // -------------------------------------------------------------------------
  // apply() — non-mutation of input
  // -------------------------------------------------------------------------

  describe("apply() — non-mutation of input request", () => {
    it("does not mutate input.headers after apply()", async () => {
      const inner = new CountingFakeStrategy();
      const bypass = new NoAuthBypass(inner);
      const req: PreparedRequest = {
        method: "POST",
        url: "https://api.example.com/x",
        headers: { "X-Original": "value" },
      };
      const headersBefore = { ...req.headers };
      await bypass.apply(req, makeSampleContext());
      expect(req.headers).toEqual(headersBefore);
    });

    it("does not mutate input.method or input.url after apply()", async () => {
      const inner = new CountingFakeStrategy();
      const bypass = new NoAuthBypass(inner);
      const req = makeSampleRequest();
      const methodBefore = req.method;
      const urlBefore = req.url;
      await bypass.apply(req, makeSampleContext());
      expect(req.method).toBe(methodBefore);
      expect(req.url).toBe(urlBefore);
    });
  });

  // -------------------------------------------------------------------------
  // AuthStrategy conformance
  // -------------------------------------------------------------------------

  describe("AuthStrategy conformance", () => {
    it("is assignable to AuthStrategy (type-level conformance verified at runtime)", () => {
      const inner = new CountingFakeStrategy();
      // If this assignment compiles and the instance satisfies the interface,
      // the class correctly implements AuthStrategy.
      const strategy: AuthStrategy = new NoAuthBypass(inner);
      expect(strategy).toBeDefined();
      expect(typeof strategy.apply).toBe("function");
    });

    it("does not implement close() (stateless decorator — no cleanup needed)", () => {
      const inner = new CountingFakeStrategy();
      const bypass = new NoAuthBypass(inner);
      // close() is optional on AuthStrategy; NoAuthBypass is stateless
      expect((bypass as AuthStrategy).close).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Adversarial inputs — never throws
  // -------------------------------------------------------------------------

  describe("apply() — adversarial inputs (never rejects)", () => {
    it("does not reject given a request with no headers property keys", async () => {
      const inner = new CountingFakeStrategy();
      const bypass = new NoAuthBypass(inner);
      const emptyHeadersReq: PreparedRequest = {
        method: "GET",
        url: "https://api.example.com",
        headers: {},
      };
      await expect(
        bypass.apply(emptyHeadersReq, makeSampleContext()),
      ).resolves.toBeDefined();
    });

    it("does not reject given a request with many headers", async () => {
      const inner = new CountingFakeStrategy();
      const bypass = new NoAuthBypass(inner);
      const manyHeaders: Record<string, string> = {};
      for (let i = 0; i < 50; i++) {
        manyHeaders[`X-Header-${i}`] = `value-${i}`;
      }
      const req: PreparedRequest = {
        method: "DELETE",
        url: "https://api.example.com/bulk",
        headers: manyHeaders,
      };
      await expect(bypass.apply(req, makeSampleContext())).resolves.toBeDefined();
    });

    it("does not reject given a request with a null-ish body", async () => {
      const inner = new CountingFakeStrategy();
      const bypass = new NoAuthBypass(inner);
      const req: PreparedRequest = {
        method: "PUT",
        url: "https://api.example.com/nullbody",
        headers: {},
        body: null,
      };
      await expect(bypass.apply(req, makeSampleContext())).resolves.toBeDefined();
    });
  });
});
