/**
 * Fixture-local helper: runs one `DbPipelineCase` through the full §5 public
 * pipeline and returns the produced artifacts for assertion.
 *
 * Used by `tests/integration/db/db-connector-layer.test.ts` to keep that file
 * ≤300 lines (the §4 Layer-E split trigger). Imports ONLY `src/db/index.js`
 * and the fixture modules — no deep `src/db/**` path.
 *
 * Named exports only; no default export.
 */

import {
  extractRefs,
  resolveRefs,
  bindForEngine,
  evaluate,
} from "../../../src/db/index.js";
import type {
  ExtractResult,
  ResolveResult,
  BindResult,
  DbVerifyOutcome,
  NormalizedResult,
  PgBoundQuery,
  MySqlBoundQuery,
  Neo4jBoundQuery,
  MongoBoundQuery,
} from "../../../src/db/index.js";

import type { DbPipelineCase, ExpectedBinding } from "./corpus-types.js";

/** The collected output of running one case through the pipeline. */
export interface PipelineRun {
  /** The case id. */
  readonly id: string;
  /** Result of extractRefs. */
  readonly extractResult: ExtractResult;
  /** Result of resolveRefs (absent if extractResult.ok === false). */
  readonly resolveResult?: ResolveResult;
  /** Result of bindForEngine (absent if resolveResult?.ok === false). */
  readonly bindResult?: BindResult;
  /** NormalizedResult used for evaluate (the case seamResult). */
  readonly seamResult: NormalizedResult;
  /** Result of evaluate (absent if bindResult?.ok === false). */
  readonly evaluateResult?: DbVerifyOutcome;
}

/**
 * Runs one corpus case through the complete public §5 pipeline.
 * Never throws — all §5 functions are total or return structured outcomes.
 * @param c - One `DbPipelineCase` from the corpus.
 * @returns The collected `PipelineRun` with all intermediate results.
 */
export function runPipelineCase(c: DbPipelineCase): PipelineRun {
  const seamResult: NormalizedResult = {
    rows: [...c.seamResult.rows] as Record<string, unknown>[],
    rowCount: c.seamResult.rowCount,
    raw: c.seamResult.raw,
  };

  const extractResult = extractRefs(c.query);
  if (!extractResult.ok) {
    return { id: c.id, extractResult, seamResult };
  }

  const resolveResult = resolveRefs(extractResult.neutral.refs, c.resolution);
  if (!resolveResult.ok) {
    return { id: c.id, extractResult, resolveResult, seamResult };
  }

  const bindResult = bindForEngine(c.engine, extractResult.neutral, resolveResult.values);
  if (!bindResult.ok) {
    return { id: c.id, extractResult, resolveResult, bindResult, seamResult };
  }

  const verification = {
    connection: c.connName,
    query: typeof c.query === "string" ? c.query : JSON.stringify(c.query),
    expect: c.expectMode,
    fields: c.fields,
  };
  const evaluateResult = evaluate(seamResult, verification);
  return { id: c.id, extractResult, resolveResult, bindResult, seamResult, evaluateResult };
}

// ---------------------------------------------------------------------------
// Per-engine binding shape assertion helpers (reduce complexity)
// ---------------------------------------------------------------------------

/**
 * Asserts postgres binding shape (text includes/excludes + value arity).
 * @param id - The corpus case id (for error messages).
 * @param bound - The narrowed {@link PgBoundQuery} to assert.
 * @param binding - The binding expectations from the corpus case.
 * @throws {Error} When an inclusion is missing, an exclusion is present, or
 *   the value arity is wrong.
 */
function assertPgShape(id: string, bound: PgBoundQuery, binding: ExpectedBinding): void {
  for (const incl of binding.textIncludes) {
    if (!bound.text.includes(incl)) {
      throw new Error(`[${id}] pg text missing "${incl}" in: ${bound.text}`);
    }
  }
  for (const excl of binding.textExcludes) {
    if (bound.text.includes(excl)) {
      throw new Error(`[${id}] pg text must not contain "${excl}"`);
    }
  }
  if (bound.values.length !== binding.valueArity) {
    throw new Error(
      `[${id}] pg valueArity: expected ${binding.valueArity}, got ${bound.values.length}`,
    );
  }
}

/**
 * Asserts mysql binding shape (sql includes/excludes + value arity).
 * @param id - The corpus case id (for error messages).
 * @param bound - The narrowed {@link MySqlBoundQuery} to assert.
 * @param binding - The binding expectations from the corpus case.
 * @throws {Error} When an inclusion is missing, an exclusion is present, or
 *   the value arity is wrong.
 */
function assertMySqlShape(
  id: string,
  bound: MySqlBoundQuery,
  binding: ExpectedBinding,
): void {
  for (const incl of binding.textIncludes) {
    if (!bound.sql.includes(incl)) {
      throw new Error(`[${id}] mysql sql missing "${incl}" in: ${bound.sql}`);
    }
  }
  for (const excl of binding.textExcludes) {
    if (bound.sql.includes(excl)) {
      throw new Error(`[${id}] mysql sql must not contain "${excl}"`);
    }
  }
  if (bound.values.length !== binding.valueArity) {
    throw new Error(
      `[${id}] mysql valueArity: expected ${binding.valueArity}, got ${bound.values.length}`,
    );
  }
}

/**
 * Asserts neo4j binding shape (cypher includes/excludes + param count).
 * @param id - The corpus case id (for error messages).
 * @param bound - The narrowed {@link Neo4jBoundQuery} to assert.
 * @param binding - The binding expectations from the corpus case.
 * @throws {Error} When an inclusion is missing, an exclusion is present, or
 *   the param count is wrong.
 */
function assertNeo4jShape(
  id: string,
  bound: Neo4jBoundQuery,
  binding: ExpectedBinding,
): void {
  for (const incl of binding.textIncludes) {
    if (!bound.cypher.includes(incl)) {
      throw new Error(`[${id}] neo4j cypher missing "${incl}" in: ${bound.cypher}`);
    }
  }
  for (const excl of binding.textExcludes) {
    if (bound.cypher.includes(excl)) {
      throw new Error(`[${id}] neo4j cypher must not contain "${excl}"`);
    }
  }
  const paramCount = Object.keys(bound.params).length;
  if (paramCount !== binding.valueArity) {
    throw new Error(
      `[${id}] neo4j param count: expected ${binding.valueArity}, got ${paramCount}`,
    );
  }
}

/**
 * Asserts mongodb binding shape (document keys must not contain exclusions).
 * @param id - The corpus case id (for error messages).
 * @param bound - The narrowed {@link MongoBoundQuery} to assert.
 * @param binding - The binding expectations from the corpus case.
 * @throws {Error} When a document key contains an excluded substring.
 */
function assertMongoShape(
  id: string,
  bound: MongoBoundQuery,
  binding: ExpectedBinding,
): void {
  const docKeys = JSON.stringify(Object.keys(bound.document));
  for (const excl of binding.textExcludes) {
    if (docKeys.includes(excl)) {
      throw new Error(`[${id}] mongo doc keys must not contain "${excl}"`);
    }
  }
}

/**
 * Asserts per-engine binding shape from a `PipelineRun`.
 * Asserts `textIncludes`/`textExcludes` for sql engines; Mongo document keys.
 * @param run - The produced `PipelineRun`.
 * @param c - The corpus case carrying expected binding metadata.
 * @throws {Error} When a binding expectation is violated.
 */
export function assertBindingShape(run: PipelineRun, c: DbPipelineCase): void {
  if (!c.binding || !run.bindResult?.ok) return;
  const eng = run.bindResult.query;
  const { binding } = c;

  if (eng.engine === "postgres") {
    assertPgShape(c.id, eng.bound, binding);
  } else if (eng.engine === "mysql") {
    assertMySqlShape(c.id, eng.bound, binding);
  } else if (eng.engine === "neo4j") {
    assertNeo4jShape(c.id, eng.bound, binding);
  } else if (eng.engine === "mongodb") {
    assertMongoShape(c.id, eng.bound, binding);
  }
}
