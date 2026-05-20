/**
 * PostgreSQL connector implementing {@link DbConnector}. Wires the
 * {@link PostgresDriverSeam} seam, the pg engine-param-binder, and the
 * {@link mapPgResult} normalizer into one lifecycle object.
 *
 * D3: values never reach the query text — the pg binder places `$n` tokens
 *   in `text` and passes values in a separate array; the seam binds them
 *   natively.
 * D4: {@link mapPgResult} performs zero cell coercion.
 * Secret-safety: error messages are code-derived, never echoing the config,
 *   query text, or any parameter value.
 */

import type { NormalizedResult } from "../../core/normalized-result.js";
import type { PostgresDriverSeam, PgHandle } from "../drivers/postgres-seam.js";
import { createDefaultPostgresSeam } from "../drivers/postgres-seam.js";
import { DbConnectorError, isDbConnectorError, DB_ERROR_CODES } from "../errors.js";
import { bindPg } from "../templating/pg-binder.js";
import type { BoundValue, NeutralQuery } from "../templating/types.js";
import type { ConnectionConfig, QueryParams } from "../types.js";

import { mapPgResult } from "./pg-result-normalizer.js";

/** Engine identifier constant for PostgresConnector error reporting. */
const ENGINE = "postgres" as const;

/** Not-connected sentinel message (lowercase so the test `.toLowerCase()` matches). */
const NOT_CONNECTED_MSG = "PostgreSQL connector: not connected. Call connect() first.";

// ---------------------------------------------------------------------------
// params bridge helpers
// ---------------------------------------------------------------------------

/**
 * Reconstructs the ordered {@link BoundValue}[] from a {@link QueryParams}
 * object keyed by stringified ref index ("0", "1", …). Returns `[]` when
 * `params` is absent or empty.
 * @param params - Optional caller-supplied param bag.
 * @returns Ordered BoundValue array (sorted by index ascending).
 */
function paramsToValues(params?: QueryParams): readonly BoundValue[] {
  if (params == null) return [];
  return Object.entries(params)
    .map(([k, v]): BoundValue => ({ index: parseInt(k, 10), value: v }))
    .sort((a, b) => a.index - b.index);
}

/**
 * Builds a minimal {@link NeutralQuery} from a plain query string. The
 * connector receives the query ALREADY in its final form (sentinels pre-
 * placed by Task #10 upstream). When params has N entries we synthesize N
 * refs so the binder knows which $n to emit.
 * @param query - The SQL string (may contain sentinel placeholders or $N).
 * @param values - The ordered BoundValues (one per distinct ref).
 * @returns A minimal NeutralQuery (refs=values' indices; no occurrences needed
 *   for pg since pg binder uses refs[] only).
 */
function buildNeutral(query: string, values: readonly BoundValue[]): NeutralQuery {
  const refs = values.map((v) => ({
    index: v.index,
    namespace: "env" as const,
    path: String(v.index),
    raw: `\${env.${String(v.index)}}`,
  }));
  return {
    neutralQuery: query,
    refs,
    occurrences: refs.map((r) => ({ refIndex: r.index })),
    source: query,
  };
}

// ---------------------------------------------------------------------------
// PostgresConnector
// ---------------------------------------------------------------------------

/**
 * PostgreSQL connector implementing the {@link DbConnector} contract.
 *
 * Lifecycle: construct → connect(config) → execute(query[, params])* →
 * disconnect(). The injected {@link PostgresDriverSeam} defaults to the real
 * `pg`-backed seam; tests supply a hand-written fake.
 */
export class PostgresConnector {
  readonly #seam: PostgresDriverSeam;
  #handle: PgHandle | undefined;

  /**
   * Constructs a PostgresConnector.
   * @param seam - Injectable {@link PostgresDriverSeam}; defaults to the
   *   real `pg`-backed seam (lazily loaded).
   */
  constructor(seam?: PostgresDriverSeam) {
    this.#seam = seam ?? createDefaultPostgresSeam();
  }

  /**
   * Opens the pg pool handle and stores it internally.
   * @param config - Resolved connection configuration.
   * @returns Resolves void on success.
   * @throws {DbConnectorError} code DB_CONNECTION_FAILED / phase "connect".
   */
  async connect(config: ConnectionConfig): Promise<void> {
    try {
      this.#handle = await this.#seam.open(config);
    } catch (cause: unknown) {
      if (isDbConnectorError(cause)) throw cause;
      throw new DbConnectorError({
        code: DB_ERROR_CODES.DB_CONNECTION_FAILED,
        phase: "connect",
        engine: ENGINE,
        message: "PostgreSQL connector: connection failed.",
        cause,
      });
    }
  }

  /**
   * Executes a parameterized query and normalizes the result.
   * @param query - SQL text (may include sentinel placeholders).
   * @param params - Optional params bag keyed by stringified ref index.
   * @returns Normalized result with rows, rowCount, raw.
   * @throws {DbConnectorError} code DB_QUERY_FAILED / phase "execute" when
   *   not connected or driver fails; DB_PARAM_NOT_BINDABLE / phase "bind"
   *   when the binder rejects the params.
   */
  async execute(query: string, params?: QueryParams): Promise<NormalizedResult> {
    const handle = this.#handle;
    if (handle === undefined) {
      throw new DbConnectorError({
        code: DB_ERROR_CODES.DB_QUERY_FAILED,
        phase: "execute",
        engine: ENGINE,
        message: NOT_CONNECTED_MSG,
      });
    }

    const values = paramsToValues(params);
    const neutral = buildNeutral(query, values);
    const bindResult = bindPg(neutral, values);

    /* istanbul ignore next — provably unreachable: buildNeutral creates refs and
       occurrences in perfect 1:1 alignment with values; checkContract can never
       detect a mismatch given this connector's NeutralQuery construction. */
    if (!bindResult.ok) {
      throw bindResult.error;
    }

    // Narrow the discriminated union: bindPg always returns engine "postgres"
    const engineQuery = bindResult.query;
    /* istanbul ignore next — bindPg always returns engine:"postgres"; other arms unreachable */
    if (engineQuery.engine !== "postgres") {
      throw new DbConnectorError({
        code: DB_ERROR_CODES.DB_QUERY_FAILED,
        phase: "execute",
        engine: ENGINE,
        message: "PostgreSQL connector: unexpected binder engine tag.",
      });
    }
    const { text, values: boundValues } = engineQuery.bound;

    try {
      const pgResult = await this.#seam.query(handle, text, boundValues);
      return mapPgResult(pgResult);
    } catch (cause: unknown) {
      if (isDbConnectorError(cause)) throw cause;
      throw new DbConnectorError({
        code: DB_ERROR_CODES.DB_QUERY_FAILED,
        phase: "execute",
        engine: ENGINE,
        message: "PostgreSQL connector: query execution failed.",
        cause,
      });
    }
  }

  /**
   * Closes the pg pool handle. No-op when not connected. Clears the handle
   * in `finally` so a failed close leaves no dangling reference.
   * @returns Resolves void on success.
   * @throws {DbConnectorError} code DB_DISCONNECT_FAILED / phase "disconnect".
   */
  async disconnect(): Promise<void> {
    const handle = this.#handle;
    if (handle === undefined) return;

    try {
      await this.#seam.close(handle);
    } catch (cause: unknown) {
      throw new DbConnectorError({
        code: DB_ERROR_CODES.DB_DISCONNECT_FAILED,
        phase: "disconnect",
        engine: ENGINE,
        message: "PostgreSQL connector: disconnect failed.",
        cause,
      });
    } finally {
      this.#handle = undefined;
    }
  }
}
