/**
 * Fixture-local types and builder helpers for the §5 DB pipeline corpus.
 *
 * Defines the closed `CaseEngine` type, `ExpectedBinding`, `ExpectedVerify`,
 * and `DbPipelineCase` record. Builder helpers keep per-engine corpus files
 * ≤100 col without boilerplate.
 *
 * These types are NOT exported from `src/`; they are purely test-fixture types.
 * Named exports only (`import/no-default-export`).
 */

import type {
  DbExpectFailureCode,
  DbEngine,
  RefRejectionCode,
  ResolutionContext,
} from "../../../src/db/index.js";
import type { DbExpectMode } from "../../../src/core/canonical-model.js";

/** Which synthetic DbConnector engine a case drives. */
export type CaseEngine = "postgres" | "mysql" | "mongodb" | "neo4j";

/**
 * Expected D3 binding shape, asserted on `bindForEngine` output.
 */
export interface ExpectedBinding {
  /** The engine-bound artifact discriminant. */
  readonly engine: CaseEngine;
  /**
   * Substrings that MUST appear in the bound query TEXT (pg `text` /
   * mysql `sql` / neo4j `cypher`) — placeholder tokens only (`$1`, `?`,
   * `$p0`), NEVER a resolved value. (Mongo has no text — assert the
   * resolved value lands in a document VALUE leaf instead.)
   */
  readonly textIncludes: readonly string[];
  /**
   * Substrings that MUST NOT appear ANYWHERE in the bound query text /
   * Mongo document KEYS — the D3 injection-payload value and any
   * resolved value. Asserted absent from text (and Mongo keys).
   */
  readonly textExcludes: readonly string[];
  /**
   * Expected count of bound values/params (pg/neo4j = #refs; mysql =
   * #occurrences) — DERIVED expectation, asserted, not magic.
   */
  readonly valueArity: number;
}

/** Expected `evaluate` verdict (mirrors DbVerifyOutcome discriminant). */
export interface ExpectedVerify {
  readonly pass: boolean;
  /** Present IFF pass===false (the GroupOutcome/DbVerifyOutcome IFF). */
  readonly failureCode?: DbExpectFailureCode;
}

/** Synthetic `NormalizedResult`-shaped seam result for a corpus case. */
export interface SeamResult {
  readonly rows: readonly Record<string, unknown>[];
  readonly rowCount: number;
  readonly raw: unknown;
}

/** One end-to-end §5 pipeline case. Frozen; pure data. */
export interface DbPipelineCase {
  /** Stable unique id, e.g. "pg.exists.pass" (test titles + dedupe). */
  readonly id: string;
  readonly engine: CaseEngine;
  /** A `databases` key from DB_ENV (or UNKNOWN_CONN for the negative case). */
  readonly connName: string;
  /** The QA-authored query (string for sql/cypher; object for Mongo). */
  readonly query: string | Readonly<Record<string, unknown>>;
  /** The synthetic ResolutionContext (env + request/response bodies). */
  readonly resolution: ResolutionContext;
  /** The synthetic NormalizedResult the fake `execute` returns for this case. */
  readonly seamResult: SeamResult;
  /** Whether extraction is expected to reject (D3 authoring fault). */
  readonly extractRejects?: { readonly code: RefRejectionCode };
  /** Expected binding shape (present IFF extraction succeeds + values resolve). */
  readonly binding?: ExpectedBinding;
  /** The verification declaration's expect mode. */
  readonly expectMode: DbExpectMode;
  /** Optional fields for match/exact modes. */
  readonly fields?: Readonly<Record<string, unknown>>;
  /** Expected `evaluate` verdict (present IFF the query path completes). */
  readonly verify?: ExpectedVerify;
}

// ---- Resolution context builders -------------------------------------------

/** The D3 SQL injection payload — asserted ABSENT from query text. */
export const SQL_INJECTION = "'; DROP TABLE users; --";
/** The D3 Cypher injection payload — asserted ABSENT from query text. */
export const CYPHER_INJECTION = "'} DETACH DELETE n //";
/** The D3 Mongo injection payload (as a string value, never a key). */
export const MONGO_INJECTION_VALUE = "'; db.dropDatabase(); //";

/** Standard synthetic resolution context (no injection payload). */
export function makeResolution(extra?: Partial<ResolutionContext>): ResolutionContext {
  return {
    env: { tenant: "acme", tag: "corpus" },
    requestBody: { id: 42, profile: { name: "A" }, value: 7 },
    responseBody: { created_at: "2024-05-18T00:00:00.000Z", flag: null },
    ...extra,
  };
}

/** Resolution context carrying the SQL injection payload as a request body value. */
export function makeInjectionResolution(): ResolutionContext {
  return {
    env: { tenant: "acme", tag: "corpus" },
    requestBody: { id: 42, danger: SQL_INJECTION, value: 7 },
    responseBody: { created_at: "2024-05-18T00:00:00.000Z" },
  };
}

/** Resolution context carrying the Cypher injection payload. */
export function makeCypherInjectionResolution(): ResolutionContext {
  return {
    env: { tenant: "acme", tag: "corpus" },
    requestBody: { id: 42, danger: CYPHER_INJECTION, value: 7 },
    responseBody: { created_at: "2024-05-18T00:00:00.000Z" },
  };
}

/** Resolution context carrying the Mongo injection payload. */
export function makeMongoInjectionResolution(): ResolutionContext {
  return {
    env: { tenant: "acme", tag: "corpus" },
    requestBody: { id: 42, danger: MONGO_INJECTION_VALUE, value: 7 },
    responseBody: { created_at: "2024-05-18T00:00:00.000Z" },
  };
}

/** D4: driver-native Date (not ISO string). */
export const NATIVE_DATE = new Date("2024-05-18T00:00:00.000Z");
/** D4: ISO string the QA would declare in fields. */
export const ISO_STRING_DATE = "2024-05-18T00:00:00.000Z";
/** D4: neo4j-Integer-shaped value. */
export const NEO4J_INTEGER_SHAPED = { low: 7, high: 0 };

/** Helper: build a frozen SeamResult. */
export function seam(
  rows: Record<string, unknown>[],
  rowCount?: number,
): SeamResult {
  return Object.freeze({
    rows: Object.freeze(rows.map((r) => Object.freeze({ ...r }))),
    rowCount: rowCount ?? rows.length,
    raw: Object.freeze({}),
  });
}

// Unused but kept for DbEngine re-export alignment:
export type { DbEngine };
