/**
 * MongoDB connector implementing {@link DbConnector}. Wires the
 * {@link MongodbDriverSeam} seam, the mongo engine-param-binder, and the
 * {@link mapMongoResult} normalizer into one lifecycle object.
 *
 * Delta 0 (MongoDB-specific): `execute()` calls `parseJson` (NEVER raw
 *   JSON.parse) on the query string to produce the command document.
 * D3: values are substituted into document VALUE leaves by the binder;
 *   document KEYS are never derived from values; the seam receives a
 *   document object, not a query string.
 * D4: {@link mapMongoResult} performs zero field coercion.
 * Secret-safety: error messages are code-derived, never echoing the URI,
 *   query text, or any parameter value.
 */

import type { NormalizedResult } from "../../core/normalized-result.js";
import { parseJson } from "../../core/safe-json.js";
import type { MongodbDriverSeam, MongoHandle } from "../drivers/mongodb-seam.js";
import { createDefaultMongodbSeam } from "../drivers/mongodb-seam.js";
import { DbConnectorError, isDbConnectorError, DB_ERROR_CODES } from "../errors.js";
import { bindMongo } from "../templating/mongo-binder.js";
import type { BoundValue, NeutralQuery } from "../templating/types.js";
import type { ConnectionConfig, QueryParams } from "../types.js";

import { mapMongoResult } from "./mongodb-result-normalizer.js";

/** Engine identifier constant for MongodbConnector error reporting. */
const ENGINE = "mongodb" as const;

/** Fallback database name when config does not specify one. */
const DEFAULT_DATABASE = "admin";

/** Not-connected sentinel message (lowercase so the test `.toLowerCase()` matches). */
const NOT_CONNECTED_MSG = "MongoDB connector: not connected. Call connect() first.";

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
 * Builds a minimal {@link NeutralQuery} from a parsed Mongo command document.
 * For the no-sentinel case (no params), refs and occurrences are empty.
 * @param doc - The parsed command document (plain object).
 * @param values - The ordered BoundValues (one per distinct ref).
 * @returns A minimal NeutralQuery with object-shaped neutralQuery.
 */
function buildNeutral(
  doc: Record<string, unknown>,
  values: readonly BoundValue[],
): NeutralQuery {
  const refs = values.map((v) => ({
    index: v.index,
    namespace: "env" as const,
    path: String(v.index),
    raw: `\${env.${String(v.index)}}`,
  }));
  return {
    neutralQuery: doc,
    refs,
    occurrences: refs.map((r) => ({ refIndex: r.index })),
    source: { kind: "mongo-document" as const },
  };
}

/**
 * Extracts the database name from a resolved connection config.
 * Falls back to {@link DEFAULT_DATABASE} when absent.
 * @param config - The resolved connection configuration.
 * @returns The database name string.
 */
function extractDatabase(config: ConnectionConfig): string {
  const cfg = config as Record<string, unknown>;
  return typeof cfg["database"] === "string" ? cfg["database"] : DEFAULT_DATABASE;
}

// ---------------------------------------------------------------------------
// MongodbConnector
// ---------------------------------------------------------------------------

/**
 * MongoDB connector implementing the {@link DbConnector} contract.
 *
 * Lifecycle: construct → connect(config) → execute(query[, params])* →
 * disconnect(). The injected {@link MongodbDriverSeam} defaults to the real
 * `mongodb`-backed seam; tests supply a hand-written fake.
 */
export class MongodbConnector {
  readonly #seam: MongodbDriverSeam;
  #handle: MongoHandle | undefined;
  #database: string;

  /**
   * Constructs a MongodbConnector.
   * @param seam - Injectable {@link MongodbDriverSeam}; defaults to the real
   *   `mongodb`-backed seam (lazily loaded).
   */
  constructor(seam?: MongodbDriverSeam) {
    this.#seam = seam ?? createDefaultMongodbSeam();
    this.#database = DEFAULT_DATABASE;
  }

  /**
   * Opens the MongoDB client handle and stores it internally.
   * @param config - Resolved connection configuration.
   * @returns Resolves void on success.
   * @throws {DbConnectorError} code DB_CONNECTION_FAILED / phase "connect".
   */
  async connect(config: ConnectionConfig): Promise<void> {
    try {
      this.#database = extractDatabase(config);
      this.#handle = await this.#seam.open(config);
    } catch (cause: unknown) {
      if (isDbConnectorError(cause)) throw cause;
      throw new DbConnectorError({
        code: DB_ERROR_CODES.DB_CONNECTION_FAILED,
        phase: "connect",
        engine: ENGINE,
        message: "MongoDB connector: connection failed.",
        cause,
      });
    }
  }

  /**
   * Parses the JSON command string, binds params into the document, and
   * executes via the seam.
   *
   * Delta 0: `parseJson` (never raw `JSON.parse`) on the query string.
   * Non-object parse result → `DB_QUERY_FAILED`.
   * @param query - JSON-serialized MongoDB command document string.
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

    // Delta 0: parse the JSON query string (never raw JSON.parse)
    const parseResult = parseJson(query);
    if (!parseResult.ok) {
      throw new DbConnectorError({
        code: DB_ERROR_CODES.DB_QUERY_FAILED,
        phase: "execute",
        engine: ENGINE,
        message: "MongoDB connector: command string is not valid JSON.",
      });
    }

    const parsed = parseResult.value;
    // Must be a plain object (not array, not null, not scalar)
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      throw new DbConnectorError({
        code: DB_ERROR_CODES.DB_QUERY_FAILED,
        phase: "execute",
        engine: ENGINE,
        message: "MongoDB connector: command must be a plain JSON object, not an array or scalar.",
      });
    }

    const commandDoc = parsed as Record<string, unknown>;
    const values = paramsToValues(params);
    const neutral = buildNeutral(commandDoc, values);
    const bindResult = bindMongo(neutral, values);

    /* istanbul ignore next — provably unreachable: buildNeutral creates refs and
       occurrences in perfect 1:1 alignment with values; checkContract can never
       detect a mismatch given this connector's NeutralQuery construction. */
    if (!bindResult.ok) {
      throw bindResult.error;
    }

    // Narrow the discriminated union: bindMongo always returns engine "mongodb"
    const engineQuery = bindResult.query;
    /* istanbul ignore next — bindMongo always returns engine:"mongodb"; other arms unreachable */
    if (engineQuery.engine !== "mongodb") {
      throw new DbConnectorError({
        code: DB_ERROR_CODES.DB_QUERY_FAILED,
        phase: "execute",
        engine: ENGINE,
        message: "MongoDB connector: unexpected binder engine tag.",
      });
    }
    const { document } = engineQuery.bound;

    try {
      const mongoResult = await this.#seam.runCommand(handle, {
        database: this.#database,
        command: document as Record<string, unknown>,
      });
      return mapMongoResult(mongoResult);
    } catch (cause: unknown) {
      if (isDbConnectorError(cause)) throw cause;
      throw new DbConnectorError({
        code: DB_ERROR_CODES.DB_QUERY_FAILED,
        phase: "execute",
        engine: ENGINE,
        message: "MongoDB connector: command execution failed.",
        cause,
      });
    }
  }

  /**
   * Closes the MongoDB client handle. No-op when not connected. Clears the
   * handle in `finally` so a failed close leaves no dangling reference.
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
        message: "MongoDB connector: disconnect failed.",
        cause,
      });
    } finally {
      this.#handle = undefined;
    }
  }
}
