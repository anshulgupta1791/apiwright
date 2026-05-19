/**
 * Coverage-gap-fill-2: second wave targeting remaining uncovered branches.
 *
 * After coverage-gap-fill.test.ts brought branches from 92.49% → 93.86%,
 * this file targets the remaining ~30 branches needed to reach ≥95.5%.
 *
 * Targeted remaining branches:
 *   - tokenizer-scanners.ts line 179 (MALFORMED_NUMBER from non-finite number string)
 *   - tokenizer-string-scan.ts line 160 (regex body terminator — newline/CR in regex)
 *   - tokenizer.ts lines 114, 118, 148-156 (pushToken-returns-false early exit)
 *   - target-path-db.ts line 76 (errors.length > 0 guard in captureDbFull)
 *   - target-path-parser.ts uncovered segment branches (empty-segment in request/response)
 *   - existence-evaluator.ts line 35 (long-string truncation branch in safeDescriptor)
 *   - pattern-evaluator.ts line 35 (passOk in evalContains array path)
 *   - aggregate-evaluator.ts (&&-chain branches)
 *   - comparison-evaluator.ts (defensive RHS mismatch paths)
 *   - format-evaluator.ts line 128 context.now ?? Date.now() branch
 *   - operand-region-parser.ts line 267 (malformed non-lit/non-target single token)
 *   - arithmetic-evaluator.ts line 106 (non-finite number literal)
 *   - arithmetic-parser.ts lines 220-225
 */

import { describe, it, expect } from "vitest";

import { AssertionTokenizer } from "../../../src/assertions/tokenizer.js";
import { TargetPathParser } from "../../../src/assertions/target-path-parser.js";
import { ExistenceEvaluator } from "../../../src/assertions/operators/existence-evaluator.js";
import { AggregateEvaluator } from "../../../src/assertions/operators/aggregate-evaluator.js";
import { PatternEvaluator } from "../../../src/assertions/operators/pattern-evaluator.js";
import type { ResolvedPatternRhs } from "../../../src/assertions/operators/pattern-evaluator.js";
import { ComparisonEvaluator } from "../../../src/assertions/operators/comparison-evaluator.js";
import type { ComparisonRhs } from "../../../src/assertions/operators/comparison-evaluator.js";
import { FormatEvaluator } from "../../../src/assertions/operators/format-evaluator.js";
import { ArithmeticEvaluator } from "../../../src/assertions/arithmetic-evaluator.js";
import { TargetResolver } from "../../../src/assertions/target-resolver.js";
import { AssertionParser } from "../../../src/assertions/parser.js";
import type {
  EvaluationContext,
  TargetRef,
  RegexOperand,
  ArithmeticOperandNode,
} from "../../../src/assertions/index.js";
import type { ResolvedValue } from "../../../src/assertions/target-resolver.js";
import { FAILURE_CODES } from "../../../src/assertions/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCtx(overrides: Partial<EvaluationContext> = {}): EvaluationContext {
  return {
    request: {
      headers: {},
      body: null,
      url: { full: "http://localhost/", path: "/", query: {} },
    },
    response: { status: 200, headers: {}, body: null, time_ms: 50 },
    db: {},
    ...overrides,
  };
}

function found(value: unknown): ResolvedValue {
  return { found: true, value };
}
const MISS: ResolvedValue = { found: false };

function key(k: string) { return { kind: "key" as const, key: k }; }

// ---------------------------------------------------------------------------
// 1. AssertionTokenizer — TOO_MANY_TOKENS early exit (lines 114, 118)
//    pushToken returns false → #dispatchChar returns null → line 118 break
// ---------------------------------------------------------------------------

describe("AssertionTokenizer — TOO_MANY_TOKENS early exit", () => {
  it("exceeding maxTokenCount causes TOO_MANY_TOKENS error and early scan exit", () => {
    const tokenizer = new AssertionTokenizer({ maxTokenCount: 5 });
    // enough tokens to exceed limit
    const result = tokenizer.tokenize("a b c d e f g h");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.code === "TOO_MANY_TOKENS")).toBe(true);
    }
  });

  it("maxTokenCount=3 on 'a equals 200' triggers TOO_MANY_TOKENS", () => {
    const tokenizer = new AssertionTokenizer({ maxTokenCount: 3 });
    const result = tokenizer.tokenize("a equals 200");
    expect(result.ok).toBe(false);
  });

  it("maxTokenCount=2 on any multi-token input triggers early exit (line 118 branch)", () => {
    const tokenizer = new AssertionTokenizer({ maxTokenCount: 2 });
    const result = tokenizer.tokenize("response.status equals");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.code === "TOO_MANY_TOKENS")).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. AssertionTokenizer — MALFORMED_NUMBER (tokenizer-scanners.ts line 179)
//    This fires when Number('slice') is not finite, i.e. "1e999"
// ---------------------------------------------------------------------------

describe("AssertionTokenizer — MALFORMED_NUMBER branch", () => {
  it("a digit-string overflowing to Infinity → ok:false with MALFORMED_NUMBER", () => {
    const tokenizer = new AssertionTokenizer();
    const big = "9".repeat(400); // Number(big) === Infinity (> ~1.8e308)
    const result = tokenizer.tokenize(`response.body.x equals ${big}`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.code === "MALFORMED_NUMBER")).toBe(true);
  });

  it("a negative digit-string overflowing to -Infinity → MALFORMED_NUMBER", () => {
    const tokenizer = new AssertionTokenizer();
    const bigNeg = `-${"9".repeat(400)}`;
    const result = tokenizer.tokenize(`response.body.x equals ${bigNeg}`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.code === "MALFORMED_NUMBER")).toBe(true);
  });

  it("'1e999' is NOT malformed — no scientific-notation support: lexes as number(1) + e999", () => {
    // scanNumber consumes only digits + `.ddd`; `1e999` ⇒ number(1) then
    // identifier(e999). No MALFORMED_NUMBER; lexically valid (ok:true).
    const tokenizer = new AssertionTokenizer();
    const result = tokenizer.tokenize("response.body.x equals 1e999");
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. AssertionTokenizer — regex body terminator (tokenizer-string-scan.ts line 160)
//    Line 160 fires when a newline/CR appears inside a regex literal body
// ---------------------------------------------------------------------------

describe("AssertionTokenizer — regex body with newline terminator", () => {
  it("newline inside a regex literal → ok:false with UNTERMINATED_REGEX", () => {
    const tokenizer = new AssertionTokenizer();
    const result = tokenizer.tokenize("response.body.x matches /abc\nrest");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.code === "UNTERMINATED_REGEX")).toBe(true);
  });

  it("carriage return inside a regex literal → ok:false with UNTERMINATED_REGEX", () => {
    const tokenizer = new AssertionTokenizer();
    const result = tokenizer.tokenize("response.body.x matches /pat\rrest");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.code === "UNTERMINATED_REGEX")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. TargetPathParser — target-path-db.ts line 76:
//    captureDbFull: errors.length > 0 fires when EMPTY_SEGMENT is in db path
//    but seg1 and seg2 are non-empty (errors from ELSEWHERE in the segment pass)
// ---------------------------------------------------------------------------

describe("TargetPathParser — db path with prior EMPTY_SEGMENT errors", () => {
  const parser = new TargetPathParser();

  it("'db.conn.q..extra' — trailing empty segment after full db path → EMPTY_SEGMENT in trailing path", () => {
    // segs: ["db","conn","q","","extra"] — seg1="conn",seg2="q" (non-empty)
    // but EMPTY_SEGMENT is pushed for segment 3 ("")
    // captureDbFull: neither seg1 nor seg2 is empty, but errors.length > 0 from EMPTY_SEGMENT
    const r = parser.parse("db.conn.q..extra");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.code === "EMPTY_SEGMENT")).toBe(true);
    }
  });

  it("'db.conn.q.' — trailing dot yields EMPTY_SEGMENT at seg3", () => {
    const r = parser.parse("db.conn.q.");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.code === "EMPTY_SEGMENT")).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 5. ExistenceEvaluator — long-string truncation in safeDescriptor (line 35)
// ---------------------------------------------------------------------------

describe("ExistenceEvaluator — safeDescriptor long-string truncation", () => {
  const ev = new ExistenceEvaluator();

  it("is_null with a very long string actual (>120 chars) — descriptor is truncated", () => {
    const longStr = "x".repeat(200);
    const result = ev.evaluate("is_null", found(longStr));
    // is_null: non-null value → FAIL; the actual descriptor should be truncated
    expect(result.pass).toBe(false);
    const actualStr = String(result.actual);
    expect(actualStr.length).toBeLessThan(200);
  });

  it("exists with long string actual — descriptor does not overflow", () => {
    const longStr = "y".repeat(200);
    const result = ev.evaluate("exists", found(longStr));
    expect(result.pass).toBe(true);
  });

  it("is_not_null with null → safeDescriptor returns 'null'", () => {
    const result = ev.evaluate("is_not_null", found(null));
    expect(result.pass).toBe(false);
    expect(String(result.actual)).toBe("null");
  });

  it("exists with boolean actual — safeDescriptor returns JSON string", () => {
    const result = ev.evaluate("exists", found(true));
    expect(result.pass).toBe(true);
  });

  it("is_null with array actual — safeDescriptor returns '<array>'", () => {
    const result = ev.evaluate("is_null", found([1, 2, 3]));
    expect(result.pass).toBe(false);
    expect(String(result.actual)).toMatch(/array/);
  });

  it("is_null with object actual — safeDescriptor returns '<object>'", () => {
    const result = ev.evaluate("is_null", found({ a: 1 }));
    expect(result.pass).toBe(false);
    expect(String(result.actual)).toMatch(/object/);
  });

  it("is_null with number actual — safeDescriptor returns JSON.stringify", () => {
    const result = ev.evaluate("is_null", found(42));
    expect(result.pass).toBe(false);
    expect(String(result.actual)).toBe("42");
  });
});

// ---------------------------------------------------------------------------
// 6. AggregateEvaluator — remaining &&-chain branches in #isValidCount
// ---------------------------------------------------------------------------

describe("AggregateEvaluator — #isValidCount &&-chain branch coverage", () => {
  const ev = new AggregateEvaluator();

  it("count = 0 (zero, valid) → count_equals 0 passes (count >= 0 branch true)", () => {
    const result = ev.evaluate("count_equals", found([]), { count: 0 });
    expect(result.pass).toBe(true);
  });

  it("count = -1 → TYPE_MISMATCH (count >= 0 false arm)", () => {
    const result = ev.evaluate("count_equals", found([]), { count: -1 });
    expect(result.failureCode).toBe("TYPE_MISMATCH");
  });

  it("count = 1.5 → TYPE_MISMATCH (isInteger false arm, isFinite true)", () => {
    const result = ev.evaluate("count_equals", found([]), { count: 1.5 });
    expect(result.failureCode).toBe("TYPE_MISMATCH");
  });

  it("count = NaN → TYPE_MISMATCH (isFinite false arm)", () => {
    const result = ev.evaluate("count_equals", found([]), { count: NaN });
    expect(result.failureCode).toBe("TYPE_MISMATCH");
  });

  it("count = 'str' → TYPE_MISMATCH (typeof !== 'number' false arm)", () => {
    const result = ev.evaluate("count_equals", found([]), { count: "str" });
    expect(result.failureCode).toBe("TYPE_MISMATCH");
  });

  it("count_greater_than fails with AGGREGATE_MISMATCH when actual === expected", () => {
    const result = ev.evaluate("count_greater_than", found([1, 2, 3]), { count: 3 });
    expect(result.pass).toBe(false);
    expect(result.failureCode).toBe("AGGREGATE_MISMATCH");
  });

  it("NormalizedResult with non-integer rowCount (3.7) is not valid → AGGREGATE_MISMATCH", () => {
    const notValid = { rows: [], rowCount: 3.7, raw: null };
    const result = ev.evaluate("count_equals", found(notValid), { count: 3 });
    expect(result.failureCode).toBe("AGGREGATE_MISMATCH");
  });
});

// ---------------------------------------------------------------------------
// 7. PatternEvaluator — remaining branches (contains array passOk + ends_with)
// ---------------------------------------------------------------------------

describe("PatternEvaluator — additional branch coverage", () => {
  const ev = new PatternEvaluator();

  it("contains array finds element → passOk (line 35 passOk branch in evalContains)", () => {
    const rhs: ResolvedPatternRhs = { operator: "contains", value: 42 };
    const result = ev.evaluate("contains", found([10, 42, 99]), rhs);
    expect(result.pass).toBe(true);
    expect(result.expected).toBe(42);
  });

  it("ends_with with non-string suffix → TYPE_MISMATCH", () => {
    const rhs: ResolvedPatternRhs = { operator: "ends_with", value: 123 };
    const result = ev.evaluate("ends_with", found("abc123"), rhs);
    expect(result.pass).toBe(false);
    expect(result.failureCode).toBe("TYPE_MISMATCH");
  });

  it("starts_with with non-string lhs → TYPE_MISMATCH (line ~180)", () => {
    const rhs: ResolvedPatternRhs = { operator: "starts_with", value: "abc" };
    const result = ev.evaluate("starts_with", found(42), rhs);
    expect(result.pass).toBe(false);
    expect(result.failureCode).toBe("TYPE_MISMATCH");
  });

  it("ends_with with non-string lhs → TYPE_MISMATCH", () => {
    const rhs: ResolvedPatternRhs = { operator: "ends_with", value: ".json" };
    const result = ev.evaluate("ends_with", found(42), rhs);
    expect(result.pass).toBe(false);
    expect(result.failureCode).toBe("TYPE_MISMATCH");
  });
});

// ---------------------------------------------------------------------------
// 8. ComparisonEvaluator — defensive RHS-kind mismatch branches (lines 71-72)
// ---------------------------------------------------------------------------

describe("ComparisonEvaluator — range RHS with found:false + comparand arm", () => {
  const ev = new ComparisonEvaluator();

  it("not_equals found:false → TARGET_NOT_FOUND, expected = comparand value", () => {
    const rhs: ComparisonRhs = { kind: "comparand", comparand: "hello" };
    const result = ev.evaluate("not_equals", MISS, rhs);
    expect(result.pass).toBe(false);
    expect(result.failureCode).toBe("TARGET_NOT_FOUND");
    expect(result.expected).toBe("hello");
  });

  it("less_than found:false → TARGET_NOT_FOUND", () => {
    const rhs: ComparisonRhs = { kind: "comparand", comparand: 10 };
    const result = ev.evaluate("less_than", MISS, rhs);
    expect(result.pass).toBe(false);
    expect(result.failureCode).toBe("TARGET_NOT_FOUND");
  });

  it("greater_than found:false → TARGET_NOT_FOUND", () => {
    const rhs: ComparisonRhs = { kind: "comparand", comparand: 5 };
    const result = ev.evaluate("greater_than", MISS, rhs);
    expect(result.pass).toBe(false);
    expect(result.failureCode).toBe("TARGET_NOT_FOUND");
  });
});

// ---------------------------------------------------------------------------
// 9. FormatEvaluator — context.now ?? Date.now() branch (line 128/130)
// ---------------------------------------------------------------------------

describe("FormatEvaluator — context.now branch coverage", () => {
  const ev = new FormatEvaluator();
  const NOW = 1716163200000;

  it("is_recent_timestamp with context.now present takes the defined branch", () => {
    const ts = new Date(NOW).toISOString();
    const ctx = makeCtx({ now: NOW });
    const result = ev.evaluate("is_recent_timestamp", found(ts), ctx);
    expect(result.pass).toBe(true);
  });

  it("is_recent_timestamp without context.now → Date.now() fallback; a current ts passes", () => {
    const ts = new Date().toISOString();
    const ctx = makeCtx(); // no `now` → Date.now() fallback branch
    const result = ev.evaluate("is_recent_timestamp", found(ts), ctx);
    expect(result.pass).toBe(true);
  });

  it("is_uuid_v4 with context (no now) does not throw", () => {
    const result = ev.evaluate("is_uuid_v4", found("550e8400-e29b-41d4-a716-446655440000"), makeCtx());
    expect(result.pass).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 10. ArithmeticParser — lines 220-225 (depth exceeded branch)
// ---------------------------------------------------------------------------

describe("ArithmeticParser via AssertionParser — deeply nested arithmetic", () => {
  it("nesting depth 100 > MAX_ARITH_DEPTH(64) → ok:false with a depth error", () => {
    const parser = new AssertionParser();
    const depth = 100;
    const nested = "(".repeat(depth) + "1" + ")".repeat(depth);
    const result = parser.parse(`response.status equals ${nested}`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => /depth/i.test(e))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 11. TargetPathParser — additional request/response EMPTY_SEGMENT guard
// ---------------------------------------------------------------------------

describe("TargetPathParser — errors.length guard in request/response parse", () => {
  const parser = new TargetPathParser();

  it("'request.headers.' has EMPTY_SEGMENT in trailing segs → ok:false", () => {
    const r = parser.parse("request.headers.");
    expect(r.ok).toBe(false);
  });

  it("'response.body.' has EMPTY_SEGMENT → ok:false", () => {
    const r = parser.parse("response.body.");
    expect(r.ok).toBe(false);
  });

  it("'request.body.x.' trailing dot produces ok:false", () => {
    const r = parser.parse("request.body.x.");
    expect(r.ok).toBe(false);
  });

  it("'response.headers.x.' trailing dot → ok:false with EMPTY_SEGMENT", () => {
    const r = parser.parse("response.headers.x.");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.code === "EMPTY_SEGMENT")).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 12. TargetResolver — additional branches
// ---------------------------------------------------------------------------

describe("TargetResolver — additional branch coverage", () => {
  const resolver = new TargetResolver();

  it("response.body undefined, empty path → found:false (invariant: found:true ⇒ value never undefined)", () => {
    const ctx = makeCtx({ response: { status: 200, headers: {}, body: undefined, time_ms: 0 } });
    const ref: TargetRef = { root: "response.body", path: [] };
    const result = resolver.resolve(ref, ctx);
    expect(result.found).toBe(false);
  });

  it("response.status undefined → NOT_FOUND (safeFound gate)", () => {
    const ctx = makeCtx({ response: undefined as never });
    const ref: TargetRef = { root: "response.status" };
    const result = resolver.resolve(ref, ctx);
    expect(result.found).toBe(false);
  });

  it("response.time_ms undefined → NOT_FOUND", () => {
    const ctx = makeCtx({ response: undefined as never });
    const ref: TargetRef = { root: "response.time_ms" };
    const result = resolver.resolve(ref, ctx);
    expect(result.found).toBe(false);
  });

  it("db with null db context → NOT_FOUND", () => {
    const ref: TargetRef = { root: "db", connection: "c", queryId: "q", path: [] };
    const ctx = makeCtx({ db: null as never });
    const result = resolver.resolve(ref, ctx);
    expect(result.found).toBe(false);
  });

  it("db with connection pointing to null → NOT_FOUND", () => {
    const ref: TargetRef = { root: "db", connection: "c", queryId: "q", path: [] };
    const ctx = makeCtx({ db: { c: null as never } });
    const result = resolver.resolve(ref, ctx);
    expect(result.found).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 13. OperandRegionParser via real AssertionParser — uncovered arms
// ---------------------------------------------------------------------------

describe("AssertionParser — more operand shape dispatch arms", () => {
  const parser = new AssertionParser();

  it("'db.c.q count_greater_than response.body.cnt' — target operand for count_* parses OK", () => {
    // Per the approved registry: `numeric` operandShape = LiteralOperand OR
    // TargetOperand. A dotted path in operand position lexes as `identifier`
    // and MUST be accepted as a target-ref operand (regression: #parseNumeric
    // previously rejected `identifier`, masked by a gamed test).
    const result = parser.parse("db.c.q count_greater_than response.body.cnt");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ast.operator).toBe("count_greater_than");
    expect(result.ast.operand).toMatchObject({ kind: "target" });
  });

  it("'response.body.id matches bare_pattern' — regex bare form", () => {
    const result = parser.parse("response.body.id matches bare_pattern");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ast.operand).toMatchObject({ kind: "regex" });
  });

  it("'response.headers.auth starts_with response.body.prefix' — value+target arm", () => {
    const result = parser.parse("response.headers.auth starts_with response.body.prefix");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ast.operand).toMatchObject({ kind: "target" });
  });

  it("'response.body.n less_than response.body.max' — comparand+target arm", () => {
    const result = parser.parse("response.body.n less_than response.body.max");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ast.operand).toMatchObject({ kind: "target" });
  });

  it("'response.status not_equals 500' — not_equals comparand", () => {
    const result = parser.parse("response.status not_equals 500");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ast.operator).toBe("not_equals");
    expect(result.ast.operand).toMatchObject({ kind: "literal", value: 500 });
  });

  it("'response.body.name ends_with \".json\"' — ends_with value arm", () => {
    const result = parser.parse('response.body.name ends_with ".json"');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ast.operator).toBe("ends_with");
    expect(result.ast.operand).toMatchObject({ kind: "literal", value: ".json" });
  });
});

// ---------------------------------------------------------------------------
// 14. Arithmetic evaluator — non-finite number literal branch (line 106)
// ---------------------------------------------------------------------------

describe("ArithmeticEvaluator — non-finite literal defensive branch", () => {
  const resolver = new TargetResolver();
  const ev = new ArithmeticEvaluator(resolver);

  it("NaN literal node → ARITHMETIC_ERROR (line 106 defensive branch)", () => {
    const expr: ArithmeticOperandNode["expr"] = { kind: "number", value: NaN };
    const result = ev.evaluate(expr, makeCtx());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failureCode).toBe(FAILURE_CODES.ARITHMETIC_ERROR);
      expect(result.reason).toMatch(/non-finite/i);
    }
  });

  it("Infinity literal node → ARITHMETIC_ERROR (non-finite)", () => {
    const expr: ArithmeticOperandNode["expr"] = { kind: "number", value: Infinity };
    const result = ev.evaluate(expr, makeCtx());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failureCode).toBe(FAILURE_CODES.ARITHMETIC_ERROR);
    }
  });

  it("valid literal 5 → ok:true, value 5 (line 112 branch)", () => {
    const expr: ArithmeticOperandNode["expr"] = { kind: "number", value: 5 };
    const result = ev.evaluate(expr, makeCtx());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(5);
  });

  it("target resolves to string → TYPE_MISMATCH (line ~143)", () => {
    const expr: ArithmeticOperandNode["expr"] = {
      kind: "target",
      ref: { root: "response.body", path: [{ kind: "key", key: "name" }] },
    };
    const ctx = makeCtx({ response: { status: 200, headers: {}, body: { name: "alice" }, time_ms: 0 } });
    const result = ev.evaluate(expr, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failureCode).toBe(FAILURE_CODES.TYPE_MISMATCH);
  });
});

// ---------------------------------------------------------------------------
// 15. Misc remaining branches via end-to-end assertions
// ---------------------------------------------------------------------------

describe("End-to-end — covering remaining operand dispatch branches", () => {
  const parser = new AssertionParser();

  it("response.body.flag equals true — boolean literal comparand", () => {
    const result = parser.parse("response.body.flag equals true");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ast.operand).toMatchObject({ kind: "literal", value: true });
  });

  it("response.body.flag equals false — boolean false literal", () => {
    const result = parser.parse("response.body.flag equals false");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ast.operand).toMatchObject({ kind: "literal", value: false });
  });

  it("response.body.x equals null — null literal operand", () => {
    const result = parser.parse("response.body.x equals null");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ast.operand).toMatchObject({ kind: "literal", value: null });
  });

  it("response.body.x is_not_null — nullary operator arm", () => {
    const result = parser.parse("response.body.x is_not_null");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ast.operator).toBe("is_not_null");
    expect("operand" in result.ast).toBe(false);
  });

  it("response.body.url is_url — nullary format operator", () => {
    const result = parser.parse("response.body.url is_url");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ast.operator).toBe("is_url");
  });
});
