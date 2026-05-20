/**
 * Neo4j connector implementing {@link DbConnector}. Wires the
 * {@link Neo4jDriverSeam} seam, the neo4j engine-param-binder, and the
 * {@link mapNeo4jResult} normalizer into one lifecycle object.
 *
 * D3: values never reach the Cypher text — the neo4j binder places `$name`
 *   tokens in the Cypher and passes values in a separate params map; the seam
 *   binds them natively. The connector NEVER calls `session()` — session
 *   lifecycle is the seam's concern.
 * D4: {@link mapNeo4jResult} performs zero field coercion.
 * Secret-safety: error messages are code-derived, never echoing the bolt URI,
 *   auth token, Cypher text, or any parameter value.
 */

import type { NormalizedResult } from "../../core/normalized-result.js";
import type { Neo4jDriverSeam, Neo4jHandle } from "../drivers/neo4j-seam.js";
import { createDefaultNeo4jSeam } from "../drivers/neo4j-seam.js";
import { DbConnectorError, isDbConnectorError, DB_ERROR_CODES } from "../errors.js";
import { bindNeo4j } from "../templating/neo4j-binder.js";
import type { BoundValue, NeutralQuery } from "../templating/types.js";
import type { ConnectionConfig, QueryParams } from "../types.js";

import { mapNeo4jResult } from "./neo4j-result-normalizer.js";

/** Engine identifier constant for Neo4jConnector error reporting. */
const ENGINE = "neo4j" as const;

/** Not-connected sentinel message (lowercase so the test `.toLowerCase()` matches). */
const NOT_CONNECTED_MSG = "Neo4j connector: not connected. Call connect() first.";

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
 * Builds a minimal {@link NeutralQuery} from a plain Cypher string.
 * @param query - The Cypher string (may contain sentinel placeholders or `$name`).
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
// Neo4jConnector
// ---------------------------------------------------------------------------

/**
 * Neo4j connector implementing the {@link DbConnector} contract.
 *
 * Lifecycle: construct → connect(config) → execute(query[, params])* →
 * disconnect(). The injected {@link Neo4jDriverSeam} defaults to the real
 * `neo4j-driver`-backed seam; tests supply a hand-written fake.
 *
 * Session lifecycle is entirely the seam's concern: the connector calls
 * `seam.run(handle, cypher, params)` and never touches `handle.session()`.
 */
export class Neo4jConnector {
  readonly #seam: Neo4jDriverSeam;
  #handle: Neo4jHandle | undefined;

  /**
   * Constructs a Neo4jConnector.
   * @param seam - Injectable {@link Neo4jDriverSeam}; defaults to the real
   *   `neo4j-driver`-backed seam (lazily loaded).
   */
  constructor(seam?: Neo4jDriverSeam) {
    this.#seam = seam ?? createDefaultNeo4jSeam();
  }

  /**
   * Opens the Neo4j driver handle and stores it internally.
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
        message: "Neo4j connector: connection failed.",
        cause,
      });
    }
  }

  /**
   * Executes a parameterized Cypher statement and normalizes the result.
   * @param query - Cypher text (may include sentinel placeholders or `$name`).
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
    const bindResult = bindNeo4j(neutral, values);

    /* istanbul ignore next — provably unreachable: buildNeutral creates refs and
       occurrences in perfect 1:1 alignment with values; checkContract can never
       detect a mismatch given this connector's NeutralQuery construction. */
    if (!bindResult.ok) {
      throw bindResult.error;
    }

    // Narrow the discriminated union: bindNeo4j always returns engine "neo4j"
    const engineQuery = bindResult.query;
    /* istanbul ignore next — bindNeo4j always returns engine:"neo4j"; other arms unreachable */
    if (engineQuery.engine !== "neo4j") {
      throw new DbConnectorError({
        code: DB_ERROR_CODES.DB_QUERY_FAILED,
        phase: "execute",
        engine: ENGINE,
        message: "Neo4j connector: unexpected binder engine tag.",
      });
    }
    const { cypher, params: boundParams } = engineQuery.bound;

    try {
      const neo4jResult = await this.#seam.run(handle, cypher, boundParams);
      return mapNeo4jResult(neo4jResult);
    } catch (cause: unknown) {
      if (isDbConnectorError(cause)) throw cause;
      throw new DbConnectorError({
        code: DB_ERROR_CODES.DB_QUERY_FAILED,
        phase: "execute",
        engine: ENGINE,
        message: "Neo4j connector: query execution failed.",
        cause,
      });
    }
  }

  /**
   * Closes the Neo4j driver handle. No-op when not connected. Clears the
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
        message: "Neo4j connector: disconnect failed.",
        cause,
      });
    } finally {
      this.#handle = undefined;
    }
  }
}
