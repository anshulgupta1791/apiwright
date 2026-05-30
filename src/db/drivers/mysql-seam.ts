/**
 * Minimal injectable boundary over `mysql2/promise` for the MySQL connector.
 * Declares the `MysqlDriverSeam` interface and exports
 * `createDefaultMysqlSeam`, which lazily `require()`s the real
 * `mysql2/promise` driver inside `open()`. Mirrors the same CJS-require
 * idiom as `swagger-parser-seam.ts` / `schema-validator.ts`.
 */

import type { ConnectionConfig } from "../types.js";

import { defaultDriverRequire, requireDriverOrThrow } from "./seam-shared.js";
import type { DriverRequireFn } from "./seam-shared.js";

/** Named constant for the mysql2/promise npm module id. No magic strings. */
const MYSQL2_MODULE_ID = "mysql2/promise";

/** Secret-free install hint for the missing-driver error message. */
const MYSQL2_INSTALL_HINT =
  'MySQL driver "mysql2" is not installed. Run: npm install mysql2';

/** One mysql2 row (column-keyed) for row-returning statements. */
export type MysqlRow = Record<string, unknown>;

/**
 * The mysql2 result a connector maps to `NormalizedResult`. mysql2 returns
 * either an array of rows OR a result-set header; the connector branches:
 * array -> `rows`/`rowCount = rows.length`; header -> `rows = []`,
 * `rowCount = affectedRows`; the whole value -> `raw`. The union is modelled
 * minimally — only `affectedRows` of the header is needed.
 */
export type MysqlQueryResult =
  | { readonly kind: "rows"; readonly rows: MysqlRow[] }
  | { readonly kind: "ok"; readonly affectedRows: number };

/**
 * Opaque per-connection mysql2 handle (a `mysql2/promise` Pool under the
 * default seam). Structural; the real mysql2 Pool type is never imported.
 */
export interface MysqlHandle {
  /** Brand. */
  readonly __mysqlHandle: true;
}

/**
 * Minimal injectable boundary over `mysql2` for one connection: open /
 * parameterized-execute / close only. No transactions, streaming, or pooling
 * policy (deferred). Default factory lazily wires `mysql2/promise`.
 */
export interface MysqlDriverSeam {
  /**
   * Creates the mysql2 pool handle from a resolved connection config.
   * @param config - One resolved databases entry.
   * @returns The opaque mysql2 handle.
   */
  open(config: ConnectionConfig): Promise<MysqlHandle>;

  /**
   * Runs ONE parameterized prepared statement via `execute`. `values` bind
   * NATIVELY to `?` placeholders — never interpolated into `sql`.
   * @param handle - A handle from {@link open}.
   * @param sql - SQL with `?` placeholders.
   * @param values - Positional parameter values (resolved; may be `[]`).
   * @returns The mysql2-shaped result (rows or OK header) to normalize.
   */
  execute(
    handle: MysqlHandle,
    sql: string,
    values: readonly unknown[],
  ): Promise<MysqlQueryResult>;

  /**
   * Closes the handle (ends the pool).
   * @param handle - The handle to close.
   */
  close(handle: MysqlHandle): Promise<void>;
}

/**
 * Shape of the result mysql2's prepared-statement `execute` returns.
 *
 * mysql2 returns a TUPLE — `[result, fields]` — where:
 *   - `result` is a `RowDataPacket[]` for SELECT/SHOW, OR
 *   - `result` is a single `OkPacket / ResultSetHeader` with `affectedRows`
 *     for INSERT/UPDATE/DELETE/DDL.
 *   - `fields` is a `FieldPacket[]` describing the columns (unused here).
 *
 * We model this minimally — only what the seam reads.
 */
type Mysql2RawResult = readonly [
  unknown[] | { affectedRows?: number },
  unknown[],
];

/** Minimal local interface for a mysql2/promise Pool instance. */
interface Mysql2PoolInstance {
  execute(sql: string, values: unknown[]): Promise<Mysql2RawResult>;
  end(): Promise<void>;
}

/** Minimal local interface for the lazily-required mysql2/promise module. */
interface Mysql2Module {
  createPool(config: unknown): Mysql2PoolInstance;
}

/** Internal branded pool handle type combining Mysql2PoolInstance and brand. */
interface MysqlBrandedPool extends Mysql2PoolInstance {
  readonly __mysqlHandle: true;
}

/**
 * Translates an APIWright {@link ConnectionConfig} into the options object
 * `mysql2.createPool` expects. mysql2 natively supports a `uri` option, so
 * a `url` connection string is normalised to `uri`; discrete fields and
 * engine-specific extras pass through. The APIWright-only `type` key is
 * dropped. Before this mapping the raw config was passed through, so a
 * `url`-style connection string was ignored (GitHub issue #31).
 * @param config - The resolved connection config.
 * @returns The options object for `createPool(...)`.
 */
function toMysqlPoolOptions(config: ConnectionConfig): Record<string, unknown> {
  const { type: _type, url, ...rest } = config as Record<string, unknown> & { url?: unknown };
  // mysql2 reads `uri`; map a `url` alias onto it when `uri` isn't set.
  if (typeof url === "string" && rest["uri"] === undefined) {
    return { uri: url, ...rest };
  }
  return rest;
}

/**
 * Builds the default MySQL seam backed by the real `mysql2/promise` driver,
 * required LAZILY on first {@link MysqlDriverSeam.open} (importing this
 * module loads no driver). Unit tests inject `requireFn` to exercise the
 * lazy-wire and missing-driver branches without loading the real driver.
 * @param requireFn - CJS loader; defaults to Node `require`.
 * @returns A real-driver-backed {@link MysqlDriverSeam}.
 */
export function createDefaultMysqlSeam(
  requireFn?: DriverRequireFn,
): MysqlDriverSeam {
  const loader: DriverRequireFn = requireFn ?? defaultDriverRequire;

  return {
    open(config: ConnectionConfig): Promise<MysqlHandle> {
      return Promise.resolve().then(() => {
        const mod = requireDriverOrThrow(
          loader,
          MYSQL2_MODULE_ID,
          "mysql",
          MYSQL2_INSTALL_HINT,
        ) as Mysql2Module;
        const pool = mod.createPool(toMysqlPoolOptions(config));
        const branded: MysqlBrandedPool = Object.assign(pool, {
          __mysqlHandle: true as const,
        });
        return branded;
      });
    },

    async execute(
      handle: MysqlHandle,
      sql: string,
      values: readonly unknown[],
    ): Promise<MysqlQueryResult> {
      const pool = handle as unknown as Mysql2PoolInstance;
      // mysql2 returns a TUPLE [result, fields]; unpack and discriminate.
      // Issue #43: the previous implementation cast the tuple directly to
      // `MysqlQueryResult` (a `{kind: "rows"|"ok", ...}` discriminated
      // union), which silently fell into the "ok" arm with `affectedRows`
      // undefined → 0 for every SELECT. Result: every db_verify against
      // MySQL reported rowCount=0 / rows=[] even when the rows existed.
      const raw = await pool.execute(sql, values as unknown[]);
      const [result] = raw;
      if (Array.isArray(result)) {
        return { kind: "rows", rows: result as MysqlRow[] };
      }
      // ResultSetHeader / OkPacket from DML/DDL.
      return { kind: "ok", affectedRows: result.affectedRows ?? 0 };
    },

    close(handle: MysqlHandle): Promise<void> {
      const pool = handle as unknown as Mysql2PoolInstance;
      return pool.end();
    },
  };
}
