/**
 * Run-scoped, per-connection-NAME connector registry and its supporting types.
 *
 * DEFERRED to Task #10 / §9 (NOT here): WIRING this registry into a live
 * run — the per-RUN open-at-start / `disposeAll`-at-end lifecycle, which
 * tests share one registry instance, running verification + cleanup per
 * endpoint, the `params`↔`Ref.index` runner↔connector contract, and
 * surfacing `NormalizedResult` under `db.<conn>.<query_id>` for §4
 * assertions. This module only PROVIDES `acquire`/`disposeAll`.
 */

import type { DatabaseConfig } from "../../env/types.js";
import { MongodbConnector } from "../connectors/mongodb-connector.js";
import { MysqlConnector } from "../connectors/mysql-connector.js";
import { Neo4jConnector } from "../connectors/neo4j-connector.js";
import { PostgresConnector } from "../connectors/postgres-connector.js";
import { DbConnectorError, isDbConnectorError, DB_ERROR_CODES } from "../errors.js";
import type { DbConnector, DbEngine } from "../types.js";

/**
 * The factory the registry uses to construct a connector for one engine.
 * Real default = {@link createDefaultConnectorFactory} (maps each
 * {@link DbEngine} to `new <Engine>Connector()` over its default seam).
 * Unit tests inject a fake factory returning hand-written fake connectors —
 * NO real driver/Docker/network.
 */
export interface ConnectorFactory {
  /**
   * Builds a NOT-yet-connected connector for the given engine. MUST be pure
   * construction (no I/O): the registry owns calling `connect()`.
   * @param engine - The engine to construct a connector for.
   * @returns An unconnected {@link DbConnector} for `engine`.
   */
  create(engine: DbEngine): DbConnector;
}

/** A single connection's disconnect outcome within {@link DisposeAllOutcome}. */
export interface ConnectionDisposeResult {
  /** The connection name (the `databases` map key). */
  readonly name: string;
  /** The engine of the connector that was disposed. */
  readonly engine: DbEngine;
  /** True iff `disconnect()` resolved without error. */
  readonly ok: boolean;
  /**
   * The disconnect failure, present iff `ok === false`. A
   * {@link DbConnectorError} when the connector rejected with one; otherwise
   * a registry-built `DbConnectorError` wrapping a non-typed throw.
   * NEVER a raw error.
   */
  readonly error?: DbConnectorError;
}

/**
 * The aggregated, no-throw outcome of {@link ConnectionPoolRegistry.disposeAll}.
 * `disposeAll` NEVER throws and NEVER stops early. `ok` is the AND of all
 * per-connection results (true iff every disconnect succeeded, including the
 * vacuous empty case).
 */
export interface DisposeAllOutcome {
  /** True iff every attempted disconnect succeeded (true when none attempted). */
  readonly ok: boolean;
  /** One entry per connector that had been acquired, in acquisition order. */
  readonly results: readonly ConnectionDisposeResult[];
}

/** Tracks a successfully connected connector for disposeAll ordering. */
interface AcquiredEntry {
  readonly name: string;
  readonly engine: DbEngine;
  readonly connector: DbConnector;
}

/** Sentinel engine value for unknown-name errors (no config entry = no engine). */
const UNKNOWN_ENGINE_SENTINEL: DbEngine = "postgres";

/**
 * Run-scoped, per-connection-NAME connector registry (locked decision D1).
 *
 * Given the resolved `ResolvedEnvironment.databases` map (Task 2 / §7),
 * {@link acquire} lazily constructs and `connect()`s exactly ONE
 * {@link DbConnector} per NAME and caches it. Later acquires of the same
 * name return the SAME connected connector.
 *
 * **Concurrency:** N concurrent `acquire(name)` for an unconnected name
 * SHARE a single in-flight `connect()` (single-flight per name). A rejected
 * connect evicts its in-flight entry so a later `acquire` retries fresh.
 *
 * **Errors:** every failure is a structured, secret-free
 * {@link DbConnectorError}. This class NEVER raw-throws.
 *
 * **DEFERRED to Task #10 / §9:** WIRING this registry into a live run.
 */
export class ConnectionPoolRegistry {
  /** Resolved databases map (may be empty if no `databases:` block). */
  readonly #databases: Readonly<Record<string, DatabaseConfig>>;
  /** The connector factory (real default or injected fake for tests). */
  readonly #factory: ConnectorFactory;
  /**
   * In-flight or resolved connect Promises, keyed by name.
   * Storing the Promise (not the connector) is what makes single-flight
   * correct: concurrent callers await the SAME pending Promise.
   */
  readonly #entries: Map<string, Promise<DbConnector>>;
  /** Successfully acquired connectors in acquisition order (for disposeAll). */
  #acquired: AcquiredEntry[];

  /**
   * Constructs a new registry backed by the given resolved databases map.
   * @param databases - The resolved `ResolvedEnvironment.databases` map.
   *   `undefined` is treated as an empty map (every `acquire` fails with the
   *   unknown-name error). No env loading is performed here.
   * @param factory - The connector factory. Defaults to
   *   {@link createDefaultConnectorFactory}(). Unit tests inject a fake.
   */
  constructor(
    databases: Readonly<Record<string, DatabaseConfig>> | undefined,
    factory?: ConnectorFactory,
  ) {
    this.#databases = databases ?? {};
    this.#factory = factory ?? createDefaultConnectorFactory();
    this.#entries = new Map();
    this.#acquired = [];
  }

  /**
   * Returns the CONNECTED connector for the named connection. Constructs +
   * connects it on first use; returns the cached instance on subsequent calls.
   * Single-flight per name under concurrent first calls.
   * @param name - A key of the `databases` map supplied to the constructor.
   * @returns The connected {@link DbConnector} for `name`.
   * @throws {DbConnectorError} `code: DB_CONNECTION_FAILED`, `phase: "connect"`
   *   when `name` is not configured, or when `connect()` fails.
   */
  acquire(name: string): Promise<DbConnector> {
    // Step 1: synchronous hit — no await before this read (single-flight guard)
    const existing = this.#entries.get(name);
    if (existing !== undefined) {
      return existing;
    }

    // Step 2: unknown name — reject without caching
    const config = this.#databases[name];
    if (config === undefined) {
      return Promise.reject(
        new DbConnectorError({
          code: DB_ERROR_CODES.DB_CONNECTION_FAILED,
          phase: "connect",
          engine: UNKNOWN_ENGINE_SENTINEL,
          message: `No database connection named "${name}" is configured.`,
        }),
      );
    }

    // Step 3: miss — build the in-flight Promise and store it SYNCHRONOUSLY
    // before any await so concurrent callers hit Step 1 and share this Promise.
    const engine = config.type;
    const connector = this.#factory.create(engine);

    const connectPromise: Promise<DbConnector> = connector
      .connect(config)
      .then(() => {
        this.#acquired.push({ name, engine, connector });
        return connector;
      })
      .catch((err: unknown) => {
        // Failure-eviction: remove iff still this Promise (identity guard).
        if (this.#entries.get(name) === connectPromise) {
          this.#entries.delete(name);
        }
        if (isDbConnectorError(err)) {
          return Promise.reject(err);
        }
        return Promise.reject(
          new DbConnectorError({
            code: DB_ERROR_CODES.DB_CONNECTION_FAILED,
            phase: "connect",
            engine,
            message: `Failed to connect database "${name}".`,
            cause: err,
          }),
        );
      });

    this.#entries.set(name, connectPromise);
    return connectPromise;
  }

  /**
   * Best-effort disconnect of EVERY connector that was successfully acquired.
   * NEVER throws and NEVER stops early — a failing `disconnect()` is recorded
   * and remaining disconnects still run. Clears the cache. Idempotent: a
   * second call with no intervening `acquire` returns `{ ok: true, results: [] }`.
   * @returns The aggregated {@link DisposeAllOutcome}.
   */
  async disposeAll(): Promise<DisposeAllOutcome> {
    const toDispose = this.#acquired;
    this.#acquired = [];
    this.#entries.clear();

    if (toDispose.length === 0) {
      return { ok: true, results: [] };
    }

    const results: ConnectionDisposeResult[] = await Promise.all(
      toDispose.map(async (entry): Promise<ConnectionDisposeResult> => {
        try {
          await entry.connector.disconnect();
          return { name: entry.name, engine: entry.engine, ok: true };
        } catch (err: unknown) {
          if (isDbConnectorError(err)) {
            return { name: entry.name, engine: entry.engine, ok: false, error: err };
          }
          return {
            name: entry.name,
            engine: entry.engine,
            ok: false,
            error: new DbConnectorError({
              code: DB_ERROR_CODES.DB_DISCONNECT_FAILED,
              phase: "disconnect",
              engine: entry.engine,
              message: `Failed to disconnect database "${entry.name}".`,
              cause: err,
            }),
          };
        }
      }),
    );

    const ok = results.every((r) => r.ok);
    return { ok, results };
  }
}

/**
 * Builds the production {@link ConnectorFactory}: maps each {@link DbEngine}
 * to a freshly constructed real connector over its OWN APPROVED default
 * driver seam. EXHAUSTIVE engine dispatch (§4 registry / `never`-default
 * idiom): adding a `DbEngine` member is a COMPILE error here until handled.
 * @returns The real-connector {@link ConnectorFactory}.
 */
export function createDefaultConnectorFactory(): ConnectorFactory {
  return {
    create(engine: DbEngine): DbConnector {
      switch (engine) {
        case "postgres": return new PostgresConnector();
        case "mysql":    return new MysqlConnector();
        case "mongodb":  return new MongodbConnector();
        case "neo4j":    return new Neo4jConnector();
        /* istanbul ignore next — provably unreachable: DbEngine is a closed 4-member
           union (postgres | mysql | mongodb | neo4j); env schema validation upstream
           rejects any non-union engine value before this switch is reached. */
        default: {
          const _exhaustive: never = engine;
          return _exhaustive;
        }
      }
    },
  };
}
