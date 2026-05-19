import { describe, it, expect } from "vitest";

import { RegexOperandCompiler } from "../../../src/assertions/regex-operand.js";

/**
 * Unit tests for RegexOperandCompiler — Part 2.
 *
 * Covers: empty pattern (literal // and bare ''), flag whitelist (every
 * whitelisted char accepted, every rejected char rejected, duplicates,
 * mixed valid+invalid, flag-order normalisation), compile-to-validate
 * (#tryCompile success + caught-SyntaxError paths), both-fault aggregation,
 * purity/determinism, no-matching-logic check.
 *
 * Constants, construction, happy paths, form detection are in
 * regex-operand.test.ts.
 *
 * The lone istanbul ignore is on the non-Error catch arm per the approved
 * safe-json.ts precedent; all other branches are exercised here.
 *
 * No implementation exists — tests must fail with module-not-found.
 */

function compile(lexeme: string) {
  return new RegexOperandCompiler().compile(lexeme);
}

// ---- 7. Empty pattern --------------------------------------------------
describe("compile() — empty pattern", () => {
  it("// → ok:true, source:'', rawFlags:''", () => {
    const r = compile("//");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.operand.source).toBe("");
      expect(r.operand.rawFlags).toBe("");
    }
  });

  it("// — compiled matches any string (empty pattern semantics)", () => {
    const r = compile("//");
    if (r.ok) expect(r.operand.compiled.test("anything")).toBe(true);
  });

  it("//i → ok:true, source:'', flags:['i']", () => {
    const r = compile("//i");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.operand.source).toBe("");
      expect(r.operand.flags).toEqual(["i"]);
    }
  });

  it("bare empty string '' → ok:true, source:''", () => {
    const r = compile("");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.operand.source).toBe("");
  });
});

// ---- 8. Flag whitelist — full branch ------------------------------------
describe("compile() — flag whitelist", () => {
  const whitelisted = ["i", "m", "s", "u"] as const;

  for (const flag of whitelisted) {
    it(`flag '${flag}' is accepted — ok:true, flags contains '${flag}'`, () => {
      const r = compile(`/x/${flag}`);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.operand.flags).toContain(flag);
    });
  }

  it("all four whitelisted flags combined /x/imsu → ok:true", () => {
    const r = compile("/x/imsu");
    expect(r.ok).toBe(true);
  });

  const rejected = ["g", "y", "d"];
  for (const flag of rejected) {
    it(`flag '${flag}' is rejected — ok:false, errors mention '${flag}'`, () => {
      expect(() => compile(`/x/${flag}`)).not.toThrow();
      const r = compile(`/x/${flag}`);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors.some((e) => e.includes(flag))).toBe(true);
    });
  }

  it("digit flag '2' is rejected", () => {
    const r = compile("/x/2");
    expect(r.ok).toBe(false);
  });

  it("duplicate /x/imim → ok:false, at least 2 errors", () => {
    const r = compile("/x/imim");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.length).toBeGreaterThanOrEqual(2);
  });

  it("mixed /x/igu → ok:false; 'g' flagged, 'i' and 'u' not flagged", () => {
    const r = compile("/x/igu");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.includes("g"))).toBe(true);
      expect(r.errors.some((e) => e.includes("i"))).toBe(false);
      expect(r.errors.some((e) => e.includes("u"))).toBe(false);
    }
  });

  it("flag-order normalisation /x/usmi → flags sorted ['i','m','s','u'], rawFlags verbatim", () => {
    const r = compile("/x/usmi");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.operand.flags).toEqual(["i", "m", "s", "u"]);
      expect(r.operand.rawFlags).toBe("usmi");
    }
  });
});

// ---- 9. Compile-to-validate (#tryCompile) --------------------------------
describe("compile() — compile-to-validate", () => {
  it("valid /abc/i → success arm, compiled is a RegExp", () => {
    const r = compile("/abc/i");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.operand.compiled).toBeInstanceOf(RegExp);
  });

  it("/( / literal → caught-SyntaxError arm, ok:false, error message mentions 'pattern'", () => {
    expect(() => compile("/(/ ")).not.toThrow();
    const r2 = compile("/(/");
    expect(r2.ok).toBe(false);
    if (!r2.ok) {
      expect(r2.errors.some((e) => e.toLowerCase().includes("pattern"))).toBe(true);
    }
  });

  it("lone quantifier /* → caught-SyntaxError arm, ok:false", () => {
    expect(() => compile("/*/")).not.toThrow();
    const r = compile("/*/");
    expect(r.ok).toBe(false);
  });

  it("/\\p{L}+/u (unicode property with u flag) → ok:true", () => {
    const r = compile("/\\p{L}+/u");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.operand.flags).toContain("u");
  });

  it("/\\p{L}+/ WITHOUT u flag → leniently valid in JS (Annex B) → ok:true", () => {
    // Without the `u` flag, `\p` is an IdentityEscape (literal 'p') per Annex B
    // web-compat, so this is a valid (non-Unicode-property) regex on ALL Node
    // versions (22 CI / 26 local). The compiler must accept it as ok:true.
    expect(() => compile("/\\p{L}+/")).not.toThrow();
    const r = compile("/\\p{L}+/");
    expect(r.ok).toBe(true);
  });
});

// ---- 10. Both-fault aggregation -----------------------------------------
describe("compile() — both-fault aggregation", () => {
  it("/(/g — bad flag 'g' AND uncompilable '(' → ok:false with at least 2 errors", () => {
    expect(() => compile("/(/g")).not.toThrow();
    const r = compile("/(/g");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.length).toBeGreaterThanOrEqual(2);
  });
});

// ---- 11. Purity / determinism ------------------------------------------
describe("compile() — purity and determinism", () => {
  it("same lexeme compiled twice yields equal source/rawFlags/flags/compiled", () => {
    const r1 = compile("/x/usmi");
    const r2 = compile("/x/usmi");
    if (r1.ok && r2.ok) {
      expect(r1.operand.source).toBe(r2.operand.source);
      expect(r1.operand.rawFlags).toBe(r2.operand.rawFlags);
      expect(r1.operand.flags).toEqual(r2.operand.flags);
      expect(r1.operand.compiled.source).toBe(r2.operand.compiled.source);
      expect(r1.operand.compiled.flags).toBe(r2.operand.compiled.flags);
    }
  });

  it("never throws for any input", () => {
    const inputs = ["", "/", "//", "/abc/i", "/x/g", "/(/", "bare_pattern"];
    for (const inp of inputs) {
      expect(() => compile(inp)).not.toThrow();
    }
  });
});

// ---- 12. No matching logic in this module --------------------------------
describe("RegexOperandCompiler — no matching logic", () => {
  it("has no .test() or .match() method, only .compile()", () => {
    const compiler = new RegexOperandCompiler();
    expect(typeof (compiler as Record<string, unknown>)["test"]).not.toBe("function");
    expect(typeof (compiler as Record<string, unknown>)["match"]).not.toBe("function");
    expect(typeof compiler.compile).toBe("function");
  });
});
