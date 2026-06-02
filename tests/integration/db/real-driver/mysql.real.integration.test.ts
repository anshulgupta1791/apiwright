/**
 * Real-driver integration test for the MySQL connector.
 *
 * Spins up a real `mysql:8` container via testcontainers and exercises
 * the connector with the DEFAULT seam (which lazily `require()`s the real
 * `mysql2` driver). MySQL takes parameterized SQL with `?` placeholders.
 *
 * Skips when Docker isn't reachable.
 */

import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MysqlConnector } from "../../../../src/db/connectors/mysql-connector.js";
import type { ConnectionConfig } from "../../../../src/db/types.js";

import { isDockerAvailable } from "./_skip-if-no-docker.js";

const CONTAINER_TIMEOUT_MS = 6 * 60 * 1000;
const MYSQL_PORT = 3306;
const MYSQL_PASSWORD = "apiwright-test";
const MYSQL_DATABASE = "apiwright_test";
const MYSQL_USER = "apiwright";
const MYSQL_ROOT_PASSWORD = "apiwright-root";

describe.skipIf(!await isDockerAvailable())(
  "MysqlConnector — real mysql2 driver against a mysql:8 container",
  () => {
    let container: StartedTestContainer;
    let config: ConnectionConfig;

    beforeAll(async () => {
      container = await new GenericContainer("mysql:8")
        .withEnvironment({
          MYSQL_ROOT_PASSWORD,
          MYSQL_DATABASE,
          MYSQL_USER,
          MYSQL_PASSWORD,
        })
        .withExposedPorts(MYSQL_PORT)
        // MySQL prints this once it's actually accepting connections (the
        // first start logs the line twice — once during init, once for
        // real — so wait for the SECOND occurrence).
        .withWaitStrategy(
          Wait.forLogMessage(/ready for connections.*port: 3306/, 2),
        )
        .start();
      config = {
        type: "mysql",
        host: container.getHost(),
        port: container.getMappedPort(MYSQL_PORT),
        database: MYSQL_DATABASE,
        user: MYSQL_USER,
        password: MYSQL_PASSWORD,
      };
    }, CONTAINER_TIMEOUT_MS);

    afterAll(async () => {
      if (container) await container.stop();
    }, CONTAINER_TIMEOUT_MS);

    // The MySQL connector receives SQL in NEUTRAL form: every parameter
    // site is marked with the sentinel ` APIWRIGHT_PARAM_<N> ` (space-
    // bounded). The mysql-binder rewrites each sentinel to a literal `?`
    // and collects one value per occurrence in left-to-right textual order.
    // User-written `?` in the SQL is NOT rewritten — the binder relies on
    // sentinels to know where to splice values.
    //
    // Extra space on each side of the sentinel so the post-bind SQL has
    // a single-space separator from neighbours (the sentinel's own
    // leading/trailing spaces are consumed by the `→ ?` rewrite).
    const SENT0 = " APIWRIGHT_PARAM_0 ";
    const SENT1 = " APIWRIGHT_PARAM_1 ";
    const SENT2 = " APIWRIGHT_PARAM_2 ";

    it("connects, runs a parameterized SELECT, and returns a normalized result", async () => {
      const conn = new MysqlConnector();
      await conn.connect(config);
      try {
        const result = await conn.execute(
          `SELECT ${SENT0} AS n, ${SENT1} AS name`,
          { "0": 42, "1": "apiwright" },
        );
        expect(result.rowCount).toBe(1);
        expect(result.rows).toHaveLength(1);
        const row = result.rows[0] as Record<string, unknown>;
        expect(row["n"]).toBe(42);
        expect(row["name"]).toBe("apiwright");
      } finally {
        await conn.disconnect();
      }
    }, CONTAINER_TIMEOUT_MS);

    it("CREATE TABLE → INSERT → SELECT round-trip preserves values", async () => {
      const conn = new MysqlConnector();
      await conn.connect(config);
      try {
        await conn.execute(
          `CREATE TABLE IF NOT EXISTS users (
             id INT AUTO_INCREMENT PRIMARY KEY,
             email VARCHAR(255) NOT NULL
           )`,
        );
        await conn.execute(
          `INSERT INTO users (email) VALUES ( ${SENT0} )`,
          { "0": "qa@example.com" },
        );
        const result = await conn.execute(
          `SELECT email FROM users WHERE email = ${SENT0} `,
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
      const conn = new MysqlConnector();
      await conn.connect(config);
      try {
        await conn.execute(
          `CREATE TABLE IF NOT EXISTS tokens (
             id INT AUTO_INCREMENT PRIMARY KEY,
             val VARCHAR(64)
           )`,
        );
        await conn.execute(
          `INSERT INTO tokens (val) VALUES ( ${SENT0} ), ( ${SENT1} ), ( ${SENT2} )`,
          { "0": "a", "1": "b", "2": "c" },
        );
        const result = await conn.execute(
          `DELETE FROM tokens WHERE val IN ( ${SENT0} , ${SENT1} )`,
          { "0": "a", "1": "c" },
        );
        expect(result.rowCount).toBe(2);
      } finally {
        await conn.execute("DROP TABLE IF EXISTS tokens");
        await conn.disconnect();
      }
    }, CONTAINER_TIMEOUT_MS);
  },
);
