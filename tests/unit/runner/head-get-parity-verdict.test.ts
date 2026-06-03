/**
 * Unit tests for headGetParityVerdict and IGNORED_PARITY_HEADERS — part 1.
 *
 * Covers: IGNORED_PARITY_HEADERS set membership and the headGetParityVerdict
 * pass/fail paths for status mismatch and HEAD body emptiness (DD-4).
 *
 * Pins the following design decisions (v1.0.2-pr3-head-get-parity.md):
 *   DD-4  HEAD body empty = null | undefined | "" only.
 *         {}, [], 0 are NOT empty — they indicate RFC-non-compliant HEAD.
 *   DD-9  IGNORED_PARITY_HEADERS minimum locked members:
 *         content-length, transfer-encoding, date, set-cookie, etag.
 *         NOT ignored: vary, content-type, cache-control.
 *
 * Part 2 (header parity, missing-key diffs, case-insensitivity) lives in
 * head-get-parity-verdict-2.test.ts to stay within the 300 LOC soft limit.
 *
 * Category: Unit — covers IGNORED_PARITY_HEADERS tests + verdict status/body tests.
 * Expected initial failure: Cannot find module 'parity-headers.js' or
 *   'headGetParityVerdict' not exported from case-runners.js.
 */

import { describe, it, expect } from "vitest";

import {
  headGetParityVerdict,
} from "../../../src/runner/execute/case-runners.js";
import { IGNORED_PARITY_HEADERS } from "../../../src/runner/execute/parity-headers.js";
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
// IGNORED_PARITY_HEADERS set membership (design decision DD-9)
// ---------------------------------------------------------------------------

describe("IGNORED_PARITY_HEADERS", () => {
  it("contains 'content-length'", () => {
    expect(IGNORED_PARITY_HEADERS.has("content-length")).toBe(true);
  });

  it("contains 'transfer-encoding'", () => {
    expect(IGNORED_PARITY_HEADERS.has("transfer-encoding")).toBe(true);
  });

  it("contains 'date'", () => {
    expect(IGNORED_PARITY_HEADERS.has("date")).toBe(true);
  });

  it("contains 'set-cookie'", () => {
    expect(IGNORED_PARITY_HEADERS.has("set-cookie")).toBe(true);
  });

  it("contains 'etag'", () => {
    expect(IGNORED_PARITY_HEADERS.has("etag")).toBe(true);
  });

  it("does NOT contain 'vary' (must match per RFC 7231 §4.3.2)", () => {
    expect(IGNORED_PARITY_HEADERS.has("vary")).toBe(false);
  });

  it("does NOT contain 'content-type' (must match per RFC 7231 §4.3.2)", () => {
    expect(IGNORED_PARITY_HEADERS.has("content-type")).toBe(false);
  });

  it("does NOT contain 'cache-control' (must match per RFC 7231 §4.3.2)", () => {
    expect(IGNORED_PARITY_HEADERS.has("cache-control")).toBe(false);
  });

  it("is iterable and has .has()", () => {
    expect(typeof IGNORED_PARITY_HEADERS.has).toBe("function");
    expect(typeof IGNORED_PARITY_HEADERS[Symbol.iterator]).toBe("function");
  });

  it("all members are lowercase strings", () => {
    for (const member of IGNORED_PARITY_HEADERS) {
      expect(member).toBe(member.toLowerCase());
    }
  });
});

// ---------------------------------------------------------------------------
// headGetParityVerdict — pass path
// ---------------------------------------------------------------------------

describe("headGetParityVerdict — pass path", () => {
  it("returns pass when status matches, HEAD body is null, and headers are identical", () => {
    const head = makeResp(200, null, { "content-type": "application/json" });
    const get = makeResp(200, { id: 1 }, { "content-type": "application/json" });
    const result = headGetParityVerdict(head, get);
    expect(result.verdict).toBe("pass");
  });

  it("returns pass when HEAD body is undefined", () => {
    const head = makeResp(200, undefined, { "content-type": "application/json" });
    const get = makeResp(200, { id: 1 }, { "content-type": "application/json" });
    const result = headGetParityVerdict(head, get);
    expect(result.verdict).toBe("pass");
  });

  it("returns pass when HEAD body is empty string ''", () => {
    const head = makeResp(200, "", { "content-type": "application/json" });
    const get = makeResp(200, { id: 1 }, { "content-type": "application/json" });
    const result = headGetParityVerdict(head, get);
    expect(result.verdict).toBe("pass");
  });
});

// ---------------------------------------------------------------------------
// headGetParityVerdict — status-mismatch failures
// ---------------------------------------------------------------------------

describe("headGetParityVerdict — status mismatch → fail", () => {
  it("fails with reason containing both status codes when HEAD 200 and GET 204", () => {
    const head = makeResp(200, null);
    const get = makeResp(204, null);
    const result = headGetParityVerdict(head, get);
    expect(result.verdict).toBe("fail");
    expect(result.reason).toMatch(/status/i);
    expect(result.reason).toContain("200");
    expect(result.reason).toContain("204");
  });

  it("fails when HEAD 200 and GET 500 (server error on second request)", () => {
    const head = makeResp(200, null);
    const get = makeResp(500, { error: "server error" });
    const result = headGetParityVerdict(head, get);
    expect(result.verdict).toBe("fail");
    expect(result.reason).toMatch(/status/i);
  });
});

// ---------------------------------------------------------------------------
// headGetParityVerdict — HEAD body non-empty → fail (DD-4)
// ---------------------------------------------------------------------------

describe("headGetParityVerdict — HEAD body non-empty → fail (DD-4)", () => {
  it("fails when HEAD body is a non-empty string (RFC-violating HEAD)", () => {
    const head = makeResp(200, "x");
    const get = makeResp(200, { id: 1 });
    const result = headGetParityVerdict(head, get);
    expect(result.verdict).toBe("fail");
    expect(result.reason).toMatch(/HEAD.*body|body.*not.*empty/i);
  });

  it("fails when HEAD body is an object {} (not empty per DD-4)", () => {
    const head = makeResp(200, {});
    const get = makeResp(200, { id: 1 });
    const result = headGetParityVerdict(head, get);
    expect(result.verdict).toBe("fail");
  });

  it("fails when HEAD body is an empty array [] (not empty per DD-4)", () => {
    const head = makeResp(200, []);
    const get = makeResp(200, { id: 1 });
    const result = headGetParityVerdict(head, get);
    expect(result.verdict).toBe("fail");
  });

  it("fails when HEAD body is numeric zero 0 (not empty per DD-4)", () => {
    const head = makeResp(200, 0);
    const get = makeResp(200, { id: 1 });
    const result = headGetParityVerdict(head, get);
    expect(result.verdict).toBe("fail");
  });
});
