/**
 * OPT-IN LIVE E2E test for the §5 DB Connector Layer drivers.
 *
 * NOT part of the gated suite: lives under tests/e2e/** (excluded by
 * configs/vitest.config.ts) and only runs via `npm run test:e2e` using
 * configs/vitest.e2e.config.ts (REUSED unmodified — no coverage thresholds,
 * tests/e2e/** include, self-skip-safe).
 *
 * Per engine, skips unless the matching env var(s) are set. With NO env vars,
 * ALL four blocks skip cleanly (exit 0, no Docker, no network started).
 * Exactly mirrors the Alpaca `describe.skipIf(NO_CREDS)` pattern.
 *
 * Env-var contract (exact names):
 *   - Postgres: APIWRIGHT_E2E_PG_URL      e.g. postgres://user:pw@127.0.0.1:5432/apiwright_e2e
 *   - MySQL:    APIWRIGHT_E2E_MYSQL_URL   e.g. mysql://user:pw@127.0.0.1:3306/apiwright_e2e
 *   - MongoDB:  APIWRIGHT_E2E_MONGO_URL   e.g. mongodb://127.0.0.1:27017/apiwright_e2e
 *   - Neo4j:    APIWRIGHT_E2E_NEO4J_URL + APIWRIGHT_E2E_NEO4J_USER + APIWRIGHT_E2E_NEO4J_PASSWORD
 *                                          e.g. bolt://127.0.0.1:7687
 *
 * Credentials are read-only from env vars. NEVER logged, NEVER asserted as
 * substrings. Any failure surfaces as a secret-free DbConnectorError message
 * (the connector contract) — mirrors the Alpaca e2e's no-credential-echoing posture.
 *
 * The docker-compose.db-e2e.yml (sibling file) is the inert bring-up
 * artifact only — never auto-started by this test.
 */

import { describe, it, expect } from "vitest";

import {
  createRegistry,
  extractRefs,
  resolveRefs,
  bindForEngine,
  evaluate,
  isDbConnectorError,
} from "../../src/db/index.js";
import type { ResolvedEnvironment } from "../../src/env/index.js";

// ---- Env-var predicate constants -------------------------------------------

const PG_URL = process.env["APIWRIGHT_E2E_PG_URL"];
const MYSQL_URL = process.env["APIWRIGHT_E2E_MYSQL_URL"];
const MONGO_URL = process.env["APIWRIGHT_E2E_MONGO_URL"];
const NEO4J_URL = process.env["APIWRIGHT_E2E_NEO4J_URL"];
const NEO4J_USER = process.env["APIWRIGHT_E2E_NEO4J_USER"];
const NEO4J_PASSWORD = process.env["APIWRIGHT_E2E_NEO4J_PASSWORD"];

const NO_PG = !PG_URL;
const NO_MYSQL = !MYSQL_URL;
const NO_MONGO = !MONGO_URL;
const NO_NEO4J = !NEO4J_URL || !NEO4J_USER || !NEO4J_PASSWORD;

/** Per-test timeout: a real network connect + query can exceed the default. */
const NET_TIMEOUT_MS = 25_000;

// ---- Helpers ---------------------------------------------------------------

/**
 * Builds a minimal single-engine `ResolvedEnvironment` from the provided
 * connection name + config. No credentials stored — they come from env vars.
 * @param connName - The connection key under `databases`.
 * @param config - The `DatabaseConfig` (engine + url or host/port/etc.).
 * @returns A minimal `ResolvedEnvironment` suitable for `createRegistry`.
 */
function singleEngineEnv(
  connName: string,
  config: Record<string, unknown>,
): ResolvedEnvironment {
  return {
    name: "db-e2e",
    prod: false,
    base_url: "http://localhost",
    databases: { [connName]: config },
  };
}

/**
 * Asserts a value is a canonical `NormalizedResult` shape.
 * @param result - The value to assert.
 */
function expectNormalizedResultShape(result: unknown): void {
  expect(result).toBeDefined();
  const r = result as Record<string, unknown>;
  expect(Array.isArray(r["rows"])).toBe(true);
  expect(typeof r["rowCount"]).toBe("number");
  expect("raw" in r).toBe(true);
}

// ============================================================================
// Postgres (opt-in — skips unless APIWRIGHT_E2E_PG_URL is set)
// ============================================================================

describe.skipIf(NO_PG)("PostgreSQL live driver E2E (opt-in)", () => {
  it(
    "connects, parameterized SELECT, NormalizedResult shape, evaluate exists, disposeAll",
    async () => {
      const connName = "pg_e2e";
      const env = singleEngineEnv(connName, {
        type: "postgres",
        url: PG_URL,
      });

      const registry = createRegistry(env);
      let disposeOutcome;

      try {
        const conn = await registry.acquire(connName);

        // Build a parameterized query via the neutral pipeline
        const query = "SELECT $1::int AS v";
        const ext = extractRefs(
          "SELECT ${request.body.n}::int AS v",
        );
        expect(ext.ok).toBe(true);
        if (!ext.ok) return;

        const resolved = resolveRefs(ext.neutral.refs, {
          env: {},
          requestBody: { n: 7 },
        });
        expect(resolved.ok).toBe(true);
        if (!resolved.ok) return;

        const bound = bindForEngine("postgres", ext.neutral, resolved.values);
        expect(bound.ok).toBe(true);
        if (!bound.ok || bound.query.engine !== "postgres") return;

        const result = await conn.execute(bound.query.bound.text, {
          values: bound.query.bound.values,
        });
        expectNormalizedResultShape(result);
        // The bound parameter value 7 must be reflected in the result
        const firstRow = (result.rows[0] ?? {});
        expect(firstRow["v"]).toBe(7);

        const outcome = evaluate(result, {
          connection: connName,
          query,
          expect: "exists",
        });
        expect(outcome.pass).toBe(true);
      } catch (err: unknown) {
        if (isDbConnectorError(err)) {
          throw new Error(`DbConnectorError: ${err.message} (code=${err.code})`);
        }
        throw err;
      } finally {
        disposeOutcome = await registry.disposeAll();
        expect(disposeOutcome.ok).toBe(true);
      }
    },
    NET_TIMEOUT_MS,
  );
});

// ============================================================================
// MySQL (opt-in — skips unless APIWRIGHT_E2E_MYSQL_URL is set)
// ============================================================================

describe.skipIf(NO_MYSQL)("MySQL live driver E2E (opt-in)", () => {
  it(
    "connects, parameterized SELECT, NormalizedResult shape, evaluate exists, disposeAll",
    async () => {
      const connName = "mysql_e2e";
      const env = singleEngineEnv(connName, {
        type: "mysql",
        url: MYSQL_URL,
      });

      const registry = createRegistry(env);

      try {
        const conn = await registry.acquire(connName);

        const ext = extractRefs("SELECT ${request.body.n} AS v");
        expect(ext.ok).toBe(true);
        if (!ext.ok) return;

        const resolved = resolveRefs(ext.neutral.refs, {
          env: {},
          requestBody: { n: 7 },
        });
        expect(resolved.ok).toBe(true);
        if (!resolved.ok) return;

        const bound = bindForEngine("mysql", ext.neutral, resolved.values);
        expect(bound.ok).toBe(true);
        if (!bound.ok || bound.query.engine !== "mysql") return;

        const result = await conn.execute(bound.query.bound.sql, {
          values: bound.query.bound.values,
        });
        expectNormalizedResultShape(result);
        const firstRow = (result.rows[0] ?? {});
        expect(firstRow["v"]).toBe(7);

        const outcome = evaluate(result, {
          connection: connName,
          query: "SELECT ? AS v",
          expect: "exists",
        });
        expect(outcome.pass).toBe(true);
      } catch (err: unknown) {
        if (isDbConnectorError(err)) {
          throw new Error(`DbConnectorError: ${err.message} (code=${err.code})`);
        }
        throw err;
      } finally {
        const disposeOutcome = await registry.disposeAll();
        expect(disposeOutcome.ok).toBe(true);
      }
    },
    NET_TIMEOUT_MS,
  );
});

// ============================================================================
// MongoDB (opt-in — skips unless APIWRIGHT_E2E_MONGO_URL is set)
// ============================================================================

describe.skipIf(NO_MONGO)("MongoDB live driver E2E (opt-in)", () => {
  it(
    "connects, parameterized find, NormalizedResult shape, evaluate exists, disposeAll",
    async () => {
      const connName = "mongo_e2e";
      const env = singleEngineEnv(connName, {
        type: "mongodb",
        uri: MONGO_URL,
      });

      const registry = createRegistry(env);

      try {
        const conn = await registry.acquire(connName);

        // Mongo command: find with a value ref in the filter
        const mongoCmd = Object.freeze({
          find: "apiwright_e2e_health",
          filter: { n: "${request.body.n}" },
        });

        const ext = extractRefs(mongoCmd);
        expect(ext.ok).toBe(true);
        if (!ext.ok) return;

        const resolved = resolveRefs(ext.neutral.refs, {
          env: {},
          requestBody: { n: 7 },
        });
        expect(resolved.ok).toBe(true);
        if (!resolved.ok) return;

        const bound = bindForEngine("mongodb", ext.neutral, resolved.values);
        expect(bound.ok).toBe(true);
        if (!bound.ok || bound.query.engine !== "mongodb") return;

        const result = await conn.execute(bound.query.bound.document);
        expectNormalizedResultShape(result);

        // We don't assert specific rows (collection may be empty in CI)
        // but we assert the shape and that evaluate works
        const outcome = evaluate(result, {
          connection: connName,
          query: "find:apiwright_e2e_health",
          expect: result.rows.length > 0 ? "exists" : "not_exists",
        });
        expect(outcome.pass).toBe(true);
      } catch (err: unknown) {
        if (isDbConnectorError(err)) {
          throw new Error(`DbConnectorError: ${err.message} (code=${err.code})`);
        }
        throw err;
      } finally {
        const disposeOutcome = await registry.disposeAll();
        expect(disposeOutcome.ok).toBe(true);
      }
    },
    NET_TIMEOUT_MS,
  );
});

// ============================================================================
// Neo4j (opt-in — skips unless APIWRIGHT_E2E_NEO4J_URL + USER + PASSWORD set)
// ============================================================================

describe.skipIf(NO_NEO4J)("Neo4j live driver E2E (opt-in)", () => {
  it(
    "connects, parameterized RETURN, NormalizedResult shape, evaluate exists, disposeAll",
    async () => {
      const connName = "neo4j_e2e";
      const env = singleEngineEnv(connName, {
        type: "neo4j",
        uri: NEO4J_URL,
        user: NEO4J_USER,
        password: NEO4J_PASSWORD,
      });

      const registry = createRegistry(env);

      try {
        const conn = await registry.acquire(connName);

        const ext = extractRefs("RETURN ${request.body.n} AS v");
        expect(ext.ok).toBe(true);
        if (!ext.ok) return;

        const resolved = resolveRefs(ext.neutral.refs, {
          env: {},
          requestBody: { n: 7 },
        });
        expect(resolved.ok).toBe(true);
        if (!resolved.ok) return;

        const bound = bindForEngine("neo4j", ext.neutral, resolved.values);
        expect(bound.ok).toBe(true);
        if (!bound.ok || bound.query.engine !== "neo4j") return;

        const result = await conn.execute(bound.query.bound.cypher, {
          params: bound.query.bound.params,
        });
        expectNormalizedResultShape(result);
        const firstRow = (result.rows[0] ?? {});
        // Neo4j may return an Integer object or a number — shape is present
        expect(firstRow["v"]).toBeDefined();

        const outcome = evaluate(result, {
          connection: connName,
          query: "RETURN $p0 AS v",
          expect: "exists",
        });
        expect(outcome.pass).toBe(true);
      } catch (err: unknown) {
        if (isDbConnectorError(err)) {
          throw new Error(`DbConnectorError: ${err.message} (code=${err.code})`);
        }
        throw err;
      } finally {
        const disposeOutcome = await registry.disposeAll();
        expect(disposeOutcome.ok).toBe(true);
      }
    },
    NET_TIMEOUT_MS,
  );
});
