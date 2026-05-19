import { describe, it, expect, vi } from "vitest";

import { RhsResolver } from "../../../src/assertions/rhs-resolver.js";
import type { RhsResolution } from "../../../src/assertions/rhs-resolver.js";
import { FAILURE_CODES } from "../../../src/assertions/index.js";
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
} from "../../../src/assertions/index.js";
import type { OperatorMeta } from "../../../src/assertions/operator-registry.js";

/**
 * Unit tests for RhsResolver (src/assertions/rhs-resolver.ts).
 *
 * Exercises every RhsResolution arm:
 *   none  → kind:"none"
 *   comparand+literal → kind:"comparison" {kind:"comparand", comparand:value}
 *   comparand+target(found) → kind:"comparison" {kind:"comparand", comparand:r.value}
 *   comparand+target(not found) → kind:"fail" TARGET_NOT_FOUND   [R1]
 *   comparand+arith(ok) → kind:"comparison" {kind:"comparand", comparand:number}
 *   comparand+arith(fail ARITHMETIC_ERROR) → kind:"fail" [R2]
 *   comparand+arith(fail TYPE_MISMATCH) → kind:"fail" TYPE_MISMATCH verbatim [E6]
 *   range → kind:"comparison" {kind:"range", lo, hi}
 *   regex → kind:"pattern" {operator:"matches", operand}
 *   value+literal → kind:"pattern" {operator, value}
 *   value+target(found) → kind:"pattern"
 *   value+target(not found) → kind:"fail" TARGET_NOT_FOUND
 *   numeric+literal → kind:"aggregate" {count}
 *   numeric+target(found) → kind:"aggregate" {count:r.value}
 *   numeric+target(not found) → kind:"fail" TARGET_NOT_FOUND
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCtx(): EvaluationContext {
  return {
    request: {
      headers: {},
      body: null,
      url: { full: "http://localhost/", path: "/", query: {} },
    },
    response: { status: 200, headers: {}, body: null, time_ms: 50 },
    db: {},
  };
}

function makeMeta(
  operandShape: OperatorMeta["operandShape"],
  group: OperatorMeta["group"],
  name: OperatorName,
): OperatorMeta {
  return {
    name,
    group,
    operandShape,
    allowsArithmeticRhs: group === "comparison",
  };
}

function makeAst(operator: OperatorName, operand?: AssertionAst["operand"]): AssertionAst {
  const target: TargetRef = { root: "response.status" };
  return operand === undefined
    ? { raw: `${operator} raw`, target, operator }
    : { raw: `${operator} raw`, target, operator, operand };
}

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
  return {
    kind: "regex",
    source: "^a",
    rawFlags: "i",
    flags: ["i"],
    compiled: /^a/i,
  };
}

function arithOp(expr: ArithmeticOperandNode["expr"]): ArithmeticOperandNode {
  return { kind: "arithmetic", expr };
}

function makeStubResolver(found: boolean, value?: unknown) {
  return {
    resolve: vi.fn().mockReturnValue(found ? { found: true, value } : { found: false }),
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

// ---------------------------------------------------------------------------
// none shape
// ---------------------------------------------------------------------------

describe("RhsResolver — none operandShape", () => {
  it("returns kind:'none' for a nullary existence operator", () => {
    const resolver = makeStubResolver(true, 200);
    const arith = makeStubArith(true);
    const rhs = new RhsResolver(resolver as never, arith as never);
    const meta = makeMeta("none", "existence", "exists");
    const ast = makeAst("exists");
    const result = rhs.resolve(meta, ast, makeCtx());
    expect(result.kind).toBe("none");
  });

  it("returns kind:'none' for a nullary format operator", () => {
    const resolver = makeStubResolver(true, "val");
    const arith = makeStubArith(true);
    const rhs = new RhsResolver(resolver as never, arith as never);
    const meta = makeMeta("none", "format", "is_email");
    const ast = makeAst("is_email");
    const result = rhs.resolve(meta, ast, makeCtx());
    expect(result.kind).toBe("none");
  });
});

// ---------------------------------------------------------------------------
// comparand shape — literal
// ---------------------------------------------------------------------------

describe("RhsResolver — comparand+literal", () => {
  it("passes literal number as ComparisonRhs{kind:'comparand', comparand:42}", () => {
    const resolver = makeStubResolver(false);
    const arith = makeStubArith(false);
    const rhs = new RhsResolver(resolver as never, arith as never);
    const meta = makeMeta("comparand", "comparison", "equals");
    const ast = makeAst("equals", litOp(42));
    const result = rhs.resolve(meta, ast, makeCtx());
    expect(result.kind).toBe("comparison");
    if (result.kind !== "comparison") return;
    expect(result.rhs).toEqual({ kind: "comparand", comparand: 42 });
    expect(resolver.resolve).not.toHaveBeenCalled();
  });

  it("passes literal null as comparand:null (not a miss)", () => {
    const resolver = makeStubResolver(false);
    const arith = makeStubArith(false);
    const rhs = new RhsResolver(resolver as never, arith as never);
    const meta = makeMeta("comparand", "comparison", "equals");
    const ast = makeAst("equals", litOp(null));
    const result = rhs.resolve(meta, ast, makeCtx());
    expect(result.kind).toBe("comparison");
    if (result.kind !== "comparison") return;
    expect(result.rhs).toEqual({ kind: "comparand", comparand: null });
  });
});

// ---------------------------------------------------------------------------
// comparand shape — TargetOperand (R1)
// ---------------------------------------------------------------------------

describe("RhsResolver — comparand+TargetOperand", () => {
  it("found RHS ⇒ kind:'comparison' with resolved value", () => {
    const ref: TargetRef = { root: "request.body", path: [] };
    const resolver = makeStubResolver(true, 99);
    const arith = makeStubArith(false);
    const rhs = new RhsResolver(resolver as never, arith as never);
    const meta = makeMeta("comparand", "comparison", "equals");
    const ast = makeAst("equals", targetOp(ref));
    const result = rhs.resolve(meta, ast, makeCtx());
    expect(result.kind).toBe("comparison");
    if (result.kind !== "comparison") return;
    expect(result.rhs).toEqual({ kind: "comparand", comparand: 99 });
  });

  it("R1: not-found RHS ⇒ kind:'fail' TARGET_NOT_FOUND", () => {
    const ref: TargetRef = { root: "request.body", path: [{ kind: "key", key: "x" }] };
    const resolver = makeStubResolver(false);
    const arith = makeStubArith(false);
    const rhs = new RhsResolver(resolver as never, arith as never);
    const meta = makeMeta("comparand", "comparison", "equals");
    const ast = makeAst("equals", targetOp(ref));
    const result = rhs.resolve(meta, ast, makeCtx());
    expect(result.kind).toBe("fail");
    if (result.kind !== "fail") return;
    expect(result.failureCode).toBe(FAILURE_CODES.TARGET_NOT_FOUND);
  });

  it("R1: found:true with value:null is NOT a fail (null is a valid RHS)", () => {
    const ref: TargetRef = { root: "request.body", path: [] };
    const resolver = makeStubResolver(true, null);
    const arith = makeStubArith(false);
    const rhs = new RhsResolver(resolver as never, arith as never);
    const meta = makeMeta("comparand", "comparison", "equals");
    const ast = makeAst("equals", targetOp(ref));
    const result = rhs.resolve(meta, ast, makeCtx());
    expect(result.kind).toBe("comparison");
    if (result.kind !== "comparison") return;
    expect(result.rhs).toEqual({ kind: "comparand", comparand: null });
  });
});

// ---------------------------------------------------------------------------
// comparand shape — ArithmeticOperandNode (R2 + E6)
// ---------------------------------------------------------------------------

describe("RhsResolver — comparand+ArithmeticOperandNode", () => {
  const expr: ArithmeticOperandNode["expr"] = { kind: "number", value: 1 };

  it("arith ok ⇒ kind:'comparison' with the folded number", () => {
    const resolver = makeStubResolver(false);
    const arith = makeStubArith(true, { value: 108 });
    const rhs = new RhsResolver(resolver as never, arith as never);
    const meta = makeMeta("comparand", "comparison", "equals");
    const ast = makeAst("equals", arithOp(expr));
    const result = rhs.resolve(meta, ast, makeCtx());
    expect(result.kind).toBe("comparison");
    if (result.kind !== "comparison") return;
    expect(result.rhs).toEqual({ kind: "comparand", comparand: 108 });
  });

  it("R2: arith ARITHMETIC_ERROR ⇒ kind:'fail' propagated verbatim", () => {
    const resolver = makeStubResolver(false);
    const arith = makeStubArith(false, { failureCode: "ARITHMETIC_ERROR", reason: "div/0" });
    const rhs = new RhsResolver(resolver as never, arith as never);
    const meta = makeMeta("comparand", "comparison", "equals");
    const ast = makeAst("equals", arithOp(expr));
    const result = rhs.resolve(meta, ast, makeCtx());
    expect(result.kind).toBe("fail");
    if (result.kind !== "fail") return;
    expect(result.failureCode).toBe(FAILURE_CODES.ARITHMETIC_ERROR);
    expect(result.reason).toBe("div/0");
  });

  it("E6 LOCKED: arith TYPE_MISMATCH ⇒ kind:'fail' TYPE_MISMATCH (NOT remapped)", () => {
    const resolver = makeStubResolver(false);
    const arith = makeStubArith(false, {
      failureCode: "TYPE_MISMATCH",
      reason: "resolved to string",
    });
    const rhs = new RhsResolver(resolver as never, arith as never);
    const meta = makeMeta("comparand", "comparison", "equals");
    const ast = makeAst("equals", arithOp(expr));
    const result = rhs.resolve(meta, ast, makeCtx());
    expect(result.kind).toBe("fail");
    if (result.kind !== "fail") return;
    expect(result.failureCode).toBe(FAILURE_CODES.TYPE_MISMATCH);
    expect(result.reason).toBe("resolved to string");
  });
});

// ---------------------------------------------------------------------------
// range shape
// ---------------------------------------------------------------------------

describe("RhsResolver — range operandShape", () => {
  it("passes RangeOperand lo/hi as ComparisonRhs{kind:'range'}", () => {
    const resolver = makeStubResolver(false);
    const arith = makeStubArith(false);
    const rhs = new RhsResolver(resolver as never, arith as never);
    const meta = makeMeta("range", "comparison", "in_range");
    const ast = makeAst("in_range", rangeOp(100, 599));
    const result = rhs.resolve(meta, ast, makeCtx());
    expect(result.kind).toBe("comparison");
    if (result.kind !== "comparison") return;
    expect(result.rhs).toEqual({ kind: "range", lo: 100, hi: 599 });
  });
});

// ---------------------------------------------------------------------------
// regex shape
// ---------------------------------------------------------------------------

describe("RhsResolver — regex operandShape", () => {
  it("passes RegexOperand verbatim as ResolvedPatternRhs{operator:'matches'}", () => {
    const resolver = makeStubResolver(false);
    const arith = makeStubArith(false);
    const rhs = new RhsResolver(resolver as never, arith as never);
    const meta = makeMeta("regex", "pattern", "matches");
    const operand = regexOp();
    const ast = makeAst("matches", operand);
    const result = rhs.resolve(meta, ast, makeCtx());
    expect(result.kind).toBe("pattern");
    if (result.kind !== "pattern") return;
    expect(result.rhs).toMatchObject({ operator: "matches", operand });
  });
});

// ---------------------------------------------------------------------------
// value shape
// ---------------------------------------------------------------------------

describe("RhsResolver — value operandShape", () => {
  it("literal ⇒ kind:'pattern' with operator and value", () => {
    const resolver = makeStubResolver(false);
    const arith = makeStubArith(false);
    const rhs = new RhsResolver(resolver as never, arith as never);
    const meta = makeMeta("value", "pattern", "contains");
    const ast = makeAst("contains", litOp("Bearer "));
    const result = rhs.resolve(meta, ast, makeCtx());
    expect(result.kind).toBe("pattern");
    if (result.kind !== "pattern") return;
    expect(result.rhs).toMatchObject({ operator: "contains", value: "Bearer " });
  });

  it("target found ⇒ kind:'pattern' with resolved value", () => {
    const ref: TargetRef = { root: "request.body", path: [] };
    const resolver = makeStubResolver(true, "hello");
    const arith = makeStubArith(false);
    const rhs = new RhsResolver(resolver as never, arith as never);
    const meta = makeMeta("value", "pattern", "starts_with");
    const ast = makeAst("starts_with", targetOp(ref));
    const result = rhs.resolve(meta, ast, makeCtx());
    expect(result.kind).toBe("pattern");
    if (result.kind !== "pattern") return;
    expect(result.rhs).toMatchObject({ operator: "starts_with", value: "hello" });
  });

  it("R1: target not found ⇒ kind:'fail' TARGET_NOT_FOUND", () => {
    const ref: TargetRef = { root: "request.body", path: [{ kind: "key", key: "missing" }] };
    const resolver = makeStubResolver(false);
    const arith = makeStubArith(false);
    const rhs = new RhsResolver(resolver as never, arith as never);
    const meta = makeMeta("value", "pattern", "ends_with");
    const ast = makeAst("ends_with", targetOp(ref));
    const result = rhs.resolve(meta, ast, makeCtx());
    expect(result.kind).toBe("fail");
    if (result.kind !== "fail") return;
    expect(result.failureCode).toBe(FAILURE_CODES.TARGET_NOT_FOUND);
  });
});

// ---------------------------------------------------------------------------
// numeric shape
// ---------------------------------------------------------------------------

describe("RhsResolver — numeric operandShape", () => {
  it("literal number ⇒ kind:'aggregate' {count:value}", () => {
    const resolver = makeStubResolver(false);
    const arith = makeStubArith(false);
    const rhs = new RhsResolver(resolver as never, arith as never);
    const meta = makeMeta("numeric", "aggregate", "count_equals");
    const ast = makeAst("count_equals", litOp(3));
    const result = rhs.resolve(meta, ast, makeCtx());
    expect(result.kind).toBe("aggregate");
    if (result.kind !== "aggregate") return;
    expect(result.rhs).toEqual({ count: 3 });
  });

  it("target found ⇒ kind:'aggregate' {count:r.value}", () => {
    const ref: TargetRef = { root: "response.body", path: [] };
    const resolver = makeStubResolver(true, 5);
    const arith = makeStubArith(false);
    const rhs = new RhsResolver(resolver as never, arith as never);
    const meta = makeMeta("numeric", "aggregate", "count_greater_than");
    const ast = makeAst("count_greater_than", targetOp(ref));
    const result = rhs.resolve(meta, ast, makeCtx());
    expect(result.kind).toBe("aggregate");
    if (result.kind !== "aggregate") return;
    expect(result.rhs).toEqual({ count: 5 });
  });

  it("target found but non-number ⇒ kind:'aggregate' {count:value} NOT short-circuited", () => {
    // Only not-found short-circuits; found-but-wrong-type flows to AggregateEvaluator
    const ref: TargetRef = { root: "response.body", path: [] };
    const resolver = makeStubResolver(true, "notanumber");
    const arith = makeStubArith(false);
    const rhs = new RhsResolver(resolver as never, arith as never);
    const meta = makeMeta("numeric", "aggregate", "count_equals");
    const ast = makeAst("count_equals", targetOp(ref));
    const result = rhs.resolve(meta, ast, makeCtx());
    expect(result.kind).toBe("aggregate");
    if (result.kind !== "aggregate") return;
    expect(result.rhs).toEqual({ count: "notanumber" });
  });

  it("R1: target not found ⇒ kind:'fail' TARGET_NOT_FOUND", () => {
    const ref: TargetRef = { root: "response.body", path: [{ kind: "key", key: "ghost" }] };
    const resolver = makeStubResolver(false);
    const arith = makeStubArith(false);
    const rhs = new RhsResolver(resolver as never, arith as never);
    const meta = makeMeta("numeric", "aggregate", "count_equals");
    const ast = makeAst("count_equals", targetOp(ref));
    const result = rhs.resolve(meta, ast, makeCtx());
    expect(result.kind).toBe("fail");
    if (result.kind !== "fail") return;
    expect(result.failureCode).toBe(FAILURE_CODES.TARGET_NOT_FOUND);
  });
});
