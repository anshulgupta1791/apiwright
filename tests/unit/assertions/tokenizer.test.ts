import { describe, it, expect } from "vitest";

import {
  AssertionTokenizer,
  MAX_INPUT_LENGTH,
  MAX_TOKEN_COUNT,
} from "../../../src/assertions/tokenizer.js";
import type { TokenizeResult } from "../../../src/assertions/tokenizer.js";

/**
 * Unit tests for AssertionTokenizer — Part 1.
 *
 * Covers: constants, default-seam wiring, happy path (complex arithmetic
 * assertion), every literal kind (string escapes, number, boolean, null, regex),
 * dotted/index targets, LexError codes (empty / unterminated / dangling /
 * stray / over-limit), error aggregation.
 *
 * Disambiguation matrix, determinism, no-coercion, whitespace insensitivity,
 * and token structure tests are in tokenizer-2.test.ts (split for ≤300-line cap).
 *
 * No implementation exists — all tests must fail with module-not-found.
 */

function tok(input: string): TokenizeResult {
  return new AssertionTokenizer().tokenize(input);
}

// ---- 1. Bounds constants exported ----------------------------------------
describe("MAX_INPUT_LENGTH / MAX_TOKEN_COUNT constants", () => {
  it("MAX_INPUT_LENGTH equals 8192", () => {
    expect(MAX_INPUT_LENGTH).toBe(8192);
  });

  it("MAX_TOKEN_COUNT equals 1024", () => {
    expect(MAX_TOKEN_COUNT).toBe(1024);
  });
});

// ---- 2. Default-seam wiring -----------------------------------------------
describe("AssertionTokenizer — default-seam wiring", () => {
  it("constructs with no arguments without throwing", () => {
    expect(() => new AssertionTokenizer()).not.toThrow();
  });

  it("enforces MAX_INPUT_LENGTH when no options are passed", () => {
    const overLong = "a".repeat(MAX_INPUT_LENGTH + 1);
    const result = new AssertionTokenizer().tokenize(overLong);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.code === "INPUT_TOO_LONG")).toBe(true);
    }
  });

  it("enforces MAX_TOKEN_COUNT when no options are passed", () => {
    const manyParens = "(".repeat(MAX_INPUT_LENGTH);
    const result = new AssertionTokenizer().tokenize(manyParens);
    expect(result.ok).toBe(false);
  });
});

// ---- 3. Happy path — complex arithmetic assertion ------------------------
describe("tokenize() — happy path (complex arithmetic assertion)", () => {
  const input = "response.body.total equals (request.body.subtotal * 1.08)";

  it("returns ok:true", () => {
    expect(tok(input).ok).toBe(true);
  });

  it("emits 8 tokens including terminal eof", () => {
    expect(tok(input).tokens).toHaveLength(8);
  });

  it("first token is target 'response.body.total'", () => {
    const t = tok(input).tokens[0];
    expect(t.kind).toBe("target");
    expect(t.raw).toBe("response.body.total");
  });

  it("second token is identifier 'equals'; fifth is arith_op '*'; last is eof", () => {
    const tokens = tok(input).tokens;
    expect(tokens[1].kind).toBe("identifier");
    expect(tokens[4].kind).toBe("arith_op");
    expect(tokens[tokens.length - 1].kind).toBe("eof");
  });

  it("sixth token is number 1.08", () => {
    const t = tok(input).tokens[5];
    expect(t.kind).toBe("number");
    if (t.kind === "number") expect(t.value).toBe(1.08);
  });
});

// ---- 4. String literals -------------------------------------------------
describe("tokenize() — string literals", () => {
  it("double-quoted string emits string token with decoded value 'hello'", () => {
    const str = tok('a equals "hello"').tokens.find((t) => t.kind === "string");
    expect(str).toBeDefined();
    if (str?.kind === "string") expect(str.value).toBe("hello");
  });

  it("decodes \\uXXXX to character (\\u0041 → 'A')", () => {
    const str = tok('a equals "\\u0041"').tokens.find((t) => t.kind === "string");
    if (str?.kind === "string") expect(str.value).toBe("A");
  });

  it("single-quoted string has quote: \"'\"", () => {
    const str = tok("a equals 'world'").tokens.find((t) => t.kind === "string");
    if (str?.kind === "string") expect(str.quote).toBe("'");
  });
});

describe("tokenize() — numeric literals", () => {
  it("integer 42 → number token value 42", () => {
    const n = tok("a equals 42").tokens.find((t) => t.kind === "number");
    if (n?.kind === "number") expect(n.value).toBe(42);
  });

  it("negative literal -5 → number token value -5 (no arith_op emitted)", () => {
    const r = tok("a equals -5");
    const n = r.tokens.find((t) => t.kind === "number");
    if (n?.kind === "number") expect(n.value).toBe(-5);
    expect(r.tokens.find(
      (t) => t.kind === "arith_op" && (t as { op?: string }).op === "-"
    )).toBeUndefined();
  });
});

describe("tokenize() — boolean and null keywords", () => {
  it("emits boolean token for 'true'", () => {
    const r = tok("a equals true");
    const b = r.tokens.find((t) => t.kind === "boolean");
    if (b?.kind === "boolean") expect(b.value).toBe(true);
  });

  it("emits boolean token for 'false'", () => {
    const r = tok("a equals false");
    const b = r.tokens.find((t) => t.kind === "boolean");
    if (b?.kind === "boolean") expect(b.value).toBe(false);
  });

  it("emits null token for 'null'", () => {
    expect(tok("a equals null").tokens.find((t) => t.kind === "null")).toBeDefined();
  });

  it("does not treat 'True' as boolean — case-sensitive", () => {
    expect(tok("a equals True").tokens.find((t) => t.kind === "boolean")).toBeUndefined();
  });
});

describe("tokenize() — regex literals", () => {
  it("/abc/i → regex token with source 'abc', flags 'i'", () => {
    const rx = tok("a matches /abc/i").tokens.find((t) => t.kind === "regex");
    expect(rx).toBeDefined();
    if (rx?.kind === "regex") { expect(rx.source).toBe("abc"); expect(rx.flags).toBe("i"); }
  });

  it("/a\\/b/ — escaped delimiter → source 'a\\/b' (escape preserved)", () => {
    const rx = tok("a matches /a\\/b/i").tokens.find((t) => t.kind === "regex");
    if (rx?.kind === "regex") expect(rx.source).toBe("a\\/b");
  });

  it("/[a/b]+/ — / inside char class is NOT a delimiter; source '[a/b]+'", () => {
    const rx = tok("a matches /[a/b]+/").tokens.find((t) => t.kind === "regex");
    if (rx?.kind === "regex") expect(rx.source).toBe("[a/b]+");
  });
});

// ---- 5. Dotted / index targets ------------------------------------------
describe("tokenize() — dotted path target", () => {
  it("response.body.items.0.id emits ONE target token, raw verbatim", () => {
    const r = tok("response.body.items.0.id exists");
    expect(r.tokens[0].kind).toBe("target");
    expect(r.tokens[0].raw).toBe("response.body.items.0.id");
  });

  it("db.primary_postgres.user_check.count emits ONE target token", () => {
    const r = tok("db.primary_postgres.user_check.count equals 0");
    expect(r.tokens[0].raw).toBe("db.primary_postgres.user_check.count");
  });
});

// ---- B10: target tokens with bracket-notation segments ------------------
//
// The lexer extends the target token to include chained bracket segments
// (`["X-Request-ID"]`, `[0]`, etc.) so the parser can address path
// components that bare-identifier syntax cannot reach — most commonly
// hyphenated HTTP header names.
describe("tokenize() — B10 bracket-notation target segments", () => {
  it('response.headers["X-Request-ID"] emits ONE target token covering the brackets', () => {
    const r = tok('response.headers["X-Request-ID"] exists');
    expect(r.tokens[0].kind).toBe("target");
    expect(r.tokens[0].raw).toBe('response.headers["X-Request-ID"]');
  });

  it("single-quoted bracket content is captured: response.headers['X-Y']", () => {
    const r = tok("response.headers['X-Y'] exists");
    expect(r.tokens[0].kind).toBe("target");
    expect(r.tokens[0].raw).toBe("response.headers['X-Y']");
  });

  it("trailing dot path after bracket: response.body['users'].length", () => {
    const r = tok("response.body['users'].length exists");
    expect(r.tokens[0].kind).toBe("target");
    expect(r.tokens[0].raw).toBe("response.body['users'].length");
  });

  it('adjacent brackets: response.body["a"]["b"]', () => {
    const r = tok('response.body["a"]["b"] exists');
    expect(r.tokens[0].kind).toBe("target");
    expect(r.tokens[0].raw).toBe('response.body["a"]["b"]');
  });

  it("numeric index in brackets: response.body[0]", () => {
    const r = tok("response.body[0] exists");
    expect(r.tokens[0].kind).toBe("target");
    expect(r.tokens[0].raw).toBe("response.body[0]");
  });

  it("does NOT consume brackets on a non-target identifier (RHS)", () => {
    // `equals foo[0]` — `foo` is an identifier (not target), so the
    // bracket extension does NOT apply. The `[` becomes a separate
    // punct and is NOT folded into `foo`.
    const r = tok("response.body equals foo[0]");
    const fooTok = r.tokens.find((t) => t.raw === "foo");
    expect(fooTok).toBeDefined();
    expect(fooTok?.kind).toBe("identifier");
  });

  it('bracket survives whitespace: response.body[ "a" ]', () => {
    const r = tok('response.body[ "a" ] exists');
    expect(r.tokens[0].kind).toBe("target");
    expect(r.tokens[0].raw).toBe('response.body[ "a" ]');
  });

  it("does NOT change how arithmetic is interpreted on the RHS", () => {
    // The bracket extension is target-only. RHS `5-3` still tokenises
    // as 5, -, 3 (arithmetic subtraction).
    const r = tok("response.body equals 5-3");
    const equalsIdx = r.tokens.findIndex((t) => t.raw === "equals");
    expect(equalsIdx).toBeGreaterThan(-1);
    const after = r.tokens.slice(equalsIdx + 1);
    expect(after.length).toBeGreaterThanOrEqual(3);
    expect(after[0]?.raw).toBe("5");
  });

  it("backslash-escape inside quoted bracket content is preserved", () => {
    // `\"` inside `"..."` should not terminate the quoted segment.
    // The bracket scanner skips `\` + next char as a pair.
    const r = tok('response.body["a\\"b"] exists');
    expect(r.tokens[0].kind).toBe("target");
    expect(r.tokens[0].raw).toBe('response.body["a\\"b"]');
  });

  it("backslash-backslash escape inside quoted bracket content is preserved", () => {
    const r = tok('response.body["a\\\\b"] exists');
    expect(r.tokens[0].kind).toBe("target");
    expect(r.tokens[0].raw).toBe('response.body["a\\\\b"]');
  });

  it("malformed bracket (no closing ']') does NOT swallow the rest of input", () => {
    // `response.body[` without a closing `]` is malformed. The bracket
    // extension stops at the `[` so the target token is just
    // `response.body`; the `[` then becomes a separate token (stray /
    // punct) and the downstream parser surfaces a clear error.
    const r = tok("response.body[unclosed exists");
    expect(r.tokens[0].kind).toBe("target");
    expect(r.tokens[0].raw).toBe("response.body");
  });

  it("malformed bracket with unquoted content + no ']' also stops at '['", () => {
    const r = tok("response.body[abc");
    expect(r.tokens[0].kind).toBe("target");
    // The target stops before `[` since the unquoted scan never finds `]`.
    expect(r.tokens[0].raw).toBe("response.body");
  });
});

// ---- 6. LexErrorCode errors — every code --------------------------------
describe("tokenize() — EMPTY_INPUT", () => {
  it("empty string → ok:false with EMPTY_INPUT, never throws", () => {
    expect(() => tok("")).not.toThrow();
    const r = tok("");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.code === "EMPTY_INPUT")).toBe(true);
  });

  it("whitespace-only → ok:false with EMPTY_INPUT", () => {
    const r = tok("   ");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.code === "EMPTY_INPUT")).toBe(true);
  });
});

describe("tokenize() — UNTERMINATED_STRING", () => {
  it('unterminated double-quote → ok:false with UNTERMINATED_STRING', () => {
    expect(() => tok('a equals "hello')).not.toThrow();
    const r = tok('a equals "hello');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.code === "UNTERMINATED_STRING")).toBe(true);
  });

  it("UNTERMINATED_STRING has a non-negative offset", () => {
    const r = tok('a equals "hello');
    if (!r.ok) {
      const err = r.errors.find((e) => e.code === "UNTERMINATED_STRING");
      expect(err?.offset).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("tokenize() — UNTERMINATED_REGEX", () => {
  it("unterminated regex → ok:false with UNTERMINATED_REGEX, never throws", () => {
    expect(() => tok("a matches /abc")).not.toThrow();
    const r = tok("a matches /abc");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.code === "UNTERMINATED_REGEX")).toBe(true);
  });
});

describe("tokenize() — DANGLING_ESCAPE", () => {
  it("backslash at end of string → ok:false with DANGLING_ESCAPE, never throws", () => {
    expect(() => tok("a equals \"x\\")).not.toThrow();
    const r = tok("a equals \"x\\");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.code === "DANGLING_ESCAPE")).toBe(true);
  });
});

describe("tokenize() — STRAY_CHARACTER", () => {
  it("@ is a stray character → ok:false with STRAY_CHARACTER length 1, never throws", () => {
    expect(() => tok("a @ b")).not.toThrow();
    const r = tok("a @ b");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const stray = r.errors.find((e) => e.code === "STRAY_CHARACTER");
      expect(stray).toBeDefined();
      expect(stray?.length).toBe(1);
    }
  });

  it("non-ASCII letter is STRAY_CHARACTER", () => {
    const r = tok("naïve equals 1");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.code === "STRAY_CHARACTER")).toBe(true);
  });
});

describe("tokenize() — over-limit (INPUT_TOO_LONG / TOO_MANY_TOKENS)", () => {
  it("input longer than injected maxInputLength → INPUT_TOO_LONG, never throws", () => {
    const t = new AssertionTokenizer({ maxInputLength: 5 });
    expect(() => t.tokenize("123456")).not.toThrow();
    const r = t.tokenize("123456");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.code === "INPUT_TOO_LONG")).toBe(true);
  });

  it("INPUT_TOO_LONG result has tokens:[eof] — no scan performed", () => {
    const t = new AssertionTokenizer({ maxInputLength: 5 });
    const r = t.tokenize("123456");
    if (!r.ok) {
      expect(r.tokens).toHaveLength(1);
      expect(r.tokens[0].kind).toBe("eof");
    }
  });

  it("exceeding injected maxTokenCount → TOO_MANY_TOKENS, ok:false, never throws", () => {
    const t = new AssertionTokenizer({ maxTokenCount: 3 });
    expect(() => t.tokenize("a.b equals 42")).not.toThrow();
    const r = t.tokenize("a.b equals 42");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.code === "TOO_MANY_TOKENS")).toBe(true);
  });
});

// ---- 7. Aggregation — multiple errors in one pass -----------------------
describe("tokenize() — error aggregation", () => {
  it("multiple stray chars aggregate all errors — does not stop at first", () => {
    const r = tok("@ a equals # b");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const strays = r.errors.filter((e) => e.code === "STRAY_CHARACTER");
      expect(strays.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("stray char AND unterminated string both in one result", () => {
    const r = tok('@ a equals "unterminated');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.code === "STRAY_CHARACTER")).toBe(true);
      expect(r.errors.some((e) => e.code === "UNTERMINATED_STRING")).toBe(true);
    }
  });
});
