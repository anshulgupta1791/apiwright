import { describe, it, expect } from "vitest";

import {
  AssertionTokenizer,
} from "../../../src/assertions/tokenizer.js";
import type { TokenizeResult } from "../../../src/assertions/tokenizer.js";

/**
 * Unit tests for AssertionTokenizer — Part 2.
 *
 * Covers: the full disambiguation matrix (regex-vs-division, unary-minus-vs-
 * binary-arith_op, range separator and decimal-range boundary), determinism,
 * no-coercion (numeric-looking string stays string; operator keyword inside
 * string is data), whitespace insensitivity, partial assertions (lexer never
 * enforces structure), token span structure.
 *
 * Part 1 (constants, seam, happy path, literal kinds, LexErrorCodes, aggregation)
 * is in tokenizer.test.ts.
 *
 * No implementation exists — all tests must fail with module-not-found.
 */

function tok(input: string): TokenizeResult {
  return new AssertionTokenizer().tokenize(input);
}

function kinds(result: TokenizeResult): string[] {
  return result.tokens.map((t) => t.kind);
}

// ---- 1. Regex-vs-division disambiguation --------------------------------
describe("tokenize() — regex-vs-division disambiguation", () => {
  it("(a / 2) — / after target in parens is arith_op '/', not regex", () => {
    const r = tok("x equals (a / 2)");
    const divOp = r.tokens.find(
      (t) => t.kind === "arith_op" && (t as { op?: string }).op === "/"
    );
    expect(divOp).toBeDefined();
    expect(r.tokens.find((t) => t.kind === "regex")).toBeUndefined();
  });

  it("(a/2) — / without space after target is arith_op, not regex", () => {
    const r = tok("x equals (a/2)");
    const divOp = r.tokens.find(
      (t) => t.kind === "arith_op" && (t as { op?: string }).op === "/"
    );
    expect(divOp).toBeDefined();
    expect(r.tokens.find((t) => t.kind === "regex")).toBeUndefined();
  });

  it("(a) / 2 — / after rparen is arith_op", () => {
    const r = tok("x equals (a) / 2");
    const divOp = r.tokens.find(
      (t) => t.kind === "arith_op" && (t as { op?: string }).op === "/"
    );
    expect(divOp).toBeDefined();
  });

  it("a matches /a\\/b/i — / after identifier 'matches' is regex start", () => {
    const r = tok("a matches /a\\/b/i");
    expect(r.tokens.find((t) => t.kind === "regex")).toBeDefined();
    expect(r.tokens.find(
      (t) => t.kind === "arith_op" && (t as { op?: string }).op === "/"
    )).toBeUndefined();
  });

  it("/[a/b]+/ — / in char class is part of body; one regex token emitted", () => {
    const r = tok("a matches /[a/b]+/");
    const rxToks = r.tokens.filter((t) => t.kind === "regex");
    expect(rxToks).toHaveLength(1);
  });
});

// ---- 2. Unary-minus vs subtraction disambiguation -----------------------
describe("tokenize() — unary-minus vs subtraction", () => {
  it("a equals -5 — - followed by digit after operator → negative number literal", () => {
    const r = tok("a equals -5");
    const num = r.tokens.find((t) => t.kind === "number");
    if (num?.kind === "number") expect(num.value).toBe(-5);
    expect(r.tokens.find(
      (t) => t.kind === "arith_op" && (t as { op?: string }).op === "-"
    )).toBeUndefined();
  });

  it("(a - 5) — - after target with space → binary arith_op('-')", () => {
    const r = tok("x equals (a - 5)");
    const arithMinus = r.tokens.find(
      (t) => t.kind === "arith_op" && (t as { op?: string }).op === "-"
    );
    expect(arithMinus).toBeDefined();
  });

  it("(a-5) — - after target with no space → binary arith_op('-') (whitespace-insensitive rule)", () => {
    const r = tok("x equals (a-5)");
    const arithMinus = r.tokens.find(
      (t) => t.kind === "arith_op" && (t as { op?: string }).op === "-"
    );
    expect(arithMinus).toBeDefined();
  });
});

// ---- 3. Range separator -------------------------------------------------
describe("tokenize() — range separator", () => {
  it("100..599 lexes as target, identifier, number(100), range_sep, number(599), eof", () => {
    const r = tok("a in_range 100..599");
    expect(kinds(r)).toEqual(
      ["target", "identifier", "number", "range_sep", "number", "eof"]
    );
  });

  it("1.5..2.5 — decimal range; .. not absorbed into the first number", () => {
    const r = tok("a in_range 1.5..2.5");
    const nums = r.tokens.filter((t) => t.kind === "number");
    expect(nums).toHaveLength(2);
    if (nums[0]?.kind === "number") expect(nums[0].value).toBe(1.5);
    if (nums[1]?.kind === "number") expect(nums[1].value).toBe(2.5);
  });

  it("100..-5 — negative number after range_sep", () => {
    const r = tok("a in_range 100..-5");
    expect(kinds(r)).toEqual(
      ["target", "identifier", "number", "range_sep", "number", "eof"]
    );
    const nums = r.tokens.filter((t) => t.kind === "number");
    if (nums[1]?.kind === "number") expect(nums[1].value).toBe(-5);
  });

  it("a equals ..5 — lone range_sep is a valid token; lexer does not error", () => {
    const r = tok("a equals ..5");
    expect(r.tokens.some((t) => t.kind === "range_sep")).toBe(true);
  });
});

// ---- 4. No-coercion / data-not-operator ---------------------------------
describe("tokenize() — no coercion, operator keywords inside strings are data", () => {
  it('equals "201" — numeric-looking string stays string token, not number', () => {
    const r = tok('a equals "201"');
    const str = r.tokens.find((t) => t.kind === "string");
    if (str?.kind === "string") expect(str.value).toBe("201");
    expect(r.tokens.find((t) => t.kind === "number")).toBeUndefined();
  });

  it('"x not_equals y" — operator keyword inside string is ONE string token', () => {
    const r = tok('a equals "x not_equals y"');
    const str = r.tokens.find((t) => t.kind === "string");
    if (str?.kind === "string") expect(str.value).toBe("x not_equals y");
    // only 'equals' is the operator identifier
    const identifiers = r.tokens.filter((t) => t.kind === "identifier");
    expect(identifiers).toHaveLength(1);
  });
});

// ---- 5. Whitespace insensitivity ----------------------------------------
describe("tokenize() — whitespace insensitivity", () => {
  it("extra spaces produce identical token kinds and values", () => {
    const compact = tok("a equals 1");
    const padded = tok("a  equals   1");
    expect(compact.tokens.map((t) => t.kind)).toEqual(padded.tokens.map((t) => t.kind));
  });

  it("leading whitespace — target span.start reflects true offset", () => {
    const r = tok("  a equals 1");
    expect(r.tokens[0].kind).toBe("target");
    expect(r.tokens[0].span.start).toBe(2);
  });
});

// ---- 6. Partial assertions — lexer does not enforce structure -----------
describe("tokenize() — partial assertions (lexer silent on structural faults)", () => {
  it("only a target → [target, eof] — lexer does not error on missing operator", () => {
    const r = tok("response.body.id");
    expect(r.ok).toBe(true);
    expect(kinds(r)).toEqual(["target", "eof"]);
  });

  it("target + nullary operator → [target, identifier, eof]", () => {
    const r = tok("response.body.x exists");
    expect(r.ok).toBe(true);
    expect(kinds(r)).toEqual(["target", "identifier", "eof"]);
  });
});

// ---- 7. Determinism -----------------------------------------------------
describe("tokenize() — determinism", () => {
  it("identical input produces deep-equal token streams", () => {
    const input = "response.body.total equals (request.body.subtotal * 1.08)";
    expect(tok(input)).toEqual(tok(input));
  });
});

// ---- 8. Token span structure --------------------------------------------
describe("tokenize() — token span structure", () => {
  it("every token has span with start <= end", () => {
    const r = tok("response.body equals 1");
    for (const t of r.tokens) {
      expect(t.span.start).toBeLessThanOrEqual(t.span.end);
    }
  });

  it("eof token is zero-width (span.start === span.end)", () => {
    const r = tok("a equals 1");
    const eof = r.tokens[r.tokens.length - 1];
    expect(eof.kind).toBe("eof");
    expect(eof.span.start).toBe(eof.span.end);
  });
});

// ---- 9. LexError structure ----------------------------------------------
describe("tokenize() — LexError structure", () => {
  it("every LexError has code, offset, length, message fields", () => {
    const r = tok("@ bad");
    if (!r.ok) {
      for (const err of r.errors) {
        expect(typeof err.code).toBe("string");
        expect(typeof err.offset).toBe("number");
        expect(typeof err.length).toBe("number");
        expect(typeof err.message).toBe("string");
      }
    }
  });
});
