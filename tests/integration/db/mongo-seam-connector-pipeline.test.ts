/**
 * Integration test for issue #44 — MongoDB seam-to-connector-to-normalizer
 * pipeline against the REAL shapes returned by mongodb's `db.command(...)`.
 *
 * WHY THIS IS AN INTEGRATION TEST, NOT A UNIT TEST (matches issue #43):
 *
 *   Every layer's unit test used a fake matching the abstract interface,
 *   not the real mongodb driver:
 *     - mongodb-seam.test.ts had `db.command()` return {documents: [...]}
 *     - mongodb-connector.test.ts used a fake SEAM returning MongoCommandResult
 *     - mongodb-result-normalizer.test.ts used a fake MongoCommandResult
 *   All three layers agreed. None tested against the REAL mongodb driver's
 *   shapes: {cursor:{firstBatch:[...]}} for find, {ok:1, n: ...} for DML.
 *
 *   This integration test wires the REAL seam with a fake mongodb module
 *   whose `db.command()` returns EXACTLY the shapes the real driver returns.
 *   The seam → connector → normalizer chain runs end-to-end; if any link
 *   misinterprets a shape, the documents come out empty.
 *
 *   THIS test would have caught the original bug.
 *
 * SEE ALSO:
 *   - tests/unit/db/drivers/mongodb-seam.test.ts (seam unit)
 *   - tests/unit/db/connectors/mongodb-connector.test.ts (connector unit)
 *   - tests/unit/db/connectors/mongodb-result-normalizer.test.ts (normalizer unit)
 *   - apiwright-testing tests/api/apiwright_meta/test_db_verify_mongodb.py (e2e)
 *   - ~/.claude/.../memory/lesson_unit_tests_miss_seam_shape.md (root cause)
 */

import { describe, expect, it } from "vitest";

import { MongodbConnector } from "../../../src/db/connectors/mongodb-connector.js";
import { createDefaultMongodbSeam } from "../../../src/db/drivers/mongodb-seam.js";
import type { ConnectionConfig } from "../../../src/db/types.js";

const TEST_CONFIG: ConnectionConfig = {
  type: "mongodb",
  uri: "mongodb://localhost:27017/test",
  database: "test",
};

/**
 * Builds a fake mongodb module that returns the REAL driver shapes from
 * `db.command(...)`. `commander(cmd)` decides what each call returns;
 * the structural fake follows mongodb's actual contract (MongoClient
 * constructor, connect(), db(name).command(cmd), close()).
 */
function makeRealisticMongoModule(
  commander: (cmd: Record<string, unknown>) => unknown,
): unknown {
  return {
    MongoClient: class FakeMongoClient {
      constructor(_uri: string) {}
      async connect(): Promise<void> {}
      db(_name: string): { command: (cmd: Record<string, unknown>) => Promise<unknown> } {
        return {
          async command(cmd: Record<string, unknown>): Promise<unknown> {
            return commander(cmd);
          },
        };
      }
      async close(): Promise<void> {}
    },
  };
}

describe("MongoDB seam → connector → normalizer pipeline (issue #44)", () => {
  it("find returns documents end-to-end from cursor.firstBatch (the bug-fixing path)", async () => {
    // Real mongodb returns {cursor:{firstBatch:[...]}, ok:1} for find.
    // The seam must unwrap cursor.firstBatch into documents; the connector
    // / normalizer must propagate them as rows.
    const seam = createDefaultMongodbSeam(() =>
      makeRealisticMongoModule(() => ({
        cursor: {
          firstBatch: [
            { _id: "alice", age: 30 },
            { _id: "bob", age: 28 },
          ],
          id: 0,
          ns: "test.users",
        },
        ok: 1,
      })),
    );
    const connector = new MongodbConnector(seam);
    await connector.connect(TEST_CONFIG);

    const result = await connector.execute(
      JSON.stringify({ find: "users", filter: {} }),
    );

    expect(result.rowCount).toBe(2);
    expect(result.rows).toEqual([
      { _id: "alice", age: 30 },
      { _id: "bob", age: 28 },
    ]);

    await connector.disconnect();
  });

  it("find with empty cursor.firstBatch reports rowCount=0 correctly", async () => {
    const seam = createDefaultMongodbSeam(() =>
      makeRealisticMongoModule(() => ({
        cursor: { firstBatch: [], id: 0, ns: "test.users" },
        ok: 1,
      })),
    );
    const connector = new MongodbConnector(seam);
    await connector.connect(TEST_CONFIG);

    const result = await connector.execute(
      JSON.stringify({ find: "users", filter: { _id: "missing" } }),
    );

    expect(result.rowCount).toBe(0);
    expect(result.rows).toEqual([]);

    await connector.disconnect();
  });

  it("DML ack reports affected count via normalizer", async () => {
    // Real mongodb returns {ok:1, n:1, nModified:1, ...} for an update ack.
    const seam = createDefaultMongodbSeam(() =>
      makeRealisticMongoModule(() => ({
        ok: 1,
        n: 5,
        nModified: 3,
      })),
    );
    const connector = new MongodbConnector(seam);
    await connector.connect(TEST_CONFIG);

    const result = await connector.execute(
      JSON.stringify({
        update: "users",
        updates: [{ q: {}, u: { $set: { v: 1 } }, multi: true }],
      }),
    );

    // The normalizer's rowCount formula: documents.length > 0 ? len : affected ?? 0.
    // Documents is [], affected is 3 (nModified is read first per the seam's
    // priority order — keys are ["nModified", "nInserted", "nDeleted", "n"]).
    expect(result.rows).toEqual([]);
    expect(result.rowCount).toBe(3);

    await connector.disconnect();
  });

  it("admin command {ok:1} falls back gracefully to empty documents", async () => {
    // Ping / hello / serverStatus return {ok:1} with no cursor or counters.
    const seam = createDefaultMongodbSeam(() =>
      makeRealisticMongoModule(() => ({ ok: 1 })),
    );
    const connector = new MongodbConnector(seam);
    await connector.connect(TEST_CONFIG);

    const result = await connector.execute(JSON.stringify({ ping: 1 }));

    expect(result.rows).toEqual([]);
    expect(result.rowCount).toBe(0);

    await connector.disconnect();
  });

  it("regression guard: find with documents must NOT return rowCount=0", async () => {
    // The original bug shape: any find against a populated collection
    // returned documents=[]. If anyone reintroduces the unwrap bug, this
    // fails loudly.
    const seam = createDefaultMongodbSeam(() =>
      makeRealisticMongoModule(() => ({
        cursor: { firstBatch: [{ _id: "x" }] },
        ok: 1,
      })),
    );
    const connector = new MongodbConnector(seam);
    await connector.connect(TEST_CONFIG);

    const result = await connector.execute(
      JSON.stringify({ find: "anything", filter: {} }),
    );

    expect(result.rowCount).toBeGreaterThan(0);
    expect(result.rows.length).toBeGreaterThan(0);

    await connector.disconnect();
  });

  it("explicit-documents shape still works (rare but legacy-supported)", async () => {
    // Some admin commands return a `documents` field directly. The fix's
    // shape detector handles this branch as well.
    const seam = createDefaultMongodbSeam(() =>
      makeRealisticMongoModule(() => ({
        documents: [{ explicit: true }],
        ok: 1,
      })),
    );
    const connector = new MongodbConnector(seam);
    await connector.connect(TEST_CONFIG);

    const result = await connector.execute(
      JSON.stringify({ someCustomCmd: 1 }),
    );

    expect(result.rowCount).toBe(1);
    expect(result.rows).toEqual([{ explicit: true }]);

    await connector.disconnect();
  });

  it("100-document cursor.firstBatch is fully preserved end-to-end", async () => {
    // Scale test: any row-loss between the layers becomes obvious at N=100.
    const hundredDocs = Array.from({ length: 100 }, (_, i) => ({
      _id: i,
      label: `doc-${i}`,
    }));
    const seam = createDefaultMongodbSeam(() =>
      makeRealisticMongoModule(() => ({
        cursor: { firstBatch: hundredDocs, id: 0, ns: "test.bulk" },
        ok: 1,
      })),
    );
    const connector = new MongodbConnector(seam);
    await connector.connect(TEST_CONFIG);

    const result = await connector.execute(
      JSON.stringify({ find: "bulk", filter: {} }),
    );

    expect(result.rowCount).toBe(100);
    expect(result.rows).toEqual(hundredDocs);

    await connector.disconnect();
  });
});
