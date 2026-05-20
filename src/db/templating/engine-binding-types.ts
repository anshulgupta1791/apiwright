/**
 * Declaration-only types for the per-engine bound query artifacts produced by
 * the db-engine-param-binder. One type per engine, plus the discriminated
 * union {@link EngineBoundQuery} and the no-throw {@link BindResult}.
 *
 * This file is declaration-only (no runtime logic) and is excluded from
 * coverage by the src-slash-star-star-slash-types.ts convention.
 */

import type { DbConnectorError } from "../errors.js";
import type { DbEngine } from "../types.js";

import type { BoundValue, NeutralQuery } from "./types.js";

// Re-export types used by consumers who import only from this module.
export type { BoundValue, NeutralQuery, DbConnectorError, DbEngine };

/**
 * The `pg` driver's parameterized call shape: `client.query(text, values)`.
 * `text` is the neutral SQL with every sentinel SITE rewritten to a
 * positional `$N` token; `values` holds the resolved values the driver binds
 * out-of-band. A value is NEVER concatenated into `text` (D3 proof).
 */
export interface PgBoundQuery {
  /** SQL with `$1..$N` placeholders; never contains a resolved value. */
  readonly text: string;
  /** Resolved values, driver-bound positionally to `$1..$N`. */
  readonly values: readonly unknown[];
}

/**
 * The `mysql2` driver's parameterized call shape: `conn.execute(sql, values)`.
 * `sql` is the neutral SQL with every sentinel SITE rewritten to a `?` token;
 * `values` holds one entry per occurrence in textual order (mysql2 `?` has NO
 * reuse semantics — a ref at K sites means its value appears K times).
 */
export interface MySqlBoundQuery {
  /** SQL with positional `?` placeholders; never contains a resolved value. */
  readonly sql: string;
  /** Resolved values, one per `?` in left-to-right textual order. */
  readonly values: readonly unknown[];
}

/**
 * The `neo4j-driver` `session.run(cypher, params)` shape. `cypher` is the
 * neutral Cypher with every sentinel SITE rewritten to a generated named
 * placeholder `$pN`; `params` maps each generated name to its resolved value.
 * A reused ref → ONE `$pN` referenced at every site → ONE `params` entry.
 * A value is NEVER concatenated into `cypher` (D3 proof).
 */
export interface Neo4jBoundQuery {
  /** Cypher with generated `$pN` named placeholders; never a value. */
  readonly cypher: string;
  /** Generated-name → resolved value; one entry per distinct ref. */
  readonly params: Readonly<Record<string, unknown>>;
}

/**
 * The `mongodb` bound form: there is NO query string. The upstream neutral
 * form is a command/filter DOCUMENT with sentinel VALUE leaves; binding
 * substitutes each leaf's resolved value, producing the final document.
 * Object KEYS are NEVER touched; this is the Mongo analogue of
 * "no identifier interpolation".
 */
export interface MongoBoundQuery {
  /**
   * The final command/filter document with every sentinel value-leaf replaced
   * by its resolved value. Plain object/array, deep-cloned; prototype-safe.
   * The connector passes THIS to the driver.
   */
  readonly document: Readonly<Record<string, unknown>> | readonly unknown[];
}

/**
 * Discriminated union of every engine's native bound artifact, tagged by
 * {@link DbEngine}. The dispatcher narrows to exactly one arm; the per-engine
 * binder functions return the un-tagged shape.
 */
export type EngineBoundQuery =
  | { readonly engine: "postgres"; readonly bound: PgBoundQuery }
  | { readonly engine: "mysql"; readonly bound: MySqlBoundQuery }
  | { readonly engine: "neo4j"; readonly bound: Neo4jBoundQuery }
  | { readonly engine: "mongodb"; readonly bound: MongoBoundQuery };

/**
 * No-throw discriminated result of binding (house idiom — cf.
 * `JsonParseResult`, `ExtractResult`). Success carries the engine-native
 * artifact; failure carries a {@link DbConnectorError} with
 * `code: "DB_PARAM_NOT_BINDABLE"`, `phase: "bind"` — used ONLY for the
 * defensive contract-violation case, never thrown.
 */
export type BindResult =
  | { readonly ok: true; readonly query: EngineBoundQuery }
  | { readonly ok: false; readonly error: DbConnectorError };
