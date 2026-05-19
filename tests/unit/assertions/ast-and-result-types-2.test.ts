import { describe, it, expect } from "vitest";

import { parseJson } from "../../../src/core/safe-json.js";
import type {
  TargetRef,
  PathSegment,
  Operand,
  LiteralOperand,
  TargetOperand,
  RangeOperand,
  AssertionAst,
  AssertionParseResult,
  AssertionParseEntry,
  BatchParseResult,
  OperatorName,
} from "../../../src/assertions/index.js";

/**
 * Unit tests for the assertions type vocabulary — Part 2.
 *
 * Covers: TargetRef discriminated union variants (all roots, PathSegment key
 * vs index, db variant with connection/queryId), Operand union (literal/target
 * /range discriminants), AssertionAst (binary and nullary operators),
 * AssertionParseResult (ok/error discriminant), BatchParseResult (empty/valid/
 * failing, round-trip), EvaluationContext (db shape, now optional vs provided).
 *
 * FAILURE_CODES, GroupOutcome, and AssertionResult tests are in
 * ast-and-result-types.test.ts (split for the 300-line file cap).
 */

// ---- TargetRef discriminated union ---------------------------------------------------
describe("TargetRef — discriminated union variants", () => {
  it("response.status variant has only root (no path member)", () => {
    const ref: TargetRef = { root: "response.status" };
    expect(ref.root).toBe("response.status");
    // @ts-expect-error — response.status has no path member in the type
    expect((ref as { path?: unknown }).path).toBeUndefined();
  });

  it("response.time_ms variant has only root (no path member)", () => {
    const ref: TargetRef = { root: "response.time_ms" };
    expect(ref.root).toBe("response.time_ms");
  });

  it("response.body variant with empty path addresses the whole body", () => {
    const ref: TargetRef = { root: "response.body", path: [] };
    expect(ref.root).toBe("response.body");
    expect(ref.path).toHaveLength(0);
  });

  it("response.body variant with key and index segments", () => {
    const keySegment: PathSegment = { kind: "key", key: "items" };
    const indexSegment: PathSegment = { kind: "index", index: 0 };
    const ref: TargetRef = {
      root: "response.body",
      path: [keySegment, indexSegment],
    };
    expect(ref.path[0]).toEqual({ kind: "key", key: "items" });
    expect(ref.path[1]).toEqual({ kind: "index", index: 0 });
  });

  it("request.headers variant carries a path", () => {
    const ref: TargetRef = {
      root: "request.headers",
      path: [{ kind: "key", key: "authorization" }],
    };
    expect(ref.root).toBe("request.headers");
    expect(ref.path).toHaveLength(1);
  });

  it("request.body variant with nested path", () => {
    const ref: TargetRef = {
      root: "request.body",
      path: [{ kind: "key", key: "email" }],
    };
    expect(ref.root).toBe("request.body");
  });

  it("db variant carries connection, queryId, and trailing path", () => {
    const ref: TargetRef = {
      root: "db",
      connection: "primary_postgres",
      queryId: "user_check",
      path: [
        { kind: "key", key: "rows" },
        { kind: "index", index: 0 },
        { kind: "key", key: "id" },
      ],
    };
    expect(ref.root).toBe("db");
    expect(ref.connection).toBe("primary_postgres");
    expect(ref.queryId).toBe("user_check");
    expect(ref.path).toHaveLength(3);
  });

  it("db variant with empty path — for count_equals addressing whole NormalizedResult", () => {
    const ref: TargetRef = {
      root: "db",
      connection: "conn",
      queryId: "q1",
      path: [],
    };
    expect(ref.path).toHaveLength(0);
  });
});

// ---- PathSegment: key vs index discriminant ------------------------------------------
describe("PathSegment — key vs index discriminant", () => {
  it("key segment has kind='key' and a string key", () => {
    const seg: PathSegment = { kind: "key", key: "userId" };
    expect(seg.kind).toBe("key");
    expect(seg.key).toBe("userId");
  });

  it("index segment has kind='index' and a numeric index", () => {
    const seg: PathSegment = { kind: "index", index: 0 };
    expect(seg.kind).toBe("index");
    expect(seg.index).toBe(0);
  });
});

// ---- Operand union variants -----------------------------------------------------------
describe("Operand — discriminant variants", () => {
  it("LiteralOperand with string value compiles", () => {
    const op: LiteralOperand = { kind: "literal", value: "Bearer token" };
    expect(op.kind).toBe("literal");
    expect(op.value).toBe("Bearer token");
  });

  it("LiteralOperand with null value compiles (null vs missing operand distinction)", () => {
    const op: LiteralOperand = { kind: "literal", value: null };
    expect(op.value).toBeNull();
  });

  it("LiteralOperand with numeric value compiles", () => {
    const op: LiteralOperand = { kind: "literal", value: 201 };
    expect(op.value).toBe(201);
  });

  it("LiteralOperand with boolean value compiles", () => {
    const op: LiteralOperand = { kind: "literal", value: true };
    expect(op.value).toBe(true);
  });

  it("TargetOperand carries a TargetRef", () => {
    const op: TargetOperand = {
      kind: "target",
      ref: { root: "request.body", path: [{ kind: "key", key: "email" }] },
    };
    expect(op.kind).toBe("target");
    expect(op.ref.root).toBe("request.body");
  });

  it("RangeOperand with lo and hi compiles", () => {
    const op: RangeOperand = { kind: "range", lo: 100, hi: 599 };
    expect(op.lo).toBe(100);
    expect(op.hi).toBe(599);
  });

  it("RangeOperand with degenerate lo === hi (single-point range) is valid", () => {
    const op: RangeOperand = { kind: "range", lo: 200, hi: 200 };
    expect(op.lo).toBe(op.hi);
  });

  it("Operand union accepts multiple kinds in an array", () => {
    const ops: Operand[] = [
      { kind: "literal", value: true },
      { kind: "target", ref: { root: "response.status" } },
      { kind: "range", lo: 0, hi: 100 },
    ];
    expect(ops).toHaveLength(3);
  });
});

// ---- AssertionAst structural tests ---------------------------------------------------
describe("AssertionAst", () => {
  it("compiles for a binary operator with a literal operand", () => {
    const ast: AssertionAst = {
      raw: "response.status equals 201",
      target: { root: "response.status" },
      operator: "equals",
      operand: { kind: "literal", value: 201 },
    };
    expect(ast.raw).toBe("response.status equals 201");
    expect(ast.operand).toBeDefined();
  });

  it("compiles for a nullary operator with operand omitted entirely (not undefined-valued)", () => {
    const ast: AssertionAst = {
      raw: "response.body.id is_uuid_v4",
      target: { root: "response.body", path: [{ kind: "key", key: "id" }] },
      operator: "is_uuid_v4",
    };
    expect("operand" in ast).toBe(false);
  });

  it("compiles for a range operand (in_range operator)", () => {
    const ast: AssertionAst = {
      raw: "response.status in_range 200..299",
      target: { root: "response.status" },
      operator: "in_range",
      operand: { kind: "range", lo: 200, hi: 299 },
    };
    expect(ast.operator).toBe("in_range");
    expect((ast.operand as RangeOperand).lo).toBe(200);
  });
});

// ---- AssertionParseResult discriminated union ----------------------------------------
describe("AssertionParseResult", () => {
  it("ok:true variant carries an ast", () => {
    const ast: AssertionAst = {
      raw: "response.status equals 200",
      target: { root: "response.status" },
      operator: "equals",
      operand: { kind: "literal", value: 200 },
    };
    const result: AssertionParseResult = { ok: true, ast };
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ast.raw).toBe("response.status equals 200");
  });

  it("ok:false variant carries an errors array — supports multiple errors per string", () => {
    const result: AssertionParseResult = {
      ok: false,
      errors: ["unexpected token at position 5", "unknown operator 'foo'"],
    };
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toHaveLength(2);
  });
});

// ---- BatchParseResult ----------------------------------------------------------------
describe("BatchParseResult", () => {
  it("all-valid batch has valid:true and empty errors", () => {
    const entry: AssertionParseEntry = {
      assertion: "response.status equals 200",
      result: {
        ok: true,
        ast: {
          raw: "response.status equals 200",
          target: { root: "response.status" },
          operator: "equals",
          operand: { kind: "literal", value: 200 },
        },
      },
    };
    const batch: BatchParseResult = { entries: [entry], valid: true, errors: [] };
    expect(batch.valid).toBe(true);
    expect(batch.errors).toHaveLength(0);
  });

  it("empty assertions block yields valid:true (vacuous truth)", () => {
    const batch: BatchParseResult = { entries: [], valid: true, errors: [] };
    expect(batch.valid).toBe(true);
    expect(batch.entries).toHaveLength(0);
  });

  it("batch with a failing entry has valid:false and non-empty errors", () => {
    const failEntry: AssertionParseEntry = {
      assertion: "bad $$$ syntax",
      result: { ok: false, errors: ["unknown token '$$$'"] },
    };
    const batch: BatchParseResult = {
      entries: [failEntry],
      valid: false,
      errors: ["bad $$$ syntax: unknown token '$$$'"],
    };
    expect(batch.valid).toBe(false);
    expect(batch.errors).toHaveLength(1);
  });

  it("BatchParseResult round-trips through parseJson", () => {
    const batch: BatchParseResult = {
      entries: [
        {
          assertion: "response.status equals 200",
          result: { ok: false, errors: ["syntax error"] },
        },
      ],
      valid: false,
      errors: ["response.status equals 200: syntax error"],
    };
    const parsed = parseJson(JSON.stringify(batch));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const val = parsed.value as BatchParseResult;
    expect(val.valid).toBe(false);
    expect(val.errors).toHaveLength(1);
  });
});

// EvaluationContext tests are in ast-and-result-types-3.test.ts (line cap split).
