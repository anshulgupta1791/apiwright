/**
 * String-literal scanning helpers for the AssertionTokenizer. Handles escape
 * sequence processing and string-body scanning. Extracted from
 * tokenizer-scanners.ts to keep each file within the 300-line soft limit.
 * These are private implementation details; importers should use
 * tokenizer-scanners.ts instead.
 */

import type { LexError } from "./token-types.js";

/** Length of a Unicode escape sequence body (4 hex digits). */
const UNICODE_ESC_LEN = 4;

/** Radix for hexadecimal parseInt calls. */
const HEX_RADIX = 16;

/** Table of simple (non-unicode) backslash escape mappings. */
export const SIMPLE_ESCAPES: Record<string, string> = {
  n: "\n", r: "\r", t: "\t", "\\": "\\", "/": "/", '"': '"', "'": "'",
};

/** Result of processing one backslash escape sequence. */
export interface EscapeResult {
  /** Decoded character to append to the accumulator. */
  char: string;
  /** Next cursor position after the escape. */
  nextPos: number;
  /** True if the outer loop should break (dangling escape). */
  broke: boolean;
}

/**
 * Process `\uXXXX` escape. Returns the decoded char if valid hex; otherwise
 * the literal `u` with no cursor advance past the hex digits.
 * @param input - Full assertion input string.
 * @param pos - Position of the first hex digit (after `\u`).
 * @returns EscapeResult with decoded char and advanced position.
 */
export function processUnicodeEscape(input: string, pos: number): EscapeResult {
  const hex = input.slice(pos, pos + UNICODE_ESC_LEN);
  if (/^[0-9A-Fa-f]{4}$/.test(hex)) {
    return {
      char: String.fromCharCode(parseInt(hex, HEX_RADIX)),
      nextPos: pos + UNICODE_ESC_LEN,
      broke: false,
    };
  }
  return { char: "u", nextPos: pos, broke: false };
}

/**
 * Process one `\X` escape starting at `pos` (the `\` character).
 * @param input - Full assertion input string.
 * @param pos - Index of the `\` character.
 * @param errors - Mutable error list.
 * @returns The decoded `char`, the new `nextPos`, and a `broke` flag.
 */
export function processEscape(input: string, pos: number, errors: LexError[]): EscapeResult {
  if (pos + 1 >= input.length || input[pos + 1] === undefined) {
    errors.push({
      code: "DANGLING_ESCAPE",
      offset: pos,
      length: 1,
      message: `Dangling backslash escape at offset ${pos}`,
    });
    return { char: "", nextPos: pos + 1, broke: true };
  }
  const esc = input[pos + 1] ?? "";
  const nextPos = pos + 2;
  if (esc === "u") return processUnicodeEscape(input, nextPos);
  return { char: SIMPLE_ESCAPES[esc] ?? esc, nextPos, broke: false };
}

/** Result of scanning the body of a regex literal. */
export interface RegexBodyResult {
  /** Accumulated regex pattern body. */
  source: string;
  /** Position after the closing `/` (or end of input if not closed). */
  endPos: number;
  /** True if the closing `/` was found. */
  closed: boolean;
}

/** State for one iteration of the regex body scan loop. */
interface RegexBodyIterState {
  /** Updated `source` accumulator. */
  source: string;
  /** Updated cursor position. */
  i: number;
  /** Updated `inClass` bracket-tracking flag. */
  inClass: boolean;
  /** True → outer loop should break. */
  done: boolean;
  /** True → closing `/` was found. */
  closed: boolean;
}

/** Result of processing one regex backslash escape (raw, not decoded). */
export interface RegexEscapeResult {
  /** Raw escape text to append to the regex source. */
  raw: string;
  /** Next cursor position. */
  nextPos: number;
  /** True if the outer loop should break (dangling escape). */
  broke: boolean;
}

/**
 * Handle a `\` character inside a regex body. Captures the raw 2-char sequence
 * (we do NOT decode escapes in regex — the pattern is passed verbatim to RegExp).
 * @param input - Full assertion input string.
 * @param pos - Index of the `\` character.
 * @param errors - Mutable error list.
 * @returns Raw capture, next position, and broke flag.
 */
export function handleRegexEscape(
  input: string,
  pos: number,
  errors: LexError[],
): RegexEscapeResult {
  if (pos + 1 >= input.length || input[pos + 1] === undefined) {
    errors.push({
      code: "DANGLING_ESCAPE",
      offset: pos,
      length: 1,
      message: `Dangling backslash escape in regex at offset ${pos}`,
    });
    return { raw: "", nextPos: pos + 1, broke: true };
  }
  return { raw: `\\${input[pos + 1] ?? ""}`, nextPos: pos + 2, broke: false };
}

/**
 * True when the character terminates a regex body (line break or end of input).
 * @param c - The character to test (may be `undefined` at end of input).
 * @returns True iff the outer scan loop should stop immediately.
 */
export function isRegexBodyTerminator(c: string | undefined): boolean {
  return c === undefined || c === "\n" || c === "\r";
}

/**
 * Process one character inside a regex body loop iteration.
 * @param input - Full assertion input string.
 * @param i - Current cursor position.
 * @param source - Accumulated source so far.
 * @param inClass - Whether we are inside a `[...]` character class.
 * @param errors - Mutable error list.
 * @returns Updated state for the outer loop.
 */
export function processRegexBodyChar(
  input: string,
  i: number,
  source: string,
  inClass: boolean,
  errors: LexError[],
): RegexBodyIterState {
  const c = input[i];
  if (isRegexBodyTerminator(c)) {
    return { source, i, inClass, done: true, closed: false };
  }
  const ch = c as string;
  if (ch === "\\") {
    const r = handleRegexEscape(input, i, errors);
    return { source: source + r.raw, i: r.nextPos, inClass, done: r.broke, closed: false };
  }
  if (ch === "[" && !inClass) {
    return { source: `${source}[`, i: i + 1, inClass: true, done: false, closed: false };
  }
  if (ch === "]" && inClass) {
    return { source: `${source}]`, i: i + 1, inClass: false, done: false, closed: false };
  }
  if (ch === "/" && !inClass) {
    return { source, i: i + 1, inClass, done: true, closed: true };
  }
  return { source: source + ch, i: i + 1, inClass, done: false, closed: false };
}

/**
 * Scan the body of a regex literal between the opening `/` and closing `/`.
 * Handles escape sequences and character-class brackets so `/` inside `[...]`
 * is not treated as a terminator.
 * @param input - Full assertion input string.
 * @param start - Index of the opening `/`.
 * @param errors - Mutable error list.
 * @returns The `source`, `endPos`, and `closed` flag.
 */
export function scanRegexBody(
  input: string,
  start: number,
  errors: LexError[],
): RegexBodyResult {
  let i = start + 1; // skip opening `/`
  let source = "";
  let inClass = false;
  let closed = false;

  while (i < input.length) {
    const state = processRegexBodyChar(input, i, source, inClass, errors);
    source = state.source;
    i = state.i;
    inClass = state.inClass;
    if (state.done) { closed = state.closed; break; }
  }

  return { source, endPos: i, closed };
}
