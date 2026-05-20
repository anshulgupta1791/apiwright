import { describe, it, expect } from "vitest";

import { bindNeo4j } from "../../../../../src/db/templating/neo4j-binder.js";
import type { Neo4jBoundQuery } from "../../../../../src/db/templating/engine-binding-types.js";
import type { NeutralQuery, BoundValue } from "../../../../../src/db/templating/types.js";
import { NEUTRAL_PLACEHOLDER_PREFIX } from "../../../../../src/db/templating/ref-extractor.js";

/**
 * Unit tests for bindNeo4j (src/db/templating/neo4j-binder.ts).
 *
 * Covers: zero refs; single ref ($p0, params={p0:v}); two distinct refs; ref
 * reused K times (one params entry, $p0 at K sites); collision avoidance —
 * query with $p0 → prefix escalates to _p; sentinel not matched as user $
 * token; full-ladder exhaustion → ok:false DB_PARAM_NOT_BINDABLE; D3 injection
 * pin; null value; defensive mismatch → ok:false; no-throw contract.
 *
 * RED PHASE: src/db/templating/neo4j-binder.ts does not exist yet.
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

function assertOkNeo4j(result: ReturnType<typeof bindNeo4j>): Neo4jBoundQuery {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`Expected ok:true, got error: ${result.error.message}`);
  expect(result.query.engine).toBe("neo4j");
  return result.query.bound as Neo4jBoundQuery;
}

// ---------------------------------------------------------------------------
// Zero refs
// ---------------------------------------------------------------------------

describe("bindNeo4j", () => {
  describe("zero refs — cypher passthrough, empty params", () => {
    it("returns ok:true with cypher identical to input when no sentinels", () => {
      const neutral: NeutralQuery = {
        neutralQuery: "MATCH (n) RETURN n",
        refs: [],
        occurrences: [],
      };
      const bound = assertOkNeo4j(bindNeo4j(neutral, []));
      expect(bound.cypher).toBe("MATCH (n) RETURN n");
    });

    it("returns empty params object when no refs", () => {
      const neutral: NeutralQuery = {
        neutralQuery: "MATCH (n) RETURN n",
        refs: [],
        occurrences: [],
      };
      const bound = assertOkNeo4j(bindNeo4j(neutral, []));
      expect(Object.keys(bound.params)).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Single ref — $p0 generated param
  // ---------------------------------------------------------------------------

  describe("single ref with no user $ tokens — generates $p0 and params.p0", () => {
    it("replaces the sentinel with $p0 in cypher", () => {
      const neutral: NeutralQuery = {
        neutralQuery: `MATCH (n) WHERE n.name =${sentinel(0)} RETURN n`,
        refs: [{ index: 0, path: "env.name", namespace: "env" }],
        occurrences: [{ refIndex: 0 }],
      };
      const bound = assertOkNeo4j(bindNeo4j(neutral, makeValues(["Alice"])));
      expect(bound.cypher).toContain("$p0");
      expect(bound.cypher).not.toContain(P);
    });

    it("params has key p0 with the resolved value", () => {
      const neutral: NeutralQuery = {
        neutralQuery: `MATCH (n) WHERE n.name =${sentinel(0)} RETURN n`,
        refs: [{ index: 0, path: "env.name", namespace: "env" }],
        occurrences: [{ refIndex: 0 }],
      };
      const bound = assertOkNeo4j(bindNeo4j(neutral, makeValues(["Alice"])));
      expect(bound.params["p0"]).toBe("Alice");
      expect(Object.keys(bound.params)).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Two distinct refs — $p0 and $p1
  // ---------------------------------------------------------------------------

  describe("two distinct refs — $p0 and $p1 with one params entry each", () => {
    it("replaces both sentinels with $p0 and $p1", () => {
      const neutral: NeutralQuery = {
        neutralQuery: `MATCH (n) WHERE n.a =${sentinel(0)} AND n.b =${sentinel(1)} RETURN n`,
        refs: [
          { index: 0, path: "env.a", namespace: "env" },
          { index: 1, path: "env.b", namespace: "env" },
        ],
        occurrences: [{ refIndex: 0 }, { refIndex: 1 }],
      };
      const bound = assertOkNeo4j(bindNeo4j(neutral, makeValues(["va", "vb"])));
      expect(bound.cypher).toContain("$p0");
      expect(bound.cypher).toContain("$p1");
      expect(bound.cypher).not.toContain(P);
    });

    it("params has exactly two entries: p0→va, p1→vb", () => {
      const neutral: NeutralQuery = {
        neutralQuery: `MATCH (n) WHERE n.a =${sentinel(0)} AND n.b =${sentinel(1)} RETURN n`,
        refs: [
          { index: 0, path: "env.a", namespace: "env" },
          { index: 1, path: "env.b", namespace: "env" },
        ],
        occurrences: [{ refIndex: 0 }, { refIndex: 1 }],
      };
      const bound = assertOkNeo4j(bindNeo4j(neutral, makeValues(["va", "vb"])));
      expect(bound.params["p0"]).toBe("va");
      expect(bound.params["p1"]).toBe("vb");
      expect(Object.keys(bound.params)).toHaveLength(2);
    });
  });

  // ---------------------------------------------------------------------------
  // Ref reused K times — single params entry, $p0 at every site
  // ---------------------------------------------------------------------------

  describe("ref reused at multiple sites — ONE params entry, $p0 at every site", () => {
    it("produces $p0 at both sites when ref 0 appears twice", () => {
      const q = `MATCH (n) WHERE n.a =${sentinel(0)} OR n.b =${sentinel(0)} RETURN n`;
      const neutral: NeutralQuery = {
        neutralQuery: q,
        refs: [{ index: 0, path: "env.x", namespace: "env" }],
        occurrences: [{ refIndex: 0 }, { refIndex: 0 }],
      };
      const bound = assertOkNeo4j(bindNeo4j(neutral, makeValues(["val"])));
      const occurrencesOfP0 = (bound.cypher.match(/\$p0/g) ?? []).length;
      expect(occurrencesOfP0).toBe(2);
    });

    it("params has exactly ONE entry (p0) — not one per occurrence", () => {
      const q = `MATCH (n) WHERE n.a =${sentinel(0)} OR n.b =${sentinel(0)} RETURN n`;
      const neutral: NeutralQuery = {
        neutralQuery: q,
        refs: [{ index: 0, path: "env.x", namespace: "env" }],
        occurrences: [{ refIndex: 0 }, { refIndex: 0 }],
      };
      const bound = assertOkNeo4j(bindNeo4j(neutral, makeValues(["val"])));
      expect(Object.keys(bound.params)).toHaveLength(1);
      expect(bound.params["p0"]).toBe("val");
    });
  });

  // ---------------------------------------------------------------------------
  // Collision avoidance — user $p0 in Cypher → prefix escalates to _p
  // ---------------------------------------------------------------------------

  describe("collision avoidance — user $p0 in Cypher escalates prefix to _p", () => {
    it("when user Cypher already has $p0, generated names use _p prefix", () => {
      // The Cypher has a user-written $p0 (a pre-existing param the QA uses)
      // plus a sentinel ref that must not collide with $p0
      const q = `MATCH (n) WHERE n.x = $p0 AND n.y =${sentinel(0)} RETURN n`;
      const neutral: NeutralQuery = {
        neutralQuery: q,
        refs: [{ index: 0, path: "env.y", namespace: "env" }],
        occurrences: [{ refIndex: 0 }],
      };
      const bound = assertOkNeo4j(bindNeo4j(neutral, makeValues(["vy"])));
      // Generated param must NOT be $p0 (that collides with user's $p0)
      expect(bound.cypher).not.toMatch(/\$p0.*\$p0/);
      // The generated name should use the next prefix (e.g. $_p0 or $p0 at a different position)
      // Key check: user's $p0 is still in cypher verbatim
      expect(bound.cypher).toContain("$p0");
      // Generated name uses _p prefix (escalated)
      expect(bound.cypher).toMatch(/\$_p0/);
    });

    it("params are keyed by the escalated prefix, not p0", () => {
      const q = `MATCH (n) WHERE n.x = $p0 AND n.y =${sentinel(0)} RETURN n`;
      const neutral: NeutralQuery = {
        neutralQuery: q,
        refs: [{ index: 0, path: "env.y", namespace: "env" }],
        occurrences: [{ refIndex: 0 }],
      };
      const bound = assertOkNeo4j(bindNeo4j(neutral, makeValues(["vy"])));
      // params should NOT have the key "p0" as a generated name (that's the user's)
      // the generated entry uses the escalated prefix
      expect(bound.params["_p0"]).toBe("vy");
    });

    it("user $p0 is left verbatim in cypher — not replaced or modified", () => {
      const q = `MATCH (n) WHERE n.x = $p0 AND n.y =${sentinel(0)} RETURN n`;
      const neutral: NeutralQuery = {
        neutralQuery: q,
        refs: [{ index: 0, path: "env.y", namespace: "env" }],
        occurrences: [{ refIndex: 0 }],
      };
      const bound = assertOkNeo4j(bindNeo4j(neutral, makeValues(["vy"])));
      // The user's $p0 must remain in cypher exactly once (as a user param, untouched)
      expect(bound.cypher).toContain("$p0");
    });
  });

  // ---------------------------------------------------------------------------
  // Sentinel not matched as user $ token — non-collision by construction
  // ---------------------------------------------------------------------------

  describe("sentinel never matched as user $ token — structural non-collision", () => {
    it("a query with both a sentinel and a user $x produces both in output correctly", () => {
      // $myParam is a user-written param; sentinel(0) is not a $-token
      const q = `MATCH (n) WHERE n.x = $myParam AND n.y =${sentinel(0)} RETURN n`;
      const neutral: NeutralQuery = {
        neutralQuery: q,
        refs: [{ index: 0, path: "env.y", namespace: "env" }],
        occurrences: [{ refIndex: 0 }],
      };
      const bound = assertOkNeo4j(bindNeo4j(neutral, makeValues(["vy"])));
      // User $myParam is untouched
      expect(bound.cypher).toContain("$myParam");
      // Sentinel replaced with a generated param (p0, since myParam ≠ p0)
      expect(bound.cypher).toContain("$p0");
      // Sentinel string itself is gone
      expect(bound.cypher).not.toContain(P);
    });
  });

  // ---------------------------------------------------------------------------
  // Full-ladder exhaustion → DB_PARAM_NOT_BINDABLE
  // ---------------------------------------------------------------------------

  describe("full prefix-ladder exhaustion → ok:false DB_PARAM_NOT_BINDABLE", () => {
    it("returns ok:false when all prefix candidates collide with user params", () => {
      // Build a Cypher that contains $p0, $_p0, $__p0, $___p0, ..., $apiwright_p0
      // so every prefix candidate for ref index 0 collides
      // The design prefix ladder: ["p", "_p", "__p", "___p", "apiwright_p"]
      const prefixes = ["p", "_p", "__p", "___p", "apiwright_p"];
      const userParams = prefixes.map((pfx) => `$${pfx}0`).join(" AND n.x = ");
      const q = `MATCH (n) WHERE n.x = ${userParams} AND n.y =${sentinel(0)} RETURN n`;
      const neutral: NeutralQuery = {
        neutralQuery: q,
        refs: [{ index: 0, path: "env.y", namespace: "env" }],
        occurrences: [{ refIndex: 0 }],
      };
      const result = bindNeo4j(neutral, makeValues(["vy"]));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("DB_PARAM_NOT_BINDABLE");
        expect(result.error.phase).toBe("bind");
        // Message must be secret-free (not echo a value)
        expect(result.error.message).not.toContain("vy");
      }
    });
  });

  // ---------------------------------------------------------------------------
  // D3 injection pin
  // ---------------------------------------------------------------------------

  describe("D3 structural pin — resolved value never appears in cypher", () => {
    it("Cypher-injection value stays in params, never in cypher text", () => {
      const injection = "'} DETACH DELETE n //";
      const neutral: NeutralQuery = {
        neutralQuery: `MATCH (n) WHERE n.x =${sentinel(0)} RETURN n`,
        refs: [{ index: 0, path: "env.x", namespace: "env" }],
        occurrences: [{ refIndex: 0 }],
      };
      const bound = assertOkNeo4j(bindNeo4j(neutral, makeValues([injection])));
      expect(bound.cypher).not.toContain(injection);
      expect(bound.params["p0"]).toBe(injection);
    });
  });

  // ---------------------------------------------------------------------------
  // null value
  // ---------------------------------------------------------------------------

  describe("null value — passes through into params as null", () => {
    it("null value in params[p0] is exactly null", () => {
      const neutral: NeutralQuery = {
        neutralQuery: `MATCH (n) WHERE n.x =${sentinel(0)} RETURN n`,
        refs: [{ index: 0, path: "env.x", namespace: "env" }],
        occurrences: [{ refIndex: 0 }],
      };
      const bound = assertOkNeo4j(bindNeo4j(neutral, makeValues([null])));
      expect(bound.params["p0"]).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Defensive contract violation
  // ---------------------------------------------------------------------------

  describe("defensive contract violation — ok:false, never throws", () => {
    it("returns ok:false when values.length < refs.length", () => {
      const neutral: NeutralQuery = {
        neutralQuery: `MATCH (n) WHERE n.x =${sentinel(0)} RETURN n`,
        refs: [{ index: 0, path: "env.x", namespace: "env" }],
        occurrences: [{ refIndex: 0 }],
      };
      const result = bindNeo4j(neutral, []);
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
      expect(() => bindNeo4j(badNeutral, makeValues(["v"]))).not.toThrow();
    });
  });
});
