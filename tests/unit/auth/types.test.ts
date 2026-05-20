import { describe, it, expect } from "vitest";

// Side-effect import forces module resolution of src/auth/types.js at runtime.
// When src/auth/types.ts does not exist this import throws ERR_MODULE_NOT_FOUND,
// which is the intended red-phase outcome. type-only imports are erased by
// verbatimModuleSyntax and would silently pass without this line.
import "../../../src/auth/types.js";
import type {
  AuthStrategy,
  PreparedRequest,
  AuthorizedRequest,
  RunContext,
} from "../../../src/auth/types.js";
import { SecretRegistry } from "../../../src/env/secrets.js";

/**
 * Unit tests for the section-6 Auth Strategy Layer type foundation (src/auth/types.ts).
 *
 * src/auth/types.ts is declaration-only and falls under the "src/types.ts" glob
 * coverage exclusion in configs/vitest.config.ts:34, matching the Task #8
 * db-connector-interface-and-types precedent exactly.
 *
 * RED PHASE: src/auth/types.ts does not exist yet. Module resolution fails at
 * the import of ../../../src/auth/types.js until the implementation-engineer
 * creates that file. The import failure is the intentional red-phase outcome.
 *
 * Test categories:
 * 1. PreparedRequest — all fields, optional body, readonly enforcement (AC#2, AC#5).
 * 2. AuthorizedRequest — bidirectional alias identity with PreparedRequest (D12, AC#2).
 * 3. RunContext — env + secrets fields, readonly enforcement, placeholder shape (AC#3, AC#5).
 * 4. AuthStrategy — apply() signature, optional close(), object-literal and class paths (AC#1).
 * 5. D11 non-mutation runtime smoke tests — apply() returns a new object, not the input (AC#5).
 */

// ---------------------------------------------------------------------------
// Shared inline helpers
// ---------------------------------------------------------------------------

/** Returns a minimal valid PreparedRequest fixture. */
function makeReq(overrides?: Partial<PreparedRequest>): PreparedRequest {
  return {
    method: "GET",
    url: "https://api.example.com/health",
    headers: {},
    ...overrides,
  };
}

/** Returns a minimal valid RunContext fixture. */
function makeCtx(envOverrides?: Partial<RunContext["env"]>): RunContext {
  return {
    env: {
      name: "qa",
      prod: false,
      base_url: "https://qa.example.com",
      ...envOverrides,
    },
    secrets: new SecretRegistry(),
  };
}

// ---------------------------------------------------------------------------
// PreparedRequest structural contract (AC#2)
// ---------------------------------------------------------------------------

/**
 * Tests for PreparedRequest: field presence, readonly enforcement, and the
 * body-agnostic unknown type (AC#2).
 */
describe("PreparedRequest - structural interface contract", () => {
  it("accepts a minimal literal with method, url, and headers only (body absent)", () => {
    const req = makeReq();
    expect(req.method).toBe("GET");
    expect(req.url).toBe("https://api.example.com/health");
    expect(req.headers).toEqual({});
    expect(req.body).toBeUndefined();
  });

  it("accepts a literal with all four fields including body as an object", () => {
    const req = makeReq({ method: "POST", headers: { "Content-Type": "application/json" },
      body: { name: "alice" } });
    expect(req.method).toBe("POST");
    expect(req.headers["Content-Type"]).toBe("application/json");
    expect(req.body).toEqual({ name: "alice" });
  });

  it("accepts body typed as a string (body is unknown — body-agnostic contract)", () => {
    const req = makeReq({ method: "PUT", body: "raw-string-body" });
    expect(req.body).toBe("raw-string-body");
  });

  it("accepts body typed as null (null is a valid unknown value)", () => {
    const req = makeReq({ body: null });
    expect(req.body).toBeNull();
  });

  it("accepts headers with multiple entries", () => {
    const req = makeReq({
      headers: { Authorization: "Bearer tok", "X-Request-ID": "abc", Accept: "application/json" },
    });
    expect(Object.keys(req.headers)).toHaveLength(3);
    expect(req.headers["Authorization"]).toBe("Bearer tok");
  });

  it("reads every field without error (readonly fields are always readable)", () => {
    const req: PreparedRequest = {
      method: "DELETE", url: "https://api.example.com/1", headers: { X: "y" }, body: 42,
    };
    const _m: string = req.method;
    const _u: string = req.url;
    const _h: Readonly<Record<string, string>> = req.headers;
    const _b: unknown = req.body;
    expect(_m).toBe("DELETE");
    expect(_u).toContain("api.example.com");
    expect(_h["X"]).toBe("y");
    expect(_b).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// PreparedRequest readonly enforcement — @ts-expect-error negative assertions
// Must be at module scope so TypeScript's excess-property / readonly checks fire.
// ---------------------------------------------------------------------------

// @ts-expect-error — method is readonly; reassignment is a TypeScript error (AC#5).
makeReq().method = "POST";

// @ts-expect-error — url is readonly; reassignment is a TypeScript error (AC#5).
makeReq().url = "https://evil.example.com/";

// @ts-expect-error — headers is readonly; reassigning the entire field is an error (AC#5).
makeReq().headers = { Authorization: "Bearer x" };

// @ts-expect-error — headers values are Readonly<Record<string,string>>; element write is error (AC#5).
makeReq().headers["Authorization"] = "Bearer x";

// ---------------------------------------------------------------------------
// AuthorizedRequest — type alias identity with PreparedRequest (D12, AC#2)
// ---------------------------------------------------------------------------

/**
 * Tests for AuthorizedRequest: bidirectional assignability confirms the alias
 * (not a separate interface) discipline locked by D12 (AC#2).
 */
describe("AuthorizedRequest - type alias of PreparedRequest (D12)", () => {
  it("accepts a PreparedRequest value (alias direction: PreparedRequest → AuthorizedRequest)", () => {
    const req = makeReq({ headers: { Authorization: "Bearer tok" } });
    const authed: AuthorizedRequest = req;
    expect(authed.method).toBe("GET");
    expect(authed.headers["Authorization"]).toBe("Bearer tok");
  });

  it("accepts an AuthorizedRequest back as a PreparedRequest (reverse alias direction)", () => {
    const authed: AuthorizedRequest = {
      method: "POST", url: "https://api.example.com/users",
      headers: { Authorization: "Bearer tok" }, body: { name: "bob" },
    };
    const back: PreparedRequest = authed;
    expect(back.url).toBe("https://api.example.com/users");
    expect(back.body).toEqual({ name: "bob" });
  });

  it("a spread+headers-add pattern produces an AuthorizedRequest assignable to PreparedRequest", () => {
    const input = makeReq();
    const output: AuthorizedRequest = { ...input, headers: { Authorization: "Bearer new" } };
    const backToReq: PreparedRequest = output;
    expect(backToReq.headers["Authorization"]).toBe("Bearer new");
  });

  it("body is preserved through alias assignment without narrowing loss", () => {
    const withBody = makeReq({ body: { key: "value" } });
    const authed: AuthorizedRequest = withBody;
    expect(authed.body).toEqual({ key: "value" });
  });
});

// ---------------------------------------------------------------------------
// RunContext structural contract (AC#3)
// ---------------------------------------------------------------------------

/**
 * Tests for RunContext: env + secrets readonly fields, reuse of ResolvedEnvironment
 * and SecretRegistry, and AC#3 placeholder shape (no runId/timestamp/logger).
 */
describe("RunContext - structural interface contract (AC#3)", () => {
  it("accepts a minimal RunContext literal with env and a SecretRegistry", () => {
    const registry = new SecretRegistry();
    const ctx: RunContext = {
      env: { name: "qa", prod: false, base_url: "https://qa.api.example.com" },
      secrets: registry,
    };
    expect(ctx.env.name).toBe("qa");
    expect(ctx.env.prod).toBe(false);
    expect(ctx.secrets).toBe(registry);
  });

  it("accepts a RunContext with a fully populated ResolvedEnvironment including databases", () => {
    const ctx = makeCtx({
      name: "staging", default_sla_ms: 2000,
      databases: { main: { type: "postgres", host: "db.staging.example.com", port: 5432, database: "db" } },
      auth_strategies: { bearer: { type: "static_token", token: "tok" } },
    });
    expect(ctx.env.default_sla_ms).toBe(2000);
    expect(ctx.env.databases?.["main"]?.type).toBe("postgres");
    expect(ctx.env.auth_strategies?.["bearer"]?.type).toBe("static_token");
  });

  it("accepts a RunContext where the SecretRegistry has recorded entries", () => {
    const registry = new SecretRegistry();
    registry.add("super-secret-token");
    const ctx: RunContext = {
      env: { name: "prod", prod: true, base_url: "https://api.example.com" },
      secrets: registry,
    };
    expect(ctx.secrets.size).toBe(1);
    expect(ctx.secrets.values().has("super-secret-token")).toBe(true);
  });

  it("accepts a RunContext with an empty SecretRegistry (no secrets resolved yet)", () => {
    const ctx = makeCtx();
    expect(ctx.secrets.size).toBe(0);
  });

  it("reads env and secrets without error (readonly fields are always readable)", () => {
    const ctx = makeCtx();
    const _env = ctx.env;
    const _secrets = ctx.secrets;
    expect(_env.name).toBe("qa");
    expect(_secrets).toBeInstanceOf(SecretRegistry);
  });
});

// ---------------------------------------------------------------------------
// RunContext readonly enforcement + excess-member rejection at module scope
// ---------------------------------------------------------------------------

// @ts-expect-error — runId is not a member of RunContext (AC#3 placeholder discipline).
const _badRunContext: RunContext = {
  env: { name: "qa", prod: false, base_url: "https://qa.example.com" },
  secrets: new SecretRegistry(),
  runId: "run-abc-123",
};

// @ts-expect-error — env is readonly on RunContext; reassignment is a compile error (AC#5).
makeCtx().env = { name: "bad", prod: false, base_url: "https://bad.example.com" };

// @ts-expect-error — secrets is readonly on RunContext; reassignment is a compile error (AC#5).
makeCtx().secrets = new SecretRegistry();

// ---------------------------------------------------------------------------
// AuthStrategy interface contract (AC#1)
// ---------------------------------------------------------------------------

/**
 * Tests for AuthStrategy: apply() signature, optional close() method, object-
 * literal and class-implements paths (AC#1, D11).
 */
describe("AuthStrategy - pluggable strategy interface contract (AC#1)", () => {
  it("accepts a stub with only apply() (close is optional)", () => {
    const stub: AuthStrategy = {
      async apply(req: PreparedRequest, _ctx: RunContext): Promise<AuthorizedRequest> {
        return { ...req, headers: { ...req.headers, Authorization: "Bearer tok" } };
      },
    };
    expect(typeof stub.apply).toBe("function");
    expect(stub.close).toBeUndefined();
  });

  it("accepts a stub with both apply() and close(); close() is callable", () => {
    let closed = false;
    const stub: AuthStrategy = {
      async apply(req: PreparedRequest, _ctx: RunContext): Promise<AuthorizedRequest> {
        return { ...req, headers: { ...req.headers, Authorization: "Bearer tok" } };
      },
      close(): void { closed = true; },
    };
    expect(typeof stub.close).toBe("function");
    stub.close?.();
    expect(closed).toBe(true);
  });

  it("apply() is callable, receives PreparedRequest + RunContext, and returns a Promise", async () => {
    let capturedReq: PreparedRequest | undefined;
    let capturedCtx: RunContext | undefined;
    const stub: AuthStrategy = {
      async apply(req: PreparedRequest, ctx: RunContext): Promise<AuthorizedRequest> {
        capturedReq = req;
        capturedCtx = ctx;
        return { ...req, headers: { ...req.headers, Authorization: "Bearer tok" } };
      },
    };
    const req = makeReq({ headers: { "Content-Type": "application/json" } });
    const ctx = makeCtx();
    const result = await stub.apply(req, ctx);
    expect(capturedReq).toBe(req);
    expect(capturedCtx).toBe(ctx);
    expect(result.headers["Authorization"]).toBe("Bearer tok");
  });

  it("optional chaining stub.close?.() is safe whether or not close is implemented", () => {
    const withClose: AuthStrategy = {
      async apply(req: PreparedRequest): Promise<AuthorizedRequest> { return { ...req }; },
      close(): void { /* stateless no-op */ },
    };
    const withoutClose: AuthStrategy = {
      async apply(req: PreparedRequest): Promise<AuthorizedRequest> { return { ...req }; },
    };
    expect(() => withClose.close?.()).not.toThrow();
    expect(() => withoutClose.close?.()).not.toThrow();
  });

  it("a class implementing AuthStrategy satisfies the interface (class-implements OOP path)", () => {
    class StaticStub implements AuthStrategy {
      async apply(
        request: PreparedRequest,
        _context: RunContext,
      ): Promise<AuthorizedRequest> {
        return { ...request, headers: { ...request.headers, Authorization: "Bearer stub" } };
      }
    }
    const instance: AuthStrategy = new StaticStub();
    expect(typeof instance.apply).toBe("function");
    expect(instance.close).toBeUndefined();
  });

  it("a stateful class with apply() + close() satisfies the interface and close cleans state", () => {
    let didClose = false;
    class StatefulStub implements AuthStrategy {
      async apply(
        request: PreparedRequest,
        _context: RunContext,
      ): Promise<AuthorizedRequest> {
        return { ...request, headers: { ...request.headers, Authorization: "Bearer cached" } };
      }
      close(): void { didClose = true; }
    }
    const instance: AuthStrategy = new StatefulStub();
    instance.close?.();
    expect(didClose).toBe(true);
  });

  it("a class can be token-injected and apply() resolves with the injected token", async () => {
    class EchoStub implements AuthStrategy {
      constructor(private readonly token: string) {}
      async apply(
        request: PreparedRequest,
        _context: RunContext,
      ): Promise<AuthorizedRequest> {
        return { ...request,
          headers: { ...request.headers, Authorization: "Bearer " + this.token } };
      }
    }
    const strategy: AuthStrategy = new EchoStub("injected-token");
    const result = await strategy.apply(makeReq(), makeCtx());
    expect(result.headers["Authorization"]).toBe("Bearer injected-token");
  });
});

// ---------------------------------------------------------------------------
// D11 non-mutation runtime smoke tests (AC#5)
// ---------------------------------------------------------------------------

/**
 * Runtime assertions for the D11 non-mutation contract: apply() MUST return a
 * NEW object, not mutate and return the input. These are the load-bearing smoke
 * tests that AC#5 mandates ("returns a new object (not the input request)").
 */
describe("AuthStrategy.apply() — D11 non-mutation runtime smoke test (AC#5)", () => {
  it("returns a new object (not the input request) — reference inequality", async () => {
    const stub: AuthStrategy = {
      async apply(req: PreparedRequest, _ctx: RunContext): Promise<AuthorizedRequest> {
        return { ...req, headers: { ...req.headers, Authorization: "Bearer tok" } };
      },
    };
    const input = makeReq();
    const out = await stub.apply(input, makeCtx());
    expect(out).not.toBe(input);
    expect(out.headers).not.toBe(input.headers);
    expect(input.headers).toEqual({});
    expect(out.headers["Authorization"]).toBe("Bearer tok");
  });

  it("does not mutate method, url, or pre-existing headers of the input", async () => {
    const stub: AuthStrategy = {
      async apply(req: PreparedRequest, _ctx: RunContext): Promise<AuthorizedRequest> {
        return { method: req.method, url: req.url,
          headers: { ...req.headers, Authorization: "Bearer y" } };
      },
    };
    const input = makeReq({ method: "DELETE",
      url: "https://api.example.com/items/5", headers: { "X-Trace": "abc" } });
    const out = await stub.apply(input, makeCtx());
    expect(input.method).toBe("DELETE");
    expect(input.url).toBe("https://api.example.com/items/5");
    expect(input.headers["X-Trace"]).toBe("abc");
    expect(out.headers["Authorization"]).toBe("Bearer y");
  });

  it("preserves the body reference through a spread (body is opaque; strategies don't touch it)", async () => {
    const bodyValue = { key: "original" };
    const stub: AuthStrategy = {
      async apply(req: PreparedRequest, _ctx: RunContext): Promise<AuthorizedRequest> {
        return { ...req, headers: { ...req.headers, Authorization: "Bearer z" } };
      },
    };
    const input = makeReq({ method: "POST", body: bodyValue });
    const out = await stub.apply(input, makeCtx());
    expect(out.body).toBe(bodyValue);
    expect(input.body).toBe(bodyValue);
  });

  it("a pass-through stub returning input unchanged is type-legal (NoAuthBypass pattern)", async () => {
    // D12: AuthorizedRequest = PreparedRequest — returning input as-is is type-safe.
    const passThrough: AuthStrategy = {
      async apply(req: PreparedRequest): Promise<AuthorizedRequest> { return req; },
    };
    const input = makeReq();
    const out = await passThrough.apply(input, makeCtx());
    expect(out).toBe(input);
  });

  it("apply returns a Promise, not a synchronous value — uniform async contract (AC#1)", async () => {
    const stub: AuthStrategy = {
      async apply(req: PreparedRequest): Promise<AuthorizedRequest> {
        return { ...req, headers: { Authorization: "Bearer sync-wrapped" } };
      },
    };
    const promise = stub.apply(makeReq(), makeCtx());
    expect(promise).toBeInstanceOf(Promise);
    const result = await promise;
    expect(result.headers["Authorization"]).toBe("Bearer sync-wrapped");
  });
});
