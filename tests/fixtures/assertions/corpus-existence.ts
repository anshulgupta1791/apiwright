/**
 * Existence-group corpus cases (4 operators × 3 target states = 12 evaluation
 * cases). The `edge` context provides: `present = "v"` (present non-null),
 * `nullField = null` (explicit null), and no `missingField` key.
 * Additionally covers prototype-pollution-safe targets (`__proto__`, constructor)
 * and invalid-syntax.
 *
 * Named export `EXISTENCE_CASES: readonly CorpusCase[]`.
 */

import { okCase, errCase } from "./corpus-types.js";
import type { CorpusCase } from "./corpus-types.js";

export const EXISTENCE_CASES: readonly CorpusCase[] = [
  // ---- exists ----
  okCase("ex.exists.pass.present", "existence",
    "response.body.present exists",
    "edge",
    { pass: true, target: "response.body.present", operator: "exists" }),

  okCase("ex.exists.pass.null", "existence",
    "response.body.nullField exists",
    "edge",
    { pass: true, target: "response.body.nullField", operator: "exists" }),

  okCase("ex.exists.fail.missing", "existence",
    "response.body.missingField exists",
    "edge",
    { pass: false, failureCode: "TARGET_NOT_FOUND",
      target: "response.body.missingField", operator: "exists" }),

  // ---- not_exists ----
  okCase("ex.not-exists.fail.present", "existence",
    "response.body.present not_exists",
    "edge",
    { pass: false, failureCode: "COMPARISON_FAILED",
      target: "response.body.present", operator: "not_exists" }),

  okCase("ex.not-exists.fail.null", "existence",
    "response.body.nullField not_exists",
    "edge",
    { pass: false, failureCode: "COMPARISON_FAILED",
      target: "response.body.nullField", operator: "not_exists" }),

  okCase("ex.not-exists.pass.missing", "existence",
    "response.body.missingField not_exists",
    "edge",
    { pass: true, target: "response.body.missingField", operator: "not_exists" }),

  // ---- is_null ----
  okCase("ex.is-null.fail.present", "existence",
    "response.body.present is_null",
    "edge",
    { pass: false, failureCode: "COMPARISON_FAILED",
      target: "response.body.present", operator: "is_null" }),

  okCase("ex.is-null.pass.null", "existence",
    "response.body.nullField is_null",
    "edge",
    { pass: true, target: "response.body.nullField", operator: "is_null" }),

  okCase("ex.is-null.fail.missing", "existence",
    "response.body.missingField is_null",
    "edge",
    { pass: false, failureCode: "TARGET_NOT_FOUND",
      target: "response.body.missingField", operator: "is_null" }),

  // ---- is_not_null ----
  okCase("ex.is-not-null.pass.present", "existence",
    "response.body.present is_not_null",
    "edge",
    { pass: true, target: "response.body.present", operator: "is_not_null" }),

  okCase("ex.is-not-null.fail.null", "existence",
    "response.body.nullField is_not_null",
    "edge",
    { pass: false, failureCode: "COMPARISON_FAILED",
      target: "response.body.nullField", operator: "is_not_null" }),

  okCase("ex.is-not-null.fail.missing", "existence",
    "response.body.missingField is_not_null",
    "edge",
    { pass: false, failureCode: "TARGET_NOT_FOUND",
      target: "response.body.missingField", operator: "is_not_null" }),

  // ---- prototype-pollution-safe (__proto__ treated as absent) ----
  okCase("ex.proto.exists.fail", "existence",
    "response.body.__proto__ exists",
    "edge",
    { pass: false, failureCode: "TARGET_NOT_FOUND",
      target: "response.body.__proto__", operator: "exists" }),

  okCase("ex.proto.not-exists.pass", "existence",
    "response.body.__proto__ not_exists",
    "edge",
    { pass: true, target: "response.body.__proto__", operator: "not_exists" }),

  // ---- invalid syntax ----
  errCase("ex.invalid.nullary-with-operand", "existence",
    "response.body.x exists 5",
    ["operand", "arity"]),
];
