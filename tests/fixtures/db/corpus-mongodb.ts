/**
 * MongoDB corpus cases for the §5 DB pipeline integration test.
 *
 * Covers: exists/not_exists/match/exact (pass + fail), D3 injection payload
 * (value in a document VALUE leaf, NEVER a key), D4 no-coercion, and
 * key-never-touched binding assertion.
 *
 * Mongo queries are command objects (not strings). The binder substitutes
 * resolved values into VALUE leaves of the deep-cloned document; structure
 * and keys are never modified.
 *
 * Named export `MONGO_CASES: readonly DbPipelineCase[]`.
 */

import type { DbPipelineCase } from "./corpus-types.js";
import {
  makeResolution,
  makeMongoInjectionResolution,
  NATIVE_DATE,
  ISO_STRING_DATE,
  seam,
  MONGO_INJECTION_VALUE,
} from "./corpus-types.js";

/** mongo connection name from DB_ENV. */
const CONN = "mongo_main";

export const MONGO_CASES: readonly DbPipelineCase[] = [
  // ---- exists pass ----
  {
    id: "mongo.exists.pass",
    engine: "mongodb",
    connName: CONN,
    query: Object.freeze({ find: "users", filter: { id: "${request.body.id}" } }),
    resolution: makeResolution(),
    seamResult: seam([{ id: 42, name: "A" }]),
    binding: {
      engine: "mongodb",
      // Mongo has no text — assert the value lands in a document value leaf
      textIncludes: [],
      textExcludes: ["42", "acme"],
      // 1 distinct ref → 1 substitution in the document
      valueArity: 1,
    },
    expectMode: "exists",
    verify: { pass: true },
  },

  // ---- exists fail ----
  {
    id: "mongo.exists.fail",
    engine: "mongodb",
    connName: CONN,
    query: Object.freeze({ find: "users", filter: { id: "${request.body.id}" } }),
    resolution: makeResolution(),
    seamResult: seam([]),
    binding: {
      engine: "mongodb",
      textIncludes: [],
      textExcludes: ["42"],
      valueArity: 1,
    },
    expectMode: "exists",
    verify: { pass: false, failureCode: "DB_EXPECT_EXISTS_EMPTY" },
  },

  // ---- not_exists pass ----
  {
    id: "mongo.not-exists.pass",
    engine: "mongodb",
    connName: CONN,
    query: Object.freeze({ find: "deleted", filter: { id: "${request.body.id}" } }),
    resolution: makeResolution(),
    seamResult: seam([]),
    binding: {
      engine: "mongodb",
      textIncludes: [],
      textExcludes: ["42"],
      valueArity: 1,
    },
    expectMode: "not_exists",
    verify: { pass: true },
  },

  // ---- not_exists fail ----
  {
    id: "mongo.not-exists.fail",
    engine: "mongodb",
    connName: CONN,
    query: Object.freeze({ find: "users", filter: { id: "${request.body.id}" } }),
    resolution: makeResolution(),
    seamResult: seam([{ id: 42 }]),
    binding: {
      engine: "mongodb",
      textIncludes: [],
      textExcludes: ["42"],
      valueArity: 1,
    },
    expectMode: "not_exists",
    verify: { pass: false, failureCode: "DB_EXPECT_NOT_EXISTS_NONEMPTY" },
  },

  // ---- match pass ----
  {
    id: "mongo.match.pass",
    engine: "mongodb",
    connName: CONN,
    query: Object.freeze({ find: "users", filter: { id: "${request.body.id}" } }),
    resolution: makeResolution(),
    seamResult: seam([{ id: 42, name: "A", extra: "ignored" }]),
    binding: {
      engine: "mongodb",
      textIncludes: [],
      textExcludes: ["42"],
      valueArity: 1,
    },
    expectMode: "match",
    fields: { id: 42, name: "A" },
    verify: { pass: true },
  },

  // ---- match fail ----
  {
    id: "mongo.match.fail",
    engine: "mongodb",
    connName: CONN,
    query: Object.freeze({ find: "users", filter: { id: "${request.body.id}" } }),
    resolution: makeResolution(),
    seamResult: seam([{ id: 42 }]),
    binding: {
      engine: "mongodb",
      textIncludes: [],
      textExcludes: ["42"],
      valueArity: 1,
    },
    expectMode: "match",
    fields: { id: 42, name: "A" },
    verify: { pass: false, failureCode: "DB_EXPECT_NO_MATCHING_ROW" },
  },

  // ---- exact pass ----
  {
    id: "mongo.exact.pass",
    engine: "mongodb",
    connName: CONN,
    query: Object.freeze({ find: "users", filter: { id: "${request.body.id}" } }),
    resolution: makeResolution(),
    seamResult: seam([{ id: 42, name: "A" }]),
    binding: {
      engine: "mongodb",
      textIncludes: [],
      textExcludes: ["42"],
      valueArity: 1,
    },
    expectMode: "exact",
    fields: { id: 42, name: "A" },
    verify: { pass: true },
  },

  // ---- exact fail (extra key) ----
  {
    id: "mongo.exact.fail",
    engine: "mongodb",
    connName: CONN,
    query: Object.freeze({ find: "users", filter: { id: "${request.body.id}" } }),
    resolution: makeResolution(),
    seamResult: seam([{ id: 42, name: "A", surplus: "x" }]),
    binding: {
      engine: "mongodb",
      textIncludes: [],
      textExcludes: ["42"],
      valueArity: 1,
    },
    expectMode: "exact",
    fields: { id: 42, name: "A" },
    verify: { pass: false, failureCode: "DB_EXPECT_NO_MATCHING_ROW" },
  },

  // ---- D3 injection: Mongo injection payload is a value leaf, NEVER a key ----
  // The injection string is in requestBody.danger; the query refers to it via
  // ${request.body.danger}. After binding, the document VALUE contains the payload;
  // the document KEYS are never touched (the key is still "tag", not the payload).
  {
    id: "mongo.d3.injection-value-leaf",
    engine: "mongodb",
    connName: CONN,
    query: Object.freeze({ find: "users", filter: { tag: "${request.body.danger}" } }),
    resolution: makeMongoInjectionResolution(),
    seamResult: seam([]),
    binding: {
      engine: "mongodb",
      // No text to check for Mongo; textIncludes/Excludes apply to keys
      textIncludes: [],
      textExcludes: [MONGO_INJECTION_VALUE],
      valueArity: 1,
    },
    expectMode: "exists",
    verify: { pass: false, failureCode: "DB_EXPECT_EXISTS_EMPTY" },
  },

  // ---- D3 key-never-touched: structure/keys preserved, input not mutated ----
  {
    id: "mongo.d3.structure-preserved",
    engine: "mongodb",
    connName: CONN,
    query: Object.freeze({
      find: "users",
      filter: { id: "${request.body.id}", active: true },
    }),
    resolution: makeResolution(),
    seamResult: seam([{ id: 42, active: true }]),
    binding: {
      engine: "mongodb",
      // "filter", "id", "active" are keys — must be preserved, not injected into
      textIncludes: [],
      textExcludes: ["42", "acme"],
      valueArity: 1,
    },
    expectMode: "exists",
    verify: { pass: true },
  },

  // ---- D4 Date vs ISO string → FAIL ----
  {
    id: "mongo.d4.date-vs-iso",
    engine: "mongodb",
    connName: CONN,
    query: Object.freeze({ find: "events", filter: {} }),
    resolution: makeResolution(),
    seamResult: seam([{ created_at: NATIVE_DATE }]),
    binding: {
      engine: "mongodb",
      textIncludes: [],
      textExcludes: [],
      valueArity: 0,
    },
    expectMode: "match",
    fields: { created_at: ISO_STRING_DATE },
    verify: { pass: false, failureCode: "DB_EXPECT_NO_MATCHING_ROW" },
  },

  // ---- D4 null == null → PASS ----
  {
    id: "mongo.d4.null-vs-null",
    engine: "mongodb",
    connName: CONN,
    query: Object.freeze({ find: "t", filter: {} }),
    resolution: makeResolution(),
    seamResult: seam([{ flag: null }]),
    binding: {
      engine: "mongodb",
      textIncludes: [],
      textExcludes: [],
      valueArity: 0,
    },
    expectMode: "match",
    fields: { flag: null },
    verify: { pass: true },
  },

  // ---- Zero refs (no ${...} in document) ----
  {
    id: "mongo.zero-refs",
    engine: "mongodb",
    connName: CONN,
    query: Object.freeze({ find: "health", filter: {} }),
    resolution: makeResolution(),
    seamResult: seam([{ status: "ok" }]),
    binding: {
      engine: "mongodb",
      textIncludes: [],
      textExcludes: [],
      valueArity: 0,
    },
    expectMode: "exists",
    verify: { pass: true },
  },
];
