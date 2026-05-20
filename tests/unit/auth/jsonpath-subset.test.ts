import { describe, it, expect } from "vitest";

import {
  parseJsonPath,
  extractByJsonPath,
  MAX_JSONPATH_EXPRESSION_LENGTH,
} from "../../../src/auth/jsonpath-subset.js";
import type { ParsedJsonPath } from "../../../src/auth/jsonpath-subset.js";
import {
  isAuthStrategyError,
  AUTH_ERROR_CODES,
} from "../../../src/auth/errors.js";
import type { AuthStrategyError } from "../../../src/auth/errors.js";

/**
 * Unit tests for src/auth/jsonpath-subset.ts.
 *
 * Covers §9.1–§9.6 of auth-jsonpath-subset.md:
 * - Accepted shapes (AC#1): D4 canonical + edge variants.
 * - Rejected shapes (AC#2): every §4 rejection-table row (table-driven).
 * - extractByJsonPath walk integration (AC#3): hit/miss/null/depth.
 * - §8 edge-case resolutions: numeric-only key, length boundary.
 * - Determinism and purity (AC#4): no-throw fuzz on parser and extractor.
 * - SSOT reuse structural pins (AC#6).
 *
 * RED PHASE: src/auth/jsonpath-subset.ts and src/auth/errors.ts do not exist.
 * Every test fails with "Cannot find module" until the implementation-engineer
 * creates those files.
 *
 * Integration-test category skipped: the module is pure (no I/O, no HTTP, no
 * DB). The YAML test_strategy_hint states "Pure unit test only".
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Narrows a parse result to ParsedJsonPath, asserting it is not an error.
 */
function asPath(r: ParsedJsonPath | AuthStrategyError): ParsedJsonPath {
  expect(isAuthStrategyError(r)).toBe(false);
  return r as ParsedJsonPath;
}

/**
 * Asserts that parsing `expr` produces AUTH_CONFIG_INVALID / phase "config",
 * that the message contains `expr`, and optionally that it matches `reason`.
 * Returns the error for further assertions.
 */
function assertReject(expr: string, reason?: RegExp): AuthStrategyError {
  const r = parseJsonPath(expr);
  expect(isAuthStrategyError(r)).toBe(true);
  const e = r as AuthStrategyError;
  expect(e.code).toBe(AUTH_ERROR_CODES.AUTH_CONFIG_INVALID);
  expect(e.phase).toBe("config");
  expect(e.message).toContain(expr);
  if (reason !== undefined) {
    expect(e.message).toMatch(reason);
  }
  return e;
}

// ---------------------------------------------------------------------------
// MAX_JSONPATH_EXPRESSION_LENGTH
// ---------------------------------------------------------------------------

describe("MAX_JSONPATH_EXPRESSION_LENGTH", () => {
  it("is exported as the number 1024", () => {
    expect(MAX_JSONPATH_EXPRESSION_LENGTH).toBe(1024);
  });
});

// ---------------------------------------------------------------------------
// parseJsonPath — accepted shapes (AC#1 / §9.1)
// ---------------------------------------------------------------------------

describe("parseJsonPath — accepted shapes (AC#1)", () => {
  it("parses $.access_token → single key segment (D4 canonical #1)", () => {
    expect(asPath(parseJsonPath("$.access_token"))).toEqual([
      { kind: "key", key: "access_token" },
    ]);
  });

  it("parses $.data.token → two key segments (D4 canonical #2)", () => {
    expect(asPath(parseJsonPath("$.data.token"))).toEqual([
      { kind: "key", key: "data" },
      { kind: "key", key: "token" },
    ]);
  });

  it("parses $.tokens[0].value → key+index+key (D4 canonical #3)", () => {
    expect(asPath(parseJsonPath("$.tokens[0].value"))).toEqual([
      { kind: "key", key: "tokens" },
      { kind: "index", index: 0 },
      { kind: "key", key: "value" },
    ]);
  });

  it("parses $.a.b.c.d.e → five key segments (deep chain)", () => {
    const path = asPath(parseJsonPath("$.a.b.c.d.e"));
    expect(path).toHaveLength(5);
    expect(path[4]).toEqual({ kind: "key", key: "e" });
  });

  it("parses $.x[0][1][2] → key + three consecutive index segments", () => {
    const path = asPath(parseJsonPath("$.x[0][1][2]"));
    expect(path).toHaveLength(4);
    expect(path[0]).toEqual({ kind: "key", key: "x" });
    expect(path[3]).toEqual({ kind: "index", index: 2 });
  });

  it("parses $.foo[42] → key + index 42", () => {
    expect(asPath(parseJsonPath("$.foo[42]"))).toEqual([
      { kind: "key", key: "foo" },
      { kind: "index", index: 42 },
    ]);
  });

  it("parses $._private → underscore-prefixed key", () => {
    expect(asPath(parseJsonPath("$._private"))).toEqual([
      { kind: "key", key: "_private" },
    ]);
  });

  it("parses $.$weird → dollar-prefixed key", () => {
    expect(asPath(parseJsonPath("$.$weird"))).toEqual([
      { kind: "key", key: "$weird" },
    ]);
  });

  it("parses bare $ → empty segment array (§8(a))", () => {
    expect(asPath(parseJsonPath("$"))).toEqual([]);
  });

  it("parses $.0 → key segment with key '0', NOT an index (§8(d))", () => {
    expect(asPath(parseJsonPath("$.0"))).toEqual([
      { kind: "key", key: "0" },
    ]);
  });
});

// ---------------------------------------------------------------------------
// parseJsonPath — rejected shapes (AC#2 / §9.2), table-driven
// ---------------------------------------------------------------------------

describe("parseJsonPath — rejected: filter expressions", () => {
  it("rejects $.data[?(@.foo)] citing 'filter expressions'; rejects $.foo[?(...)]", () => {
    assertReject("$.data[?(@.foo)]", /filter expressions/i);
    assertReject("$.foo[?(...)]");
  });
});

describe("parseJsonPath — rejected: recursive descent", () => {
  it("rejects $..token citing 'recursive descent'; rejects $..foo.bar and $..", () => {
    assertReject("$..token", /recursive descent/i);
    assertReject("$..foo.bar");
    assertReject("$..");
  });
});

describe("parseJsonPath — rejected: wildcards", () => {
  it("rejects $.data.* citing 'wildcard'; rejects $.tokens[*]", () => {
    assertReject("$.data.*", /wildcard/i);
    assertReject("$.tokens[*]");
  });
});

describe("parseJsonPath — rejected: slice notation", () => {
  it("rejects $.tokens[0:2] citing 'slice notation'; rejects [1:] and [:2]", () => {
    assertReject("$.tokens[0:2]", /slice notation/i);
    assertReject("$.tokens[1:]");
    assertReject("$.tokens[:2]");
  });
});

describe("parseJsonPath — rejected: missing $ prefix", () => {
  it("rejects 'token' citing 'begin with'; rejects '.token' and 'foo.bar'", () => {
    assertReject("token", /begin with/i);
    assertReject(".token");
    assertReject("foo.bar");
  });
});

describe("parseJsonPath — rejected: empty and whitespace inputs", () => {
  it("rejects '' with AUTH_CONFIG_INVALID and 'empty' in message", () => {
    // Empty string cannot appear literally in the message; check reason text only.
    const r = parseJsonPath("");
    const e = r as AuthStrategyError;
    expect(isAuthStrategyError(r)).toBe(true);
    expect(e.code).toBe(AUTH_ERROR_CODES.AUTH_CONFIG_INVALID);
    expect(e.phase).toBe("config");
    expect(e.message).toMatch(/empty/i);
  });
  it("rejects '   ' with AUTH_CONFIG_INVALID and 'whitespace' in message", () => {
    const r = parseJsonPath("   ");
    const e = r as AuthStrategyError;
    expect(isAuthStrategyError(r)).toBe(true);
    expect(e.code).toBe(AUTH_ERROR_CODES.AUTH_CONFIG_INVALID);
    expect(e.message).toMatch(/whitespace/i);
  });
  it("rejects tab-only and newline-only inputs with AUTH_CONFIG_INVALID", () => {
    expect(isAuthStrategyError(parseJsonPath("\t"))).toBe(true);
    expect(isAuthStrategyError(parseJsonPath("\n"))).toBe(true);
  });
});

describe("parseJsonPath — rejected: internal whitespace", () => {
  it("rejects '$. foo' citing 'whitespace'; rejects '$.foo .bar' and '$.foo[ 0]'", () => {
    assertReject("$. foo", /whitespace/i);
    assertReject("$.foo .bar");
    assertReject("$.foo[ 0]");
  });
});

describe("parseJsonPath — rejected: trailing dot", () => {
  it("rejects '$.foo.' citing 'trailing dot'", () => {
    assertReject("$.foo.", /trailing dot/i);
  });
});

describe("parseJsonPath — rejected: bracketed string keys", () => {
  it('rejects $["foo"] citing "bracketed string key"; rejects $[\'bar\'] and $.x["y"]', () => {
    assertReject('$["foo"]', /bracketed string key/i);
    assertReject("$['bar']");
    assertReject('$.x["y"]');
  });
});

describe("parseJsonPath — rejected: negative index", () => {
  it("rejects $.tokens[-1] citing 'negative index'", () => {
    assertReject("$.tokens[-1]", /negative index/i);
  });
});

describe("parseJsonPath — rejected: non-integer index", () => {
  it("rejects $.tokens[a] citing 'non-negative integer'", () => {
    assertReject("$.tokens[a]", /non-negative integer/i);
  });
  it("rejects $.tokens[1.5] and $.tokens[] with AUTH_CONFIG_INVALID", () => {
    assertReject("$.tokens[1.5]");
    assertReject("$.tokens[]");
  });
});

describe("parseJsonPath — rejected: expression length overflow (§8(e))", () => {
  it("rejects a 1025-char expression citing the length cap 1024", () => {
    const expr = "$.aa" + ".a".repeat(510) + "a"; // 4 + 1020 + 1 = 1025
    expect(expr).toHaveLength(1025);
    const e = assertReject(expr);
    expect(e.message).toMatch(/1024/);
  });

  it("accepts an expression of exactly 1024 chars when grammar matches", () => {
    const expr = "$.aa" + ".a".repeat(510); // 4 + 1020 = 1024
    expect(expr).toHaveLength(1024);
    expect(isAuthStrategyError(parseJsonPath(expr))).toBe(false);
    expect((parseJsonPath(expr) as ParsedJsonPath)).toHaveLength(511);
  });
});

describe("parseJsonPath — rejection message format (AC#2)", () => {
  it("does not include a bearer-token blob when rejecting 'Bearer xyz' as non-$ expr", () => {
    const expr = "Bearer xyz";
    const e = assertReject(expr);
    // The config expression is echoed; a full token blob (32+ chars) must not appear.
    expect(e.message).not.toMatch(/Bearer\s+[A-Za-z0-9+/=]{32,}/);
  });
});

// ---------------------------------------------------------------------------
// extractByJsonPath — walk integration (AC#3 / §9.3)
// ---------------------------------------------------------------------------

describe("extractByJsonPath — hit cases", () => {
  it("returns found:true value:'abc' for $.data.token on a matching object", () => {
    const path = asPath(parseJsonPath("$.data.token"));
    expect(extractByJsonPath({ data: { token: "abc" } }, path)).toEqual({
      found: true,
      value: "abc",
    });
  });

  it("returns found:true value:null for explicit JSON null at the leaf (AC#3)", () => {
    const path = asPath(parseJsonPath("$.token"));
    expect(extractByJsonPath({ token: null }, path)).toEqual({
      found: true,
      value: null,
    });
  });

  it("returns found:false when descending through a null intermediate (AC#3)", () => {
    expect(
      extractByJsonPath({ a: null }, asPath(parseJsonPath("$.a.b"))),
    ).toEqual({ found: false });
  });
});

describe("extractByJsonPath — miss cases", () => {
  it("returns found:false for a missing key", () => {
    expect(
      extractByJsonPath({ data: {} }, asPath(parseJsonPath("$.data.token"))),
    ).toEqual({ found: false });
  });

  it("returns found:false for an out-of-bounds index", () => {
    expect(
      extractByJsonPath({ tokens: [] }, asPath(parseJsonPath("$.tokens[0]"))),
    ).toEqual({ found: false });
  });

  it("returns found:false for wrong-type descent (key into string)", () => {
    expect(
      extractByJsonPath({ data: "oops" }, asPath(parseJsonPath("$.data.token"))),
    ).toEqual({ found: false });
  });

  it("returns found:false for key descent into an array (path-walk line 58)", () => {
    expect(
      extractByJsonPath(
        { items: [1, 2, 3] },
        asPath(parseJsonPath("$.items.length")),
      ),
    ).toEqual({ found: false });
  });
});

describe("extractByJsonPath — bare $ root (§8(a))", () => {
  it("returns found:true with the root object for bare $", () => {
    const path = asPath(parseJsonPath("$"));
    const obj = { x: 1 };
    expect(extractByJsonPath(obj, path)).toEqual({ found: true, value: obj });
  });

  it("returns found:true value:null for null root with bare $", () => {
    expect(extractByJsonPath(null, asPath(parseJsonPath("$")))).toEqual({
      found: true,
      value: null,
    });
  });

  it("returns found:false for undefined root with bare $ (absent-root rule)", () => {
    expect(extractByJsonPath(undefined, asPath(parseJsonPath("$")))).toEqual({
      found: false,
    });
  });
});

describe("extractByJsonPath — depth-bound cases (AC#3 no-stackoverflow)", () => {
  it("resolves a 200-segment path on a matching 200-level nested object", () => {
    const depth = 200;
    let root: unknown = "leaf";
    const segs: string[] = [];
    for (let i = 0; i < depth; i++) { root = { k: root }; segs.unshift("k"); }
    const path = asPath(parseJsonPath("$." + segs.join(".")));
    expect(extractByJsonPath(root, path)).toEqual({ found: true, value: "leaf" });
  });

  it("returns found:false for a 300-segment path (over MAX_PATH_WALK_DEPTH=256)", () => {
    const depth = 300;
    let root: unknown = "deep";
    const segs: string[] = [];
    for (let i = 0; i < depth; i++) { root = { a: root }; segs.unshift("a"); }
    const expr = "$." + segs.join(".");
    expect(expr.length <= MAX_JSONPATH_EXPRESSION_LENGTH).toBe(true);
    const path = asPath(parseJsonPath(expr));
    expect(path).toHaveLength(depth);
    expect(() => extractByJsonPath(root, path)).not.toThrow();
    expect(extractByJsonPath(root, path)).toEqual({ found: false });
  });
});

// ---------------------------------------------------------------------------
// Edge cases — §8 resolutions pinned (§9.4)
// ---------------------------------------------------------------------------

describe("edge cases — §8 resolutions pinned", () => {
  it("$.0 extracts from {'0':'x'} as found:true (numeric string key)", () => {
    expect(
      extractByJsonPath({ "0": "x" }, asPath(parseJsonPath("$.0"))),
    ).toEqual({ found: true, value: "x" });
  });

  it("$.0 returns found:false on an array (key-on-array, path-walk line 58)", () => {
    expect(
      extractByJsonPath(["a", "b", "c"], asPath(parseJsonPath("$.0"))),
    ).toEqual({ found: false });
  });

  it("$.tokens[0] extracts array element 0 as found:true", () => {
    expect(
      extractByJsonPath(
        { tokens: ["a", "b", "c"] },
        asPath(parseJsonPath("$.tokens[0]")),
      ),
    ).toEqual({ found: true, value: "a" });
  });

  it("not-found result has no 'value' property (shape contract)", () => {
    const result = extractByJsonPath({}, asPath(parseJsonPath("$.missing")));
    expect(result.found).toBe(false);
    expect("value" in result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Determinism and purity (AC#4 / §9.5)
// ---------------------------------------------------------------------------

describe("parseJsonPath — determinism (AC#4)", () => {
  it("returns JSON.stringify-identical results for the same accepted expr on two calls", () => {
    expect(JSON.stringify(parseJsonPath("$.data.token"))).toBe(
      JSON.stringify(parseJsonPath("$.data.token")),
    );
  });

  it("returns equal code/phase/message for the same rejected expr on two calls", () => {
    const r1 = parseJsonPath("$..token") as AuthStrategyError;
    const r2 = parseJsonPath("$..token") as AuthStrategyError;
    expect(r1.message).toBe(r2.message);
    expect(r1.code).toBe(r2.code);
  });

  it("does not throw on 1000 deterministic-random strings ≤1024 chars (pure fuzz)", () => {
    const chars =
      "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789" +
      "$.[]?:*._-@(){}|\\/'\"!#%^&+=<>,;~`";
    let seed = 0xdeadbeef;
    function rand(): number {
      seed ^= seed << 13; seed ^= seed >> 17; seed ^= seed << 5;
      return seed >>> 0;
    }
    for (let i = 0; i < 1000; i++) {
      const len = (rand() % 1024) + 1;
      let s = "";
      for (let j = 0; j < len; j++) s += chars[rand() % chars.length];
      expect(() => parseJsonPath(s)).not.toThrow();
    }
  });
});

describe("extractByJsonPath — determinism and purity (AC#4)", () => {
  it("returns JSON.stringify-identical results for the same root+path on two calls", () => {
    const root = { data: { token: "xyz" } };
    const path = asPath(parseJsonPath("$.data.token"));
    expect(JSON.stringify(extractByJsonPath(root, path))).toBe(
      JSON.stringify(extractByJsonPath(root, path)),
    );
  });

  it("does not throw on 100 deterministic-random (root, path) pairs (fuzz)", () => {
    const roots: unknown[] = [
      null, undefined, {}, [], { a: 1 }, [1, 2], "str", 42, true, false,
    ];
    const paths = ["$", "$.a", "$.a.b", "$.a[0]", "$.missing"].map((e) =>
      asPath(parseJsonPath(e)),
    );
    let seed = 0xcafebabe;
    function rand(): number {
      seed ^= seed << 13; seed ^= seed >> 17; seed ^= seed << 5;
      return seed >>> 0;
    }
    for (let i = 0; i < 100; i++) {
      expect(() =>
        extractByJsonPath(
          roots[rand() % roots.length],
          paths[rand() % paths.length],
        ),
      ).not.toThrow();
    }
  });
});

// ---------------------------------------------------------------------------
// SSOT reuse structural pins (AC#6 / §9.6)
// ---------------------------------------------------------------------------

describe("SSOT reuse — AC#6 structural pins", () => {
  it("ParsedJsonPath round-trips through extractByJsonPath (WalkSegment[] compatibility)", () => {
    const path: ParsedJsonPath = asPath(parseJsonPath("$.access_token"));
    expect(extractByJsonPath({ access_token: "tok123" }, path)).toEqual({
      found: true,
      value: "tok123",
    });
  });

  it("every parser rejection carries AUTH_CONFIG_INVALID and phase 'config'", () => {
    const rejected = [
      "$..token", "$.data.*", "$.t[0:2]", "token", "$.foo.", "$.t[-1]",
    ];
    for (const expr of rejected) {
      const r = parseJsonPath(expr);
      expect(isAuthStrategyError(r)).toBe(true);
      if (isAuthStrategyError(r)) {
        expect(r.code).toBe(AUTH_ERROR_CODES.AUTH_CONFIG_INVALID);
        expect(r.phase).toBe("config");
      }
    }
  });

  it("isAuthStrategyError returns false for accepted and true for rejected", () => {
    expect(isAuthStrategyError(parseJsonPath("$.foo"))).toBe(false);
    expect(isAuthStrategyError(parseJsonPath("$..token"))).toBe(true);
  });
});
