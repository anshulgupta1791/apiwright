/**
 * Unit tests for SkipResolver — validateSkipTokens() and ALL_SKIPPABLE_KINDS.
 *
 * Design decisions pinned:
 *   DD-1  Malformed tokens warn but never throw.
 *   DD-7  ALL_SKIPPABLE_KINDS.size === 16 (15 generated kinds + assertion sentinel).
 *   DD-8  Zero-match warning per token that parsed + had a known kind but matched nothing.
 *   DD-9  Kind matching is case-SENSITIVE, trim-NONE.
 *
 * Covers unit test cases 17–24 from the solution design.
 * Cases 1–16 (shouldSkip + matchSkip) are in skip-resolver.test.ts.
 */

import { describe, it, expect } from "vitest";

import {
  SkipResolver,
  ALL_SKIPPABLE_KINDS,
} from "../../../src/test-catalog/skip-resolver.js";

// ---------------------------------------------------------------------------
// validateSkipTokens() — cases 17-23
// ---------------------------------------------------------------------------

describe("SkipResolver — validateSkipTokens()", () => {
  describe("validateSkipTokens()", () => {
    it("partitions a mixed list into recognized and unrecognized arrays", () => {
      const resolver = new SkipResolver();
      const tokens = ["status_code_conformance", "nonexistent_kind"];
      const result = resolver.validateSkipTokens(
        tokens,
        ALL_SKIPPABLE_KINDS,
        "Endpoint 'ep.one'",
      );
      expect(result.recognized).toContain("status_code_conformance");
      expect(result.unrecognized).toContain("nonexistent_kind");
    });

    it("emits exactly one warning per unrecognized token (no duplicate warnings)", () => {
      const resolver = new SkipResolver();
      const tokens = ["nonexistent_kind", "another_unknown"];
      const result = resolver.validateSkipTokens(
        tokens,
        ALL_SKIPPABLE_KINDS,
        "Endpoint 'ep.two'",
      );
      expect(result.warnings).toHaveLength(2);
    });

    it("warning text includes the scopeLabel verbatim", () => {
      const resolver = new SkipResolver();
      const scopeLabel = "Endpoint 'ep.three'";
      const result = resolver.validateSkipTokens(
        ["nonexistent_kind"],
        ALL_SKIPPABLE_KINDS,
        scopeLabel,
      );
      expect(result.warnings.some((w) => w.includes(scopeLabel))).toBe(true);
    });

    it("warning for empty string token cites reason 'empty'", () => {
      const resolver = new SkipResolver();
      const result = resolver.validateSkipTokens(
        [""],
        ALL_SKIPPABLE_KINDS,
        "Endpoint 'ep.four'",
      );
      expect(result.warnings.some((w) => w.includes("empty"))).toBe(true);
    });

    it("warning for whitespace-only token cites reason 'empty'", () => {
      const resolver = new SkipResolver();
      const result = resolver.validateSkipTokens(
        ["   "],
        ALL_SKIPPABLE_KINDS,
        "Endpoint 'ep.five'",
      );
      expect(result.warnings.some((w) => w.includes("empty"))).toBe(true);
    });

    it("warning for ':foo' token cites reason 'leading_colon'", () => {
      const resolver = new SkipResolver();
      const result = resolver.validateSkipTokens(
        [":foo"],
        ALL_SKIPPABLE_KINDS,
        "Endpoint 'ep.six'",
      );
      expect(result.warnings.some((w) => w.includes("leading_colon"))).toBe(true);
    });

    it("warning for 'foo:' token cites reason 'trailing_colon'", () => {
      const resolver = new SkipResolver();
      const result = resolver.validateSkipTokens(
        ["foo:"],
        ALL_SKIPPABLE_KINDS,
        "Endpoint 'ep.seven'",
      );
      expect(result.warnings.some((w) => w.includes("trailing_colon"))).toBe(true);
    });

    it("warning for 'a:b:c' token cites reason 'multiple_colons'", () => {
      const resolver = new SkipResolver();
      const result = resolver.validateSkipTokens(
        ["a:b:c"],
        ALL_SKIPPABLE_KINDS,
        "Endpoint 'ep.eight'",
      );
      expect(result.warnings.some((w) => w.includes("multiple_colons"))).toBe(true);
    });

    it("warning for unknown kind uses 'unknown skip kind X in token Y' template", () => {
      const resolver = new SkipResolver();
      const result = resolver.validateSkipTokens(
        ["my_fake_kind"],
        ALL_SKIPPABLE_KINDS,
        "Endpoint 'ep.nine'",
      );
      const warn = result.warnings.find((w) => w.includes("my_fake_kind"));
      expect(warn).toBeDefined();
      expect(warn).toContain("unknown skip kind");
      expect(warn).toContain("my_fake_kind");
    });

    it("field in 'kind:field' token is NOT validated — only kind is checked", () => {
      const resolver = new SkipResolver();
      const result = resolver.validateSkipTokens(
        ["type_violation_returns_400:nonexistent_field"],
        ALL_SKIPPABLE_KINDS,
        "Endpoint 'ep.ten'",
      );
      // kind is valid → recognized; field check is downstream by shouldSkip
      expect(result.recognized).toContain("type_violation_returns_400:nonexistent_field");
      expect(result.unrecognized).not.toContain("type_violation_returns_400:nonexistent_field");
      expect(result.warnings.some((w) => w.includes("nonexistent_field"))).toBe(false);
    });

    it("preserves token order in recognized and unrecognized arrays (deterministic)", () => {
      const resolver = new SkipResolver();
      const tokens = [
        "status_code_conformance",
        "nonexistent_a",
        "content_type_alignment",
        "nonexistent_b",
        "response_time_sla",
      ];
      const result = resolver.validateSkipTokens(tokens, ALL_SKIPPABLE_KINDS, "Endpoint 'ep.order'");
      expect(result.recognized[0]).toBe("status_code_conformance");
      expect(result.recognized[1]).toBe("content_type_alignment");
      expect(result.recognized[2]).toBe("response_time_sla");
      expect(result.unrecognized[0]).toBe("nonexistent_a");
      expect(result.unrecognized[1]).toBe("nonexistent_b");
    });
  });

  // ---------------------------------------------------------------------------
  // ALL_SKIPPABLE_KINDS registry — case 24
  // ---------------------------------------------------------------------------

  describe("ALL_SKIPPABLE_KINDS", () => {
    it("has exactly 16 entries (15 GeneratedTestType values + the assertion sentinel)", () => {
      expect(ALL_SKIPPABLE_KINDS.size).toBe(16);
    });

    it("contains all 15 GeneratedTestType values", () => {
      const expected15: string[] = [
        "status_code_conformance",
        "content_type_alignment",
        "response_time_sla",
        "response_schema_validation",
        "auth_happy_path",
        "no_auth_returns_401",
        "garbage_token_returns_401",
        "method_not_allowed",
        "malformed_json_returns_400",
        "required_field_omission_returns_400",
        "type_violation_returns_400",
        "boundary_battery",
        "get_idempotency",
        "delete_idempotency",
        "db_state_matches_expectation",
      ];
      for (const kind of expected15) {
        expect(ALL_SKIPPABLE_KINDS.has(kind as never)).toBe(true);
      }
    });

    it("contains the 'assertion' sentinel as the 16th entry", () => {
      expect(ALL_SKIPPABLE_KINDS.has("assertion")).toBe(true);
    });
  });
});
