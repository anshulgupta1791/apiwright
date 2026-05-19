import { describe, it, expect } from "vitest";

import {
  RegexOperandCompiler,
  MAX_REGEX_TARGET_LENGTH,
} from "../../../src/assertions/regex-operand.js";

/**
 * Unit tests for RegexOperandCompiler — Part 1.
 *
 * Covers: MAX_REGEX_TARGET_LENGTH constant, construction, happy path literal
 * /abc/i, happy path bare 'abc', structured aggregated failure (never throws),
 * form detection (literal vs bare — 7 cases including escaped delimiter and
 * char-class interior slash).
 *
 * Empty pattern, flag whitelist, compile-to-validate, both-fault aggregation,
 * determinism, and no-matching-logic check are in regex-operand-2.test.ts.
 *
 * No implementation exists — tests must fail with module-not-found.
 */

function compile(lexeme: string) {
  return new RegexOperandCompiler().compile(lexeme);
}

// ---- 1. MAX_REGEX_TARGET_LENGTH constant --------------------------------
describe("MAX_REGEX_TARGET_LENGTH constant", () => {
  it("equals 65536", () => {
    expect(MAX_REGEX_TARGET_LENGTH).toBe(65536);
  });

  it("is a number", () => {
    expect(typeof MAX_REGEX_TARGET_LENGTH).toBe("number");
  });
});

// ---- 2. Construction ----------------------------------------------------
describe("RegexOperandCompiler — construction", () => {
  it("constructs with no arguments without throwing", () => {
    expect(() => new RegexOperandCompiler()).not.toThrow();
  });
});

// ---- 3. Happy path — literal form /abc/i --------------------------------
describe("compile() — happy path literal /abc/i", () => {
  it("returns ok:true, source:'abc', rawFlags:'i', flags:['i'], compiled RegExp", () => {
    const r = compile("/abc/i");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.operand.source).toBe("abc");
      expect(r.operand.rawFlags).toBe("i");
      expect(r.operand.flags).toEqual(["i"]);
      expect(r.operand.compiled).toBeInstanceOf(RegExp);
      expect(r.operand.compiled.source).toBe("abc");
    }
  });

  it("kind discriminant is 'regex'", () => {
    const r = compile("/abc/i");
    if (r.ok) expect(r.operand.kind).toBe("regex");
  });

  it("compiled is case-insensitive — matches uppercase, misses unrelated", () => {
    const r = compile("/abc/i");
    if (r.ok) {
      expect(r.operand.compiled.test("xABCy")).toBe(true);
      expect(r.operand.compiled.test("xyz")).toBe(false);
    }
  });
});

// ---- 4. Happy path — bare form ------------------------------------------
describe("compile() — happy path bare pattern 'abc'", () => {
  it("returns ok:true, source:'abc', rawFlags:'', flags:[], case-sensitive compiled", () => {
    const r = compile("abc");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.operand.source).toBe("abc");
      expect(r.operand.rawFlags).toBe("");
      expect(r.operand.flags).toEqual([]);
      expect(r.operand.compiled.test("ABC")).toBe(false);
      expect(r.operand.compiled.test("abc")).toBe(true);
    }
  });
});

// ---- 5. Structured aggregated failure, never throws --------------------
describe("compile() — aggregated failure, never throws", () => {
  it("non-whitelisted flag /x/g → ok:false, errors mention 'g'", () => {
    expect(() => compile("/x/g")).not.toThrow();
    const r = compile("/x/g");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.includes("g"))).toBe(true);
  });

  it("duplicate flag /x/ii → ok:false, errors mention 'i'", () => {
    expect(() => compile("/x/ii")).not.toThrow();
    const r = compile("/x/ii");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.includes("i"))).toBe(true);
  });

  it("uncompilable /( / → ok:false, at least 1 error", () => {
    expect(() => compile("/(/ ")).not.toThrow();
    const r = compile("/(/");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.length).toBeGreaterThanOrEqual(1);
  });

  it("/x/gg — bad flag AND duplicate → ok:false with at least 2 errors", () => {
    expect(() => compile("/x/gg")).not.toThrow();
    const r = compile("/x/gg");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.length).toBeGreaterThanOrEqual(2);
  });
});

// ---- 6. Form detection — full branch ------------------------------------
describe("compile() — form detection", () => {
  it("/hello/ → literal form, source:'hello'", () => {
    const r = compile("/hello/");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.operand.source).toBe("hello");
  });

  it("'abc' → bare form, source:'abc', rawFlags:''", () => {
    const r = compile("abc");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.operand.source).toBe("abc");
      expect(r.operand.rawFlags).toBe("");
    }
  });

  it("single '/' — starts with / but no closing delimiter → bare form, source:'/'", () => {
    const r = compile("/");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.operand.source).toBe("/");
      expect(r.operand.rawFlags).toBe("");
    }
  });

  it("'/abc' — starts with / but no closing delimiter → bare form, source:'/abc'", () => {
    const r = compile("/abc");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.operand.source).toBe("/abc");
      expect(r.operand.rawFlags).toBe("");
    }
  });

  it("/a\\/b/ — escaped delimiter preserved; source:'a\\/b'", () => {
    const r = compile("/a\\/b/");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.operand.source).toBe("a\\/b");
      expect(r.operand.rawFlags).toBe("");
    }
  });

  it("/[a/b]+/ — / inside char class is not a delimiter; source:'[a/b]+'", () => {
    const r = compile("/[a/b]+/");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.operand.source).toBe("[a/b]+");
  });

  it("'a/b' — bare pattern containing /; source:'a/b'", () => {
    const r = compile("a/b");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.operand.source).toBe("a/b");
      expect(r.operand.rawFlags).toBe("");
    }
  });
});
