/**
 * Unit tests for corsPreflightVerdict.
 *
 * Covers §6 items 25–44 from v1.0.2-pr6-cors-preflight.md.
 * All seven failure-reason templates are verified verbatim against §7.
 *
 * Design decisions pinned:
 *   DD-3  Wildcard: ["*"] accepts "*" OR sent origin; multi-list MUST echo origin.
 *   DD-4  Access-Control-Allow-Methods: set superset, whitespace+order insensitive,
 *         case-fold to UPPER on both sides per RFC 7231 §4.1.
 *   DD-5  Access-Control-Allow-Headers: set superset, case-fold to LOWER per RFC 7230 §3.2.
 *         Empty allow_headers in params → skip the headers check entirely.
 *   DD-6  Status MUST be 200 or 204; anything else fails with the status message.
 *         Status check fires BEFORE all header checks (short-circuit ordering).
 *
 * Exact failure-reason templates from §7 (implementation MUST use verbatim):
 *   "cors_preflight: expected status 200 or 204, got <N>"
 *   "cors_preflight: response missing Access-Control-Allow-Origin header"
 *   "cors_preflight: Access-Control-Allow-Origin '<got>' doesn't match expected '<expected>'"
 *   "cors_preflight: response missing Access-Control-Allow-Methods header"
 *   "cors_preflight: Access-Control-Allow-Methods missing required: <missing.join(',')>"
 *   "cors_preflight: response missing Access-Control-Allow-Headers header"
 *   "cors_preflight: Access-Control-Allow-Headers missing required: <missing.join(',')>"
 *
 * Category: Unit.
 * Expected initial failure: 'corsPreflightVerdict' is not exported from
 *   '../../../../src/runner/execute/case-runners.js'
 *   (it will live in verdicts.ts per M-6 refactor, re-exported from case-runners.ts)
 */

import { describe, it, expect } from "vitest";

import { corsPreflightVerdict } from "../../../../src/runner/execute/case-runners.js";
import type { ResponseRecord } from "../../../../src/runner/types.js";
import type { CorsPreflightParams } from "../../../../src/test-catalog/test-case-params.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResp(
  status: number,
  headers: Record<string, string> = {},
): ResponseRecord {
  return {
    status,
    headers: { "content-type": "application/json", ...headers },
    body: null,
    time_ms: 5,
  };
}

function makeParams(
  allow_origins: readonly string[],
  allow_methods: readonly string[],
  allow_headers: readonly string[],
): CorsPreflightParams {
  return { kind: "cors_preflight", allow_origins, allow_methods, allow_headers };
}

// Canonical fully-passing response headers for the default params
const PASS_RESP_HEADERS = {
  "access-control-allow-origin": "https://app.example.com",
  "access-control-allow-methods": "GET,POST,PUT",
  "access-control-allow-headers": "Authorization,Content-Type",
};

const DEFAULT_PARAMS = makeParams(
  ["https://app.example.com"],
  ["GET", "POST", "PUT"],
  ["Authorization", "Content-Type"],
);

// ---------------------------------------------------------------------------
// Pass paths
// ---------------------------------------------------------------------------

describe("corsPreflightVerdict — pass paths", () => {

  /**
   * Item 25: Status 200 + matching headers → pass.
   */
  it("returns pass for status 200 with matching origin, methods, and headers", () => {
    const result = corsPreflightVerdict(makeResp(200, PASS_RESP_HEADERS), DEFAULT_PARAMS);
    expect(result.verdict).toBe("pass");
  });

  /**
   * Item 26: Status 204 + matching headers → pass (DD-6 accepts both 200 and 204).
   */
  it("returns pass for status 204 with matching origin, methods, and headers", () => {
    const result = corsPreflightVerdict(makeResp(204, PASS_RESP_HEADERS), DEFAULT_PARAMS);
    expect(result.verdict).toBe("pass");
  });

  /**
   * Item 27: Status 200 + superset methods/headers → pass (server may advertise more).
   */
  it("returns pass when response is a superset of declared methods (DD-4)", () => {
    const resp = makeResp(200, {
      "access-control-allow-origin": "https://app.example.com",
      "access-control-allow-methods": "GET,POST,PUT,DELETE,PATCH",
      "access-control-allow-headers": "Authorization,Content-Type,X-Extra",
    });
    const result = corsPreflightVerdict(resp, DEFAULT_PARAMS);
    expect(result.verdict).toBe("pass");
  });

  /**
   * Item 28: Status 200 + methods in different order → pass (set comparison, DD-4).
   */
  it("returns pass when methods are in a different order from declared (DD-4 order-insensitive)", () => {
    const resp = makeResp(200, {
      "access-control-allow-origin": "https://app.example.com",
      "access-control-allow-methods": "PUT,GET,POST",
      "access-control-allow-headers": "Content-Type,Authorization",
    });
    const result = corsPreflightVerdict(resp, DEFAULT_PARAMS);
    expect(result.verdict).toBe("pass");
  });

  /**
   * Item 29: Status 200 + methods with extra whitespace → pass (trim, DD-4).
   */
  it("returns pass when method value has extra whitespace 'GET, POST , PUT' (DD-4 trim)", () => {
    const resp = makeResp(200, {
      "access-control-allow-origin": "https://app.example.com",
      "access-control-allow-methods": "GET, POST , PUT",
      "access-control-allow-headers": "Authorization,Content-Type",
    });
    const result = corsPreflightVerdict(resp, DEFAULT_PARAMS);
    expect(result.verdict).toBe("pass");
  });

  /**
   * Item 30: Status 200 + methods lowercase in response → pass (case-fold to UPPER, DD-4).
   */
  it("returns pass when response methods are lowercase 'get,post,put' (DD-4 case-fold)", () => {
    const resp = makeResp(200, {
      "access-control-allow-origin": "https://app.example.com",
      "access-control-allow-methods": "get,post,put",
      "access-control-allow-headers": "Authorization,Content-Type",
    });
    const result = corsPreflightVerdict(resp, DEFAULT_PARAMS);
    expect(result.verdict).toBe("pass");
  });

  /**
   * Item 31: Status 200 + headers different case → pass (case-fold to LOWER, DD-5).
   */
  it("returns pass when response header names differ in case 'AUTHORIZATION,content-type' (DD-5)", () => {
    const resp = makeResp(200, {
      "access-control-allow-origin": "https://app.example.com",
      "access-control-allow-methods": "GET,POST,PUT",
      "access-control-allow-headers": "AUTHORIZATION,CONTENT-TYPE",
    });
    const result = corsPreflightVerdict(resp, DEFAULT_PARAMS);
    expect(result.verdict).toBe("pass");
  });

  /**
   * Item 35: Wildcard allow_origins ["*"] + response "*" → pass (DD-3).
   */
  it("returns pass when allow_origins is ['*'] and response has Access-Control-Allow-Origin: *", () => {
    const params = makeParams(["*"], ["GET"], []);
    const resp = makeResp(200, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET",
    });
    const result = corsPreflightVerdict(resp, params);
    expect(result.verdict).toBe("pass");
  });

  /**
   * Item 36: Wildcard allow_origins ["*"] + response echoes origin → pass (DD-3 echo case).
   */
  it("returns pass when allow_origins is ['*'] and response echoes the sent origin (DD-3)", () => {
    // When allow_origins is ["*"], the sent Origin is "*", but many servers
    // echo the origin with credentials. Per DD-3, acceptable = {"*"} + {sent_origin}.
    // Since sent_origin IS "*", acceptable = {"*"}. The only echo case that passes is "*".
    // NOTE: The design says "acceptable = new Set([sent_origin]) plus '*' when sent_origin === '*'",
    // so acceptable = {"*"} in this case. An actual echoed origin "https://example.com" would
    // only pass if the implementation interprets DD-3 echo differently.
    // This test covers the case where the server echoes * (which is the sent value).
    const params = makeParams(["*"], ["GET"], []);
    const resp = makeResp(200, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET",
    });
    const result = corsPreflightVerdict(resp, params);
    expect(result.verdict).toBe("pass");
  });

  /**
   * Item 42: allow_headers empty in params → pass even without Access-Control-Allow-Headers
   * in response (DD-5 skip check).
   */
  it("returns pass when allow_headers is empty and response has no Access-Control-Allow-Headers (DD-5)", () => {
    const params = makeParams(["https://app.example.com"], ["GET"], []);
    const resp = makeResp(200, {
      "access-control-allow-origin": "https://app.example.com",
      "access-control-allow-methods": "GET",
      // No access-control-allow-headers — OK because allow_headers is empty
    });
    const result = corsPreflightVerdict(resp, params);
    expect(result.verdict).toBe("pass");
  });
});

// ---------------------------------------------------------------------------
// Status failures (DD-6) — checks BEFORE header checks
// ---------------------------------------------------------------------------

describe("corsPreflightVerdict — status failures (DD-6)", () => {

  /**
   * Item 32: Status 201 → fail with status-message.
   */
  it("returns fail with exact reason when status is 201 (not 200 or 204)", () => {
    const result = corsPreflightVerdict(
      makeResp(201, PASS_RESP_HEADERS),
      DEFAULT_PARAMS,
    );
    expect(result.verdict).toBe("fail");
    expect(result.reason).toBe("cors_preflight: expected status 200 or 204, got 201");
  });

  it("returns fail with exact reason when status is 403", () => {
    const result = corsPreflightVerdict(
      makeResp(403, PASS_RESP_HEADERS),
      DEFAULT_PARAMS,
    );
    expect(result.verdict).toBe("fail");
    expect(result.reason).toBe("cors_preflight: expected status 200 or 204, got 403");
  });

  it("returns fail with exact reason when status is 500", () => {
    const result = corsPreflightVerdict(
      makeResp(500, PASS_RESP_HEADERS),
      DEFAULT_PARAMS,
    );
    expect(result.verdict).toBe("fail");
    expect(result.reason).toBe("cors_preflight: expected status 200 or 204, got 500");
  });

  /**
   * Item 44: Short-circuit ordering — status 500 + missing all headers → status reason only.
   */
  it("reports status failure reason only (not header failure) when both status and headers fail (DD-6 short-circuit)", () => {
    const result = corsPreflightVerdict(
      makeResp(500, {}), // no CORS headers at all
      DEFAULT_PARAMS,
    );
    expect(result.verdict).toBe("fail");
    expect(result.reason).toBe("cors_preflight: expected status 200 or 204, got 500");
    expect(result.reason).not.toContain("missing Access-Control-Allow-Origin");
  });
});

// ---------------------------------------------------------------------------
// Access-Control-Allow-Origin failures (DD-3)
// ---------------------------------------------------------------------------

describe("corsPreflightVerdict — Access-Control-Allow-Origin failures", () => {

  /**
   * Item 33: Status 200 + missing Access-Control-Allow-Origin → fail.
   */
  it("returns fail with exact reason when Access-Control-Allow-Origin header is absent", () => {
    const resp = makeResp(200, {
      "access-control-allow-methods": "GET,POST,PUT",
      "access-control-allow-headers": "Authorization,Content-Type",
      // No access-control-allow-origin
    });
    const result = corsPreflightVerdict(resp, DEFAULT_PARAMS);
    expect(result.verdict).toBe("fail");
    expect(result.reason).toBe(
      "cors_preflight: response missing Access-Control-Allow-Origin header",
    );
  });

  /**
   * Item 34: Status 200 + wrong origin → fail with diff message.
   */
  it("returns fail with diff reason when ACAO header doesn't match expected origin", () => {
    const resp = makeResp(200, {
      "access-control-allow-origin": "https://other.com",
      "access-control-allow-methods": "GET,POST,PUT",
      "access-control-allow-headers": "Authorization,Content-Type",
    });
    const result = corsPreflightVerdict(resp, DEFAULT_PARAMS);
    expect(result.verdict).toBe("fail");
    expect(result.reason).toBe(
      "cors_preflight: Access-Control-Allow-Origin 'https://other.com' doesn't match expected 'https://app.example.com'",
    );
  });

  it("includes the actual and expected values verbatim in the diff message", () => {
    const params = makeParams(["https://trusted.example.com"], ["GET"], []);
    const resp = makeResp(200, {
      "access-control-allow-origin": "https://evil.example.com",
      "access-control-allow-methods": "GET",
    });
    const result = corsPreflightVerdict(resp, params);
    expect(result.reason).toContain("'https://evil.example.com'");
    expect(result.reason).toContain("'https://trusted.example.com'");
  });

  /**
   * Item 37: Multi-origin allow_origins + response "*" → fail (DD-3: multi-list MUST echo).
   */
  it("returns fail when multi-origin allow_origins and response is '*' (DD-3 multi-list rule)", () => {
    const params = makeParams(
      ["https://a.com", "https://b.com"],
      ["GET"],
      [],
    );
    const resp = makeResp(200, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET",
    });
    const result = corsPreflightVerdict(resp, params);
    expect(result.verdict).toBe("fail");
    // The expected value is allow_origins[0] = "https://a.com"
    expect(result.reason).toContain("https://a.com");
  });

  /**
   * ACAO check fires before ACAM check.
   */
  it("reports ACAO failure (not ACAM failure) when both origin and methods fail", () => {
    const resp = makeResp(200, {
      // No ACAO header; methods also absent
    });
    const result = corsPreflightVerdict(resp, DEFAULT_PARAMS);
    expect(result.reason).toContain("Access-Control-Allow-Origin");
    expect(result.reason).not.toContain("Access-Control-Allow-Methods");
  });
});

// ---------------------------------------------------------------------------
// Access-Control-Allow-Methods failures (DD-4)
// ---------------------------------------------------------------------------

describe("corsPreflightVerdict — Access-Control-Allow-Methods failures", () => {

  /**
   * Item 38: Status 200 + valid origin + missing ACAM header → fail.
   */
  it("returns fail with exact reason when Access-Control-Allow-Methods header is absent", () => {
    const resp = makeResp(200, {
      "access-control-allow-origin": "https://app.example.com",
      "access-control-allow-headers": "Authorization,Content-Type",
      // No access-control-allow-methods
    });
    const result = corsPreflightVerdict(resp, DEFAULT_PARAMS);
    expect(result.verdict).toBe("fail");
    expect(result.reason).toBe(
      "cors_preflight: response missing Access-Control-Allow-Methods header",
    );
  });

  /**
   * Item 39: Status 200 + valid origin + methods subset "GET,POST" (missing PUT) → fail.
   */
  it("returns fail when methods response is a subset of declared methods (missing PUT)", () => {
    const resp = makeResp(200, {
      "access-control-allow-origin": "https://app.example.com",
      "access-control-allow-methods": "GET,POST",  // PUT is missing
      "access-control-allow-headers": "Authorization,Content-Type",
    });
    const result = corsPreflightVerdict(resp, DEFAULT_PARAMS);
    expect(result.verdict).toBe("fail");
    expect(result.reason).toBe(
      "cors_preflight: Access-Control-Allow-Methods missing required: PUT",
    );
  });

  /**
   * Item 40: Multiple methods missing → reason lists all in declaration order.
   */
  it("lists all missing methods in declaration order when multiple are absent", () => {
    const params = makeParams(
      ["https://app.example.com"],
      ["GET", "POST", "PUT"],
      [],
    );
    const resp = makeResp(200, {
      "access-control-allow-origin": "https://app.example.com",
      "access-control-allow-methods": "GET",  // POST and PUT missing
    });
    const result = corsPreflightVerdict(resp, params);
    expect(result.verdict).toBe("fail");
    expect(result.reason).toBe(
      "cors_preflight: Access-Control-Allow-Methods missing required: POST,PUT",
    );
  });

  it("returns fail when Access-Control-Allow-Methods response value is empty string", () => {
    const resp = makeResp(200, {
      "access-control-allow-origin": "https://app.example.com",
      "access-control-allow-methods": "",  // empty
      "access-control-allow-headers": "Authorization",
    });
    const params = makeParams(["https://app.example.com"], ["GET"], ["Authorization"]);
    const result = corsPreflightVerdict(resp, params);
    expect(result.verdict).toBe("fail");
    expect(result.reason).toContain("Access-Control-Allow-Methods missing required");
    expect(result.reason).toContain("GET");
  });

  /**
   * ACAM check fires before ACAH check.
   */
  it("reports ACAM failure (not ACAH failure) when both methods and headers fail", () => {
    const resp = makeResp(200, {
      "access-control-allow-origin": "https://app.example.com",
      // No ACAM; no ACAH
    });
    const result = corsPreflightVerdict(resp, DEFAULT_PARAMS);
    expect(result.reason).toContain("Access-Control-Allow-Methods");
    expect(result.reason).not.toContain("Access-Control-Allow-Headers");
  });
});

// ---------------------------------------------------------------------------
// Access-Control-Allow-Headers failures (DD-5)
// ---------------------------------------------------------------------------

describe("corsPreflightVerdict — Access-Control-Allow-Headers failures", () => {

  /**
   * Item 41: Status 200 + valid origin + valid methods + missing ACAH header
   *          when allow_headers is non-empty → fail.
   */
  it("returns fail with exact reason when ACAH header is absent and allow_headers is non-empty", () => {
    const resp = makeResp(200, {
      "access-control-allow-origin": "https://app.example.com",
      "access-control-allow-methods": "GET,POST,PUT",
      // No access-control-allow-headers — but params.allow_headers is non-empty
    });
    const result = corsPreflightVerdict(resp, DEFAULT_PARAMS);
    expect(result.verdict).toBe("fail");
    expect(result.reason).toBe(
      "cors_preflight: response missing Access-Control-Allow-Headers header",
    );
  });

  /**
   * Item 43: Status 200 + valid origin + valid methods + ACAH present but empty value
   *          → fail (csvSetMissing returns full list).
   */
  it("returns fail when ACAH header value is empty string (csvSetMissing returns full list)", () => {
    const resp = makeResp(200, {
      "access-control-allow-origin": "https://app.example.com",
      "access-control-allow-methods": "GET,POST,PUT",
      "access-control-allow-headers": "",  // present but empty
    });
    const result = corsPreflightVerdict(resp, DEFAULT_PARAMS);
    expect(result.verdict).toBe("fail");
    expect(result.reason).toContain("Access-Control-Allow-Headers missing required");
  });

  it("returns fail when ACAH header is missing a required header entry", () => {
    const resp = makeResp(200, {
      "access-control-allow-origin": "https://app.example.com",
      "access-control-allow-methods": "GET,POST,PUT",
      "access-control-allow-headers": "Content-Type",  // Authorization missing
    });
    const result = corsPreflightVerdict(resp, DEFAULT_PARAMS);
    expect(result.verdict).toBe("fail");
    expect(result.reason).toBe(
      "cors_preflight: Access-Control-Allow-Headers missing required: Authorization",
    );
  });

  it("lists all missing headers in declaration order when multiple are absent", () => {
    const params = makeParams(
      ["https://app.example.com"],
      ["GET"],
      ["Authorization", "Content-Type", "X-Request-Id"],
    );
    const resp = makeResp(200, {
      "access-control-allow-origin": "https://app.example.com",
      "access-control-allow-methods": "GET",
      "access-control-allow-headers": "authorization",  // only authorization present
    });
    const result = corsPreflightVerdict(resp, params);
    expect(result.verdict).toBe("fail");
    expect(result.reason).toBe(
      "cors_preflight: Access-Control-Allow-Headers missing required: Content-Type,X-Request-Id",
    );
  });
});

// ---------------------------------------------------------------------------
// No-throw safety
// ---------------------------------------------------------------------------

describe("corsPreflightVerdict — does not throw", () => {
  it("does not throw when response has no headers at all", () => {
    const resp: ResponseRecord = {
      status: 200,
      headers: {},
      body: null,
      time_ms: 1,
    };
    expect(() => corsPreflightVerdict(resp, DEFAULT_PARAMS)).not.toThrow();
  });

  it("does not throw for the minimal passing case", () => {
    const params = makeParams(["https://a.com"], ["GET"], []);
    const resp = makeResp(200, {
      "access-control-allow-origin": "https://a.com",
      "access-control-allow-methods": "GET",
    });
    expect(() => corsPreflightVerdict(resp, params)).not.toThrow();
  });
});
