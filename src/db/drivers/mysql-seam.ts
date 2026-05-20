/**
 * Minimal injectable boundary over `mysql2/promise` for the MySQL connector.
 * Declares the `MysqlDriverSeam` interface and exports
 * `createDefaultMysqlSeam`, which lazily `require()`s the real
 * `mysql2/promise` driver inside `open()`. Mirrors the same CJS-require
 * idiom as `swagger-parser-seam.ts` / `schema-validator.ts`.
 */

import type { ConnectionConfig } from "../types.js";

import { requireDriverOrThrow } from "./seam-shared.js";
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

/** Minimal local interface for a mysql2/promise Pool instance. */
interface Mysql2PoolInstance {
  execute(sql: string, values: unknown[]): Promise<MysqlQueryResult>;
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
  // CJS driver, no ESM default; mirrors schema-validator.ts.
  // eslint-disable-next-line @typescript-eslint/no-require-imports, no-restricted-syntax
  const loader: DriverRequireFn = requireFn ?? ((id: string): unknown => require(id));

  return {
    open(config: ConnectionConfig): Promise<MysqlHandle> {
      return Promise.resolve().then(() => {
        const mod = requireDriverOrThrow(
          loader,
          MYSQL2_MODULE_ID,
          "mysql",
          MYSQL2_INSTALL_HINT,
        ) as Mysql2Module;
        const pool = mod.createPool(config);
        const branded: MysqlBrandedPool = Object.assign(pool, {
          __mysqlHandle: true as const,
        });
        return branded;
      });
    },

    execute(
      handle: MysqlHandle,
      sql: string,
      values: readonly unknown[],
    ): Promise<MysqlQueryResult> {
      const pool = handle as unknown as Mysql2PoolInstance;
      return pool.execute(sql, values as unknown[]);
    },

    close(handle: MysqlHandle): Promise<void> {
      const pool = handle as unknown as Mysql2PoolInstance;
      return pool.end();
    },
  };
}
