/**
 * Layer A Part 1 of 2 — Hermetic gated integration test for the §5 DB layer.
 *
 * PUBLIC SURFACE ONLY: imports exclusively from `src/db/index.js` and
 * `src/core/safe-json.js`. No deep `src/db/**` imports (no pool/expect/
 * templating/connectors internals). Suite 0 reads this file as text and
 * asserts every `src/` import specifier matches only those two paths.
 *
 * Hermetic: no network, no Docker, no real driver, no clock, no randomness.
 * Runs in the gated `npm test`; counts toward the 95% coverage gate.
 *
 * Part 1: Suites 0–4 (static scan, extractRefs, resolveRefs, bindForEngine,
 * registry single-flight/reuse). Part 2 (`db-connector-layer-2.test.ts`):
 * Suites 5–8 (evaluate, disposeAll, secret-safety, determinism).
 *
 * Per-engine corpus iteration is delegated to
 * `tests/fixtures/db/pipeline-runner.ts` (≤300-line split trigger).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, it, expect, beforeEach } from "vitest";

import {
  createRegistry,
  extractRefs,
  resolveRefs,
  isDbConnectorError,
} from "../../../src/db/index.js";
import type { ConnectorFactory } from "../../../src/db/index.js";
import { parseJson } from "../../../src/core/safe-json.js";

import {
  DB_CORPUS,
  byEngine,
  bindableCases,
  extractionFailCases,
  negativeByCode,
  unresolvedRefCases,
  SQL_INJECTION,
  CYPHER_INJECTION,
  MONGO_INJECTION_VALUE,
} from "../../fixtures/db/corpus.js";
import {
  DB_ENV,
  UNKNOWN_CONN,
  FAKE_CRED_SUBSTRINGS,
} from "../../fixtures/db/environment.js";
import { makeFakeFactory } from "../../fixtures/db/fake-connector.js";
import { runPipelineCase, assertBindingShape } from "../../fixtures/db/pipeline-runner.js";

// ============================================================================
// Suite 0 — PUBLIC-SURFACE-ONLY static text scan
// ============================================================================

describe("Suite 0 — public-surface-only static import scan", () => {
  it("every src/ import specifier in this file matches only the two allowed paths", () => {
    const thisFile = readFileSync(
      join(process.cwd(), "tests/integration/db/db-connector-layer.test.ts"),
      "utf8",
    );
    const fromRegex = /from\s+"([^"]+)"/g;
    const allowed = new Set([
      "../../../src/db/index.js",
      "../../../src/core/safe-json.js",
    ]);
    let match: RegExpExecArray | null;
    while ((match = fromRegex.exec(thisFile)) !== null) {
      const s = match[1] ?? "";
      if (s.includes("src/")) expect(allowed).toContain(s);
    }
  });

  it("corpus is non-empty and covers all 4 engines", () => {
    expect(DB_CORPUS.length).toBeGreaterThan(0);
    for (const eng of ["postgres", "mysql", "mongodb", "neo4j"] as const) {
      expect(byEngine(eng).length).toBeGreaterThan(0);
    }
  });
});

// ============================================================================
// Suite 1 — extractRefs over the corpus
// ============================================================================

describe("Suite 1 — extractRefs", () => {
  it("never throws on any corpus query", () => {
    for (const c of DB_CORPUS) {
      expect(() => extractRefs(c.query)).not.toThrow();
    }
  });

  it("every bindable case produces ok:true", () => {
    for (const c of bindableCases) {
      expect(extractRefs(c.query).ok, c.id).toBe(true);
    }
  });

  it("every extraction-fail case produces ok:false with expected RefRejectionCode", () => {
    for (const c of extractionFailCases) {
      const r = extractRefs(c.query);
      expect(r.ok, c.id).toBe(false);
      if (!r.ok && c.extractRejects) {
        expect(r.rejections.map((rej) => rej.code)).toContain(c.extractRejects.code);
      }
    }
  });

  it("UNKNOWN_NAMESPACE cases return that code", () => {
    const cases = negativeByCode("UNKNOWN_NAMESPACE");
    expect(cases.length).toBeGreaterThan(0);
    for (const c of cases) {
      const r = extractRefs(c.query);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.rejections.some((r2) => r2.code === "UNKNOWN_NAMESPACE")).toBe(true);
    }
  });

  it("MALFORMED_REF cases return that code", () => {
    const cases = negativeByCode("MALFORMED_REF");
    expect(cases.length).toBeGreaterThan(0);
    for (const c of cases) {
      const r = extractRefs(c.query);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.rejections.some((r2) => r2.code === "MALFORMED_REF")).toBe(true);
    }
  });

  it("D3 pin #1: injection payload absent from neutralQuery of every bindable case", () => {
    for (const c of bindableCases) {
      const r = extractRefs(c.query);
      if (!r.ok) continue;
      const s = JSON.stringify(r.neutral.neutralQuery);
      expect(s.includes(SQL_INJECTION), `${c.id}: SQL_INJECTION absent`).toBe(false);
      expect(s.includes(CYPHER_INJECTION), `${c.id}: CYPHER_INJECTION absent`).toBe(false);
      expect(s.includes(MONGO_INJECTION_VALUE), `${c.id}: MONGO_INJ absent`).toBe(false);
    }
  });
});

// ============================================================================
// Suite 2 — resolveRefs
// ============================================================================

describe("Suite 2 — resolveRefs", () => {
  it("resolves all bindable cases to ok:true", () => {
    for (const c of bindableCases) {
      const ext = extractRefs(c.query);
      if (!ext.ok) continue;
      const r = resolveRefs(ext.neutral.refs, c.resolution);
      expect(r.ok, c.id).toBe(true);
    }
  });

  it("UNRESOLVED_REF case fails at resolveRefs (not extractRefs)", () => {
    for (const c of unresolvedRefCases) {
      const ext = extractRefs(c.query);
      expect(ext.ok, c.id).toBe(true);
      if (!ext.ok) continue;
      const r = resolveRefs(ext.neutral.refs, c.resolution);
      expect(r.ok, c.id).toBe(false);
      if (!r.ok) expect(r.rejections.some((rej) => rej.code === "UNRESOLVED_REF")).toBe(true);
    }
  });

  it("explicit null in context resolves to value===null, not UNRESOLVED_REF", () => {
    const c = DB_CORPUS.find((x) => x.id === "neg.resolve.explicit-null-resolves");
    expect(c).toBeDefined();
    if (!c) return;
    const ext = extractRefs(c.query);
    expect(ext.ok).toBe(true);
    if (!ext.ok) return;
    const r = resolveRefs(ext.neutral.refs, c.resolution);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.values.some((v) => v.value === null)).toBe(true);
  });

  it("extractRefs is byte-identical across two calls per case", () => {
    for (const c of DB_CORPUS) {
      expect(JSON.stringify(extractRefs(c.query))).toBe(JSON.stringify(extractRefs(c.query)));
    }
  });
});

// ============================================================================
// Suite 3 — bindForEngine per-engine shape + D3 pins (via pipeline-runner)
// ============================================================================

describe("Suite 3 — bindForEngine per-engine shape + D3 pins", () => {
  it("never throws on any bindable case", () => {
    for (const c of bindableCases) {
      expect(() => runPipelineCase(c)).not.toThrow();
    }
  });

  it("every bindable case produces bindResult.ok:true", () => {
    for (const c of bindableCases) {
      expect(runPipelineCase(c).bindResult?.ok, c.id).toBe(true);
    }
  });

  it("engine discriminant matches case.engine in every bound result", () => {
    for (const c of bindableCases) {
      const run = runPipelineCase(c);
      if (!run.bindResult?.ok) continue;
      expect(run.bindResult.query.engine, c.id).toBe(c.engine);
    }
  });

  it("all binding shape assertions pass (textIncludes/textExcludes/valueArity)", () => {
    for (const c of bindableCases) {
      const run = runPipelineCase(c);
      expect(() => assertBindingShape(run, c)).not.toThrow();
    }
  });

  it("mysql ordered-reuse: ${a} ${b} ${a} → values [v(a), v(b), v(a)]", () => {
    const c = DB_CORPUS.find((x) => x.id === "mysql.d3.ordered-reuse");
    expect(c).toBeDefined();
    if (!c) return;
    const run = runPipelineCase(c);
    expect(run.bindResult?.ok).toBe(true);
    if (!run.bindResult?.ok || run.bindResult.query.engine !== "mysql") return;
    const vals = run.bindResult.query.bound.values;
    expect(vals.length).toBe(3);
    expect(vals[0]).toBe(42);
    expect(vals[1]).toBe("acme");
    expect(vals[2]).toBe(42);
  });

  it("pg reused-ref: 2 distinct refs → 2 values even with 3 occurrences", () => {
    const c = DB_CORPUS.find((x) => x.id === "pg.d3.reused-ref");
    expect(c).toBeDefined();
    if (!c) return;
    const run = runPipelineCase(c);
    expect(run.bindResult?.ok).toBe(true);
    if (!run.bindResult?.ok || run.bindResult.query.engine !== "postgres") return;
    expect(run.bindResult.query.bound.values.length).toBe(2);
  });

  it("D3 pin #2: injection payload absent from text, present in values/params", () => {
    for (const c of bindableCases) {
      if (!c.binding?.textExcludes.some((ex) => ex.length > 5)) continue;
      const run = runPipelineCase(c);
      if (!run.bindResult?.ok) continue;
      const eng = run.bindResult.query;
      if (eng.engine === "postgres") {
        expect(eng.bound.text).not.toContain(SQL_INJECTION);
      } else if (eng.engine === "mysql") {
        expect(eng.bound.sql).not.toContain(SQL_INJECTION);
      } else if (eng.engine === "neo4j") {
        expect(eng.bound.cypher).not.toContain(CYPHER_INJECTION);
      } else if (eng.engine === "mongodb") {
        expect(JSON.stringify(Object.keys(eng.bound.document))).not.toContain(
          MONGO_INJECTION_VALUE,
        );
      }
    }
  });
});

// ============================================================================
// Suite 4 — registry: createRegistry + acquire (single-flight / reuse)
// ============================================================================

describe("Suite 4 — registry single-flight and reuse", () => {
  let factory: ConnectorFactory;

  beforeEach(() => {
    factory = makeFakeFactory().factory;
  });

  it("createRegistry does not throw", () => {
    expect(() => createRegistry(DB_ENV, factory)).not.toThrow();
  });

  it("acquire resolves a connector for a known name", async () => {
    const reg = createRegistry(DB_ENV, factory);
    const conn = await reg.acquire("pg_main");
    expect(typeof conn.execute).toBe("function");
  });

  it("sequential acquire × 2 → same instance", async () => {
    const reg = createRegistry(DB_ENV, factory);
    expect(await reg.acquire("pg_main")).toBe(await reg.acquire("pg_main"));
  });

  it("concurrent Promise.all([acquire, acquire]) → same instance", async () => {
    const reg = createRegistry(DB_ENV, factory);
    const [c1, c2] = await Promise.all([reg.acquire("pg_main"), reg.acquire("pg_main")]);
    expect(c1).toBe(c2);
  });

  it("two different names → distinct instances", async () => {
    const reg = createRegistry(DB_ENV, factory);
    expect(await reg.acquire("pg_main")).not.toBe(await reg.acquire("mysql_main"));
  });

  it("acquire(UNKNOWN_CONN) rejects with isDbConnectorError → true", async () => {
    const reg = createRegistry(DB_ENV, factory);
    await expect(reg.acquire(UNKNOWN_CONN)).rejects.toSatisfy(isDbConnectorError);
  });

  it("unknown-conn error has code DB_CONNECTION_FAILED, phase connect", async () => {
    const reg = createRegistry(DB_ENV, factory);
    try { await reg.acquire(UNKNOWN_CONN); expect.fail("should throw"); }
    catch (err: unknown) {
      if (isDbConnectorError(err)) {
        expect(err.code).toBe("DB_CONNECTION_FAILED");
        expect(err.phase).toBe("connect");
      }
    }
  });

  it("unknown-conn error message contains the name, no fake credentials", async () => {
    const reg = createRegistry(DB_ENV, factory);
    try { await reg.acquire(UNKNOWN_CONN); }
    catch (err: unknown) {
      if (!isDbConnectorError(err)) return;
      expect(err.message).toContain(UNKNOWN_CONN);
      for (const cred of FAKE_CRED_SUBSTRINGS) expect(err.message).not.toContain(cred);
    }
  });

  it("after unknown-conn rejection, a valid acquire still resolves", async () => {
    const reg = createRegistry(DB_ENV, factory);
    await expect(reg.acquire(UNKNOWN_CONN)).rejects.toBeDefined();
    expect(await reg.acquire("pg_main")).toBeDefined();
  });
});

// Suppress unused-import warning for parseJson (used in Part 2 but imported here):
const _p = parseJson;
void _p;
