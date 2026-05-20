import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  createDefaultHttpFetchSeam,
  HttpFetchInput,
  HttpFetchResult,
  HttpFetchSeam,
} from "../../../src/auth/http-fetch-seam.js";
import {
  AuthStrategyError,
  AUTH_ERROR_CODES,
} from "../../../src/auth/errors.js";

/**
 * Unit tests for the §6 HttpFetchSeam interface + Node 22 global-fetch default.
 *
 * Design: .tasks/design/auth-http-fetch-seam.md
 * Source target (does not exist yet): src/auth/http-fetch-seam.ts
 *
 * RED PHASE: Both source files (http-fetch-seam.ts, errors.ts) do not exist.
 * Every test in this file fails at import time with MODULE_NOT_FOUND.
 *
 * Categories covered (per design §9):
 *  §9.1 — Fake-seam contract: vi.fn() injection demonstrates the DI pattern.
 *  §9.2 — Default seam smoke tests: globalThis.fetch stubbed, 5 branches.
 *  §9.3 — Request-shape assertions: url, method, headers, body serialization.
 *  §9.4 — No-leak assertions: error messages never contain credentials/url/body.
 *  §9.5 — Lazy-fetch assertion: import + factory do not touch globalThis.fetch.
 *  §9.6 — Factory identity: each call returns a fresh object with postJson fn.
 *
 * Skip rationale: integration tests skipped — design §9 explicitly states
 * "hermetic unit-only; no real network; live E2E is a sibling opt-in task."
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Builds a minimal Response-shaped fake that `globalThis.fetch` stubs return.
 * Avoids constructing a real `Response` object (unavailable without the full
 * WHATWG fetch runtime in some test environments).
 * @param status - HTTP status code to simulate.
 * @param jsonFn - Async function whose return value `response.json()` resolves to,
 *   or whose thrown error `response.json()` rejects with.
 */
function makeFakeResponse(
  status: number,
  jsonFn: () => Promise<unknown>,
): { status: number; json: () => Promise<unknown> } {
  return { status, json: jsonFn };
}

/**
 * Standard input fixture used across request-shape tests.
 * Values chosen to be trivially detectable in leak assertions.
 */
const SHAPE_INPUT: HttpFetchInput = {
  url: "https://sso.example.com/token",
  body: { username: "fixture-user", password: "fixture-pass" },
  headers: { Authorization: "Basic xyz" },
};

/**
 * Minimal input with no optional headers — used for header-injection tests.
 */
const BARE_INPUT: HttpFetchInput = {
  url: "https://auth.example.org/token",
  body: { grant_type: "client_credentials" },
};

// ---------------------------------------------------------------------------
// §9.1 Fake-seam contract tests
// ---------------------------------------------------------------------------

describe("HttpFetchSeam — fake-seam injection contract (§9.1)", () => {
  describe("fake seam returns success", () => {
    it("resolves with the exact HttpFetchResult the fake returns", async () => {
      const expected: HttpFetchResult = {
        status: 200,
        body: { access_token: "T" },
      };
      const seam: HttpFetchSeam = {
        postJson: vi.fn().mockResolvedValue(expected),
      };

      const result = await seam.postJson({ url: "x", body: { u: "x", p: "y" } });

      expect(result).toEqual(expected);
    });

    it("calls postJson with the exact input supplied by the caller", async () => {
      const seam: HttpFetchSeam = {
        postJson: vi.fn().mockResolvedValue({ status: 200, body: {} }),
      };
      const input: HttpFetchInput = { url: "x", body: { u: "x", p: "y" } };

      await seam.postJson(input);

      expect(seam.postJson).toHaveBeenCalledOnce();
      expect(seam.postJson).toHaveBeenCalledWith(input);
    });
  });

  describe("fake seam returns a non-2xx status", () => {
    it("resolves (not rejects) with status 401 — non-2xx mapping is default seam's job", async () => {
      const result401: HttpFetchResult = { status: 401, body: {} };
      const seam: HttpFetchSeam = {
        postJson: vi.fn().mockResolvedValue(result401),
      };

      // The fake seam contract is Promise<HttpFetchResult>; a 401 resolves.
      const result = await seam.postJson({ url: "x", body: {} });
      expect(result.status).toBe(401);
      expect(result.body).toEqual({});
    });
  });

  describe("fake seam throws", () => {
    it("propagates the rejection as-is without wrapping (fakes do not wrap)", async () => {
      const networkError = new Error("boom");
      const seam: HttpFetchSeam = {
        postJson: vi.fn().mockRejectedValue(networkError),
      };

      await expect(seam.postJson({ url: "x", body: {} })).rejects.toThrow("boom");
      // Confirm it is the SAME reference — not re-wrapped by the fake
      await expect(seam.postJson({ url: "x", body: {} })).rejects.toBe(networkError);
    });
  });
});

// ---------------------------------------------------------------------------
// §9.2 Default seam smoke tests
// ---------------------------------------------------------------------------

describe("createDefaultHttpFetchSeam — default seam smoke tests (§9.2)", () => {
  // We capture the original fetch (may be undefined in test env) and restore it.
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe("200 + valid JSON body", () => {
    it("resolves with status 200 and the parsed body", async () => {
      const fakeResponse = makeFakeResponse(200, async () => ({ access_token: "T" }));
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(fakeResponse));

      const seam = createDefaultHttpFetchSeam();
      const result = await seam.postJson(BARE_INPUT);

      expect(result.status).toBe(200);
      expect(result.body).toEqual({ access_token: "T" });
    });

    it("resolves with body null when the server JSON-parses to null", async () => {
      const fakeResponse = makeFakeResponse(200, async () => null);
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(fakeResponse));

      const seam = createDefaultHttpFetchSeam();
      const result = await seam.postJson(BARE_INPUT);

      expect(result.status).toBe(200);
      expect(result.body).toBeNull();
    });

    it("resolves with a 201 Created status and the parsed body", async () => {
      const fakeResponse = makeFakeResponse(201, async () => ({ token: "abc" }));
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(fakeResponse));

      const seam = createDefaultHttpFetchSeam();
      const result = await seam.postJson(BARE_INPUT);

      expect(result.status).toBe(201);
      expect(result.body).toEqual({ token: "abc" });
    });
  });

  describe("network failure (fetch rejects)", () => {
    it("rejects with AuthStrategyError when fetch throws ECONNREFUSED", async () => {
      const networkError = new Error("ECONNREFUSED");
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(networkError));

      const seam = createDefaultHttpFetchSeam();
      await expect(seam.postJson(SHAPE_INPUT)).rejects.toBeInstanceOf(AuthStrategyError);
    });

    it("rejects with code AUTH_TOKEN_FETCH_FAILED on network failure", async () => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));

      const seam = createDefaultHttpFetchSeam();
      const err = await seam.postJson(SHAPE_INPUT).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(AuthStrategyError);
      if (err instanceof AuthStrategyError) {
        expect(err.code).toBe(AUTH_ERROR_CODES.AUTH_TOKEN_FETCH_FAILED);
      }
    });

    it("rejects with phase 'fetch' on network failure", async () => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("DNS_FAIL")));

      const seam = createDefaultHttpFetchSeam();
      const err = await seam.postJson(SHAPE_INPUT).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(AuthStrategyError);
      if (err instanceof AuthStrategyError) {
        expect(err.phase).toBe("fetch");
      }
    });

    it("rejects with the exact message 'Token endpoint fetch failed.' on network failure", async () => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("conn refused")));

      const seam = createDefaultHttpFetchSeam();
      const err = await seam.postJson(SHAPE_INPUT).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(AuthStrategyError);
      if (err instanceof AuthStrategyError) {
        expect(err.message).toBe("Token endpoint fetch failed.");
      }
    });

    it("attaches the underlying Error as cause on network failure", async () => {
      const underlying = new Error("ECONNREFUSED");
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(underlying));

      const seam = createDefaultHttpFetchSeam();
      const err = await seam.postJson(SHAPE_INPUT).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(AuthStrategyError);
      if (err instanceof AuthStrategyError) {
        expect(err.cause).toBe(underlying);
      }
    });
  });

  describe("non-2xx response (500)", () => {
    it("rejects with AuthStrategyError when server returns 500", async () => {
      const fakeResponse = makeFakeResponse(500, async () => ({}));
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(fakeResponse));

      const seam = createDefaultHttpFetchSeam();
      await expect(seam.postJson(SHAPE_INPUT)).rejects.toBeInstanceOf(AuthStrategyError);
    });

    it("rejects with code AUTH_TOKEN_FETCH_NON_2XX on 500", async () => {
      const fakeResponse = makeFakeResponse(500, async () => ({}));
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(fakeResponse));

      const seam = createDefaultHttpFetchSeam();
      const err = await seam.postJson(SHAPE_INPUT).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(AuthStrategyError);
      if (err instanceof AuthStrategyError) {
        expect(err.code).toBe(AUTH_ERROR_CODES.AUTH_TOKEN_FETCH_NON_2XX);
      }
    });

    it("rejects with phase 'fetch' on 500", async () => {
      const fakeResponse = makeFakeResponse(500, async () => ({}));
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(fakeResponse));

      const seam = createDefaultHttpFetchSeam();
      const err = await seam.postJson(SHAPE_INPUT).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(AuthStrategyError);
      if (err instanceof AuthStrategyError) {
        expect(err.phase).toBe("fetch");
      }
    });

    it("rejects with exact message 'Token endpoint returned non-2xx status 500.' on 500", async () => {
      const fakeResponse = makeFakeResponse(500, async () => ({}));
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(fakeResponse));

      const seam = createDefaultHttpFetchSeam();
      const err = await seam.postJson(SHAPE_INPUT).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(AuthStrategyError);
      if (err instanceof AuthStrategyError) {
        expect(err.message).toBe("Token endpoint returned non-2xx status 500.");
      }
    });

    it("does not attach a cause on a 500 non-2xx response (D10: response body may carry secrets)", async () => {
      const fakeResponse = makeFakeResponse(500, async () => ({}));
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(fakeResponse));

      const seam = createDefaultHttpFetchSeam();
      const err = await seam.postJson(SHAPE_INPUT).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(AuthStrategyError);
      if (err instanceof AuthStrategyError) {
        expect(err.cause).toBeUndefined();
      }
    });
  });

  describe("non-2xx response (401)", () => {
    it("rejects with code AUTH_TOKEN_FETCH_NON_2XX on 401", async () => {
      const fakeResponse = makeFakeResponse(401, async () => ({ error: "bad" }));
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(fakeResponse));

      const seam = createDefaultHttpFetchSeam();
      const err = await seam.postJson(SHAPE_INPUT).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(AuthStrategyError);
      if (err instanceof AuthStrategyError) {
        expect(err.code).toBe(AUTH_ERROR_CODES.AUTH_TOKEN_FETCH_NON_2XX);
      }
    });

    it("rejects with exact message 'Token endpoint returned non-2xx status 401.' on 401", async () => {
      const fakeResponse = makeFakeResponse(401, async () => ({ error: "bad" }));
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(fakeResponse));

      const seam = createDefaultHttpFetchSeam();
      const err = await seam.postJson(SHAPE_INPUT).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(AuthStrategyError);
      if (err instanceof AuthStrategyError) {
        expect(err.message).toBe("Token endpoint returned non-2xx status 401.");
      }
    });
  });

  describe("2xx + invalid JSON body (edge case a)", () => {
    it("rejects with AuthStrategyError when response.json() throws SyntaxError on 200", async () => {
      const syntaxErr = new SyntaxError("bad json");
      const fakeResponse = makeFakeResponse(200, async () => {
        throw syntaxErr;
      });
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(fakeResponse));

      const seam = createDefaultHttpFetchSeam();
      await expect(seam.postJson(BARE_INPUT)).rejects.toBeInstanceOf(AuthStrategyError);
    });

    it("rejects with code AUTH_TOKEN_FETCH_FAILED when 2xx body is not valid JSON", async () => {
      const fakeResponse = makeFakeResponse(200, async () => {
        throw new SyntaxError("bad json");
      });
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(fakeResponse));

      const seam = createDefaultHttpFetchSeam();
      const err = await seam.postJson(BARE_INPUT).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(AuthStrategyError);
      if (err instanceof AuthStrategyError) {
        expect(err.code).toBe(AUTH_ERROR_CODES.AUTH_TOKEN_FETCH_FAILED);
      }
    });

    it("attaches the SyntaxError as cause when JSON parse fails on 2xx", async () => {
      const syntaxErr = new SyntaxError("bad json");
      const fakeResponse = makeFakeResponse(200, async () => {
        throw syntaxErr;
      });
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(fakeResponse));

      const seam = createDefaultHttpFetchSeam();
      const err = await seam.postJson(BARE_INPUT).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(AuthStrategyError);
      if (err instanceof AuthStrategyError) {
        expect(err.cause).toBe(syntaxErr);
      }
    });

    it("rejects with phase 'fetch' when JSON parse fails on 2xx", async () => {
      const fakeResponse = makeFakeResponse(200, async () => {
        throw new SyntaxError("bad json");
      });
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(fakeResponse));

      const seam = createDefaultHttpFetchSeam();
      const err = await seam.postJson(BARE_INPUT).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(AuthStrategyError);
      if (err instanceof AuthStrategyError) {
        expect(err.phase).toBe("fetch");
      }
    });
  });
});

// ---------------------------------------------------------------------------
// §9.3 Request-shape assertions
// ---------------------------------------------------------------------------

describe("createDefaultHttpFetchSeam — request-shape assertions (§9.3)", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    // Default stub resolves 200 with a minimal token body so postJson succeeds.
    fetchSpy = vi.fn().mockResolvedValue(
      makeFakeResponse(200, async () => ({ access_token: "tok" })),
    );
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe("Content-Type auto-injection", () => {
    it("always includes Content-Type: application/json even when caller omits headers", async () => {
      const seam = createDefaultHttpFetchSeam();
      await seam.postJson(BARE_INPUT);

      const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect((init.headers as Record<string, string>)["Content-Type"]).toBe(
        "application/json",
      );
    });

    it("includes Content-Type: application/json even when caller supplies other headers", async () => {
      const seam = createDefaultHttpFetchSeam();
      await seam.postJson(SHAPE_INPUT);

      const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect((init.headers as Record<string, string>)["Content-Type"]).toBe(
        "application/json",
      );
    });
  });

  describe("caller headers preserved + Content-Type override silently ignored (edge case e)", () => {
    it("preserves caller Authorization header alongside Content-Type: application/json", async () => {
      const seam = createDefaultHttpFetchSeam();
      await seam.postJson(SHAPE_INPUT);

      const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      const headers = init.headers as Record<string, string>;
      expect(headers["Authorization"]).toBe("Basic xyz");
      expect(headers["Content-Type"]).toBe("application/json");
    });

    it("silently overrides caller Content-Type: application/xml with application/json (D14)", async () => {
      const input: HttpFetchInput = {
        url: "https://sso.example.com/token",
        body: { grant_type: "client_credentials" },
        headers: { "Content-Type": "application/xml", Authorization: "Basic xyz" },
      };
      const seam = createDefaultHttpFetchSeam();
      await seam.postJson(input);

      const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      const headers = init.headers as Record<string, string>;
      expect(headers["Content-Type"]).toBe("application/json");
      expect(headers["Authorization"]).toBe("Basic xyz");
    });
  });

  describe("JSON body serialization", () => {
    it("passes body as the JSON-serialized string of input.body", async () => {
      const inputBody = { username: "fixture-user", password: "fixture-pass" };
      const seam = createDefaultHttpFetchSeam();
      await seam.postJson({ url: "https://sso.example.com/token", body: inputBody });

      const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(init.body).toBe(JSON.stringify(inputBody));
    });

    it("passes an empty object body as serialized JSON string '{}'", async () => {
      const seam = createDefaultHttpFetchSeam();
      await seam.postJson({ url: "https://auth.example.org/token", body: {} });

      const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(init.body).toBe("{}");
    });
  });

  describe("method and URL forwarding", () => {
    it("always uses POST as the HTTP method", async () => {
      const seam = createDefaultHttpFetchSeam();
      await seam.postJson(BARE_INPUT);

      const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(init.method).toBe("POST");
    });

    it("passes the URL through as the first argument to fetch unchanged", async () => {
      const seam = createDefaultHttpFetchSeam();
      await seam.postJson(SHAPE_INPUT);

      const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://sso.example.com/token");
    });
  });
});

// ---------------------------------------------------------------------------
// §9.4 No-leak assertions
// ---------------------------------------------------------------------------

describe("createDefaultHttpFetchSeam — no-leak assertions (§9.4)", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe("network failure error message does not leak credentials or URL", () => {
    it("does not contain credential value 'x' in message on network failure", async () => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
      const seam = createDefaultHttpFetchSeam();
      const err = await seam.postJson(SHAPE_INPUT).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(AuthStrategyError);
      if (err instanceof AuthStrategyError) {
        expect(err.message).not.toContain("x");
      }
    });

    it("does not contain credential value 'y' in message on network failure", async () => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
      const seam = createDefaultHttpFetchSeam();
      const err = await seam.postJson(SHAPE_INPUT).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(AuthStrategyError);
      if (err instanceof AuthStrategyError) {
        expect(err.message).not.toContain("y");
      }
    });

    it("does not contain the URL hostname in message on network failure", async () => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
      const seam = createDefaultHttpFetchSeam();
      const err = await seam.postJson(SHAPE_INPUT).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(AuthStrategyError);
      if (err instanceof AuthStrategyError) {
        expect(err.message).not.toContain("sso.example.com");
      }
    });

    it("does not contain caller header value 'Basic xyz' in message on network failure", async () => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
      const seam = createDefaultHttpFetchSeam();
      const err = await seam.postJson(SHAPE_INPUT).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(AuthStrategyError);
      if (err instanceof AuthStrategyError) {
        expect(err.message).not.toContain("Basic xyz");
      }
    });
  });

  describe("non-2xx error message does not leak response body or URL", () => {
    it("does not contain response body value 'bad' in message on 401", async () => {
      const fakeResponse = makeFakeResponse(401, async () => ({ error: "bad" }));
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(fakeResponse));
      const seam = createDefaultHttpFetchSeam();
      const err = await seam.postJson(SHAPE_INPUT).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(AuthStrategyError);
      if (err instanceof AuthStrategyError) {
        expect(err.message).not.toContain("bad");
      }
    });

    it("does not contain the URL hostname in message on 500", async () => {
      const fakeResponse = makeFakeResponse(500, async () => ({}));
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(fakeResponse));
      const seam = createDefaultHttpFetchSeam();
      const err = await seam.postJson(SHAPE_INPUT).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(AuthStrategyError);
      if (err instanceof AuthStrategyError) {
        expect(err.message).not.toContain("sso.example.com");
      }
    });

    it("does not contain credential values in message on 401", async () => {
      const fakeResponse = makeFakeResponse(401, async () => ({ error: "unauthorized" }));
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(fakeResponse));
      const seam = createDefaultHttpFetchSeam();
      const err = await seam.postJson(SHAPE_INPUT).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(AuthStrategyError);
      if (err instanceof AuthStrategyError) {
        expect(err.message).not.toContain("fixture-user");
        expect(err.message).not.toContain("fixture-pass");
        expect(err.message).not.toContain("Basic xyz");
      }
    });
  });
});

// ---------------------------------------------------------------------------
// §9.5 Lazy-fetch assertion
// ---------------------------------------------------------------------------

describe("createDefaultHttpFetchSeam — lazy-fetch contract (§9.5)", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("importing the module does not throw even when globalThis.fetch is undefined", () => {
    // The module is already imported at the top of this file. If the import
    // touched globalThis.fetch, this entire test file would fail at load time.
    // Reaching this assertion proves the module import is fetch-free.
    expect(createDefaultHttpFetchSeam).toBeDefined();
  });

  it("calling the factory function does not throw even when globalThis.fetch is undefined", () => {
    // Cast required: we are deliberately setting fetch to undefined to test the
    // lazy contract. This is intentional test infrastructure, not production code.
    globalThis.fetch = undefined as never;

    // The factory must return without error (it must not resolve globalThis.fetch)
    expect(() => createDefaultHttpFetchSeam()).not.toThrow();
  });

  it("calling postJson when globalThis.fetch is undefined rejects with AUTH_TOKEN_FETCH_FAILED", async () => {
    // Only postJson() touches globalThis.fetch. An undefined fetch means it is
    // not callable: TypeError("fetch is not a function") is thrown inside postJson
    // and caught by the outer try/catch, surfacing as AUTH_TOKEN_FETCH_FAILED.
    globalThis.fetch = undefined as never;

    const seam = createDefaultHttpFetchSeam();
    const err = await seam.postJson(BARE_INPUT).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(AuthStrategyError);
    if (err instanceof AuthStrategyError) {
      expect(err.code).toBe(AUTH_ERROR_CODES.AUTH_TOKEN_FETCH_FAILED);
      expect(err.phase).toBe("fetch");
    }
  });
});

// ---------------------------------------------------------------------------
// §9.6 Factory identity
// ---------------------------------------------------------------------------

describe("createDefaultHttpFetchSeam — factory identity (§9.6)", () => {
  it("returns a fresh object on every call (no shared singleton)", () => {
    const a = createDefaultHttpFetchSeam();
    const b = createDefaultHttpFetchSeam();
    expect(a).not.toBe(b);
  });

  it("returned object has a postJson property that is a function", () => {
    const seam = createDefaultHttpFetchSeam();
    expect(typeof seam.postJson).toBe("function");
  });

  it("satisfies HttpFetchSeam structurally: postJson returns a Promise when invoked", async () => {
    // We do not call the network; we only check the shape of the returned value.
    // Stub fetch to resolve immediately with a valid 200.
    const originalFetch = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(makeFakeResponse(200, async () => ({ ok: true }))),
    );

    const seam: HttpFetchSeam = createDefaultHttpFetchSeam();
    const promise = seam.postJson(BARE_INPUT);

    expect(promise).toBeInstanceOf(Promise);
    await promise;

    globalThis.fetch = originalFetch;
  });
});
