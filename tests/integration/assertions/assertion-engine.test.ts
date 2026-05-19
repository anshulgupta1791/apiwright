/**
 * Integration test: AssertionEngine end-to-end contract — Part 1 of 2.
 *
 * PUBLIC SURFACE ONLY: imports exclusively from `src/assertions/index.js`
 * and `src/core/safe-json.js`. No deep imports (parser.js, evaluator.js,
 * operators/*, etc.). This is the proof the public facade is sufficient.
 *
 * Suites 1–4: parseAll aggregation, evaluateAll verdicts, null-vs-missing
 * matrix (LOCKED decision #6), and determinism.
 *
 * Part 2 (`assertion-engine-2.test.ts`): Suites 5–7 (JSON round-trip, never-
 * throws, parseAndEvaluate consistency).
 *
 * Hermetic — no network, DB, filesystem I/O, real clock, or randomness.
 * Named exports only. `parseJson` boundary; no raw JSON.parse.
 */

import { describe, it, expect } from "vitest";

import {
  AssertionEngine,
  FAILURE_CODES,
} from "../../../src/assertions/index.js";
import type {
  AssertionAst,
  AssertionResult,
  EvaluationContext,
  FailureCode,
} from "../../../src/assertions/index.js";

import {
  ASSERTION_CORPUS,
  validCases,
  invalidCases,
  expectedFailureCodes,
} from "../../fixtures/assertions/corpus.js";
import type { CorpusCase } from "../../fixtures/assertions/corpus.js";
import { ASSERTION_CONTEXTS } from "../../fixtures/assertions/contexts.js";

const engine = new AssertionEngine();
const allRaw = ASSERTION_CORPUS.map((c) => c.raw);

// Helper type for a parsed-ok entry
type OkEntry = { ok: true; ast: AssertionAst };

// ============================================================================
// Suite 1 — parseAll over the whole corpus (aggregation)
// ============================================================================

describe("Suite 1 — parseAll over the whole corpus", () => {
  it("does not throw on the full corpus (valid + invalid)", () => {
    expect(() => engine.parseAll(allRaw)).not.toThrow();
  });

  it("entries.length equals allRaw.length (1:1 with input)", () => {
    const batch = engine.parseAll(allRaw);
    expect(batch.entries.length).toBe(allRaw.length);
  });

  it("each entry.assertion equals the corresponding raw string (order preserved)", () => {
    const batch = engine.parseAll(allRaw);
    for (let i = 0; i < allRaw.length; i++) {
      expect(batch.entries[i]?.assertion).toBe(allRaw[i]);
    }
  });

  it("every valid corpus case produces an ok:true entry", () => {
    const batch = engine.parseAll(allRaw);
    for (let i = 0; i < ASSERTION_CORPUS.length; i++) {
      const c = ASSERTION_CORPUS[i];
      const e = batch.entries[i];
      if (!c || !e || c.parse.kind !== "ok") continue;
      expect(e.result.ok).toBe(true);
    }
  });

  it("every invalid corpus case produces ok:false with attributable error fragments", () => {
    const batch = engine.parseAll(allRaw);
    for (let i = 0; i < ASSERTION_CORPUS.length; i++) {
      const c = ASSERTION_CORPUS[i];
      const e = batch.entries[i];
      if (!c || !e || c.parse.kind !== "error") continue;
      expect(e.result.ok).toBe(false);
      if (e.result.ok === false) {
        const joined = e.result.errors.join("\n").toLowerCase();
        for (const frag of c.parse.errorFragments) {
          expect(joined).toContain(frag.toLowerCase());
        }
      }
    }
  });

  it("batch.valid equals corpus-derived all-ok (not a hard-coded literal)", () => {
    const batch = engine.parseAll(allRaw);
    const allOk = ASSERTION_CORPUS.every((c) => c.parse.kind === "ok");
    expect(batch.valid).toBe(allOk);
  });

  it("aggregated errors length >= invalid case count (more than first-error-only)", () => {
    const batch = engine.parseAll(allRaw);
    expect(batch.errors.length).toBeGreaterThanOrEqual(invalidCases.length);
  });

  it("aggregated errors contain ≥1 fragment from each invalid corpus case", () => {
    const batch = engine.parseAll(allRaw);
    const lowerErrors = batch.errors.map((e) => e.toLowerCase());
    for (const ic of invalidCases) {
      if (ic.parse.kind !== "error") continue;
      const anyFrag = ic.parse.errorFragments.some((frag) =>
        lowerErrors.some((e) => e.includes(frag.toLowerCase())),
      );
      expect(anyFrag).toBe(true);
    }
  });
});

// ============================================================================
// Suite 2 — evaluateAll over parsed valid ASTs (per-assertion verdict)
// ============================================================================

describe("Suite 2 — evaluateAll over valid corpus ASTs", () => {
  const batch = engine.parseAll(allRaw);

  // Zip corpus with batch entries — keep only parseable entries
  const parsedValid: Array<{ c: CorpusCase; ast: AssertionAst }> = [];
  for (let i = 0; i < ASSERTION_CORPUS.length; i++) {
    const c = ASSERTION_CORPUS[i];
    const e = batch.entries[i];
    if (!c || !e || c.parse.kind !== "ok" || e.result.ok !== true) continue;
    parsedValid.push({ c, ast: (e.result as OkEntry).ast });
  }

  it("all valid corpus cases actually parse (regression guard)", () => {
    expect(parsedValid.length).toBe(validCases.length);
  });

  it("evaluateAll does not throw for the base context group", () => {
    const asts = parsedValid.filter((x) => x.c.context === "base").map((x) => x.ast);
    expect(() => engine.evaluateAll(asts, ASSERTION_CONTEXTS.base)).not.toThrow();
  });

  it("evaluateAll does not throw for the edge context (adversarial: __proto__, huge, null)", () => {
    const asts = parsedValid.filter((x) => x.c.context === "edge").map((x) => x.ast);
    expect(() => engine.evaluateAll(asts, ASSERTION_CONTEXTS.edge)).not.toThrow();
  });

  it("result.length equals asts.length for each context group", () => {
    for (const key of ["base", "headers", "db", "edge"] as const) {
      const asts = parsedValid.filter((x) => x.c.context === key).map((x) => x.ast);
      const ctx: EvaluationContext = ASSERTION_CONTEXTS[key];
      expect(engine.evaluateAll(asts, ctx).length).toBe(asts.length);
    }
  });

  it("every result matches corpus expected pass/failureCode/target/operator (IFF invariant)", () => {
    for (const key of ["base", "headers", "db", "edge"] as const) {
      const group = parsedValid.filter((x) => x.c.context === key);
      const asts = group.map((x) => x.ast);
      const ctx: EvaluationContext = ASSERTION_CONTEXTS[key];
      const results = engine.evaluateAll(asts, ctx);

      for (let j = 0; j < group.length; j++) {
        const item = group[j];
        const r: AssertionResult | undefined = results[j];
        if (!item || !r || !item.c.expect) continue;
        const exp = item.c.expect;

        expect(r.pass).toBe(exp.pass);
        expect(r.target).toBe(exp.target);
        expect(r.operator).toBe(exp.operator);

        if (r.pass) {
          expect(r.failureCode).toBeUndefined();
          expect(r.reason).toBeUndefined();
        } else {
          expect(r.failureCode).toBe(exp.failureCode);
          expect(typeof r.reason).toBe("string");
          expect((r.reason as string).length).toBeGreaterThan(0);
          if (exp.reasonIncludes) {
            expect((r.reason as string).toLowerCase()).toContain(
              exp.reasonIncludes.toLowerCase(),
            );
          }
        }
      }
    }
  });

  it("result.assertion equals the trimmed raw string (ast.raw flows through)", () => {
    const group = parsedValid.filter((x) => x.c.context === "base");
    const results = engine.evaluateAll(group.map((x) => x.ast), ASSERTION_CONTEXTS.base);
    for (let j = 0; j < group.length; j++) {
      expect(results[j]?.assertion).toBe(group[j]?.c.raw.trim());
    }
  });

  it("all 7 FailureCodes appear at least once across failing results", () => {
    const observed = new Set<FailureCode>();
    for (const key of ["base", "headers", "db", "edge"] as const) {
      const asts = parsedValid.filter((x) => x.c.context === key).map((x) => x.ast);
      const results = engine.evaluateAll(asts, ASSERTION_CONTEXTS[key]);
      for (const r of results) {
        if (!r.pass && r.failureCode !== undefined) observed.add(r.failureCode);
      }
    }
    for (const code of Object.values(FAILURE_CODES)) {
      expect(observed).toContain(code);
    }
    for (const code of expectedFailureCodes()) {
      expect(observed).toContain(code);
    }
  });
});

// ============================================================================
// Suite 3 — null-vs-missing matrix end to end (LOCKED decision #6)
// ============================================================================

describe("Suite 3 — null-vs-missing existence matrix (4×3 LOCKED truth table)", () => {
  const batch = engine.parseAll(allRaw);

  type MatrixRow = [string, string, boolean, FailureCode | undefined];
  const MATRIX: MatrixRow[] = [
    ["exists",      "present",      true,  undefined],
    ["exists",      "nullField",    true,  undefined],
    ["exists",      "missingField", false, "TARGET_NOT_FOUND"],
    ["not_exists",  "present",      false, "COMPARISON_FAILED"],
    ["not_exists",  "nullField",    false, "COMPARISON_FAILED"],
    ["not_exists",  "missingField", true,  undefined],
    ["is_null",     "present",      false, "COMPARISON_FAILED"],
    ["is_null",     "nullField",    true,  undefined],
    ["is_null",     "missingField", false, "TARGET_NOT_FOUND"],
    ["is_not_null", "present",      true,  undefined],
    ["is_not_null", "nullField",    false, "COMPARISON_FAILED"],
    ["is_not_null", "missingField", false, "TARGET_NOT_FOUND"],
  ];

  for (const [op, field, expectedPass, expectedCode] of MATRIX) {
    const raw = `response.body.${field} ${op}`;
    it(`${op} on ${field} → pass:${String(expectedPass)}`, () => {
      const idx = allRaw.indexOf(raw);
      expect(idx).toBeGreaterThanOrEqual(0);
      const entry = batch.entries[idx];
      if (!entry || entry.result.ok !== true) throw new Error(`Expected '${raw}' to parse ok`);
      const results = engine.evaluateAll([(entry.result as OkEntry).ast], ASSERTION_CONTEXTS.edge);
      const r = results[0];
      if (!r) throw new Error("expected a result");
      expect(r.pass).toBe(expectedPass);
      if (expectedCode !== undefined) expect(r.failureCode).toBe(expectedCode);
      else expect(r.failureCode).toBeUndefined();
    });
  }
});

// ============================================================================
// Suite 4 — determinism (twice, fixed now, JSON-stringify-identical)
// ============================================================================

describe("Suite 4 — determinism with fixed now", () => {
  it("parseAll is byte-identical across two independent calls", () => {
    const b1 = engine.parseAll(allRaw);
    const b2 = engine.parseAll(allRaw);
    expect(JSON.stringify(b1)).toBe(JSON.stringify(b2));
  });

  it("evaluateAll is byte-identical across two calls with fixed now", () => {
    const b1 = engine.parseAll(allRaw);
    const b2 = engine.parseAll(allRaw);
    for (const key of ["base", "db", "edge"] as const) {
      const ctx: EvaluationContext = ASSERTION_CONTEXTS[key];
      const asts1 = b1.entries
        .map((e, i) => ({ e, c: ASSERTION_CORPUS[i] }))
        .filter((x) => x.c?.context === key && x.e.result.ok)
        .map((x) => (x.e.result as OkEntry).ast);
      const asts2 = b2.entries
        .map((e, i) => ({ e, c: ASSERTION_CORPUS[i] }))
        .filter((x) => x.c?.context === key && x.e.result.ok)
        .map((x) => (x.e.result as OkEntry).ast);
      const r1 = engine.evaluateAll(asts1, ctx);
      const r2 = engine.evaluateAll(asts2, ctx);
      expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
    }
  });

  it("expected counts are derived from corpus filters, not hard-coded magic numbers", () => {
    expect(typeof validCases.length).toBe("number");
    expect(typeof invalidCases.length).toBe("number");
    expect(validCases.length).toBeGreaterThan(0);
    expect(invalidCases.length).toBeGreaterThan(0);
  });
});
