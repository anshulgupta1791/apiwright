/**
 * Pure scanning helpers for the AssertionTokenizer. Each function performs a
 * single bounded forward pass over one lexeme kind (string / regex / number),
 * starting at `start`, and returns the cursor position after the lexeme.
 * They NEVER throw; errors are pushed to the caller-supplied `errors` array.
 * Extracted to keep `tokenizer.ts` under the 500-line hard limit.
 *
 * String/regex body helpers live in {@link ./tokenizer-string-scan.js} to keep
 * this file within the 300-line soft limit.
 */

import type { LexError, NumberToken, StringToken, Token } from "./token-types.js";
import { processEscape, scanRegexBody } from "./tokenizer-string-scan.js";

export { scanRegexBody } from "./tokenizer-string-scan.js";

/**
 * Scan a string literal starting at `start` (the opening quote character).
 * @param input - Full assertion input string.
 * @param start - Index of the opening quote (`"` or `'`).
 * @param quote - The delimiter character.
 * @param errors - Mutable error list (errors are pushed here).
 * @param pushToken - Guarded push callback; returns false when limit exceeded.
 * @returns New cursor position after the closing quote (or best-effort end).
 */
export function scanString(
  input: string,
  start: number,
  quote: '"' | "'",
  errors: LexError[],
  pushToken: (tok: Token) => boolean,
): number {
  let i = start + 1; // skip opening quote
  let value = "";
  let closed = false;

  while (i < input.length) {
    const c = input[i];
    if (c === undefined) break;
    if (c === "\\") {
      const result = processEscape(input, i, errors);
      value += result.char;
      i = result.nextPos;
      if (result.broke) break;
      continue;
    }
    if (c === quote) { i++; closed = true; break; }
    value += c;
    i++;
  }

  if (!closed) {
    errors.push({
      code: "UNTERMINATED_STRING",
      offset: start,
      length: i - start,
      message: `Unterminated string literal starting at offset ${start}`,
    });
  }

  const tok: StringToken = {
    kind: "string",
    value,
    quote,
    span: { start, end: i },
    raw: input.slice(start, i),
  };
  pushToken(tok);
  return i;
}

/**
 * Scan a regex literal starting at `start` (the opening `/`).
 * @param input - Full assertion input string.
 * @param start - Index of the opening `/`.
 * @param errors - Mutable error list (errors are pushed here).
 * @param pushToken - Guarded push callback; returns false when limit exceeded.
 * @returns New cursor position after the trailing flags (or best-effort end).
 */
export function scanRegex(
  input: string,
  start: number,
  errors: LexError[],
  pushToken: (tok: Token) => boolean,
): number {
  const { source, endPos, closed } = scanRegexBody(input, start, errors);

  if (!closed) {
    errors.push({
      code: "UNTERMINATED_REGEX",
      offset: start,
      length: endPos - start,
      message: `Unterminated regex literal starting at offset ${start}`,
    });
  }

  let i = endPos;
  let flags = "";
  while (i < input.length && /[A-Za-z]/.test(input[i] ?? "")) {
    flags += input[i];
    i++;
  }

  const raw = input.slice(start, i);
  pushToken({ kind: "regex", source, flags, span: { start, end: i }, raw });
  return i;
}

/**
 * Scan a numeric literal starting at `start` (which may be `-` or a digit).
 * @param input - Full assertion input string.
 * @param start - Index of the first character (`-` or `0`–`9`).
 * @param errors - Mutable error list (errors are pushed here).
 * @param pushToken - Guarded push callback; returns false when limit exceeded.
 * @returns New cursor position after the number.
 */
export function scanNumber(
  input: string,
  start: number,
  errors: LexError[],
  pushToken: (tok: Token) => boolean,
): number {
  let i = start;
  if (input[i] === "-") i++;
  while (i < input.length && /[0-9]/.test(input[i] ?? "")) i++;
  i = advanceFraction(input, i);

  const slice = input.slice(start, i);
  pushNumericToken(slice, start, i, errors, pushToken);
  return i;
}

// ─── Private helpers ─────────────────────────────────────────────────────────

/**
 * Advance `i` past a decimal fraction (`.ddd`) if one is present at position
 * `i` and it is NOT the start of a range separator (`..`).
 * @param input - Full assertion input string.
 * @param i - Current cursor position.
 * @returns New cursor position (unchanged if no fraction present).
 */
function advanceFraction(input: string, i: number): number {
  if (
    i < input.length &&
    input[i] === "." &&
    input[i + 1] !== "." &&
    /[0-9]/.test(input[i + 1] ?? "")
  ) {
    i++; // consume `.`
    while (i < input.length && /[0-9]/.test(input[i] ?? "")) i++;
  }
  return i;
}

/**
 * Build and push a number token; push a MALFORMED_NUMBER error when the
 * parsed value is not finite.
 * @param slice - The raw numeric text.
 * @param start - Start offset in the original input.
 * @param end - End offset (exclusive) in the original input.
 * @param errors - Mutable error list.
 * @param pushToken - Guarded push callback.
 */
function pushNumericToken(
  slice: string,
  start: number,
  end: number,
  errors: LexError[],
  pushToken: (tok: Token) => boolean,
): void {
  const val = Number(slice);
  const numTok: NumberToken = {
    kind: "number",
    value: Number.isFinite(val) ? val : 0,
    span: { start, end },
    raw: slice,
  };
  if (!Number.isFinite(val)) {
    errors.push({
      code: "MALFORMED_NUMBER",
      offset: start,
      length: end - start,
      message: `Malformed number '${slice}' at offset ${start}`,
    });
  }
  pushToken(numTok);
}
