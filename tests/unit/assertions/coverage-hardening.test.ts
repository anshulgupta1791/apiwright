/**
 * Hardening tests: real, deterministic behavior assertions for genuinely
 * REACHABLE branches the Phase-3 suite under-covered (no tautologies, no
 * istanbul-ignores — each pins observable behavior per the approved designs).
 */

import { describe, it, expect } from "vitest";

import { TargetResolver } from "../../../src/assertions/target-resolver.js";
import { TargetPathParser } from "../../../src/assertions/target-path-parser.js";
import { AggregateEvaluator } from "../../../src/assertions/operators/aggregate-evaluator.js";
import { ComparisonEvaluator } from "../../../src/assertions/operators/comparison-evaluator.js";
import type { ComparisonRhs } from "../../../src/assertions/operators/comparison-evaluator.js";
import type { EvaluationContext, TargetRef } from "../../../src/assertions/index.js";
import type { ResolvedValue } from "../../../src/assertions/target-resolver.js";

function ctx(overrides: Partial<EvaluationContext> = {}): EvaluationContext {
  return {
    request: { headers: {}, body: null, url: { full: "http://x/", path: "/", query: {} } },
    response: { status: 200, headers: {}, body: null, time_ms: 1 },
    db: {},
    ...overrides,
  };
}
const FOUND = (v: unknown): ResolvedValue => ({ found: true, value: v });

// ---------------------------------------------------------------------------
// target-resolver: descent THROUGH an intermediate null mid-path → NOT_FOUND
// ---------------------------------------------------------------------------
describe("TargetResolver — descent through an intermediate null", () => {
  const r = new TargetResolver();

  it("response.body.a.b where body.a === null → found:false (not a crash, not found:true)", () => {
    const c = ctx({ response: { status: 200, headers: {}, body: { a: null }, time_ms: 1 } });
    const ref: TargetRef = {
      root: "response.body",
      path: [{ kind: "key", key: "a" }, { kind: "key", key: "b" }],
    };
    expect(r.resolve(ref, c)).toEqual({ found: false });
  });

  it("response.body.a where body.a === null (terminal null) → found:true, value:null", () => {
    const c = ctx({ response: { status: 200, headers: {}, body: { a: null }, time_ms: 1 } });
    const ref: TargetRef = { root: "response.body", path: [{ kind: "key", key: "a" }] };
    expect(r.resolve(ref, c)).toEqual({ found: true, value: null });
  });
});

// ---------------------------------------------------------------------------
// aggregate-evaluator: isNormalizedResult structural rejection arms
// ---------------------------------------------------------------------------
describe("AggregateEvaluator — non-NormalizedResult shapes → AGGREGATE_MISMATCH", () => {
  const ev = new AggregateEvaluator();

  it("count_equals on a plain object WITHOUT a 'rows' key → AGGREGATE_MISMATCH", () => {
    const out = ev.evaluate("count_equals", FOUND({ total: 3 }), { count: 3 });
    expect(out.pass).toBe(false);
    expect(out.failureCode).toBe("AGGREGATE_MISMATCH");
  });

  it("count_equals on an object WITH 'rows' but NO 'rowCount' → AGGREGATE_MISMATCH", () => {
    const out = ev.evaluate("count_equals", FOUND({ rows: [] }), { count: 0 });
    expect(out.pass).toBe(false);
    expect(out.failureCode).toBe("AGGREGATE_MISMATCH");
  });

  it("count_equals on a NormalizedResult-shaped value → uses rowCount (authoritative)", () => {
    const nr = { rows: [{ id: 1 }], rowCount: 5, raw: null };
    const out = ev.evaluate("count_equals", FOUND(nr), { count: 5 });
    expect(out.pass).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// comparison-evaluator: a range RHS handed to greater_than/less_than
// (defensive contract at the unit boundary) → TYPE_MISMATCH
// ---------------------------------------------------------------------------
describe("ComparisonEvaluator — range RHS is invalid for ordered comparisons", () => {
  const ev = new ComparisonEvaluator();
  const rangeRhs: ComparisonRhs = { kind: "range", lo: 1, hi: 10 };

  it("greater_than with a range RHS → TYPE_MISMATCH", () => {
    const out = ev.evaluate("greater_than", FOUND(5), rangeRhs);
    expect(out.pass).toBe(false);
    expect(out.failureCode).toBe("TYPE_MISMATCH");
  });

  it("less_than with a range RHS → TYPE_MISMATCH", () => {
    const out = ev.evaluate("less_than", FOUND(5), rangeRhs);
    expect(out.pass).toBe(false);
    expect(out.failureCode).toBe("TYPE_MISMATCH");
  });

  it("greater_than numeric predicate FALSE → COMPARISON_FAILED", () => {
    const out = ev.evaluate("greater_than", FOUND(2), { kind: "comparand", comparand: 9 });
    expect(out.pass).toBe(false);
    expect(out.failureCode).toBe("COMPARISON_FAILED");
  });
});

// ---------------------------------------------------------------------------
// target-path-db: incomplete db-path branches (db / db. / db.x / db..q / db.c.)
// ---------------------------------------------------------------------------
describe("TargetPathParser — incomplete db paths → DB_PATH_INCOMPLETE", () => {
  const p = new TargetPathParser();

  for (const lexeme of ["db", "db.", "db.x", "db..q", "db.c."]) {
    it(`'${lexeme}' → ok:false with DB_PATH_INCOMPLETE`, () => {
      const res = p.parse(lexeme);
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.errors.some((e) => e.code === "DB_PATH_INCOMPLETE")).toBe(true);
    });
  }

  it("'db.conn.query' (complete, no trailing path) → ok:true, whole-result ref", () => {
    const res = p.parse("db.conn.query");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.ref).toMatchObject({ root: "db", connection: "conn", queryId: "query", path: [] });
  });

  it("'db.conn.query.rows.0.email' → ok:true with classified trailing path", () => {
    const res = p.parse("db.conn.query.rows.0.email");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.ref).toMatchObject({
      root: "db",
      connection: "conn",
      queryId: "query",
      path: [{ kind: "key", key: "rows" }, { kind: "index", index: 0 }, { kind: "key", key: "email" }],
    });
  });
});
