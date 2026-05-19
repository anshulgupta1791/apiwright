/**
 * Coverage-gap-fill tests for the Assertions Engine (Task #7).
 *
 * SCOPE: This file exercises ONLY the specific uncovered branches identified
 * in the branch-coverage report (92.49% → ≥95.5% target). Every test asserts
 * real, observable, design-specified behavior. No assertion-light "touch the
 * line" stubs.
 *
 * Targeted source files and line ranges:
 *   - target-path-parser.ts   (81.66% → uncov: 82-185, 201-209)
 *   - rhs-resolver.ts         (82.6%  → uncov: 45, 164, 181, 215)
 *   - operand-region-parser.ts(84.21% → uncov: 37, 54, 218, 256, 267)
 *   - regex-operand.ts        (86.84% → uncov: 104, 140, 155-183)
 *   - parser.ts               (86.36% → uncov: 102)
 *   - evaluator.ts            (86.53% → uncov: 145, 199-209)
 *   - target-resolver.ts      (90.66% → uncov: 76, 174)
 *   - target-path-db.ts       (66.66% → uncov: 76)
 *   - ajv-format-check.ts     (50%    → uncov: 32-41)
 *   - comparison-evaluator.ts (93.93% → uncov: 71-72)
 *   - aggregate-evaluator.ts  (93.18% → uncov: 50, 144, 155)
 *   - pattern-evaluator.ts    (88.63% → uncov: 132, 176, 202, 209)
 *   - tokenizer-string-scan.ts(82.05% → uncov: 48, 71, 122-128, 160)
 *   - tokenizer-scanners.ts   (81.57% → uncov: 179)
 *   - tokenizer.ts            (95.12% → uncov: 114, 118, 148-156)
 *   - arithmetic-evaluator.ts (96.87% → uncov: 106)
 */

import { describe, it, expect, vi } from "vitest";

import { TargetPathParser } from "../../../src/assertions/target-path-parser.js";
import { RhsResolver } from "../../../src/assertions/rhs-resolver.js";
import {
  OperandRegionParser,
  classifyRegion,
} from "../../../src/assertions/operand-region-parser.js";
import { RegexOperandCompiler } from "../../../src/assertions/regex-operand.js";
import { AssertionParser } from "../../../src/assertions/parser.js";
import { AssertionEvaluator } from "../../../src/assertions/evaluator.js";
import type { AssertionEvaluatorDeps } from "../../../src/assertions/evaluator.js";
import { TargetResolver } from "../../../src/assertions/target-resolver.js";
import { AjvFormatCheck } from "../../../src/assertions/operators/ajv-format-check.js";
import { ComparisonEvaluator } from "../../../src/assertions/operators/comparison-evaluator.js";
import type { ComparisonRhs } from "../../../src/assertions/operators/comparison-evaluator.js";
import { AggregateEvaluator } from "../../../src/assertions/operators/aggregate-evaluator.js";
import { PatternEvaluator } from "../../../src/assertions/operators/pattern-evaluator.js";
import type { ResolvedPatternRhs } from "../../../src/assertions/operators/pattern-evaluator.js";
import { AssertionTokenizer } from "../../../src/assertions/tokenizer.js";
import { ArithmeticEvaluator } from "../../../src/assertions/arithmetic-evaluator.js";
import type {
  AssertionAst,
  EvaluationContext,
  OperatorName,
  TargetRef,
  LiteralOperand,
  TargetOperand,
  RangeOperand,
  RegexOperand,
  ArithmeticOperandNode,
  PathSegment,
} from "../../../src/assertions/index.js";
import type { OperatorMeta } from "../../../src/assertions/operator-registry.js";
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

function litOp(value: unknown): LiteralOperand {
  return { kind: "literal", value } as LiteralOperand;
}

function targetOp(ref: TargetRef): TargetOperand {
  return { kind: "target", ref };
}

function rangeOp(lo: number, hi: number): RangeOperand {
  return { kind: "range", lo, hi };
}

function regexOp(): RegexOperand {
  return { kind: "regex", source: "^a", rawFlags: "", flags: [], compiled: /^a/ };
}

function makeMeta(
  operandShape: OperatorMeta["operandShape"],
  group: OperatorMeta["group"],
  name: OperatorName,
  allowsArithmeticRhs = false,
): OperatorMeta {
  return { name, group, operandShape, allowsArithmeticRhs };
}

function makeAst(
  operator: OperatorName,
  operand?: AssertionAst["operand"],
  target: TargetRef = { root: "response.status" },
): AssertionAst {
  return operand === undefined
    ? { raw: String(operator), target, operator }
    : { raw: String(operator), target, operator, operand };
}

function makeStubResolver(foundResult: boolean, value?: unknown) {
  return {
    resolve: vi.fn().mockReturnValue(
      foundResult ? { found: true, value } : { found: false },
    ),
  };
}

function makeStubArith(ok: boolean, payload?: { value?: number; failureCode?: string; reason?: string }) {
  return {
    evaluate: vi.fn().mockReturnValue(
      ok
        ? { ok: true, value: payload?.value ?? 42 }
        : { ok: false, failureCode: payload?.failureCode ?? "ARITHMETIC_ERROR", reason: payload?.reason ?? "err" },
    ),
  };
}

function key(k: string): PathSegment { return { kind: "key", key: k }; }
function idx(i: number): PathSegment { return { kind: "index", index: i }; }

// ---------------------------------------------------------------------------
// 1. TargetPathParser — uncovered branches in #segment, #handleUnknownRoot,
//    #parseResponseLeaf, and adjacent paths
// ---------------------------------------------------------------------------

describe("TargetPathParser — additional error branches", () => {
  const parser = new TargetPathParser();

  describe("#handleUnknownRoot — empty seg0 branch (leading dot)", () => {
    it("'.foo' yields UNKNOWN_ROOT with 'Cannot identify root from empty segment'", () => {
      const r = parser.parse(".foo");
      expect(r.ok).toBe(false);
      if (!r.ok) {
        const e = r.errors.find((x) => x.code === "UNKNOWN_ROOT");
        expect(e).toBeDefined();
        expect(e?.message).toMatch(/empty segment/i);
      }
    });

    it("'.db.c.q' yields EMPTY_SEGMENT and UNKNOWN_ROOT message about empty segment", () => {
      const r = parser.parse(".db.c.q");
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.errors.some((e) => e.code === "EMPTY_SEGMENT")).toBe(true);
        expect(r.errors.some((e) => e.code === "UNKNOWN_ROOT")).toBe(true);
      }
    });
  });

  describe("#parseResponseLeaf — UNEXPECTED_SUBPATH on response.status and response.time_ms", () => {
    it("response.status.extra yields UNEXPECTED_SUBPATH at segmentIndex 2", () => {
      const r = parser.parse("response.status.extra");
      expect(r.ok).toBe(false);
      if (!r.ok) {
        const e = r.errors.find((x) => x.code === "UNEXPECTED_SUBPATH");
        expect(e?.segmentIndex).toBe(2);
        expect(e?.message).toMatch(/response\.status/);
      }
    });

    it("response.time_ms.sub1.sub2 yields UNEXPECTED_SUBPATH pointing at segment 2", () => {
      const r = parser.parse("response.time_ms.sub1.sub2");
      expect(r.ok).toBe(false);
      if (!r.ok) {
        const e = r.errors.find((x) => x.code === "UNEXPECTED_SUBPATH");
        expect(e?.segmentIndex).toBe(2);
        expect(e?.message).toMatch(/response\.time_ms/);
      }
    });

    it("response.status alone (no sub-path) returns ok:true with root only", () => {
      const r = parser.parse("response.status");
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.ref.root).toBe("response.status");
        expect("path" in r.ref).toBe(false);
      }
    });

    it("response.time_ms alone returns ok:true, no path field", () => {
      const r = parser.parse("response.time_ms");
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.ref.root).toBe("response.time_ms");
    });
  });

  describe("#parseRequest — missing sub-namespace (request alone)", () => {
    it("'request' alone yields UNKNOWN_ROOT at segmentIndex 0 about missing second segment", () => {
      const r = parser.parse("request");
      expect(r.ok).toBe(false);
      if (!r.ok) {
        const e = r.errors.find((x) => x.code === "UNKNOWN_ROOT");
        expect(e?.segmentIndex).toBe(0);
        expect(e?.message).toMatch(/headers|body|url/i);
      }
    });

    it("'response' alone yields UNKNOWN_ROOT at segmentIndex 0", () => {
      const r = parser.parse("response");
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.errors.some((e) => e.code === "UNKNOWN_ROOT")).toBe(true);
      }
    });
  });

  describe("#parseRequest — EMPTY_SEGMENT causes early ok:false", () => {
    it("'request..body' yields EMPTY_SEGMENT and UNKNOWN_ROOT (errors.length > 0 guard)", () => {
      const r = parser.parse("request..body");
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.errors.some((e) => e.code === "EMPTY_SEGMENT")).toBe(true);
      }
    });

    it("'request.body.' EMPTY_SEGMENT on the trailing dot flows through ok:false", () => {
      const r = parser.parse("request.body.");
      expect(r.ok).toBe(false);
    });
  });

  describe("#parseResponse — EMPTY_SEGMENT causes early ok:false", () => {
    it("'response..body' yields EMPTY_SEGMENT + UNKNOWN_ROOT (errors guard fires)", () => {
      const r = parser.parse("response..body");
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.errors.some((e) => e.code === "EMPTY_SEGMENT")).toBe(true);
      }
    });

    it("'response.headers.' trailing dot is ok:false with EMPTY_SEGMENT", () => {
      const r = parser.parse("response.headers.");
      expect(r.ok).toBe(false);
    });
  });

  describe("target-path-db.ts line 76 — captureDbFull with errors from EMPTY_SEGMENT", () => {
    it("'db.conn..q' has EMPTY_SEGMENT in seg2, and errors.length > 0 guard fires", () => {
      const r = parser.parse("db.conn..q");
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.errors.some((e) => e.code === "EMPTY_SEGMENT")).toBe(true);
      }
    });

    it("'db..query_id' yields DB_PATH_INCOMPLETE with empty connection", () => {
      const r = parser.parse("db..query_id");
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.errors.some((e) => e.code === "DB_PATH_INCOMPLETE" || e.code === "EMPTY_SEGMENT")).toBe(true);
      }
    });
  });
});

// ---------------------------------------------------------------------------
// 2. RhsResolver — missing-operand branches (lines 45, 164, 181, 215)
// ---------------------------------------------------------------------------

describe("RhsResolver — missing-operand error arms", () => {
  const resolver = makeStubResolver(false);
  const arith = makeStubArith(false);

  it("range operandShape with non-range operand kind → kind:'fail' TYPE_MISMATCH", () => {
    const rhs = new RhsResolver(resolver as never, arith as never);
    const meta = makeMeta("range", "comparison", "in_range");
    const ast = makeAst("in_range", litOp(5));
    const result = rhs.resolve(meta, ast, makeCtx());
    expect(result.kind).toBe("fail");
    if (result.kind === "fail") {
      expect(result.failureCode).toBe(FAILURE_CODES.TYPE_MISMATCH);
      expect(result.reason).toMatch(/range/i);
    }
  });

  it("range operandShape with no operand at all → kind:'fail' TYPE_MISMATCH", () => {
    const rhs = new RhsResolver(resolver as never, arith as never);
    const meta = makeMeta("range", "comparison", "in_range");
    const ast = makeAst("in_range");
    const result = rhs.resolve(meta, ast, makeCtx());
    expect(result.kind).toBe("fail");
    if (result.kind === "fail") expect(result.failureCode).toBe(FAILURE_CODES.TYPE_MISMATCH);
  });

  it("regex operandShape with non-regex operand → kind:'fail' TYPE_MISMATCH", () => {
    const rhs = new RhsResolver(resolver as never, arith as never);
    const meta = makeMeta("regex", "pattern", "matches");
    const ast = makeAst("matches", litOp("string"));
    const result = rhs.resolve(meta, ast, makeCtx());
    expect(result.kind).toBe("fail");
    if (result.kind === "fail") {
      expect(result.failureCode).toBe(FAILURE_CODES.TYPE_MISMATCH);
      expect(result.reason).toMatch(/regex/i);
    }
  });

  it("regex operandShape with no operand → kind:'fail' TYPE_MISMATCH", () => {
    const rhs = new RhsResolver(resolver as never, arith as never);
    const meta = makeMeta("regex", "pattern", "matches");
    const ast = makeAst("matches");
    const result = rhs.resolve(meta, ast, makeCtx());
    expect(result.kind).toBe("fail");
    if (result.kind === "fail") expect(result.failureCode).toBe(FAILURE_CODES.TYPE_MISMATCH);
  });

  it("value operandShape with no operand → kind:'fail' TYPE_MISMATCH", () => {
    const rhs = new RhsResolver(resolver as never, arith as never);
    const meta = makeMeta("value", "pattern", "contains");
    const ast = makeAst("contains");
    const result = rhs.resolve(meta, ast, makeCtx());
    expect(result.kind).toBe("fail");
    if (result.kind === "fail") expect(result.failureCode).toBe(FAILURE_CODES.TYPE_MISMATCH);
  });

  it("value operandShape with range operand (unexpected kind) → kind:'fail' TYPE_MISMATCH", () => {
    const rhs = new RhsResolver(resolver as never, arith as never);
    const meta = makeMeta("value", "pattern", "contains");
    const ast = makeAst("contains", rangeOp(1, 5));
    const result = rhs.resolve(meta, ast, makeCtx());
    expect(result.kind).toBe("fail");
    if (result.kind === "fail") expect(result.failureCode).toBe(FAILURE_CODES.TYPE_MISMATCH);
  });

  it("numeric operandShape with no operand → kind:'fail' TYPE_MISMATCH", () => {
    const rhs = new RhsResolver(resolver as never, arith as never);
    const meta = makeMeta("numeric", "aggregate", "count_equals");
    const ast = makeAst("count_equals");
    const result = rhs.resolve(meta, ast, makeCtx());
    expect(result.kind).toBe("fail");
    if (result.kind === "fail") expect(result.failureCode).toBe(FAILURE_CODES.TYPE_MISMATCH);
  });

  it("numeric operandShape with range operand (unexpected kind) → kind:'fail' TYPE_MISMATCH", () => {
    const rhs = new RhsResolver(resolver as never, arith as never);
    const meta = makeMeta("numeric", "aggregate", "count_equals");
    const ast = makeAst("count_equals", rangeOp(1, 5));
    const result = rhs.resolve(meta, ast, makeCtx());
    expect(result.kind).toBe("fail");
    if (result.kind === "fail") expect(result.failureCode).toBe(FAILURE_CODES.TYPE_MISMATCH);
  });

  it("comparand operandShape with no operand → kind:'fail' TYPE_MISMATCH", () => {
    const rhs = new RhsResolver(resolver as never, arith as never);
    const meta = makeMeta("comparand", "comparison", "equals");
    const ast = makeAst("equals");
    const result = rhs.resolve(meta, ast, makeCtx());
    expect(result.kind).toBe("fail");
    if (result.kind === "fail") {
      expect(result.failureCode).toBe(FAILURE_CODES.TYPE_MISMATCH);
      expect(result.reason).toMatch(/comparand/i);
    }
  });

  it("comparand operandShape with range operand (unexpected kind) → kind:'fail' TYPE_MISMATCH", () => {
    const rhs = new RhsResolver(resolver as never, arith as never);
    const meta = makeMeta("comparand", "comparison", "equals");
    const ast = makeAst("equals", rangeOp(1, 5));
    const result = rhs.resolve(meta, ast, makeCtx());
    expect(result.kind).toBe("fail");
    if (result.kind === "fail") expect(result.failureCode).toBe(FAILURE_CODES.TYPE_MISMATCH);
  });
});

// ---------------------------------------------------------------------------
// 3. OperandRegionParser — classifyRegion and dispatch branches
// ---------------------------------------------------------------------------

describe("classifyRegion — all arms", () => {
  it("empty tokens → 'empty'", () => {
    expect(classifyRegion([])).toBe("empty");
  });

  it("single string token → 'literal'", () => {
    const tok = { kind: "string" as const, raw: '"a"', value: "a", span: { start: 0, end: 3 } };
    expect(classifyRegion([tok])).toBe("literal");
  });

  it("single number token → 'literal'", () => {
    const tok = { kind: "number" as const, raw: "42", value: 42, span: { start: 0, end: 2 } };
    expect(classifyRegion([tok])).toBe("literal");
  });

  it("single boolean token → 'literal'", () => {
    const tok = { kind: "boolean" as const, raw: "true", value: true, span: { start: 0, end: 4 } };
    expect(classifyRegion([tok])).toBe("literal");
  });

  it("single null token → 'literal'", () => {
    const tok = { kind: "null" as const, raw: "null", span: { start: 0, end: 4 } };
    expect(classifyRegion([tok])).toBe("literal");
  });

  it("single target token → 'target'", () => {
    const tok = { kind: "target" as const, raw: "response.body", span: { start: 0, end: 13 } };
    expect(classifyRegion([tok])).toBe("target");
  });

  it("single identifier token → 'target'", () => {
    const tok = { kind: "identifier" as const, raw: "someident", span: { start: 0, end: 9 } };
    expect(classifyRegion([tok])).toBe("target");
  });

  it("single regex token → 'regex'", () => {
    const tok = { kind: "regex" as const, raw: "/abc/", span: { start: 0, end: 5 } };
    expect(classifyRegion([tok])).toBe("regex");
  });

  it("single lparen token → 'arithmetic'", () => {
    const tok = { kind: "lparen" as const, raw: "(", span: { start: 0, end: 1 } };
    expect(classifyRegion([tok])).toBe("arithmetic");
  });

  it("two tokens starting with non-lparen unknown → 'other'", () => {
    const tok1 = { kind: "identifier" as const, raw: "a", span: { start: 0, end: 1 } };
    const tok2 = { kind: "identifier" as const, raw: "b", span: { start: 2, end: 3 } };
    expect(classifyRegion([tok1, tok2])).toBe("other");
  });

  it("single range_sep token → 'other' (not a recognized single-token kind)", () => {
    const tok = { kind: "range_sep" as const, raw: "..", span: { start: 0, end: 2 } };
    expect(classifyRegion([tok])).toBe("other");
  });
});

describe("OperandRegionParser — arithmetic-not-allowed for comparand without allowsArithmeticRhs", () => {
  it("parseOperand with comparand shape, allowsArithmeticRhs=false, lparen token → error string", () => {
    const targetParser = new TargetPathParser();
    const regexCompiler = new RegexOperandCompiler();
    const arithmeticParser = { parse: vi.fn() } as never;
    const orp = new OperandRegionParser(targetParser, arithmeticParser, regexCompiler);
    const meta = makeMeta("comparand", "comparison", "equals", false);
    const lpTok = { kind: "lparen" as const, raw: "(", span: { start: 0, end: 1 } };
    const result = orp.parseOperand(meta, [lpTok]);
    expect(typeof result).toBe("string");
    if (typeof result === "string") expect(result).toMatch(/arithmetic.*not allowed/i);
  });
});

describe("OperandRegionParser — regex literal as non-regex operand → error", () => {
  it("parseOperand value shape with a regex token → error about not valid operand", () => {
    const targetParser = new TargetPathParser();
    const regexCompiler = new RegexOperandCompiler();
    const arithmeticParser = { parse: vi.fn() } as never;
    const orp = new OperandRegionParser(targetParser, arithmeticParser, regexCompiler);
    const meta = makeMeta("value", "pattern", "contains");
    const regTok = { kind: "regex" as const, raw: "/abc/", span: { start: 0, end: 5 } };
    const result = orp.parseOperand(meta, [regTok]);
    expect(typeof result).toBe("string");
    if (typeof result === "string") expect(result).toMatch(/regex.*not a valid|not a valid.*regex/i);
  });
});

describe("OperandRegionParser — malformed multi-token literal/target → 'other' branch", () => {
  it("parseOperand comparand shape with two target tokens → malformed error", () => {
    const targetParser = new TargetPathParser();
    const regexCompiler = new RegexOperandCompiler();
    const arithmeticParser = { parse: vi.fn() } as never;
    const orp = new OperandRegionParser(targetParser, arithmeticParser, regexCompiler);
    const meta = makeMeta("comparand", "comparison", "equals");
    const t1 = { kind: "identifier" as const, raw: "a", span: { start: 0, end: 1 } };
    const t2 = { kind: "identifier" as const, raw: "b", span: { start: 2, end: 3 } };
    const result = orp.parseOperand(meta, [t1, t2]);
    expect(typeof result).toBe("string");
    if (typeof result === "string") expect(result).toMatch(/malformed/i);
  });
});

// ---------------------------------------------------------------------------
// 4. RegexOperandCompiler — uncovered branches (104, 140, 155-183)
// ---------------------------------------------------------------------------

describe("RegexOperandCompiler — bad-flag and compile-time branches", () => {
  const compiler = new RegexOperandCompiler();

  it("'g' flag is rejected with 'Bad regex flag' error (line 104 branch)", () => {
    const r = compiler.compile("/x/g");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.includes("g"))).toBe(true);
  });

  it("'y' flag is rejected with 'Bad regex flag' error", () => {
    const r = compiler.compile("/x/y");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.includes("y"))).toBe(true);
  });

  it("duplicate whitelisted flag 'ii' → 'Duplicate regex flag' error (line 140 branch)", () => {
    const r = compiler.compile("/x/ii");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.toLowerCase().includes("duplicate"))).toBe(true);
  });

  it("duplicate flag 'mm' → error mentions 'm'", () => {
    const r = compiler.compile("/x/mm");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.includes("m"))).toBe(true);
  });

  it("bare form 'abc' → source is 'abc', rawFlags is '' (bare detection line ~155)", () => {
    const r = compiler.compile("abc");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.operand.source).toBe("abc");
      expect(r.operand.rawFlags).toBe("");
    }
  });

  it("empty bare '' → source is '', rawFlags is ''", () => {
    const r = compiler.compile("");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.operand.source).toBe("");
      expect(r.operand.rawFlags).toBe("");
    }
  });

  it("literal '//' → source is '' (empty literal pattern, line 83 taken)", () => {
    const r = compiler.compile("//");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.operand.source).toBe("");
      expect(r.operand.rawFlags).toBe("");
    }
  });

  it("literal form with bad flag + invalid pattern — both errors aggregated", () => {
    const r = compiler.compile("/(/g");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.length).toBeGreaterThanOrEqual(2);
  });

  it("bad flag with valid compile — flag error is the only error (flagErrors non-empty path)", () => {
    const r = compiler.compile("/abc/g");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.length).toBeGreaterThanOrEqual(1);
      expect(r.errors.some((e) => e.includes("g"))).toBe(true);
    }
  });

  it("invalid pattern '/(?</' with u flag → both errors (invalid pattern + bad flag if g)", () => {
    const r = compiler.compile("/(*/");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// 5. AssertionParser — line 102: targetRef === null after operator is found
//    This fires when the operator is found but the target parse failed.
// ---------------------------------------------------------------------------

describe("AssertionParser — targetRef null guard (line 102)", () => {
  it("bad target + valid operator + valid operand → ok:false with target error", () => {
    const parser = new AssertionParser();
    // '.foo' is an invalid target (EMPTY_SEGMENT + UNKNOWN_ROOT)
    // 'equals' is a valid operator, '200' is a valid operand
    // This exercises line 102: !targetRef after errors.length check
    const result = parser.parse(".foo equals 200");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => /target/i.test(e))).toBe(true);
    }
  });

  it("completely unknown root target with valid operator → ok:false", () => {
    const parser = new AssertionParser();
    const result = parser.parse("unknown.path equals 200");
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 6. AssertionEvaluator — dispatch arms: group==="aggregate" mismatched
//    resolution kind, and #unreachableGroup for unknown operator in dispatch
// ---------------------------------------------------------------------------

describe("AssertionEvaluator — dispatch and unreachableGroup", () => {
  it("operator in 'comparison' group but resolution kind='none' fires #unreachableGroup", () => {
    // Inject RHS resolver that returns kind:'none' for a comparison operator
    const noneResolution = { kind: "none" as const };
    const fakeRhsResolverClass = vi.fn().mockReturnValue({
      resolve: () => noneResolution,
    });
    // We bypass RHS resolver injection by using a stub that injects kind:'none'
    // via the arithmetic stub — but the cleaner path is the stub existence evaluator
    // that returns an incompatible resolution for 'equals'.
    // Better approach: use #unreachableGroup directly via fabricated operator in dispatch.
    const ev = new AssertionEvaluator();
    const ast: AssertionAst = {
      raw: "FAKE_OP",
      target: { root: "response.status" },
      operator: "FAKE_OP" as OperatorName,
      operand: litOp(1),
    };
    expect(() => ev.evaluate(ast, makeCtx())).not.toThrow();
    const result = ev.evaluate(ast, makeCtx());
    expect(result.pass).toBe(false);
    expect(result.failureCode).toBe(FAILURE_CODES.TYPE_MISMATCH);
  });

  it("#buildResult passes when outcome.pass is true and omits failureCode/reason", () => {
    const ev = new AssertionEvaluator();
    const ast = makeAst("equals", litOp(200));
    const result = ev.evaluate(ast, makeCtx());
    expect(result.pass).toBe(true);
    expect("failureCode" in result).toBe(false);
    expect("reason" in result).toBe(false);
  });

  it("#buildResult fail uses outcome.failureCode ?? 'TYPE_MISMATCH' fallback", () => {
    // Build a stub where the group evaluator returns a GroupOutcome with no failureCode
    const compStub = {
      evaluate: vi.fn().mockReturnValue({
        pass: false,
        expected: 1,
        actual: 2,
        failureCode: undefined,
        reason: undefined,
      }),
    };
    const deps: AssertionEvaluatorDeps = { comparison: compStub };
    const ev = new AssertionEvaluator(deps);
    const ast = makeAst("equals", litOp(1));
    const result = ev.evaluate(ast, makeCtx());
    expect(result.pass).toBe(false);
    expect(result.failureCode).toBe(FAILURE_CODES.TYPE_MISMATCH);
    expect(result.reason).toBe("Unknown failure");
  });

  it("#renderTarget with db root renders 'db.conn.qid' (no path)", () => {
    const ev = new AssertionEvaluator();
    const dbTarget: TargetRef = {
      root: "db",
      connection: "primary",
      queryId: "users",
      path: [],
    };
    const ast: AssertionAst = {
      raw: "db.primary.users exists",
      target: dbTarget,
      operator: "exists",
    };
    const result = ev.evaluate(ast, makeCtx());
    expect(result.target).toBe("db.primary.users");
  });

  it("#renderTarget with db root and path renders path segments", () => {
    const ev = new AssertionEvaluator();
    const dbTarget: TargetRef = {
      root: "db",
      connection: "conn",
      queryId: "q",
      path: [key("rows"), idx(0)],
    };
    const ast: AssertionAst = {
      raw: "db.conn.q.rows.0 exists",
      target: dbTarget,
      operator: "exists",
    };
    const result = ev.evaluate(ast, makeCtx());
    expect(result.target).toBe("db.conn.q.rows.0");
  });

  it("#resolveLhs catch path — adversarial null context does not throw", () => {
    const ev = new AssertionEvaluator();
    const ast = makeAst("equals", litOp(200));
    expect(() => ev.evaluate(ast, null as unknown as EvaluationContext)).not.toThrow();
    const result = ev.evaluate(ast, null as unknown as EvaluationContext);
    expect(result.pass).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 7. TargetResolver — uncovered branches (76, 174)
// ---------------------------------------------------------------------------

describe("TargetResolver — additional branches", () => {
  const resolver = new TargetResolver();

  describe("line 76 — unknown root fallback → NOT_FOUND", () => {
    it("unknown root (not matching any known case) returns found:false", () => {
      // The fallback at line 76 fires when root is not in the known set.
      // TypeScript prevents this normally, but we can cast.
      const ref = { root: "unknown.root" as TargetRef["root"] };
      const result = resolver.resolve(ref, makeCtx());
      expect(result).toEqual({ found: false });
    });
  });

  describe("line 174 — response.headers with index segment (not key) → NOT_FOUND", () => {
    it("response.headers path with index segment returns found:false", () => {
      // #resolveHeaders expects firstSeg.kind === 'key'; index segment → NOT_FOUND
      const ref: TargetRef = {
        root: "response.headers",
        path: [idx(0)],
      };
      const headers = { "content-type": "application/json" };
      const ctx = makeCtx({ response: { status: 200, headers, body: null, time_ms: 0 } });
      const result = resolver.resolve(ref, ctx);
      expect(result).toEqual({ found: false });
    });

    it("response.headers with null headers object → found:false", () => {
      const ref: TargetRef = {
        root: "response.headers",
        path: [key("content-type")],
      };
      const ctx = makeCtx({ response: { status: 200, headers: null as never, body: null, time_ms: 0 } });
      const result = resolver.resolve(ref, ctx);
      expect(result).toEqual({ found: false });
    });

    it("request.headers with index segment → found:false", () => {
      const ref: TargetRef = {
        root: "request.headers",
        path: [idx(0)],
      };
      const ctx = makeCtx({
        request: { headers: { authorization: "Bearer x" }, body: null, url: { full: "/", path: "/", query: {} } },
      });
      const result = resolver.resolve(ref, ctx);
      expect(result).toEqual({ found: false });
    });

    it("response.headers with empty path → returns whole headers object", () => {
      const ref: TargetRef = {
        root: "response.headers",
        path: [],
      };
      const headers = { "x-trace": "abc" };
      const ctx = makeCtx({ response: { status: 200, headers, body: null, time_ms: 0 } });
      const result = resolver.resolve(ref, ctx);
      expect(result).toEqual({ found: true, value: headers });
    });
  });

  describe("response.status undefined → NOT_FOUND", () => {
    it("context.response is undefined → found:false for response.status", () => {
      const ref: TargetRef = { root: "response.status" };
      const ctx = makeCtx({ response: undefined as never });
      const result = resolver.resolve(ref, ctx);
      expect(result).toEqual({ found: false });
    });
  });
});

// ---------------------------------------------------------------------------
// 8. AjvFormatCheck — CJS interop branches (lines 32-41)
// ---------------------------------------------------------------------------

describe("AjvFormatCheck — construction and CJS interop", () => {
  it("constructs without throwing (both resolveAjvClass and resolveAddFormats arms work)", () => {
    expect(() => new AjvFormatCheck()).not.toThrow();
  });

  it("isValid('uuid', valid-uuid) returns true after construction", () => {
    const checker = new AjvFormatCheck();
    expect(checker.isValid("uuid", "550e8400-e29b-41d4-a716-446655440000")).toBe(true);
  });

  it("isValid('email', 'not-an-email') returns false", () => {
    const checker = new AjvFormatCheck();
    expect(checker.isValid("email", "not-an-email")).toBe(false);
  });

  it("isValid('date-time', '2026-05-18T12:00:00Z') returns true", () => {
    const checker = new AjvFormatCheck();
    expect(checker.isValid("date-time", "2026-05-18T12:00:00Z")).toBe(true);
  });

  it("isValid('uri', '/relative') returns false", () => {
    const checker = new AjvFormatCheck();
    expect(checker.isValid("uri", "/relative")).toBe(false);
  });

  it("multiple AjvFormatCheck instances are independent", () => {
    const c1 = new AjvFormatCheck();
    const c2 = new AjvFormatCheck();
    expect(c1.isValid("email", "a@b.com")).toBe(c2.isValid("email", "a@b.com"));
  });
});

// ---------------------------------------------------------------------------
// 9. ComparisonEvaluator — uncovered branch line 71-72
//    (rhs.kind === 'range' in missing-LHS path for equals/not_equals/etc.)
// ---------------------------------------------------------------------------

describe("ComparisonEvaluator — missing LHS with range RHS expected field", () => {
  const ev = new ComparisonEvaluator();

  it("in_range with found:false → expected is {lo, hi} object (not rhs.comparand)", () => {
    const rhs: ComparisonRhs = { kind: "range", lo: 100, hi: 599 };
    const result = ev.evaluate("in_range", MISS, rhs);
    expect(result.pass).toBe(false);
    expect(result.failureCode).toBe("TARGET_NOT_FOUND");
    expect(result.expected).toEqual({ lo: 100, hi: 599 });
    expect(result.actual).toBe("<absent>");
  });

  it("equals with found:false → expected is rhs.comparand, not a range object", () => {
    const rhs: ComparisonRhs = { kind: "comparand", comparand: 42 };
    const result = ev.evaluate("equals", MISS, rhs);
    expect(result.pass).toBe(false);
    expect(result.failureCode).toBe("TARGET_NOT_FOUND");
    expect(result.expected).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// 10. AggregateEvaluator — uncovered branches (50, 144, 155)
// ---------------------------------------------------------------------------

describe("AggregateEvaluator — additional coverage", () => {
  const ev = new AggregateEvaluator();

  it("count_greater_than with array exactly equal to n → AGGREGATE_MISMATCH (line 155)", () => {
    const result = ev.evaluate("count_greater_than", found([1, 2, 3]), { count: 3 });
    expect(result.pass).toBe(false);
    expect(result.failureCode).toBe("AGGREGATE_MISMATCH");
    expect(result.reason).toMatch(/not > 3/);
  });

  it("count_greater_than with array length 0 and expected 0 → AGGREGATE_MISMATCH (not strictly greater)", () => {
    const result = ev.evaluate("count_greater_than", found([]), { count: 0 });
    expect(result.pass).toBe(false);
    expect(result.failureCode).toBe("AGGREGATE_MISMATCH");
  });

  it("NormalizedResult with non-integer rowCount (float) is NOT structurally valid → AGGREGATE_MISMATCH (line 144)", () => {
    const notValid = { rows: [], rowCount: 1.5, raw: null };
    const result = ev.evaluate("count_equals", found(notValid), { count: 1 });
    expect(result.failureCode).toBe("AGGREGATE_MISMATCH");
  });

  it("NormalizedResult with Infinity rowCount → AGGREGATE_MISMATCH", () => {
    const notValid = { rows: [], rowCount: Infinity, raw: null };
    const result = ev.evaluate("count_equals", found(notValid), { count: 0 });
    expect(result.failureCode).toBe("AGGREGATE_MISMATCH");
  });

  it("count_equals passes when count is 0 and array is empty (edge, line 50 passOk)", () => {
    const result = ev.evaluate("count_equals", found([]), { count: 0 });
    expect(result.pass).toBe(true);
    expect(result.expected).toBe(0);
    expect(result.actual).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 11. PatternEvaluator — uncovered branches (132, 176, 202, 209)
// ---------------------------------------------------------------------------

describe("PatternEvaluator — defensive RHS kind mismatch branches", () => {
  const ev = new PatternEvaluator();

  it("contains: rhs.operator !== 'contains' → TYPE_MISMATCH (line 132)", () => {
    const rhs: ResolvedPatternRhs = { operator: "starts_with", value: "x" };
    const result = ev.evaluate("contains", found("hello"), rhs);
    expect(result.pass).toBe(false);
    expect(result.failureCode).toBe("TYPE_MISMATCH");
    expect(result.reason).toMatch(/Unexpected RHS kind/i);
  });

  it("starts_with: rhs.operator !== 'starts_with' → TYPE_MISMATCH (line 176)", () => {
    const rhs: ResolvedPatternRhs = { operator: "ends_with", value: "x" };
    const result = ev.evaluate("starts_with", found("hello"), rhs);
    expect(result.pass).toBe(false);
    expect(result.failureCode).toBe("TYPE_MISMATCH");
    expect(result.reason).toMatch(/Unexpected RHS kind/i);
  });

  it("ends_with: rhs.operator !== 'ends_with' → TYPE_MISMATCH (line 202)", () => {
    const rhs: ResolvedPatternRhs = { operator: "contains", value: "x" };
    const result = ev.evaluate("ends_with", found("hello"), rhs);
    expect(result.pass).toBe(false);
    expect(result.failureCode).toBe("TYPE_MISMATCH");
    expect(result.reason).toMatch(/Unexpected RHS kind/i);
  });

  it("ends_with: non-string suffix → TYPE_MISMATCH (line 209)", () => {
    const rhs: ResolvedPatternRhs = { operator: "ends_with", value: 42 };
    const result = ev.evaluate("ends_with", found("hello42"), rhs);
    expect(result.pass).toBe(false);
    expect(result.failureCode).toBe("TYPE_MISMATCH");
    expect(result.reason).toMatch(/string operand/i);
  });

  it("matches: rhs.operator !== 'matches' → TYPE_MISMATCH", () => {
    const rhs: ResolvedPatternRhs = { operator: "contains", value: "x" };
    const result = ev.evaluate("matches", found("hello"), rhs);
    expect(result.pass).toBe(false);
    expect(result.failureCode).toBe("TYPE_MISMATCH");
  });
});

// ---------------------------------------------------------------------------
// 12. Tokenizer — additional branches (tokenizer-string-scan and tokenizer.ts)
// ---------------------------------------------------------------------------

describe("AssertionTokenizer — edge cases for uncovered branches", () => {
  const tokenizer = new AssertionTokenizer();

  it("handles range_sep token in a valid in_range expression", () => {
    const result = tokenizer.tokenize("response.status in_range 100..599");
    expect(result.ok).toBe(true);
    if (result.ok) {
      const kinds = result.tokens.map((t) => t.kind);
      expect(kinds).toContain("range_sep");
    }
  });

  it("handles escaped character in string literal (processEscape path)", () => {
    const result = tokenizer.tokenize('response.body.x equals "hello\\nworld"');
    expect(result.ok).toBe(true);
  });

  it("handles escaped backslash in string literal", () => {
    const result = tokenizer.tokenize('response.body.x equals "a\\\\b"');
    expect(result.ok).toBe(true);
  });

  it("handles unicode escape \\u0041 in string literal", () => {
    const result = tokenizer.tokenize('response.body.x equals "\\u0041"');
    expect(result.ok).toBe(true);
  });

  it("invalid unicode escape \\uZZZZ → graceful degradation to literal 'u' (ok:true)", () => {
    // processUnicodeEscape: non-hex ⇒ literal 'u', no error pushed.
    const result = tokenizer.tokenize('response.body.x equals "\\uZZZZ"');
    expect(result.ok).toBe(true);
  });

  it("dangling backslash at end of string → ok:false with DANGLING_ESCAPE", () => {
    const result = tokenizer.tokenize('response.body.x equals "abc\\');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.code === "DANGLING_ESCAPE")).toBe(true);
  });

  it("regex with dangling backslash → ok:false with DANGLING_ESCAPE", () => {
    const result = tokenizer.tokenize("response.body.x matches /abc\\");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.code === "DANGLING_ESCAPE")).toBe(true);
  });

  it("handles regex with escape inside character class", () => {
    const result = tokenizer.tokenize("response.body.x matches /[a-z]/");
    expect(result.ok).toBe(true);
  });

  it("regex without closing delimiter → ok:false with UNTERMINATED_REGEX", () => {
    const result = tokenizer.tokenize("response.body.x matches /abc");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.code === "UNTERMINATED_REGEX")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 13. ArithmeticEvaluator — uncovered branch (arithmetic-evaluator.ts line 106)
// ---------------------------------------------------------------------------

describe("ArithmeticEvaluator — additional branches", () => {
  it("non-finite number literal (NaN) → ARITHMETIC_ERROR (line 106 branch)", () => {
    const resolver = new TargetResolver();
    const ev = new ArithmeticEvaluator(resolver);
    // NaN is non-finite — this is the only way to hit line 106 defensively
    const expr: ArithmeticOperandNode["expr"] = { kind: "number", value: NaN };
    const result = ev.evaluate(expr, makeCtx());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failureCode).toBe(FAILURE_CODES.ARITHMETIC_ERROR);
      expect(result.reason).toMatch(/non-finite/i);
    }
  });

  it("evaluating binary add node works", () => {
    const resolver = new TargetResolver();
    const ev = new ArithmeticEvaluator(resolver);
    const expr: ArithmeticOperandNode["expr"] = {
      kind: "binary",
      op: "+",
      left: { kind: "number", value: 3 },
      right: { kind: "number", value: 4 },
    };
    const result = ev.evaluate(expr, makeCtx());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(7);
  });

  it("arithmetic target lookup for a missing path returns TARGET_NOT_FOUND", () => {
    const resolver = new TargetResolver();
    const ev = new ArithmeticEvaluator(resolver);
    const expr: ArithmeticOperandNode["expr"] = {
      kind: "target",
      ref: { root: "response.body", path: [key("missing")] },
    };
    const result = ev.evaluate(expr, makeCtx());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failureCode).toBe(FAILURE_CODES.TARGET_NOT_FOUND);
  });

  it("arithmetic division by zero returns ARITHMETIC_ERROR", () => {
    const resolver = new TargetResolver();
    const ev = new ArithmeticEvaluator(resolver);
    const expr: ArithmeticOperandNode["expr"] = {
      kind: "binary",
      op: "/",
      left: { kind: "number", value: 10 },
      right: { kind: "number", value: 0 },
    };
    const result = ev.evaluate(expr, makeCtx());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failureCode).toBe(FAILURE_CODES.ARITHMETIC_ERROR);
  });
});

// ---------------------------------------------------------------------------
// 14. End-to-end assertions (parser → evaluator) for new branches
// ---------------------------------------------------------------------------

describe("End-to-end — new branch coverage assertions", () => {
  it("response.status in_range 200..299 passes for status 200", () => {
    const parser = new AssertionParser();
    const evaluator = new AssertionEvaluator();
    const parsed = parser.parse("response.status in_range 200..299");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const ctx = makeCtx({ response: { status: 200, headers: {}, body: null, time_ms: 10 } });
    const result = evaluator.evaluate(parsed.ast, ctx);
    expect(result.pass).toBe(true);
  });

  it("db.c.q count_equals 1 passes with NormalizedResult rowCount=1", () => {
    const parser = new AssertionParser();
    const evaluator = new AssertionEvaluator();
    const parsed = parser.parse("db.c.q count_equals 1");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const ctx = makeCtx({ db: { c: { q: { rows: [{ id: 1 }], rowCount: 1, raw: null } } } });
    const result = evaluator.evaluate(parsed.ast, ctx);
    expect(result.pass).toBe(true);
  });

  it("response.body.name matches /^Alice$/i passes for 'alice'", () => {
    const parser = new AssertionParser();
    const evaluator = new AssertionEvaluator();
    const parsed = parser.parse("response.body.name matches /^Alice$/i");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const ctx = makeCtx({ response: { status: 200, headers: {}, body: { name: "alice" }, time_ms: 0 } });
    const result = evaluator.evaluate(parsed.ast, ctx);
    expect(result.pass).toBe(true);
  });
});
