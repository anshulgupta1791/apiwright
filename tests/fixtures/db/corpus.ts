/**
 * DB pipeline corpus index — the single entry point for all §5 corpus cases.
 *
 * Re-exports fixture-local types from `corpus-types.ts` and concatenates
 * the per-engine + negative arrays into `DB_CORPUS`. Also exports derived
 * helpers (`byEngine`, `injectionCases`, `observedFailureCodes`,
 * `negativeByCode`) so the integration test can compute counts at runtime
 * rather than using hard-coded magic numbers.
 *
 * Named exports only; no default export.
 */

import type { CaseEngine, DbPipelineCase } from "./corpus-types.js";
import type { DbExpectFailureCode, RefRejectionCode } from "../../../src/db/index.js";

import { PG_CASES } from "./corpus-postgres.js";
import { MYSQL_CASES } from "./corpus-mysql.js";
import { MONGO_CASES } from "./corpus-mongodb.js";
import { NEO4J_CASES } from "./corpus-neo4j.js";
import { NEGATIVE_CASES } from "./corpus-negative.js";

export type {
  CaseEngine,
  ExpectedBinding,
  ExpectedVerify,
  DbPipelineCase,
  SeamResult,
} from "./corpus-types.js";
export {
  SQL_INJECTION,
  CYPHER_INJECTION,
  MONGO_INJECTION_VALUE,
  NATIVE_DATE,
  ISO_STRING_DATE,
  NEO4J_INTEGER_SHAPED,
  makeResolution,
  makeInjectionResolution,
  makeCypherInjectionResolution,
  makeMongoInjectionResolution,
  seam,
} from "./corpus-types.js";

/**
 * The full DB pipeline corpus — all engines, all expect modes, all edge cases.
 * PASS + FAIL + D3 + D4 + D-D + negative in a deterministic, static order.
 * The integration test iterates this as the single source of truth.
 */
export const DB_CORPUS: readonly DbPipelineCase[] = [
  ...PG_CASES,
  ...MYSQL_CASES,
  ...MONGO_CASES,
  ...NEO4J_CASES,
  ...NEGATIVE_CASES,
];

// ---- Derived helpers (runtime counts — NO magic numbers) -------------------

/** Filter corpus by engine. */
export function byEngine(engine: CaseEngine): readonly DbPipelineCase[] {
  return DB_CORPUS.filter((c) => c.engine === engine);
}

/**
 * All cases that have a `binding` (extraction succeeds and values resolve).
 * These are the cases where `bindForEngine` is asserted.
 */
export const bindableCases: readonly DbPipelineCase[] = DB_CORPUS.filter(
  (c) => c.binding !== undefined && c.extractRejects === undefined,
);

/**
 * All cases where `extractRefs` is expected to return ok:false
 * (unknown namespace or malformed ref).
 */
export const extractionFailCases: readonly DbPipelineCase[] = DB_CORPUS.filter(
  (c) => c.extractRejects !== undefined,
);

/**
 * All cases that have an expected `verify` outcome (evaluation is asserted).
 * These are cases where the full pipeline through `evaluate` is asserted.
 */
export const evaluableCases: readonly DbPipelineCase[] = DB_CORPUS.filter(
  (c) => c.verify !== undefined,
);

/**
 * All cases that carry a D3 injection payload (the injection-payload value
 * must be absent from the bound query text / Mongo keys).
 */
export const injectionCases: readonly DbPipelineCase[] = DB_CORPUS.filter(
  (c) =>
    c.binding !== undefined &&
    (c.binding.textExcludes.some(
      (ex) => ex.includes("DROP TABLE") || ex.includes("DETACH DELETE") || ex.length > 5,
    )),
);

/**
 * The set of `DbExpectFailureCode`s expected to appear across the corpus.
 * Used by the integration test to assert all four codes appear.
 */
export function observedFailureCodes(): ReadonlySet<DbExpectFailureCode> {
  const codes = new Set<DbExpectFailureCode>();
  for (const c of evaluableCases) {
    if (c.verify?.failureCode !== undefined) {
      codes.add(c.verify.failureCode);
    }
  }
  return codes;
}

/**
 * Filter negative cases by the RefRejectionCode they expect.
 */
export function negativeByCode(code: RefRejectionCode): readonly DbPipelineCase[] {
  return NEGATIVE_CASES.filter((c) => c.extractRejects?.code === code);
}

/**
 * All cases that carry a `resolveRefs` failure (UNRESOLVED_REF path)
 * but NOT an `extractRefs` failure. These are identified by the specific id.
 */
export const unresolvedRefCases: readonly DbPipelineCase[] = DB_CORPUS.filter(
  (c) => c.id === "neg.resolve.unresolved-ref",
);

/**
 * All D-D cases: match/exact with absent or empty fields producing DB_EXPECT_MALFORMED.
 */
export const ddMalformedCases: readonly DbPipelineCase[] = DB_CORPUS.filter(
  (c) => c.verify?.failureCode === "DB_EXPECT_MALFORMED",
);
