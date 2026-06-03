/**
 * Unit tests for conditionalGet304Verdict.
 *
 * Pins the following design decisions (v1.0.2-pr4-etag-conditional-get.md):
 *   DD-2  Echo ETag verbatim — weak 'W/"v1"' is NOT stripped; server echoes
 *         exactly what was sent. Case-sensitive string comparison.
 *   DD-3  Second response must be EXACTLY 304 — 200 is FAIL, not pass.
 *   DD-4  304 MUST carry an ETag header matching the first response's ETag.
 *   DD-5  304 body MUST be empty (null | undefined | ""); numeric zero,
 *         {}, [], strings like "x" are NOT empty.
 *   DD-8  Cache-Control: no-store does NOT suppress the verdict logic.
 *
 * Failure-reason templates verified exactly (locked in design §7):
 *   "conditional_get_304: first response missing ETag header (etag_supported: true)"
 *   "conditional_get_304: expected 304 Not Modified on second request, got <N>"
 *   "conditional_get_304: 304 response missing ETag header"
 *   "conditional_get_304: 304 ETag '<got>' does not match first response ETag '<expected>'"
 *   "conditional_get_304: 304 response body is not empty"
 *
 * Covers all 8 verdict unit tests from the design outline §8 Layer 1.
 *
 * NOTE: The verdict function does NOT receive a missing-ETag case directly —
 * that failure is raised by maybeRunConditionalGet before the second request
 * is issued. The verdict function only evaluates the second response.
 *
 * Category: Unit.
 * Expected initial failure: 'conditionalGet304Verdict' is not exported from
 *   '../../../src/runner/execute/case-runners.js'
 */

import { describe, it, expect } from "vitest";

import { conditionalGet304Verdict } from "../../../src/runner/execute/case-runners.js";
import type { ResponseRecord } from "../../../src/runner/types.js";

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function makeResp(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): ResponseRecord {
  return {
    status,
    headers: { "content-type": "application/json", ...headers },
    body,
    time_ms: 1,
  };
}

// ---------------------------------------------------------------------------
// Pass paths
// ---------------------------------------------------------------------------

describe("conditionalGet304Verdict — pass paths", () => {

  /**
   * Test 1: first 200 + ETag "v1", second 304 + ETag "v1" + undefined body → pass.
   */
  it("returns pass when second is 304 with matching ETag and undefined body", () => {
    const first = makeResp(200, { id: 1 }, { etag: '"v1"' });
    const second = makeResp(304, undefined, { etag: '"v1"' });
    const result = conditionalGet304Verdict(first, second);
    expect(result.verdict).toBe("pass");
  });

  /**
   * Test 2: weak ETag W/"v1" echoed verbatim → pass (DD-2).
   */
  it("returns pass when weak ETag W/'v1' is echoed verbatim on the 304 (DD-2)", () => {
    const first = makeResp(200, { id: 1 }, { etag: 'W/"v1"' });
    const second = makeResp(304, null, { etag: 'W/"v1"' });
    const result = conditionalGet304Verdict(first, second);
    expect(result.verdict).toBe("pass");
  });

  /**
   * Test 8 (from design): second 304 + ETag + body "" → pass (empty string is empty per DD-5).
   */
  it("returns pass when 304 body is empty string '' (counts as empty per DD-5)", () => {
    const first = makeResp(200, { id: 1 }, { etag: '"v1"' });
    const second = makeResp(304, "", { etag: '"v1"' });
    const result = conditionalGet304Verdict(first, second);
    expect(result.verdict).toBe("pass");
  });

  /**
   * 304 body is null → pass.
   */
  it("returns pass when 304 body is null (counts as empty per DD-5)", () => {
    const first = makeResp(200, { id: 1 }, { etag: '"abc"' });
    const second = makeResp(304, null, { etag: '"abc"' });
    const result = conditionalGet304Verdict(first, second);
    expect(result.verdict).toBe("pass");
  });
});

// ---------------------------------------------------------------------------
// Status check failures (DD-3)
// ---------------------------------------------------------------------------

describe("conditionalGet304Verdict — status ≠ 304 → fail (DD-3)", () => {

  /**
   * Test 4 (from design): second response is 200 → fail.
   */
  it("returns fail with exact reason when second response is 200 not 304", () => {
    const first = makeResp(200, { id: 1 }, { etag: '"v1"' });
    const second = makeResp(200, { id: 1 }, { etag: '"v1"' });
    const result = conditionalGet304Verdict(first, second);
    expect(result.verdict).toBe("fail");
    expect(result.reason).toBe(
      "conditional_get_304: expected 304 Not Modified on second request, got 200",
    );
  });

  /**
   * Test (not from outline but covers the 500 case in design §6 item 18).
   */
  it("returns fail with reason containing the actual status code when second is 500", () => {
    const first = makeResp(200, { id: 1 }, { etag: '"v1"' });
    const second = makeResp(500, { error: "boom" });
    const result = conditionalGet304Verdict(first, second);
    expect(result.verdict).toBe("fail");
    expect(result.reason).toBe(
      "conditional_get_304: expected 304 Not Modified on second request, got 500",
    );
  });

  it("returns fail when second response is 301 (redirect, not 304)", () => {
    const first = makeResp(200, null, { etag: '"v1"' });
    const second = makeResp(301, null, { location: "/new" });
    const result = conditionalGet304Verdict(first, second);
    expect(result.verdict).toBe("fail");
    expect(result.reason).toContain("got 301");
  });
});

// ---------------------------------------------------------------------------
// ETag echo check failures (DD-4)
// ---------------------------------------------------------------------------

describe("conditionalGet304Verdict — ETag echo failures (DD-4)", () => {

  /**
   * Test 5 (from design): second 304 with NO ETag → fail.
   */
  it("returns fail with exact reason when 304 carries no ETag header", () => {
    const first = makeResp(200, null, { etag: '"v1"' });
    // second has no etag header
    const second = makeResp(304, null, {});
    const result = conditionalGet304Verdict(first, second);
    expect(result.verdict).toBe("fail");
    expect(result.reason).toBe("conditional_get_304: 304 response missing ETag header");
  });

  /**
   * Test 6 (from design): ETag mismatch "a" vs "b" → fail with exact reason.
   */
  it("returns fail with quoted ETag values when 304 ETag differs from first", () => {
    const first = makeResp(200, null, { etag: '"a"' });
    const second = makeResp(304, null, { etag: '"b"' });
    const result = conditionalGet304Verdict(first, second);
    expect(result.verdict).toBe("fail");
    expect(result.reason).toBe(
      "conditional_get_304: 304 ETag '\"b\"' does not match first response ETag '\"a\"'",
    );
  });

  /**
   * Case-sensitive comparison: "abc" vs "ABC" → fail (DD-2, ETag comparison is exact).
   */
  it("treats ETag comparison as case-sensitive ('abc' ≠ 'ABC')", () => {
    const first = makeResp(200, null, { etag: '"abc"' });
    const second = makeResp(304, null, { etag: '"ABC"' });
    const result = conditionalGet304Verdict(first, second);
    expect(result.verdict).toBe("fail");
    expect(result.reason).toContain('"ABC"');
    expect(result.reason).toContain('"abc"');
  });

  /**
   * Server strips W/ prefix: first has W/"abc", second has "abc" → fail (verbatim echo, DD-2).
   */
  it("fails when server strips W/ prefix on 304 (server must echo verbatim per DD-2)", () => {
    const first = makeResp(200, null, { etag: 'W/"abc"' });
    const second = makeResp(304, null, { etag: '"abc"' });
    const result = conditionalGet304Verdict(first, second);
    expect(result.verdict).toBe("fail");
  });

  it("returns fail when 304 ETag is an empty string (treated as missing)", () => {
    const first = makeResp(200, null, { etag: '"v1"' });
    const second = makeResp(304, null, { etag: "" });
    const result = conditionalGet304Verdict(first, second);
    expect(result.verdict).toBe("fail");
    // Empty ETag is treated as missing → missing ETag reason
    expect(result.reason).toBe("conditional_get_304: 304 response missing ETag header");
  });
});

// ---------------------------------------------------------------------------
// Body emptiness failures (DD-5)
// ---------------------------------------------------------------------------

describe("conditionalGet304Verdict — 304 body non-empty → fail (DD-5)", () => {

  /**
   * Test 7 (from design): second 304 + matching ETag + body "x" → fail.
   */
  it("returns fail with exact reason when 304 body is a non-empty string 'x'", () => {
    const first = makeResp(200, null, { etag: '"v1"' });
    const second = makeResp(304, "x", { etag: '"v1"' });
    const result = conditionalGet304Verdict(first, second);
    expect(result.verdict).toBe("fail");
    expect(result.reason).toBe("conditional_get_304: 304 response body is not empty");
  });

  it("returns fail when 304 body is an object {} (not empty per DD-5)", () => {
    const first = makeResp(200, null, { etag: '"v1"' });
    const second = makeResp(304, {}, { etag: '"v1"' });
    const result = conditionalGet304Verdict(first, second);
    expect(result.verdict).toBe("fail");
    expect(result.reason).toBe("conditional_get_304: 304 response body is not empty");
  });

  it("returns fail when 304 body is an empty array [] (not empty per DD-5)", () => {
    const first = makeResp(200, null, { etag: '"v1"' });
    const second = makeResp(304, [], { etag: '"v1"' });
    const result = conditionalGet304Verdict(first, second);
    expect(result.verdict).toBe("fail");
    expect(result.reason).toBe("conditional_get_304: 304 response body is not empty");
  });

  it("returns fail when 304 body is numeric zero 0 (not empty per DD-5)", () => {
    const first = makeResp(200, null, { etag: '"v1"' });
    const second = makeResp(304, 0, { etag: '"v1"' });
    const result = conditionalGet304Verdict(first, second);
    expect(result.verdict).toBe("fail");
    expect(result.reason).toBe("conditional_get_304: 304 response body is not empty");
  });
});

// ---------------------------------------------------------------------------
// Verdict check ordering (status checked before ETag, ETag before body)
// ---------------------------------------------------------------------------

describe("conditionalGet304Verdict — check ordering", () => {
  it("reports status failure (not ETag failure) when both status and ETag are wrong", () => {
    const first = makeResp(200, null, { etag: '"v1"' });
    // status is 200 (not 304) AND etag differs — status check fires first
    const second = makeResp(200, null, { etag: '"v2"' });
    const result = conditionalGet304Verdict(first, second);
    expect(result.verdict).toBe("fail");
    expect(result.reason).toContain("expected 304");
  });

  it("reports ETag-missing failure (not body failure) when 304 but no ETag and non-empty body", () => {
    const first = makeResp(200, null, { etag: '"v1"' });
    // status is correct 304, ETag absent, body is non-empty
    const second = makeResp(304, "should not matter", {});
    const result = conditionalGet304Verdict(first, second);
    expect(result.verdict).toBe("fail");
    expect(result.reason).toBe("conditional_get_304: 304 response missing ETag header");
  });
});

// ---------------------------------------------------------------------------
// No-throw safety (design §6 item 26)
// ---------------------------------------------------------------------------

describe("conditionalGet304Verdict — does not throw", () => {
  it("does not throw when both response bodies are null", () => {
    const first = makeResp(200, null, { etag: '"v1"' });
    const second = makeResp(304, null, { etag: '"v1"' });
    expect(() => conditionalGet304Verdict(first, second)).not.toThrow();
  });

  it("does not throw when both response bodies are undefined", () => {
    const first = makeResp(200, undefined, { etag: '"v1"' });
    const second = makeResp(304, undefined, { etag: '"v1"' });
    expect(() => conditionalGet304Verdict(first, second)).not.toThrow();
  });

  it("does not throw when second response has no headers at all", () => {
    const first = makeResp(200, null, { etag: '"v1"' });
    const second: ResponseRecord = {
      status: 304,
      headers: {},
      body: null,
      time_ms: 1,
    };
    expect(() => conditionalGet304Verdict(first, second)).not.toThrow();
  });
});
