import { describe, it, expect } from "vitest";

import { attachAuthHeader } from "../../../../src/auth/strategies/header-attacher.js";
import type {
  PreparedRequest,
  AuthorizedRequest,
} from "../../../../src/auth/types.js";

/**
 * Unit tests for the shared `attachAuthHeader` helper
 * (`src/auth/strategies/header-attacher.ts`).
 *
 * This helper is the single source of truth for `${token}` substitution and
 * case-insensitive header attachment used by both `static-token-strategy` and
 * `token-endpoint-strategy` (D7 + D16). Extracting it into a dedicated file
 * guarantees semantic identity across both strategies.
 *
 * Coverage obligation: every branch of every conditional in header-attacher.ts
 * must be reachable from this file (95% branch threshold, vitest config). The
 * design enumerates: single/multiple/zero ${token} placeholders; $-escape chars
 * in token; case-insensitive header collision; no-collision path; non-mutation
 * contract (D11); spread creates a new top-level object and a new headers map.
 *
 * RED PHASE: `src/auth/strategies/header-attacher.ts` does not exist. This
 * file fails with ERR_MODULE_NOT_FOUND until the implementation-engineer
 * creates it. That import-failure is the intended red-phase outcome.
 *
 * Skip rationale for integration tests: none needed — this is a pure function
 * with no external dependencies; unit tests provide full coverage.
 */

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/**
 * Builds a minimal PreparedRequest for use in attach tests.
 * @param headers - Optional starting headers map.
 * @returns A PreparedRequest with method GET.
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

// ---------------------------------------------------------------------------
// describe: attachAuthHeader — ${token} substitution
// ---------------------------------------------------------------------------

/**
 * Tests for the `${token}` substitution algorithm (D7 + D16).
 * The function form of replaceAll ensures literal substitution regardless
 * of special replacement patterns in `token`.
 */
describe("attachAuthHeader — ${token} substitution", () => {
  it("substitutes a single ${token} placeholder with the token string", () => {
    const req = makeRequest();
    const result: AuthorizedRequest = attachAuthHeader(
      req,
      "Authorization",
      "Bearer ${token}",
      "my-token",
    );
    expect(result.headers["Authorization"]).toBe("Bearer my-token");
  });

  it("substitutes all occurrences when multiple ${token} placeholders are present", () => {
    const req = makeRequest();
    const result = attachAuthHeader(
      req,
      "X-Auth",
      "${token}::${token}",
      "TK",
    );
    expect(result.headers["X-Auth"]).toBe("TK::TK");
  });

  it("does not modify the header value when no ${token} placeholder is present (D16 silent acceptance)", () => {
    const req = makeRequest();
    const result = attachAuthHeader(
      req,
      "Authorization",
      "Bearer fixed-literal",
      "ignored-token",
    );
    expect(result.headers["Authorization"]).toBe("Bearer fixed-literal");
  });

  it("preserves literal $$ in token without double-substitution (function-form replaceAll)", () => {
    const req = makeRequest();
    const result = attachAuthHeader(
      req,
      "Authorization",
      "Bearer ${token}",
      "tok$$en",
    );
    // function-form guarantees literal substitution — $$ must not collapse
    expect(result.headers["Authorization"]).toBe("Bearer tok$$en");
  });

  it("preserves $& in token without treating it as a backreference", () => {
    const req = makeRequest();
    const result = attachAuthHeader(
      req,
      "Authorization",
      "Bearer ${token}",
      "tok$&en",
    );
    expect(result.headers["Authorization"]).toBe("Bearer tok$&en");
  });

  it("preserves $` and $' in token without treating them as backreferences", () => {
    const req = makeRequest();
    const resultBacktick = attachAuthHeader(
      req,
      "Authorization",
      "Bearer ${token}",
      "tok$`en",
    );
    expect(resultBacktick.headers["Authorization"]).toBe("Bearer tok$`en");

    const resultSingleQuote = attachAuthHeader(
      req,
      "Authorization",
      "Bearer ${token}",
      "tok$'en",
    );
    expect(resultSingleQuote.headers["Authorization"]).toBe("Bearer tok$'en");
  });

  it("handles an empty token string (no placeholder content)", () => {
    const req = makeRequest();
    const result = attachAuthHeader(
      req,
      "Authorization",
      "Bearer ${token}",
      "",
    );
    expect(result.headers["Authorization"]).toBe("Bearer ");
  });
});

// ---------------------------------------------------------------------------
// describe: attachAuthHeader — case-insensitive header attachment (RFC 7230)
// ---------------------------------------------------------------------------

/**
 * Tests for case-insensitive header collision handling (D7 + RFC 7230 §3.2).
 * The strategy header always wins over any existing header regardless of
 * casing differences. ALL case-variants are dropped and replaced.
 */
describe("attachAuthHeader — case-insensitive header collision", () => {
  it("adds the header when no existing header with that name is present", () => {
    const req = makeRequest({ "Content-Type": "application/json" });
    const result = attachAuthHeader(
      req,
      "Authorization",
      "Bearer ${token}",
      "T",
    );
    expect(result.headers["Authorization"]).toBe("Bearer T");
    expect(result.headers["Content-Type"]).toBe("application/json");
  });

  it("replaces an existing header of the SAME casing", () => {
    const req = makeRequest({ Authorization: "Bearer old-token" });
    const result = attachAuthHeader(
      req,
      "Authorization",
      "Bearer ${token}",
      "new-token",
    );
    expect(result.headers["Authorization"]).toBe("Bearer new-token");
    expect(Object.keys(result.headers)).toHaveLength(1);
  });

  it("replaces an existing header with LOWER-CASE variant (strategy header wins)", () => {
    const req = makeRequest({ authorization: "Bearer old" });
    const result = attachAuthHeader(
      req,
      "Authorization",
      "Bearer ${token}",
      "T",
    );
    expect(result.headers["Authorization"]).toBe("Bearer T");
    // the old lowercase key must be gone
    expect("authorization" in result.headers).toBe(false);
  });

  it("replaces an existing header with UPPER-CASE variant", () => {
    const req = makeRequest({ AUTHORIZATION: "Bearer old" });
    const result = attachAuthHeader(
      req,
      "Authorization",
      "Bearer ${token}",
      "T",
    );
    expect(result.headers["Authorization"]).toBe("Bearer T");
    expect("AUTHORIZATION" in result.headers).toBe(false);
  });

  it("replaces ALL existing case-variant duplicates in one pass", () => {
    const req = makeRequest({
      authorization: "old-lower",
      Authorization: "old-title",
      AUTHORIZATION: "old-upper",
    });
    const result = attachAuthHeader(
      req,
      "Authorization",
      "Bearer ${token}",
      "T",
    );
    expect(result.headers["Authorization"]).toBe("Bearer T");
    expect("authorization" in result.headers).toBe(false);
    expect("AUTHORIZATION" in result.headers).toBe(false);
    expect(Object.keys(result.headers)).toHaveLength(1);
  });

  it("uses the spec headerName casing in the output (not the input casing)", () => {
    const req = makeRequest({ authorization: "old" });
    const result = attachAuthHeader(
      req,
      "X-Api-Key",
      "${token}",
      "K",
    );
    expect(result.headers["X-Api-Key"]).toBe("K");
    expect("authorization" in result.headers).toBe(true); // unrelated key preserved
  });

  it("preserves unrelated headers after collision removal", () => {
    const req = makeRequest({
      "Content-Type": "application/json",
      Accept: "application/json",
      authorization: "Bearer old",
    });
    const result = attachAuthHeader(
      req,
      "Authorization",
      "Bearer ${token}",
      "T",
    );
    expect(result.headers["Content-Type"]).toBe("application/json");
    expect(result.headers["Accept"]).toBe("application/json");
    expect(result.headers["Authorization"]).toBe("Bearer T");
    expect("authorization" in result.headers).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// describe: attachAuthHeader — non-mutation contract (D11)
// ---------------------------------------------------------------------------

/**
 * Tests for the structural non-mutation guarantee (D11).
 * `attachAuthHeader` must return a NEW object and a NEW headers map; the
 * input PreparedRequest must be identical to its pre-call snapshot.
 */
describe("attachAuthHeader — non-mutation contract (D11)", () => {
  it("returns a new top-level object (not the same reference)", () => {
    const req = makeRequest();
    const result = attachAuthHeader(req, "Authorization", "Bearer ${token}", "T");
    expect(result).not.toBe(req);
  });

  it("returns a new headers object (not the same reference as input.headers)", () => {
    const req = makeRequest({ Accept: "application/json" });
    const result = attachAuthHeader(req, "Authorization", "Bearer ${token}", "T");
    expect(result.headers).not.toBe(req.headers);
  });

  it("does not modify the original request.headers map", () => {
    const headers = { Accept: "application/json" };
    const req = makeRequest(headers);
    attachAuthHeader(req, "Authorization", "Bearer ${token}", "T");
    // Original headers must be untouched
    expect(req.headers).toEqual({ Accept: "application/json" });
    expect("Authorization" in req.headers).toBe(false);
  });

  it("does not modify input.method or input.url", () => {
    const req: PreparedRequest = {
      method: "POST",
      url: "https://api.fixture.invalid/data",
      headers: {},
      body: { key: "val" },
    };
    const result = attachAuthHeader(req, "Authorization", "Bearer ${token}", "T");
    expect(result.method).toBe("POST");
    expect(result.url).toBe("https://api.fixture.invalid/data");
    expect(result.body).toEqual({ key: "val" });
    // Input unchanged
    expect(req.method).toBe("POST");
    expect(req.url).toBe("https://api.fixture.invalid/data");
  });

  it("preserves the optional body field on the returned request", () => {
    const req: PreparedRequest = {
      method: "POST",
      url: "https://api.fixture.invalid/x",
      headers: {},
      body: { payload: 42 },
    };
    const result = attachAuthHeader(req, "Authorization", "Bearer ${token}", "T");
    expect(result.body).toEqual({ payload: 42 });
  });

  it("preserves absence of body when input has no body", () => {
    const req = makeRequest();
    const result = attachAuthHeader(req, "Authorization", "Bearer ${token}", "T");
    // body should be absent (undefined), not an explicit null/empty
    expect("body" in result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// describe: attachAuthHeader — empty request headers starting point
// ---------------------------------------------------------------------------

/**
 * Edge cases: request starts with zero headers.
 */
describe("attachAuthHeader — empty starting headers", () => {
  it("attaches the header to a request with no pre-existing headers", () => {
    const req = makeRequest({});
    const result = attachAuthHeader(req, "Authorization", "Bearer ${token}", "T");
    expect(result.headers).toEqual({ Authorization: "Bearer T" });
  });
});
