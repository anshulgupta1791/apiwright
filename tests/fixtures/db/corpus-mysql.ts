/**
 * MySQL corpus cases for the §5 DB pipeline integration test.
 *
 * Covers: exists/not_exists/match/exact (pass + fail), D3 injection payload,
 * D4 no-coercion, and the CRITICAL ordered-reuse case where ${a} ${b} ${a}
 * produces values [v(a), v(b), v(a)] (mysql2 repeats per occurrence, NOT per
 * distinct ref) — the most error-prone mysql2 binding case.
 *
 * Named export `MYSQL_CASES: readonly DbPipelineCase[]`.
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

/** mysql connection name from DB_ENV. */
const CONN = "mysql_main";

export const MYSQL_CASES: readonly DbPipelineCase[] = [
  // ---- exists pass ----
  {
    id: "mysql.exists.pass",
    engine: "mysql",
    connName: CONN,
    query: "SELECT id FROM users WHERE id = ${request.body.id}",
    resolution: makeResolution(),
    seamResult: seam([{ id: 42 }]),
    binding: {
      engine: "mysql",
      textIncludes: ["?"],
      textExcludes: ["42", "acme"],
      valueArity: 1,
    },
    expectMode: "exists",
    verify: { pass: true },
  },

  // ---- exists fail (empty rows) ----
  {
    id: "mysql.exists.fail",
    engine: "mysql",
    connName: CONN,
    query: "SELECT id FROM users WHERE id = ${request.body.id}",
    resolution: makeResolution(),
    seamResult: seam([]),
    binding: {
      engine: "mysql",
      textIncludes: ["?"],
      textExcludes: ["42"],
      valueArity: 1,
    },
    expectMode: "exists",
    verify: { pass: false, failureCode: "DB_EXPECT_EXISTS_EMPTY" },
  },

  // ---- not_exists pass ----
  {
    id: "mysql.not-exists.pass",
    engine: "mysql",
    connName: CONN,
    query: "SELECT id FROM deleted WHERE id = ${request.body.id}",
    resolution: makeResolution(),
    seamResult: seam([]),
    binding: {
      engine: "mysql",
      textIncludes: ["?"],
      textExcludes: ["42"],
      valueArity: 1,
    },
    expectMode: "not_exists",
    verify: { pass: true },
  },

  // ---- not_exists fail ----
  {
    id: "mysql.not-exists.fail",
    engine: "mysql",
    connName: CONN,
    query: "SELECT id FROM users WHERE id = ${request.body.id}",
    resolution: makeResolution(),
    seamResult: seam([{ id: 42 }]),
    binding: {
      engine: "mysql",
      textIncludes: ["?"],
      textExcludes: ["42"],
      valueArity: 1,
    },
    expectMode: "not_exists",
    verify: { pass: false, failureCode: "DB_EXPECT_NOT_EXISTS_NONEMPTY" },
  },

  // ---- match pass ----
  {
    id: "mysql.match.pass",
    engine: "mysql",
    connName: CONN,
    query: "SELECT id, name FROM users WHERE id = ${request.body.id}",
    resolution: makeResolution(),
    seamResult: seam([{ id: 42, name: "A", extra: "ok" }]),
    binding: {
      engine: "mysql",
      textIncludes: ["?"],
      textExcludes: ["42"],
      valueArity: 1,
    },
    expectMode: "match",
    fields: { id: 42, name: "A" },
    verify: { pass: true },
  },

  // ---- match fail ----
  {
    id: "mysql.match.fail",
    engine: "mysql",
    connName: CONN,
    query: "SELECT id FROM users WHERE id = ${request.body.id}",
    resolution: makeResolution(),
    seamResult: seam([{ id: 42 }]),
    binding: {
      engine: "mysql",
      textIncludes: ["?"],
      textExcludes: ["42"],
      valueArity: 1,
    },
    expectMode: "match",
    fields: { id: 42, name: "A" },
    verify: { pass: false, failureCode: "DB_EXPECT_NO_MATCHING_ROW" },
  },

  // ---- exact pass ----
  {
    id: "mysql.exact.pass",
    engine: "mysql",
    connName: CONN,
    query: "SELECT id, name FROM users WHERE id = ${request.body.id}",
    resolution: makeResolution(),
    seamResult: seam([{ id: 42, name: "A" }]),
    binding: {
      engine: "mysql",
      textIncludes: ["?"],
      textExcludes: ["42"],
      valueArity: 1,
    },
    expectMode: "exact",
    fields: { id: 42, name: "A" },
    verify: { pass: true },
  },

  // ---- exact fail (extra key in row) ----
  {
    id: "mysql.exact.fail",
    engine: "mysql",
    connName: CONN,
    query: "SELECT id, name, surplus FROM users WHERE id = ${request.body.id}",
    resolution: makeResolution(),
    seamResult: seam([{ id: 42, name: "A", surplus: "x" }]),
    binding: {
      engine: "mysql",
      textIncludes: ["?"],
      textExcludes: ["42"],
      valueArity: 1,
    },
    expectMode: "exact",
    fields: { id: 42, name: "A" },
    verify: { pass: false, failureCode: "DB_EXPECT_NO_MATCHING_ROW" },
  },

  // ---- D3 ordered-reuse: ${a} ${b} ${a} → values [v(a), v(b), v(a)] ----
  // mysql2 repeats the value per occurrence, not per distinct ref.
  // 2 distinct refs but 3 occurrences → valueArity = 3.
  {
    id: "mysql.d3.ordered-reuse",
    engine: "mysql",
    connName: CONN,
    query:
      "SELECT * FROM t WHERE x = ${request.body.id} AND y = ${env.tenant} AND z = ${request.body.id}",
    resolution: makeResolution(),
    seamResult: seam([{ x: 42 }]),
    binding: {
      engine: "mysql",
      // mysql2: one ? per occurrence, values repeated
      textIncludes: ["?"],
      textExcludes: ["42", "acme"],
      // 3 occurrences (request.body.id appears twice, env.tenant once) → 3 values
      valueArity: 3,
    },
    expectMode: "exists",
    verify: { pass: true },
  },

  // ---- D3 injection: SQL payload must be in values, NOT sql string ----
  {
    id: "mysql.d3.injection",
    engine: "mysql",
    connName: CONN,
    query: "SELECT id FROM users WHERE tag = ${request.body.danger}",
    resolution: makeInjectionResolution(),
    seamResult: seam([]),
    binding: {
      engine: "mysql",
      textIncludes: ["?"],
      textExcludes: [SQL_INJECTION, "DROP TABLE"],
      valueArity: 1,
    },
    expectMode: "exists",
    verify: { pass: false, failureCode: "DB_EXPECT_EXISTS_EMPTY" },
  },

  // ---- D4 string vs number → FAIL ----
  {
    id: "mysql.d4.string-vs-number",
    engine: "mysql",
    connName: CONN,
    query: "SELECT id FROM t",
    resolution: makeResolution(),
    seamResult: seam([{ id: "1" }]),
    binding: {
      engine: "mysql",
      textIncludes: [],
      textExcludes: [],
      valueArity: 0,
    },
    expectMode: "match",
    fields: { id: 1 },
    verify: { pass: false, failureCode: "DB_EXPECT_NO_MATCHING_ROW" },
  },

  // ---- D4 Date vs ISO string → FAIL ----
  {
    id: "mysql.d4.date-vs-iso",
    engine: "mysql",
    connName: CONN,
    query: "SELECT created_at FROM t",
    resolution: makeResolution(),
    seamResult: seam([{ created_at: NATIVE_DATE }]),
    binding: {
      engine: "mysql",
      textIncludes: [],
      textExcludes: [],
      valueArity: 0,
    },
    expectMode: "match",
    fields: { created_at: ISO_STRING_DATE },
    verify: { pass: false, failureCode: "DB_EXPECT_NO_MATCHING_ROW" },
  },

  // ---- Zero refs ----
  {
    id: "mysql.zero-refs",
    engine: "mysql",
    connName: CONN,
    query: "SELECT 1 AS one",
    resolution: makeResolution(),
    seamResult: seam([{ one: 1 }]),
    binding: {
      engine: "mysql",
      textIncludes: [],
      textExcludes: [],
      valueArity: 0,
    },
    expectMode: "exists",
    verify: { pass: true },
  },
];
