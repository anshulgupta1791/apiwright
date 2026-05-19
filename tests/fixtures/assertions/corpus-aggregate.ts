/**
 * Aggregate-group corpus cases (2 operators: count_equals, count_greater_than).
 * Covers: DB SPACE-form (canonical) + array length paths, PASS/FAIL, plus the
 * LOCKED dot-glued-db parse error, arith-not-allowed, and arity invalid-syntax.
 *
 * Named export `AGGREGATE_CASES: readonly CorpusCase[]`.
 */

import { okCase, errCase } from "./corpus-types.js";
import type { CorpusCase } from "./corpus-types.js";

export const AGGREGATE_CASES: readonly CorpusCase[] = [
  // ---- count_equals — DB canonical SPACE form ----
  // db ctx: primary_postgres.user_check.rowCount = 1 → PASS
  okCase("agg.count-eq.pass.db", "aggregate",
    "db.primary_postgres.user_check count_equals 1",
    "db",
    { pass: true,
      target: "db.primary_postgres.user_check",
      operator: "count_equals" }),

  okCase("agg.count-eq.fail.db", "aggregate",
    "db.primary_postgres.user_check count_equals 5",
    "db",
    { pass: false, failureCode: "AGGREGATE_MISMATCH",
      target: "db.primary_postgres.user_check",
      operator: "count_equals" }),

  // ---- count_equals — array ----
  // base ctx: response.body.tags = ["alpha","beta","gamma"] (length 3)
  okCase("agg.count-eq.pass.array", "aggregate",
    "response.body.tags count_equals 3",
    "base",
    { pass: true, target: "response.body.tags", operator: "count_equals" }),

  // non-countable actual (response.status is a number, not array/NormalizedResult)
  okCase("agg.count-eq.fail.non-countable", "aggregate",
    "response.status count_equals 1",
    "base",
    { pass: false, failureCode: "AGGREGATE_MISMATCH",
      target: "response.status", operator: "count_equals" }),

  // ---- count_greater_than — DB ----
  // db ctx: primary_postgres.multi_row.rowCount = 3 > 1 → PASS
  okCase("agg.count-gt.pass.db", "aggregate",
    "db.primary_postgres.multi_row count_greater_than 1",
    "db",
    { pass: true,
      target: "db.primary_postgres.multi_row",
      operator: "count_greater_than" }),

  // db ctx: user_check.rowCount = 1, 1 > 1 = false → FAIL
  okCase("agg.count-gt.fail.db", "aggregate",
    "db.primary_postgres.user_check count_greater_than 1",
    "db",
    { pass: false, failureCode: "AGGREGATE_MISMATCH",
      target: "db.primary_postgres.user_check",
      operator: "count_greater_than" }),

  // ---- count_greater_than — array ----
  okCase("agg.count-gt.pass.array", "aggregate",
    "response.body.tags count_greater_than 2",
    "base",
    { pass: true, target: "response.body.tags", operator: "count_greater_than" }),

  okCase("agg.count-gt.fail.array", "aggregate",
    "response.body.tags count_greater_than 9",
    "base",
    { pass: false, failureCode: "AGGREGATE_MISMATCH",
      target: "response.body.tags", operator: "count_greater_than" }),

  // ---- invalid syntax: LOCKED dot-glued-db case ----
  // "db.primary_postgres.user_check.count_equals 1" — operator dot-joined to
  // path (no separating space). Lexer makes the whole dotted string ONE target
  // token; "1" becomes the operator lexeme → lookupOperator("1") = undefined →
  // UNKNOWN_OPERATOR error. Pins BOTH the failing dot-glued form and (above)
  // the passing SPACE form, per the LOCKED parser-orchestrator Assumption #1.
  errCase("agg.invalid.dot-glued-db", "aggregate",
    "db.primary_postgres.user_check.count_equals 1",
    ["unknown operator", "1"]),

  // arithmetic not allowed for count ops
  errCase("agg.invalid.arith-not-allowed", "aggregate",
    "db.primary_postgres.user_check count_equals (1 + 1)",
    ["arithmetic"]),

  // missing operand
  errCase("agg.invalid.missing-operand", "aggregate",
    "response.body.tags count_equals",
    ["operand", "missing"]),
];
