import { describe, it, expect } from "vitest";

import {
  createDefaultMysqlSeam,
} from "../../../../src/db/drivers/mysql-seam.js";
import type {
  MysqlDriverSeam,
  MysqlHandle,
  MysqlQueryResult,
} from "../../../../src/db/drivers/mysql-seam.js";
import type { DriverRequireFn } from "../../../../src/db/drivers/seam-shared.js";
import { DbConnectorError, DB_ERROR_CODES } from "../../../../src/db/errors.js";
import type { ConnectionConfig } from "../../../../src/db/types.js";

/**
 * Unit tests for createDefaultMysqlSeam (src/db/drivers/mysql-seam.ts).
 *
 * Covers: seam interface structural contract; lazy-require (NOT required on
 * construction); happy-path (open, execute rows, execute ok-header, close);
 * missing-driver error (rejects with DbConnectorError, correct attrs,
 * secret-free); default-arg construction.
 *
 * RED PHASE: src/db/drivers/mysql-seam.ts does not exist yet.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_CONFIG: ConnectionConfig = {
  type: "mysql",
  host: "localhost",
  port: 3306,
  database: "test_db",
  user: "qa_user",
  password: "qa_pass",
};

/**
 * mysql2's real `execute()` returns a TUPLE `[result, fields]` — NOT the
 * `MysqlQueryResult` discriminated union. This fake matches the real driver
 * shape so the seam's tuple-unpacking code path is exercised (issue #43).
 */
type FakeMysql2Tuple = readonly [
  unknown[] | { affectedRows?: number },
  unknown[],
];

function makeFakeMysql2Module(): {
  createPool: (config: unknown) => {
    execute: (sql: string, values: unknown[]) => Promise<FakeMysql2Tuple>;
    end: () => Promise<void>;
  };
} {
  return {
    createPool: (_config: unknown) => ({
      async execute(
        _sql: string,
        _values: unknown[],
      ): Promise<FakeMysql2Tuple> {
        // RowDataPacket[] + FieldPacket[] — mimics real mysql2 SELECT shape.
        return [[{ id: 1 }], []];
      },
      async end(): Promise<void> {},
    }),
  };
}

// ---------------------------------------------------------------------------
// Seam interface structural contract
// ---------------------------------------------------------------------------

describe("MysqlDriverSeam — interface structural contract", () => {
  it("a hand-written fake literal satisfies the MysqlDriverSeam interface", () => {
    const fake: MysqlDriverSeam = {
      async open(_config: ConnectionConfig): Promise<MysqlHandle> {
        return { __mysqlHandle: true };
      },
      async execute(
        _handle: MysqlHandle,
        _sql: string,
        _values: readonly unknown[],
      ): Promise<MysqlQueryResult> {
        return { kind: "rows", rows: [] };
      },
      async close(_handle: MysqlHandle): Promise<void> {},
    };
    expect(typeof fake.open).toBe("function");
    expect(typeof fake.execute).toBe("function");
    expect(typeof fake.close).toBe("function");
  });

  it("MysqlQueryResult rows variant has kind 'rows' and rows array", () => {
    const result: MysqlQueryResult = { kind: "rows", rows: [{ col: "val" }] };
    expect(result.kind).toBe("rows");
    expect(Array.isArray(result.rows)).toBe(true);
  });

  it("MysqlQueryResult ok variant has kind 'ok' and affectedRows number", () => {
    const result: MysqlQueryResult = { kind: "ok", affectedRows: 3 };
    expect(result.kind).toBe("ok");
    expect(result.affectedRows).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Lazy-require
// ---------------------------------------------------------------------------

describe("createDefaultMysqlSeam — lazy-require", () => {
  it("does NOT call requireFn on construction", () => {
    let called = false;
    const fn: DriverRequireFn = () => {
      called = true;
      return makeFakeMysql2Module();
    };
    createDefaultMysqlSeam(fn);
    expect(called).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe("createDefaultMysqlSeam — happy path (fake requireFn)", () => {
  it("open() calls requireFn with 'mysql2/promise'", async () => {
    const calledWith: string[] = [];
    const fn: DriverRequireFn = (id) => {
      calledWith.push(id);
      return makeFakeMysql2Module();
    };
    const seam = createDefaultMysqlSeam(fn);
    await seam.open(BASE_CONFIG);
    expect(calledWith[0]).toBe("mysql2/promise");
  });

  it("open() resolves with a handle that has the __mysqlHandle brand", async () => {
    const seam = createDefaultMysqlSeam(() => makeFakeMysql2Module());
    const handle = await seam.open(BASE_CONFIG);
    expect(handle.__mysqlHandle).toBe(true);
  });

  it("execute() returns a MysqlQueryResult rows variant", async () => {
    const seam = createDefaultMysqlSeam(() => makeFakeMysql2Module());
    const handle = await seam.open(BASE_CONFIG);
    const result = await seam.execute(handle, "SELECT * FROM t WHERE id = ?", [1]);
    expect(result.kind).toBe("rows");
  });

  it("execute() returns a MysqlQueryResult ok variant when pool returns affectedRows shape", async () => {
    // mysql2's real shape for DML is `[OkPacket, FieldPacket[]]`.
    const fn: DriverRequireFn = () => ({
      createPool: (_config: unknown) => ({
        async execute(
          _sql: string,
          _values: unknown[],
        ): Promise<FakeMysql2Tuple> {
          return [{ affectedRows: 2 }, []];
        },
        async end(): Promise<void> {},
      }),
    });
    const seam = createDefaultMysqlSeam(fn);
    const handle = await seam.open(BASE_CONFIG);
    const result = await seam.execute(handle, "DELETE FROM t WHERE id = ?", [42]);
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") expect(result.affectedRows).toBe(2);
  });

  it("execute() defaults affectedRows to 0 when DML result omits it", async () => {
    // mysql2 occasionally returns an OkPacket WITHOUT affectedRows (some DDL).
    const fn: DriverRequireFn = () => ({
      createPool: (_config: unknown) => ({
        async execute(
          _sql: string,
          _values: unknown[],
        ): Promise<FakeMysql2Tuple> {
          return [{}, []];   // OkPacket-like object with no affectedRows
        },
        async end(): Promise<void> {},
      }),
    });
    const seam = createDefaultMysqlSeam(fn);
    const handle = await seam.open(BASE_CONFIG);
    const result = await seam.execute(handle, "CREATE INDEX i ON t(c)", []);
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") expect(result.affectedRows).toBe(0);
  });

  it("execute() returns rows verbatim — issue #43 regression (real mysql2 tuple shape)", async () => {
    // Pin: before the fix, the seam cast the [rows, fields] tuple directly to
    // MysqlQueryResult, which silently fell into the "ok" arm → rowCount 0
    // for every SELECT. This test verifies the tuple IS now unpacked.
    const fn: DriverRequireFn = () => ({
      createPool: (_config: unknown) => ({
        async execute(
          _sql: string,
          _values: unknown[],
        ): Promise<FakeMysql2Tuple> {
          return [
            [{ id: 1, name: "a" }, { id: 2, name: "b" }],
            [{ name: "id" }, { name: "name" }],
          ];
        },
        async end(): Promise<void> {},
      }),
    });
    const seam = createDefaultMysqlSeam(fn);
    const handle = await seam.open(BASE_CONFIG);
    const result = await seam.execute(handle, "SELECT id, name FROM t", []);
    expect(result.kind).toBe("rows");
    if (result.kind === "rows") {
      expect(result.rows).toHaveLength(2);
      expect(result.rows[0]).toEqual({ id: 1, name: "a" });
      expect(result.rows[1]).toEqual({ id: 2, name: "b" });
    }
  });

  it("close() resolves without throwing", async () => {
    const seam = createDefaultMysqlSeam(() => makeFakeMysql2Module());
    const handle = await seam.open(BASE_CONFIG);
    await expect(seam.close(handle)).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Missing-driver error path
// ---------------------------------------------------------------------------

describe("createDefaultMysqlSeam — missing-driver error path", () => {
  const missingFn: DriverRequireFn = () => {
    throw new Error("Cannot find module 'mysql2/promise'");
  };

  it("open() rejects with a DbConnectorError", async () => {
    const seam = createDefaultMysqlSeam(missingFn);
    await expect(seam.open(BASE_CONFIG)).rejects.toBeInstanceOf(DbConnectorError);
  });

  it("the error has code DB_CONNECTION_FAILED", async () => {
    const seam = createDefaultMysqlSeam(missingFn);
    try {
      await seam.open(BASE_CONFIG);
      expect.fail("should have rejected");
    } catch (e) {
      expect((e as DbConnectorError).code).toBe(DB_ERROR_CODES.DB_CONNECTION_FAILED);
    }
  });

  it("the error has engine 'mysql'", async () => {
    const seam = createDefaultMysqlSeam(missingFn);
    try {
      await seam.open(BASE_CONFIG);
      expect.fail("should have rejected");
    } catch (e) {
      expect((e as DbConnectorError).engine).toBe("mysql");
    }
  });

  it("the error message contains 'npm install' (install hint)", async () => {
    const seam = createDefaultMysqlSeam(missingFn);
    try {
      await seam.open(BASE_CONFIG);
      expect.fail("should have rejected");
    } catch (e) {
      expect((e as DbConnectorError).message).toContain("npm install");
    }
  });

  it("the error message is secret-free (no credentials from config)", async () => {
    const cfg: ConnectionConfig = {
      type: "mysql",
      password: "super_secret_db_pass",
    };
    const seam = createDefaultMysqlSeam(missingFn);
    try {
      await seam.open(cfg);
      expect.fail("should have rejected");
    } catch (e) {
      expect((e as DbConnectorError).message).not.toContain("super_secret_db_pass");
    }
  });
});

// ---------------------------------------------------------------------------
// Default-arg construction
// ---------------------------------------------------------------------------

describe("createDefaultMysqlSeam — default-arg construction (no requireFn)", () => {
  it("constructs without throwing when called with no arguments", () => {
    expect(() => createDefaultMysqlSeam()).not.toThrow();
  });

  it("returns an object with the correct seam method shapes", () => {
    const seam = createDefaultMysqlSeam();
    expect(typeof seam.open).toBe("function");
    expect(typeof seam.execute).toBe("function");
    expect(typeof seam.close).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// Config → mysql2.createPool options mapping (issue #31)
// ---------------------------------------------------------------------------

describe("createDefaultMysqlSeam — config maps to createPool options", () => {
  /** Fake module whose createPool captures the options it received. */
  function capturingModule(sink: { config?: unknown }): {
    createPool: (config: unknown) => {
      execute: () => Promise<MysqlQueryResult>;
      end: () => Promise<void>;
    };
  } {
    return {
      createPool: (config: unknown) => {
        sink.config = config;
        return {
          async execute(): Promise<MysqlQueryResult> {
            return [[], []] as unknown as MysqlQueryResult;
          },
          async end(): Promise<void> {},
        };
      },
    };
  }

  it("maps a `url` connection string to mysql2 `uri` and drops `type`", async () => {
    const sink: { config?: unknown } = {};
    const seam = createDefaultMysqlSeam((() => capturingModule(sink)));
    await seam.open({ type: "mysql", url: "mysql://u:p@h:3306/db" });
    expect(sink.config).toEqual({ uri: "mysql://u:p@h:3306/db" });
  });

  it("passes discrete fields through and drops `type`", async () => {
    const sink: { config?: unknown } = {};
    const seam = createDefaultMysqlSeam((() => capturingModule(sink)));
    await seam.open(BASE_CONFIG);
    expect(sink.config).toEqual({
      host: "localhost",
      port: 3306,
      database: "test_db",
      user: "qa_user",
      password: "qa_pass",
    });
  });
});
