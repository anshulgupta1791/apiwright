/**
 * Unit tests for the private `csvSetMissing` helper function.
 *
 * `csvSetMissing` is module-private in the verdicts module; it is tested
 * indirectly via `corsPreflightVerdict` (the public surface that exercises it).
 * This file focuses on its DISTINCT set-comparison semantics — the cases that
 * are best expressed as direct input/output assertions — by observing the
 * verdict failure reason, which carries the `missing.join(",")` output.
 *
 * Covers §6 items 45–51 from v1.0.2-pr6-cors-preflight.md:
 *   45. "GET,POST,PUT" + required ["GET","POST"] + upper → returns [] (pass).
 *   46. "GET, POST, PUT" + required ["GET"] + upper → returns [] (trim).
 *   47. "get,post" + required ["GET","POST"] + upper → returns [] (case-fold up).
 *   48. "Authorization,Content-Type" + required ["authorization"] + lower → returns [].
 *   49. "" + required ["GET"] + upper → returns ["GET"].
 *   50. ",,GET,," + required ["GET"] + upper → returns [] (filter empties).
 *   51. "GET,POST" + required ["PUT","GET"] + upper → returns ["PUT"] (declaration order).
 *
 * The helper is invoked by corsPreflightVerdict twice: once for methods (caseFold="upper")
 * and once for headers (caseFold="lower"). We test it indirectly through
 * corsPreflightVerdict with controlled response values and assert on failure reasons.
 *
 * Category: Unit.
 * Expected initial failure: 'corsPreflightVerdict' is not exported from
 *   '../../../../src/runner/execute/case-runners.js'
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
  headers: Record<string, string>,
): ResponseRecord {
  return { status, headers, body: null, time_ms: 1 };
}

function makeParams(
  origins: readonly string[],
  methods: readonly string[],
  headers: readonly string[],
): CorsPreflightParams {
  return { kind: "cors_preflight", allow_origins: origins, allow_methods: methods, allow_headers: headers };
}

/** Returns the failure reason from corsPreflightVerdict for a methods assertion. */
function methodsFailureReason(
  responseValue: string,
  required: readonly string[],
): string | undefined {
  const params = makeParams(["https://a.com"], required, []);
  const resp = makeResp(200, {
    "access-control-allow-origin": "https://a.com",
    "access-control-allow-methods": responseValue,
  });
  return corsPreflightVerdict(resp, params).reason;
}

/** Returns the failure reason from corsPreflightVerdict for a headers assertion. */
function headersFailureReason(
  responseValue: string,
  required: readonly string[],
): string | undefined {
  const params = makeParams(["https://a.com"], ["GET"], required);
  const resp = makeResp(200, {
    "access-control-allow-origin": "https://a.com",
    "access-control-allow-methods": "GET",
    "access-control-allow-headers": responseValue,
  });
  return corsPreflightVerdict(resp, params).reason;
}

// ---------------------------------------------------------------------------
// Methods (caseFold = "upper") tests — items 45–51
// ---------------------------------------------------------------------------

describe("csvSetMissing via methods (caseFold=upper)", () => {

  /**
   * Item 45: "GET,POST,PUT" + required ["GET","POST"] → pass (superset in response).
   */
  it("item 45: 'GET,POST,PUT' contains ['GET','POST'] → verdict passes (no missing)", () => {
    const params = makeParams(["https://a.com"], ["GET", "POST"], []);
    const resp = makeResp(200, {
      "access-control-allow-origin": "https://a.com",
      "access-control-allow-methods": "GET,POST,PUT",
    });
    expect(corsPreflightVerdict(resp, params).verdict).toBe("pass");
  });

  /**
   * Item 46: "GET, POST, PUT" + required ["GET"] → pass (trim; whitespace ignored).
   */
  it("item 46: 'GET, POST, PUT' trimmed contains 'GET' → verdict passes", () => {
    const params = makeParams(["https://a.com"], ["GET"], []);
    const resp = makeResp(200, {
      "access-control-allow-origin": "https://a.com",
      "access-control-allow-methods": "GET, POST, PUT",
    });
    expect(corsPreflightVerdict(resp, params).verdict).toBe("pass");
  });

  /**
   * Item 47: "get,post" + required ["GET","POST"] → pass (case-fold both to UPPER).
   */
  it("item 47: 'get,post' case-folded to UPPER matches ['GET','POST'] → verdict passes", () => {
    const params = makeParams(["https://a.com"], ["GET", "POST"], []);
    const resp = makeResp(200, {
      "access-control-allow-origin": "https://a.com",
      "access-control-allow-methods": "get,post",
    });
    expect(corsPreflightVerdict(resp, params).verdict).toBe("pass");
  });

  /**
   * Item 49: "" + required ["GET"] → returns ["GET"] → fail naming "GET".
   */
  it("item 49: empty response value → missing=['GET'] → fail with reason containing 'GET'", () => {
    const reason = methodsFailureReason("", ["GET"]);
    expect(reason).toBeDefined();
    expect(reason).toContain("GET");
    expect(reason).toContain("Access-Control-Allow-Methods missing required");
  });

  /**
   * Item 50: ",,GET,," + required ["GET"] → filter empties → ["GET"] in set → pass.
   */
  it("item 50: ',,GET,,' with empty-entry filtering contains 'GET' → verdict passes", () => {
    const params = makeParams(["https://a.com"], ["GET"], []);
    const resp = makeResp(200, {
      "access-control-allow-origin": "https://a.com",
      "access-control-allow-methods": ",,GET,,",
    });
    expect(corsPreflightVerdict(resp, params).verdict).toBe("pass");
  });

  /**
   * Item 51: "GET,POST" + required ["PUT","GET"] → missing=["PUT"] in declaration order.
   */
  it("item 51: 'GET,POST' missing 'PUT' from ['PUT','GET'] → missing in declaration order ['PUT']", () => {
    const reason = methodsFailureReason("GET,POST", ["PUT", "GET"]);
    expect(reason).toBeDefined();
    // "PUT" must appear in reason; "GET" must NOT be in missing
    expect(reason).toContain("PUT");
    // The reason string should be exactly the format with only PUT
    expect(reason).toBe(
      "cors_preflight: Access-Control-Allow-Methods missing required: PUT",
    );
  });

  /**
   * Multiple missing entries: "GET" + required ["POST","PUT","GET"] → missing=["POST","PUT"]
   * in declaration order.
   */
  it("returns missing in declaration order when multiple methods absent", () => {
    const reason = methodsFailureReason("GET", ["POST", "PUT", "GET"]);
    expect(reason).toBe(
      "cors_preflight: Access-Control-Allow-Methods missing required: POST,PUT",
    );
  });

  /**
   * Mixed-case in both declared and response: declared=["get","Post"], response="GET,POST"
   * → after UPPER fold on both sides, both sets equal → pass.
   */
  it("case-folds declared methods to UPPER before comparing", () => {
    const params = makeParams(["https://a.com"], ["get", "Post"], []);
    const resp = makeResp(200, {
      "access-control-allow-origin": "https://a.com",
      "access-control-allow-methods": "GET,POST",
    });
    expect(corsPreflightVerdict(resp, params).verdict).toBe("pass");
  });
});

// ---------------------------------------------------------------------------
// Headers (caseFold = "lower") tests — item 48 + additional
// ---------------------------------------------------------------------------

describe("csvSetMissing via headers (caseFold=lower)", () => {

  /**
   * Item 48: "Authorization,Content-Type" + required ["authorization"] → pass.
   */
  it("item 48: 'Authorization,Content-Type' lowercased contains 'authorization' → verdict passes", () => {
    const params = makeParams(["https://a.com"], ["GET"], ["authorization"]);
    const resp = makeResp(200, {
      "access-control-allow-origin": "https://a.com",
      "access-control-allow-methods": "GET",
      "access-control-allow-headers": "Authorization,Content-Type",
    });
    expect(corsPreflightVerdict(resp, params).verdict).toBe("pass");
  });

  it("case-folds declared header names to LOWER before comparing", () => {
    // Declared in mixed case: "Authorization" — response in lowercase "authorization"
    const params = makeParams(["https://a.com"], ["GET"], ["Authorization"]);
    const resp = makeResp(200, {
      "access-control-allow-origin": "https://a.com",
      "access-control-allow-methods": "GET",
      "access-control-allow-headers": "authorization",
    });
    expect(corsPreflightVerdict(resp, params).verdict).toBe("pass");
  });

  it("returns missing headers in declaration order when absent", () => {
    const reason = headersFailureReason("authorization", ["Authorization", "Content-Type", "X-Custom"]);
    expect(reason).toBeDefined();
    // "authorization" (lowercased) is present — "content-type" and "x-custom" missing
    expect(reason).toBe(
      "cors_preflight: Access-Control-Allow-Headers missing required: Content-Type,X-Custom",
    );
  });

  it("empty header response value results in all required headers missing", () => {
    const reason = headersFailureReason("", ["Authorization", "Content-Type"]);
    expect(reason).toBeDefined();
    expect(reason).toContain("Authorization");
    expect(reason).toContain("Content-Type");
  });

  it("filter empty entries in headers response value", () => {
    const params = makeParams(["https://a.com"], ["GET"], ["Authorization"]);
    const resp = makeResp(200, {
      "access-control-allow-origin": "https://a.com",
      "access-control-allow-methods": "GET",
      "access-control-allow-headers": ",,Authorization,,",
    });
    expect(corsPreflightVerdict(resp, params).verdict).toBe("pass");
  });

  it("whitespace-trimmed headers are matched correctly", () => {
    const params = makeParams(["https://a.com"], ["GET"], ["Authorization"]);
    const resp = makeResp(200, {
      "access-control-allow-origin": "https://a.com",
      "access-control-allow-methods": "GET",
      "access-control-allow-headers": " Authorization , Content-Type ",
    });
    expect(corsPreflightVerdict(resp, params).verdict).toBe("pass");
  });
});
