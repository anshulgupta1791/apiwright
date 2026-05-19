import { describe, it, expect } from "vitest";

import {
  ArithmeticExpressionParser,
  MAX_ARITH_DEPTH,
} from "../../../src/assertions/arithmetic-parser.js";
import { TargetPathParser } from "../../../src/assertions/target-path-parser.js";
import type { Token } from "../../../src/assertions/tokenizer.js";
import type { ArithParseResult } from "../../../src/assertions/arithmetic-parser.js";

/**
 * Unit tests for ArithmeticExpressionParser — Part 1.
 *
 * Covers: MAX_ARITH_DEPTH constant, construction + default-seam, precedence
 * (* / over + -), left-associativity, parentheses (redundant parens flatten),
 * leaf kinds (number/target), divide-by-zero parses ok, EMPTY_EXPRESSION,
 * UNBALANCED_OPEN_PAREN, UNBALANCED_CLOSE_PAREN, EMPTY_PARENS.
 *
 * MISSING_LEFT_OPERAND, MISSING_RIGHT_OPERAND, DISALLOWED_TOKEN, TRAILING_TOKENS,
 * DEPTH_EXCEEDED, INVALID_TARGET, aggregation, and determinism are in
 * arithmetic-parser-2.test.ts.
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

function makeParser(maxDepth?: number): ArithmeticExpressionParser {
  const tp = new TargetPathParser();
  return new ArithmeticExpressionParser(tp, maxDepth !== undefined ? { maxDepth } : undefined);
}

function parse(tokens: Token[], maxDepth?: number): ArithParseResult {
  return makeParser(maxDepth).parse(tokens);
}

// ---- 1. MAX_ARITH_DEPTH constant ----------------------------------------
describe("MAX_ARITH_DEPTH constant", () => {
  it("equals 64", () => {
    expect(MAX_ARITH_DEPTH).toBe(64);
  });
});

// ---- 2. Construction + default-seam wiring ------------------------------
describe("ArithmeticExpressionParser — construction", () => {
  it("constructs with a TargetPathParser and no options without throwing", () => {
    expect(() => makeParser()).not.toThrow();
  });

  it("default maxDepth equals MAX_ARITH_DEPTH — enforces on depth+1 nesting", () => {
    const tp = new TargetPathParser();
    const parser = new ArithmeticExpressionParser(tp);
    const depth = MAX_ARITH_DEPTH + 1;
    const tokens: Token[] = [
      ...Array.from({ length: depth }, () => lparenTok()),
      numTok(1),
      ...Array.from({ length: depth }, () => rparenTok()),
    ];
    expect(() => parser.parse(tokens)).not.toThrow();
    const r = parser.parse(tokens);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.code === "DEPTH_EXCEEDED")).toBe(true);
    }
  });
});

// ---- 3. Precedence: * / bind tighter than + - ---------------------------
describe("parse() — operator precedence", () => {
  it("a*b+c → binary('+', binary('*', a, b), c)", () => {
    const r = parse([targetTok("a"), arithTok("*"), targetTok("b"), arithTok("+"), targetTok("c")]);
    expect(r.ok).toBe(true);
    if (r.ok && r.expr.kind === "binary") {
      expect(r.expr.op).toBe("+");
      expect(r.expr.left.kind).toBe("binary");
      if (r.expr.left.kind === "binary") expect(r.expr.left.op).toBe("*");
    }
  });

  it("a+b*c → binary('+', a, binary('*', b, c))", () => {
    const r = parse([targetTok("a"), arithTok("+"), targetTok("b"), arithTok("*"), targetTok("c")]);
    expect(r.ok).toBe(true);
    if (r.ok && r.expr.kind === "binary") {
      expect(r.expr.op).toBe("+");
      expect(r.expr.right.kind).toBe("binary");
    }
  });
});

// ---- 4. Left-associativity ----------------------------------------------
describe("parse() — left-associativity", () => {
  it("a-b-c → binary('-', binary('-', a, b), c)", () => {
    const r = parse([
      targetTok("a"), arithTok("-"), targetTok("b"), arithTok("-"), targetTok("c"),
    ]);
    expect(r.ok).toBe(true);
    if (r.ok && r.expr.kind === "binary") {
      expect(r.expr.op).toBe("-");
      expect(r.expr.left.kind).toBe("binary");
    }
  });

  it("a/b/c → binary('/', binary('/', a, b), c)", () => {
    const r = parse([
      targetTok("a"), arithTok("/"), targetTok("b"), arithTok("/"), targetTok("c"),
    ]);
    expect(r.ok).toBe(true);
    if (r.ok && r.expr.kind === "binary") {
      expect(r.expr.op).toBe("/");
      expect(r.expr.left.kind).toBe("binary");
    }
  });
});

// ---- 5. Parentheses ----------------------------------------------------
describe("parse() — parentheses", () => {
  it("(a+b)*c → binary('*', binary('+', a, b), c)", () => {
    const r = parse([
      lparenTok(), targetTok("a"), arithTok("+"), targetTok("b"), rparenTok(),
      arithTok("*"), targetTok("c"),
    ]);
    expect(r.ok).toBe(true);
    if (r.ok && r.expr.kind === "binary") {
      expect(r.expr.op).toBe("*");
      expect(r.expr.left.kind).toBe("binary");
    }
  });

  it("(a) — redundant parens: returns bare leaf, no extra node", () => {
    const r = parse([lparenTok(), targetTok("response.body"), rparenTok()]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.expr.kind).toBe("target");
  });

  it("((a)) — double redundant parens: still bare leaf", () => {
    const r = parse([
      lparenTok(), lparenTok(), targetTok("response.body"), rparenTok(), rparenTok(),
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.expr.kind).toBe("target");
  });

  it("(1.08) → number leaf with value 1.08", () => {
    const r = parse([lparenTok(), numTok(1.08), rparenTok()]);
    expect(r.ok).toBe(true);
    if (r.ok && r.expr.kind === "number") expect(r.expr.value).toBe(1.08);
  });
});

// ---- 6. Leaf kinds ------------------------------------------------------
describe("parse() — leaf kinds", () => {
  it("single number leaf -1.08 → {kind:'number', value:-1.08}", () => {
    const r = parse([numTok(-1.08)]);
    expect(r.ok).toBe(true);
    if (r.ok && r.expr.kind === "number") expect(r.expr.value).toBe(-1.08);
  });

  it("x * -1 → binary('*', target, number(-1))", () => {
    const r = parse([targetTok("response.body"), arithTok("*"), numTok(-1)]);
    expect(r.ok).toBe(true);
    if (r.ok && r.expr.kind === "binary") {
      if (r.expr.right.kind === "number") expect(r.expr.right.value).toBe(-1);
    }
  });

  it("single valid target → {kind:'target'}", () => {
    const r = parse([targetTok("response.body")]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.expr.kind).toBe("target");
  });
});

// ---- 7. Divide-by-zero parses ok ----------------------------------------
describe("parse() — divide-by-zero is NOT a parse error", () => {
  it("a/0 → ok:true binary('/', target, number(0))", () => {
    const r = parse([targetTok("response.body"), arithTok("/"), numTok(0)]);
    expect(r.ok).toBe(true);
    if (r.ok && r.expr.kind === "binary") {
      expect(r.expr.op).toBe("/");
      if (r.expr.right.kind === "number") expect(r.expr.right.value).toBe(0);
    }
  });

  it("a/response.body.n → ok:true binary with target as right leaf", () => {
    const r = parse([targetTok("response.body"), arithTok("/"), targetTok("response.body.n")]);
    expect(r.ok).toBe(true);
    if (r.ok && r.expr.kind === "binary") {
      expect(r.expr.right.kind).toBe("target");
    }
  });
});

// ---- 8. EMPTY_EXPRESSION -----------------------------------------------
describe("parse() — EMPTY_EXPRESSION", () => {
  it("empty slice → ok:false EMPTY_EXPRESSION tokenIndex:-1, never throws", () => {
    expect(() => parse([])).not.toThrow();
    const r = parse([]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const err = r.errors.find((e) => e.code === "EMPTY_EXPRESSION");
      expect(err).toBeDefined();
      expect(err?.tokenIndex).toBe(-1);
    }
  });
});

// ---- 9. UNBALANCED_OPEN_PAREN ------------------------------------------
describe("parse() — UNBALANCED_OPEN_PAREN", () => {
  it("(a + b with no closing paren → UNBALANCED_OPEN_PAREN, never throws", () => {
    const tokens = [lparenTok(), targetTok("a"), arithTok("+"), targetTok("b")];
    expect(() => parse(tokens)).not.toThrow();
    const r = parse(tokens);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.code === "UNBALANCED_OPEN_PAREN")).toBe(true);
    }
  });
});

// ---- 10. UNBALANCED_CLOSE_PAREN / TRAILING_TOKENS ----------------------
describe("parse() — spurious closing paren", () => {
  it("a + b) → UNBALANCED_CLOSE_PAREN or TRAILING_TOKENS, never throws", () => {
    const tokens = [targetTok("a"), arithTok("+"), targetTok("b"), rparenTok()];
    expect(() => parse(tokens)).not.toThrow();
    const r = parse(tokens);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const codes = r.errors.map((e) => e.code);
      expect(
        codes.includes("UNBALANCED_CLOSE_PAREN") || codes.includes("TRAILING_TOKENS")
      ).toBe(true);
    }
  });
});

// ---- 11. EMPTY_PARENS --------------------------------------------------
describe("parse() — EMPTY_PARENS", () => {
  it("() → EMPTY_PARENS, never throws", () => {
    expect(() => parse([lparenTok(), rparenTok()])).not.toThrow();
    const r = parse([lparenTok(), rparenTok()]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.code === "EMPTY_PARENS")).toBe(true);
  });

  it("a + () → EMPTY_PARENS", () => {
    const r = parse([targetTok("a"), arithTok("+"), lparenTok(), rparenTok()]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.code === "EMPTY_PARENS")).toBe(true);
  });
});
