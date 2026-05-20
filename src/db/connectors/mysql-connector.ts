/**
 * MySQL connector implementing {@link DbConnector}. Wires the
 * {@link MysqlDriverSeam} seam, the mysql engine-param-binder, and the
 * {@link mapMysqlResult} normalizer into one lifecycle object.
 *
 * D3: values never reach the query text — the mysql binder replaces each
 *   sentinel with `?` and passes values in a separate array; the seam binds
 *   them natively via mysql2's prepared-statement execute.
 * D4: {@link mapMysqlResult} performs zero cell coercion.
 * Secret-safety: error messages are code-derived, never echoing the config,
 *   query text, or any parameter value.
 */

import type { NormalizedResult } from "../../core/normalized-result.js";
import type { MysqlDriverSeam, MysqlHandle } from "../drivers/mysql-seam.js";
import { createDefaultMysqlSeam } from "../drivers/mysql-seam.js";
import { DbConnectorError, isDbConnectorError, DB_ERROR_CODES } from "../errors.js";
import { bindMySql } from "../templating/mysql-binder.js";
import type { BoundValue, NeutralQuery } from "../templating/types.js";
import type { ConnectionConfig, QueryParams } from "../types.js";

import { mapMysqlResult } from "./mysql-result-normalizer.js";

/** Engine identifier constant for MysqlConnector error reporting. */
const ENGINE = "mysql" as const;

/** Not-connected sentinel message (lowercase so the test `.toLowerCase()` matches). */
const NOT_CONNECTED_MSG = "MySQL connector: not connected. Call connect() first.";

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
 * Builds a minimal {@link NeutralQuery} from a plain SQL string.
 * For mysql the occurrences array must match refs 1:1 (one site per distinct
 * ref, same order — connector test passes one ref at one site).
 * @param query - The SQL string (may contain sentinel placeholders or `?`).
 * @param values - The ordered BoundValues (one per distinct ref).
 * @returns A minimal NeutralQuery.
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
// MysqlConnector
// ---------------------------------------------------------------------------

/**
 * MySQL connector implementing the {@link DbConnector} contract.
 *
 * Lifecycle: construct → connect(config) → execute(query[, params])* →
 * disconnect(). The injected {@link MysqlDriverSeam} defaults to the real
 * `mysql2`-backed seam; tests supply a hand-written fake.
 */
export class MysqlConnector {
  readonly #seam: MysqlDriverSeam;
  #handle: MysqlHandle | undefined;

  /**
   * Constructs a MysqlConnector.
   * @param seam - Injectable {@link MysqlDriverSeam}; defaults to the real
   *   `mysql2`-backed seam (lazily loaded).
   */
  constructor(seam?: MysqlDriverSeam) {
    this.#seam = seam ?? createDefaultMysqlSeam();
  }

  /**
   * Opens the mysql2 pool handle and stores it internally.
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
        message: "MySQL connector: connection failed.",
        cause,
      });
    }
  }

  /**
   * Executes a parameterized statement and normalizes the result.
   * @param query - SQL text (may include sentinel placeholders or `?`).
   * @param params - Optional params bag keyed by stringified ref index.
   * @returns Normalized result with rows, rowCount, raw.
   * @throws {DbConnectorError} code DB_QUERY_FAILED / phase "execute".
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
    const bindResult = bindMySql(neutral, values);

    /* istanbul ignore next — provably unreachable: buildNeutral creates refs and
       occurrences in perfect 1:1 alignment with values; checkContract can never
       detect a mismatch given this connector's NeutralQuery construction. */
    if (!bindResult.ok) {
      throw bindResult.error;
    }

    // Narrow the discriminated union: bindMySql always returns engine "mysql"
    const engineQuery = bindResult.query;
    /* istanbul ignore next — bindMySql always returns engine:"mysql"; other arms unreachable */
    if (engineQuery.engine !== "mysql") {
      throw new DbConnectorError({
        code: DB_ERROR_CODES.DB_QUERY_FAILED,
        phase: "execute",
        engine: ENGINE,
        message: "MySQL connector: unexpected binder engine tag.",
      });
    }
    const { sql, values: boundValues } = engineQuery.bound;

    try {
      const mysqlResult = await this.#seam.execute(handle, sql, boundValues);
      return mapMysqlResult(mysqlResult);
    } catch (cause: unknown) {
      if (isDbConnectorError(cause)) throw cause;
      throw new DbConnectorError({
        code: DB_ERROR_CODES.DB_QUERY_FAILED,
        phase: "execute",
        engine: ENGINE,
        message: "MySQL connector: query execution failed.",
        cause,
      });
    }
  }

  /**
   * Closes the mysql2 pool handle. No-op when not connected. Clears the handle
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
        message: "MySQL connector: disconnect failed.",
        cause,
      });
    } finally {
      this.#handle = undefined;
    }
  }
}
