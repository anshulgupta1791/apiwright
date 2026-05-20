/**
 * Neo4j corpus cases for the §5 DB pipeline integration test.
 *
 * Covers: exists/not_exists/match/exact (pass + fail), D3 Cypher injection
 * payload (absent from cypher text, present in params), D4 no-coercion
 * including {low,high}-shaped neo4j Integer vs declared number, user-$token
 * collision-escalation (generated $pN vs user's $p0).
 *
 * Named export `NEO4J_CASES: readonly DbPipelineCase[]`.
 */

import type { DbPipelineCase } from "./corpus-types.js";
import {
  makeResolution,
  makeCypherInjectionResolution,
  seam,
  CYPHER_INJECTION,
  NEO4J_INTEGER_SHAPED,
} from "./corpus-types.js";

/** neo4j connection name from DB_ENV. */
const CONN = "neo4j_main";

export const NEO4J_CASES: readonly DbPipelineCase[] = [
  // ---- exists pass ----
  {
    id: "neo4j.exists.pass",
    engine: "neo4j",
    connName: CONN,
    query: "MATCH (u:User) WHERE u.id = ${request.body.id} RETURN u",
    resolution: makeResolution(),
    seamResult: seam([{ u: { id: 42 } }]),
    binding: {
      engine: "neo4j",
      // Neo4j uses generated $p0 named param
      textIncludes: ["$p0"],
      textExcludes: ["42", "acme"],
      valueArity: 1,
    },
    expectMode: "exists",
    verify: { pass: true },
  },

  // ---- exists fail ----
  {
    id: "neo4j.exists.fail",
    engine: "neo4j",
    connName: CONN,
    query: "MATCH (u:User) WHERE u.id = ${request.body.id} RETURN u",
    resolution: makeResolution(),
    seamResult: seam([]),
    binding: {
      engine: "neo4j",
      textIncludes: ["$p0"],
      textExcludes: ["42"],
      valueArity: 1,
    },
    expectMode: "exists",
    verify: { pass: false, failureCode: "DB_EXPECT_EXISTS_EMPTY" },
  },

  // ---- not_exists pass ----
  {
    id: "neo4j.not-exists.pass",
    engine: "neo4j",
    connName: CONN,
    query: "MATCH (u:Deleted) WHERE u.id = ${request.body.id} RETURN u",
    resolution: makeResolution(),
    seamResult: seam([]),
    binding: {
      engine: "neo4j",
      textIncludes: ["$p0"],
      textExcludes: ["42"],
      valueArity: 1,
    },
    expectMode: "not_exists",
    verify: { pass: true },
  },

  // ---- not_exists fail ----
  {
    id: "neo4j.not-exists.fail",
    engine: "neo4j",
    connName: CONN,
    query: "MATCH (u:User) WHERE u.id = ${request.body.id} RETURN u",
    resolution: makeResolution(),
    seamResult: seam([{ u: { id: 42 } }]),
    binding: {
      engine: "neo4j",
      textIncludes: ["$p0"],
      textExcludes: ["42"],
      valueArity: 1,
    },
    expectMode: "not_exists",
    verify: { pass: false, failureCode: "DB_EXPECT_NOT_EXISTS_NONEMPTY" },
  },

  // ---- match pass ----
  {
    id: "neo4j.match.pass",
    engine: "neo4j",
    connName: CONN,
    query: "MATCH (u:User) WHERE u.id = ${request.body.id} RETURN u.id AS id, u.name AS name",
    resolution: makeResolution(),
    seamResult: seam([{ id: 42, name: "A", extra: "ok" }]),
    binding: {
      engine: "neo4j",
      textIncludes: ["$p0"],
      textExcludes: ["42"],
      valueArity: 1,
    },
    expectMode: "match",
    fields: { id: 42, name: "A" },
    verify: { pass: true },
  },

  // ---- match fail ----
  {
    id: "neo4j.match.fail",
    engine: "neo4j",
    connName: CONN,
    query: "MATCH (u:User) WHERE u.id = ${request.body.id} RETURN u.id AS id",
    resolution: makeResolution(),
    seamResult: seam([{ id: 42 }]),
    binding: {
      engine: "neo4j",
      textIncludes: ["$p0"],
      textExcludes: ["42"],
      valueArity: 1,
    },
    expectMode: "match",
    fields: { id: 42, name: "A" },
    verify: { pass: false, failureCode: "DB_EXPECT_NO_MATCHING_ROW" },
  },

  // ---- exact pass ----
  {
    id: "neo4j.exact.pass",
    engine: "neo4j",
    connName: CONN,
    query: "MATCH (u:User) WHERE u.id = ${request.body.id} RETURN u.id AS id, u.name AS name",
    resolution: makeResolution(),
    seamResult: seam([{ id: 42, name: "A" }]),
    binding: {
      engine: "neo4j",
      textIncludes: ["$p0"],
      textExcludes: ["42"],
      valueArity: 1,
    },
    expectMode: "exact",
    fields: { id: 42, name: "A" },
    verify: { pass: true },
  },

  // ---- exact fail (extra key) ----
  {
    id: "neo4j.exact.fail",
    engine: "neo4j",
    connName: CONN,
    query: "MATCH (u:User) WHERE u.id = ${request.body.id} RETURN u.id AS id, u.name AS name",
    resolution: makeResolution(),
    seamResult: seam([{ id: 42, name: "A", surplus: "x" }]),
    binding: {
      engine: "neo4j",
      textIncludes: ["$p0"],
      textExcludes: ["42"],
      valueArity: 1,
    },
    expectMode: "exact",
    fields: { id: 42, name: "A" },
    verify: { pass: false, failureCode: "DB_EXPECT_NO_MATCHING_ROW" },
  },

  // ---- D3 Cypher injection: payload absent from cypher text, present in params ----
  {
    id: "neo4j.d3.injection",
    engine: "neo4j",
    connName: CONN,
    query: "MATCH (u:User) WHERE u.tag = ${request.body.danger} RETURN u",
    resolution: makeCypherInjectionResolution(),
    seamResult: seam([]),
    binding: {
      engine: "neo4j",
      textIncludes: ["$p0"],
      textExcludes: [CYPHER_INJECTION, "DETACH DELETE"],
      valueArity: 1,
    },
    expectMode: "exists",
    verify: { pass: false, failureCode: "DB_EXPECT_EXISTS_EMPTY" },
  },

  // ---- D3 user-$token collision-escalation: query has user $p0 → generated param escalates ----
  // When the Cypher query contains a user-authored $p0 token AND a ${...} ref,
  // the binder must not collide: it escalates to $_p0 or $p1 etc.
  {
    id: "neo4j.d3.token-collision",
    engine: "neo4j",
    connName: CONN,
    // Cypher contains a user-authored $p0 token
    query: "MATCH (u:User) WHERE u.score > $p0 AND u.id = ${request.body.id} RETURN u",
    resolution: makeResolution(),
    seamResult: seam([{ score: 10 }]),
    binding: {
      engine: "neo4j",
      // The user $p0 stays verbatim; the generated param for request.body.id
      // must be a DIFFERENT name (e.g. $_p0 or $p1)
      textIncludes: ["$p0"],
      textExcludes: ["42"],
      // 1 distinct ${...} ref → 1 param entry
      valueArity: 1,
    },
    expectMode: "exists",
    verify: { pass: true },
  },

  // ---- D4 {low,high} neo4j-Integer-shaped value vs declared number → FAIL ----
  {
    id: "neo4j.d4.integer-shaped-vs-number",
    engine: "neo4j",
    connName: CONN,
    query: "MATCH (u:User) RETURN u.count AS count",
    resolution: makeResolution(),
    seamResult: seam([{ count: NEO4J_INTEGER_SHAPED }]),
    binding: {
      engine: "neo4j",
      textIncludes: [],
      textExcludes: [],
      valueArity: 0,
    },
    expectMode: "match",
    fields: { count: 7 },
    verify: { pass: false, failureCode: "DB_EXPECT_NO_MATCHING_ROW" },
  },

  // ---- D4 null == null → PASS ----
  {
    id: "neo4j.d4.null-vs-null",
    engine: "neo4j",
    connName: CONN,
    query: "MATCH (u:User) RETURN u.flag AS flag",
    resolution: makeResolution(),
    seamResult: seam([{ flag: null }]),
    binding: {
      engine: "neo4j",
      textIncludes: [],
      textExcludes: [],
      valueArity: 0,
    },
    expectMode: "match",
    fields: { flag: null },
    verify: { pass: true },
  },

  // ---- Zero refs ----
  {
    id: "neo4j.zero-refs",
    engine: "neo4j",
    connName: CONN,
    query: "RETURN 1 AS one",
    resolution: makeResolution(),
    seamResult: seam([{ one: 1 }]),
    binding: {
      engine: "neo4j",
      textIncludes: [],
      textExcludes: [],
      valueArity: 0,
    },
    expectMode: "exists",
    verify: { pass: true },
  },
];
