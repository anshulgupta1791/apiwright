import { describe, it, expect } from "vitest";

import { parseJson } from "../../../src/core/safe-json.js";
import { FAILURE_CODES } from "../../../src/assertions/index.js";
import type {
  FailureCode,
  GroupOutcome,
  AssertionResult,
  OperatorName,
} from "../../../src/assertions/index.js";

/**
 * Unit tests for the assertions type vocabulary — Part 1.
 *
 * Covers: FAILURE_CODES frozen const (the only runtime export — frozen check,
 * key=value identity, exact 7 keys), GroupOutcome shape (passing vs failing,
 * IFF discipline, parseJson round-trip), AssertionResult as GroupOutcome
 * superset (spread construction, three identity fields, round-trip).
 *
 * TargetRef, Operand, AssertionAst, AssertionParseResult, BatchParseResult,
 * EvaluationContext structural tests are in ast-and-result-types-2.test.ts
 * (split for the 300-line file cap).
 */

// ---- FAILURE_CODES runtime micro-tests ------------------------------------------------
describe("FAILURE_CODES", () => {
  describe("is frozen", () => {
    it("Object.isFrozen returns true", () => {
      expect(Object.isFrozen(FAILURE_CODES)).toBe(true);
    });

    it("cannot add a new property — property remains absent after attempt", () => {
      const codes = FAILURE_CODES as Record<string, string>;
      try {
        codes["NEW_KEY"] = "NEW_KEY";
      } catch {
        // TypeError in strict mode — acceptable; property must be absent either way
      }
      expect("NEW_KEY" in FAILURE_CODES).toBe(false);
    });
  });

  describe("keys equal their values (string enum surrogate — keys === values)", () => {
    it("TARGET_NOT_FOUND key equals its value", () => {
      expect(FAILURE_CODES.TARGET_NOT_FOUND).toBe("TARGET_NOT_FOUND");
    });

    it("TYPE_MISMATCH key equals its value", () => {
      expect(FAILURE_CODES.TYPE_MISMATCH).toBe("TYPE_MISMATCH");
    });

    it("REGEX_NO_MATCH key equals its value", () => {
      expect(FAILURE_CODES.REGEX_NO_MATCH).toBe("REGEX_NO_MATCH");
    });

    it("COMPARISON_FAILED key equals its value", () => {
      expect(FAILURE_CODES.COMPARISON_FAILED).toBe("COMPARISON_FAILED");
    });

    it("FORMAT_INVALID key equals its value", () => {
      expect(FAILURE_CODES.FORMAT_INVALID).toBe("FORMAT_INVALID");
    });

    it("AGGREGATE_MISMATCH key equals its value", () => {
      expect(FAILURE_CODES.AGGREGATE_MISMATCH).toBe("AGGREGATE_MISMATCH");
    });

    it("ARITHMETIC_ERROR key equals its value", () => {
      expect(FAILURE_CODES.ARITHMETIC_ERROR).toBe("ARITHMETIC_ERROR");
    });
  });

  describe("covers exactly the 7 documented failure codes", () => {
    it("has exactly 7 keys", () => {
      expect(Object.keys(FAILURE_CODES)).toHaveLength(7);
    });

    it("contains no extra keys beyond the 7 locked codes", () => {
      const expected: FailureCode[] = [
        "TARGET_NOT_FOUND",
        "TYPE_MISMATCH",
        "REGEX_NO_MATCH",
        "COMPARISON_FAILED",
        "FORMAT_INVALID",
        "AGGREGATE_MISMATCH",
        "ARITHMETIC_ERROR",
      ];
      expect(Object.keys(FAILURE_CODES).sort()).toEqual(expected.slice().sort());
    });
  });
});

// ---- GroupOutcome structural tests ----------------------------------------------------
describe("GroupOutcome", () => {
  describe("passing outcome — failureCode and reason are omitted (IFF discipline)", () => {
    it("a passing GroupOutcome with only pass/expected/actual is structurally valid", () => {
      const outcome: GroupOutcome = {
        pass: true,
        expected: 201,
        actual: 201,
      };
      expect(outcome.pass).toBe(true);
      expect(outcome.failureCode).toBeUndefined();
      expect(outcome.reason).toBeUndefined();
    });

    it("passing outcome with object expected/actual compiles and round-trips", () => {
      const outcome: GroupOutcome = {
        pass: true,
        expected: { id: 1 },
        actual: { id: 1 },
      };
      const result = parseJson(JSON.stringify(outcome));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const parsed = result.value as GroupOutcome;
      expect(parsed.pass).toBe(true);
      expect(parsed.expected).toEqual({ id: 1 });
    });
  });

  describe("failing outcome — failureCode and reason both present (IFF discipline)", () => {
    it("a failing GroupOutcome carries failureCode and reason", () => {
      const outcome: GroupOutcome = {
        pass: false,
        expected: 201,
        actual: 404,
        failureCode: "COMPARISON_FAILED",
        reason: "expected 201, got 404",
      };
      expect(outcome.pass).toBe(false);
      expect(outcome.failureCode).toBe("COMPARISON_FAILED");
      expect(outcome.reason).toBe("expected 201, got 404");
    });

    it("failing GroupOutcome survives JSON.stringify + parseJson round-trip", () => {
      const outcome: GroupOutcome = {
        pass: false,
        expected: "Bearer token",
        actual: null,
        failureCode: "TARGET_NOT_FOUND",
        reason: "response.headers.authorization not found",
      };
      const result = parseJson(JSON.stringify(outcome));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const parsed = result.value as GroupOutcome;
      expect(parsed.pass).toBe(false);
      expect(parsed.failureCode).toBe("TARGET_NOT_FOUND");
      expect(parsed.reason).toBe("response.headers.authorization not found");
    });
  });
});

// ---- AssertionResult = GroupOutcome & { assertion; target; operator } -----------------
describe("AssertionResult", () => {
  describe("structural relationship — superset of GroupOutcome", () => {
    it("built by spreading a GroupOutcome plus the three identity fields", () => {
      const groupOutcome: GroupOutcome = {
        pass: true,
        expected: 200,
        actual: 200,
      };
      const result: AssertionResult = {
        ...groupOutcome,
        assertion: "response.status equals 200",
        target: "response.status",
        operator: "equals",
      };
      expect(result.pass).toBe(true);
      expect(result.assertion).toBe("response.status equals 200");
      expect(result.target).toBe("response.status");
      expect(result.operator).toBe("equals");
    });

    it("failing AssertionResult carries all five GroupOutcome fields plus three identity fields", () => {
      const result: AssertionResult = {
        pass: false,
        expected: "uuid",
        actual: "not-a-uuid",
        failureCode: "FORMAT_INVALID",
        reason: "value is not a valid UUID v4",
        assertion: "response.body.id is_uuid_v4",
        target: "response.body.id",
        operator: "is_uuid_v4",
      };
      expect(result.operator).toBe("is_uuid_v4");
      expect(result.failureCode).toBe("FORMAT_INVALID");
    });
  });

  describe("JSON round-trip via parseJson", () => {
    it("passing AssertionResult survives round-trip with all fields intact", () => {
      const result: AssertionResult = {
        pass: true,
        expected: [1, 2, 3],
        actual: [1, 2, 3],
        assertion: "response.body.ids equals [1,2,3]",
        target: "response.body.ids",
        operator: "equals",
      };
      const parsed = parseJson(JSON.stringify(result));
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      const val = parsed.value as AssertionResult;
      expect(val.pass).toBe(true);
      expect(val.assertion).toBe("response.body.ids equals [1,2,3]");
    });

    it("failing AssertionResult with failureCode survives round-trip", () => {
      const result: AssertionResult = {
        pass: false,
        expected: "admin@example.com",
        actual: "not-an-email",
        failureCode: "FORMAT_INVALID",
        reason: "value is not a valid email",
        assertion: "response.body.email is_email",
        target: "response.body.email",
        operator: "is_email",
      };
      const parsed = parseJson(JSON.stringify(result));
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      const val = parsed.value as AssertionResult;
      expect(val.failureCode).toBe("FORMAT_INVALID");
      expect(val.operator).toBe("is_email");
    });
  });
});
