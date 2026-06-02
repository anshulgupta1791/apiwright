/**
 * Real-driver integration test for the Neo4j connector.
 *
 * Spins up a real `neo4j:5` container via testcontainers and exercises
 * the connector with the DEFAULT seam (which lazily `require()`s the real
 * `neo4j-driver` package). Neo4j takes Cypher statements with `$name`
 * parameters.
 *
 * Skips when Docker isn't reachable.
 */

import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { Neo4jConnector } from "../../../../src/db/connectors/neo4j-connector.js";
import type { ConnectionConfig } from "../../../../src/db/types.js";

import { isDockerAvailable } from "./_skip-if-no-docker.js";

const CONTAINER_TIMEOUT_MS = 6 * 60 * 1000;
const NEO4J_BOLT_PORT = 7687;
const NEO4J_HTTP_PORT = 7474;
const NEO4J_PASSWORD = "apiwright-test-password";

describe.skipIf(!await isDockerAvailable())(
  "Neo4jConnector — real neo4j-driver against a neo4j:5 container",
  () => {
    let container: StartedTestContainer;
    let config: ConnectionConfig;

    beforeAll(async () => {
      container = await new GenericContainer("neo4j:5")
        .withEnvironment({
          NEO4J_AUTH: `neo4j/${NEO4J_PASSWORD}`,
          // Disable plugins to reduce cold-start cost.
          NEO4J_dbms_security_procedures_unrestricted: "*",
        })
        .withExposedPorts(NEO4J_BOLT_PORT, NEO4J_HTTP_PORT)
        // Neo4j logs "Started." once it's accepting Bolt connections.
        .withWaitStrategy(Wait.forLogMessage(/Started\./, 1))
        .start();
      config = {
        type: "neo4j",
        uri: `bolt://${container.getHost()}:${container.getMappedPort(NEO4J_BOLT_PORT)}`,
        user: "neo4j",
        password: NEO4J_PASSWORD,
      };
    }, CONTAINER_TIMEOUT_MS);

    afterAll(async () => {
      if (container) await container.stop();
    }, CONTAINER_TIMEOUT_MS);

    // The Neo4j connector receives Cypher already in NEUTRAL form: caller
    // sites that take user-supplied values are marked with the sentinel
    // ` APIWRIGHT_PARAM_<N> ` (space-bounded). The neo4j-binder rewrites
    // those sentinels to Cypher named params (`$p<N>`) and matches them
    // up against the QueryParams bag. Raw user-written Cypher like
    // `RETURN $p0 AS n` does NOT get rewritten — the binder treats it as
    // a user-defined placeholder and picks a different prefix to avoid
    // collisions. The tests below use the sentinel form (matching what
    // the runner actually emits in production).
    //
    // Note the EXTRA space on each side of the sentinel: the sentinel's
    // own leading/trailing spaces are consumed by the binder (sentinel
    // → `$pN`), so we wrap with one more space on each side to ensure
    // the post-bind Cypher has a single-space separator from neighbours.
    const SENT0 = " APIWRIGHT_PARAM_0 ";
    const SENT1 = " APIWRIGHT_PARAM_1 ";

    it("connects, runs RETURN with parameters, and returns the value", async () => {
      const conn = new Neo4jConnector();
      await conn.connect(config);
      try {
        const result = await conn.execute(
          `RETURN ${SENT0} AS n, ${SENT1} AS name`,
          { "0": 42, "1": "apiwright" },
        );
        expect(result.rowCount).toBe(1);
        expect(result.rows).toHaveLength(1);
        const row = result.rows[0] as Record<string, unknown>;
        // Neo4j returns ints as bigint or Integer wrappers depending on
        // config; the normalizer coerces to a JS number for small values.
        expect(Number(row["n"])).toBe(42);
        expect(row["name"]).toBe("apiwright");
      } finally {
        await conn.disconnect();
      }
    }, CONTAINER_TIMEOUT_MS);

    it("CREATE → MATCH round-trip surfaces nodes via the normalizer", async () => {
      const conn = new Neo4jConnector();
      await conn.connect(config);
      try {
        await conn.execute(
          `CREATE (u:TestUser {email: ${SENT0} , name: ${SENT1} })`,
          { "0": "qa@example.com", "1": "QA Bot" },
        );
        const result = await conn.execute(
          `MATCH (u:TestUser {email: ${SENT0} }) RETURN u.email AS email, u.name AS name`,
          { "0": "qa@example.com" },
        );
        expect(result.rowCount).toBe(1);
        const row = result.rows[0] as { email: string; name: string };
        expect(row.email).toBe("qa@example.com");
        expect(row.name).toBe("QA Bot");
      } finally {
        await conn
          .execute("MATCH (u:TestUser) DELETE u")
          .catch(() => undefined);
        await conn.disconnect();
      }
    }, CONTAINER_TIMEOUT_MS);

    it("DELETE-via-MATCH returns no rows and the run is hermetic across tests", async () => {
      const conn = new Neo4jConnector();
      await conn.connect(config);
      try {
        await conn.execute(
          `CREATE (t:Token {val: ${SENT0} })`,
          { "0": "neo4j-real-cleanup" },
        );
        await conn.execute(
          `MATCH (t:Token {val: ${SENT0} }) DELETE t`,
          { "0": "neo4j-real-cleanup" },
        );
        const result = await conn.execute(
          `MATCH (t:Token {val: ${SENT0} }) RETURN t`,
          { "0": "neo4j-real-cleanup" },
        );
        expect(result.rowCount).toBe(0);
        expect(result.rows).toEqual([]);
      } finally {
        await conn.disconnect();
      }
    }, CONTAINER_TIMEOUT_MS);
  },
);
