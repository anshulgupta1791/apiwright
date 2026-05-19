import { describe, it, expect } from "vitest";

import {
  PatternEvaluator,
} from "../../../../src/assertions/operators/pattern-evaluator.js";
import type {
  ResolvedPatternRhs,
} from "../../../../src/assertions/operators/pattern-evaluator.js";
import { MAX_REGEX_TARGET_LENGTH } from "../../../../src/assertions/regex-operand.js";
import type { ResolvedValue } from "../../../../src/assertions/target-resolver.js";
import type { RegexOperand } from "../../../../src/assertions/index.js";

/**
 * Unit tests for PatternEvaluator.
 *
 * Covers: all 4 pattern operators, universal TARGET_NOT_FOUND on missing LHS,
 * matches type-gate / length-cap (ReDoS guard) / recompile-success / flags,
 * contains string-substring vs array-deepEqual membership, starts_with /
 * ends_with string-only, case-sensitivity, TYPE_MISMATCH for non-string/non-
 * array actuals, REGEX_NO_MATCH for valid-types-no-match, pass/fail shape,
 * determinism, MAX_REGEX_TARGET_LENGTH reuse.
 */

function found(value: unknown): ResolvedValue {
  return { found: true, value };
}

const MISS: ResolvedValue = { found: false };

function makeRegex(source: string, flags: Array<"i" | "m" | "s" | "u"> = []): RegexOperand {
  return {
    kind: "regex",
    source,
    rawFlags: flags.join(""),
    flags,
    compiled: new RegExp(source, flags.join("")),
  };
}

function matchesRhs(source: string, flags?: Array<"i" | "m" | "s" | "u">): ResolvedPatternRhs {
  return { operator: "matches", operand: makeRegex(source, flags) };
}

function containsRhs(value: unknown): ResolvedPatternRhs {
  return { operator: "contains", value };
}

function startsRhs(value: unknown): ResolvedPatternRhs {
  return { operator: "starts_with", value };
}

function endsRhs(value: unknown): ResolvedPatternRhs {
  return { operator: "ends_with", value };
}

describe("PatternEvaluator", () => {
  const ev = new PatternEvaluator();

  // ---------------------------------------------------------------------------
  // MAX_REGEX_TARGET_LENGTH sanity
  // ---------------------------------------------------------------------------

  describe("MAX_REGEX_TARGET_LENGTH", () => {
    it("equals 65536 (single source of truth from regex-operand module)", () => {
      expect(MAX_REGEX_TARGET_LENGTH).toBe(65536);
    });
  });

  // ---------------------------------------------------------------------------
  // Universal missing-LHS (Step 0 — all operators)
  // ---------------------------------------------------------------------------

  describe("universal missing-LHS → TARGET_NOT_FOUND", () => {
    const cases: Array<{ op: "matches" | "contains" | "starts_with" | "ends_with"; rhs: ResolvedPatternRhs }> = [
      { op: "matches", rhs: matchesRhs("x") },
      { op: "contains", rhs: containsRhs("x") },
      { op: "starts_with", rhs: startsRhs("x") },
      { op: "ends_with", rhs: endsRhs("x") },
    ];

    for (const { op, rhs } of cases) {
      it(`${op} with found:false → TARGET_NOT_FOUND, no throw`, () => {
        expect(() => {
          const r = ev.evaluate(op, MISS, rhs);
          expect(r.pass).toBe(false);
          expect(r.failureCode).toBe("TARGET_NOT_FOUND");
          expect(r.actual).toBeUndefined();
        }).not.toThrow();
      });
    }
  });

  // ---------------------------------------------------------------------------
  // matches — type gate
  // ---------------------------------------------------------------------------

  describe("matches — type gate (non-string → TYPE_MISMATCH)", () => {
    const nonStrings: Array<[string, unknown]> = [
      ["null", null],
      ["number", 42],
      ["boolean", true],
      ["object", {}],
      ["array", [1, 2]],
    ];

    for (const [label, val] of nonStrings) {
      it(`${label} actual → TYPE_MISMATCH`, () => {
        const r = ev.evaluate("matches", found(val), matchesRhs("x"));
        expect(r.pass).toBe(false);
        expect(r.failureCode).toBe("TYPE_MISMATCH");
      });
    }
  });

  // ---------------------------------------------------------------------------
  // matches — length cap (ReDoS guard)
  // ---------------------------------------------------------------------------

  describe("matches — length cap (ReDoS guard)", () => {
    it("target of length MAX_REGEX_TARGET_LENGTH + 1 → REGEX_NO_MATCH, regex NOT run", () => {
      const longStr = "x".repeat(MAX_REGEX_TARGET_LENGTH + 1);
      // pattern /x+/ would match if the regex ran — proves regex was NOT run
      const r = ev.evaluate("matches", found(longStr), matchesRhs("x+"));
      expect(r.pass).toBe(false);
      expect(r.failureCode).toBe("REGEX_NO_MATCH");
      expect(r.reason).toContain(String(MAX_REGEX_TARGET_LENGTH));
    });

    it("target of length exactly MAX_REGEX_TARGET_LENGTH → runs normally", () => {
      const exactStr = "x".repeat(MAX_REGEX_TARGET_LENGTH);
      const r = ev.evaluate("matches", found(exactStr), matchesRhs("x+"));
      expect(r.pass).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // matches — successful recompile + match/no-match
  // ---------------------------------------------------------------------------

  describe("matches — recompile success and flag combinations", () => {
    it("passes for matching pattern (empty flags)", () => {
      const r = ev.evaluate("matches", found("Bearer xyz"), matchesRhs("^Bearer "));
      expect(r.pass).toBe(true);
    });

    it("fails for non-matching pattern (case-sensitive by default)", () => {
      const r = ev.evaluate("matches", found("bearer xyz"), matchesRhs("^Bearer "));
      expect(r.pass).toBe(false);
      expect(r.failureCode).toBe("REGEX_NO_MATCH");
    });

    it("passes with i flag (case-insensitive match)", () => {
      const r = ev.evaluate("matches", found("ABC"), matchesRhs("abc", ["i"]));
      expect(r.pass).toBe(true);
    });

    it("passes for empty pattern against any string", () => {
      expect(ev.evaluate("matches", found("abc"), matchesRhs("")).pass).toBe(true);
    });

    it("passes for empty pattern against empty string", () => {
      expect(ev.evaluate("matches", found(""), matchesRhs("")).pass).toBe(true);
    });

    it("expected is a JSON-safe string /source/flags, NOT a RegExp object", () => {
      const r = ev.evaluate("matches", found("abc"), matchesRhs("abc"));
      expect(typeof r.expected).toBe("string");
      expect(r.expected).toContain("abc");
    });

    it("passes with u flag for unicode property escape", () => {
      const r = ev.evaluate("matches", found("café"), matchesRhs("\\p{L}+", ["u"]));
      expect(r.pass).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // contains — string actual
  // ---------------------------------------------------------------------------

  describe("contains — string actual", () => {
    it("passes for case-sensitive substring hit", () => {
      const r = ev.evaluate("contains", found("hello world"), containsRhs("o w"));
      expect(r.pass).toBe(true);
    });

    it("fails for case-sensitive substring miss (case difference)", () => {
      const r = ev.evaluate("contains", found("hello world"), containsRhs("O W"));
      expect(r.pass).toBe(false);
      expect(r.failureCode).toBe("REGEX_NO_MATCH");
    });

    it("fails with TYPE_MISMATCH when string actual has non-string RHS", () => {
      const r = ev.evaluate("contains", found("hello"), containsRhs(42));
      expect(r.pass).toBe(false);
      expect(r.failureCode).toBe("TYPE_MISMATCH");
    });

    it("passes for empty string contains empty string", () => {
      const r = ev.evaluate("contains", found(""), containsRhs(""));
      expect(r.pass).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // contains — array actual (deepEqual membership)
  // ---------------------------------------------------------------------------

  describe("contains — array actual (deepEqual membership, type-strict)", () => {
    it("passes when array contains the value (primitive)", () => {
      const r = ev.evaluate("contains", found([1, 2, 3]), containsRhs(2));
      expect(r.pass).toBe(true);
    });

    it("fails when array contains numeric value but RHS is string (type-strict)", () => {
      const r = ev.evaluate("contains", found([1, 2, 3]), containsRhs("2"));
      expect(r.pass).toBe(false);
      expect(r.failureCode).toBe("REGEX_NO_MATCH");
    });

    it("passes for nested object membership via deepEqual", () => {
      const r = ev.evaluate("contains", found([{ a: 1 }, { b: 2 }]), containsRhs({ a: 1 }));
      expect(r.pass).toBe(true);
    });

    it("fails for nested object type mismatch via deepEqual", () => {
      const r = ev.evaluate("contains", found([{ a: 1 }]), containsRhs({ a: "1" }));
      expect(r.pass).toBe(false);
      expect(r.failureCode).toBe("REGEX_NO_MATCH");
    });

    it("fails for empty array", () => {
      const r = ev.evaluate("contains", found([]), containsRhs(1));
      expect(r.pass).toBe(false);
      expect(r.failureCode).toBe("REGEX_NO_MATCH");
    });

    it("passes for [null] contains null", () => {
      const r = ev.evaluate("contains", found([null]), containsRhs(null));
      expect(r.pass).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // contains — other actual types → TYPE_MISMATCH
  // ---------------------------------------------------------------------------

  describe("contains — other actual types → TYPE_MISMATCH", () => {
    const others: Array<[string, unknown]> = [
      ["number", 42],
      ["boolean", true],
      ["object", { a: 1 }],
      ["null", null],
    ];

    for (const [label, val] of others) {
      it(`${label} actual → TYPE_MISMATCH`, () => {
        const r = ev.evaluate("contains", found(val), containsRhs("x"));
        expect(r.failureCode).toBe("TYPE_MISMATCH");
      });
    }
  });

  // ---------------------------------------------------------------------------
  // starts_with
  // ---------------------------------------------------------------------------

  describe("starts_with", () => {
    it("passes for case-sensitive prefix match", () => {
      const r = ev.evaluate("starts_with", found("Bearer abc"), startsRhs("Bearer "));
      expect(r.pass).toBe(true);
    });

    it("fails for case-sensitive prefix (case differs) → REGEX_NO_MATCH", () => {
      const r = ev.evaluate("starts_with", found("bearer abc"), startsRhs("Bearer "));
      expect(r.pass).toBe(false);
      expect(r.failureCode).toBe("REGEX_NO_MATCH");
    });

    it("fails with TYPE_MISMATCH for non-string actual", () => {
      const r = ev.evaluate("starts_with", found(42), startsRhs("4"));
      expect(r.failureCode).toBe("TYPE_MISMATCH");
    });

    it("fails with TYPE_MISMATCH for non-string operand", () => {
      const r = ev.evaluate("starts_with", found("abc"), startsRhs(97));
      expect(r.failureCode).toBe("TYPE_MISMATCH");
    });

    it("passes for empty prefix (empty string starts any string)", () => {
      const r = ev.evaluate("starts_with", found("abc"), startsRhs(""));
      expect(r.pass).toBe(true);
    });

    it("fails when prefix longer than target → REGEX_NO_MATCH", () => {
      const r = ev.evaluate("starts_with", found("abc"), startsRhs("abcd"));
      expect(r.failureCode).toBe("REGEX_NO_MATCH");
    });

    it("fails with TYPE_MISMATCH for null actual", () => {
      const r = ev.evaluate("starts_with", found(null), startsRhs(".json"));
      expect(r.failureCode).toBe("TYPE_MISMATCH");
    });
  });

  // ---------------------------------------------------------------------------
  // ends_with
  // ---------------------------------------------------------------------------

  describe("ends_with", () => {
    it("passes for case-sensitive suffix match", () => {
      const r = ev.evaluate("ends_with", found("file.json"), endsRhs(".json"));
      expect(r.pass).toBe(true);
    });

    it("fails for case-sensitive suffix (case differs) → REGEX_NO_MATCH", () => {
      const r = ev.evaluate("ends_with", found("file.JSON"), endsRhs(".json"));
      expect(r.pass).toBe(false);
      expect(r.failureCode).toBe("REGEX_NO_MATCH");
    });

    it("fails with TYPE_MISMATCH for null actual", () => {
      const r = ev.evaluate("ends_with", found(null), endsRhs(".json"));
      expect(r.failureCode).toBe("TYPE_MISMATCH");
    });
  });

  // ---------------------------------------------------------------------------
  // Pass/fail shape contract
  // ---------------------------------------------------------------------------

  describe("pass/fail shape contract", () => {
    it("PASS has no failureCode and no reason", () => {
      const r = ev.evaluate("matches", found("abc"), matchesRhs("abc"));
      expect(r.pass).toBe(true);
      expect(r.failureCode).toBeUndefined();
      expect(r.reason).toBeUndefined();
    });

    it("FAIL has both failureCode and reason present", () => {
      const r = ev.evaluate("matches", found("xyz"), matchesRhs("abc"));
      expect(r.pass).toBe(false);
      expect(r.failureCode).toBeTruthy();
      expect(r.reason).toBeTruthy();
    });
  });

  // ---------------------------------------------------------------------------
  // Determinism / never-throws
  // ---------------------------------------------------------------------------

  describe("determinism and totality", () => {
    it("identical inputs produce identical result on repeated calls", () => {
      const r1 = ev.evaluate("contains", found([1, 2, 3]), containsRhs(2));
      const r2 = ev.evaluate("contains", found([1, 2, 3]), containsRhs(2));
      expect(r1).toEqual(r2);
    });

    const stressCases: Array<{ op: "matches" | "contains" | "starts_with" | "ends_with"; lhs: unknown; rhs: ResolvedPatternRhs }> = [
      { op: "matches", lhs: null, rhs: matchesRhs("x") },
      { op: "contains", lhs: 42, rhs: containsRhs("y") },
      { op: "starts_with", lhs: {}, rhs: startsRhs("z") },
      { op: "ends_with", lhs: [], rhs: endsRhs(".txt") },
    ];

    for (const { op, lhs, rhs } of stressCases) {
      it(`${op} with adversarial input (${typeof lhs}) does not throw`, () => {
        expect(() => ev.evaluate(op, found(lhs), rhs)).not.toThrow();
      });
    }
  });
});
