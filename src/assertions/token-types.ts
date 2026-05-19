/**
 * Token model and related types for the AssertionTokenizer. Defines the
 * discriminated token union, span, error types, and result type consumed by
 * the parser-orchestrator. Extracted to keep tokenizer.ts within the 300-line
 * soft limit while preserving an identical public API.
 */

/**
 * Maximum accepted assertion-string length, in UTF-16 code units.
 * 8192 is generous headroom; an over-long input fails cleanly with
 * `INPUT_TOO_LONG` rather than driving a long scan.
 */
export const MAX_INPUT_LENGTH = 8192;

/**
 * Maximum number of tokens (including the terminal `eof`) emitted for
 * one assertion. 1024 is far above any legitimate §4 assertion yet bounds
 * the output of a degenerate input.
 */
export const MAX_TOKEN_COUNT = 1024;

/**
 * The lexical category of a token. `target` and `identifier` share the same
 * lexeme grammar; they are distinguished ONLY by token position.
 */
export type TokenKind =
  | "target"
  | "identifier"
  | "string"
  | "number"
  | "boolean"
  | "null"
  | "regex"
  | "lparen"
  | "rparen"
  | "arith_op"
  | "range_sep"
  | "eof";

/** Half-open source span `[start, end)` on the ORIGINAL input string. */
export interface TokenSpan {
  /** 0-based index of the first character of the lexeme. */
  readonly start: number;
  /** 0-based index one past the last character of the lexeme. */
  readonly end: number;
}

/** Properties shared by every token. */
interface TokenBase {
  readonly kind: TokenKind;
  readonly span: TokenSpan;
  readonly raw: string;
}

/** A TARGET-position dotted path lexeme; raw text preserved verbatim. */
export interface TargetToken extends TokenBase {
  readonly kind: "target";
}

/** A bareword in OPERATOR or target-ref-operand position (raw). */
export interface IdentifierToken extends TokenBase {
  readonly kind: "identifier";
}

/** A string literal; `value` is decoded, `raw` keeps quotes + escapes. */
export interface StringToken extends TokenBase {
  readonly kind: "string";
  readonly value: string;
  readonly quote: '"' | "'";
}

/** A numeric literal; `value` is the parsed finite number. */
export interface NumberToken extends TokenBase {
  readonly kind: "number";
  readonly value: number;
}

/** A `true`/`false` keyword literal. */
export interface BooleanToken extends TokenBase {
  readonly kind: "boolean";
  readonly value: boolean;
}

/** The `null` keyword literal. */
export interface NullToken extends TokenBase {
  readonly kind: "null";
}

/**
 * A regex literal `/source/flags`. The lexer extracts the raw body and raw
 * flag text ONLY; it does NOT validate the flag whitelist.
 */
export interface RegexToken extends TokenBase {
  readonly kind: "regex";
  /** Pattern body between the delimiters, escapes preserved, raw. */
  readonly source: string;
  /** Verbatim trailing flag characters (unchecked here). */
  readonly flags: string;
}

/** A punctuation/structural token with no extra payload. */
export interface PunctToken extends TokenBase {
  readonly kind: "lparen" | "rparen" | "range_sep" | "eof";
}

/** An arithmetic binary-operator token. */
export interface ArithOpToken extends TokenBase {
  readonly kind: "arith_op";
  readonly op: "+" | "-" | "*" | "/";
}

/** The discriminated token union the parser-orchestrator consumes. */
export type Token =
  | TargetToken
  | IdentifierToken
  | StringToken
  | NumberToken
  | BooleanToken
  | NullToken
  | RegexToken
  | PunctToken
  | ArithOpToken;

/**
 * One lexical error. `offset` is the 0-based index in the original input
 * where the problem was detected.
 */
export interface LexError {
  /** Stable machine code for the lexical fault. */
  readonly code: LexErrorCode;
  /** 0-based offset of the fault on the original input. */
  readonly offset: number;
  /** Length of the offending span (0 = "unexpected end of input"). */
  readonly length: number;
  /** Human-readable, position-bearing explanation. */
  readonly message: string;
}

/**
 * Stable lexical-fault vocabulary (string-literal union — repo idiom;
 * never a numeric enum).
 */
export type LexErrorCode =
  | "EMPTY_INPUT"
  | "INPUT_TOO_LONG"
  | "TOO_MANY_TOKENS"
  | "UNTERMINATED_STRING"
  | "UNTERMINATED_REGEX"
  | "DANGLING_ESCAPE"
  | "STRAY_CHARACTER"
  | "MALFORMED_NUMBER";

/**
 * No-throw result of LEXING one assertion string. On failure `tokens` is STILL
 * present (a best-effort partial stream).
 */
export type TokenizeResult =
  | { readonly ok: true; readonly tokens: readonly Token[] }
  | {
      readonly ok: false;
      readonly errors: readonly LexError[];
      readonly tokens: readonly Token[];
    };

/**
 * Tunable lexer bounds. Constructor-injected so unit tests can drive the
 * over-limit branches with tiny values.
 */
export interface TokenizerOptions {
  /** Override {@link MAX_INPUT_LENGTH} (tests use a small value). */
  readonly maxInputLength?: number;
  /** Override {@link MAX_TOKEN_COUNT} (tests use a small value). */
  readonly maxTokenCount?: number;
}

/**
 * Token kinds that "complete a value" for `/` regex-vs-division disambiguation.
 * After these, `/` is a division operator. `identifier` is NOT included; the
 * two-level context check (prevPrev) disambiguates operator-position identifiers
 * (like `matches`) from value-position ones (like `a` in `a / 2`).
 */
export const DIV_IMMEDIATE_VALUE_KINDS = new Set<TokenKind>([
  "number", "string", "boolean", "null", "target", "rparen", "regex",
]);

/**
 * Token kinds that make `-` a binary subtraction (when next char is a digit).
 * Same set as {@link DIV_IMMEDIATE_VALUE_KINDS}; extracted for clarity.
 */
export const MINUS_IMMEDIATE_VALUE_KINDS = new Set<TokenKind>([
  "number", "string", "boolean", "null", "target", "rparen", "regex",
]);
