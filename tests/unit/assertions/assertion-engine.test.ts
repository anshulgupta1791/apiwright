/**
 * Unit tests for AssertionEngine — Part 1 of 2.
 *
 * Covers: default-seam constructor (real parser+evaluator, NOT istanbul-ignored);
 * parseAll aggregation (empty, all-valid, all-invalid, mixed batch);
 * evaluateAll ordering/purity/determinism/never-throws.
 *
 * Part 2 (`assertion-engine-2.test.ts`): parseAndEvaluate, seam isolation,
 * untouched-tree static text-scan (DEFERRED constraint proof).
 *
 * Named exports only. ESM `.js` specifiers. No raw JSON.parse.
 */

import { describe, it, expect, beforeEach } from "vitest";

import { AssertionEngine } from "../../../src/assertions/index.js";
import type {
  AssertionAst,
  EvaluationContext,
  BatchParseResult,
} from "../../../src/assertions/index.js";

// ---- Shared helpers -------------------------------------------------------

/** A minimal valid EvaluationContext with fixed `now` for determinism. */
const BASE_CTX: EvaluationContext = {
  request: {
    headers: { authorization: "Bearer test" },
    body: { value: 42, name: "hello" },
    url: { full: "http://localhost/", path: "/", query: {} },
  },
  response: {
    status: 200,
    time_ms: 10,
    headers: {},
    body: { value: 42 },
  },
  db: {},
  now: 1_716_000_000_000,
};

/** Always parses and evaluates PASS with BASE_CTX (status 200 equals 200). */
const VALID_A = "response.status equals 200";
/** Always parses and evaluates PASS. */
const VALID_B = "response.status not_equals 500";
/** Parses but evaluates FAIL (200 equals 999 = false). */
const VALID_FAIL = "response.status equals 999";
/** Always fails to parse (unknown operator). */
const INVALID_STR = "response.status badop 200";

// ============================================================================
// 1. Default-seam wiring — mandated, NOT istanbul-ignored
// ============================================================================

describe("AssertionEngine — default-seam constructor (real parser+evaluator)", () => {
  it("constructs without arguments and wires real collaborators", () => {
    expect(() => new AssertionEngine()).not.toThrow();
  });

  it("parseAll with real parser: a valid string produces ok:true entry", () => {
    const engine = new AssertionEngine();
    const batch = engine.parseAll([VALID_A]);
    expect(batch.valid).toBe(true);
    const entry = batch.entries[0];
    expect(entry?.assertion).toBe(VALID_A);
    expect(entry?.result.ok).toBe(true);
  });

  it("parseAll with real parser: an invalid string produces ok:false entry", () => {
    const engine = new AssertionEngine();
    const batch = engine.parseAll([INVALID_STR]);
    expect(batch.valid).toBe(false);
    expect(batch.entries[0]?.result.ok).toBe(false);
  });

  it("evaluateAll with real evaluator: correctly evaluates a parsed AST", () => {
    const engine = new AssertionEngine();
    const parsed = engine.parseAll([VALID_A]);
    const entry = parsed.entries[0];
    if (!entry || entry.result.ok !== true) throw new Error("expected ok:true");
    const results = engine.evaluateAll([entry.result.ast], BASE_CTX);
    expect(results).toHaveLength(1);
    expect(results[0]?.pass).toBe(true);
  });
});

// ============================================================================
// 2. parseAll aggregation
// ============================================================================

describe("AssertionEngine.parseAll", () => {
  const engine = new AssertionEngine();

  describe("empty input array", () => {
    it("returns valid:true for [] input (vacuously true)", () => {
      expect(engine.parseAll([]).valid).toBe(true);
    });

    it("returns empty entries for [] input", () => {
      expect(engine.parseAll([]).entries).toHaveLength(0);
    });

    it("returns empty errors for [] input", () => {
      expect(engine.parseAll([]).errors).toHaveLength(0);
    });
  });

  describe("all-valid batch", () => {
    it("returns valid:true when every string parses", () => {
      expect(engine.parseAll([VALID_A, VALID_B]).valid).toBe(true);
    });

    it("returns empty errors when all strings parse", () => {
      expect(engine.parseAll([VALID_A, VALID_B]).errors).toHaveLength(0);
    });

    it("every entry has ok:true", () => {
      const batch = engine.parseAll([VALID_A, VALID_B]);
      for (const entry of batch.entries) {
        expect(entry.result.ok).toBe(true);
      }
    });
  });

  describe("all-invalid batch", () => {
    it("returns valid:false when every string fails to parse", () => {
      expect(engine.parseAll([INVALID_STR, "   "]).valid).toBe(false);
    });

    it("aggregated errors are non-empty and prefixed with the source string", () => {
      const batch = engine.parseAll([INVALID_STR, "   "]);
      expect(batch.errors.length).toBeGreaterThan(0);
      const hasFirst = batch.errors.some((e) => e.startsWith(INVALID_STR + ":"));
      expect(hasFirst).toBe(true);
    });
  });

  describe("mixed valid/invalid batch (the mandated test)", () => {
    let batch: BatchParseResult;

    beforeEach(() => {
      batch = engine.parseAll([VALID_A, INVALID_STR, VALID_B]);
    });

    it("returns three entries in input order", () => {
      expect(batch.entries).toHaveLength(3);
      expect(batch.entries[0]?.assertion).toBe(VALID_A);
      expect(batch.entries[1]?.assertion).toBe(INVALID_STR);
      expect(batch.entries[2]?.assertion).toBe(VALID_B);
    });

    it("first and third entries are ok:true with ast", () => {
      expect(batch.entries[0]?.result.ok).toBe(true);
      expect(batch.entries[2]?.result.ok).toBe(true);
    });

    it("second entry is ok:false", () => {
      expect(batch.entries[1]?.result.ok).toBe(false);
    });

    it("overall valid is false due to the middle failure", () => {
      expect(batch.valid).toBe(false);
    });

    it("errors contain only the failing string's messages, not the valid strings'", () => {
      const hasInvalid = batch.errors.some((e) => e.startsWith(INVALID_STR + ":"));
      expect(hasInvalid).toBe(true);
      const hasValidA = batch.errors.some((e) => e.startsWith(VALID_A + ":"));
      const hasValidB = batch.errors.some((e) => e.startsWith(VALID_B + ":"));
      expect(hasValidA).toBe(false);
      expect(hasValidB).toBe(false);
    });

    it("valid entries still carry their asts (partial-failure isolation)", () => {
      const e0 = batch.entries[0];
      const e2 = batch.entries[2];
      if (!e0 || e0.result.ok !== true) throw new Error("e0 must be ok");
      if (!e2 || e2.result.ok !== true) throw new Error("e2 must be ok");
      expect(e0.result.ast).toBeDefined();
      expect(e2.result.ast).toBeDefined();
    });
  });

  describe("error prefix rule", () => {
    it("each error message is prefixed '<source>: <message>'", () => {
      const batch = engine.parseAll([INVALID_STR]);
      for (const msg of batch.errors) {
        expect(msg).toMatch(
          new RegExp(`^${INVALID_STR.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:`),
        );
      }
    });
  });

  describe("never throws", () => {
    it("does not throw on empty strings, whitespace, or garbage", () => {
      expect(() =>
        engine.parseAll(["", "   ", "!!!@#$%", "response.status", "x y z"]),
      ).not.toThrow();
    });

    it("all-garbage batch yields all ok:false entries", () => {
      const batch = engine.parseAll(["", "   ", "x y z a b c"]);
      for (const entry of batch.entries) {
        expect(entry.result.ok).toBe(false);
      }
    });
  });
});

// ============================================================================
// 3. evaluateAll ordering & purity (mandated)
// ============================================================================

describe("AssertionEngine.evaluateAll", () => {
  const engine = new AssertionEngine();

  function getAst(raw: string): AssertionAst {
    const parsed = engine.parseAll([raw]);
    const entry = parsed.entries[0];
    if (!entry || entry.result.ok !== true) {
      throw new Error(`Expected '${raw}' to parse ok`);
    }
    return entry.result.ast;
  }

  it("returns empty array for empty asts input", () => {
    expect(engine.evaluateAll([], BASE_CTX)).toHaveLength(0);
  });

  it("result length equals asts length", () => {
    const asts = [VALID_A, VALID_B, VALID_FAIL].map(getAst);
    expect(engine.evaluateAll(asts, BASE_CTX)).toHaveLength(asts.length);
  });

  it("preserves input order: result[i] corresponds to asts[i]", () => {
    const asts = [VALID_A, VALID_FAIL, VALID_B].map(getAst);
    const results = engine.evaluateAll(asts, BASE_CTX);
    expect(results[0]?.pass).toBe(true);  // VALID_A: 200 equals 200
    expect(results[1]?.pass).toBe(false); // VALID_FAIL: 200 equals 999
    expect(results[2]?.pass).toBe(true);  // VALID_B: 200 not_equals 500
  });

  it("a failing AST yields a pass:false result — not a throw, not a gap", () => {
    const results = engine.evaluateAll([getAst(VALID_FAIL)], BASE_CTX);
    expect(results).toHaveLength(1);
    expect(results[0]?.pass).toBe(false);
    expect(results[0]?.failureCode).toBeDefined();
    expect(results[0]?.reason).toBeDefined();
  });

  it("is deterministic: two calls with same inputs produce JSON-stringify-equal results", () => {
    const asts = [VALID_A, VALID_FAIL, VALID_B].map(getAst);
    const r1 = engine.evaluateAll(asts, BASE_CTX);
    const r2 = engine.evaluateAll(asts, BASE_CTX);
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
  });

  it("never throws even when an AST target does not resolve", () => {
    const ctxEmpty: EvaluationContext = {
      ...BASE_CTX,
      response: { ...BASE_CTX.response, body: {} },
    };
    const ast = getAst("response.body.value equals 42");
    expect(() => engine.evaluateAll([ast], ctxEmpty)).not.toThrow();
    const results = engine.evaluateAll([ast], ctxEmpty);
    expect(results[0]?.pass).toBe(false);
  });
});
