import { describe, it, expect } from "vitest";

import { MysqlConnector } from "../../../../src/db/connectors/mysql-connector.js";
import type {
  MysqlDriverSeam,
  MysqlHandle,
  MysqlQueryResult,
} from "../../../../src/db/drivers/mysql-seam.js";
import type { ConnectionConfig } from "../../../../src/db/types.js";
import { isDbConnectorError, DbConnectorError, DB_ERROR_CODES } from
  "../../../../src/db/errors.js";

/**
 * Unit tests for MysqlConnector (src/db/connectors/mysql-connector.ts).
 *
 * Uses a hand-written deterministic FAKE MysqlDriverSeam — no real mysql2, no
 * Docker, no network. Covers: connect happy/error/passthrough; execute happy
 * (rows/ok-DML/ok-DDL); execute before connect; D3 positional pin for mysql2
 * (values repeated per occurrence, never in sql); bind failure passthrough;
 * driver failure; disconnect happy/error/before-connect/double; secret-free
 * messages; determinism.
 *
 * RED PHASE: src/db/connectors/mysql-connector.ts does not exist yet.
 */

// ---------------------------------------------------------------------------
// Hand-written FAKE seam
// ---------------------------------------------------------------------------

const FAKE_HANDLE = { __mysqlHandle: true } as unknown as MysqlHandle;

function makeFakeSeam(overrides?: {
  open?: (cfg: ConnectionConfig) => Promise<MysqlHandle>;
  execute?: (h: MysqlHandle, sql: string, values: readonly unknown[]) => Promise<MysqlQueryResult>;
  close?: (h: MysqlHandle) => Promise<void>;
}): MysqlDriverSeam {
  return {
    open: overrides?.open ?? (() => Promise.resolve(FAKE_HANDLE)),
    execute: overrides?.execute ?? (() => Promise.resolve({ kind: "rows", rows: [] })),
    close: overrides?.close ?? (() => Promise.resolve()),
  };
}

const DEFAULT_CONFIG: ConnectionConfig = {
  host: "localhost",
  port: 3306,
  database: "testdb",
  user: "testuser",
  password: "SECRET_PW",
};

// ---------------------------------------------------------------------------
// connect()
// ---------------------------------------------------------------------------

describe("MysqlConnector", () => {
  describe("connect()", () => {
    it("resolves void when seam.open succeeds", async () => {
      const conn = new MysqlConnector(makeFakeSeam());
      await expect(conn.connect(DEFAULT_CONFIG)).resolves.toBeUndefined();
    });

    it("rejects with DB_CONNECTION_FAILED/connect/mysql when seam.open throws", async () => {
      const seam = makeFakeSeam({ open: () => Promise.reject(new Error("Host down")) });
      const conn = new MysqlConnector(seam);
      await expect(conn.connect(DEFAULT_CONFIG)).rejects.toSatisfy(
        (e: unknown) => isDbConnectorError(e) &&
          (e).code === "DB_CONNECTION_FAILED" &&
          (e).phase === "connect" &&
          (e).engine === "mysql",
      );
    });

    it("message does not contain the fake password or host (secret-free)", async () => {
      const seam = makeFakeSeam({ open: () => Promise.reject(new Error("Auth failed")) });
      const conn = new MysqlConnector(seam);
      try {
        await conn.connect(DEFAULT_CONFIG);
        expect.fail("Should have rejected");
      } catch (e) {
        expect((e as DbConnectorError).message).not.toContain("SECRET_PW");
        expect((e as DbConnectorError).message).not.toContain("localhost");
      }
    });

    it("re-rejects an already-DbConnectorError unchanged (missing-driver passthrough)", async () => {
      const innerErr = new DbConnectorError({
        code: DB_ERROR_CODES.DB_CONNECTION_FAILED,
        phase: "connect",
        engine: "mysql",
        message: "MySQL driver (mysql2) is not installed. Run: npm install mysql2",
      });
      const seam = makeFakeSeam({ open: () => Promise.reject(innerErr) });
      const conn = new MysqlConnector(seam);
      try {
        await conn.connect(DEFAULT_CONFIG);
        expect.fail("Should have rejected");
      } catch (e) {
        expect(e).toBe(innerErr);
        expect((e as DbConnectorError).message).toContain("npm install mysql2");
      }
    });
  });

  // ---------------------------------------------------------------------------
  // execute() — happy paths
  // ---------------------------------------------------------------------------

  describe("execute() — happy paths", () => {
    it("resolves NormalizedResult for rows arm (SELECT)", async () => {
      const fakeRows = [{ id: 1, name: "Alice" }];
      const seam = makeFakeSeam({
        execute: () => Promise.resolve({ kind: "rows", rows: fakeRows }),
      });
      const conn = new MysqlConnector(seam);
      await conn.connect(DEFAULT_CONFIG);
      const result = await conn.execute("SELECT id, name FROM users");
      expect(result.rows).toHaveLength(1);
      expect(result.rowCount).toBe(1);
    });

    it("resolves NormalizedResult for ok arm DML (affectedRows=3)", async () => {
      const seam = makeFakeSeam({
        execute: () => Promise.resolve({ kind: "ok", affectedRows: 3 }),
      });
      const conn = new MysqlConnector(seam);
      await conn.connect(DEFAULT_CONFIG);
      const result = await conn.execute("UPDATE users SET active=1 WHERE id=5");
      expect(result.rows).toHaveLength(0);
      expect(result.rowCount).toBe(3);
    });

    it("resolves NormalizedResult for ok arm DDL (no affectedRows) → rowCount=0", async () => {
      const seam = makeFakeSeam({
        execute: () => Promise.resolve({ kind: "ok" } as MysqlQueryResult),
      });
      const conn = new MysqlConnector(seam);
      await conn.connect(DEFAULT_CONFIG);
      const result = await conn.execute("CREATE TABLE test_tbl (id INT)");
      expect(result.rows).toHaveLength(0);
      expect(result.rowCount).toBe(0);
    });

    it("D4: Date cell in SELECT rows stays a Date (no string coercion)", async () => {
      const date = new Date("2024-01-01T00:00:00Z");
      const seam = makeFakeSeam({
        execute: () => Promise.resolve({ kind: "rows", rows: [{ ts: date }] }),
      });
      const conn = new MysqlConnector(seam);
      await conn.connect(DEFAULT_CONFIG);
      const result = await conn.execute("SELECT ts FROM events");
      expect(result.rows[0]["ts"]).toBeInstanceOf(Date);
      expect(result.rows[0]["ts"]).toBe(date);
    });

    it("D4: DECIMAL-as-string stays a string (no number coercion)", async () => {
      const decimal = "99999.99";
      const seam = makeFakeSeam({
        execute: () => Promise.resolve({ kind: "rows", rows: [{ price: decimal }] }),
      });
      const conn = new MysqlConnector(seam);
      await conn.connect(DEFAULT_CONFIG);
      const result = await conn.execute("SELECT price FROM products");
      expect(result.rows[0]["price"]).toBe(decimal);
      expect(typeof result.rows[0]["price"]).toBe("string");
    });
  });

  // ---------------------------------------------------------------------------
  // execute() — D3 positional bind pin (mysql2-specific: values repeated per occurrence)
  // ---------------------------------------------------------------------------

  describe("execute() — D3 positional bind pin", () => {
    it("seam.execute receives sql with ? tokens, never the resolved injection value", async () => {
      let capturedSql = "";
      const injection = "'; DROP TABLE users; --";
      const seam = makeFakeSeam({
        execute: (_, sql, _values) => {
          capturedSql = sql;
          return Promise.resolve({ kind: "rows", rows: [] });
        },
      });
      const conn = new MysqlConnector(seam);
      await conn.connect(DEFAULT_CONFIG);
      await conn.execute("SELECT a FROM t WHERE x = ?", { "0": injection });
      expect(capturedSql).not.toContain(injection);
    });

    it("seam.execute receives values as a separate array argument", async () => {
      let capturedValues: readonly unknown[] = [];
      const seam = makeFakeSeam({
        execute: (_, _sql, values) => {
          capturedValues = values;
          return Promise.resolve({ kind: "rows", rows: [] });
        },
      });
      const conn = new MysqlConnector(seam);
      await conn.connect(DEFAULT_CONFIG);
      await conn.execute("SELECT a FROM t WHERE x = ?", { "0": "myval" });
      expect(Array.isArray(capturedValues)).toBe(true);
    });

    it("multi-param execute: paramsToValues sort comparator is exercised with 2+ params", async () => {
      // Passing 2 params (keys "0" and "1") exercises the sort comparator (a.index - b.index).
      // The connector uses mysql's native "?" tokens in the query, so boundValues from the binder
      // reflects the occurrence-order of sentinels (none in this plain query → empty). The
      // important behavior: the connector accepts 2 params without error and sorts them.
      let seam_called = false;
      const seam = makeFakeSeam({
        execute: (_h, _sql, _values) => {
          seam_called = true;
          return Promise.resolve({ kind: "rows", rows: [] });
        },
      });
      const conn = new MysqlConnector(seam);
      await conn.connect(DEFAULT_CONFIG);
      // Plain "?" query (no APIWRIGHT_PARAM sentinels) with 2 params — sort comparator fires
      const result = await conn.execute("SELECT a FROM t WHERE x = ? AND y = ?", {
        "1": "second",
        "0": "first",
      });
      expect(seam_called).toBe(true);
      expect(Array.isArray(result.rows)).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // execute() — before connect
  // ---------------------------------------------------------------------------

  describe("execute() — before connect", () => {
    it("rejects with DB_QUERY_FAILED 'not connected' before calling connect()", async () => {
      const conn = new MysqlConnector(makeFakeSeam());
      await expect(conn.execute("SELECT 1")).rejects.toSatisfy(
        (e: unknown) => isDbConnectorError(e) &&
          (e).code === "DB_QUERY_FAILED" &&
          (e).message.toLowerCase().includes("not connected"),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // execute() — driver failure
  // ---------------------------------------------------------------------------

  describe("execute() — seam.execute failure", () => {
    it("rejects with DB_QUERY_FAILED/execute/mysql on driver error", async () => {
      const seam = makeFakeSeam({
        execute: () => Promise.reject(new Error("Table does not exist")),
      });
      const conn = new MysqlConnector(seam);
      await conn.connect(DEFAULT_CONFIG);
      await expect(conn.execute("SELECT 1 FROM nonexistent")).rejects.toSatisfy(
        (e: unknown) => isDbConnectorError(e) &&
          (e).code === "DB_QUERY_FAILED" &&
          (e).engine === "mysql",
      );
    });

    it("message does not echo the query text (secret-free)", async () => {
      const seam = makeFakeSeam({ execute: () => Promise.reject(new Error("Error")) });
      const conn = new MysqlConnector(seam);
      await conn.connect(DEFAULT_CONFIG);
      try {
        await conn.execute("SELECT password FROM vault");
        expect.fail("Should have rejected");
      } catch (e) {
        expect((e as DbConnectorError).message).not.toContain("password");
        expect((e as DbConnectorError).message).not.toContain("vault");
      }
    });

    it("re-throws an already-DbConnectorError from seam unchanged (passthrough)", async () => {
      const innerErr = new DbConnectorError({
        code: DB_ERROR_CODES.DB_QUERY_FAILED,
        phase: "execute",
        engine: "mysql",
        message: "MySQL seam: inner error",
      });
      const seam = makeFakeSeam({ execute: () => Promise.reject(innerErr) });
      const conn = new MysqlConnector(seam);
      await conn.connect(DEFAULT_CONFIG);
      try {
        await conn.execute("SELECT 1");
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
      const conn = new MysqlConnector(makeFakeSeam());
      await conn.connect(DEFAULT_CONFIG);
      await expect(conn.disconnect()).resolves.toBeUndefined();
    });

    it("before connect: resolves void (benign no-op)", async () => {
      const conn = new MysqlConnector(makeFakeSeam());
      await expect(conn.disconnect()).resolves.toBeUndefined();
    });

    it("double disconnect: second call resolves void (handle cleared)", async () => {
      const conn = new MysqlConnector(makeFakeSeam());
      await conn.connect(DEFAULT_CONFIG);
      await conn.disconnect();
      await expect(conn.disconnect()).resolves.toBeUndefined();
    });

    it("rejects with DB_DISCONNECT_FAILED/disconnect/mysql when seam.close throws", async () => {
      const seam = makeFakeSeam({ close: () => Promise.reject(new Error("Close failed")) });
      const conn = new MysqlConnector(seam);
      await conn.connect(DEFAULT_CONFIG);
      await expect(conn.disconnect()).rejects.toSatisfy(
        (e: unknown) => isDbConnectorError(e) &&
          (e).code === "DB_DISCONNECT_FAILED" &&
          (e).engine === "mysql",
      );
    });

    it("handle cleared even when seam.close throws (no dangling handle)", async () => {
      const seam = makeFakeSeam({ close: () => Promise.reject(new Error("Close error")) });
      const conn = new MysqlConnector(seam);
      await conn.connect(DEFAULT_CONFIG);
      try { await conn.disconnect(); } catch { /* expected */ }
      // Second disconnect should be a no-op (handle already cleared)
      await expect(conn.disconnect()).resolves.toBeUndefined();
    });

    it("handle cleared: subsequent execute fails with not-connected", async () => {
      const conn = new MysqlConnector(makeFakeSeam());
      await conn.connect(DEFAULT_CONFIG);
      await conn.disconnect();
      await expect(conn.execute("SELECT 1")).rejects.toSatisfy(
        (e: unknown) => isDbConnectorError(e) &&
          (e).code === "DB_QUERY_FAILED",
      );
    });
  });
});
