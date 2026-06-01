/**
 * Real-driver integration test for the PostgreSQL connector.
 *
 * Spins up a real `postgres:16-alpine` container via testcontainers, opens
 * the connector with the DEFAULT seam (which lazily `require()`s `pg`),
 * runs a parameterized query, and asserts the normalized result shape. This
 * is the layer between the unit tests (which use seam fakes — they prove the
 * connector talks correctly to ITS contract) and the apiwright-testing Python
 * harness (which proves the full CLI works end-to-end). Without this layer,
 * a bug where our seam fake declared a wrong shape relative to the real `pg`
 * client wouldn't be caught here.
 *
 * Skips when Docker isn't reachable (local dev without Docker, CI runners
 * that opt out via `SKIP_TESTCONTAINERS=true`).
 */

import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PostgresConnector } from "../../../../src/db/connectors/postgres-connector.js";
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
  },
);
