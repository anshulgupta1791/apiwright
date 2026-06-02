/**
 * Real-driver integration test for the MongoDB connector.
 *
 * Spins up a real `mongo:7` container via testcontainers and exercises
 * the connector with the DEFAULT seam (which lazily `require()`s the real
 * `mongodb` driver). The connector takes JSON-stringified MongoDB admin
 * commands; we use `ping`, `insert`, and `find` to round-trip a document
 * through real Mongo and assert the normalized result.
 *
 * Skips when Docker isn't reachable.
 */

import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MongodbConnector } from "../../../../src/db/connectors/mongodb-connector.js";
import type { ConnectionConfig } from "../../../../src/db/types.js";

import { isDockerAvailable } from "./_skip-if-no-docker.js";

const CONTAINER_TIMEOUT_MS = 5 * 60 * 1000;
const MONGO_PORT = 27017;
const MONGO_DB = "apiwright_test";

describe.skipIf(!await isDockerAvailable())(
  "MongodbConnector — real mongodb driver against a mongo:7 container",
  () => {
    let container: StartedTestContainer;
    let config: ConnectionConfig;

    beforeAll(async () => {
      container = await new GenericContainer("mongo:7")
        .withExposedPorts(MONGO_PORT)
        // Mongo prints this exact line once accepting connections.
        .withWaitStrategy(
          Wait.forLogMessage(/Waiting for connections.*"port":27017/, 1),
        )
        .start();
      config = {
        type: "mongodb",
        uri: `mongodb://${container.getHost()}:${container.getMappedPort(MONGO_PORT)}`,
        database: MONGO_DB,
      };
    }, CONTAINER_TIMEOUT_MS);

    afterAll(async () => {
      if (container) await container.stop();
    }, CONTAINER_TIMEOUT_MS);

    it("connects and ping succeeds (returns the normalized empty-doc shape)", async () => {
      const conn = new MongodbConnector();
      await conn.connect(config);
      try {
        // The mongo seam normalizes `{ok:1}` to `{documents:[]}` (no
        // `affected` key — ping is not a DML command). The `raw` field
        // exposes the seam's MongoCommandResult, not the underlying
        // driver response, so the `ok` flag is not directly observable
        // here. The successful execution (no throw) IS the ping passing.
        const result = await conn.execute(JSON.stringify({ ping: 1 }));
        expect(result.rows).toEqual([]);
        expect(result.rowCount).toBe(0);
      } finally {
        await conn.disconnect();
      }
    }, CONTAINER_TIMEOUT_MS);

    it("insert → find round-trip surfaces inserted documents in rows", async () => {
      const conn = new MongodbConnector();
      await conn.connect(config);
      try {
        // Insert one document.
        await conn.execute(
          JSON.stringify({
            insert: "users",
            documents: [{ email: "qa@example.com", name: "QA Bot" }],
          }),
        );
        // Find it.
        const result = await conn.execute(
          JSON.stringify({
            find: "users",
            filter: { email: "qa@example.com" },
          }),
        );
        expect(result.rowCount).toBe(1);
        expect(result.rows).toHaveLength(1);
        const row = result.rows[0] as { email: string; name: string };
        expect(row.email).toBe("qa@example.com");
        expect(row.name).toBe("QA Bot");
      } finally {
        // Tear the collection down so re-runs are hermetic.
        await conn.execute(JSON.stringify({ drop: "users" })).catch(() => undefined);
        await conn.disconnect();
      }
    }, CONTAINER_TIMEOUT_MS);

    it("count yields rowCount equal to the matching-doc count", async () => {
      const conn = new MongodbConnector();
      await conn.connect(config);
      try {
        await conn.execute(
          JSON.stringify({
            insert: "tokens",
            documents: [
              { kind: "access", value: "a" },
              { kind: "access", value: "b" },
              { kind: "refresh", value: "c" },
            ],
          }),
        );
        const result = await conn.execute(
          JSON.stringify({
            count: "tokens",
            query: { kind: "access" },
          }),
        );
        // The mongo seam reads the driver response's `n` field into
        // `MongoCommandResult.affected`, and the normalizer projects
        // that to `rowCount` when there are no documents in the cursor.
        expect(result.rowCount).toBe(2);
        expect(result.rows).toEqual([]);
      } finally {
        await conn.execute(JSON.stringify({ drop: "tokens" })).catch(() => undefined);
        await conn.disconnect();
      }
    }, CONTAINER_TIMEOUT_MS);
  },
);
