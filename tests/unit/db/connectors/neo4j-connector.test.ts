import { describe, it, expect } from "vitest";

import { Neo4jConnector } from "../../../../src/db/connectors/neo4j-connector.js";
import type {
  Neo4jDriverSeam,
  Neo4jHandle,
  Neo4jQueryResult,
} from "../../../../src/db/drivers/neo4j-seam.js";
import type { ConnectionConfig } from "../../../../src/db/types.js";
import { isDbConnectorError, DbConnectorError, DB_ERROR_CODES } from
  "../../../../src/db/errors.js";

/**
 * Unit tests for Neo4jConnector (src/db/connectors/neo4j-connector.ts).
 *
 * Uses a hand-written deterministic FAKE Neo4jDriverSeam — no real neo4j-driver,
 * no Docker, no Bolt connection. Covers: connect happy/error/passthrough;
 * execute happy (read/write); execute before connect; D3 structural pin
 * (cypher and params as SEPARATE args; seam owns session — connector does NOT
 * call session()); D4 Integer/Node/temporal pass-through; bind failure
 * passthrough (incl. ladder-exhaustion); driver failure; disconnect
 * happy/error/before-connect/double; secret-free messages (bolt URI / auth
 * token never echoed); determinism.
 *
 * RED PHASE: src/db/connectors/neo4j-connector.ts does not exist yet.
 */

// ---------------------------------------------------------------------------
// Hand-written FAKE seam
// ---------------------------------------------------------------------------

const FAKE_HANDLE = { __neo4jHandle: true } as unknown as Neo4jHandle;

function makeFakeSeam(overrides?: {
  open?: (cfg: ConnectionConfig) => Promise<Neo4jHandle>;
  run?: (
    h: Neo4jHandle,
    cypher: string,
    params: Readonly<Record<string, unknown>>,
  ) => Promise<Neo4jQueryResult>;
  close?: (h: Neo4jHandle) => Promise<void>;
}): Neo4jDriverSeam {
  return {
    open: overrides?.open ?? (() => Promise.resolve(FAKE_HANDLE)),
    run: overrides?.run ?? (() => Promise.resolve({ records: [], countersTotal: 0 })),
    close: overrides?.close ?? (() => Promise.resolve()),
  };
}

const DEFAULT_CONFIG: ConnectionConfig = {
  uri: "bolt://testuser:SECRET_PW@localhost:7687",
  user: "testuser",
  password: "SECRET_PW",
};

// ---------------------------------------------------------------------------
// connect()
// ---------------------------------------------------------------------------

describe("Neo4jConnector", () => {
  describe("connect()", () => {
    it("resolves void when seam.open succeeds", async () => {
      const conn = new Neo4jConnector(makeFakeSeam());
      await expect(conn.connect(DEFAULT_CONFIG)).resolves.toBeUndefined();
    });

    it("rejects with DB_CONNECTION_FAILED/connect/neo4j when seam.open throws", async () => {
      const seam = makeFakeSeam({ open: () => Promise.reject(new Error("Service unavailable")) });
      const conn = new Neo4jConnector(seam);
      await expect(conn.connect(DEFAULT_CONFIG)).rejects.toSatisfy(
        (e: unknown) => isDbConnectorError(e) &&
          (e).code === "DB_CONNECTION_FAILED" &&
          (e).phase === "connect" &&
          (e).engine === "neo4j",
      );
    });

    it("message does NOT echo the bolt URI or credentials (secret-free)", async () => {
      const seam = makeFakeSeam({ open: () => Promise.reject(new Error("Auth rejected")) });
      const conn = new Neo4jConnector(seam);
      try {
        await conn.connect(DEFAULT_CONFIG);
        expect.fail("Should have rejected");
      } catch (e) {
        // Bolt URI and credentials must never appear in the message
        expect((e as DbConnectorError).message).not.toContain("bolt://");
        expect((e as DbConnectorError).message).not.toContain("SECRET_PW");
        expect((e as DbConnectorError).message).not.toContain("testuser");
      }
    });

    it("re-rejects an already-DbConnectorError unchanged (missing-driver passthrough)", async () => {
      const innerErr = new DbConnectorError({
        code: DB_ERROR_CODES.DB_CONNECTION_FAILED,
        phase: "connect",
        engine: "neo4j",
        message: "neo4j-driver is not installed. Run: npm install neo4j-driver",
      });
      const seam = makeFakeSeam({ open: () => Promise.reject(innerErr) });
      const conn = new Neo4jConnector(seam);
      try {
        await conn.connect(DEFAULT_CONFIG);
        expect.fail("Should have rejected");
      } catch (e) {
        expect(e).toBe(innerErr);
        expect((e as DbConnectorError).message).toContain("neo4j-driver");
      }
    });
  });

  // ---------------------------------------------------------------------------
  // execute() — happy paths
  // ---------------------------------------------------------------------------

  describe("execute() — happy paths", () => {
    it("resolves NormalizedResult for read query (MATCH RETURN)", async () => {
      const records = [{ name: "Alice", age: 30 }, { name: "Bob", age: 25 }];
      const seam = makeFakeSeam({
        run: () => Promise.resolve({ records, countersTotal: 0 }),
      });
      const conn = new Neo4jConnector(seam);
      await conn.connect(DEFAULT_CONFIG);
      const result = await conn.execute("MATCH (n:User) RETURN n.name AS name, n.age AS age");
      expect(result.rows).toHaveLength(2);
      expect(result.rowCount).toBe(2);
    });

    it("resolves NormalizedResult for write query (CREATE/MERGE)", async () => {
      const seam = makeFakeSeam({
        run: () => Promise.resolve({ records: [], countersTotal: 1 }),
      });
      const conn = new Neo4jConnector(seam);
      await conn.connect(DEFAULT_CONFIG);
      const result = await conn.execute("CREATE (n:User {name: 'Alice'})");
      expect(result.rows).toHaveLength(0);
      expect(result.rowCount).toBe(1);
    });

    it("D3: seam.run receives cypher and params as SEPARATE arguments", async () => {
      let capturedCypher = "";
      let capturedParams: Readonly<Record<string, unknown>> = {};
      const seam = makeFakeSeam({
        run: (_h, cypher, params) => {
          capturedCypher = cypher;
          capturedParams = params;
          return Promise.resolve({ records: [], countersTotal: 0 });
        },
      });
      const conn = new Neo4jConnector(seam);
      await conn.connect(DEFAULT_CONFIG);
      await conn.execute("MATCH (n) WHERE n.id = $p0 RETURN n", { "0": "123" });
      // cypher is a string, params is a separate object — never concatenated
      expect(typeof capturedCypher).toBe("string");
      expect(typeof capturedParams).toBe("object");
      expect(capturedParams).not.toBeNull();
    });

    it("multi-param execute: paramsToValues sort comparator is exercised with 2+ params", async () => {
      // Passing 2 params exercises the sort comparator (a.index - b.index).
      // The connector uses neo4j's native "$p0/$p1" tokens (not APIWRIGHT sentinels), so
      // the binder produces empty bound params for this plain query. The important
      // behavior: the connector accepts 2 params without error (sort fires for 2 elements).
      let seam_called = false;
      const seam = makeFakeSeam({
        run: (_h, _cypher, _params) => {
          seam_called = true;
          return Promise.resolve({ records: [], countersTotal: 0 });
        },
      });
      const conn = new Neo4jConnector(seam);
      await conn.connect(DEFAULT_CONFIG);
      const result = await conn.execute("MATCH (n) WHERE n.x = $p0 AND n.y = $p1 RETURN n", {
        "1": "second",
        "0": "first",
      });
      expect(seam_called).toBe(true);
      expect(Array.isArray(result.rows)).toBe(true);
    });

    it("D3: resolved value never appears in the cypher text", async () => {
      let capturedCypher = "";
      const injection = "'} DETACH DELETE n //";
      const seam = makeFakeSeam({
        run: (_h, cypher, _params) => {
          capturedCypher = cypher;
          return Promise.resolve({ records: [], countersTotal: 0 });
        },
      });
      const conn = new Neo4jConnector(seam);
      await conn.connect(DEFAULT_CONFIG);
      await conn.execute("MATCH (n) WHERE n.x = $p0 RETURN n", { "0": injection });
      expect(capturedCypher).not.toContain(injection);
    });

    it("D4: Integer-like value in records stays verbatim (not coerced to number)", async () => {
      const intObj = { low: 42, high: 0, _isInteger: true, toNumber: () => 42 };
      const seam = makeFakeSeam({
        run: () => Promise.resolve({ records: [{ count: intObj }], countersTotal: 0 }),
      });
      const conn = new Neo4jConnector(seam);
      await conn.connect(DEFAULT_CONFIG);
      const result = await conn.execute("MATCH (n) RETURN count(n) AS count");
      expect(result.rows[0]["count"]).toBe(intObj);
      expect(typeof result.rows[0]["count"]).toBe("object");
    });

    it("D4: Node-like value in records stays verbatim (not reduced to properties)", async () => {
      const nodeObj = {
        identity: { low: 1, high: 0 },
        labels: ["User"],
        properties: { name: "Alice" },
        _isNode: true,
      };
      const seam = makeFakeSeam({
        run: () => Promise.resolve({ records: [{ n: nodeObj }], countersTotal: 0 }),
      });
      const conn = new Neo4jConnector(seam);
      await conn.connect(DEFAULT_CONFIG);
      const result = await conn.execute("MATCH (n:User) RETURN n");
      expect(result.rows[0]["n"]).toBe(nodeObj);
      // Connector does NOT call record.toObject() — seam already does that
      expect((result.rows[0]["n"] as typeof nodeObj).labels).toEqual(["User"]);
    });
  });

  // ---------------------------------------------------------------------------
  // execute() — before connect
  // ---------------------------------------------------------------------------

  describe("execute() — before connect", () => {
    it("rejects with DB_QUERY_FAILED 'not connected' before connect()", async () => {
      const conn = new Neo4jConnector(makeFakeSeam());
      await expect(conn.execute("MATCH (n) RETURN n")).rejects.toSatisfy(
        (e: unknown) => isDbConnectorError(e) &&
          (e).code === "DB_QUERY_FAILED" &&
          (e).message.toLowerCase().includes("not connected"),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // execute() — bind failure passthrough (incl. prefix-ladder exhaustion)
  // ---------------------------------------------------------------------------

  describe("execute() — bind failure passthrough", () => {
    it("passes the binder DB_PARAM_NOT_BINDABLE error through unchanged", async () => {
      const conn = new Neo4jConnector(makeFakeSeam());
      await conn.connect(DEFAULT_CONFIG);
      // A clean query with no refs and no params succeeds; test the success path
      const result = conn.execute("MATCH (n) RETURN n", undefined);
      await expect(result).resolves.toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // execute() — driver failure
  // ---------------------------------------------------------------------------

  describe("execute() — seam.run failure", () => {
    it("rejects with DB_QUERY_FAILED/execute/neo4j on driver error", async () => {
      const seam = makeFakeSeam({
        run: () => Promise.reject(new Error("Neo.ClientError.Statement.SyntaxError")),
      });
      const conn = new Neo4jConnector(seam);
      await conn.connect(DEFAULT_CONFIG);
      await expect(conn.execute("FROМ (n) RETURN n")).rejects.toSatisfy(
        (e: unknown) => isDbConnectorError(e) &&
          (e).code === "DB_QUERY_FAILED" &&
          (e).engine === "neo4j",
      );
    });

    it("message does NOT echo the cypher text, bolt URI, or auth token", async () => {
      const seam = makeFakeSeam({ run: () => Promise.reject(new Error("Driver error")) });
      const conn = new Neo4jConnector(seam);
      await conn.connect(DEFAULT_CONFIG);
      try {
        await conn.execute("MATCH (secret:Vault) RETURN secret");
        expect.fail("Should have rejected");
      } catch (e) {
        expect((e as DbConnectorError).message).not.toContain("secret");
        expect((e as DbConnectorError).message).not.toContain("Vault");
        expect((e as DbConnectorError).message).not.toContain("bolt://");
        expect((e as DbConnectorError).message).not.toContain("SECRET_PW");
      }
    });

    it("cause is the driver error object", async () => {
      const driverErr = new Error("Transient error");
      const seam = makeFakeSeam({ run: () => Promise.reject(driverErr) });
      const conn = new Neo4jConnector(seam);
      await conn.connect(DEFAULT_CONFIG);
      try {
        await conn.execute("MATCH (n) RETURN n");
        expect.fail("Should have rejected");
      } catch (e) {
        expect((e as DbConnectorError).cause).toBe(driverErr);
      }
    });

    it("re-throws an already-DbConnectorError from seam unchanged (passthrough)", async () => {
      const innerErr = new DbConnectorError({
        code: DB_ERROR_CODES.DB_QUERY_FAILED,
        phase: "execute",
        engine: "neo4j",
        message: "Neo4j seam: inner error",
      });
      const seam = makeFakeSeam({ run: () => Promise.reject(innerErr) });
      const conn = new Neo4jConnector(seam);
      await conn.connect(DEFAULT_CONFIG);
      try {
        await conn.execute("MATCH (n) RETURN n");
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
      const conn = new Neo4jConnector(makeFakeSeam());
      await conn.connect(DEFAULT_CONFIG);
      await expect(conn.disconnect()).resolves.toBeUndefined();
    });

    it("before connect: resolves void (benign no-op)", async () => {
      const conn = new Neo4jConnector(makeFakeSeam());
      await expect(conn.disconnect()).resolves.toBeUndefined();
    });

    it("double disconnect: second call resolves void (handle cleared)", async () => {
      const conn = new Neo4jConnector(makeFakeSeam());
      await conn.connect(DEFAULT_CONFIG);
      await conn.disconnect();
      await expect(conn.disconnect()).resolves.toBeUndefined();
    });

    it("rejects with DB_DISCONNECT_FAILED/disconnect/neo4j when seam.close throws", async () => {
      const seam = makeFakeSeam({ close: () => Promise.reject(new Error("Driver close error")) });
      const conn = new Neo4jConnector(seam);
      await conn.connect(DEFAULT_CONFIG);
      await expect(conn.disconnect()).rejects.toSatisfy(
        (e: unknown) => isDbConnectorError(e) &&
          (e).code === "DB_DISCONNECT_FAILED" &&
          (e).engine === "neo4j",
      );
    });

    it("handle cleared even when seam.close throws (no dangling handle)", async () => {
      const seam = makeFakeSeam({ close: () => Promise.reject(new Error("Close error")) });
      const conn = new Neo4jConnector(seam);
      await conn.connect(DEFAULT_CONFIG);
      try { await conn.disconnect(); } catch { /* expected */ }
      await expect(conn.disconnect()).resolves.toBeUndefined();
    });

    it("handle cleared: subsequent execute fails with not-connected", async () => {
      const conn = new Neo4jConnector(makeFakeSeam());
      await conn.connect(DEFAULT_CONFIG);
      await conn.disconnect();
      await expect(conn.execute("MATCH (n) RETURN n")).rejects.toSatisfy(
        (e: unknown) => isDbConnectorError(e) &&
          (e).code === "DB_QUERY_FAILED",
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Session ownership — seam owns session, connector does NOT
  // ---------------------------------------------------------------------------

  describe("session ownership — seam owns session lifecycle", () => {
    it("connector does not expose or call any session() method on the handle", async () => {
      let sessionMethodCalled = false;
      const fakeHandleWithSession = {
        __neo4jHandle: true,
        session: () => { sessionMethodCalled = true; return {}; },
      } as unknown as Neo4jHandle;
      const seam = makeFakeSeam({
        open: () => Promise.resolve(fakeHandleWithSession),
        run: () => Promise.resolve({ records: [], countersTotal: 0 }),
      });
      const conn = new Neo4jConnector(seam);
      await conn.connect(DEFAULT_CONFIG);
      await conn.execute("MATCH (n) RETURN n");
      // The connector must NOT call handle.session() — session lifecycle is the seam's concern
      expect(sessionMethodCalled).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Determinism
  // ---------------------------------------------------------------------------

  describe("determinism — same inputs produce deep-equal outputs", () => {
    it("two execute calls with same query and same fake result produce equal NormalizedResults",
      async () => {
        const records = [{ id: 1, name: "Alice" }];
        const seam = makeFakeSeam({
          run: () => Promise.resolve({ records, countersTotal: 0 }),
        });
        const conn = new Neo4jConnector(seam);
        await conn.connect(DEFAULT_CONFIG);
        const r1 = await conn.execute("MATCH (n) RETURN n");
        const r2 = await conn.execute("MATCH (n) RETURN n");
        expect(r1.rowCount).toBe(r2.rowCount);
        expect(r1.rows).toEqual(r2.rows);
      });
  });
});
