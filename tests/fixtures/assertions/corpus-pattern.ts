/**
 * Pattern-group corpus cases (4 operators: matches, contains, starts_with,
 * ends_with). Covers: regex flags/bare/over-cap/type-guard, string+array
 * contains, header-case-insensitivity, + invalid-syntax.
 *
 * Named export `PATTERN_CASES: readonly CorpusCase[]`.
 */

import { okCase, errCase } from "./corpus-types.js";
import type { CorpusCase } from "./corpus-types.js";

export const PATTERN_CASES: readonly CorpusCase[] = [
  // ---- matches — /pat/flags form ----
  // id is a valid UUID v4: '550e8400-e29b-41d4-a716-446655440000'
  okCase("pat.matches.pass.flags", "pattern",
    "response.body.id matches /^[0-9a-f-]+$/i",
    "base",
    { pass: true, target: "response.body.id", operator: "matches" }),

  okCase("pat.matches.fail.no-match", "pattern",
    "response.body.id matches /^Z+$/",
    "base",
    { pass: false, failureCode: "REGEX_NO_MATCH",
      target: "response.body.id", operator: "matches" }),

  // non-string actual (status is number) → TYPE_MISMATCH
  okCase("pat.matches.fail.type-mismatch", "pattern",
    "response.status matches /^2/",
    "base",
    { pass: false, failureCode: "TYPE_MISMATCH",
      target: "response.status", operator: "matches" }),

  // over-cap target (edge ctx: response.body.huge is 65537 chars) → REGEX_NO_MATCH
  okCase("pat.matches.fail.over-cap", "pattern",
    "response.body.huge matches /x/",
    "edge",
    { pass: false, failureCode: "REGEX_NO_MATCH",
      target: "response.body.huge", operator: "matches",
      reasonIncludes: "exceeded" }),

  // ---- matches — bare regex (no flags) ----
  okCase("pat.matches.pass.bare", "pattern",
    "response.body.email matches /@example\\.com$/",
    "base",
    { pass: true, target: "response.body.email", operator: "matches" }),

  // ---- contains — string ----
  okCase("pat.contains.pass.string", "pattern",
    'response.body.message contains "created"',
    "base",
    { pass: true, target: "response.body.message", operator: "contains" }),

  okCase("pat.contains.fail.string", "pattern",
    'response.body.message contains "zzz"',
    "base",
    { pass: false, failureCode: "REGEX_NO_MATCH",
      target: "response.body.message", operator: "contains" }),

  // ---- contains — array ----
  okCase("pat.contains.pass.array", "pattern",
    'response.body.tags contains "alpha"',
    "base",
    { pass: true, target: "response.body.tags", operator: "contains" }),

  // non-string non-array actual → TYPE_MISMATCH
  okCase("pat.contains.fail.type-mismatch", "pattern",
    'response.status contains "2"',
    "base",
    { pass: false, failureCode: "TYPE_MISMATCH",
      target: "response.status", operator: "contains" }),

  // ---- starts_with — header case-insensitivity ----
  // base ctx stores headers lowercased: authorization: "Bearer abc.def"
  // assertion uses Authorization (cap A) → resolver must normalise
  okCase("pat.starts-with.pass.header-case", "pattern",
    'request.headers.Authorization starts_with "Bearer "',
    "base",
    { pass: true, target: "request.headers.Authorization",
      operator: "starts_with" }),

  okCase("pat.starts-with.fail", "pattern",
    'response.body.message starts_with "X"',
    "base",
    { pass: false, failureCode: "REGEX_NO_MATCH",
      target: "response.body.message", operator: "starts_with" }),

  // ---- ends_with ----
  okCase("pat.ends-with.pass", "pattern",
    'response.body.email ends_with ".com"',
    "base",
    { pass: true, target: "response.body.email", operator: "ends_with" }),

  okCase("pat.ends-with.fail", "pattern",
    'response.body.email ends_with ".org"',
    "base",
    { pass: false, failureCode: "REGEX_NO_MATCH",
      target: "response.body.email", operator: "ends_with" }),

  // ---- invalid syntax ----
  errCase("pat.invalid.unterminated-regex", "pattern",
    "response.body.id matches /unterminated",
    ["regex", "unterminated"]),

  errCase("pat.invalid.bad-regex-flag", "pattern",
    "response.body.id matches /x/zz",
    ["regex", "flag"]),

  errCase("pat.invalid.missing-operand", "pattern",
    "response.body.id matches",
    ["operand", "missing"]),
];
