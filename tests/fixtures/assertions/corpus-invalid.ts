/**
 * Dedicated cross-cutting invalid corpus — one case per INVALID class NOT
 * already covered by a per-group file, plus the full table of invalid-syntax
 * classes the design mandates. Each carries distinctive `errorFragments` so the
 * integration test can prove a DISTINCT attributable message per invalid string.
 *
 * Named export `INVALID_CASES: readonly CorpusCase[]`.
 */

import { errCase } from "./corpus-types.js";
import type { CorpusCase } from "./corpus-types.js";

export const INVALID_CASES: readonly CorpusCase[] = [
  // Unknown operator (typo)
  errCase("inv.unknown-op", "comparison",
    "response.status equalz 201",
    ["unknown operator", "equalz"]),

  // Bad arity: nullary operator given an explicit operand
  errCase("inv.arity.nullary-with-operand", "existence",
    "response.body.id is_not_null 5",
    ["operand", "arity"]),

  // Bad arity: binary operator with missing operand
  errCase("inv.arity.missing-operand", "comparison",
    "response.body.total less_than",
    ["operand", "missing"]),

  // Unbalanced parentheses
  errCase("inv.unbalanced-paren", "comparison",
    "response.body.total equals (request.body.subtotal * 1.08",
    ["paren"]),

  // Bad regex flag (cross-check with per-group; unique id here)
  errCase("inv.bad-regex-flag", "pattern",
    "response.body.message matches /hello/qq",
    ["regex", "flag"]),

  // Unterminated regex (cross-check)
  errCase("inv.unterminated-regex", "pattern",
    "response.body.email matches /pattern",
    ["regex", "unterminated"]),

  // lo > hi range
  errCase("inv.range-lo-gt-hi", "comparison",
    "response.time_ms in_range 9999..1",
    ["range"]),

  // Malformed target — empty path segment (double dot)
  errCase("inv.malformed-target", "comparison",
    "response..body equals 1",
    ["target", "segment"]),

  // Empty / blank input
  errCase("inv.blank", "comparison",
    "   ",
    ["empty"]),
];
