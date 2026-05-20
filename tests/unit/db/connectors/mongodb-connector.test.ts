import { describe, it, expect } from "vitest";

import { MongodbConnector } from "../../../../src/db/connectors/mongodb-connector.js";
import type {
  MongodbDriverSeam,
  MongoHandle,
  MongoCommandResult,
  MongoOperation,
} from "../../../../src/db/drivers/mongodb-seam.js";
import type { ConnectionConfig } from "../../../../src/db/types.js";
import { isDbConnectorError, DbConnectorError, DB_ERROR_CODES } from
  "../../../../src/db/errors.js";

/**
 * Unit tests for MongodbConnector (src/db/connectors/mongodb-connector.ts).
 *
 * Uses a hand-written deterministic FAKE MongodbDriverSeam — no real mongodb,
 * no Docker, no network. Covers: connect happy/error/passthrough; execute happy
 * (read/write/admin); execute before connect; parseJson bridge (malformed JSON
 * → DB_QUERY_FAILED, non-object → DB_QUERY_FAILED); D3 structural pin (document
 * is the artifact, no query-language string); bind failure passthrough; driver
 * failure; disconnect happy/error/before-connect/double; secret-free messages
 * (URI never echoed); determinism.
 *
 * The parseJson bridge is the MongoDB-specific Delta 0: the connector calls
 * parseJson (NEVER raw JSON.parse) on the query string before bindMongo.
 *
 * RED PHASE: src/db/connectors/mongodb-connector.ts does not exist yet.
 */

// ---------------------------------------------------------------------------
// Hand-written FAKE seam
// ---------------------------------------------------------------------------

const FAKE_HANDLE = { __mongoHandle: true } as unknown as MongoHandle;

function makeFakeSeam(overrides?: {
  open?: (cfg: ConnectionConfig) => Promise<MongoHandle>;
  runCommand?: (h: MongoHandle, op: MongoOperation) => Promise<MongoCommandResult>;
  close?: (h: MongoHandle) => Promise<void>;
}): MongodbDriverSeam {
  return {
    open: overrides?.open ?? (() => Promise.resolve(FAKE_HANDLE)),
    runCommand: overrides?.runCommand ?? (() => Promise.resolve({ documents: [] })),
    close: overrides?.close ?? (() => Promise.resolve()),
  };
}

const DEFAULT_CONFIG: ConnectionConfig = {
  uri: "mongodb://testuser:SECRET_PW@localhost:27017/testdb",
  database: "testdb",
};

// A valid JSON command document string (as the QA would author it)
const VALID_COMMAND_JSON = JSON.stringify({ find: "users", filter: { active: true } });

// ---------------------------------------------------------------------------
// connect()
// ---------------------------------------------------------------------------

describe("MongodbConnector", () => {
  describe("connect()", () => {
    it("resolves void when seam.open succeeds", async () => {
      const conn = new MongodbConnector(makeFakeSeam());
      await expect(conn.connect(DEFAULT_CONFIG)).resolves.toBeUndefined();
    });

    it("rejects with DB_CONNECTION_FAILED/connect/mongodb when seam.open throws", async () => {
      const seam = makeFakeSeam({ open: () => Promise.reject(new Error("ECONNREFUSED")) });
      const conn = new MongodbConnector(seam);
      await expect(conn.connect(DEFAULT_CONFIG)).rejects.toSatisfy(
        (e: unknown) => isDbConnectorError(e) &&
          (e).code === "DB_CONNECTION_FAILED" &&
          (e).phase === "connect" &&
          (e).engine === "mongodb",
      );
    });

    it("message does NOT echo the URI with credentials (secret-free)", async () => {
      const seam = makeFakeSeam({ open: () => Promise.reject(new Error("Auth failed")) });
      const conn = new MongodbConnector(seam);
      try {
        await conn.connect(DEFAULT_CONFIG);
        expect.fail("Should have rejected");
      } catch (e) {
        // The URI "mongodb://testuser:SECRET_PW@localhost:27017/testdb" must not appear
        expect((e as DbConnectorError).message).not.toContain("SECRET_PW");
        expect((e as DbConnectorError).message).not.toContain("testuser");
        expect((e as DbConnectorError).message).not.toContain("mongodb://");
      }
    });

    it("re-rejects an already-DbConnectorError unchanged (missing-driver passthrough)", async () => {
      const innerErr = new DbConnectorError({
        code: DB_ERROR_CODES.DB_CONNECTION_FAILED,
        phase: "connect",
        engine: "mongodb",
        message: 'MongoDB driver "mongodb" is not installed. Run: npm install mongodb',
      });
      const seam = makeFakeSeam({ open: () => Promise.reject(innerErr) });
      const conn = new MongodbConnector(seam);
      try {
        await conn.connect(DEFAULT_CONFIG);
        expect.fail("Should have rejected");
      } catch (e) {
        expect(e).toBe(innerErr);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // execute() — parseJson bridge (Delta 0 — the MongoDB-unique step)
  // ---------------------------------------------------------------------------

  describe("execute() — parseJson bridge (Delta 0)", () => {
    it("rejects with DB_QUERY_FAILED/execute when query string is malformed JSON", async () => {
      const conn = new MongodbConnector(makeFakeSeam());
      await conn.connect(DEFAULT_CONFIG);
      await expect(conn.execute("{not valid json}")).rejects.toSatisfy(
        (e: unknown) => isDbConnectorError(e) &&
          (e).code === "DB_QUERY_FAILED" &&
          (e).phase === "execute" &&
          (e).engine === "mongodb",
      );
    });

    it("malformed JSON error message does NOT echo the query string (secret-free)", async () => {
      const conn = new MongodbConnector(makeFakeSeam());
      await conn.connect(DEFAULT_CONFIG);
      try {
        await conn.execute('{"password":"secret", broken}');
        expect.fail("Should have rejected");
      } catch (e) {
        // The query text (which could contain secrets) must not appear in message
        expect((e as DbConnectorError).message).not.toContain("secret");
      }
    });

    it("rejects with DB_QUERY_FAILED/execute when parsed JSON is an array (not a command doc)",
      async () => {
        const conn = new MongodbConnector(makeFakeSeam());
        await conn.connect(DEFAULT_CONFIG);
        await expect(conn.execute("[1, 2, 3]")).rejects.toSatisfy(
          (e: unknown) => isDbConnectorError(e) &&
            (e).code === "DB_QUERY_FAILED",
        );
      });

    it("rejects with DB_QUERY_FAILED/execute when parsed JSON is a scalar (not a doc)", async () => {
      const conn = new MongodbConnector(makeFakeSeam());
      await conn.connect(DEFAULT_CONFIG);
      await expect(conn.execute('"just a string"')).rejects.toSatisfy(
        (e: unknown) => isDbConnectorError(e) &&
          (e).code === "DB_QUERY_FAILED",
      );
    });

    it("rejects with DB_QUERY_FAILED/execute when parsed JSON is null", async () => {
      const conn = new MongodbConnector(makeFakeSeam());
      await conn.connect(DEFAULT_CONFIG);
      await expect(conn.execute("null")).rejects.toSatisfy(
        (e: unknown) => isDbConnectorError(e) &&
          (e).code === "DB_QUERY_FAILED",
      );
    });
  });

  // ---------------------------------------------------------------------------
  // execute() — happy paths
  // ---------------------------------------------------------------------------

  describe("execute() — happy paths with valid JSON command", () => {
    it("resolves NormalizedResult with rows for a read command", async () => {
      const docs = [{ _id: "abc", name: "Alice" }];
      const seam = makeFakeSeam({
        runCommand: () => Promise.resolve({ documents: docs }),
      });
      const conn = new MongodbConnector(seam);
      await conn.connect(DEFAULT_CONFIG);
      const result = await conn.execute(VALID_COMMAND_JSON);
      expect(result.rows).toHaveLength(1);
      expect(result.rowCount).toBe(1);
    });

    it("resolves NormalizedResult with rows:[], rowCount=affected for write command", async () => {
      const seam = makeFakeSeam({
        runCommand: () => Promise.resolve({ documents: [], affected: 5 }),
      });
      const conn = new MongodbConnector(seam);
      await conn.connect(DEFAULT_CONFIG);
      const result = await conn.execute(
        JSON.stringify({ update: "users", updates: [{ q: {}, u: {} }] }),
      );
      expect(result.rows).toHaveLength(0);
      expect(result.rowCount).toBe(5);
    });

    it("D3: seam.runCommand receives a DOCUMENT (not a string) — strongest D3 case", async () => {
      let capturedOp: MongoOperation | null = null;
      const seam = makeFakeSeam({
        runCommand: (_h, op) => { capturedOp = op; return Promise.resolve({ documents: [] }); },
      });
      const conn = new MongodbConnector(seam);
      await conn.connect(DEFAULT_CONFIG);
      await conn.execute(VALID_COMMAND_JSON);
      expect(capturedOp).not.toBeNull();
      // The command passed to the seam must be an object, not a string
      expect(typeof capturedOp!.command).toBe("object");
      expect(capturedOp!.command).not.toBeNull();
    });

    it("execute with params: paramsToValues sorts by index (exercises sort comparator)", async () => {
      // Passing 2 params exercises paramsToValues's sort comparator (a.index - b.index).
      // The MongoDB command JSON uses no sentinel tokens, so binding is a no-op on the doc;
      // the test verifies that the connector accepts params and returns a valid result.
      const seam = makeFakeSeam({
        runCommand: () => Promise.resolve({ documents: [{ ok: 1 }] }),
      });
      const conn = new MongodbConnector(seam);
      await conn.connect(DEFAULT_CONFIG);
      // params "1" and "0" passed in reverse order → sort should give index-0 first
      const result = await conn.execute(VALID_COMMAND_JSON, { "1": "second", "0": "first" });
      // Shape is correct (bind succeeded, docs returned)
      expect(Array.isArray(result.rows)).toBe(true);
    });

    it("D4: ObjectId-like value in documents stays verbatim (not .toHexString()'d)", async () => {
      const objectId = { toHexString: () => "abc123", _bsontype: "ObjectId" };
      const seam = makeFakeSeam({
        runCommand: () => Promise.resolve({ documents: [{ _id: objectId }] }),
      });
      const conn = new MongodbConnector(seam);
      await conn.connect(DEFAULT_CONFIG);
      const result = await conn.execute(VALID_COMMAND_JSON);
      expect(result.rows[0]["_id"]).toBe(objectId);
    });

    it("D4: Date field in documents stays a Date (not ISO-stringified)", async () => {
      const date = new Date("2024-04-01T00:00:00Z");
      const seam = makeFakeSeam({
        runCommand: () => Promise.resolve({ documents: [{ created: date }] }),
      });
      const conn = new MongodbConnector(seam);
      await conn.connect(DEFAULT_CONFIG);
      const result = await conn.execute(VALID_COMMAND_JSON);
      expect(result.rows[0]["created"]).toBeInstanceOf(Date);
    });
  });

  // ---------------------------------------------------------------------------
  // execute() — before connect
  // ---------------------------------------------------------------------------

  describe("execute() — before connect", () => {
    it("rejects with DB_QUERY_FAILED 'not connected' before connect()", async () => {
      const conn = new MongodbConnector(makeFakeSeam());
      await expect(conn.execute(VALID_COMMAND_JSON)).rejects.toSatisfy(
        (e: unknown) => isDbConnectorError(e) &&
          (e).code === "DB_QUERY_FAILED" &&
          (e).message.toLowerCase().includes("not connected"),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // execute() — driver failure
  // ---------------------------------------------------------------------------

  describe("execute() — seam.runCommand failure", () => {
    it("rejects with DB_QUERY_FAILED/execute/mongodb on driver error", async () => {
      const seam = makeFakeSeam({
        runCommand: () => Promise.reject(new Error("MongoServerError: collection not found")),
      });
      const conn = new MongodbConnector(seam);
      await conn.connect(DEFAULT_CONFIG);
      await expect(conn.execute(VALID_COMMAND_JSON)).rejects.toSatisfy(
        (e: unknown) => isDbConnectorError(e) &&
          (e).code === "DB_QUERY_FAILED" &&
          (e).engine === "mongodb",
      );
    });

    it("message does not echo the query text or URI (secret-free)", async () => {
      const seam = makeFakeSeam({ runCommand: () => Promise.reject(new Error("Driver error")) });
      const conn = new MongodbConnector(seam);
      await conn.connect(DEFAULT_CONFIG);
      try {
        await conn.execute(JSON.stringify({ find: "secretCollection" }));
        expect.fail("Should have rejected");
      } catch (e) {
        expect((e as DbConnectorError).message).not.toContain("secretCollection");
        expect((e as DbConnectorError).message).not.toContain("mongodb://");
      }
    });

    it("re-throws an already-DbConnectorError from seam unchanged (passthrough)", async () => {
      const innerErr = new DbConnectorError({
        code: DB_ERROR_CODES.DB_QUERY_FAILED,
        phase: "execute",
        engine: "mongodb",
        message: "MongoDB seam: inner error",
      });
      const seam = makeFakeSeam({ runCommand: () => Promise.reject(innerErr) });
      const conn = new MongodbConnector(seam);
      await conn.connect(DEFAULT_CONFIG);
      try {
        await conn.execute(VALID_COMMAND_JSON);
        expect.fail("Should have rejected");
      } catch (e) {
        // Must be the SAME INSTANCE — not double-wrapped
        expect(e).toBe(innerErr);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // disconnect()
  // ---------------------------------------------------------------------------

  describe("disconnect()", () => {
    it("resolves void when seam.close succeeds", async () => {
      const conn = new MongodbConnector(makeFakeSeam());
      await conn.connect(DEFAULT_CONFIG);
      await expect(conn.disconnect()).resolves.toBeUndefined();
    });

    it("before connect: resolves void (benign no-op)", async () => {
      const conn = new MongodbConnector(makeFakeSeam());
      await expect(conn.disconnect()).resolves.toBeUndefined();
    });

    it("double disconnect: second call resolves void (handle cleared)", async () => {
      const conn = new MongodbConnector(makeFakeSeam());
      await conn.connect(DEFAULT_CONFIG);
      await conn.disconnect();
      await expect(conn.disconnect()).resolves.toBeUndefined();
    });

    it("rejects with DB_DISCONNECT_FAILED/disconnect/mongodb when seam.close throws", async () => {
      const seam = makeFakeSeam({ close: () => Promise.reject(new Error("Close error")) });
      const conn = new MongodbConnector(seam);
      await conn.connect(DEFAULT_CONFIG);
      await expect(conn.disconnect()).rejects.toSatisfy(
        (e: unknown) => isDbConnectorError(e) &&
          (e).code === "DB_DISCONNECT_FAILED" &&
          (e).engine === "mongodb",
      );
    });

    it("handle cleared even when seam.close throws (no dangling handle)", async () => {
      const seam = makeFakeSeam({ close: () => Promise.reject(new Error("Close error")) });
      const conn = new MongodbConnector(seam);
      await conn.connect(DEFAULT_CONFIG);
      try { await conn.disconnect(); } catch { /* expected */ }
      await expect(conn.disconnect()).resolves.toBeUndefined();
    });
  });
});
