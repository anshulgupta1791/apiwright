/**
 * Real-driver integration test for the MongoDB connector.
 *
 * Spins up a real `mongo:7` container via testcontainers and exercises the
 * connector with the DEFAULT seam (real `mongodb` driver, lazily loaded).
 * Skips when Docker is not reachable.
 *
 * FINDING #16 regression guard: `find` previously returned `{ documents: [] }`
 * because the seam only read the `documents` key on the raw response, while
 * the real driver returns cursor results under `cursor.firstBatch`. The fix in
 * `normalizeMongoCommandResult` now reads `cursor.firstBatch` first; several
 * tests here lock in that behavior to prevent regressions.
 */

import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MongodbConnector } from "../../../../src/db/connectors/mongodb-connector.js";
import { DbConnectorError } from "../../../../src/db/errors.js";
import type { ConnectionConfig } from "../../../../src/db/types.js";

import { isDockerAvailable } from "./_skip-if-no-docker.js";

const CONTAINER_TIMEOUT_MS = 5 * 60 * 1000;
const MONGO_PORT = 27017;
const MONGO_DB = "apiwright_test";

/** Collection name constants — one per test group for hermetic cleanup. */
const C_USERS = "rt_users";
const C_TOKENS = "rt_tokens";
const C_ORDERED = "rt_ordered";
const C_NESTED = "rt_nested";
const C_DATES = "rt_dates";
const C_AGGS = "rt_aggs";
const C_UPDATE = "rt_update";
const C_DELETE = "rt_delete";

/** Drop `coll` swallowing "ns not found" errors (collection may not exist yet). */
async function dropSilent(conn: MongodbConnector, coll: string): Promise<void> {
  await conn.execute(JSON.stringify({ drop: coll })).catch(() => undefined);
}

describe.skipIf(!await isDockerAvailable())(
  "MongodbConnector — real mongodb driver against a mongo:7 container",
  () => {
    let container: StartedTestContainer;
    let config: ConnectionConfig;

    beforeAll(async () => {
      container = await new GenericContainer("mongo:7")
        .withExposedPorts(MONGO_PORT)
        .withWaitStrategy(Wait.forLogMessage(/Waiting for connections.*"port":27017/, 1))
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

    // -----------------------------------------------------------------------
    // Original 3 happy-path tests
    // -----------------------------------------------------------------------

    it("connects and ping succeeds (returns the normalized empty-doc shape)", async () => {
      const conn = new MongodbConnector();
      await conn.connect(config);
      try {
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
        await conn.execute(
          JSON.stringify({
            insert: C_USERS,
            documents: [{ email: "qa@example.com", name: "QA Bot" }],
          }),
        );
        const result = await conn.execute(
          JSON.stringify({ find: C_USERS, filter: { email: "qa@example.com" } }),
        );
        expect(result.rowCount).toBe(1);
        expect(result.rows).toHaveLength(1);
        const row = result.rows[0] as { email: string; name: string };
        expect(row.email).toBe("qa@example.com");
        expect(row.name).toBe("QA Bot");
      } finally {
        await dropSilent(conn, C_USERS);
        await conn.disconnect();
      }
    }, CONTAINER_TIMEOUT_MS);

    it("count yields rowCount equal to the matching-doc count", async () => {
      const conn = new MongodbConnector();
      await conn.connect(config);
      try {
        await conn.execute(
          JSON.stringify({
            insert: C_TOKENS,
            documents: [
              { kind: "access", value: "a" },
              { kind: "access", value: "b" },
              { kind: "refresh", value: "c" },
            ],
          }),
        );
        const result = await conn.execute(
          JSON.stringify({ count: C_TOKENS, query: { kind: "access" } }),
        );
        expect(result.rowCount).toBe(2);
        expect(result.rows).toEqual([]);
      } finally {
        await dropSilent(conn, C_TOKENS);
        await conn.disconnect();
      }
    }, CONTAINER_TIMEOUT_MS);

    // -----------------------------------------------------------------------
    // FINDING #16 regression guard
    // -----------------------------------------------------------------------

    it("FINDING #16: find returns non-empty rows array when docs match (regression guard)", async () => {
      // Before the seam fix every `find` returned `{ rows: [] }` because the
      // driver wraps cursor results under `cursor.firstBatch`, not `documents`.
      const conn = new MongodbConnector();
      await conn.connect(config);
      try {
        await conn.execute(
          JSON.stringify({
            insert: C_USERS,
            documents: [
              { tag: "f16", seq: 1 },
              { tag: "f16", seq: 2 },
              { tag: "f16", seq: 3 },
            ],
          }),
        );
        const result = await conn.execute(
          JSON.stringify({ find: C_USERS, filter: { tag: "f16" } }),
        );
        // This was the regression: result.rows was [] before the fix.
        expect(result.rows).not.toEqual([]);
        expect(result.rowCount).toBe(3);
        expect(result.rows).toHaveLength(3);
        for (const row of result.rows) {
          expect((row as { tag: string }).tag).toBe("f16");
        }
      } finally {
        await dropSilent(conn, C_USERS);
        await conn.disconnect();
      }
    }, CONTAINER_TIMEOUT_MS);

    // -----------------------------------------------------------------------
    // Empty find result → canonical { rows: [], rowCount: 0 }
    // -----------------------------------------------------------------------

    it("find with no matching docs returns { rows: [], rowCount: 0 } (not undefined)", async () => {
      const conn = new MongodbConnector();
      await conn.connect(config);
      try {
        await conn.execute(
          JSON.stringify({ insert: C_USERS, documents: [{ tag: "other" }] }),
        );
        const result = await conn.execute(
          JSON.stringify({ find: C_USERS, filter: { tag: "nonexistent-xyz" } }),
        );
        expect(result.rows).toEqual([]);
        expect(result.rowCount).toBe(0);
        expect(typeof result.rowCount).toBe("number");
      } finally {
        await dropSilent(conn, C_USERS);
        await conn.disconnect();
      }
    }, CONTAINER_TIMEOUT_MS);

    // -----------------------------------------------------------------------
    // insert normalization — { ok:1, n:1 } → rowCount = 1
    // -----------------------------------------------------------------------

    it("insert single document returns rowCount = 1 via n normalization", async () => {
      const conn = new MongodbConnector();
      await conn.connect(config);
      try {
        const result = await conn.execute(
          JSON.stringify({
            insert: C_USERS,
            documents: [{ role: "admin", name: "Alice" }],
          }),
        );
        // seam: driver `n` → MongoCommandResult.affected = 1
        // normalizer: documents.length(0) > 0 ? … : (1 ?? 0) = 1
        expect(result.rowCount).toBe(1);
        expect(result.rows).toEqual([]);
      } finally {
        await dropSilent(conn, C_USERS);
        await conn.disconnect();
      }
    }, CONTAINER_TIMEOUT_MS);

    // -----------------------------------------------------------------------
    // update command — nModified → affected → rowCount
    // -----------------------------------------------------------------------

    it("update command with single match returns rowCount = 1 (nModified)", async () => {
      const conn = new MongodbConnector();
      await conn.connect(config);
      try {
        await conn.execute(
          JSON.stringify({
            insert: C_UPDATE,
            documents: [{ status: "pending", ref: "u1" }],
          }),
        );
        const result = await conn.execute(
          JSON.stringify({
            update: C_UPDATE,
            updates: [{ q: { ref: "u1" }, u: { $set: { status: "done" } }, multi: false }],
          }),
        );
        // readMongoAffectedCount checks nModified first → affected = 1 → rowCount = 1.
        expect(result.rowCount).toBe(1);
        expect(result.rows).toEqual([]);
      } finally {
        await dropSilent(conn, C_UPDATE);
        await conn.disconnect();
      }
    }, CONTAINER_TIMEOUT_MS);

    // -----------------------------------------------------------------------
    // delete command — n → affected → rowCount
    // -----------------------------------------------------------------------

    it("delete command with single match returns rowCount = 1 (n)", async () => {
      const conn = new MongodbConnector();
      await conn.connect(config);
      try {
        await conn.execute(
          JSON.stringify({
            insert: C_DELETE,
            documents: [{ kind: "stale", ref: "d1" }, { kind: "keep", ref: "d2" }],
          }),
        );
        const result = await conn.execute(
          JSON.stringify({
            delete: C_DELETE,
            deletes: [{ q: { ref: "d1" }, limit: 1 }],
          }),
        );
        // delete: driver `n` → affected = 1 → rowCount = 1.
        expect(result.rowCount).toBe(1);
        expect(result.rows).toEqual([]);
      } finally {
        await dropSilent(conn, C_DELETE);
        await conn.disconnect();
      }
    }, CONTAINER_TIMEOUT_MS);

    // -----------------------------------------------------------------------
    // Multi-doc cursor preserves sort order
    // -----------------------------------------------------------------------

    it("multi-document find with sort preserves cursor order across all rows", async () => {
      const conn = new MongodbConnector();
      await conn.connect(config);
      try {
        await conn.execute(
          JSON.stringify({
            insert: C_ORDERED,
            documents: [
              { rank: 3, label: "c" },
              { rank: 1, label: "a" },
              { rank: 2, label: "b" },
            ],
          }),
        );
        const result = await conn.execute(
          JSON.stringify({ find: C_ORDERED, filter: {}, sort: { rank: 1 } }),
        );
        expect(result.rowCount).toBe(3);
        const ranks = result.rows.map((r) => (r as { rank: number }).rank);
        expect(ranks).toEqual([1, 2, 3]);
        const labels = result.rows.map((r) => (r as { label: string }).label);
        expect(labels).toEqual(["a", "b", "c"]);
      } finally {
        await dropSilent(conn, C_ORDERED);
        await conn.disconnect();
      }
    }, CONTAINER_TIMEOUT_MS);

    // -----------------------------------------------------------------------
    // ObjectId round-trip — D4 no-coercion: _id stays an ObjectId instance
    // -----------------------------------------------------------------------

    it("ObjectId round-trip: _id returned from find is an ObjectId instance (D4 no-coercion)", async () => {
      // D4: the connector passes the driver's ObjectId verbatim — no .toHexString().
      const conn = new MongodbConnector();
      await conn.connect(config);
      try {
        await conn.execute(
          JSON.stringify({ insert: C_USERS, documents: [{ payload: "oid-test" }] }),
        );
        const result = await conn.execute(
          JSON.stringify({ find: C_USERS, filter: { payload: "oid-test" } }),
        );
        expect(result.rowCount).toBe(1);
        const row = result.rows[0] as Record<string, unknown>;
        const oid = row["_id"];
        expect(oid).toBeDefined();
        // Check the BSON type marker rather than importing ObjectId directly.
        expect((oid as Record<string, unknown>)["_bsontype"]).toBe("ObjectId");
        expect(typeof (oid as { toHexString?: unknown }).toHexString).toBe("function");
      } finally {
        await dropSilent(conn, C_USERS);
        await conn.disconnect();
      }
    }, CONTAINER_TIMEOUT_MS);

    // -----------------------------------------------------------------------
    // Date field round-trip — D4: BSON Date stays a JS Date instance
    // -----------------------------------------------------------------------

    it("Date field round-trip: BSON Date returned as JS Date instance (D4 no-coercion)", async () => {
      const conn = new MongodbConnector();
      await conn.connect(config);
      try {
        await conn.execute(
          JSON.stringify({ insert: C_DATES, documents: [{ label: "ts-test" }] }),
        );
        // Set a real BSON Date via $currentDate.
        await conn.execute(
          JSON.stringify({
            update: C_DATES,
            updates: [
              { q: { label: "ts-test" }, u: { $currentDate: { createdAt: true } }, multi: false },
            ],
          }),
        );
        const result = await conn.execute(
          JSON.stringify({ find: C_DATES, filter: { label: "ts-test" } }),
        );
        expect(result.rowCount).toBe(1);
        const row = result.rows[0] as Record<string, unknown>;
        // D4: BSON Date → JS Date, NOT an ISO string.
        expect(row["createdAt"]).toBeInstanceOf(Date);
        const ts = row["createdAt"] as Date;
        // Sanity: timestamp is recent (within a 5-minute window).
        const nowMs = Date.now();
        expect(ts.getTime()).toBeGreaterThan(nowMs - 5 * 60 * 1000);
        expect(ts.getTime()).toBeLessThanOrEqual(nowMs + 5000);
      } finally {
        await dropSilent(conn, C_DATES);
        await conn.disconnect();
      }
    }, CONTAINER_TIMEOUT_MS);

    // -----------------------------------------------------------------------
    // Nested document structure preserved verbatim
    // -----------------------------------------------------------------------

    it("nested document structure is preserved verbatim through find", async () => {
      const conn = new MongodbConnector();
      await conn.connect(config);
      try {
        const doc = {
          label: "nested-test",
          meta: { author: "qa-bot", tags: ["a", "b"], score: 42, active: true, nullable: null },
        };
        await conn.execute(JSON.stringify({ insert: C_NESTED, documents: [doc] }));
        const result = await conn.execute(
          JSON.stringify({ find: C_NESTED, filter: { label: "nested-test" } }),
        );
        expect(result.rowCount).toBe(1);
        const row = result.rows[0] as typeof doc & { _id: unknown };
        expect(row.label).toBe("nested-test");
        expect(row.meta.author).toBe("qa-bot");
        expect(row.meta.tags).toEqual(["a", "b"]);
        expect(row.meta.score).toBe(42);
        expect(row.meta.active).toBe(true);
        expect(row.meta.nullable).toBeNull();
      } finally {
        await dropSilent(conn, C_NESTED);
        await conn.disconnect();
      }
    }, CONTAINER_TIMEOUT_MS);

    // -----------------------------------------------------------------------
    // Bad command → typed DbConnectorError
    // -----------------------------------------------------------------------

    it("bad/unknown command rejects with DbConnectorError (code DB_QUERY_FAILED)", async () => {
      const conn = new MongodbConnector();
      await conn.connect(config);
      try {
        await expect(
          conn.execute(JSON.stringify({ notARealCommand: 1 })),
        ).rejects.toSatisfy((err: unknown) => {
          if (!(err instanceof DbConnectorError)) return false;
          expect(err.code).toBe("DB_QUERY_FAILED");
          expect(err.phase).toBe("execute");
          expect(err.engine).toBe("mongodb");
          expect(err.message.length).toBeGreaterThan(0);
          return true;
        });
      } finally {
        await conn.disconnect();
      }
    }, CONTAINER_TIMEOUT_MS);

    // -----------------------------------------------------------------------
    // Connection refused → typed DbConnectorError (DB_CONNECTION_FAILED)
    // -----------------------------------------------------------------------

    it("connection to a refused URI rejects with DbConnectorError (DB_CONNECTION_FAILED)", async () => {
      // Port 1 is privileged and always refused — gives a quick refusal.
      const badConfig: ConnectionConfig = {
        type: "mongodb",
        uri: "mongodb://127.0.0.1:1",
        database: MONGO_DB,
      };
      const conn = new MongodbConnector();
      await expect(conn.connect(badConfig)).rejects.toSatisfy((err: unknown) => {
        if (!(err instanceof DbConnectorError)) return false;
        expect(err.code).toBe("DB_CONNECTION_FAILED");
        expect(err.phase).toBe("connect");
        expect(err.engine).toBe("mongodb");
        // URI must NOT appear in the message (credentials can be embedded in it).
        expect(err.message).not.toContain("127.0.0.1");
        return true;
      });
    }, CONTAINER_TIMEOUT_MS);

    // -----------------------------------------------------------------------
    // Aggregation pipeline
    // -----------------------------------------------------------------------

    it("aggregation pipeline returns grouped result via cursor.firstBatch", async () => {
      const conn = new MongodbConnector();
      await conn.connect(config);
      try {
        await conn.execute(
          JSON.stringify({
            insert: C_AGGS,
            documents: [
              { category: "fruit", item: "apple" },
              { category: "fruit", item: "banana" },
              { category: "veggie", item: "carrot" },
            ],
          }),
        );
        const result = await conn.execute(
          JSON.stringify({
            aggregate: C_AGGS,
            pipeline: [
              { $group: { _id: "$category", count: { $sum: 1 } } },
              { $sort: { _id: 1 } },
            ],
            cursor: {},
          }),
        );
        // Two categories: fruit (2) + veggie (1).
        expect(result.rowCount).toBe(2);
        expect(result.rows).toHaveLength(2);
        const fruitRow = result.rows.find(
          (r) => (r as { _id: string })._id === "fruit",
        ) as { _id: string; count: number } | undefined;
        expect(fruitRow).toBeDefined();
        expect(fruitRow?.count).toBe(2);
        const veggieRow = result.rows.find(
          (r) => (r as { _id: string })._id === "veggie",
        ) as { _id: string; count: number } | undefined;
        expect(veggieRow).toBeDefined();
        expect(veggieRow?.count).toBe(1);
      } finally {
        await dropSilent(conn, C_AGGS);
        await conn.disconnect();
      }
    }, CONTAINER_TIMEOUT_MS);
  },
);
