import { describe, it, expect } from "vitest";

import {
  FormatEvaluator,
  RECENT_WINDOW_MS,
} from "../../../../src/assertions/operators/format-evaluator.js";
import { AjvFormatCheck } from "../../../../src/assertions/operators/ajv-format-check.js";
import type { ResolvedValue } from "../../../../src/assertions/target-resolver.js";
import type { EvaluationContext } from "../../../../src/assertions/index.js";

/**
 * Unit tests for FormatEvaluator and AjvFormatCheck.
 *
 * Covers: TARGET_NOT_FOUND on missing LHS, TYPE_MISMATCH on non-string,
 * is_uuid_v4 (shape + version nibble 4 + variant 8/9/a/b), is_email (ajv full),
 * is_url (uri scheme-required), is_iso_timestamp (date-time strict timezone),
 * is_recent_timestamp (symmetric ±RECENT_WINDOW_MS via injected context.now),
 * pass/fail shape contract, safe actual descriptors, default-seam construction,
 * determinism.
 */

function found(value: unknown): ResolvedValue {
  return { found: true, value };
}

const MISS: ResolvedValue = { found: false };

function ctx(now?: number): EvaluationContext {
  return {
    request: { headers: {}, body: null, url: { full: "/", path: "/", query: {} } },
    response: { status: 200, headers: {}, body: null, time_ms: 0 },
    db: {},
    now,
  };
}

describe("RECENT_WINDOW_MS", () => {
  it("equals 300000 (5 minutes)", () => {
    expect(RECENT_WINDOW_MS).toBe(300000);
  });
});

describe("AjvFormatCheck", () => {
  const checker = new AjvFormatCheck();

  it("constructs without throwing", () => {
    expect(() => new AjvFormatCheck()).not.toThrow();
  });

  it("isValid(uuid) returns true for a valid uuid v4 string", () => {
    expect(checker.isValid("uuid", "550e8400-e29b-41d4-a716-446655440000")).toBe(true);
  });

  it("isValid(uuid) returns false for non-uuid", () => {
    expect(checker.isValid("uuid", "not-a-uuid")).toBe(false);
  });

  it("isValid(email) returns true for a valid email", () => {
    expect(checker.isValid("email", "user@example.com")).toBe(true);
  });

  it("isValid(uri) returns true for a URI with scheme", () => {
    expect(checker.isValid("uri", "https://example.com/path")).toBe(true);
  });

  it("isValid(uri) returns false for a relative path (no scheme)", () => {
    expect(checker.isValid("uri", "/users/1")).toBe(false);
  });

  it("isValid(date-time) returns true for a valid RFC3339 date-time", () => {
    expect(checker.isValid("date-time", "2026-05-18T12:00:00Z")).toBe(true);
  });

  it("isValid(date-time) returns false for date without timezone", () => {
    expect(checker.isValid("date-time", "2026-05-18T12:00:00")).toBe(false);
  });
});

describe("FormatEvaluator", () => {
  const ev = new FormatEvaluator();
  const NOW = 1716163200000; // fixed epoch for determinism

  // ---------------------------------------------------------------------------
  // Default-seam: no-arg construction
  // ---------------------------------------------------------------------------

  describe("default-seam construction", () => {
    it("constructs with no arguments (default AjvFormatCheck seam)", () => {
      expect(() => new FormatEvaluator()).not.toThrow();
    });

    it("constructs with an explicit AjvFormatCheck instance", () => {
      expect(() => new FormatEvaluator(new AjvFormatCheck())).not.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // Shared type gate — all 5 operators
  // ---------------------------------------------------------------------------

  describe("shared type gate", () => {
    const ops = ["is_uuid_v4", "is_iso_timestamp", "is_recent_timestamp", "is_email", "is_url"] as const;

    for (const op of ops) {
      it(`${op} with found:false → TARGET_NOT_FOUND`, () => {
        const r = ev.evaluate(op, MISS, ctx(NOW));
        expect(r.pass).toBe(false);
        expect(r.failureCode).toBe("TARGET_NOT_FOUND");
        expect(String(r.actual)).toMatch(/missing|absent/i);
      });

      it(`${op} with found:true,null → TYPE_MISMATCH (explicit-null ≠ missing)`, () => {
        const r = ev.evaluate(op, found(null), ctx(NOW));
        expect(r.pass).toBe(false);
        expect(r.failureCode).toBe("TYPE_MISMATCH");
      });

      it(`${op} with found:true,number → TYPE_MISMATCH (no coercion)`, () => {
        const r = ev.evaluate(op, found(1716163200), ctx(NOW));
        expect(r.failureCode).toBe("TYPE_MISMATCH");
      });

      it(`${op} with found:true,boolean → TYPE_MISMATCH`, () => {
        const r = ev.evaluate(op, found(true), ctx(NOW));
        expect(r.failureCode).toBe("TYPE_MISMATCH");
      });
    }
  });

  // ---------------------------------------------------------------------------
  // is_uuid_v4
  // ---------------------------------------------------------------------------

  describe("is_uuid_v4", () => {
    it("passes for a valid UUID v4 (version nibble=4, variant 8)", () => {
      const r = ev.evaluate("is_uuid_v4", found("550e8400-e29b-41d4-8716-446655440000"), ctx(NOW));
      expect(r.pass).toBe(true);
    });

    it("passes for a valid UUID v4 with variant nibble 9", () => {
      const r = ev.evaluate("is_uuid_v4", found("550e8400-e29b-41d4-9716-446655440000"), ctx(NOW));
      expect(r.pass).toBe(true);
    });

    it("passes for a valid UUID v4 with variant nibble a", () => {
      const r = ev.evaluate("is_uuid_v4", found("550e8400-e29b-41d4-a716-446655440000"), ctx(NOW));
      expect(r.pass).toBe(true);
    });

    it("passes for a valid UUID v4 with variant nibble b", () => {
      const r = ev.evaluate("is_uuid_v4", found("550e8400-e29b-41d4-b716-446655440000"), ctx(NOW));
      expect(r.pass).toBe(true);
    });

    it("fails for valid UUID v1 (version nibble=1) → FORMAT_INVALID", () => {
      // v1 has version nibble = 1
      const r = ev.evaluate("is_uuid_v4", found("550e8400-e29b-11d4-a716-446655440000"), ctx(NOW));
      expect(r.pass).toBe(false);
      expect(r.failureCode).toBe("FORMAT_INVALID");
      expect(r.reason).toMatch(/version|nibble|1/i);
    });

    it("fails for UUID v4 shape but variant nibble c → FORMAT_INVALID", () => {
      const r = ev.evaluate("is_uuid_v4", found("550e8400-e29b-41d4-c716-446655440000"), ctx(NOW));
      expect(r.pass).toBe(false);
      expect(r.failureCode).toBe("FORMAT_INVALID");
      expect(r.reason).toMatch(/variant/i);
    });

    it("passes for UPPERCASE UUID v4 (case-insensitive nibble check)", () => {
      const r = ev.evaluate("is_uuid_v4", found("550E8400-E29B-41D4-A716-446655440000"), ctx(NOW));
      expect(r.pass).toBe(true);
    });

    it("passes for urn:uuid: prefixed v4 uuid", () => {
      const r = ev.evaluate(
        "is_uuid_v4",
        found("urn:uuid:550e8400-e29b-41d4-a716-446655440000"),
        ctx(NOW),
      );
      expect(r.pass).toBe(true);
    });

    it("fails for non-uuid string → FORMAT_INVALID", () => {
      const r = ev.evaluate("is_uuid_v4", found("not-a-uuid"), ctx(NOW));
      expect(r.failureCode).toBe("FORMAT_INVALID");
    });

    it("empty string → FORMAT_INVALID (type gate passes, format fails)", () => {
      const r = ev.evaluate("is_uuid_v4", found(""), ctx(NOW));
      expect(r.failureCode).toBe("FORMAT_INVALID");
    });
  });

  // ---------------------------------------------------------------------------
  // is_email
  // ---------------------------------------------------------------------------

  describe("is_email", () => {
    it("passes for a valid email", () => {
      const r = ev.evaluate("is_email", found("user@example.com"), ctx(NOW));
      expect(r.pass).toBe(true);
    });

    it("fails for email missing @ → FORMAT_INVALID", () => {
      const r = ev.evaluate("is_email", found("notanemail"), ctx(NOW));
      expect(r.failureCode).toBe("FORMAT_INVALID");
    });

    it("fails for bare domain without TLD → FORMAT_INVALID (ajv full email)", () => {
      // ajv full requires domain labels with proper structure
      const r = ev.evaluate("is_email", found("a@b"), ctx(NOW));
      expect(r.failureCode).toBe("FORMAT_INVALID");
    });
  });

  // ---------------------------------------------------------------------------
  // is_url (uri — scheme required)
  // ---------------------------------------------------------------------------

  describe("is_url", () => {
    it("passes for https:// URL", () => {
      const r = ev.evaluate("is_url", found("https://example.com/path"), ctx(NOW));
      expect(r.pass).toBe(true);
    });

    it("passes for urn: scheme (any scheme, not http-only)", () => {
      const r = ev.evaluate("is_url", found("urn:isbn:0451450523"), ctx(NOW));
      expect(r.pass).toBe(true);
    });

    it("fails for relative path (no scheme) → FORMAT_INVALID", () => {
      const r = ev.evaluate("is_url", found("/users/1"), ctx(NOW));
      expect(r.failureCode).toBe("FORMAT_INVALID");
    });

    it("fails for scheme-less host → FORMAT_INVALID", () => {
      const r = ev.evaluate("is_url", found("example.com"), ctx(NOW));
      expect(r.failureCode).toBe("FORMAT_INVALID");
    });
  });

  // ---------------------------------------------------------------------------
  // is_iso_timestamp
  // ---------------------------------------------------------------------------

  describe("is_iso_timestamp", () => {
    it("passes for RFC 3339 date-time with Z timezone", () => {
      const r = ev.evaluate("is_iso_timestamp", found("2026-05-18T12:00:00Z"), ctx(NOW));
      expect(r.pass).toBe(true);
    });

    it("passes for date-time with offset (+05:30)", () => {
      const r = ev.evaluate("is_iso_timestamp", found("2026-05-18T12:00:00+05:30"), ctx(NOW));
      expect(r.pass).toBe(true);
    });

    it("fails for date-time without timezone → FORMAT_INVALID (strictTimeZone)", () => {
      const r = ev.evaluate("is_iso_timestamp", found("2026-05-18T12:00:00"), ctx(NOW));
      expect(r.failureCode).toBe("FORMAT_INVALID");
    });

    it("fails for invalid calendar date (Feb 30) → FORMAT_INVALID", () => {
      const r = ev.evaluate("is_iso_timestamp", found("2026-02-30T00:00:00Z"), ctx(NOW));
      expect(r.failureCode).toBe("FORMAT_INVALID");
    });

    it("passes for leap second 23:59:60Z (ajv full accepts it)", () => {
      const r = ev.evaluate("is_iso_timestamp", found("2026-12-31T23:59:60Z"), ctx(NOW));
      expect(r.pass).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // is_recent_timestamp — deterministic via injected context.now
  // ---------------------------------------------------------------------------

  describe("is_recent_timestamp", () => {
    const ISO_NOW = new Date(NOW).toISOString();

    it("passes for instant exactly equal to now (Δ=0)", () => {
      const r = ev.evaluate("is_recent_timestamp", found(ISO_NOW), ctx(NOW));
      expect(r.pass).toBe(true);
    });

    it("passes for instant now − 299999ms (within window)", () => {
      const ts = new Date(NOW - 299999).toISOString();
      const r = ev.evaluate("is_recent_timestamp", found(ts), ctx(NOW));
      expect(r.pass).toBe(true);
    });

    it("passes for instant now + 299999ms (future, within window — symmetric)", () => {
      const ts = new Date(NOW + 299999).toISOString();
      const r = ev.evaluate("is_recent_timestamp", found(ts), ctx(NOW));
      expect(r.pass).toBe(true);
    });

    it("passes for instant now − RECENT_WINDOW_MS exactly (inclusive boundary)", () => {
      const ts = new Date(NOW - RECENT_WINDOW_MS).toISOString();
      const r = ev.evaluate("is_recent_timestamp", found(ts), ctx(NOW));
      expect(r.pass).toBe(true);
    });

    it("passes for instant now + RECENT_WINDOW_MS exactly (inclusive boundary)", () => {
      const ts = new Date(NOW + RECENT_WINDOW_MS).toISOString();
      const r = ev.evaluate("is_recent_timestamp", found(ts), ctx(NOW));
      expect(r.pass).toBe(true);
    });

    it("fails for instant 10 minutes in the future → FORMAT_INVALID", () => {
      const ts = new Date(NOW + 600000).toISOString();
      const r = ev.evaluate("is_recent_timestamp", found(ts), ctx(NOW));
      expect(r.failureCode).toBe("FORMAT_INVALID");
    });

    it("fails for instant 1 day ago → FORMAT_INVALID", () => {
      const ts = new Date(NOW - 86400000).toISOString();
      const r = ev.evaluate("is_recent_timestamp", found(ts), ctx(NOW));
      expect(r.failureCode).toBe("FORMAT_INVALID");
    });

    it("fails for a non-date-time string → FORMAT_INVALID (not TYPE_MISMATCH)", () => {
      const r = ev.evaluate("is_recent_timestamp", found("not-a-date"), ctx(NOW));
      expect(r.failureCode).toBe("FORMAT_INVALID");
    });

    it("exercises the context.now default-seam branch (no now in context) — does not throw", () => {
      const ts = new Date().toISOString();
      // omit now — default Date.now() used at call site
      const c = ctx();
      expect(() => ev.evaluate("is_recent_timestamp", found(ts), c)).not.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // Safe actual descriptor
  // ---------------------------------------------------------------------------

  describe("safe actual descriptor", () => {
    it("truncates a very long string actual in the report", () => {
      const longStr = "x".repeat(300);
      const r = ev.evaluate("is_email", found(longStr), ctx(NOW));
      expect(r.pass).toBe(false);
      const actualStr = String(r.actual);
      expect(actualStr.length).toBeLessThan(350);
    });

    it("uses structural descriptor for object actual (not raw dump)", () => {
      const r = ev.evaluate("is_email", found({ huge: "data" }), ctx(NOW));
      expect(typeof r.actual).toBe("string");
    });
  });

  // ---------------------------------------------------------------------------
  // Pass/fail shape contract
  // ---------------------------------------------------------------------------

  describe("pass/fail shape contract", () => {
    it("PASS has no failureCode and no reason", () => {
      const r = ev.evaluate("is_email", found("user@example.com"), ctx(NOW));
      expect(r.pass).toBe(true);
      expect(r.failureCode).toBeUndefined();
      expect(r.reason).toBeUndefined();
    });

    it("FAIL has both failureCode and reason", () => {
      const r = ev.evaluate("is_email", found("notanemail"), ctx(NOW));
      expect(r.pass).toBe(false);
      expect(r.failureCode).toBeTruthy();
      expect(r.reason).toBeTruthy();
    });
  });

  // ---------------------------------------------------------------------------
  // Determinism
  // ---------------------------------------------------------------------------

  describe("determinism (with injected now)", () => {
    it("identical inputs produce identical result", () => {
      const r1 = ev.evaluate("is_iso_timestamp", found("2026-05-18T12:00:00Z"), ctx(NOW));
      const r2 = ev.evaluate("is_iso_timestamp", found("2026-05-18T12:00:00Z"), ctx(NOW));
      expect(r1).toEqual(r2);
    });
  });
});
