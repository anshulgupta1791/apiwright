/**
 * Layer A — Part 2 of 2: Hermetic gated integration test for the §5 DB layer.
 *
 * PUBLIC SURFACE ONLY: imports exclusively from `src/db/index.js` and
 * `src/core/safe-json.js`. Continuation of `db-connector-layer.test.ts`.
 *
 * Suites 5–8: evaluate (all four modes, D-D, D4), disposeAll aggregation,
 * secret-safety sweep, determinism + parseJson round-trip + never-throws.
 */

import { describe, it, expect } from "vitest";

import {
  createRegistry,
  evaluate,
  isDbConnectorError,
  DB_EXPECT_FAILURE_CODES,
} from "../../../src/db/index.js";
import type {
  ConnectorFactory,
  DisposeAllOutcome,
} from "../../../src/db/index.js";
import { parseJson } from "../../../src/core/safe-json.js";

import {
  DB_CORPUS,
  byEngine,
  evaluableCases,
  extractionFailCases,
  observedFailureCodes,
  ddMalformedCases,
} from "../../fixtures/db/corpus.js";
import {
  DB_ENV,
  UNKNOWN_CONN,
  FAKE_CRED_SUBSTRINGS,
} from "../../fixtures/db/environment.js";
import { makeFakeFactory, fakeRows } from "../../fixtures/db/fake-connector.js";
import { runPipelineCase } from "../../fixtures/db/pipeline-runner.js";

// ============================================================================
// Suite 5 — evaluate: all four modes + D-D + D4
// ============================================================================

describe("Suite 5 — evaluate over all evaluable corpus cases", () => {
  it("never throws on any evaluable case", () => {
    for (const c of evaluableCases) {
      expect(() => runPipelineCase(c)).not.toThrow();
    }
  });

  it("every evaluable case produces expected pass/failureCode (IFF invariant)", () => {
    for (const c of evaluableCases) {
      if (!c.verify) continue;
      const r = runPipelineCase(c).evaluateResult;
      if (!r) continue;
      expect(r.pass, `pass for ${c.id}`).toBe(c.verify.pass);
      if (!r.pass) {
        expect(r.failureCode, `code for ${c.id}`).toBe(c.verify.failureCode);
        expect(typeof r.reason).toBe("string");
        expect((r.reason).length).toBeGreaterThan(0);
      } else {
        expect((r as Record<string, unknown>)["failureCode"]).toBeUndefined();
        expect((r as Record<string, unknown>)["reason"]).toBeUndefined();
      }
    }
  });

  it("all 4 DbExpectFailureCodes appear at least once across the corpus", () => {
    const observed = new Set<string>();
    for (const c of evaluableCases) {
      const r = runPipelineCase(c).evaluateResult;
      if (r && !r.pass) observed.add(r.failureCode);
    }
    for (const code of Object.values(DB_EXPECT_FAILURE_CODES)) expect(observed).toContain(code);
    for (const code of observedFailureCodes()) expect(observed).toContain(code);
  });

  it("D-D: match/exact with empty/absent fields → DB_EXPECT_MALFORMED before row iteration", () => {
    expect(ddMalformedCases.length).toBeGreaterThan(0);
    for (const c of ddMalformedCases) {
      const r = runPipelineCase(c).evaluateResult;
      expect(r?.pass).toBe(false);
      if (r && !r.pass) expect(r.failureCode).toBe("DB_EXPECT_MALFORMED");
    }
  });

  it("D-D: exists/not_exists NEVER produce DB_EXPECT_MALFORMED with absent fields", () => {
    const c = DB_CORPUS.find((x) => x.id === "neg.dd.exists-ignores-fields");
    expect(c?.verify?.pass).toBe(true);
    if (!c) return;
    expect(runPipelineCase(c).evaluateResult?.pass).toBe(true);
  });

  it("not_exists DELETE shape: rows:[], rowCount:3 → pass", () => {
    const r = evaluate({ rows: [], rowCount: 3, raw: null }, {
      connection: "pg_main", query: "DELETE FROM t", expect: "not_exists",
    });
    expect(r.pass).toBe(true);
  });

  it("D4: string '1' does NOT match declared number 1 (zero coercion)", () => {
    const r = evaluate({ rows: [{ id: "1" }], rowCount: 1, raw: null }, {
      connection: "pg_main", query: "SELECT id FROM t", expect: "match", fields: { id: 1 },
    });
    expect(r.pass).toBe(false);
    if (!r.pass) expect(r.failureCode).toBe("DB_EXPECT_NO_MATCHING_ROW");
  });

  it("D4: Date instance does NOT match ISO string (zero coercion)", () => {
    const r = evaluate(
      { rows: [{ at: new Date("2024-05-18T00:00:00.000Z") }], rowCount: 1, raw: null },
      { connection: "pg_main", query: "SELECT at FROM t", expect: "match",
        fields: { at: "2024-05-18T00:00:00.000Z" } },
    );
    expect(r.pass).toBe(false);
    if (!r.pass) expect(r.failureCode).toBe("DB_EXPECT_NO_MATCHING_ROW");
  });

  it("D4: {low,high} neo4j Integer-shaped value does NOT match declared number", () => {
    const r = evaluate({ rows: [{ n: { low: 7, high: 0 } }], rowCount: 1, raw: null }, {
      connection: "neo4j_main", query: "RETURN 1", expect: "match", fields: { n: 7 },
    });
    expect(r.pass).toBe(false);
  });

  it("D4: explicit null matches declared null (PASS)", () => {
    const r = evaluate({ rows: [{ flag: null }], rowCount: 1, raw: null }, {
      connection: "pg_main", query: "SELECT flag FROM t", expect: "match", fields: { flag: null },
    });
    expect(r.pass).toBe(true);
  });

  it("D4: declared null vs absent key → FAIL (missing ≠ null)", () => {
    const r = evaluate({ rows: [{ id: 42 }], rowCount: 1, raw: null }, {
      connection: "pg_main", query: "SELECT id FROM t", expect: "match", fields: { flag: null },
    });
    expect(r.pass).toBe(false);
    if (!r.pass) expect(r.failureCode).toBe("DB_EXPECT_NO_MATCHING_ROW");
  });

  it("match: extra row keys ignored → pass", () => {
    const r = evaluate({ rows: [{ id: 42, name: "A", x: "extra" }], rowCount: 1, raw: null }, {
      connection: "pg_main", query: "SELECT * FROM t", expect: "match",
      fields: { id: 42, name: "A" },
    });
    expect(r.pass).toBe(true);
  });

  it("exact: non-matching rows do NOT fail when one row matches exactly", () => {
    const r = evaluate(
      { rows: [{ id: 99, name: "X" }, { id: 42, name: "A" }], rowCount: 2, raw: null },
      { connection: "pg_main", query: "SELECT * FROM t", expect: "exact",
        fields: { id: 42, name: "A" } },
    );
    expect(r.pass).toBe(true);
  });
});

// ============================================================================
// Suite 6 — disposeAll aggregation
// ============================================================================

describe("Suite 6 — disposeAll aggregation", () => {
  it("before any acquire → {ok:true, results:[]}", async () => {
    const reg = createRegistry(DB_ENV, makeFakeFactory().factory);
    const out = await reg.disposeAll();
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.results).toEqual([]);
  });

  it("after N acquires → results has N entries", async () => {
    const reg = createRegistry(DB_ENV, makeFakeFactory().factory);
    await reg.acquire("pg_main");
    await reg.acquire("mysql_main");
    const out = await reg.disposeAll();
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.results.length).toBe(2);
  });

  it("second disposeAll with no intervening acquire → {ok:true, results:[]}", async () => {
    const reg = createRegistry(DB_ENV, makeFakeFactory().factory);
    await reg.acquire("pg_main");
    await reg.disposeAll();
    const out2 = await reg.disposeAll();
    expect(out2.ok).toBe(true);
    if (out2.ok) expect(out2.results).toEqual([]);
  });

  it("one disconnect failure → ok:false, but other connectors still run disconnect", async () => {
    const failFactory: ConnectorFactory = {
      create(engine) {
        const rejects = engine === "postgres";
        return {
          async connect() {/* ok */},
          async execute(_q, _p) { return fakeRows([]); },
          async disconnect() { if (rejects) throw new Error("fake disconnect failure"); },
        };
      },
    };
    const reg = createRegistry(DB_ENV, failFactory);
    await reg.acquire("pg_main");
    await reg.acquire("mysql_main");
    const out = await reg.disposeAll();
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.results.length).toBe(2);
  });

  it("DisposeAllOutcome parseJson round-trips deep-equal", async () => {
    const reg = createRegistry(DB_ENV, makeFakeFactory().factory);
    await reg.acquire("pg_main");
    const out: DisposeAllOutcome = await reg.disposeAll();
    const round = parseJson(JSON.stringify(out));
    expect(round.ok).toBe(true);
    if (round.ok) expect(round.value).toEqual(out);
  });
});

// ============================================================================
// Suite 7 — secret-safety sweep
// ============================================================================

describe("Suite 7 — secret-safety sweep", () => {
  it("no fake cred in any DbConnectorError.message (unknown-conn path)", async () => {
    const reg = createRegistry(DB_ENV, makeFakeFactory().factory);
    try { await reg.acquire(UNKNOWN_CONN); }
    catch (err: unknown) {
      if (!isDbConnectorError(err)) return;
      for (const cred of FAKE_CRED_SUBSTRINGS) expect(err.message).not.toContain(cred);
    }
  });

  it("no fake cred in DbVerifyOutcome JSON", () => {
    const r = evaluate({ rows: [], rowCount: 0, raw: null }, {
      connection: "pg_main", query: "SELECT 1", expect: "exists",
    });
    const json = JSON.stringify(r);
    for (const cred of FAKE_CRED_SUBSTRINGS) expect(json).not.toContain(cred);
  });

  it("no fake cred in serialized DisposeAllOutcome", async () => {
    const reg = createRegistry(DB_ENV, makeFakeFactory().factory);
    await reg.acquire("pg_main");
    const out = await reg.disposeAll();
    const json = JSON.stringify(out);
    for (const cred of FAKE_CRED_SUBSTRINGS) expect(json).not.toContain(cred);
  });
});

// ============================================================================
// Suite 8 — determinism + parseJson round-trip + never-throws
// ============================================================================

describe("Suite 8 — determinism, parseJson round-trip, never-throws", () => {
  it("evaluate is byte-identical across two calls per evaluable case", () => {
    for (const c of evaluableCases) {
      const r1 = runPipelineCase(c).evaluateResult;
      const r2 = runPipelineCase(c).evaluateResult;
      if (!r1 || !r2) continue;
      expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
    }
  });

  it("every DbVerifyOutcome parseJson round-trips deep-equal", () => {
    for (const c of evaluableCases) {
      const r = runPipelineCase(c).evaluateResult;
      if (!r) continue;
      const round = parseJson(JSON.stringify(r));
      expect(round.ok, c.id).toBe(true);
      if (round.ok) expect(round.value).toEqual(r);
    }
  });

  it("evaluate never throws on adversarial cases (D-D, empty rows)", () => {
    expect(() =>
      evaluate({ rows: [{ id: 42 }], rowCount: 1, raw: null }, {
        connection: "pg_main", query: "SELECT id FROM t", expect: "match", fields: {},
      }),
    ).not.toThrow();
    expect(() =>
      evaluate({ rows: [], rowCount: 0, raw: null }, {
        connection: "pg_main", query: "SELECT 1", expect: "exists",
      }),
    ).not.toThrow();
  });

  it("expected counts derived from corpus filters, not hard-coded magic numbers", () => {
    expect(evaluableCases.length).toBeGreaterThan(0);
    expect(extractionFailCases.length).toBeGreaterThan(0);
    expect(ddMalformedCases.length).toBeGreaterThan(0);
  });

  it("every engine has ≥1 pass and ≥1 fail verify case", () => {
    for (const eng of ["postgres", "mysql", "mongodb", "neo4j"] as const) {
      const cases = byEngine(eng).filter((c) => c.verify !== undefined);
      expect(cases.filter((c) => c.verify?.pass === true).length, `${eng} pass`).toBeGreaterThan(0);
      expect(cases.filter((c) => c.verify?.pass === false).length, `${eng} fail`).toBeGreaterThan(0);
    }
  });
});
