import { describe, it, expect } from "vitest";

import { bindMySql } from "../../../../../src/db/templating/mysql-binder.js";
import type { MySqlBoundQuery } from "../../../../../src/db/templating/engine-binding-types.js";
import type { NeutralQuery, BoundValue } from "../../../../../src/db/templating/types.js";
import { NEUTRAL_PLACEHOLDER_PREFIX } from "../../../../../src/db/templating/ref-extractor.js";

/**
 * Unit tests for bindMySql (src/db/templating/mysql-binder.ts).
 *
 * Covers: zero refs; single ref (one ?); two distinct refs (two ?); the CRITICAL
 * mysql2 positional-repeat rule: ref reused K times → values has K entries in
 * textual order, values.length===occurrences.length (NOT refs.length); adjacent
 * refs; D3 injection pin (value never in sql); null value; defensive mismatch →
 * ok:false; no-throw contract.
 *
 * The mysql2 value-repeat rule is the single subtlest correctness point and is
 * pinned with multiple explicit assertions.
 *
 * RED PHASE: src/db/templating/mysql-binder.ts does not exist yet.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const P = NEUTRAL_PLACEHOLDER_PREFIX;

function sentinel(i: number): string {
  return ` ${P}${i} `;
}

function makeValues(values: unknown[]): readonly BoundValue[] {
  return values.map((v, i) => ({ index: i, value: v }));
}

function assertOkMySql(result: ReturnType<typeof bindMySql>): MySqlBoundQuery {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("Expected ok:true");
  expect(result.query.engine).toBe("mysql");
  return result.query.bound as MySqlBoundQuery;
}

// ---------------------------------------------------------------------------
// Zero refs
// ---------------------------------------------------------------------------

describe("bindMySql", () => {
  describe("zero refs — query passthrough", () => {
    it("returns ok:true with sql identical to the input when no sentinels", () => {
      const neutral: NeutralQuery = {
        neutralQuery: "SELECT 1",
        refs: [],
        occurrences: [],
      };
      const bound = assertOkMySql(bindMySql(neutral, []));
      expect(bound.sql).toBe("SELECT 1");
    });

    it("returns empty values array when no refs", () => {
      const neutral: NeutralQuery = {
        neutralQuery: "SELECT 1",
        refs: [],
        occurrences: [],
      };
      const bound = assertOkMySql(bindMySql(neutral, []));
      expect(bound.values).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Single ref — one ?
  // ---------------------------------------------------------------------------

  describe("single ref — one ? in sql", () => {
    it("replaces the sentinel with exactly one ?", () => {
      const neutral: NeutralQuery = {
        neutralQuery: `SELECT a FROM t WHERE x =${sentinel(0)}`,
        refs: [{ index: 0, path: "env.x", namespace: "env" }],
        occurrences: [{ refIndex: 0 }],
      };
      const bound = assertOkMySql(bindMySql(neutral, makeValues(["alice"])));
      expect(bound.sql).toContain("?");
      expect(bound.sql).not.toContain(P);
      // Exactly one ?
      expect((bound.sql.match(/\?/g) ?? []).length).toBe(1);
    });

    it("values has exactly one entry matching the resolved value", () => {
      const neutral: NeutralQuery = {
        neutralQuery: `SELECT a FROM t WHERE x =${sentinel(0)}`,
        refs: [{ index: 0, path: "env.x", namespace: "env" }],
        occurrences: [{ refIndex: 0 }],
      };
      const bound = assertOkMySql(bindMySql(neutral, makeValues(["alice"])));
      expect(bound.values).toHaveLength(1);
      expect(bound.values[0]).toBe("alice");
    });
  });

  // ---------------------------------------------------------------------------
  // Two distinct refs — two ? in textual order
  // ---------------------------------------------------------------------------

  describe("two distinct refs — two ? in left-to-right order", () => {
    it("replaces both sentinels with ? in order", () => {
      const neutral: NeutralQuery = {
        neutralQuery: `SELECT a FROM t WHERE x =${sentinel(0)} AND y =${sentinel(1)}`,
        refs: [
          { index: 0, path: "env.x", namespace: "env" },
          { index: 1, path: "env.y", namespace: "env" },
        ],
        occurrences: [{ refIndex: 0 }, { refIndex: 1 }],
      };
      const bound = assertOkMySql(bindMySql(neutral, makeValues(["vx", "vy"])));
      expect((bound.sql.match(/\?/g) ?? []).length).toBe(2);
      expect(bound.sql).not.toContain(P);
    });

    it("values = [v0, v1] in textual order, length 2", () => {
      const neutral: NeutralQuery = {
        neutralQuery: `SELECT a FROM t WHERE x =${sentinel(0)} AND y =${sentinel(1)}`,
        refs: [
          { index: 0, path: "env.x", namespace: "env" },
          { index: 1, path: "env.y", namespace: "env" },
        ],
        occurrences: [{ refIndex: 0 }, { refIndex: 1 }],
      };
      const bound = assertOkMySql(bindMySql(neutral, makeValues(["vx", "vy"])));
      expect(bound.values).toEqual(["vx", "vy"]);
    });
  });

  // ---------------------------------------------------------------------------
  // CRITICAL: ref reused K times — values has K entries in textual order
  // (mysql2 has no reuse semantics; value repeated once per occurrence)
  // ---------------------------------------------------------------------------

  describe("CRITICAL: ref reused — values repeated per occurrence in textual order", () => {
    it("${a} ${b} ${a}: sql has 3 ?, values=[v(a),v(b),v(a)] in textual order", () => {
      const q = `a=${sentinel(0)} b=${sentinel(1)} c=${sentinel(0)}`;
      const neutral: NeutralQuery = {
        neutralQuery: q,
        refs: [
          { index: 0, path: "env.a", namespace: "env" },
          { index: 1, path: "env.b", namespace: "env" },
        ],
        occurrences: [{ refIndex: 0 }, { refIndex: 1 }, { refIndex: 0 }],
      };
      const bound = assertOkMySql(bindMySql(neutral, makeValues(["va", "vb"])));
      expect((bound.sql.match(/\?/g) ?? []).length).toBe(3);
      expect(bound.values).toEqual(["va", "vb", "va"]);
    });

    it("values.length === occurrences.length (3), NOT refs.length (2)", () => {
      const q = `a=${sentinel(0)} b=${sentinel(1)} c=${sentinel(0)}`;
      const neutral: NeutralQuery = {
        neutralQuery: q,
        refs: [
          { index: 0, path: "env.a", namespace: "env" },
          { index: 1, path: "env.b", namespace: "env" },
        ],
        occurrences: [{ refIndex: 0 }, { refIndex: 1 }, { refIndex: 0 }],
      };
      const bound = assertOkMySql(bindMySql(neutral, makeValues(["va", "vb"])));
      expect(bound.values).toHaveLength(3);
      expect(bound.values).not.toHaveLength(2);
    });

    it("${x} ${x}: sql has 2 ?, values=[v(x),v(x)] — same value twice", () => {
      const q = `a=${sentinel(0)} b=${sentinel(0)}`;
      const neutral: NeutralQuery = {
        neutralQuery: q,
        refs: [{ index: 0, path: "env.x", namespace: "env" }],
        occurrences: [{ refIndex: 0 }, { refIndex: 0 }],
      };
      const bound = assertOkMySql(bindMySql(neutral, makeValues(["vx"])));
      expect((bound.sql.match(/\?/g) ?? []).length).toBe(2);
      expect(bound.values).toEqual(["vx", "vx"]);
      expect(bound.values).toHaveLength(2);
    });

    it("value ordering is textual left-to-right: [a,b,a] not [a,a,b]", () => {
      // This test pins the exact ordering — the single most error-prone mysql2 case
      const q = `first=${sentinel(0)} second=${sentinel(1)} third=${sentinel(0)}`;
      const neutral: NeutralQuery = {
        neutralQuery: q,
        refs: [
          { index: 0, path: "env.a", namespace: "env" },
          { index: 1, path: "env.b", namespace: "env" },
        ],
        occurrences: [{ refIndex: 0 }, { refIndex: 1 }, { refIndex: 0 }],
      };
      const bound = assertOkMySql(bindMySql(neutral, makeValues(["VA", "VB"])));
      // Must be [VA, VB, VA] — left-to-right textual order
      expect(bound.values[0]).toBe("VA");
      expect(bound.values[1]).toBe("VB");
      expect(bound.values[2]).toBe("VA");
    });
  });

  // ---------------------------------------------------------------------------
  // Adjacent refs
  // ---------------------------------------------------------------------------

  describe("adjacent refs — both rewritten, two ? produced", () => {
    it("two adjacent sentinels produce two ? with no delimiter loss", () => {
      const q = `SELECT${sentinel(0)}${sentinel(1)}FROM t`;
      const neutral: NeutralQuery = {
        neutralQuery: q,
        refs: [
          { index: 0, path: "env.a", namespace: "env" },
          { index: 1, path: "env.b", namespace: "env" },
        ],
        occurrences: [{ refIndex: 0 }, { refIndex: 1 }],
      };
      const bound = assertOkMySql(bindMySql(neutral, makeValues([1, 2])));
      expect((bound.sql.match(/\?/g) ?? []).length).toBe(2);
      expect(bound.sql).not.toContain(P);
    });
  });

  // ---------------------------------------------------------------------------
  // D3 injection pin
  // ---------------------------------------------------------------------------

  describe("D3 structural pin — resolved value never appears in sql", () => {
    it("SQL-injection value stays in values[], never in sql", () => {
      const injection = "'; DROP TABLE users; --";
      const neutral: NeutralQuery = {
        neutralQuery: `SELECT a FROM t WHERE x =${sentinel(0)}`,
        refs: [{ index: 0, path: "env.x", namespace: "env" }],
        occurrences: [{ refIndex: 0 }],
      };
      const bound = assertOkMySql(bindMySql(neutral, makeValues([injection])));
      expect(bound.sql).not.toContain(injection);
      expect(bound.values[0]).toBe(injection);
    });
  });

  // ---------------------------------------------------------------------------
  // null value
  // ---------------------------------------------------------------------------

  describe("null value — passes through into values[] as null", () => {
    it("null value in values[0] is exactly null", () => {
      const neutral: NeutralQuery = {
        neutralQuery: `SELECT a FROM t WHERE x =${sentinel(0)}`,
        refs: [{ index: 0, path: "env.x", namespace: "env" }],
        occurrences: [{ refIndex: 0 }],
      };
      const bound = assertOkMySql(bindMySql(neutral, makeValues([null])));
      expect(bound.values[0]).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Defensive contract violation
  // ---------------------------------------------------------------------------

  describe("defensive contract violation — ok:false, never throws", () => {
    it("returns ok:false (DB_PARAM_NOT_BINDABLE) when values.length < refs.length", () => {
      const neutral: NeutralQuery = {
        neutralQuery: `SELECT x FROM t WHERE a =${sentinel(0)}`,
        refs: [{ index: 0, path: "env.x", namespace: "env" }],
        occurrences: [{ refIndex: 0 }],
      };
      const result = bindMySql(neutral, []);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("DB_PARAM_NOT_BINDABLE");
        expect(result.error.phase).toBe("bind");
      }
    });

    it("never throws on malformed NeutralQuery", () => {
      const badNeutral = {
        neutralQuery: { broken: true },
        refs: [{ index: 0, path: "env.x", namespace: "env" as const }],
        occurrences: [{ refIndex: 0 }],
      } as NeutralQuery;
      expect(() => bindMySql(badNeutral, makeValues(["v"]))).not.toThrow();
    });
  });
});
