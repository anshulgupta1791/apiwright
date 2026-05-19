/**
 * Pure, deterministic, no-throw lexer for one assertion string. Turns a raw
 * assertion string into an ordered, typed token stream for the parser-orchestrator.
 * Single forward pass — no recursion, no backtracking, no catastrophic regex.
 *
 * Types and constants live in {@link ./token-types.js}; re-exported here for an
 * unchanged public surface.
 */

import type { LexError, PunctToken, Token, TokenKind, TokenizeResult, TokenizerOptions }
  from "./token-types.js";
import {
  DIV_IMMEDIATE_VALUE_KINDS,
  MAX_INPUT_LENGTH,
  MAX_TOKEN_COUNT,
  MINUS_IMMEDIATE_VALUE_KINDS,
} from "./token-types.js";
import { scanNumber, scanRegex, scanString } from "./tokenizer-scanners.js";

export {
  DIV_IMMEDIATE_VALUE_KINDS, MAX_INPUT_LENGTH, MAX_TOKEN_COUNT, MINUS_IMMEDIATE_VALUE_KINDS,
} from "./token-types.js";
export type {
  ArithOpToken, BooleanToken, IdentifierToken, LexError, LexErrorCode, NullToken, NumberToken,
  PunctToken, RegexToken, StringToken, TargetToken, Token, TokenizeResult, TokenizerOptions,
  TokenKind, TokenSpan,
} from "./token-types.js";

/**
 * Pure, deterministic, no-throw lexer for ONE assertion string.
 * Identical input ALWAYS yields a deep-equal token stream (no I/O,
 * Date, or randomness). Single bounded forward pass — no recursion.
 */
export class AssertionTokenizer {
  readonly #maxInputLength: number;
  readonly #maxTokenCount: number;

  /**
   * Constructs the lexer with optional bound overrides (test seams).
   * @param options - Optional bound overrides.
   */
  constructor(options?: TokenizerOptions) {
    this.#maxInputLength = options?.maxInputLength ?? MAX_INPUT_LENGTH;
    this.#maxTokenCount = options?.maxTokenCount ?? MAX_TOKEN_COUNT;
  }

  /**
   * Lexes one assertion string into an ordered token stream. NEVER throws.
   * @param input - One raw assertion string (untrimmed).
   * @returns A {@link TokenizeResult}.
   */
  tokenize(input: string): TokenizeResult {
    const eofAt = (pos: number): PunctToken =>
      ({ kind: "eof", span: { start: pos, end: pos }, raw: "" });

    const earlyResult = this.#checkEarlyExit(input, eofAt);
    if (earlyResult !== null) return earlyResult;

    const tokens: Token[] = [];
    const errors: LexError[] = [];
    const pushToken = this.#makePushToken(tokens, errors);
    const prevKind = (offset = 1): TokenKind | undefined => tokens[tokens.length - offset]?.kind;

    const endPos = this.#scanLoop(input, tokens, errors, pushToken, prevKind);
    tokens.push(eofAt(endPos));
    return errors.length > 0 ? { ok: false, errors, tokens } : { ok: true, tokens };
  }

  #checkEarlyExit(input: string, eofAt: (pos: number) => PunctToken): TokenizeResult | null {
    if (input.length > this.#maxInputLength) {
      return {
        ok: false,
        errors: [{
          code: "INPUT_TOO_LONG", offset: 0, length: input.length,
          message: `Input length ${input.length} exceeds maximum ${this.#maxInputLength}`,
        }],
        tokens: [eofAt(0)],
      };
    }
    if (/^[ \t\r\n]*$/.test(input)) {
      return {
        ok: false,
        errors: [{
          code: "EMPTY_INPUT", offset: 0, length: 0,
          message: "Empty or whitespace-only assertion string",
        }],
        tokens: [eofAt(0)],
      };
    }
    return null;
  }

  #makePushToken(tokens: Token[], errors: LexError[]): (tok: Token) => boolean {
    return (tok: Token): boolean => {
      if (tokens.length >= this.#maxTokenCount - 1) {
        errors.push({
          code: "TOO_MANY_TOKENS", offset: tok.span.start, length: 0,
          message: `Token count would exceed maximum ${this.#maxTokenCount}`,
        });
        return false;
      }
      tokens.push(tok);
      return true;
    };
  }

  #scanLoop(
    input: string, tokens: Token[], errors: LexError[],
    pushToken: (tok: Token) => boolean, prevKind: (offset?: number) => TokenKind | undefined,
  ): number {
    let i = 0;
    while (i < input.length) {
      const ch = input[i];
      if (ch === undefined) break;
      if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") { i++; continue; }
      const start = i;
      const next = this.#dispatchChar(input, start, ch, tokens, errors, pushToken, prevKind);
      if (next === null) break;
      i = next;
    }
    return i;
  }

  #dispatchChar(
    input: string, start: number, ch: string, tokens: Token[], errors: LexError[],
    pushToken: (tok: Token) => boolean, prevKind: (offset?: number) => TokenKind | undefined,
  ): number | null {
    const rangeSep = this.#tryRangeSep(input, start, ch, pushToken);
    if (rangeSep !== undefined) return rangeSep;
    if (/[A-Za-z_]/.test(ch)) return this.#handleWord(input, start, tokens.length, pushToken);
    if (ch === '"' || ch === "'") return scanString(input, start, ch, errors, pushToken);
    if (ch === "/") return this.#handleSlash(input, start, prevKind, errors, pushToken);
    if (ch === "-") return this.#handleMinus(input, start, prevKind, errors, pushToken);
    if (/[0-9]/.test(ch)) return scanNumber(input, start, errors, pushToken);
    const punct = this.#handlePunct(ch, start, pushToken);
    if (punct !== null) return punct;
    errors.push({
      code: "STRAY_CHARACTER", offset: start, length: 1,
      message: `Stray character '${ch}' at offset ${start}`,
    });
    return start + 1;
  }

  #tryRangeSep(
    input: string, start: number, ch: string, pushToken: (tok: Token) => boolean,
  ): number | null | undefined {
    if (ch !== "." || input[start + 1] !== ".") return undefined;
    if (!pushToken({ kind: "range_sep", span: { start, end: start + 2 }, raw: ".." })) return null;
    return start + 2;
  }

  #handleWord(
    input: string, start: number, tokenCount: number, pushToken: (tok: Token) => boolean,
  ): number {
    let end = start + 1;
    while (end < input.length && /[A-Za-z0-9_.]/.test(input[end] ?? "")) end++;
    const lexeme = input.slice(start, end);
    const span = { start, end };
    if (lexeme === "true") {
      pushToken({ kind: "boolean", value: true, span, raw: lexeme });
    } else if (lexeme === "false") {
      pushToken({ kind: "boolean", value: false, span, raw: lexeme });
    } else if (lexeme === "null") {
      pushToken({ kind: "null", span, raw: lexeme });
    } else if (tokenCount === 0) {
      pushToken({ kind: "target", span, raw: lexeme });
    } else {
      pushToken({ kind: "identifier", span, raw: lexeme });
    }
    return end;
  }

  #handleSlash(
    input: string, start: number, prevKind: (offset?: number) => TokenKind | undefined,
    errors: LexError[], pushToken: (tok: Token) => boolean,
  ): number {
    const prev = prevKind(1);
    const prevPrev = prevKind(2);
    const isDivision = prev !== undefined && (
      DIV_IMMEDIATE_VALUE_KINDS.has(prev) || (prev === "identifier" && prevPrev !== "target")
    );
    if (isDivision) {
      pushToken({ kind: "arith_op", op: "/", span: { start, end: start + 1 }, raw: "/" });
      return start + 1;
    }
    return scanRegex(input, start, errors, pushToken);
  }

  #handleMinus(
    input: string, start: number, prevKind: (offset?: number) => TokenKind | undefined,
    errors: LexError[], pushToken: (tok: Token) => boolean,
  ): number {
    const nextCh = input[start + 1];
    const prev = prevKind(1);
    const prevPrev = prevKind(2);
    const prevIsValue = prev !== undefined && (
      MINUS_IMMEDIATE_VALUE_KINDS.has(prev) || (prev === "identifier" && prevPrev !== "target")
    );
    if (!prevIsValue && nextCh !== undefined && /[0-9]/.test(nextCh)) {
      return scanNumber(input, start, errors, pushToken);
    }
    pushToken({ kind: "arith_op", op: "-", span: { start, end: start + 1 }, raw: "-" });
    return start + 1;
  }

  #handlePunct(ch: string, start: number, pushToken: (tok: Token) => boolean): number | null {
    if (ch === "(") {
      pushToken({ kind: "lparen", span: { start, end: start + 1 }, raw: "(" });
      return start + 1;
    }
    if (ch === ")") {
      pushToken({ kind: "rparen", span: { start, end: start + 1 }, raw: ")" });
      return start + 1;
    }
    if (ch === "+") {
      pushToken({ kind: "arith_op", op: "+", span: { start, end: start + 1 }, raw: "+" });
      return start + 1;
    }
    if (ch === "*") {
      pushToken({ kind: "arith_op", op: "*", span: { start, end: start + 1 }, raw: "*" });
      return start + 1;
    }
    return null;
  }
}
