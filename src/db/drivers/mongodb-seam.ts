/**
 * Minimal injectable boundary over `mongodb` for the MongoDB connector.
 * Declares the `MongodbDriverSeam` interface and exports
 * `createDefaultMongodbSeam`, which lazily `require()`s the real `mongodb`
 * driver inside `open()`. Mirrors the same CJS-require idiom as
 * `swagger-parser-seam.ts` / `schema-validator.ts`.
 */

import type { ConnectionConfig } from "../types.js";

import { defaultDriverRequire, requireDriverOrThrow } from "./seam-shared.js";
import type { DriverRequireFn } from "./seam-shared.js";

/** Named constant for the mongodb npm module id. No magic strings. */
const MONGODB_MODULE_ID = "mongodb";

/** Secret-free install hint for the missing-driver error message. */
const MONGODB_INSTALL_HINT =
  'MongoDB driver "mongodb" is not installed. Run: npm install mongodb';

/** Fallback URI when config lacks explicit URI. */
const DEFAULT_MONGO_URI = "mongodb://localhost:27017";

/** A BSON/JSON document as a plain object (values driver-typed). */
export type MongoDocument = Record<string, unknown>;

/**
 * A parameterized Mongo operation: `command` is the resolved command/filter
 * document; `database` selects the db. (Parameter binding for Mongo = the
 * binder substituting resolved values INTO this document natively; the seam
 * receives the already-bound document — D3 honored upstream.)
 */
export interface MongoOperation {
  /** Target database name (from config/URI default if omitted upstream). */
  readonly database: string;
  /** The fully-resolved command/filter document to execute. */
  readonly command: Record<string, unknown>;
}

/**
 * The mongodb result a connector maps to `NormalizedResult`:
 * `documents` -> `rows`; the connector derives `rowCount` from a driver
 * count field when present else `documents.length`; the whole value -> `raw`.
 */
export interface MongoCommandResult {
  /**
   * Documents the command produced (e.g. cursor batch / `cursor.firstBatch`,
   * or `[]` for ack-only commands).
   */
  readonly documents: MongoDocument[];
  /**
   * Optional driver-reported affected/matched count (e.g. `n`, `nModified`);
   * `undefined` when the command reports none.
   */
  readonly affected?: number;
}

/**
 * Opaque per-connection mongodb handle (a connected `MongoClient` under the
 * default seam). Structural; the real `MongoClient` type is never imported.
 */
export interface MongoHandle {
  /** Brand. */
  readonly __mongoHandle: true;
}

/**
 * Minimal injectable boundary over `mongodb` for one connection: open
 * (connect a client) / run-one-command / close only. No sessions,
 * transactions, change streams, or pooling policy (deferred). Default factory
 * lazily wires `mongodb`.
 */
export interface MongodbDriverSeam {
  /**
   * Connects a Mongo client for the resolved connection config (URI-first).
   * @param config - One resolved databases entry.
   * @returns The opaque connected mongodb handle.
   */
  open(config: ConnectionConfig): Promise<MongoHandle>;

  /**
   * Runs ONE already-resolved command/filter document against the selected
   * database and returns its documents. No string interpolation occurs here;
   * native value substitution into the document is the binder's job.
   * @param handle - A handle from {@link open}.
   * @param operation - The resolved database + command document.
   * @returns The mongodb-shaped result to normalize.
   */
  runCommand(
    handle: MongoHandle,
    operation: MongoOperation,
  ): Promise<MongoCommandResult>;

  /**
   * Closes the client handle.
   * @param handle - The handle to close.
   */
  close(handle: MongoHandle): Promise<void>;
}

/** Minimal local interface for a MongoClient instance. */
interface MongoClientInstance {
  connect(): Promise<void>;
  db(name: string): { command(cmd: Record<string, unknown>): Promise<unknown> };
  close(): Promise<void>;
}

/** Minimal local interface for the lazily-required mongodb module. */
interface MongoModule {
  MongoClient: new (uri: string) => MongoClientInstance;
}

/** Internal branded client handle type. */
interface MongoBrandedClient extends MongoClientInstance {
  readonly __mongoHandle: true;
}

/**
 * The mongodb driver returns several shapes from `db.command(...)`:
 *
 *  - `find` / `aggregate` / `listCollections` → `{cursor: {firstBatch: [...]}}`
 *  - explicit `documents` (rare in command responses) → `{documents: [...]}`
 *  - ack-only DML (insert/update/delete) → `{ok: 1, n, nModified, ...}`
 *  - admin commands → various — fall back to `{documents: []}`
 *
 * apiwright's previous implementation only handled the second shape; every
 * `find` command therefore returned `{documents: []}` (the fallback). This
 * is the bug fix for issue #44 — pure, total, no exceptions. The connector's
 * downstream normalizer derives `rowCount` from `documents.length` for reads
 * and from `affected` for writes (see `mongodb-result-normalizer.ts`).
 * @param raw - The unknown value returned by mongodb's `db.command(...)`.
 * @returns A canonical {@link MongoCommandResult} for the connector.
 */
function normalizeMongoCommandResult(raw: unknown): MongoCommandResult {
  if (raw === null || typeof raw !== "object") {
    return { documents: [] };
  }
  const result = raw as Record<string, unknown>;
  // Cursor shape (find / aggregate / listCollections / listIndexes etc.)
  const cursor = result["cursor"] as
    | { firstBatch?: MongoDocument[] }
    | undefined;
  if (cursor && Array.isArray(cursor.firstBatch)) {
    return { documents: cursor.firstBatch };
  }
  // Explicit documents field — rare but harmless to keep.
  if ("documents" in result && Array.isArray(result["documents"])) {
    return { documents: result["documents"] as MongoDocument[] };
  }
  // Ack-only DML: read the first numeric counter present.
  const affected = readMongoAffectedCount(result);
  return affected === undefined
    ? { documents: [] }
    : { documents: [], affected };
}

/**
 * Reads the first numeric counter from a Mongo ack response. mongodb returns
 * `nModified` (updateMany), `nInserted` (insertMany), `nDeleted`
 * (deleteMany), or `n` (legacy / generic) depending on the command shape.
 * Returns `undefined` when none is present (e.g. admin-only commands).
 * @param result - The Mongo command response as a property bag.
 * @returns The first numeric counter found, or `undefined`.
 */
function readMongoAffectedCount(
  result: Record<string, unknown>,
): number | undefined {
  const keys = ["nModified", "nInserted", "nDeleted", "n"] as const;
  for (const key of keys) {
    const value = result[key];
    if (typeof value === "number") return value;
  }
  return undefined;
}

/**
 * Builds the default MongoDB seam backed by the real `mongodb` driver,
 * required LAZILY on first {@link MongodbDriverSeam.open} (importing this
 * module loads no driver). Unit tests inject `requireFn` to exercise the
 * lazy-wire and missing-driver branches without loading the real driver.
 * @param requireFn - CJS loader; defaults to Node `require`.
 * @returns A real-driver-backed {@link MongodbDriverSeam}.
 */
export function createDefaultMongodbSeam(
  requireFn?: DriverRequireFn,
): MongodbDriverSeam {
  const loader: DriverRequireFn = requireFn ?? defaultDriverRequire;

  return {
    open(config: ConnectionConfig): Promise<MongoHandle> {
      return Promise.resolve().then(async () => {
        const mod = requireDriverOrThrow(
          loader,
          MONGODB_MODULE_ID,
          "mongodb",
          MONGODB_INSTALL_HINT,
        ) as MongoModule;
        const cfg = config as Record<string, unknown>;
        const uri =
          typeof cfg["uri"] === "string"
            ? String(cfg["uri"])
            : DEFAULT_MONGO_URI;
        const client = new mod.MongoClient(uri);
        await client.connect();
        const branded: MongoBrandedClient = Object.assign(client, {
          __mongoHandle: true as const,
        });
        return branded;
      });
    },

    runCommand(
      handle: MongoHandle,
      operation: MongoOperation,
    ): Promise<MongoCommandResult> {
      const client = handle as unknown as MongoClientInstance;
      return client
        .db(operation.database)
        .command(operation.command)
        .then(normalizeMongoCommandResult);
    },

    close(handle: MongoHandle): Promise<void> {
      const client = handle as unknown as MongoClientInstance;
      return client.close();
    },
  };
}
