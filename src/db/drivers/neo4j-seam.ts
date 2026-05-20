/**
 * Minimal injectable boundary over `neo4j-driver` for the Neo4j connector.
 * Declares the `Neo4jDriverSeam` interface and exports
 * `createDefaultNeo4jSeam`, which lazily `require()`s the real `neo4j-driver`
 * inside `open()`. The seam owns session lifecycle (open per `run`, close
 * after). Mirrors the same CJS-require idiom as `swagger-parser-seam.ts` /
 * `schema-validator.ts`.
 */

import type { ConnectionConfig } from "../types.js";

import { requireDriverOrThrow } from "./seam-shared.js";
import type { DriverRequireFn } from "./seam-shared.js";

/** Named constant for the neo4j-driver npm module id. No magic strings. */
const NEO4J_MODULE_ID = "neo4j-driver";

/** Secret-free install hint for the missing-driver error message. */
const NEO4J_INSTALL_HINT =
  'Neo4j driver "neo4j-driver" is not installed. Run: npm install neo4j-driver';

/** Fallback URI when config lacks explicit URI. */
const DEFAULT_NEO4J_URI = "bolt://localhost:7687";

/** One Neo4j record as a plain object (`Record.toObject()` shape). */
export type Neo4jRecord = Record<string, unknown>;

/**
 * The neo4j result a connector maps to `NormalizedResult`:
 * `records` -> `rows`; the connector derives `rowCount` from
 * `countersTotal` (sum of write counters) when the query is a write, else
 * `records.length`; the whole value -> `raw`.
 */
export interface Neo4jQueryResult {
  /** Records the query produced (`[]` for pure write/ack queries). */
  readonly records: Neo4jRecord[];
  /**
   * Total nodes/relationships/properties changed (0 for read queries);
   * the connector uses it for non-record write statements.
   */
  readonly countersTotal: number;
}

/**
 * Opaque per-connection neo4j handle (a `neo4j.Driver` under the default
 * seam). Structural; the real `Driver` type is never imported.
 */
export interface Neo4jHandle {
  /** Brand. */
  readonly __neo4jHandle: true;
}

/**
 * Minimal injectable boundary over `neo4j-driver` for one connection: open
 * (create driver) / run-one-cypher (seam owns the per-call session
 * open+close) / close only. No explicit transactions, reactive sessions, or
 * pooling policy (deferred). Default factory lazily wires `neo4j-driver`.
 */
export interface Neo4jDriverSeam {
  /**
   * Creates the Neo4j driver for the resolved connection config (URI +
   * basic auth from `user`/`password`; precedence validation is the
   * connector's concern).
   * @param config - One resolved databases entry.
   * @returns The opaque neo4j driver handle.
   */
  open(config: ConnectionConfig): Promise<Neo4jHandle>;

  /**
   * Opens a session, runs ONE parameterized Cypher statement, closes the
   * session, and returns the result. `params` bind NATIVELY as Cypher
   * `$name` parameters — never interpolated into `cypher`.
   * @param handle - A handle from {@link open}.
   * @param cypher - Cypher text with `$name` parameters.
   * @param params - Named parameter map (resolved; may be `{}`).
   * @returns The neo4j-shaped result to normalize.
   */
  run(
    handle: Neo4jHandle,
    cypher: string,
    params: Readonly<Record<string, unknown>>,
  ): Promise<Neo4jQueryResult>;

  /**
   * Closes the driver handle.
   * @param handle - The handle to close.
   */
  close(handle: Neo4jHandle): Promise<void>;
}

/** Minimal local interface for a neo4j session result. */
interface Neo4jSessionResult {
  records: Array<{ toObject(): Record<string, unknown> }>;
  summary: {
    counters: {
      updates(): Record<string, number>;
    };
  };
}

/** Minimal local interface for a neo4j session. */
interface Neo4jSession {
  run(
    cypher: string,
    params: Record<string, unknown>,
  ): Promise<Neo4jSessionResult>;
  close(): Promise<void>;
}

/** Minimal local interface for a neo4j driver instance. */
interface Neo4jDriverInstance {
  session(): Neo4jSession;
  close(): Promise<void>;
}

/** Minimal local interface for the lazily-required neo4j-driver module. */
interface Neo4jModule {
  driver(uri: string, auth: unknown): Neo4jDriverInstance;
  auth: {
    basic(user: string, password: string): unknown;
  };
}

/** Internal branded driver handle type. */
interface Neo4jBrandedDriver extends Neo4jDriverInstance {
  readonly __neo4jHandle: true;
}

/**
 * Sum all numeric write counter values from the neo4j summary counters map.
 * @param updates - The `summary.counters.updates()` record.
 * @returns Sum of all positive counter values.
 */
function sumCounters(updates: Record<string, number>): number {
  return Object.values(updates).reduce(
    (acc: number, v: number) => acc + (v > 0 ? v : 0),
    0,
  );
}

/**
 * Builds the default Neo4j seam backed by the real `neo4j-driver`,
 * required LAZILY on first {@link Neo4jDriverSeam.open} (importing this
 * module loads no driver). The seam owns session lifecycle per `run()`.
 * Unit tests inject `requireFn` to exercise the lazy-wire and missing-driver
 * branches without loading the real driver.
 * @param requireFn - CJS loader; defaults to Node `require`.
 * @returns A real-driver-backed {@link Neo4jDriverSeam}.
 */
export function createDefaultNeo4jSeam(
  requireFn?: DriverRequireFn,
): Neo4jDriverSeam {
  // CJS driver, no ESM default; mirrors schema-validator.ts.
  // eslint-disable-next-line @typescript-eslint/no-require-imports, no-restricted-syntax
  const loader: DriverRequireFn = requireFn ?? ((id: string): unknown => require(id));

  return {
    open(config: ConnectionConfig): Promise<Neo4jHandle> {
      return Promise.resolve().then(() => {
        const mod = requireDriverOrThrow(
          loader,
          NEO4J_MODULE_ID,
          "neo4j",
          NEO4J_INSTALL_HINT,
        ) as Neo4jModule;
        const cfg = config as Record<string, unknown>;
        const uri =
          typeof cfg["uri"] === "string" ? String(cfg["uri"]) : DEFAULT_NEO4J_URI;
        const user = typeof cfg["user"] === "string" ? String(cfg["user"]) : "";
        const password =
          typeof cfg["password"] === "string" ? String(cfg["password"]) : "";
        const auth = mod.auth.basic(user, password);
        const driver = mod.driver(uri, auth);
        const branded: Neo4jBrandedDriver = Object.assign(driver, {
          __neo4jHandle: true as const,
        });
        return branded;
      });
    },

    run(
      handle: Neo4jHandle,
      cypher: string,
      params: Readonly<Record<string, unknown>>,
    ): Promise<Neo4jQueryResult> {
      const driver = handle as unknown as Neo4jDriverInstance;
      const session = driver.session();
      return session
        .run(cypher, params as Record<string, unknown>)
        .then((result: Neo4jSessionResult) => {
          const records = result.records.map((r) => r.toObject());
          const countersTotal = sumCounters(result.summary.counters.updates());
          return { records, countersTotal };
        })
        .finally(() => session.close());
    },

    close(handle: Neo4jHandle): Promise<void> {
      const driver = handle as unknown as Neo4jDriverInstance;
      return driver.close();
    },
  };
}
