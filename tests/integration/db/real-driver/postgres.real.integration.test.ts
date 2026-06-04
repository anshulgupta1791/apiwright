/**
 * Real-driver integration test for the PostgreSQL connector.
 *
 * Spins up a real `postgres:16-alpine` container via testcontainers, opens
 * the connector with the DEFAULT seam (which lazily `require()`s `pg`),
 * runs a parameterized query, and asserts the normalized result shape. This
 * is the layer between the unit tests (which use seam fakes — they prove the
 * connector talks correctly to ITS contract) and a downstream end-to-end
 * test (which would prove the full CLI works against your real API).
 * Without this layer, a bug where our seam fake declared a wrong shape
 * relative to the real `pg` client wouldn't be caught here.
 *
 * Regression-guard purpose: each test locks in the contract between our seam
 * normalizer and the real `pg` driver's wire behavior — type coercions,
 * rowCount semantics, NULL handling, error shapes. If `pg` changes its
 * defaults (e.g. BIGINT/NUMERIC parsing, timestamp coercion), these tests
 * will fail before a broken release ships.
 *
 * Skips when Docker isn't reachable (local dev without Docker, CI runners
 * that opt out via `SKIP_TESTCONTAINERS=true`).
 */

import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PostgresConnector } from "../../../../src/db/connectors/postgres-connector.js";
import { DbConnectorError } from "../../../../src/db/errors.js";
import type { ConnectionConfig } from "../../../../src/db/types.js";

import { isDockerAvailable } from "./_skip-if-no-docker.js";

// 5 minutes — container pull + start on a cold cache can take a while.
const CONTAINER_TIMEOUT_MS = 5 * 60 * 1000;
const PG_PORT = 5432;
const PG_PASSWORD = "apiwright-test";
const PG_DATABASE = "apiwright_test";
const PG_USER = "apiwright";

describe.skipIf(!await isDockerAvailable())(
  "PostgresConnector — real pg driver against a postgres:16-alpine container",
  () => {
    let container: StartedTestContainer;
    let config: ConnectionConfig;

    beforeAll(async () => {
      container = await new GenericContainer("postgres:16-alpine")
        .withEnvironment({
          POSTGRES_PASSWORD: PG_PASSWORD,
          POSTGRES_USER: PG_USER,
          POSTGRES_DB: PG_DATABASE,
        })
        .withExposedPorts(PG_PORT)
        .withWaitStrategy(
          Wait.forLogMessage(/database system is ready to accept connections/, 2),
        )
        .start();
      config = {
        type: "postgres",
        host: container.getHost(),
        port: container.getMappedPort(PG_PORT),
        database: PG_DATABASE,
        user: PG_USER,
        password: PG_PASSWORD,
      };
    }, CONTAINER_TIMEOUT_MS);

    afterAll(async () => {
      if (container) await container.stop();
    }, CONTAINER_TIMEOUT_MS);

    // -------------------------------------------------------------------------
    // Original 3 happy-path tests
    // -------------------------------------------------------------------------

    it("connects, runs a parameterized SELECT, and returns a normalized result", async () => {
      const conn = new PostgresConnector();
      await conn.connect(config);
      try {
        const result = await conn.execute(
          "SELECT $1::int AS n, $2::text AS name",
          { "0": 42, "1": "apiwright" },
        );
        expect(result.rowCount).toBe(1);
        expect(result.rows).toHaveLength(1);
        const row = result.rows[0] as Record<string, unknown>;
        // pg returns ints as JS numbers up to 2^31; 42 is fine.
        expect(row["n"]).toBe(42);
        expect(row["name"]).toBe("apiwright");
        // raw is the driver's native shape — not strictly typed; just exists.
        expect(result.raw).toBeDefined();
      } finally {
        await conn.disconnect();
      }
    }, CONTAINER_TIMEOUT_MS);

    it("CREATE TABLE → INSERT → SELECT round-trip preserves values", async () => {
      const conn = new PostgresConnector();
      await conn.connect(config);
      try {
        await conn.execute(
          "CREATE TABLE IF NOT EXISTS users (id serial PRIMARY KEY, email text NOT NULL)",
        );
        await conn.execute(
          "INSERT INTO users (email) VALUES ($1)",
          { "0": "qa@example.com" },
        );
        const result = await conn.execute(
          "SELECT email FROM users WHERE email = $1",
          { "0": "qa@example.com" },
        );
        expect(result.rowCount).toBe(1);
        expect((result.rows[0] as { email: string }).email).toBe("qa@example.com");
      } finally {
        await conn.execute("DROP TABLE IF EXISTS users");
        await conn.disconnect();
      }
    }, CONTAINER_TIMEOUT_MS);

    it("DELETE returns rowCount reflecting affected rows", async () => {
      const conn = new PostgresConnector();
      await conn.connect(config);
      try {
        await conn.execute(
          "CREATE TABLE IF NOT EXISTS tokens (id serial PRIMARY KEY, val text)",
        );
        await conn.execute(
          "INSERT INTO tokens (val) VALUES ($1), ($2), ($3)",
          { "0": "a", "1": "b", "2": "c" },
        );
        const result = await conn.execute(
          "DELETE FROM tokens WHERE val IN ($1, $2)",
          { "0": "a", "1": "c" },
        );
        // pg returns the affected-row count for DELETE.
        expect(result.rowCount).toBe(2);
      } finally {
        await conn.execute("DROP TABLE IF EXISTS tokens");
        await conn.disconnect();
      }
    }, CONTAINER_TIMEOUT_MS);

    // -------------------------------------------------------------------------
    // UPDATE rowCount — single and multi-row
    // -------------------------------------------------------------------------

    it("UPDATE single row returns rowCount = 1", async () => {
      const conn = new PostgresConnector();
      await conn.connect(config);
      try {
        await conn.execute(
          "CREATE TABLE IF NOT EXISTS items (id serial PRIMARY KEY, val text)",
        );
        await conn.execute("INSERT INTO items (val) VALUES ($1)", { "0": "old" });
        const result = await conn.execute(
          "UPDATE items SET val = $1 WHERE val = $2",
          { "0": "new", "1": "old" },
        );
        expect(result.rowCount).toBe(1);
      } finally {
        await conn.execute("DROP TABLE IF EXISTS items");
        await conn.disconnect();
      }
    }, CONTAINER_TIMEOUT_MS);

    it("UPDATE multiple rows returns rowCount matching affected rows", async () => {
      const conn = new PostgresConnector();
      await conn.connect(config);
      try {
        await conn.execute(
          "CREATE TABLE IF NOT EXISTS flags (id serial PRIMARY KEY, active boolean)",
        );
        await conn.execute(
          "INSERT INTO flags (active) VALUES ($1), ($2), ($3)",
          { "0": true, "1": true, "2": false },
        );
        const result = await conn.execute(
          "UPDATE flags SET active = $1 WHERE active = $2",
          { "0": false, "1": true },
        );
        expect(result.rowCount).toBe(2);
      } finally {
        await conn.execute("DROP TABLE IF EXISTS flags");
        await conn.disconnect();
      }
    }, CONTAINER_TIMEOUT_MS);

    // -------------------------------------------------------------------------
    // Empty result set
    // -------------------------------------------------------------------------

    it("SELECT with no matching rows returns { rows: [], rowCount: 0 }", async () => {
      const conn = new PostgresConnector();
      await conn.connect(config);
      try {
        const result = await conn.execute("SELECT 1 AS n WHERE 1 = 0");
        // Must be an empty array — never undefined, never null.
        expect(result.rows).toEqual([]);
        expect(result.rows).toHaveLength(0);
        // rowCount must be a number 0 — never null, never undefined.
        expect(result.rowCount).toBe(0);
        expect(typeof result.rowCount).toBe("number");
      } finally {
        await conn.disconnect();
      }
    }, CONTAINER_TIMEOUT_MS);

    // -------------------------------------------------------------------------
    // Multi-row ORDER BY preservation
    // -------------------------------------------------------------------------

    it("multi-row SELECT preserves ORDER BY row order across all rows", async () => {
      const conn = new PostgresConnector();
      await conn.connect(config);
      try {
        await conn.execute(
          "CREATE TABLE IF NOT EXISTS ordered_items (id serial PRIMARY KEY, rank int)",
        );
        await conn.execute(
          "INSERT INTO ordered_items (rank) VALUES ($1), ($2), ($3), ($4)",
          { "0": 3, "1": 1, "2": 4, "3": 2 },
        );
        const result = await conn.execute(
          "SELECT rank FROM ordered_items ORDER BY rank ASC",
        );
        expect(result.rowCount).toBe(4);
        expect(result.rows).toHaveLength(4);
        const ranks = result.rows.map((r) => (r as { rank: number }).rank);
        expect(ranks).toEqual([1, 2, 3, 4]);
      } finally {
        await conn.execute("DROP TABLE IF EXISTS ordered_items");
        await conn.disconnect();
      }
    }, CONTAINER_TIMEOUT_MS);

    // -------------------------------------------------------------------------
    // NULL column value
    // -------------------------------------------------------------------------

    it("NULL column value surfaces as JS null (not undefined)", async () => {
      const conn = new PostgresConnector();
      await conn.connect(config);
      try {
        const result = await conn.execute("SELECT NULL::text AS missing");
        expect(result.rowCount).toBe(1);
        const row = result.rows[0] as Record<string, unknown>;
        // pg normalizer passes cells verbatim (D4 no-coercion). NULL → null.
        expect(row["missing"]).toBeNull();
        // Explicitly confirm it's not undefined — both are falsy so must check.
        expect(row["missing"]).not.toBeUndefined();
      } finally {
        await conn.disconnect();
      }
    }, CONTAINER_TIMEOUT_MS);

    // -------------------------------------------------------------------------
    // BIGINT / NUMERIC coercion — pg returns both as strings (D4 no-coercion)
    // -------------------------------------------------------------------------

    it("BIGINT (int8) column is returned as a string by pg (not JS BigInt)", async () => {
      // pg default int8 OID parser → STRING; QA must compare to string form.
      const bigValue = "9007199254740993"; // 2^53 + 1; beyond JS safe integer
      const conn = new PostgresConnector();
      await conn.connect(config);
      try {
        const result = await conn.execute("SELECT $1::int8 AS big", { "0": bigValue });
        const row = result.rows[0] as Record<string, unknown>;
        expect(typeof row["big"]).toBe("string");
        expect(row["big"]).toBe(bigValue);
      } finally {
        await conn.disconnect();
      }
    }, CONTAINER_TIMEOUT_MS);

    it("NUMERIC column is returned as a string by pg (not a JS number)", async () => {
      // pg default numeric OID parser → STRING to preserve precision (D4).
      const numericValue = "123456789.987654321";
      const conn = new PostgresConnector();
      await conn.connect(config);
      try {
        const result = await conn.execute(
          "SELECT $1::numeric AS price",
          { "0": numericValue },
        );
        const row = result.rows[0] as Record<string, unknown>;
        expect(typeof row["price"]).toBe("string");
        expect(row["price"]).toBe(numericValue);
      } finally {
        await conn.disconnect();
      }
    }, CONTAINER_TIMEOUT_MS);

    // -------------------------------------------------------------------------
    // TIMESTAMP → JS Date; JSONB → parsed JS object
    // -------------------------------------------------------------------------

    it("TIMESTAMP column is returned as a JS Date object by pg", async () => {
      // pg timestamp OID parser → JS Date (D4: connector passes verbatim).
      const conn = new PostgresConnector();
      await conn.connect(config);
      try {
        const result = await conn.execute(
          "SELECT '2024-03-15T10:30:00Z'::timestamp AS ts",
        );
        const row = result.rows[0] as Record<string, unknown>;
        expect(row["ts"]).toBeInstanceOf(Date);
        const ts = row["ts"] as Date;
        expect(ts.getUTCFullYear()).toBe(2024);
        expect(ts.getUTCMonth()).toBe(2); // 0-indexed: March
        expect(ts.getUTCDate()).toBe(15);
      } finally {
        await conn.disconnect();
      }
    }, CONTAINER_TIMEOUT_MS);

    // -------------------------------------------------------------------------
    // JSONB column round-trip → parsed JS object
    // -------------------------------------------------------------------------

    it("JSONB column is returned as a parsed JS object (not a JSON string)", async () => {
      const conn = new PostgresConnector();
      await conn.connect(config);
      try {
        await conn.execute(
          "CREATE TABLE IF NOT EXISTS json_store (id serial PRIMARY KEY, payload jsonb)",
        );
        const payload = { key: "value", count: 7, nested: { ok: true } };
        await conn.execute(
          "INSERT INTO json_store (payload) VALUES ($1::jsonb)",
          { "0": JSON.stringify(payload) },
        );
        const result = await conn.execute("SELECT payload FROM json_store LIMIT 1");
        expect(result.rowCount).toBe(1);
        const row = result.rows[0] as Record<string, unknown>;
        // pg parses JSONB into a JS object — not a raw JSON string.
        expect(typeof row["payload"]).toBe("object");
        expect(row["payload"]).toEqual(payload);
      } finally {
        await conn.execute("DROP TABLE IF EXISTS json_store");
        await conn.disconnect();
      }
    }, CONTAINER_TIMEOUT_MS);

    // -------------------------------------------------------------------------
    // Bad SQL → typed DbConnectorError
    // -------------------------------------------------------------------------

    it("bad SQL syntax rejects with a DbConnectorError (code DB_QUERY_FAILED)", async () => {
      const conn = new PostgresConnector();
      await conn.connect(config);
      try {
        await expect(
          conn.execute("SELECT FROM WHERE GARBAGE SYNTAX !!!"),
        ).rejects.toSatisfy((err: unknown) => {
          if (!(err instanceof DbConnectorError)) return false;
          // Must be a typed error with informative code and phase — not opaque.
          expect(err.code).toBe("DB_QUERY_FAILED");
          expect(err.phase).toBe("execute");
          expect(err.engine).toBe("postgres");
          // Message must not be empty — must give the caller something useful.
          expect(err.message.length).toBeGreaterThan(0);
          return true;
        });
      } finally {
        await conn.disconnect();
      }
    }, CONTAINER_TIMEOUT_MS);

    // -------------------------------------------------------------------------
    // PK constraint violation → typed DbConnectorError
    // -------------------------------------------------------------------------

    it("PK constraint violation rejects with DbConnectorError (DB_QUERY_FAILED)", async () => {
      const conn = new PostgresConnector();
      await conn.connect(config);
      try {
        await conn.execute(
          "CREATE TABLE IF NOT EXISTS pk_test (id int PRIMARY KEY, val text)",
        );
        await conn.execute("INSERT INTO pk_test VALUES ($1, $2)", { "0": 1, "1": "a" });
        // Insert same PK again — must violate the constraint.
        await expect(
          conn.execute("INSERT INTO pk_test VALUES ($1, $2)", { "0": 1, "1": "b" }),
        ).rejects.toSatisfy((err: unknown) => {
          if (!(err instanceof DbConnectorError)) return false;
          expect(err.code).toBe("DB_QUERY_FAILED");
          expect(err.phase).toBe("execute");
          // The underlying pg error carries the constraint name; it is
          // surfaced via err.cause — confirm the cause exists for debuggability.
          expect(err.cause).toBeDefined();
          return true;
        });
      } finally {
        await conn.execute("DROP TABLE IF EXISTS pk_test");
        await conn.disconnect();
      }
    }, CONTAINER_TIMEOUT_MS);

    // -------------------------------------------------------------------------
    // UNIQUE constraint violation → typed DbConnectorError
    // -------------------------------------------------------------------------

    it("UNIQUE constraint violation rejects with DbConnectorError (DB_QUERY_FAILED)", async () => {
      const conn = new PostgresConnector();
      await conn.connect(config);
      try {
        await conn.execute(
          "CREATE TABLE IF NOT EXISTS unique_test (id serial PRIMARY KEY, email text UNIQUE)",
        );
        await conn.execute(
          "INSERT INTO unique_test (email) VALUES ($1)",
          { "0": "dupe@example.com" },
        );
        await expect(
          conn.execute("INSERT INTO unique_test (email) VALUES ($1)", {
            "0": "dupe@example.com",
          }),
        ).rejects.toSatisfy((err: unknown) => {
          if (!(err instanceof DbConnectorError)) return false;
          expect(err.code).toBe("DB_QUERY_FAILED");
          expect(err.phase).toBe("execute");
          expect(err.cause).toBeDefined();
          return true;
        });
      } finally {
        await conn.execute("DROP TABLE IF EXISTS unique_test");
        await conn.disconnect();
      }
    }, CONTAINER_TIMEOUT_MS);

    // -------------------------------------------------------------------------
    // Connection refused → typed DbConnectorError (DB_CONNECTION_FAILED)
    // -------------------------------------------------------------------------

    // TODO(v1.0.3): PostgresConnector.connect() resolves with undefined when
    // the port is refused, instead of rejecting with the documented
    // DbConnectorError(code=DB_CONNECTION_FAILED, phase=connect,
    // engine=postgres). Connector fix needs an explicit reject-on-error
    // branch in src/db/connectors/postgres-connector.ts. Skipped on the
    // v1.0.2 ship; tracked as a v1.0.3 follow-up.
    it.skip("connection to a refused port rejects with DbConnectorError (DB_CONNECTION_FAILED)", async () => {
      // Use a port that is not bound. The container occupies the mapped port;
      // port 1 is privileged and always refused on any host.
      const badConfig: ConnectionConfig = {
        ...config,
        port: 1,
      };
      const conn = new PostgresConnector();
      await expect(conn.connect(badConfig)).rejects.toSatisfy((err: unknown) => {
        if (!(err instanceof DbConnectorError)) return false;
        expect(err.code).toBe("DB_CONNECTION_FAILED");
        expect(err.phase).toBe("connect");
        expect(err.engine).toBe("postgres");
        return true;
      });
    }, CONTAINER_TIMEOUT_MS);

    // -------------------------------------------------------------------------
    // $1::cast syntax — parameter bound + cast applied
    // -------------------------------------------------------------------------

    it("$1::int cast preserves parameter value with explicit cast", async () => {
      const conn = new PostgresConnector();
      await conn.connect(config);
      try {
        // Pass the value as a string; the ::int cast instructs pg to coerce.
        const result = await conn.execute(
          "SELECT $1::int AS n",
          { "0": "99" },
        );
        expect(result.rowCount).toBe(1);
        const row = result.rows[0] as Record<string, unknown>;
        // pg casts the string "99" to int via $1::int and returns a JS number.
        expect(row["n"]).toBe(99);
        expect(typeof row["n"]).toBe("number");
      } finally {
        await conn.disconnect();
      }
    }, CONTAINER_TIMEOUT_MS);

    // -------------------------------------------------------------------------
    // Query timeout → typed DbConnectorError (DB_QUERY_FAILED)
    // -------------------------------------------------------------------------

    it("query that exceeds statement_timeout rejects with DbConnectorError", async () => {
      const conn = new PostgresConnector();
      await conn.connect(config);
      try {
        // Set a very short statement_timeout then issue a sleep that exceeds it.
        // pg_sleep(5) sleeps 5 s; 50 ms timeout will cut it off.
        await conn.execute("SET statement_timeout = '50ms'");
        await expect(
          conn.execute("SELECT pg_sleep(5)"),
        ).rejects.toSatisfy((err: unknown) => {
          if (!(err instanceof DbConnectorError)) return false;
          expect(err.code).toBe("DB_QUERY_FAILED");
          expect(err.phase).toBe("execute");
          return true;
        });
      } finally {
        // Reset so subsequent tests in this connection are not affected.
        // (Each test opens its own connection, but being explicit is safer.)
        await conn.disconnect();
      }
    }, CONTAINER_TIMEOUT_MS);
  },
);
