/**
 * PostgreSQL corpus cases for the §5 DB pipeline integration test.
 * Covers: exists/not_exists/match/exact (pass+fail), D3 injection, D4 coercion,
 * reused-ref. Named export `PG_CASES: readonly DbPipelineCase[]`.
 */

import type { DbPipelineCase } from "./corpus-types.js";
import {
  makeResolution,
  makeInjectionResolution,
  NATIVE_DATE,
  ISO_STRING_DATE,
  seam,
  SQL_INJECTION,
} from "./corpus-types.js";

/** pg connection name from DB_ENV. */
const CONN = "pg_main";

export const PG_CASES: readonly DbPipelineCase[] = [
  // ---- exists pass ----
  {
    id: "pg.exists.pass",
    engine: "postgres",
    connName: CONN,
    query: "SELECT id FROM users WHERE id = ${request.body.id}",
    resolution: makeResolution(),
    seamResult: seam([{ id: 42 }]),
    binding: {
      engine: "postgres",
      textIncludes: ["$1"],
      textExcludes: ["42", "acme"],
      valueArity: 1,
    },
    expectMode: "exists",
    verify: { pass: true },
  },

  // ---- exists fail (empty rows) ----
  {
    id: "pg.exists.fail",
    engine: "postgres",
    connName: CONN,
    query: "SELECT id FROM users WHERE id = ${request.body.id}",
    resolution: makeResolution(),
    seamResult: seam([]),
    binding: {
      engine: "postgres",
      textIncludes: ["$1"],
      textExcludes: ["42"],
      valueArity: 1,
    },
    expectMode: "exists",
    verify: { pass: false, failureCode: "DB_EXPECT_EXISTS_EMPTY" },
  },

  // ---- not_exists pass ----
  {
    id: "pg.not-exists.pass",
    engine: "postgres",
    connName: CONN,
    query: "SELECT id FROM deleted WHERE id = ${request.body.id}",
    resolution: makeResolution(),
    seamResult: seam([]),
    binding: { engine: "postgres", textIncludes: ["$1"], textExcludes: ["42"], valueArity: 1 },
    expectMode: "not_exists",
    verify: { pass: true },
  },

  // ---- not_exists pass (DELETE shape: rows:[], rowCount:3) — rowCount NOT basis ----
  {
    id: "pg.not-exists.pass.delete-shape",
    engine: "postgres",
    connName: CONN,
    query: "DELETE FROM users WHERE active = false",
    resolution: makeResolution(),
    seamResult: seam([], 3),
    binding: {
      engine: "postgres",
      textIncludes: [],
      textExcludes: [],
      valueArity: 0,
    },
    expectMode: "not_exists",
    verify: { pass: true },
  },

  // ---- not_exists fail ----
  {
    id: "pg.not-exists.fail",
    engine: "postgres",
    connName: CONN,
    query: "SELECT id FROM users WHERE id = ${request.body.id}",
    resolution: makeResolution(),
    seamResult: seam([{ id: 42 }]),
    binding: { engine: "postgres", textIncludes: ["$1"], textExcludes: ["42"], valueArity: 1 },
    expectMode: "not_exists",
    verify: { pass: false, failureCode: "DB_EXPECT_NOT_EXISTS_NONEMPTY" },
  },

  // ---- match pass (extra keys ignored) ----
  {
    id: "pg.match.pass",
    engine: "postgres",
    connName: CONN,
    query: "SELECT id, name, role FROM users WHERE id = ${request.body.id}",
    resolution: makeResolution(),
    seamResult: seam([{ id: 42, name: "A", role: "admin", extra: "ignored" }]),
    binding: {
      engine: "postgres",
      textIncludes: ["$1"],
      textExcludes: ["42"],
      valueArity: 1,
    },
    expectMode: "match",
    fields: { id: 42, name: "A" },
    verify: { pass: true },
  },

  // ---- match fail (declared key absent on the only row — missing ≠ null) ----
  {
    id: "pg.match.fail.missing-key",
    engine: "postgres",
    connName: CONN,
    query: "SELECT id FROM users WHERE id = ${request.body.id}",
    resolution: makeResolution(),
    seamResult: seam([{ id: 42 }]),
    binding: {
      engine: "postgres",
      textIncludes: ["$1"],
      textExcludes: ["42"],
      valueArity: 1,
    },
    expectMode: "match",
    fields: { id: 42, name: "A" },
    verify: { pass: false, failureCode: "DB_EXPECT_NO_MATCHING_ROW" },
  },

  // ---- exact pass (key-exact + value-equal row; other non-matching rows ignored) ----
  {
    id: "pg.exact.pass",
    engine: "postgres",
    connName: CONN,
    query: "SELECT id, name FROM users WHERE id = ${request.body.id}",
    resolution: makeResolution(),
    // Two rows: first doesn't match (wrong name), second matches exactly
    seamResult: seam([{ id: 99, name: "X" }, { id: 42, name: "A" }]),
    binding: {
      engine: "postgres",
      textIncludes: ["$1"],
      textExcludes: ["42"],
      valueArity: 1,
    },
    expectMode: "exact",
    fields: { id: 42, name: "A" },
    verify: { pass: true },
  },

  // ---- exact fail (extra key in row) ----
  {
    id: "pg.exact.fail.extra-key",
    engine: "postgres",
    connName: CONN,
    query: "SELECT id, name, extra FROM users WHERE id = ${request.body.id}",
    resolution: makeResolution(),
    seamResult: seam([{ id: 42, name: "A", extra: "surplus" }]),
    binding: {
      engine: "postgres",
      textIncludes: ["$1"],
      textExcludes: ["42"],
      valueArity: 1,
    },
    expectMode: "exact",
    fields: { id: 42, name: "A" },
    verify: { pass: false, failureCode: "DB_EXPECT_NO_MATCHING_ROW" },
  },

  // ---- D3 injection: payload in values, NEVER in text ----
  {
    id: "pg.d3.injection",
    engine: "postgres",
    connName: CONN,
    query: "SELECT id FROM users WHERE tag = ${request.body.danger}",
    resolution: makeInjectionResolution(),
    seamResult: seam([]),
    binding: {
      engine: "postgres",
      textIncludes: ["$1"],
      textExcludes: [SQL_INJECTION, "DROP TABLE"],
      valueArity: 1,
    },
    expectMode: "exists",
    verify: { pass: false, failureCode: "DB_EXPECT_EXISTS_EMPTY" },
  },

  // ---- D3 reused-ref: ${a} ${b} ${a} → 2 distinct refs, 3 occurrences ----
  {
    id: "pg.d3.reused-ref",
    engine: "postgres",
    connName: CONN,
    query:
      "SELECT * FROM t WHERE x = ${request.body.id} AND y = ${env.tenant} AND z = ${request.body.id}",
    resolution: makeResolution(),
    seamResult: seam([{ x: 42 }]),
    binding: {
      engine: "postgres",
      textIncludes: ["$1", "$2"],
      textExcludes: ["42", "acme"],
      // 2 distinct refs → 2 values (pg deduplicates; third occurrence reuses $1)
      valueArity: 2,
    },
    expectMode: "exists",
    verify: { pass: true },
  },

  // ---- D4: "1" ≠ 1 → FAIL ----
  {
    id: "pg.d4.string-vs-number",
    engine: "postgres",
    connName: CONN,
    query: "SELECT id FROM t",
    resolution: makeResolution(),
    seamResult: seam([{ id: "1" }]),
    binding: {
      engine: "postgres",
      textIncludes: [],
      textExcludes: [],
      valueArity: 0,
    },
    expectMode: "match",
    fields: { id: 1 },
    verify: { pass: false, failureCode: "DB_EXPECT_NO_MATCHING_ROW" },
  },

  // ---- D4: Date ≠ ISO string → FAIL ----
  {
    id: "pg.d4.date-vs-iso",
    engine: "postgres",
    connName: CONN,
    query: "SELECT created_at FROM t",
    resolution: makeResolution(),
    seamResult: seam([{ created_at: NATIVE_DATE }]),
    binding: {
      engine: "postgres",
      textIncludes: [],
      textExcludes: [],
      valueArity: 0,
    },
    expectMode: "match",
    fields: { created_at: ISO_STRING_DATE },
    verify: { pass: false, failureCode: "DB_EXPECT_NO_MATCHING_ROW" },
  },

  // ---- D4: null == null → PASS ----
  {
    id: "pg.d4.null-vs-null",
    engine: "postgres",
    connName: CONN,
    query: "SELECT flag FROM t",
    resolution: makeResolution(),
    seamResult: seam([{ flag: null }]),
    binding: {
      engine: "postgres",
      textIncludes: [],
      textExcludes: [],
      valueArity: 0,
    },
    expectMode: "match",
    fields: { flag: null },
    verify: { pass: true },
  },

  // ---- Zero refs: query with no ${...} refs ----
  {
    id: "pg.zero-refs",
    engine: "postgres",
    connName: CONN,
    query: "SELECT 1 AS one",
    resolution: makeResolution(),
    seamResult: seam([{ one: 1 }]),
    binding: {
      engine: "postgres",
      textIncludes: [],
      textExcludes: [],
      valueArity: 0,
    },
    expectMode: "exists",
    verify: { pass: true },
  },
];
