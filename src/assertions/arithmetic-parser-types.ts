/**
 * Types, error vocabulary, and constants for the ArithmeticExpressionParser.
 * Extracted from arithmetic-parser.ts to keep that file within the 300-line
 * soft limit while preserving an identical public API.
 */

import type { ArithmeticExpr } from "./types.js";

/**
 * Maximum permitted parenthesis-nesting depth of an arithmetic expression.
 * 64 is generous headroom; exceeding it yields a structured `DEPTH_EXCEEDED`
 * error BEFORE any stack overflow can occur. Plain `const NAME = N;` idiom.
 */
export const MAX_ARITH_DEPTH = 64;

/**
 * Tunable depth bound, constructor-injected so unit tests can drive the
 * over-depth branch with a tiny value.
 */
export interface ArithmeticParserOptions {
  /** Override {@link MAX_ARITH_DEPTH} (tests use a small value). */
  readonly maxDepth?: number;
}

/**
 * One structural fault found while parsing an arithmetic-expression token slice.
 */
export interface ArithParseError {
  /** Stable machine code for the fault. */
  readonly code: ArithParseErrorCode;
  /** 0-based offending token index within the passed slice, or `-1`. */
  readonly tokenIndex: number;
  /** 0-based char offset of the token on the original input, or `0`. */
  readonly offset: number;
  /** Human-readable, context-bearing explanation. */
  readonly message: string;
}

/**
 * Stable arithmetic-parse fault vocabulary (string-literal union — repo idiom;
 * never a numeric enum).
 */
export type ArithParseErrorCode =
  | "EMPTY_EXPRESSION"
  | "UNBALANCED_OPEN_PAREN"
  | "UNBALANCED_CLOSE_PAREN"
  | "EMPTY_PARENS"
  | "MISSING_LEFT_OPERAND"
  | "MISSING_RIGHT_OPERAND"
  | "EXPECTED_OPERAND"
  | "DISALLOWED_TOKEN"
  | "TRAILING_TOKENS"
  | "DEPTH_EXCEEDED"
  | "INVALID_TARGET";

/**
 * No-throw result of parsing ONE arithmetic-expression token slice. On `ok:true`
 * the `expr` is a Layer-A ArithmeticExpr whose tree shape encodes precedence.
 */
export type ArithParseResult =
  | { readonly ok: true; readonly expr: ArithmeticExpr }
  | { readonly ok: false; readonly errors: readonly ArithParseError[] };

/** Sentinel leaf for error recovery (never returned in ok:true results). */
export const ARITH_SENTINEL: ArithmeticExpr = { kind: "number", value: 0 };
