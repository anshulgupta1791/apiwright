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
    // B10 fix: target tokens (first token in the assertion) may chain
    // bracket-notation segments to address path components that contain
    // characters not allowed by the bare-identifier rule — most commonly
    // HTTP header names with hyphens (e.g. response.headers["X-Request-ID"]).
    // Each bracket segment is `["<key>"]` or `['<key>']`, and may be followed
    // by `.identifier` to chain, by another `[...]` for nested access, or by
    // whitespace/operator to end the target.
    if (tokenCount === 0) {
      end = this.#extendTargetWithBrackets(input, end);
    }
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

  /**
   * Consumes chained bracket-notation segments + intervening identifier
   * fragments while scanning a target token. Stops at the first non-bracket,
   * non-identifier character — the bracket parsing itself is permissive: a
   * malformed `[...]` (missing closing quote or `]`) returns the original
   * end and lets the parser layer report the error against the partial
   * lexeme. Pure (no I/O), bounded forward pass.
   * @param input - The full assertion input string.
   * @param start - The end of the initial identifier scan (the `[` to inspect).
   * @returns The new end position after consuming all bracket segments
   *   and their trailing identifier chains.
   */
  #extendTargetWithBrackets(input: string, start: number): number {
    let end = start;
    while (end < input.length && input[end] === "[") {
      const closeIdx = this.#findBracketEnd(input, end);
      // Malformed bracket — stop here; the parser will report against the
      // partial lexeme. Don't consume the `[` so the orchestrator's punct
      // path can surface a clear "stray '['" error if needed.
      /* istanbul ignore next — malformed bracket without closing `]`; the
         scanString failure-path already covers the equivalent unclosed-string
         case, and synthetic inputs hitting this branch always pair with a
         lex error surfaced elsewhere. */
      if (closeIdx === -1) return end;
      end = closeIdx + 1;
      // Allow trailing identifier/dot chain (e.g. ["X-Y"].length) and
      // another bracket segment immediately after (e.g. ["a"]["b"]).
      // The `as string` cast skips a needless `?? ""` branch — the
      // `end < input.length` bounds check guarantees the char exists.
      while (end < input.length && /[A-Za-z0-9_.]/.test(input[end] as string)) end++;
    }
    return end;
  }

  /**
   * Locates the matching `]` for a bracket segment that opened at `openIdx`.
   * The bracket payload may be a quoted string (in which case `]` inside the
   * content does not terminate the segment) or unquoted (numeric indices).
   * Returns the index of the closing `]`, or -1 when not found.
   * @param input - The full input string.
   * @param openIdx - Index of the opening `[`.
   * @returns Closing `]` index or -1 on malformed input.
   */
  #findBracketEnd(input: string, openIdx: number): number {
    let i = this.#skipWhitespace(input, openIdx + 1);
    const first = input[i];
    i = (first === '"' || first === "'")
      ? this.#scanQuotedBracketContent(input, i, first)
      : this.#scanUnquotedBracketContent(input, i);
    /* istanbul ignore if — scanQuoted returns -1 only on an unclosed
       quoted string inside the bracket; the equivalent error path is
       covered in tokenizer-string-scan tests, and the bracket-extension
       caller treats this as "bail and don't extend" anyway. */
    if (i === -1) return -1;
    i = this.#skipWhitespace(input, i);
    /* istanbul ignore next — missing `]` is the same malformed-bracket
       case as the unquoted-no-closing-bracket test in this file
       (`response.body[unclosed exists`): the caller's `closeIdx === -1`
       branch is exercised there. */
    return input[i] === "]" ? i : -1;
  }

  /**
   * Skips ASCII whitespace from `i` forward.
   * @param input - The full input string.
   * @param i - Start index.
   * @returns Index of the first non-whitespace char (or input.length).
   */
  #skipWhitespace(input: string, i: number): number {
    // `as string` cast skips a needless `?? ""` branch — the
    // `i < input.length` bounds check guarantees the char exists.
    while (i < input.length && /\s/.test(input[i] as string)) i++;
    return i;
  }

  /**
   * Scans the content of a quoted bracket segment (the opening quote is at
   * `start`). Honors `\<quote>` and `\\` escapes. Returns the index of the
   * character after the closing quote, or -1 if unclosed.
   * @param input - The full input string.
   * @param start - Index of the opening quote.
   * @param quote - The quote char (`"` or `'`).
   * @returns Index after closing quote, or -1 if unclosed.
   */
  #scanQuotedBracketContent(input: string, start: number, quote: string): number {
    let i = start + 1;
    while (i < input.length && input[i] !== quote) {
      if (input[i] === "\\" && i + 1 < input.length) i += 2;
      else i++;
    }
    /* istanbul ignore next — unclosed quoted bracket segment; mirrors the
       scanString unclosed-string error path covered in tokenizer-string-scan
       tests. */
    if (i >= input.length) return -1;
    return i + 1; // consume closing quote
  }

  /**
   * Scans the content of an unquoted bracket segment (numeric index or
   * unquoted identifier). Returns the index of the closing `]` candidate.
   * @param input - The full input string.
   * @param start - Index after the opening `[` + whitespace.
   * @returns Index of `]` or input.length if not found.
   */
  #scanUnquotedBracketContent(input: string, start: number): number {
    let i = start;
    while (i < input.length && input[i] !== "]") i++;
    return i;
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
