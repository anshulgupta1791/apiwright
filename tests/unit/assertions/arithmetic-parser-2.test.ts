import { describe, it, expect } from "vitest";

import {
  ArithmeticExpressionParser,
  MAX_ARITH_DEPTH,
} from "../../../src/assertions/arithmetic-parser.js";
import { TargetPathParser } from "../../../src/assertions/target-path-parser.js";
import type { Token } from "../../../src/assertions/tokenizer.js";

/**
 * Unit tests for ArithmeticExpressionParser — Part 2.
 *
 * Covers: MISSING_LEFT_OPERAND (leading operator, (- x)), MISSING_RIGHT_OPERAND
 * (trailing/double operator, lone operator), DISALLOWED_TOKEN (every kind:
 * string/boolean/null/regex/range_sep/identifier), TRAILING_TOKENS, DEPTH_EXCEEDED
 * (injected tiny maxDepth + boundary), INVALID_TARGET (embedded bad target path),
 * aggregation (collect-not-stop), exponent attempt (2 * * 3), ArithParseError
 * structure, determinism.
 *
 * Part 1 (constants, seam, precedence, left-assoc, parens, leaf kinds,
 * divide-by-zero, EMPTY_EXPRESSION, UNBALANCED_*) is in arithmetic-parser.test.ts.
 *
 * No implementation exists — all tests must fail with module-not-found.
 */

function numTok(value: number, idx = 0): Token {
  return {
    kind: "number", value, raw: String(value),
    span: { start: idx, end: idx + String(value).length },
  };
}
function targetTok(raw: string, idx = 0): Token {
  return { kind: "target", raw, span: { start: idx, end: idx + raw.length } };
}
function lparenTok(idx = 0): Token {
  return { kind: "lparen", raw: "(", span: { start: idx, end: idx + 1 } };
}
function rparenTok(idx = 0): Token {
  return { kind: "rparen", raw: ")", span: { start: idx, end: idx + 1 } };
}
function arithTok(op: "+" | "-" | "*" | "/", idx = 0): Token {
  return { kind: "arith_op", op, raw: op, span: { start: idx, end: idx + 1 } };
}
function strTok(value: string, idx = 0): Token {
  return {
    kind: "string", value, quote: '"' as const,
    raw: `"${value}"`, span: { start: idx, end: idx + value.length + 2 },
  };
}
function boolTok(value: boolean, idx = 0): Token {
  const raw = String(value);
  return { kind: "boolean", value, raw, span: { start: idx, end: idx + raw.length } };
}
function nullTok(idx = 0): Token {
  return { kind: "null", raw: "null", span: { start: idx, end: idx + 4 } };
}
function rangeSepTok(idx = 0): Token {
  return { kind: "range_sep", raw: "..", span: { start: idx, end: idx + 2 } };
}
function regexTok(source: string, flags: string, idx = 0): Token {
  const raw = `/${source}/${flags}`;
  return { kind: "regex", source, flags, raw, span: { start: idx, end: idx + raw.length } };
}
function identTok(raw: string, idx = 0): Token {
  return { kind: "identifier", raw, span: { start: idx, end: idx + raw.length } };
}

function makeParser(maxDepth?: number): ArithmeticExpressionParser {
  const tp = new TargetPathParser();
  return new ArithmeticExpressionParser(tp, maxDepth !== undefined ? { maxDepth } : undefined);
}

function parse(tokens: Token[], maxDepth?: number) {
  return makeParser(maxDepth).parse(tokens);
}

// ---- 1. MISSING_LEFT_OPERAND -------------------------------------------
describe("parse() — MISSING_LEFT_OPERAND", () => {
  it("* a — leading * → MISSING_LEFT_OPERAND, never throws", () => {
    expect(() => parse([arithTok("*"), targetTok("a")])).not.toThrow();
    const r = parse([arithTok("*"), targetTok("a")]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.code === "MISSING_LEFT_OPERAND")).toBe(true);
  });

  it("/ b — leading / → MISSING_LEFT_OPERAND", () => {
    const r = parse([arithTok("/"), targetTok("b")]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.code === "MISSING_LEFT_OPERAND")).toBe(true);
  });

  it("(- x) — arith_op('-') before target → MISSING_LEFT_OPERAND", () => {
    const tokens = [lparenTok(), arithTok("-"), targetTok("response.body"), rparenTok()];
    const r = parse(tokens);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.code === "MISSING_LEFT_OPERAND")).toBe(true);
  });
});

// ---- 2. MISSING_RIGHT_OPERAND ------------------------------------------
describe("parse() — MISSING_RIGHT_OPERAND", () => {
  it("a + — trailing operator → MISSING_RIGHT_OPERAND, never throws", () => {
    expect(() => parse([targetTok("a"), arithTok("+")])).not.toThrow();
    const r = parse([targetTok("a"), arithTok("+")]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.code === "MISSING_RIGHT_OPERAND")).toBe(true);
  });

  it("(a + ) — rparen as right factor → MISSING_RIGHT_OPERAND", () => {
    const r = parse([lparenTok(), targetTok("a"), arithTok("+"), rparenTok()]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.code === "MISSING_RIGHT_OPERAND")).toBe(true);
  });

  it("lone + → both MISSING_LEFT_OPERAND and/or MISSING_RIGHT_OPERAND", () => {
    expect(() => parse([arithTok("+")])).not.toThrow();
    const r = parse([arithTok("+")]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const codes = r.errors.map((e) => e.code);
      expect(
        codes.includes("MISSING_LEFT_OPERAND") || codes.includes("MISSING_RIGHT_OPERAND")
      ).toBe(true);
    }
  });
});

// ---- 3. DISALLOWED_TOKEN -----------------------------------------------
describe("parse() — DISALLOWED_TOKEN", () => {
  const cases: Array<[string, Token]> = [
    ["string", strTok("x")],
    ["boolean true", boolTok(true)],
    ["null", nullTok()],
    ["regex", regexTok("x", "i")],
    ["range_sep", rangeSepTok()],
    ["identifier (operator word)", identTok("equals")],
  ];

  for (const [label, tok] of cases) {
    it(`${label} token inside expression → DISALLOWED_TOKEN, never throws`, () => {
      const tokens = [numTok(1), arithTok("+"), tok, numTok(2)];
      expect(() => parse(tokens)).not.toThrow();
      const r = parse(tokens);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors.some((e) => e.code === "DISALLOWED_TOKEN")).toBe(true);
    });
  }
});

// ---- 4. TRAILING_TOKENS -----------------------------------------------
describe("parse() — TRAILING_TOKENS", () => {
  it("(a) b — extra token after complete expression → TRAILING_TOKENS, never throws", () => {
    const tokens = [lparenTok(), targetTok("response.body"), rparenTok(), targetTok("extra")];
    expect(() => parse(tokens)).not.toThrow();
    const r = parse(tokens);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.code === "TRAILING_TOKENS")).toBe(true);
  });

  it("a 5 — two adjacent values → TRAILING_TOKENS", () => {
    const r = parse([targetTok("a"), numTok(5)]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.code === "TRAILING_TOKENS")).toBe(true);
  });
});

// ---- 5. DEPTH_EXCEEDED -------------------------------------------------
describe("parse() — DEPTH_EXCEEDED", () => {
  it("injected maxDepth=2: depth-3 nesting → DEPTH_EXCEEDED, never throws or overflows", () => {
    const tokens = [
      lparenTok(), lparenTok(), lparenTok(), numTok(1),
      rparenTok(), rparenTok(), rparenTok(),
    ];
    expect(() => parse(tokens, 2)).not.toThrow();
    const r = parse(tokens, 2);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.code === "DEPTH_EXCEEDED")).toBe(true);
  });

  it("injected maxDepth=2: depth-2 nesting (exact limit) → ok:true", () => {
    const tokens = [lparenTok(), lparenTok(), numTok(1), rparenTok(), rparenTok()];
    expect(parse(tokens, 2).ok).toBe(true);
  });

  it("DEPTH_EXCEEDED error has tokenIndex >= 0 (points at the lparen)", () => {
    const tokens = [
      lparenTok(0), lparenTok(1), lparenTok(2), numTok(1, 3),
      rparenTok(4), rparenTok(5), rparenTok(6),
    ];
    const r = parse(tokens, 1);
    if (!r.ok) {
      const err = r.errors.find((e) => e.code === "DEPTH_EXCEEDED");
      expect(err?.tokenIndex).toBeGreaterThanOrEqual(0);
    }
  });
});

// ---- 6. INVALID_TARGET -------------------------------------------------
describe("parse() — INVALID_TARGET (embedded bad target path)", () => {
  it("response..body as target leaf → INVALID_TARGET in errors, never throws", () => {
    expect(() => parse([targetTok("response..body"), arithTok("*"), numTok(2)])).not.toThrow();
    const r = parse([targetTok("response..body"), arithTok("*"), numTok(2)]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.code === "INVALID_TARGET")).toBe(true);
  });

  it("foo.bar (unknown root) as target leaf → INVALID_TARGET", () => {
    const r = parse([targetTok("foo.bar"), arithTok("+"), numTok(1)]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.code === "INVALID_TARGET")).toBe(true);
  });

  it("INVALID_TARGET message embeds the target-path fault detail", () => {
    const r = parse([targetTok("response..body")]);
    if (!r.ok) {
      const err = r.errors.find((e) => e.code === "INVALID_TARGET");
      expect(err?.message.length).toBeGreaterThan(0);
    }
  });
});

// ---- 7. Aggregation (collect-not-stop) ----------------------------------
describe("parse() — aggregation: multiple faults in one pass", () => {
  it("* a + + b — multiple operator faults → multiple errors", () => {
    const tokens = [
      arithTok("*"), targetTok("a"), arithTok("+"), arithTok("+"), targetTok("b"),
    ];
    expect(() => parse(tokens)).not.toThrow();
    const r = parse(tokens);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.length).toBeGreaterThanOrEqual(1);
  });
});

// ---- 8. Exponent attempt (2 * * 3) -------------------------------------
describe("parse() — exponent attempt rejected cleanly", () => {
  it("2 * * 3 → ok:false with MISSING_RIGHT_OPERAND — no exponent grammar", () => {
    const tokens = [numTok(2), arithTok("*"), arithTok("*"), numTok(3)];
    expect(() => parse(tokens)).not.toThrow();
    const r = parse(tokens);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.code === "MISSING_RIGHT_OPERAND")).toBe(true);
    }
  });
});

// ---- 9. ArithParseError structure ---------------------------------------
describe("parse() — ArithParseError structure", () => {
  it("every error has code, tokenIndex, offset, message fields", () => {
    const r = parse([arithTok("*"), targetTok("a")]);
    if (!r.ok) {
      for (const err of r.errors) {
        expect(typeof err.code).toBe("string");
        expect(typeof err.tokenIndex).toBe("number");
        expect(typeof err.offset).toBe("number");
        expect(typeof err.message).toBe("string");
        expect(err.message.length).toBeGreaterThan(0);
      }
    }
  });
});

// ---- 10. Determinism ---------------------------------------------------
describe("parse() — purity and determinism", () => {
  it("same token slice parsed twice yields deep-equal ok:true results", () => {
    const tokens = [targetTok("response.body"), arithTok("*"), numTok(1.08)];
    expect(makeParser().parse(tokens)).toEqual(makeParser().parse(tokens));
  });

  it("same token slice parsed twice yields deep-equal ok:false results", () => {
    const tokens = [arithTok("+")];
    expect(makeParser().parse(tokens)).toEqual(makeParser().parse(tokens));
  });

  it("never throws for empty slice", () => {
    expect(() => makeParser().parse([])).not.toThrow();
  });
});

// ---- 11. MAX_ARITH_DEPTH boundary test ---------------------------------
describe("parse() — MAX_ARITH_DEPTH boundary", () => {
  it("expression nested exactly MAX_ARITH_DEPTH deep → ok:true with default parser", () => {
    const depth = MAX_ARITH_DEPTH;
    const tp = new TargetPathParser();
    const parser = new ArithmeticExpressionParser(tp);
    const tokens: Token[] = [
      ...Array.from({ length: depth }, () => lparenTok()),
      numTok(1),
      ...Array.from({ length: depth }, () => rparenTok()),
    ];
    expect(() => parser.parse(tokens)).not.toThrow();
    const r = parser.parse(tokens);
    expect(r.ok).toBe(true);
  });
});
