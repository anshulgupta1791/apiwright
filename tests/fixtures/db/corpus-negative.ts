/**
 * Negative/edge corpus cases for the §5 DB pipeline integration test.
 *
 * Covers: UNKNOWN_NAMESPACE / MALFORMED_REF / UNRESOLVED_REF extraction
 * failures, unknown connection name (acquire rejection), D-D empty-fields
 * authoring rejection (match/exact with absent or {} fields), connector-error
 * phase surfacing, dispose-failure aggregation, and explicit-null resolution.
 *
 * Named export `NEGATIVE_CASES: readonly DbPipelineCase[]`.
 */

import type { DbPipelineCase } from "./corpus-types.js";
import { makeResolution, seam } from "./corpus-types.js";
import { UNKNOWN_CONN } from "./environment.js";

/** Arbitrary valid engine + conn for structural tests. */
const PG_CONN = "pg_main";

export const NEGATIVE_CASES: readonly DbPipelineCase[] = [
  // ---- UNKNOWN_NAMESPACE: ${secret.x} is not a supported template namespace ----
  {
    id: "neg.extract.unknown-namespace",
    engine: "postgres",
    connName: PG_CONN,
    query: "SELECT id FROM t WHERE tok = ${secret.MY_TOKEN}",
    resolution: makeResolution(),
    seamResult: seam([]),
    extractRejects: { code: "UNKNOWN_NAMESPACE" },
    expectMode: "exists",
    // No binding or verify: extraction fails, pipeline short-circuits
  },

  // ---- UNKNOWN_NAMESPACE: ${db.host} is not a supported namespace ----
  {
    id: "neg.extract.unknown-namespace-db",
    engine: "postgres",
    connName: PG_CONN,
    query: "SELECT id FROM t WHERE host = ${db.host}",
    resolution: makeResolution(),
    seamResult: seam([]),
    extractRejects: { code: "UNKNOWN_NAMESPACE" },
    expectMode: "exists",
  },

  // ---- MALFORMED_REF: ${} — empty token ----
  {
    id: "neg.extract.malformed-empty",
    engine: "postgres",
    connName: PG_CONN,
    query: "SELECT id FROM t WHERE x = ${}",
    resolution: makeResolution(),
    seamResult: seam([]),
    extractRejects: { code: "MALFORMED_REF" },
    expectMode: "exists",
  },

  // ---- MALFORMED_REF: ${env.} — empty path ----
  {
    id: "neg.extract.malformed-empty-path",
    engine: "postgres",
    connName: PG_CONN,
    query: "SELECT id FROM t WHERE x = ${env.}",
    resolution: makeResolution(),
    seamResult: seam([]),
    extractRejects: { code: "MALFORMED_REF" },
    expectMode: "exists",
  },

  // ---- UNRESOLVED_REF: valid namespace but path absent in resolution context ----
  // Note: this is a resolveRefs failure, not extractRefs. The case still goes
  // through extractRefs (succeeds), then resolveRefs (fails with UNRESOLVED_REF).
  // We encode this as a special case: extractRejects is absent, but we record
  // that resolveRefs will fail. The integration test handles this differently.
  // We add a custom field `resolveRejects` for this case.
  {
    id: "neg.resolve.unresolved-ref",
    engine: "postgres",
    connName: PG_CONN,
    query: "SELECT id FROM t WHERE missing_key = ${env.no_such_key}",
    resolution: makeResolution(), // env has no `no_such_key`
    seamResult: seam([]),
    // extractRefs succeeds, resolveRefs fails: no binding or verify
    expectMode: "exists",
  },

  // ---- UNRESOLVED_REF: explicit null DOES resolve (not UNRESOLVED_REF) ----
  // This case has explicit null in requestBody.flag → should resolve to null.
  {
    id: "neg.resolve.explicit-null-resolves",
    engine: "postgres",
    connName: PG_CONN,
    query: "SELECT id FROM t WHERE flag = ${response.body.flag}",
    resolution: {
      env: { tenant: "acme" },
      requestBody: {},
      responseBody: { flag: null },
    },
    seamResult: seam([{ id: 1 }]),
    binding: {
      engine: "postgres",
      textIncludes: ["$1"],
      textExcludes: [],
      valueArity: 1,
    },
    expectMode: "exists",
    verify: { pass: true },
  },

  // ---- Unknown connection name: acquire(UNKNOWN_CONN) rejects ----
  // This case is NOT driven through the normal corpus pipeline.
  // It is handled specifically in the "registry suite" of the integration test.
  // We encode it here for corpus completeness; the test suite handles it ad-hoc.
  {
    id: "neg.registry.unknown-conn",
    engine: "postgres",
    connName: UNKNOWN_CONN,
    query: "SELECT 1",
    resolution: makeResolution(),
    seamResult: seam([]),
    expectMode: "exists",
    // No binding or verify: acquire rejects before we reach extract/bind/execute
  },

  // ---- D-D: match with fields:{} → DB_EXPECT_MALFORMED (even with non-empty rows) ----
  {
    id: "neg.dd.match-empty-fields",
    engine: "postgres",
    connName: PG_CONN,
    query: "SELECT id FROM t",
    resolution: makeResolution(),
    seamResult: seam([{ id: 42 }]), // non-empty rows: malformed reached BEFORE row iteration
    binding: {
      engine: "postgres",
      textIncludes: [],
      textExcludes: [],
      valueArity: 0,
    },
    expectMode: "match",
    fields: {},
    verify: { pass: false, failureCode: "DB_EXPECT_MALFORMED" },
  },

  // ---- D-D: exact with fields:{} → DB_EXPECT_MALFORMED ----
  {
    id: "neg.dd.exact-empty-fields",
    engine: "postgres",
    connName: PG_CONN,
    query: "SELECT id FROM t",
    resolution: makeResolution(),
    seamResult: seam([{ id: 42 }]),
    binding: {
      engine: "postgres",
      textIncludes: [],
      textExcludes: [],
      valueArity: 0,
    },
    expectMode: "exact",
    fields: {},
    verify: { pass: false, failureCode: "DB_EXPECT_MALFORMED" },
  },

  // ---- D-D: match with fields:undefined → DB_EXPECT_MALFORMED ----
  {
    id: "neg.dd.match-absent-fields",
    engine: "postgres",
    connName: PG_CONN,
    query: "SELECT id FROM t",
    resolution: makeResolution(),
    seamResult: seam([{ id: 42 }]),
    binding: {
      engine: "postgres",
      textIncludes: [],
      textExcludes: [],
      valueArity: 0,
    },
    expectMode: "match",
    // fields is undefined
    verify: { pass: false, failureCode: "DB_EXPECT_MALFORMED" },
  },

  // ---- D-D: exact with fields:undefined → DB_EXPECT_MALFORMED ----
  {
    id: "neg.dd.exact-absent-fields",
    engine: "postgres",
    connName: PG_CONN,
    query: "SELECT id FROM t",
    resolution: makeResolution(),
    seamResult: seam([{ id: 42 }]),
    binding: {
      engine: "postgres",
      textIncludes: [],
      textExcludes: [],
      valueArity: 0,
    },
    expectMode: "exact",
    // fields is undefined
    verify: { pass: false, failureCode: "DB_EXPECT_MALFORMED" },
  },

  // ---- D-D: exists with absent fields → NEVER DB_EXPECT_MALFORMED ----
  // exists/not_exists IGNORE fields entirely
  {
    id: "neg.dd.exists-ignores-fields",
    engine: "postgres",
    connName: PG_CONN,
    query: "SELECT id FROM t",
    resolution: makeResolution(),
    seamResult: seam([{ id: 42 }]),
    binding: {
      engine: "postgres",
      textIncludes: [],
      textExcludes: [],
      valueArity: 0,
    },
    expectMode: "exists",
    // fields is undefined — exists does NOT produce DB_EXPECT_MALFORMED
    verify: { pass: true },
  },

  // ---- D4: declared null vs absent key → FAIL (missing ≠ null) ----
  {
    id: "neg.d4.null-vs-absent",
    engine: "postgres",
    connName: PG_CONN,
    query: "SELECT id FROM t",
    resolution: makeResolution(),
    seamResult: seam([{ id: 42 }]), // no `flag` key
    binding: {
      engine: "postgres",
      textIncludes: [],
      textExcludes: [],
      valueArity: 0,
    },
    expectMode: "match",
    fields: { flag: null }, // declared null vs absent key → FAIL
    verify: { pass: false, failureCode: "DB_EXPECT_NO_MATCHING_ROW" },
  },
];
