/**
 * Unit tests for AssertionEngine — Part 2 of 2.
 *
 * Covers: parseAndEvaluate partial-failure + consistency with primitives;
 * seam isolation (spy parser, spy evaluator); untouched-tree static text-scan
 * (DEFERRED constraint proof — proves src/assertions/* does not import
 * test-catalog or cli).
 *
 * Named exports only. ESM `.js` specifiers. No raw JSON.parse.
 */

import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as path from "node:path";

import { AssertionEngine } from "../../../src/assertions/index.js";
import type {
  AssertionAst,
  EvaluationContext,
} from "../../../src/assertions/index.js";

// ---- Shared helpers -------------------------------------------------------

const BASE_CTX: EvaluationContext = {
  request: {
    headers: {},
    body: {},
    url: { full: "http://localhost/", path: "/", query: {} },
  },
  response: {
    status: 200,
    time_ms: 5,
    headers: {},
    body: { value: 42 },
  },
  db: {},
  now: 1_716_000_000_000,
};

const VALID_A = "response.status equals 200";
const VALID_B = "response.status not_equals 500";
const VALID_FAIL = "response.status equals 999";
const INVALID_STR = "response.status badop 200";

// ============================================================================
// 4. parseAndEvaluate — partial-failure + consistency with primitives
// ============================================================================

describe("AssertionEngine.parseAndEvaluate", () => {
  const engine = new AssertionEngine();

  it("returns empty parse+results for empty input", () => {
    const out = engine.parseAndEvaluate([], BASE_CTX);
    expect(out.parse.entries).toHaveLength(0);
    expect(out.parse.valid).toBe(true);
    expect(out.parse.errors).toHaveLength(0);
    expect(out.results).toHaveLength(0);
  });

  it("all-parse-fail input → results is [] (nothing parsed → nothing evaluated)", () => {
    const out = engine.parseAndEvaluate([INVALID_STR], BASE_CTX);
    expect(out.parse.valid).toBe(false);
    expect(out.results).toHaveLength(0);
  });

  it("mixed [valid, invalid, valid] → results has exactly 2 entries (the parseable ones)", () => {
    const out = engine.parseAndEvaluate([VALID_A, INVALID_STR, VALID_B], BASE_CTX);
    expect(out.parse.valid).toBe(false);
    expect(out.results).toHaveLength(2);
  });

  it("parse output JSON-equals independent parseAll call (primitive consistency)", () => {
    const strings = [VALID_A, INVALID_STR, VALID_B];
    const out = engine.parseAndEvaluate(strings, BASE_CTX);
    const batchOnly = engine.parseAll(strings);
    expect(JSON.stringify(out.parse)).toBe(JSON.stringify(batchOnly));
  });

  it("results are in the original relative order of the ok:true entries", () => {
    // [VALID_FAIL, INVALID_STR, VALID_B]: parseable positions are 0 and 2
    const out = engine.parseAndEvaluate([VALID_FAIL, INVALID_STR, VALID_B], BASE_CTX);
    expect(out.results).toHaveLength(2);
    expect(out.results[0]?.pass).toBe(false); // VALID_FAIL: 200 equals 999 → fail
    expect(out.results[1]?.pass).toBe(true);  // VALID_B: 200 not_equals 500 → pass
  });

  it("results match evaluateAll over the filtered asts (observably identical to primitives)", () => {
    const strings = [VALID_A, INVALID_STR, VALID_B];
    const out = engine.parseAndEvaluate(strings, BASE_CTX);

    const batch = engine.parseAll(strings);
    const filteredAsts = batch.entries
      .filter((e) => e.result.ok)
      .map((e) => (e.result as { ok: true; ast: AssertionAst }).ast);
    const evalResults = engine.evaluateAll(filteredAsts, BASE_CTX);

    expect(JSON.stringify(out.results)).toBe(JSON.stringify(evalResults));
  });

  it("never throws for any input", () => {
    expect(() =>
      engine.parseAndEvaluate(["   ", INVALID_STR, VALID_A], BASE_CTX),
    ).not.toThrow();
  });
});

// ============================================================================
// 5. Seam isolation
// ============================================================================

describe("AssertionEngine — seam isolation", () => {
  it("parseAll calls parser.parse exactly once per input string in order", () => {
    const fakeResult0 = { ok: true as const, ast: {} as AssertionAst };
    const fakeResult1 = { ok: false as const, errors: ["err"] as readonly string[] };
    let callIdx = 0;
    const spyParser = {
      parse: vi.fn((_raw: string) => {
        const result = callIdx === 0 ? fakeResult0 : fakeResult1;
        callIdx++;
        return result;
      }),
    };

    const engine = new AssertionEngine({ parser: spyParser });
    engine.parseAll([VALID_A, INVALID_STR]);

    expect(spyParser.parse).toHaveBeenCalledTimes(2);
    expect(spyParser.parse).toHaveBeenNthCalledWith(1, VALID_A);
    expect(spyParser.parse).toHaveBeenNthCalledWith(2, INVALID_STR);
  });

  it("evaluateAll calls evaluator.evaluate once per AST in order with the same context", () => {
    const spyEval = {
      evaluate: vi.fn((_ast: AssertionAst, _ctx: EvaluationContext) => ({
        pass: true,
        expected: null,
        actual: null,
        assertion: "x",
        target: "response.status",
        operator: "equals" as const,
      })),
    };

    const engine = new AssertionEngine({ evaluator: spyEval });

    // Parse with a real engine to get actual ASTs
    const realEngine = new AssertionEngine();
    const parsed = realEngine.parseAll([VALID_A, VALID_B]);
    const asts = parsed.entries
      .filter((e) => e.result.ok)
      .map((e) => (e.result as { ok: true; ast: AssertionAst }).ast);

    engine.evaluateAll(asts, BASE_CTX);

    expect(spyEval.evaluate).toHaveBeenCalledTimes(2);
    for (const call of spyEval.evaluate.mock.calls) {
      // Every call receives the SAME context object reference
      expect(call[1]).toBe(BASE_CTX);
    }
  });
});

// ============================================================================
// 6. Untouched-tree static text-scan (DEFERRED constraint proof)
// ============================================================================

describe("DEFERRED constraint — assertions module does not import test-catalog or cli", () => {
  const srcDir = path.resolve(
    fileURLToPath(import.meta.url),
    "../../../../src/assertions",
  );

  const engineSrc = readFileSync(path.join(srcDir, "assertion-engine.ts"), "utf-8");
  const indexSrc = readFileSync(path.join(srcDir, "index.ts"), "utf-8");

  it("assertion-engine.ts has no test-catalog or cli import specifier", () => {
    expect(engineSrc).not.toMatch(/['"].*\/(test-catalog|cli)\//);
    expect(engineSrc).not.toMatch(/['"]\.\.\/test-catalog/);
    expect(engineSrc).not.toMatch(/['"]\.\.\/cli/);
  });

  it("index.ts has no test-catalog or cli import specifier", () => {
    expect(indexSrc).not.toMatch(/['"].*\/(test-catalog|cli)\//);
    expect(indexSrc).not.toMatch(/['"]\.\.\/test-catalog/);
    expect(indexSrc).not.toMatch(/['"]\.\.\/cli/);
  });

  it("only cross-module specifier in assertion-engine.ts is ../core/", () => {
    const crossModule = [...engineSrc.matchAll(/from\s+["'](\.\.[^"']+)["']/g)]
      .map((m) => m[1] ?? "")
      .filter((s) => !s.startsWith("./"));
    for (const spec of crossModule) {
      expect(spec).toMatch(/^\.\.\/core\//);
    }
  });
});
