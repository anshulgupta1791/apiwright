/**
 * Single source of truth for the §5 Database Connector contract and its
 * shared vocabulary. Every §5 connector implements {@link DbConnector};
 * the pool, engine-param-binder, connection seam, and §4 expect-evaluator
 * depend on these types. Reuses {@link NormalizedResult} from src/core
 * (never redefined) and is structurally sourced from the env databases
 * entry shape (src/env DatabaseConfig). Pure type declarations — no
 * runtime logic; this file is coverage-excluded (src-slash-star-star-slash-types.ts).
 *
 * The error taxonomy (DbConnectorError) lives in errors.ts because it
 * carries a runtime class + guard (it is NOT declaration-only) and to keep
 * this module type-pure and well under the 300-line soft limit.
 */

import type { NormalizedResult } from "../core/normalized-result.js";
import type { DatabaseConfig, DatabaseType } from "../env/types.js";

/**
 * The four — and only four — database engines APIWright v1.0 supports.
 * A closed string-literal union (repo idiom): structural, zero runtime
 * cost, narrows in switch. Deliberately a type alias of the env layer's
 * DatabaseType, not an independent copy: the env file's databases block is
 * the upstream source of the engine value, so the two unions are one
 * definition (DatabaseType) and cannot drift. v1.5 engines (vector DBs)
 * are explicitly out of scope and absent.
 */
export type DbEngine = DatabaseType;

/**
 * The configuration a single connector's {@link DbConnector.connect}
 * consumes for one named connection.
 *
 * This is exactly one resolved entry of ResolvedEnvironment.databases
 * (src/env) — by the time a connector sees it, the env loader has already
 * read the YAML, applied per-env overrides, and resolved every ${env.*}
 * and ${secret.*} references, so all values here are concrete (no
 * templates). Modelled as a type alias of the env layer's DatabaseConfig
 * so the env file remains the single canonical shape and the two cannot
 * diverge; §5 performs NO env loading and owns NO connection-config schema.
 *
 * Field semantics (inherited from DatabaseConfig): type selects the engine;
 * discrete-field engines (postgres/mysql) use host/port/database/user/
 * password; URI-preferring engines (mongodb/neo4j) typically use uri;
 * engine-specific extras are tolerated via the index signature.
 * user/password/uri frequently originate from ${secret.*} and are therefore
 * sensitive — see {@link DbConnectorError} for the no-leak guarantee.
 */
export type ConnectionConfig = DatabaseConfig;

/**
 * The optional params bag passed to {@link DbConnector.execute}.
 *
 * Per §5 this is Record<string, unknown>. Named here so
 * the engine-param-binder and connectors share one referent. Contract for
 * downstream tasks: by the time a value reaches a connector it is an
 * already-RESOLVED template value (the templating layer expanded
 * ${request.body.*} / ${response.body.*} / ${env.*} before binding),
 * which the per-engine param-binder binds natively (parameterized query /
 * driver bind variables) — connectors MUST NOT string-interpolate these into
 * the query text. Values are unknown: a JSON scalar, array, or object; the
 * binder narrows per engine. Keys are the placeholder names the binder maps
 * to each engine's native parameter syntax.
 */
export type QueryParams = Record<string, unknown>;

/**
 * The §5 connector contract — transcribed verbatim from §5
 * (lines 477–483). PostgreSQL, MySQL, MongoDB, and Neo4j each provide a
 * class implementing exactly these three async methods; the connection pool
 * stores instances behind this interface and the §4 expect-evaluator
 * consumes the {@link NormalizedResult} execute returns. A real TypeScript
 * interface (not a type alias) because it is a pluggable behavioral contract
 * (OOP discipline: interface = contract, classes = implementations) —
 * sibling tasks implements it.
 *
 * Error contract: connect/disconnect resolve void and a failed execute
 * returns a NormalizedResult; any operational failure (unreachable host,
 * bad credentials, malformed query, non-bindable template) rejects the
 * returned promise with a {@link DbConnectorError}. Callers (the pool /
 * Task #10 runner) catch and convert to a structured outcome — a failed
 * verification query becomes a failed test, never a process crash.
 */
export interface DbConnector {
  /**
   * Establishes the underlying driver connection/handle for one named
   * connection. Idempotency, pooling, and reuse are the pool task's concern,
   * NOT this contract's.
   * @param config - The resolved connection configuration (one
   *   ResolvedEnvironment.databases entry).
   * @returns Resolves when the connection is usable.
   * @throws {DbConnectorError} phase "connect" on any connect failure
   *   (host unreachable, auth rejected, unsupported/missing config); the
   *   message is sanitized and never contains credentials or a URI.
   */
  connect(config: ConnectionConfig): Promise<void>;

  /**
   * Executes one QA-authored verification (or cleanup) query and normalizes
   * the native driver result into the canonical {@link NormalizedResult}
   * regardless of engine.
   * @param query - The query text (SQL / Cypher / Mongo command) with
   *   already-resolved templating; native parameters are bound from params.
   * @param params - Optional resolved, natively-bound parameters
   *   ({@link QueryParams}); never string-interpolated into query.
   * @returns The engine-agnostic normalized result.
   * @throws {DbConnectorError} phase "execute" on a driver/query failure
   *   or phase "bind" when params cannot be safely bound natively (the D3
   *   non-bindable-template authoring rejection); the message is sanitized
   *   and never contains parameter values or credentials.
   */
  execute(query: string, params?: QueryParams): Promise<NormalizedResult>;

  /**
   * Releases the underlying driver connection/handle. Safe to call once per
   * successful {@link connect}; multi-call/pool semantics are the pool
   * task's concern.
   * @returns Resolves when the handle is released.
   * @throws {DbConnectorError} phase "disconnect" if teardown fails; the
   *   message is sanitized and never contains credentials.
   */
  disconnect(): Promise<void>;
}
