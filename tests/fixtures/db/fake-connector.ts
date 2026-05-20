/**
 * Injected fake `ConnectorFactory` and fake `DbConnector` for the §5 corpus.
 *
 * The fake factory is the SOLE injection seam — the real
 * `createDefaultConnectorFactory` is NOT used. Every `connect`/`execute`/
 * `disconnect` call is counted; `execute` returns a deterministic synthetic
 * `NormalizedResult`.
 *
 * No real driver, no Docker, no network, no randomness, no clock.
 * Named exports only; no default export.
 */

import type {
  ConnectorFactory,
  DbConnector,
  DbEngine,
  ConnectionConfig,
  QueryParams,
  NormalizedResult,
} from "../../../src/db/index.js";
import { DbConnectorError } from "../../../src/db/index.js";

/** One recorded `execute` call (query + params). */
export interface ExecuteCall {
  readonly query: string | Readonly<Record<string, unknown>>;
  readonly params: QueryParams | undefined;
}

/** Spy counters and recorded calls for one fake connector instance. */
export interface FakeConnectorSpy {
  /** Number of `connect()` calls. */
  connectCalls: number;
  /** Number of `disconnect()` calls. */
  disconnectCalls: number;
  /** Recorded `(query, params)` pairs from every `execute()` call. */
  executedWith: ExecuteCall[];
}

/** A fake `DbConnector` + its spy counters. */
export interface FakeConnector extends DbConnector {
  readonly spy: FakeConnectorSpy;
}

/** Options for one fake connector instance. */
export interface FakeConnectorOpts {
  /** If true, `connect()` rejects with a `DbConnectorError`. */
  readonly connectRejects?: boolean;
  /** If true, `disconnect()` rejects with a `DbConnectorError`. */
  readonly disconnectRejects?: boolean;
  /** The synthetic result `execute()` returns (default: `{rows:[],rowCount:0,raw:null}`). */
  readonly executeResult?: NormalizedResult;
  /** Engine tag used in error messages. */
  readonly engine: DbEngine;
  /** Connection name used in error messages. */
  readonly name: string;
}

/**
 * Builds one fake `DbConnector` that records calls and returns synthetic results.
 * @param opts - Configuration for the fake connector.
 * @returns A fake `DbConnector` with spy counters attached.
 */
export function buildFakeConnector(opts: FakeConnectorOpts): FakeConnector {
  const spy: FakeConnectorSpy = {
    connectCalls: 0,
    disconnectCalls: 0,
    executedWith: [],
  };

  const defaultResult: NormalizedResult = { rows: [], rowCount: 0, raw: null };

  return {
    spy,

    async connect(_config: ConnectionConfig): Promise<void> {
      spy.connectCalls++;
      if (opts.connectRejects === true) {
        throw new DbConnectorError({
          code: "DB_CONNECTION_FAILED",
          phase: "connect",
          engine: opts.engine,
          message: `fake connect failure for ${opts.name}`,
        });
      }
    },

    async execute(
      query: string | Readonly<Record<string, unknown>>,
      params?: QueryParams,
    ): Promise<NormalizedResult> {
      spy.executedWith.push({ query, params });
      return opts.executeResult ?? defaultResult;
    },

    async disconnect(): Promise<void> {
      spy.disconnectCalls++;
      if (opts.disconnectRejects === true) {
        throw new DbConnectorError({
          code: "DB_CONNECTION_FAILED",
          phase: "disconnect",
          engine: opts.engine,
          message: `fake disconnect failure for ${opts.name}`,
        });
      }
    },
  };
}

/** Spy collected across all connectors produced by the factory. */
export interface FakeFactorySpy {
  /** Number of times `create(engine)` was called per engine. */
  createCounts: Map<DbEngine, number>;
}

/** Return type of `makeFakeFactory`. */
export interface FakeFactoryResult {
  readonly factory: ConnectorFactory;
  readonly spy: FakeFactorySpy;
}

/**
 * Builds a fake `ConnectorFactory` that returns a fresh `FakeConnector` per
 * `create()` call. All connectors succeed by default.
 * @returns `{ factory, spy }`.
 */
export function makeFakeFactory(): FakeFactoryResult {
  const spy: FakeFactorySpy = { createCounts: new Map() };
  let callIndex = 0;

  const factory: ConnectorFactory = {
    create(engine: DbEngine): DbConnector {
      const n = (spy.createCounts.get(engine) ?? 0) + 1;
      spy.createCounts.set(engine, n);
      callIndex++;
      return buildFakeConnector({ engine, name: `${engine}-${callIndex}` });
    },
  };

  return { factory, spy };
}

/**
 * Builds a `ConnectorFactory` backed by a per-engine pre-built connector map.
 * `create(engine)` returns the pre-built connector for that engine.
 * @param connectorByEngine - Map from engine → pre-built FakeConnector.
 * @returns A `ConnectorFactory`.
 */
export function makeEngineBackedFactory(
  connectorByEngine: ReadonlyMap<DbEngine, FakeConnector>,
): ConnectorFactory {
  return {
    create(engine: DbEngine): DbConnector {
      const conn = connectorByEngine.get(engine);
      if (conn !== undefined) return conn;
      // Fallback for engines not in the map
      return buildFakeConnector({ engine, name: `${engine}-fallback` });
    },
  };
}

/**
 * Builds a flat fake `NormalizedResult`.
 * @param rows - The row array.
 * @param rowCount - Override rowCount (defaults to rows.length).
 * @returns A `NormalizedResult`.
 */
export function fakeRows(
  rows: Record<string, unknown>[],
  rowCount?: number,
): NormalizedResult {
  return { rows, rowCount: rowCount ?? rows.length, raw: null };
}
