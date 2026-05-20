import { describe, it, expect } from "vitest";

import {
  bindForEngine,
} from "../../../../../src/db/templating/engine-param-binder.js";
import type {
  BindResult,
  EngineBoundQuery,
  PgBoundQuery,
  MySqlBoundQuery,
  Neo4jBoundQuery,
  MongoBoundQuery,
} from "../../../../../src/db/templating/engine-binding-types.js";
import type { NeutralQuery, BoundValue } from "../../../../../src/db/templating/types.js";
import { NEUTRAL_PLACEHOLDER_PREFIX } from "../../../../../src/db/templating/ref-extractor.js";

/**
 * Unit tests for bindForEngine (src/db/templating/engine-param-binder.ts).
 *
 * Covers the exhaustive dispatcher: correct engine tag on success; routes to
 * the correct per-engine binder; determinism; zero-refs passthrough per engine.
 *
 * RED PHASE: src/db/templating/engine-param-binder.ts does not exist yet.
 * Tests fail with module-not-found until implementation-engineer creates it.
 */

// ---------------------------------------------------------------------------
// Helpers — build NeutralQuery / BoundValue fixtures from sentinels
// ---------------------------------------------------------------------------

const P = NEUTRAL_PLACEHOLDER_PREFIX; // e.g. "APIWRIGHT_PARAM_"

/** Build the sentinel token as the upstream extractor emits it: " PREFIX<i> " */
function sentinel(i: number): string {
  return ` ${P}${i} `;
}

function makeNeutralStr(query: string, refs: NeutralQuery["refs"],
  occurrences: NeutralQuery["occurrences"]): NeutralQuery {
  return { neutralQuery: query, refs, occurrences };
}

function makeNeutralObj(
  obj: Readonly<Record<string, unknown>> | readonly unknown[],
  refs: NeutralQuery["refs"],
  occurrences: NeutralQuery["occurrences"],
): NeutralQuery {
  return { neutralQuery: obj, refs, occurrences };
}

function makeRefs(count: number): NeutralQuery["refs"] {
  return Array.from({ length: count }, (_, i) => ({
    index: i,
    path: `env.var${i}`,
    namespace: "env" as const,
  }));
}

function makeValues(values: unknown[]): readonly BoundValue[] {
  return values.map((v, i) => ({ index: i, value: v }));
}

// ---------------------------------------------------------------------------
// Zero refs fixture
// ---------------------------------------------------------------------------

const ZERO_NEUTRAL_PG = makeNeutralStr("SELECT 1", [], []);
const ZERO_NEUTRAL_MONGO = makeNeutralObj({ find: "users" }, [], []);
const ZERO_VALUES: readonly BoundValue[] = [];

// ---------------------------------------------------------------------------
// Single-ref fixture (used across pg/mysql/neo4j)
// ---------------------------------------------------------------------------

const SINGLE_REF_NEUTRAL = makeNeutralStr(
  `SELECT a FROM t WHERE x =${sentinel(0)}`,
  makeRefs(1),
  [{ refIndex: 0 }],
);
const SINGLE_VALUES = makeValues(["hello"]);

// ---------------------------------------------------------------------------
// bindForEngine — dispatcher tests
// ---------------------------------------------------------------------------

describe("bindForEngine", () => {
  describe("postgres engine", () => {
    it("returns ok:true with engine:'postgres' tag", () => {
      const result = bindForEngine("postgres", SINGLE_REF_NEUTRAL, SINGLE_VALUES);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.query.engine).toBe("postgres");
      }
    });

    it("bound shape has text and values keys", () => {
      const result = bindForEngine("postgres", SINGLE_REF_NEUTRAL, SINGLE_VALUES);
      expect(result.ok).toBe(true);
      if (result.ok) {
        const bound = result.query.bound as PgBoundQuery;
        expect(typeof bound.text).toBe("string");
        expect(Array.isArray(bound.values)).toBe(true);
      }
    });

    it("zero refs: returns the neutral query unchanged, values empty", () => {
      const result = bindForEngine("postgres", ZERO_NEUTRAL_PG, ZERO_VALUES);
      expect(result.ok).toBe(true);
      if (result.ok) {
        const bound = result.query.bound as PgBoundQuery;
        expect(bound.text).toBe("SELECT 1");
        expect(bound.values).toHaveLength(0);
      }
    });

    it("produces the same result on two calls with the same inputs (determinism)", () => {
      const a = bindForEngine("postgres", SINGLE_REF_NEUTRAL, SINGLE_VALUES);
      const b = bindForEngine("postgres", SINGLE_REF_NEUTRAL, SINGLE_VALUES);
      expect(a).toEqual(b);
    });
  });

  describe("mysql engine", () => {
    it("returns ok:true with engine:'mysql' tag", () => {
      const result = bindForEngine("mysql", SINGLE_REF_NEUTRAL, SINGLE_VALUES);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.query.engine).toBe("mysql");
      }
    });

    it("bound shape has sql and values keys", () => {
      const result = bindForEngine("mysql", SINGLE_REF_NEUTRAL, SINGLE_VALUES);
      expect(result.ok).toBe(true);
      if (result.ok) {
        const bound = result.query.bound as MySqlBoundQuery;
        expect(typeof bound.sql).toBe("string");
        expect(Array.isArray(bound.values)).toBe(true);
      }
    });

    it("zero refs: returns the neutral query unchanged, values empty", () => {
      const result = bindForEngine("mysql", ZERO_NEUTRAL_PG, ZERO_VALUES);
      expect(result.ok).toBe(true);
      if (result.ok) {
        const bound = result.query.bound as MySqlBoundQuery;
        expect(bound.sql).toBe("SELECT 1");
        expect(bound.values).toHaveLength(0);
      }
    });
  });

  describe("neo4j engine", () => {
    it("returns ok:true with engine:'neo4j' tag", () => {
      const result = bindForEngine("neo4j", SINGLE_REF_NEUTRAL, SINGLE_VALUES);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.query.engine).toBe("neo4j");
      }
    });

    it("bound shape has cypher and params keys", () => {
      const result = bindForEngine("neo4j", SINGLE_REF_NEUTRAL, SINGLE_VALUES);
      expect(result.ok).toBe(true);
      if (result.ok) {
        const bound = result.query.bound as Neo4jBoundQuery;
        expect(typeof bound.cypher).toBe("string");
        expect(typeof bound.params).toBe("object");
      }
    });

    it("zero refs: returns the neutral query unchanged, params empty", () => {
      const result = bindForEngine("neo4j", ZERO_NEUTRAL_PG, ZERO_VALUES);
      expect(result.ok).toBe(true);
      if (result.ok) {
        const bound = result.query.bound as Neo4jBoundQuery;
        expect(bound.cypher).toBe("SELECT 1");
        expect(Object.keys(bound.params)).toHaveLength(0);
      }
    });
  });

  describe("mongodb engine", () => {
    it("returns ok:true with engine:'mongodb' tag", () => {
      const result = bindForEngine("mongodb", ZERO_NEUTRAL_MONGO, ZERO_VALUES);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.query.engine).toBe("mongodb");
      }
    });

    it("bound shape has document key", () => {
      const result = bindForEngine("mongodb", ZERO_NEUTRAL_MONGO, ZERO_VALUES);
      expect(result.ok).toBe(true);
      if (result.ok) {
        const bound = result.query.bound as MongoBoundQuery;
        expect(typeof bound.document).toBe("object");
      }
    });

    it("zero refs: returns a deep-clone of the neutral doc, structurally equal", () => {
      const result = bindForEngine("mongodb", ZERO_NEUTRAL_MONGO, ZERO_VALUES);
      expect(result.ok).toBe(true);
      if (result.ok) {
        const bound = result.query.bound as MongoBoundQuery;
        expect(bound.document).toEqual({ find: "users" });
      }
    });
  });

  describe("BindResult is ok:false on defensive contract violation", () => {
    it("returns ok:false (not throws) when values.length mismatches refs.length", () => {
      const badNeutral = makeNeutralStr(
        `SELECT x FROM t WHERE a =${sentinel(0)}`,
        makeRefs(1),
        [{ refIndex: 0 }],
      );
      // Provide 0 values for 1 ref — contract violation
      const result = bindForEngine("postgres", badNeutral, []);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("DB_PARAM_NOT_BINDABLE");
      }
    });
  });
});
