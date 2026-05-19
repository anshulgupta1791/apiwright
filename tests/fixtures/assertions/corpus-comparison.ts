/**
 * Comparison-group corpus cases (5 operators: equals, not_equals, greater_than,
 * less_than, in_range). Covers: PASS/FAIL/arith-RHS/÷0/E6-TYPE_MISMATCH/
 * in_range-boundaries/deep-equal/no-coercion + invalid-syntax.
 *
 * Named export `COMPARISON_CASES: readonly CorpusCase[]`.
 */

import { okCase, errCase } from "./corpus-types.js";
import type { CorpusCase } from "./corpus-types.js";

export const COMPARISON_CASES: readonly CorpusCase[] = [
  // ---- equals — basic PASS/FAIL ----
  okCase("cmp.equals.pass", "comparison",
    "response.status equals 201",
    "base",
    { pass: true, target: "response.status", operator: "equals" }),

  okCase("cmp.equals.fail.wrong-num", "comparison",
    "response.status equals 200",
    "base",
    { pass: false, failureCode: "COMPARISON_FAILED",
      target: "response.status", operator: "equals" }),

  // No coercion: number 201 !== string "201"
  okCase("cmp.equals.fail.no-coerce", "comparison",
    'response.status equals "201"',
    "base",
    { pass: false, failureCode: "COMPARISON_FAILED",
      target: "response.status", operator: "equals" }),

  // ---- equals — deep-equal object and array ----
  okCase("cmp.equals.pass.deep-obj", "comparison",
    "response.body.profile equals request.body.profile",
    "base",
    { pass: true, target: "response.body.profile", operator: "equals" }),

  okCase("cmp.equals.pass.deep-arr", "comparison",
    "response.body.tags equals request.body.tags",
    "base",
    { pass: true, target: "response.body.tags", operator: "equals" }),

  // ---- equals — arithmetic RHS ----
  // subtotal=100, total=108, 100*1.08=108 exact
  okCase("cmp.equals.pass.arith", "comparison",
    "response.body.total equals (request.body.subtotal * 1.08)",
    "base",
    { pass: true, target: "response.body.total", operator: "equals" }),

  // divide-by-zero RHS → ARITHMETIC_ERROR
  okCase("cmp.equals.fail.div-zero", "comparison",
    "response.body.total equals (request.body.subtotal / 0)",
    "base",
    { pass: false, failureCode: "ARITHMETIC_ERROR",
      target: "response.body.total", operator: "equals",
      reasonIncludes: "zero" }),

  // LOCKED E6: non-number arithmetic operand → TYPE_MISMATCH (NOT ARITHMETIC_ERROR)
  okCase("cmp.equals.fail.e6-type-mismatch", "comparison",
    "response.body.total equals (request.body.email * 2)",
    "base",
    { pass: false, failureCode: "TYPE_MISMATCH",
      target: "response.body.total", operator: "equals",
      reasonIncludes: "type" }),

  // ---- not_equals ----
  okCase("cmp.not-equals.pass", "comparison",
    "response.status not_equals 500",
    "base",
    { pass: true, target: "response.status", operator: "not_equals" }),

  okCase("cmp.not-equals.fail", "comparison",
    "response.status not_equals 201",
    "base",
    { pass: false, failureCode: "COMPARISON_FAILED",
      target: "response.status", operator: "not_equals" }),

  // ---- greater_than ----
  okCase("cmp.gt.pass", "comparison",
    "response.time_ms greater_than 10",
    "base",
    { pass: true, target: "response.time_ms", operator: "greater_than" }),

  okCase("cmp.gt.fail", "comparison",
    "response.time_ms greater_than 100000",
    "base",
    { pass: false, failureCode: "COMPARISON_FAILED",
      target: "response.time_ms", operator: "greater_than" }),

  okCase("cmp.gt.fail.type-mismatch", "comparison",
    "response.body.email greater_than 1",
    "base",
    { pass: false, failureCode: "TYPE_MISMATCH",
      target: "response.body.email", operator: "greater_than" }),

  // ---- less_than ----
  okCase("cmp.lt.pass", "comparison",
    "response.time_ms less_than 100000",
    "base",
    { pass: true, target: "response.time_ms", operator: "less_than" }),

  okCase("cmp.lt.fail", "comparison",
    "response.time_ms less_than 1",
    "base",
    { pass: false, failureCode: "COMPARISON_FAILED",
      target: "response.time_ms", operator: "less_than" }),

  // ---- in_range — inclusive boundary tests ----
  // upper-inclusive: 201 in 200..201 → PASS
  okCase("cmp.in-range.pass.upper-incl", "comparison",
    "response.status in_range 200..201",
    "base",
    { pass: true, target: "response.status", operator: "in_range" }),

  // lower-inclusive: 201 in 201..599 → PASS
  okCase("cmp.in-range.pass.lower-incl", "comparison",
    "response.status in_range 201..599",
    "base",
    { pass: true, target: "response.status", operator: "in_range" }),

  // degenerate single-point: 201 in 201..201 → PASS
  okCase("cmp.in-range.pass.degenerate", "comparison",
    "response.status in_range 201..201",
    "base",
    { pass: true, target: "response.status", operator: "in_range" }),

  // just-outside: 201 not in 100..200 → FAIL
  okCase("cmp.in-range.fail.below", "comparison",
    "response.status in_range 100..200",
    "base",
    { pass: false, failureCode: "COMPARISON_FAILED",
      target: "response.status", operator: "in_range" }),

  // non-number actual → TYPE_MISMATCH
  okCase("cmp.in-range.fail.type-mismatch", "comparison",
    "response.body.email in_range 1..9",
    "base",
    { pass: false, failureCode: "TYPE_MISMATCH",
      target: "response.body.email", operator: "in_range" }),

  // ---- invalid syntax ----
  errCase("cmp.invalid.lo-gt-hi", "comparison",
    "response.status in_range 599..100",
    ["range", "lo", "hi"]),

  errCase("cmp.invalid.missing-operand", "comparison",
    "response.status equals",
    ["operand", "missing"]),

  errCase("cmp.invalid.malformed-arith", "comparison",
    "response.status equals (1 +)",
    ["arithmetic", "paren"]),
];
