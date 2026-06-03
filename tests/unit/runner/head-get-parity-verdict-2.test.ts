/**
 * Unit tests for headGetParityVerdict — part 2 (header comparison).
 *
 * Covers: header parity failures, ignored-header pass cases, missing-key diff
 * messages, case-insensitive key comparison (DD-5).
 *
 * Pins the following design decisions (v1.0.2-pr3-head-get-parity.md):
 *   DD-5  Header comparison is case-insensitive: comparator lowercases keys at
 *         iteration time even when ResponseRecord.headers is already lowercase.
 *   DD-9  vary, content-type, cache-control are NOT ignored (must match).
 *         date, set-cookie, etag, content-length are ignored.
 *   DD-10 First diverging header is reported; further diffs not enumerated.
 *
 * Part 1 (IGNORED_PARITY_HEADERS set membership + status/body failures) lives
 * in head-get-parity-verdict.test.ts.
 *
 * Category: Unit — header comparison branch coverage.
 * Expected initial failure: Cannot find module 'parity-headers.js' or
 *   'headGetParityVerdict' not exported from case-runners.js.
 */

import { describe, it, expect } from "vitest";

import {
  headGetParityVerdict,
} from "../../../src/runner/execute/case-runners.js";
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
// Header parity violations (non-ignored headers)
// ---------------------------------------------------------------------------

describe("headGetParityVerdict — header parity failures", () => {
  it("fails when 'vary' is on GET but absent on HEAD (vary is NOT ignored)", () => {
    const head = makeResp(200, null, { "content-type": "application/json" });
    const get = makeResp(200, { id: 1 }, {
      "content-type": "application/json",
      "vary": "Accept-Encoding",
    });
    const result = headGetParityVerdict(head, get);
    expect(result.verdict).toBe("fail");
    expect(result.reason).toMatch(/parity|header/i);
  });

  it("fails when 'content-type' differs between HEAD and GET", () => {
    const head = makeResp(200, null, { "content-type": "application/json" });
    const get = makeResp(200, { id: 1 }, { "content-type": "text/plain" });
    const result = headGetParityVerdict(head, get);
    expect(result.verdict).toBe("fail");
  });

  it("fails with 'missing on GET' diff when HEAD has extra non-ignored header", () => {
    const head = makeResp(200, null, {
      "content-type": "application/json",
      "x-custom": "abc",
    });
    const get = makeResp(200, { id: 1 }, {
      "content-type": "application/json",
    });
    const result = headGetParityVerdict(head, get);
    expect(result.verdict).toBe("fail");
    expect(result.reason).toContain("missing");
  });

  it("fails with 'missing on HEAD' diff when GET has extra non-ignored header", () => {
    const head = makeResp(200, null, { "content-type": "application/json" });
    const get = makeResp(200, { id: 1 }, {
      "content-type": "application/json",
      "x-custom": "abc",
    });
    const result = headGetParityVerdict(head, get);
    expect(result.verdict).toBe("fail");
    expect(result.reason).toContain("missing");
  });
});

// ---------------------------------------------------------------------------
// Ignored headers → pass
// ---------------------------------------------------------------------------

describe("headGetParityVerdict — ignored headers produce no failure", () => {
  it("passes when only 'date' differs (date is ignored)", () => {
    const head = makeResp(200, null, {
      "content-type": "application/json",
      "date": "Wed, 01 Jan 2026 00:00:00 GMT",
    });
    const get = makeResp(200, { id: 1 }, {
      "content-type": "application/json",
      "date": "Thu, 02 Jan 2026 00:00:00 GMT",
    });
    const result = headGetParityVerdict(head, get);
    expect(result.verdict).toBe("pass");
  });

  it("passes when 'set-cookie' differs (set-cookie is ignored)", () => {
    const head = makeResp(200, null, {
      "content-type": "application/json",
      "set-cookie": "session=abc; Path=/",
    });
    const get = makeResp(200, { id: 1 }, {
      "content-type": "application/json",
      "set-cookie": "session=xyz; Path=/",
    });
    const result = headGetParityVerdict(head, get);
    expect(result.verdict).toBe("pass");
  });

  it("passes when 'etag' differs (etag is ignored)", () => {
    const head = makeResp(200, null, {
      "content-type": "application/json",
      "etag": "W/\"abc\"",
    });
    const get = makeResp(200, { id: 1 }, {
      "content-type": "application/json",
      "etag": "\"xyz\"",
    });
    const result = headGetParityVerdict(head, get);
    expect(result.verdict).toBe("pass");
  });

  it("passes when 'content-length' is missing on HEAD but present on GET (ignored)", () => {
    const head = makeResp(200, null, { "content-type": "application/json" });
    const get = makeResp(200, { id: 1 }, {
      "content-type": "application/json",
      "content-length": "12",
    });
    const result = headGetParityVerdict(head, get);
    expect(result.verdict).toBe("pass");
  });
});

// ---------------------------------------------------------------------------
// Case-insensitive header comparison (DD-5)
// ---------------------------------------------------------------------------

describe("headGetParityVerdict — case-insensitive header key comparison (DD-5)", () => {
  it("treats 'Content-Type' and 'content-type' as the same key", () => {
    const head: ResponseRecord = {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: null,
      time_ms: 1,
    };
    const get: ResponseRecord = {
      status: 200,
      headers: { "content-type": "application/json" },
      body: { id: 1 },
      time_ms: 1,
    };
    const result = headGetParityVerdict(head, get);
    expect(result.verdict).toBe("pass");
  });

  it("passes when both sides use matching mixed-case keys that normalize to the same value", () => {
    const head: ResponseRecord = {
      status: 200,
      headers: { "X-Custom-Header": "value" },
      body: null,
      time_ms: 1,
    };
    const get: ResponseRecord = {
      status: 200,
      headers: { "x-custom-header": "value" },
      body: { id: 1 },
      time_ms: 1,
    };
    const result = headGetParityVerdict(head, get);
    expect(result.verdict).toBe("pass");
  });
});
