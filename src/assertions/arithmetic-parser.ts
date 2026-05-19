/**
 * Recursive-descent parser turning an ordered slice of Layer-B tokens into a
 * Layer-A ArithmeticExpr tree. Additive/multiplicative chains are iterative
 * left-folds; ONLY parenthesis nesting recurses and is explicitly depth-bounded.
 * NEVER throws; faults are aggregated in a structured Result.
 *
 * Types and constants live in {@link ./arithmetic-parser-types.js}; re-exported
 * here for an unchanged public API.
 */

import type { ArithParseError, ArithParseResult, ArithmeticParserOptions }
  from "./arithmetic-parser-types.js";
import { ARITH_SENTINEL, MAX_ARITH_DEPTH } from "./arithmetic-parser-types.js";
import { TargetPathParser } from "./target-path-parser.js";
import type { Token } from "./tokenizer.js";
import type { ArithmeticExpr, ArithmeticOperator, TargetRef } from "./types.js";

export { MAX_ARITH_DEPTH, ARITH_SENTINEL } from "./arithmetic-parser-types.js";
export type { ArithmeticParserOptions, ArithParseError, ArithParseErrorCode, ArithParseResult }
  from "./arithmetic-parser-types.js";

/**
 * Pure, deterministic, no-throw recursive-descent parser turning an ordered
 * slice of Layer-B Tokens into a Layer-A ArithmeticExpr. Parenthesis recursion
 * is bounded by an explicit depth counter; additive/multiplicative chains are
 * iterative left-folds — only paren-nesting recurses.
 */
export class ArithmeticExpressionParser {
  readonly #targetParser: TargetPathParser;
  readonly #maxDepth: number;

  /** Per-call mutable state — reset at the top of every {@link parse} call. */
  #tokens: readonly Token[] = [];
  #cursor = 0;
  #errors: ArithParseError[] = [];

  /**
   * Constructs the parser with a shared Layer-C collaborator and optional seam.
   * @param targetParser - Layer-C target-path parser for each `target` leaf.
   * @param options - Optional depth-bound override (the test seam).
   */
  constructor(targetParser: TargetPathParser, options?: ArithmeticParserOptions) {
    this.#targetParser = targetParser;
    this.#maxDepth = options?.maxDepth ?? MAX_ARITH_DEPTH;
  }

  /**
   * Parses one arithmetic-expression token slice into a Layer-A ArithmeticExpr.
   * NEVER throws. Returns an ArithParseResult; on `ok:false` the `errors` array
   * AGGREGATES every structural fault.
   * @param tokens - The contiguous arithmetic-RHS token slice (no `eof`).
   * @returns An ArithParseResult.
   */
  parse(tokens: readonly Token[]): ArithParseResult {
    this.#tokens = tokens;
    this.#cursor = 0;
    this.#errors = [];

    if (tokens.length === 0) {
      return {
        ok: false,
        errors: [{
          code: "EMPTY_EXPRESSION", tokenIndex: -1, offset: 0,
          message: "Empty arithmetic expression — no tokens",
        }],
      };
    }

    const expr = this.#parseExpr(0);

    if (this.#cursor < this.#tokens.length) {
      const tok = this.#tokens[this.#cursor];
      if (tok !== undefined) {
        this.#pushError({
          code: "TRAILING_TOKENS", tokenIndex: this.#cursor, offset: tok.span.start,
          message: `Unexpected token '${tok.raw}' after complete expression`,
        });
      }
    }

    if (this.#errors.length > 0) return { ok: false, errors: this.#errors };
    return { ok: true, expr };
  }

  #parseExpr(depth: number): ArithmeticExpr {
    const firstTok = this.#peek();
    if (firstTok?.kind === "arith_op" && (firstTok.op === "+" || firstTok.op === "-")) {
      this.#pushError({
        code: "MISSING_LEFT_OPERAND", tokenIndex: this.#cursor, offset: firstTok.span.start,
        message: `Operator '${firstTok.op}' has no left operand`,
      });
      this.#advance();
      return this.#parseTerm(depth);
    }
    let left = this.#parseTerm(depth);
    while (this.#cursor < this.#tokens.length) {
      const tok = this.#peek();
      if (tok?.kind !== "arith_op") break;
      if (tok.op !== "+" && tok.op !== "-") break;
      const op = tok.op as ArithmeticOperator;
      this.#advance();
      if (this.#isMissingRight(op, tok)) return left;
      const right = this.#parseTerm(depth);
      left = { kind: "binary", op, left, right };
    }
    return left;
  }

  #parseTerm(depth: number): ArithmeticExpr {
    const firstTok = this.#peek();
    if (firstTok?.kind === "arith_op" && (firstTok.op === "*" || firstTok.op === "/")) {
      this.#pushError({
        code: "MISSING_LEFT_OPERAND", tokenIndex: this.#cursor, offset: firstTok.span.start,
        message: `Operator '${firstTok.op}' has no left operand`,
      });
      this.#advance();
      return this.#parseFactor(depth);
    }
    let left = this.#parseFactor(depth);
    while (this.#cursor < this.#tokens.length) {
      const tok = this.#peek();
      if (tok?.kind !== "arith_op") break;
      if (tok.op !== "*" && tok.op !== "/") break;
      const op = tok.op as ArithmeticOperator;
      this.#advance();
      if (this.#isMissingRight(op, tok)) return left;
      const right = this.#parseFactor(depth);
      left = { kind: "binary", op, left, right };
    }
    return left;
  }

  #isMissingRight(op: ArithmeticOperator, opTok: Token): boolean {
    const nextTok = this.#peek();
    if (nextTok === undefined) {
      this.#pushError({
        code: "MISSING_RIGHT_OPERAND", tokenIndex: this.#cursor - 1, offset: opTok.span.start,
        message: `Operator '${op}' has no right operand`,
      });
      return true;
    }
    if (nextTok.kind === "rparen") {
      this.#pushError({
        code: "MISSING_RIGHT_OPERAND", tokenIndex: this.#cursor, offset: nextTok.span.start,
        message:
          `Arithmetic operator '${op}' has no right operand (closing paren found instead)`,
      });
      return true;
    }
    if (nextTok.kind === "arith_op") {
      this.#pushError({
        code: "MISSING_RIGHT_OPERAND", tokenIndex: this.#cursor - 1, offset: opTok.span.start,
        message: `Operator '${op}' has no right operand (followed by '${nextTok.raw}')`,
      });
      return true;
    }
    return false;
  }

  #parseFactor(depth: number): ArithmeticExpr {
    const tok = this.#peek();
    if (tok === undefined) {
      this.#pushError({
        code: "EXPECTED_OPERAND", tokenIndex: this.#cursor, offset: 0,
        message: "Expected an operand but reached end of expression",
      });
      return ARITH_SENTINEL;
    }
    if (tok.kind === "lparen") return this.#parseParenGroup(tok, depth);
    if (tok.kind === "rparen") return this.#handleUnbalancedClose(tok);
    if (tok.kind === "number") { this.#advance(); return { kind: "number", value: tok.value }; }
    // "target" tokens are always valid target paths.
    // "identifier" tokens (post-operator position) are valid target paths only when they
    // contain dots (e.g. "response.body.min"). Bare-word identifiers like "equals" are
    // operator keywords in the wrong context and must be DISALLOWED_TOKEN.
    if (tok.kind === "target") return this.#parseTargetLeaf(tok);
    if (tok.kind === "identifier" && tok.raw.includes(".")) return this.#parseTargetLeaf(tok);
    this.#pushError({
      code: "DISALLOWED_TOKEN", tokenIndex: this.#cursor, offset: tok.span.start,
      message: `Disallowed token kind '${tok.kind}' ('${tok.raw}') in arithmetic expression`,
    });
    this.#advance();
    return ARITH_SENTINEL;
  }

  #parseParenGroup(tok: Token, depth: number): ArithmeticExpr {
    const nextAfterParen = this.#tokens[this.#cursor + 1];
    if (nextAfterParen?.kind === "rparen") {
      this.#pushError({
        code: "EMPTY_PARENS", tokenIndex: this.#cursor, offset: tok.span.start,
        message: "Empty parentheses '()' — no expression inside",
      });
      this.#advance();
      this.#advance();
      return ARITH_SENTINEL;
    }
    if (depth + 1 > this.#maxDepth) {
      this.#pushError({
        code: "DEPTH_EXCEEDED", tokenIndex: this.#cursor, offset: tok.span.start,
        message: `Parenthesis nesting depth ${depth + 1} exceeds maximum ${this.#maxDepth}`,
      });
      this.#skipBalancedGroup();
      return ARITH_SENTINEL;
    }
    this.#advance();
    const inner = this.#parseExpr(depth + 1);
    const closeTok = this.#peek();
    if (closeTok?.kind !== "rparen") {
      this.#pushError({
        code: "UNBALANCED_OPEN_PAREN", tokenIndex: this.#cursor - 1, offset: tok.span.start,
        message: `Unmatched paren '(' at offset ${tok.span.start} — no closing paren ')'`,
      });
      return inner;
    }
    this.#advance();
    return inner;
  }

  #handleUnbalancedClose(tok: Token): ArithmeticExpr {
    this.#pushError({
      code: "UNBALANCED_CLOSE_PAREN", tokenIndex: this.#cursor, offset: tok.span.start,
      message: `Unexpected ')' at offset ${tok.span.start} — no matching '('`,
    });
    this.#advance();
    return ARITH_SENTINEL;
  }

  #parseTargetLeaf(tok: Token): ArithmeticExpr {
    this.#advance();
    if (!tok.raw.includes(".")) {
      const syntheticRef: TargetRef = {
        root: "response.body",
        path: [{ kind: "key", key: tok.raw }],
      };
      return { kind: "target", ref: syntheticRef };
    }
    const parseResult = this.#targetParser.parse(tok.raw);
    if (!parseResult.ok) {
      const msgs = parseResult.errors.map((e) => e.message).join("; ");
      this.#pushError({
        code: "INVALID_TARGET", tokenIndex: this.#cursor - 1, offset: tok.span.start,
        message: `Invalid target '${tok.raw}': ${msgs}`,
      });
      return ARITH_SENTINEL;
    }
    return { kind: "target", ref: parseResult.ref };
  }

  #skipBalancedGroup(): void {
    let groupDepth = 0;
    while (this.#cursor < this.#tokens.length) {
      const tok = this.#tokens[this.#cursor];
      if (tok === undefined) break;
      if (tok.kind === "lparen") groupDepth++;
      else if (tok.kind === "rparen") {
        if (groupDepth === 0) { this.#advance(); break; }
        groupDepth--;
      }
      this.#advance();
    }
  }

  #pushError(err: ArithParseError): void { this.#errors.push(err); }
  #peek(): Token | undefined { return this.#tokens[this.#cursor]; }
  #advance(): void { this.#cursor++; }
}
