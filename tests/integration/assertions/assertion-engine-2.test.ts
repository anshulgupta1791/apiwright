/**
 * Integration test: AssertionEngine end-to-end contract — Part 2 of 2.
 *
 * PUBLIC SURFACE ONLY: imports exclusively from `src/assertions/index.js`
 * and `src/core/safe-json.js`. No deep imports.
 *
 * Suites 5–7: AssertionResult JSON round-trip via parseJson, engine never-
 * throws on the invalid corpus, and parseAndEvaluate consistency with the
 * parseAll+evaluateAll primitives.
 *
 * Hermetic — no network, DB, filesystem I/O, real clock, or randomness.
 * Named exports only. `parseJson` boundary; no raw JSON.parse.
 */

import { describe, it, expect } from "vitest";

import { AssertionEngine } from "../../../src/assertions/index.js";
import type {
  AssertionAst,
  EvaluationContext,
} from "../../../src/assertions/index.js";

import { parseJson } from "../../../src/core/safe-json.js";

import {
  ASSERTION_CORPUS,
  validCases,
  invalidCases,
} from "../../fixtures/assertions/corpus.js";
import { ASSERTION_CONTEXTS } from "../../fixtures/assertions/contexts.js";

const engine = new AssertionEngine();
const allRaw = ASSERTION_CORPUS.map((c) => c.raw);

type OkEntry = { ok: true; ast: AssertionAst };

// ============================================================================
// Suite 5 — AssertionResult JSON round-trip via parseJson (runner-ready)
// ============================================================================

describe("Suite 5 — AssertionResult JSON round-trip via parseJson", () => {
  it("every base-context AssertionResult round-trips through parseJson unchanged", () => {
    const batch = engine.parseAll(allRaw);
    const asts = batch.entries
      .map((e, i) => ({ e, c: ASSERTION_CORPUS[i] }))
      .filter((x) => x.c?.context === "base" && x.e.result.ok)
      .map((x) => (x.e.result as OkEntry).ast);
    const results = engine.evaluateAll(asts, ASSERTION_CONTEXTS.base);

    for (const r of results) {
      const round = parseJson(JSON.stringify(r));
      expect(round.ok).toBe(true);
      if (round.ok) {
        expect(round.value).toEqual(r);
      }
    }
  });

  it("every db-context AssertionResult round-trips through parseJson unchanged", () => {
    const batch = engine.parseAll(allRaw);
    const asts = batch.entries
      .map((e, i) => ({ e, c: ASSERTION_CORPUS[i] }))
      .filter((x) => x.c?.context === "db" && x.e.result.ok)
      .map((x) => (x.e.result as OkEntry).ast);
    const results = engine.evaluateAll(asts, ASSERTION_CONTEXTS.db);

    for (const r of results) {
      const round = parseJson(JSON.stringify(r));
      expect(round.ok).toBe(true);
      if (round.ok) {
        expect(round.value).toEqual(r);
      }
    }
  });

  it("every edge-context AssertionResult round-trips through parseJson unchanged", () => {
    const batch = engine.parseAll(allRaw);
    const asts = batch.entries
      .map((e, i) => ({ e, c: ASSERTION_CORPUS[i] }))
      .filter((x) => x.c?.context === "edge" && x.e.result.ok)
      .map((x) => (x.e.result as OkEntry).ast);
    const results = engine.evaluateAll(asts, ASSERTION_CONTEXTS.edge);

    for (const r of results) {
      const round = parseJson(JSON.stringify(r));
      expect(round.ok).toBe(true);
      if (round.ok) {
        expect(round.value).toEqual(r);
      }
    }
  });
});

// ============================================================================
// Suite 6 — engine NEVER throws on the invalid corpus (resilience)
// ============================================================================

describe("Suite 6 — engine never throws on the invalid corpus", () => {
  it("parseAll over the invalid-only subset does not throw", () => {
    const invalidRaw = invalidCases.map((c) => c.raw);
    expect(() => engine.parseAll(invalidRaw)).not.toThrow();
  });

  it("invalid corpus entries all produce ok:false parse results", () => {
    const invalidRaw = invalidCases.map((c) => c.raw);
    const batch = engine.parseAll(invalidRaw);
    for (const entry of batch.entries) {
      expect(entry.result.ok).toBe(false);
    }
  });

  it("evaluateAll over the edge context (adversarial) does not throw", () => {
    const batch = engine.parseAll(allRaw);
    const asts = batch.entries
      .map((e, i) => ({ e, c: ASSERTION_CORPUS[i] }))
      .filter((x) => x.c?.context === "edge" && x.e.result.ok)
      .map((x) => (x.e.result as OkEntry).ast);
    expect(() => engine.evaluateAll(asts, ASSERTION_CONTEXTS.edge)).not.toThrow();
  });

  it("the invalid corpus is non-empty (sanity — ensures the suite is not vacuous)", () => {
    expect(invalidCases.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// Suite 7 — parseAndEvaluate consistency with parseAll+evaluateAll primitives
// ============================================================================

describe("Suite 7 — parseAndEvaluate faithfully composes the two primitives", () => {
  it("base context: parseAndEvaluate parse output matches independent parseAll", () => {
    const baseRaw = validCases.filter((c) => c.context === "base").map((c) => c.raw);
    const ctx: EvaluationContext = ASSERTION_CONTEXTS.base;

    const combined = engine.parseAndEvaluate(baseRaw, ctx);
    const batchOnly = engine.parseAll(baseRaw);

    expect(JSON.stringify(combined.parse)).toBe(JSON.stringify(batchOnly));
  });

  it("base context: parseAndEvaluate results match independent evaluateAll", () => {
    const baseRaw = validCases.filter((c) => c.context === "base").map((c) => c.raw);
    const ctx: EvaluationContext = ASSERTION_CONTEXTS.base;

    const combined = engine.parseAndEvaluate(baseRaw, ctx);

    const batch = engine.parseAll(baseRaw);
    const asts = batch.entries
      .filter((e) => e.result.ok)
      .map((e) => (e.result as OkEntry).ast);
    const evalOnly = engine.evaluateAll(asts, ctx);

    expect(JSON.stringify(combined.results)).toBe(JSON.stringify(evalOnly));
  });

  it("returns empty results for empty input", () => {
    const out = engine.parseAndEvaluate([], ASSERTION_CONTEXTS.base);
    expect(out.parse.entries).toHaveLength(0);
    expect(out.parse.valid).toBe(true);
    expect(out.results).toHaveLength(0);
  });

  it("does not throw for any input including garbage strings", () => {
    expect(() =>
      engine.parseAndEvaluate(
        ["   ", "bad op", "response.status equals 200"],
        ASSERTION_CONTEXTS.base,
      ),
    ).not.toThrow();
  });
});
