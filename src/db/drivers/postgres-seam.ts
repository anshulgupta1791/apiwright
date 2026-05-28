/**
 * Minimal injectable boundary over `pg` for the PostgreSQL connector.
 * Declares the `PostgresDriverSeam` interface and exports
 * `createDefaultPostgresSeam`, which lazily `require()`s the real `pg`
 * driver inside `open()` — no driver loaded on import or factory call.
 * Mirrors the `swagger-parser-seam.ts` / `schema-validator.ts` CJS-require
 * idiom exactly.
 */

import type { ConnectionConfig } from "../types.js";

import { defaultDriverRequire, requireDriverOrThrow } from "./seam-shared.js";
import type { DriverRequireFn } from "./seam-shared.js";

/** Named constant for the pg npm module id. No magic strings. */
const PG_MODULE_ID = "pg";

/** Secret-free install hint for the missing-driver error message. */
const PG_INSTALL_HINT =
  'PostgreSQL driver "pg" is not installed. Run: npm install pg';

/** One row of a pg result: column-name keyed, values driver-typed. */
export type PgRow = Record<string, unknown>;

/**
 * The pg result fields a connector maps to `NormalizedResult`:
 * `rows` -> `NormalizedResult.rows`; `rowCount` -> `rowCount`
 * (pg yields `null` for non-row commands — the connector coalesces to
 * `rows.length`); the whole object -> `raw`. No other pg result field is
 * needed by the connector and so is intentionally absent.
 */
export interface PgQueryResult {
  /** Result rows in driver order; `[]` for non-row statements. */
  readonly rows: PgRow[];
  /** Rows affected/returned; `null` for statements pg reports no count for. */
  readonly rowCount: number | null;
}

/**
 * Opaque per-connection pg handle (a `pg.Pool` under the default seam). The
 * connector treats it as a token: obtained from {@link PostgresDriverSeam.open},
 * passed back to `query`/`close`. Deliberately structural — the real
 * `pg.Pool` type is never imported (keeps the driver lazily required).
 */
export interface PgHandle {
  /** Brand so a fake/real handle is not accidentally a `{}`. */
  readonly __pgHandle: true;
}

/**
 * Minimal injectable boundary over `pg` for one connection. Exposes ONLY
 * open / parameterized-query / close — the surface the PostgreSQL connector
 * needs to implement `DbConnector`. No transactions, streaming, LISTEN, or
 * pooling policy (deferred). Unit tests inject a hand-written fake; the
 * default factory ({@link createDefaultPostgresSeam}) lazily wires real `pg`.
 */
export interface PostgresDriverSeam {
  /**
   * Creates the pg connection handle from a resolved connection config.
   * @param config - One resolved `ResolvedEnvironment.databases` entry.
   * @returns The opaque pg handle.
   */
  open(config: ConnectionConfig): Promise<PgHandle>;

  /**
   * Runs ONE parameterized statement. `values` are bound NATIVELY as pg
   * `$1..$n` positional parameters — never string-interpolated into `text`.
   * @param handle - A handle from {@link open}.
   * @param text - SQL with `$1..$n` placeholders.
   * @param values - Positional parameter values (resolved; may be `[]`).
   * @returns The pg-shaped result for the connector to normalize.
   */
  query(
    handle: PgHandle,
    text: string,
    values: readonly unknown[],
  ): Promise<PgQueryResult>;

  /**
   * Closes the handle (ends the pool). Idempotent semantics are the pool
   * task's concern; the connector calls this once per {@link open}.
   * @param handle - The handle to close.
   */
  close(handle: PgHandle): Promise<void>;
}

/** Minimal local interface for a pg Pool instance. */
interface PgPoolInstance {
  query(text: string, values: unknown[]): Promise<PgQueryResult>;
  end(): Promise<void>;
}

/** Minimal local interface for the lazily-required pg module. */
interface PgModule {
  Pool: new (config: unknown) => PgPoolInstance;
}

/** Internal branded pool handle type combining PgPoolInstance and brand. */
interface PgBrandedPool extends PgPoolInstance {
  readonly __pgHandle: true;
}

/**
 * Translates an APIWright {@link ConnectionConfig} into the options object
 * `pg.Pool` expects. A `uri`/`url` connection string maps to pg's
 * `connectionString`; discrete fields (host/port/database/user/password)
 * and any engine-specific extras (ssl, max, …) pass through. The
 * APIWright-only `type` key is dropped (pg ignores unknown keys, but
 * dropping it keeps the driver input clean).
 *
 * Before this mapping the seam passed the raw config to `new pg.Pool()`,
 * so a `uri`/`url` was silently ignored and pg fell back to its env
 * defaults — connecting to the wrong database (GitHub issue #31).
 * @param config - The resolved connection config.
 * @returns The options object for `new pg.Pool(...)`.
 */
function toPgPoolOptions(config: ConnectionConfig): Record<string, unknown> {
  const { type: _type, uri, url, ...rest } = config as Record<string, unknown> & {
    uri?: unknown;
    url?: unknown;
  };
  const connectionString =
    typeof uri === "string" ? uri : typeof url === "string" ? url : undefined;
  return connectionString !== undefined ? { connectionString, ...rest } : rest;
}

/**
 * Builds the default PostgreSQL seam backed by the real `pg` driver,
 * required LAZILY on first {@link PostgresDriverSeam.open} (importing this
 * module loads no driver). The opt-in live E2E (Task #10) uses this default;
 * unit tests inject a fake `PostgresDriverSeam` instead, or inject
 * `requireFn` here to cover the lazy-wire + missing-driver branches.
 * @param requireFn - CJS loader; defaults to Node `require`.
 * @returns A real-driver-backed {@link PostgresDriverSeam}.
 */
export function createDefaultPostgresSeam(
  requireFn?: DriverRequireFn,
): PostgresDriverSeam {
  const loader: DriverRequireFn = requireFn ?? defaultDriverRequire;

  return {
    open(config: ConnectionConfig): Promise<PgHandle> {
      return Promise.resolve().then(() => {
        const mod = requireDriverOrThrow(
          loader,
          PG_MODULE_ID,
          "postgres",
          PG_INSTALL_HINT,
        ) as PgModule;
        const pool = new mod.Pool(toPgPoolOptions(config));
        const branded: PgBrandedPool = Object.assign(pool, { __pgHandle: true as const });
        return branded;
      });
    },

    query(
      handle: PgHandle,
      text: string,
      values: readonly unknown[],
    ): Promise<PgQueryResult> {
      const pool = handle as unknown as PgPoolInstance;
      return pool.query(text, values as unknown[]);
    },

    close(handle: PgHandle): Promise<void> {
      const pool = handle as unknown as PgPoolInstance;
      return pool.end();
    },
  };
}
