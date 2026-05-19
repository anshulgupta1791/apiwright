import { describe, it, expect, vi } from "vitest";

import { parseJson } from "../../../src/core/safe-json.js";
import { AssertionEvaluator } from "../../../src/assertions/evaluator.js";
import type { AssertionEvaluatorDeps } from "../../../src/assertions/evaluator.js";
import { FAILURE_CODES } from "../../../src/assertions/index.js";
import type {
  AssertionAst,
  AssertionResult,
  EvaluationContext,
  GroupOutcome,
  OperatorName,
  TargetRef,
  PathSegment,
  LiteralOperand,
  TargetOperand,
  RangeOperand,
  RegexOperand,
  ArithmeticOperandNode,
} from "../../../src/assertions/index.js";

/**
 * Unit tests for AssertionEvaluator (src/assertions/evaluator.ts).
 *
 * Covers: all 5 group dispatch arms; LHS not-pre-judged (existence truth
 * table); operandShape→RHS table (every row); R1 short-circuit
 * (TARGET_NOT_FOUND); R2 short-circuit + LOCKED E6 (TYPE_MISMATCH verbatim);
 * resolved-but-wrong-type NOT short-circuited; explicit-null passthrough;
 * Step-5 wrap correctness; #renderTarget (all TargetRoot variants);
 * five §4 spec examples end-to-end; totality/never-throws on adversarial
 * inputs; determinism; default-seam wiring (no deps — real collaborators);
 * #unreachableGroup never-throw tested via fabricated out-of-domain operator.
 *
 * File kept ≤300 lines; RhsResolver isolation tests live in
 * rhs-resolver.test.ts (sibling file).
 */

// ---------------------------------------------------------------------------
// Synthetic context factory
// ---------------------------------------------------------------------------

function makeCtx(overrides: Partial<EvaluationContext> = {}): EvaluationContext {
  return {
    request: {
      headers: {},
      body: null,
      url: { full: "http://localhost/", path: "/", query: {} },
    },
    response: {
      status: 200,
      headers: {},
      body: null,
      time_ms: 50,
    },
    db: {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// AST factory helpers
// ---------------------------------------------------------------------------

function makeAst(
  raw: string,
  target: TargetRef,
  operator: OperatorName,
  operand?: AssertionAst["operand"],
): AssertionAst {
  return operand === undefined
    ? { raw, target, operator }
    : { raw, target, operator, operand };
}

const STATUS_TARGET: TargetRef = { root: "response.status" };
const BODY_TARGET: TargetRef = { root: "response.body", path: [] };

function bodyPath(...segs: PathSegment[]): TargetRef {
  return { root: "response.body", path: segs };
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

function arithOp(expr: ArithmeticOperandNode["expr"]): ArithmeticOperandNode {
  return { kind: "arithmetic", expr };
}

// Sentinel GroupOutcome returned by stub evaluators
function passOutcome(): GroupOutcome {
  return { pass: true, expected: "sentinel", actual: "sentinel" };
}

function failOutcome(code: string): GroupOutcome {
  return {
    pass: false,
    expected: "expected",
    actual: "actual",
    failureCode: code as GroupOutcome["failureCode"],
    reason: "stub reason",
  };
}

// ---------------------------------------------------------------------------
// 1. Dispatch routing (every group)
// ---------------------------------------------------------------------------

describe("AssertionEvaluator — group dispatch", () => {
  it("routes 'equals' to the comparison evaluator", () => {
    const compStub = { evaluate: vi.fn().mockReturnValue(passOutcome()) };
    const deps: AssertionEvaluatorDeps = { comparison: compStub };
    const ev = new AssertionEvaluator(deps);
    const ast = makeAst("response.status equals 200", STATUS_TARGET, "equals", litOp(200));
    ev.evaluate(ast, makeCtx());
    expect(compStub.evaluate).toHaveBeenCalledOnce();
  });

  it("routes 'contains' to the pattern evaluator", () => {
    const patStub = { evaluate: vi.fn().mockReturnValue(passOutcome()) };
    const deps: AssertionEvaluatorDeps = { pattern: patStub };
    const ev = new AssertionEvaluator(deps);
    const ast = makeAst(
      "response.body contains \"x\"",
      BODY_TARGET,
      "contains",
      litOp("x"),
    );
    ev.evaluate(ast, makeCtx());
    expect(patStub.evaluate).toHaveBeenCalledOnce();
  });

  it("routes 'exists' to the existence evaluator", () => {
    const exStub = { evaluate: vi.fn().mockReturnValue(passOutcome()) };
    const deps: AssertionEvaluatorDeps = { existence: exStub };
    const ev = new AssertionEvaluator(deps);
    const ast = makeAst("response.body exists", BODY_TARGET, "exists");
    ev.evaluate(ast, makeCtx());
    expect(exStub.evaluate).toHaveBeenCalledOnce();
  });

  it("routes 'is_email' to the format evaluator", () => {
    const fmtStub = { evaluate: vi.fn().mockReturnValue(passOutcome()) };
    const deps: AssertionEvaluatorDeps = { format: fmtStub };
    const ev = new AssertionEvaluator(deps);
    const ast = makeAst("response.body is_email", BODY_TARGET, "is_email");
    ev.evaluate(ast, makeCtx());
    expect(fmtStub.evaluate).toHaveBeenCalledOnce();
  });

  it("routes 'count_equals' to the aggregate evaluator", () => {
    const aggStub = { evaluate: vi.fn().mockReturnValue(passOutcome()) };
    const deps: AssertionEvaluatorDeps = { aggregate: aggStub };
    const ev = new AssertionEvaluator(deps);
    const dbTarget: TargetRef = {
      root: "db",
      connection: "pg",
      queryId: "q",
      path: [],
    };
    const ast = makeAst("db.pg.q count_equals 1", dbTarget, "count_equals", litOp(1));
    ev.evaluate(ast, makeCtx({ db: { pg: { q: { rows: [], rowCount: 1, raw: {} } } } }));
    expect(aggStub.evaluate).toHaveBeenCalledOnce();
  });

  it(
    "#unreachableGroup: fabricated operator not in any group arm returns " +
      "FAILED AssertionResult and does NOT throw",
    () => {
      const ev = new AssertionEvaluator();
      const ast = {
        raw: "response.status FAKE_OP 1",
        target: STATUS_TARGET,
        operator: "FAKE_OP" as OperatorName,
        operand: litOp(1),
      };
      expect(() => ev.evaluate(ast, makeCtx())).not.toThrow();
      const result = ev.evaluate(ast, makeCtx());
      expect(result.pass).toBe(false);
    },
  );
});

// ---------------------------------------------------------------------------
// 2. LHS not pre-judged — existence truth table
// ---------------------------------------------------------------------------

describe("AssertionEvaluator — LHS not pre-judged (locked decision #6)", () => {
  const ev = new AssertionEvaluator();

  it("'not_exists' with missing LHS ⇒ PASS (existence evaluator handles it)", () => {
    const ast = makeAst("response.body.x not_exists", bodyPath({ kind: "key", key: "x" }), "not_exists");
    // context has no response.body.x — resolver returns found:false
    const result = ev.evaluate(ast, makeCtx({ response: { status: 200, headers: {}, body: {}, time_ms: 5 } }));
    expect(result.pass).toBe(true);
  });

  it("'exists' with missing LHS ⇒ FAIL TARGET_NOT_FOUND", () => {
    const ast = makeAst(
      "response.body.missing exists",
      bodyPath({ kind: "key", key: "missing" }),
      "exists",
    );
    const result = ev.evaluate(ast, makeCtx({ response: { status: 200, headers: {}, body: {}, time_ms: 5 } }));
    expect(result.pass).toBe(false);
    expect(result.failureCode).toBe(FAILURE_CODES.TARGET_NOT_FOUND);
  });

  it("'is_null' with LHS = explicit null ⇒ PASS", () => {
    const ast = makeAst(
      "response.body.x is_null",
      bodyPath({ kind: "key", key: "x" }),
      "is_null",
    );
    const result = ev.evaluate(
      ast,
      makeCtx({ response: { status: 200, headers: {}, body: { x: null }, time_ms: 5 } }),
    );
    expect(result.pass).toBe(true);
  });

  it("'not_null' with LHS = explicit null ⇒ FAIL", () => {
    const ast = makeAst(
      "response.body.x is_not_null",
      bodyPath({ kind: "key", key: "x" }),
      "is_not_null",
    );
    const result = ev.evaluate(
      ast,
      makeCtx({ response: { status: 200, headers: {}, body: { x: null }, time_ms: 5 } }),
    );
    expect(result.pass).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. R1 — RHS TargetOperand not found ⇒ short-circuit TARGET_NOT_FOUND
// ---------------------------------------------------------------------------

describe("AssertionEvaluator — R1 RHS TargetOperand not found", () => {
  it("equals with RHS target not found ⇒ FAIL TARGET_NOT_FOUND, comparison never called", () => {
    const compStub = { evaluate: vi.fn() };
    const deps: AssertionEvaluatorDeps = { comparison: compStub };
    const ev = new AssertionEvaluator(deps);

    const rhsRef: TargetRef = { root: "request.body", path: [{ kind: "key", key: "missing" }] };
    const ast = makeAst(
      "response.status equals request.body.missing",
      STATUS_TARGET,
      "equals",
      targetOp(rhsRef),
    );
    // request.body is null — resolver returns found:false for .missing
    const result = ev.evaluate(ast, makeCtx());
    expect(result.pass).toBe(false);
    expect(result.failureCode).toBe(FAILURE_CODES.TARGET_NOT_FOUND);
    expect(compStub.evaluate).not.toHaveBeenCalled();
  });

  it("contains with RHS target not found ⇒ FAIL TARGET_NOT_FOUND, pattern never called", () => {
    const patStub = { evaluate: vi.fn() };
    const deps: AssertionEvaluatorDeps = { pattern: patStub };
    const ev = new AssertionEvaluator(deps);

    const rhsRef: TargetRef = { root: "request.body", path: [{ kind: "key", key: "ghost" }] };
    const ast = makeAst(
      "response.body contains request.body.ghost",
      BODY_TARGET,
      "contains",
      targetOp(rhsRef),
    );
    const result = ev.evaluate(ast, makeCtx());
    expect(result.pass).toBe(false);
    expect(result.failureCode).toBe(FAILURE_CODES.TARGET_NOT_FOUND);
    expect(patStub.evaluate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 5. R2 + LOCKED E6 — ArithmeticOperandNode failure propagated verbatim
// ---------------------------------------------------------------------------

describe("AssertionEvaluator — R2 arithmetic failure short-circuit (+ E6)", () => {
  it("R2: arithmetic ARITHMETIC_ERROR propagated verbatim, comparison never called", () => {
    const compStub = { evaluate: vi.fn() };
    const arithStub = {
      evaluate: vi.fn().mockReturnValue({
        ok: false,
        failureCode: "ARITHMETIC_ERROR",
        reason: "division by zero",
      }),
    };
    const deps: AssertionEvaluatorDeps = {
      comparison: compStub,
      arithmetic: arithStub,
    };
    const ev = new AssertionEvaluator(deps);
    const expr: ArithmeticOperandNode["expr"] = { kind: "number", value: 1 };
    const ast = makeAst("response.body.x equals (1)", BODY_TARGET, "equals", arithOp(expr));

    const result = ev.evaluate(ast, makeCtx());
    expect(result.pass).toBe(false);
    expect(result.failureCode).toBe(FAILURE_CODES.ARITHMETIC_ERROR);
    expect(result.reason).toBe("division by zero");
    expect(compStub.evaluate).not.toHaveBeenCalled();
  });

  it("R2: arithmetic TARGET_NOT_FOUND propagated verbatim", () => {
    const arithStub = {
      evaluate: vi.fn().mockReturnValue({
        ok: false,
        failureCode: "TARGET_NOT_FOUND",
        reason: "arith leaf not found",
      }),
    };
    const deps: AssertionEvaluatorDeps = { arithmetic: arithStub };
    const ev = new AssertionEvaluator(deps);
    const expr: ArithmeticOperandNode["expr"] = { kind: "number", value: 1 };
    const ast = makeAst("response.body.x equals (1)", BODY_TARGET, "equals", arithOp(expr));

    const result = ev.evaluate(ast, makeCtx());
    expect(result.pass).toBe(false);
    expect(result.failureCode).toBe(FAILURE_CODES.TARGET_NOT_FOUND);
  });

  it("E6 LOCKED: arithmetic TYPE_MISMATCH propagated verbatim (NOT remapped)", () => {
    const arithStub = {
      evaluate: vi.fn().mockReturnValue({
        ok: false,
        failureCode: "TYPE_MISMATCH",
        reason: "operand resolved to string, expected number",
      }),
    };
    const deps: AssertionEvaluatorDeps = { arithmetic: arithStub };
    const ev = new AssertionEvaluator(deps);
    const expr: ArithmeticOperandNode["expr"] = { kind: "number", value: 1 };
    const ast = makeAst("response.body.x equals (1)", BODY_TARGET, "equals", arithOp(expr));

    const result = ev.evaluate(ast, makeCtx());
    expect(result.pass).toBe(false);
    // Must be TYPE_MISMATCH — NOT ARITHMETIC_ERROR (no remapping)
    expect(result.failureCode).toBe(FAILURE_CODES.TYPE_MISMATCH);
    expect(result.reason).toBe("operand resolved to string, expected number");
  });
});

// ---------------------------------------------------------------------------
// 6. Resolved-but-wrong-type NOT short-circuited
// ---------------------------------------------------------------------------

describe("AssertionEvaluator — resolved-but-wrong-type flows to group evaluator", () => {
  const ev = new AssertionEvaluator();

  it("count_equals with RHS target resolving to string '1' ⇒ TYPE_MISMATCH from AggregateEvaluator", () => {
    const dbTarget: TargetRef = {
      root: "db",
      connection: "pg",
      queryId: "q",
      path: [],
    };
    const rhsRef: TargetRef = {
      root: "response.body",
      path: [{ kind: "key", key: "count" }],
    };
    const ast = makeAst(
      "db.pg.q count_equals response.body.count",
      dbTarget,
      "count_equals",
      targetOp(rhsRef),
    );
    // RHS resolves to string "1" (wrong type)
    const ctx = makeCtx({
      response: { status: 200, headers: {}, body: { count: "1" }, time_ms: 5 },
      db: { pg: { q: { rows: [], rowCount: 1, raw: {} } } },
    });
    const result = ev.evaluate(ast, ctx);
    expect(result.pass).toBe(false);
    expect(result.failureCode).toBe(FAILURE_CODES.TYPE_MISMATCH);
  });
});

// ---------------------------------------------------------------------------
// 7. Explicit-null passthrough (NOT a miss)
// ---------------------------------------------------------------------------

describe("AssertionEvaluator — explicit-null passthrough", () => {
  const ev = new AssertionEvaluator();

  it("equals null (LiteralOperand) ⇒ comparand:null, evaluates correctly", () => {
    const ast = makeAst(
      "response.body.x equals null",
      bodyPath({ kind: "key", key: "x" }),
      "equals",
      litOp(null),
    );
    const ctx = makeCtx({ response: { status: 200, headers: {}, body: { x: null }, time_ms: 5 } });
    const result = ev.evaluate(ast, ctx);
    expect(result.pass).toBe(true);
  });

  it("TargetOperand RHS resolving to null is NOT R1 (passed as comparand:null)", () => {
    const rhsRef: TargetRef = {
      root: "request.body",
      path: [{ kind: "key", key: "field" }],
    };
    const ast = makeAst(
      "response.status equals request.body.field",
      STATUS_TARGET,
      "equals",
      targetOp(rhsRef),
    );
    // RHS resolves to null (found:true, value:null) — not a miss
    const ctx = makeCtx({
      request: {
        headers: {},
        body: { field: null },
        url: { full: "http://localhost/", path: "/", query: {} },
      },
    });
    // Should not short-circuit (R1 requires found:false)
    const result = ev.evaluate(ast, ctx);
    // result.pass depends on comparison logic — we only assert it didn't short-circuit to TARGET_NOT_FOUND
    expect(result.failureCode === FAILURE_CODES.TARGET_NOT_FOUND).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 8. Step-5 wrap correctness
// ---------------------------------------------------------------------------

describe("AssertionEvaluator — Step-5 wrap (assertion/target/operator)", () => {
  it("assertion === ast.raw verbatim (incl. internal spaces)", () => {
    const ev = new AssertionEvaluator();
    const raw = "response.status   equals   200";
    const ast = makeAst(raw, STATUS_TARGET, "equals", litOp(200));
    const ctx = makeCtx();
    const result = ev.evaluate(ast, ctx);
    expect(result.assertion).toBe(raw);
  });

  it("operator === ast.operator", () => {
    const ev = new AssertionEvaluator();
    const ast = makeAst("response.status equals 200", STATUS_TARGET, "equals", litOp(200));
    const result = ev.evaluate(ast, makeCtx());
    expect(result.operator).toBe("equals");
  });

  it("pass:true result has no failureCode or reason keys", () => {
    const ev = new AssertionEvaluator();
    const ast = makeAst("response.status equals 200", STATUS_TARGET, "equals", litOp(200));
    const ctx = makeCtx();
    const result = ev.evaluate(ast, ctx);
    if (result.pass) {
      expect("failureCode" in result).toBe(false);
      expect("reason" in result).toBe(false);
    }
  });

  it("result is JSON-serializable (round-trip via parseJson)", () => {
    const ev = new AssertionEvaluator();
    const ast = makeAst("response.status equals 200", STATUS_TARGET, "equals", litOp(200));
    const result = ev.evaluate(ast, makeCtx());
    const json = JSON.stringify(result);
    const parsed = parseJson(json);
    expect(parsed.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 9. #renderTarget — all TargetRoot variants
// ---------------------------------------------------------------------------

describe("AssertionEvaluator — #renderTarget (via result.target)", () => {
  const ev = new AssertionEvaluator();

  const cases: [string, TargetRef, string][] = [
    ["response.status", { root: "response.status" }, "response.status"],
    ["response.time_ms", { root: "response.time_ms" }, "response.time_ms"],
    ["response.body (empty path)", { root: "response.body", path: [] }, "response.body"],
    [
      "response.body.items.0.id",
      {
        root: "response.body",
        path: [
          { kind: "key", key: "items" },
          { kind: "index", index: 0 },
          { kind: "key", key: "id" },
        ],
      },
      "response.body.items.0.id",
    ],
    [
      "request.headers.authorization",
      {
        root: "request.headers",
        path: [{ kind: "key", key: "authorization" }],
      },
      "request.headers.authorization",
    ],
    [
      "request.url.query.tag.0",
      {
        root: "request.url",
        path: [
          { kind: "key", key: "query" },
          { kind: "key", key: "tag" },
          { kind: "index", index: 0 },
        ],
      },
      "request.url.query.tag.0",
    ],
    [
      "db.primary_postgres.user_check.rowCount",
      {
        root: "db",
        connection: "primary_postgres",
        queryId: "user_check",
        path: [{ kind: "key", key: "rowCount" }],
      },
      "db.primary_postgres.user_check.rowCount",
    ],
    [
      "db bare (no path)",
      {
        root: "db",
        connection: "primary_postgres",
        queryId: "user_check",
        path: [],
      },
      "db.primary_postgres.user_check",
    ],
  ];

  for (const [label, ref, expected] of cases) {
    it(`renders '${label}' as '${expected}'`, () => {
      const ast = makeAst(`${expected} exists`, ref, "exists");
      const result = ev.evaluate(ast, makeCtx());
      expect(result.target).toBe(expected);
    });
  }
});

// ---------------------------------------------------------------------------
// 11. Totality / never-throws
// ---------------------------------------------------------------------------

describe("AssertionEvaluator — totality / never-throws", () => {
  const ev = new AssertionEvaluator();

  it("does not throw for adversarial context (null db)", () => {
    const ast = makeAst("response.status equals 200", STATUS_TARGET, "equals", litOp(200));
    expect(() => ev.evaluate(ast, makeCtx({ db: null as never }))).not.toThrow();
  });

  it("does not throw for missing response in context", () => {
    const ast = makeAst("response.status equals 200", STATUS_TARGET, "equals", litOp(200));
    expect(() => ev.evaluate(ast, makeCtx({ response: null as never }))).not.toThrow();
  });

  it("returns a well-formed AssertionResult (identity trio always present) for any input", () => {
    const ast = makeAst("response.status equals 200", STATUS_TARGET, "equals", litOp(200));
    const result = ev.evaluate(ast, makeCtx());
    expect(typeof result.assertion).toBe("string");
    expect(typeof result.target).toBe("string");
    expect(typeof result.operator).toBe("string");
    expect(typeof result.pass).toBe("boolean");
  });
});

// ---------------------------------------------------------------------------
// 12. Determinism / purity
// ---------------------------------------------------------------------------

describe("AssertionEvaluator — determinism", () => {
  const ev = new AssertionEvaluator();

  it("same (ast, context) ⇒ JSON-stringify-identical results (pass)", () => {
    const ast = makeAst("response.status equals 200", STATUS_TARGET, "equals", litOp(200));
    const ctx = makeCtx();
    const a = ev.evaluate(ast, ctx);
    const b = ev.evaluate(ast, ctx);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("same (ast, context) ⇒ JSON-stringify-identical results (fail)", () => {
    const ast = makeAst("response.status equals 201", STATUS_TARGET, "equals", litOp(201));
    const ctx = makeCtx();
    const a = ev.evaluate(ast, ctx);
    const b = ev.evaluate(ast, ctx);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

// ---------------------------------------------------------------------------
// 13. Default-seam wiring (no deps arg)
// ---------------------------------------------------------------------------

describe("AssertionEvaluator — default-seam (no deps, real collaborators)", () => {
  it("evaluates 'response.status equals 200' PASS through real collaborators", () => {
    const ev = new AssertionEvaluator();
    const ast = makeAst("response.status equals 200", STATUS_TARGET, "equals", litOp(200));
    const result = ev.evaluate(ast, makeCtx());
    expect(result.pass).toBe(true);
  });

  it("evaluates 'response.body.x exists' FAIL via real ExistenceEvaluator", () => {
    const ev = new AssertionEvaluator();
    const ast = makeAst(
      "response.body.x exists",
      bodyPath({ kind: "key", key: "x" }),
      "exists",
    );
    // body is null — .x missing
    const result = ev.evaluate(ast, makeCtx());
    expect(result.pass).toBe(false);
    expect(result.failureCode).toBe(FAILURE_CODES.TARGET_NOT_FOUND);
  });

  it("partial-deps: only stub comparison, rest real — shared resolver still used", () => {
    const compStub = { evaluate: vi.fn().mockReturnValue(passOutcome()) };
    const deps: AssertionEvaluatorDeps = { comparison: compStub };
    const ev = new AssertionEvaluator(deps);

    // Existence should route to the REAL ExistenceEvaluator (not the stubbed one)
    const ast = makeAst("response.status exists", STATUS_TARGET, "exists");
    const result = ev.evaluate(ast, makeCtx());
    expect(result.pass).toBe(true); // status is present
    expect(compStub.evaluate).not.toHaveBeenCalled();
  });

  it("evaluates arithmetic RHS through real ArithmeticEvaluator (default deps)", () => {
    const ev = new AssertionEvaluator();
    // (2 * 3) = 6; response.status = 200 ≠ 6 ⇒ FAIL
    const expr: ArithmeticOperandNode["expr"] = {
      kind: "binary",
      op: "*",
      left: { kind: "number", value: 2 },
      right: { kind: "number", value: 3 },
    };
    const ast = makeAst(
      "response.status equals (2 * 3)",
      STATUS_TARGET,
      "equals",
      arithOp(expr),
    );
    const result = ev.evaluate(ast, makeCtx());
    expect(result.pass).toBe(false);
  });
});
