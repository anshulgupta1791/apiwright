import { describe, it, expect } from "vitest";

import { bindPg } from "../../../../../src/db/templating/pg-binder.js";
import type { PgBoundQuery } from "../../../../../src/db/templating/engine-binding-types.js";
import type { NeutralQuery, BoundValue } from "../../../../../src/db/templating/types.js";
import { NEUTRAL_PLACEHOLDER_PREFIX } from "../../../../../src/db/templating/ref-extractor.js";

/**
 * Unit tests for bindPg (src/db/templating/pg-binder.ts).
 *
 * Covers: zero refs; single ref ($1 token, one values entry); two distinct
 * refs ($1/$2, two values); ref reused K times (one values entry, $1 at K
 * sites, values.length===refs.length); adjacent refs; D3 injection pin (value
 * never in text); null value; defensive count-mismatch → ok:false; no-throw
 * contract.
 *
 * RED PHASE: src/db/templating/pg-binder.ts does not exist yet.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const P = NEUTRAL_PLACEHOLDER_PREFIX;

function sentinel(i: number): string {
  return ` ${P}${i} `;
}

function makeNeutral(
  query: string,
  refCount: number,
  occurrenceRefIndices: number[],
): NeutralQuery {
  const refs = Array.from({ length: refCount }, (_, i) => ({
    index: i,
    path: `env.var${i}`,
    namespace: "env" as const,
  }));
  const occurrences = occurrenceRefIndices.map((ri) => ({ refIndex: ri }));
  return { neutralQuery: query, refs, occurrences };
}

function makeValues(values: unknown[]): readonly BoundValue[] {
  return values.map((v, i) => ({ index: i, value: v }));
}

function assertOkPg(result: ReturnType<typeof bindPg>): PgBoundQuery {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("Expected ok:true");
  expect(result.query.engine).toBe("postgres");
  return result.query.bound as PgBoundQuery;
}

// ---------------------------------------------------------------------------
// Zero refs
// ---------------------------------------------------------------------------

describe("bindPg", () => {
  describe("zero refs — query passthrough", () => {
    it("returns ok:true with text identical to the input when no sentinels", () => {
      const neutral = makeNeutral("SELECT 1", 0, []);
      const bound = assertOkPg(bindPg(neutral, []));
      expect(bound.text).toBe("SELECT 1");
    });

    it("returns empty values array when no refs", () => {
      const neutral = makeNeutral("SELECT 1", 0, []);
      const bound = assertOkPg(bindPg(neutral, []));
      expect(bound.values).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Single ref
  // ---------------------------------------------------------------------------

  describe("single ref — $1 placeholder", () => {
    it("rewrites the sentinel to $1", () => {
      const neutral = makeNeutral(`SELECT a FROM t WHERE x =${sentinel(0)}`, 1, [0]);
      const bound = assertOkPg(bindPg(neutral, makeValues(["alice"])));
      expect(bound.text).toContain("$1");
      expect(bound.text).not.toContain(P);
    });

    it("places the resolved value at values[0]", () => {
      const neutral = makeNeutral(`SELECT a FROM t WHERE x =${sentinel(0)}`, 1, [0]);
      const bound = assertOkPg(bindPg(neutral, makeValues(["alice"])));
      expect(bound.values[0]).toBe("alice");
      expect(bound.values).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Two distinct refs
  // ---------------------------------------------------------------------------

  describe("two distinct refs — $1 and $2", () => {
    it("rewrites ref 0 → $1 and ref 1 → $2", () => {
      const q = `SELECT a FROM t WHERE x =${sentinel(0)} AND y =${sentinel(1)}`;
      const neutral = makeNeutral(q, 2, [0, 1]);
      const bound = assertOkPg(bindPg(neutral, makeValues(["alice", "bob"])));
      expect(bound.text).toContain("$1");
      expect(bound.text).toContain("$2");
      expect(bound.text).not.toContain(P);
    });

    it("values = [v0, v1] in ref-index order, length 2", () => {
      const q = `SELECT a FROM t WHERE x =${sentinel(0)} AND y =${sentinel(1)}`;
      const neutral = makeNeutral(q, 2, [0, 1]);
      const bound = assertOkPg(bindPg(neutral, makeValues(["alice", "bob"])));
      expect(bound.values).toEqual(["alice", "bob"]);
      expect(bound.values).toHaveLength(2);
    });
  });

  // ---------------------------------------------------------------------------
  // Ref reused K times — critical pg rule: one values entry, $1 at every site
  // ---------------------------------------------------------------------------

  describe("ref reused at multiple sites — single values entry, $1 at every site", () => {
    it("produces $1 at both sites when ref 0 appears twice", () => {
      const q = `SELECT a FROM t WHERE x =${sentinel(0)} OR y =${sentinel(0)}`;
      // occurrences: two sites both pointing to ref index 0
      const neutral = {
        neutralQuery: q,
        refs: [{ index: 0, path: "env.x", namespace: "env" as const }],
        occurrences: [{ refIndex: 0 }, { refIndex: 0 }],
      };
      const bound = assertOkPg(bindPg(neutral, makeValues(["val"])));
      const occurrencesOf$1 = (bound.text.match(/\$1/g) ?? []).length;
      expect(occurrencesOf$1).toBe(2);
    });

    it("values.length === refs.length (1), NOT occurrences.length (2)", () => {
      const q = `SELECT a FROM t WHERE x =${sentinel(0)} OR y =${sentinel(0)}`;
      const neutral = {
        neutralQuery: q,
        refs: [{ index: 0, path: "env.x", namespace: "env" as const }],
        occurrences: [{ refIndex: 0 }, { refIndex: 0 }],
      };
      const bound = assertOkPg(bindPg(neutral, makeValues(["val"])));
      expect(bound.values).toHaveLength(1);
    });

    it("three refs x,y,x → text has $1 twice and $2 once, values.length===2", () => {
      const q = `a=${sentinel(0)} b=${sentinel(1)} c=${sentinel(0)}`;
      const neutral = {
        neutralQuery: q,
        refs: [
          { index: 0, path: "env.x", namespace: "env" as const },
          { index: 1, path: "env.y", namespace: "env" as const },
        ],
        occurrences: [{ refIndex: 0 }, { refIndex: 1 }, { refIndex: 0 }],
      };
      const bound = assertOkPg(bindPg(neutral, makeValues(["vx", "vy"])));
      expect((bound.text.match(/\$1/g) ?? []).length).toBe(2);
      expect((bound.text.match(/\$2/g) ?? []).length).toBe(1);
      expect(bound.values).toHaveLength(2);
      expect(bound.values).toEqual(["vx", "vy"]);
    });
  });

  // ---------------------------------------------------------------------------
  // Adjacent refs
  // ---------------------------------------------------------------------------

  describe("adjacent refs ${a}${b} — both rewritten, no delimiter loss", () => {
    it("produces $1$2 (or $1 $2) when sentinels are space-bounded back-to-back", () => {
      const q = `SELECT${sentinel(0)}${sentinel(1)}FROM t`;
      const neutral = makeNeutral(q, 2, [0, 1]);
      const bound = assertOkPg(bindPg(neutral, makeValues([1, 2])));
      expect(bound.text).toContain("$1");
      expect(bound.text).toContain("$2");
      expect(bound.text).not.toContain(P);
    });
  });

  // ---------------------------------------------------------------------------
  // D3 injection pin — resolved value must NEVER appear in text
  // ---------------------------------------------------------------------------

  describe("D3 structural pin — resolved value never appears in text", () => {
    it("SQL-injection value stays in values[], never in text", () => {
      const injection = "'; DROP TABLE users; --";
      const q = `SELECT a FROM t WHERE x =${sentinel(0)}`;
      const neutral = makeNeutral(q, 1, [0]);
      const bound = assertOkPg(bindPg(neutral, makeValues([injection])));
      expect(bound.text).not.toContain(injection);
      expect(bound.values[0]).toBe(injection);
    });

    it("numeric value stays in values[], not concatenated into text", () => {
      const q = `SELECT a FROM t WHERE id =${sentinel(0)}`;
      const neutral = makeNeutral(q, 1, [0]);
      const bound = assertOkPg(bindPg(neutral, makeValues([42])));
      // text should not contain the literal "42" from the value
      expect(bound.text).not.toMatch(/42/);
      expect(bound.values[0]).toBe(42);
    });
  });

  // ---------------------------------------------------------------------------
  // null value
  // ---------------------------------------------------------------------------

  describe("null value — passes through into values[] as null", () => {
    it("null value in values[0] is exactly null (driver binds SQL NULL)", () => {
      const q = `SELECT a FROM t WHERE x =${sentinel(0)}`;
      const neutral = makeNeutral(q, 1, [0]);
      const bound = assertOkPg(bindPg(neutral, makeValues([null])));
      expect(bound.values[0]).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Defensive contract violation — ok:false, DB_PARAM_NOT_BINDABLE, never throw
  // ---------------------------------------------------------------------------

  describe("defensive contract violation — ok:false, never throws", () => {
    it("returns ok:false when values.length < refs.length", () => {
      const neutral = makeNeutral(`SELECT x FROM t WHERE a =${sentinel(0)}`, 1, [0]);
      const result = bindPg(neutral, []);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("DB_PARAM_NOT_BINDABLE");
        expect(result.error.phase).toBe("bind");
      }
    });

    it("never throws even on maximally malformed NeutralQuery shape", () => {
      // Pass a string-shaped neutral to the PG binder — still returns BindResult
      const badNeutral = {
        neutralQuery: { broken: true },
        refs: [{ index: 0, path: "env.x", namespace: "env" as const }],
        occurrences: [{ refIndex: 0 }],
      } as NeutralQuery;
      expect(() => bindPg(badNeutral, makeValues(["v"]))).not.toThrow();
    });

    it("result.error.message is secret-free — does not echo the value", () => {
      const secretValue = "super-secret-pw";
      const neutral = makeNeutral(`SELECT x FROM t WHERE a =${sentinel(0)}`, 1, [0]);
      // Mismatch: 1 ref, 0 values → defensive error
      const result = bindPg(neutral, []);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).not.toContain(secretValue);
      }
    });
  });
});
