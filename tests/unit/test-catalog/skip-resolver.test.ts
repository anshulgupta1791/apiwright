/**
 * Unit tests for SkipResolver — token matching: shouldSkip() and matchSkip().
 *
 * Design decisions pinned:
 *   DD-1  Malformed tokens warn but never throw (no exception on bad input).
 *   DD-4  matchSkip returns the winning token string (not boolean).
 *   DD-5  (kind, field) is sufficient as case identity; ordinals not used.
 *   DD-6  extractFieldFromCase lives inside skip-resolver.ts.
 *   DD-9  Kind matching is case-SENSITIVE, trim-NONE.
 *
 * Covers unit test cases 1–15 from the solution design.
 * Cases 16–24 (validateSkipTokens + ALL_SKIPPABLE_KINDS) are in
 * skip-resolver-validate.test.ts.
 */

import { describe, it, expect } from "vitest";

import { SkipResolver } from "../../../src/test-catalog/skip-resolver.js";
import type {
  TestCase,
  BoundaryParams,
  RequiredFieldOmissionParams,
  TypeViolationParams,
} from "../../../src/test-catalog/types.js";

// ---------------------------------------------------------------------------
// Minimal TestCase factory helpers
// ---------------------------------------------------------------------------

function makeCase(params: TestCase["params"], overrides: Partial<TestCase> = {}): TestCase {
  return {
    id: "test.case.id",
    endpoint_id: "ep.id",
    type: params.kind,
    marker: "regression",
    title: "Test case",
    prod_safe: false,
    params,
    ...overrides,
  };
}

function makeTypeViolationCase(field: string): TestCase {
  return makeCase({
    kind: "type_violation_returns_400",
    field,
    original_type: "string",
    wrong_type: "number",
    expected_status: 400,
  } satisfies TypeViolationParams);
}

function makeRequiredOmissionCase(omitted_field: string): TestCase {
  return makeCase({
    kind: "required_field_omission_returns_400",
    omitted_field,
    expected_status: 400,
  } satisfies RequiredFieldOmissionParams);
}

function makeBoundaryCase(field: string): TestCase {
  return makeCase({
    kind: "boundary_battery",
    field,
    constraint: "maxLength",
    position: "outside",
    value: "too_long",
    expected_status: 400,
  } satisfies BoundaryParams);
}

function makeStatusCodeCase(): TestCase {
  return makeCase({ kind: "status_code_conformance", expected_status: 200 });
}

function makeNoAuthCase(): TestCase {
  return makeCase({
    kind: "no_auth_returns_401",
    auth_strategy: "user_token",
    expected_status: 401,
  });
}

// ---------------------------------------------------------------------------
// shouldSkip() — cases 1-14
// ---------------------------------------------------------------------------

describe("SkipResolver", () => {
  describe("shouldSkip()", () => {
    it("returns false when both endpoint and global lists are empty", () => {
      const resolver = new SkipResolver();
      const tc = makeStatusCodeCase();
      expect(resolver.shouldSkip(tc, [], [])).toBe(false);
    });

    it("returns true on exact 'kind' match in the endpoint skip list", () => {
      const resolver = new SkipResolver();
      const tc = makeStatusCodeCase();
      expect(resolver.shouldSkip(tc, ["status_code_conformance"], [])).toBe(true);
    });

    it("returns true on exact 'kind' match in the global skip list", () => {
      const resolver = new SkipResolver();
      const tc = makeNoAuthCase();
      expect(resolver.shouldSkip(tc, [], ["no_auth_returns_401"])).toBe(true);
    });

    it("returns true on 'kind:field' match against RequiredFieldOmissionParams.omitted_field", () => {
      const resolver = new SkipResolver();
      const tc = makeRequiredOmissionCase("email");
      expect(
        resolver.shouldSkip(tc, ["required_field_omission_returns_400:email"], []),
      ).toBe(true);
    });

    it("returns true on 'kind:field' match against TypeViolationParams.field", () => {
      const resolver = new SkipResolver();
      const tc = makeTypeViolationCase("tags");
      expect(
        resolver.shouldSkip(tc, ["type_violation_returns_400:tags"], []),
      ).toBe(true);
    });

    it("returns true on 'kind:field' match against BoundaryParams.field", () => {
      const resolver = new SkipResolver();
      const tc = makeBoundaryCase("price");
      expect(
        resolver.shouldSkip(tc, ["boundary_battery:price"], []),
      ).toBe(true);
    });

    it("returns false when 'kind:field' field value mismatches the actual field", () => {
      const resolver = new SkipResolver();
      const tc = makeTypeViolationCase("name");
      expect(
        resolver.shouldSkip(tc, ["type_violation_returns_400:tags"], []),
      ).toBe(false);
    });

    it("returns false when kind token is a prefix of the case kind (no partial match)", () => {
      const resolver = new SkipResolver();
      const tc = makeNoAuthCase();
      // "no_auth" is a prefix of "no_auth_returns_401" — must NOT match
      expect(resolver.shouldSkip(tc, ["no_auth"], [])).toBe(false);
    });

    it("ignores all malformed tokens and returns false (no false matches)", () => {
      const resolver = new SkipResolver();
      const tc = makeStatusCodeCase();
      const malformed = ["", "   ", ":foo", "foo:", "a:b:c"];
      expect(resolver.shouldSkip(tc, malformed, [])).toBe(false);
    });

    it("kind matching is case-SENSITIVE: upper-cased kind does not match lower-case params.kind", () => {
      const resolver = new SkipResolver();
      const tc = makeTypeViolationCase("field1");
      expect(
        resolver.shouldSkip(tc, ["TYPE_VIOLATION_RETURNS_400"], []),
      ).toBe(false);
    });

    it("returns true when endpoint list is empty but global list has a match", () => {
      const resolver = new SkipResolver();
      const tc = makeNoAuthCase();
      expect(resolver.shouldSkip(tc, [], ["no_auth_returns_401"])).toBe(true);
    });

    it("returns true when global list is empty but endpoint list has a match", () => {
      const resolver = new SkipResolver();
      const tc = makeNoAuthCase();
      expect(resolver.shouldSkip(tc, ["no_auth_returns_401"], [])).toBe(true);
    });

    it("returns true (idempotent) when the same token appears in both lists", () => {
      const resolver = new SkipResolver();
      const tc = makeNoAuthCase();
      expect(
        resolver.shouldSkip(tc, ["no_auth_returns_401"], ["no_auth_returns_401"]),
      ).toBe(true);
    });

    it("broad endpoint rule matches when narrow global token does not cover the case's field", () => {
      const resolver = new SkipResolver();
      // endpoint has broad "type_violation_returns_400" (no field qualifier)
      // global has "type_violation_returns_400:email" (narrow)
      // case has field "name" — only the broad endpoint rule matches
      const tc = makeTypeViolationCase("name");
      expect(
        resolver.shouldSkip(tc, ["type_violation_returns_400"], ["type_violation_returns_400:email"]),
      ).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // matchSkip() — case 15 + null-return case 16
  // ---------------------------------------------------------------------------

  describe("matchSkip()", () => {
    it("returns the winning token string; endpoint list takes precedence over global list", () => {
      const resolver = new SkipResolver();
      const tc = makeNoAuthCase();
      const result = resolver.matchSkip(
        tc,
        ["no_auth_returns_401"],
        ["no_auth_returns_401"],
      );
      expect(result).toBe("no_auth_returns_401");
    });

    it("returns the first matching token by list order within endpoint list", () => {
      const resolver = new SkipResolver();
      const tc = makeTypeViolationCase("email");
      const result = resolver.matchSkip(
        tc,
        ["type_violation_returns_400:email", "type_violation_returns_400"],
        [],
      );
      expect(result).toBe("type_violation_returns_400:email");
    });

    it("falls back to global list when endpoint list has no match", () => {
      const resolver = new SkipResolver();
      const tc = makeNoAuthCase();
      const result = resolver.matchSkip(tc, ["status_code_conformance"], ["no_auth_returns_401"]);
      expect(result).toBe("no_auth_returns_401");
    });

    it("returns null when no token in either list matches", () => {
      const resolver = new SkipResolver();
      const tc = makeStatusCodeCase();
      expect(resolver.matchSkip(tc, ["no_auth_returns_401"], [])).toBeNull();
    });
  });
});
