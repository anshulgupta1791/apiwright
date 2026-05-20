import { describe, it, expect } from "vitest";

import {
  createDefaultMongodbSeam,
} from "../../../../src/db/drivers/mongodb-seam.js";
import type {
  MongodbDriverSeam,
  MongoHandle,
  MongoCommandResult,
  MongoOperation,
} from "../../../../src/db/drivers/mongodb-seam.js";
import type { DriverRequireFn } from "../../../../src/db/drivers/seam-shared.js";
import { DbConnectorError, DB_ERROR_CODES } from "../../../../src/db/errors.js";
import type { ConnectionConfig } from "../../../../src/db/types.js";

/**
 * Unit tests for createDefaultMongodbSeam (src/db/drivers/mongodb-seam.ts).
 *
 * Covers: seam interface structural contract; lazy-require; happy-path (open,
 * runCommand, close); missing-driver error (DbConnectorError, correct attrs,
 * secret-free); default-arg construction.
 *
 * RED PHASE: src/db/drivers/mongodb-seam.ts does not exist yet.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_CONFIG: ConnectionConfig = {
  type: "mongodb",
  uri: "mongodb://localhost:27017/test_db",
};

function makeFakeMongoModule(): {
  MongoClient: new (uri: string) => {
    connect: () => Promise<void>;
    db: (name: string) => { command: (cmd: Record<string, unknown>) => Promise<unknown> };
    close: () => Promise<void>;
  };
} {
  return {
    MongoClient: class FakeMongoClient {
      constructor(_uri: string) {}
      async connect(): Promise<void> {}
      db(_name: string): { command: (cmd: Record<string, unknown>) => Promise<MongoCommandResult> } {
        return {
          async command(
            _cmd: Record<string, unknown>,
          ): Promise<MongoCommandResult> {
            return { documents: [{ _id: "abc", name: "test" }] };
          },
        };
      }
      async close(): Promise<void> {}
    },
  };
}

// ---------------------------------------------------------------------------
// Seam interface structural contract
// ---------------------------------------------------------------------------

describe("MongodbDriverSeam — interface structural contract", () => {
  it("a hand-written fake literal satisfies the MongodbDriverSeam interface", () => {
    const fake: MongodbDriverSeam = {
      async open(_config: ConnectionConfig): Promise<MongoHandle> {
        return { __mongoHandle: true };
      },
      async runCommand(
        _handle: MongoHandle,
        _operation: MongoOperation,
      ): Promise<MongoCommandResult> {
        return { documents: [] };
      },
      async close(_handle: MongoHandle): Promise<void> {},
    };
    expect(typeof fake.open).toBe("function");
    expect(typeof fake.runCommand).toBe("function");
    expect(typeof fake.close).toBe("function");
  });

  it("MongoCommandResult has documents array (and optional affected)", () => {
    const result: MongoCommandResult = {
      documents: [{ _id: "1", name: "doc" }],
      affected: 1,
    };
    expect(Array.isArray(result.documents)).toBe(true);
    expect(result.affected).toBe(1);
  });

  it("MongoCommandResult without affected is valid", () => {
    const result: MongoCommandResult = { documents: [] };
    expect(Array.isArray(result.documents)).toBe(true);
    expect(result.affected).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Lazy-require
// ---------------------------------------------------------------------------

describe("createDefaultMongodbSeam — lazy-require", () => {
  it("does NOT call requireFn on construction", () => {
    let called = false;
    const fn: DriverRequireFn = () => {
      called = true;
      return makeFakeMongoModule();
    };
    createDefaultMongodbSeam(fn);
    expect(called).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe("createDefaultMongodbSeam — happy path (fake requireFn)", () => {
  it("open() calls requireFn with 'mongodb'", async () => {
    const calledWith: string[] = [];
    const fn: DriverRequireFn = (id) => {
      calledWith.push(id);
      return makeFakeMongoModule();
    };
    const seam = createDefaultMongodbSeam(fn);
    await seam.open(BASE_CONFIG);
    expect(calledWith[0]).toBe("mongodb");
  });

  it("open() resolves with a handle that has the __mongoHandle brand", async () => {
    const seam = createDefaultMongodbSeam(() => makeFakeMongoModule());
    const handle = await seam.open(BASE_CONFIG);
    expect(handle.__mongoHandle).toBe(true);
  });

  it("runCommand() resolves with a MongoCommandResult containing documents", async () => {
    const seam = createDefaultMongodbSeam(() => makeFakeMongoModule());
    const handle = await seam.open(BASE_CONFIG);
    const op: MongoOperation = {
      database: "test_db",
      command: { find: "users", filter: {} },
    };
    const result = await seam.runCommand(handle, op);
    expect(Array.isArray(result.documents)).toBe(true);
  });

  it("runCommand() falls back to { documents: [] } when the driver result lacks 'documents'", async () => {
    // Real MongoDB driver `db.command()` returns cursor-shaped results for find
    // (e.g. { cursor: { firstBatch: [] }, ok: 1 }) which do NOT have a top-level
    // 'documents' key. The seam normalizes this to { documents: [] }.
    const fakeModuleWithNoCursorDocs = {
      MongoClient: class {
        constructor(_uri: string) {}
        async connect(): Promise<void> {}
        db(_name: string): { command: (_cmd: Record<string, unknown>) => Promise<unknown> } {
          return {
            // Returns a result WITHOUT 'documents' — mirrors the raw cursor response
            async command(_cmd: Record<string, unknown>): Promise<unknown> {
              return { ok: 1, cursor: { firstBatch: [] } };
            },
          };
        }
        async close(): Promise<void> {}
      },
    };
    const seam = createDefaultMongodbSeam(() => fakeModuleWithNoCursorDocs);
    const handle = await seam.open(BASE_CONFIG);
    const op: MongoOperation = {
      database: "test_db",
      command: { find: "users", filter: {} },
    };
    const result = await seam.runCommand(handle, op);
    // Fallback to empty documents array — shape is normalized
    expect(Array.isArray(result.documents)).toBe(true);
    expect(result.documents).toHaveLength(0);
  });

  it("close() resolves without throwing", async () => {
    const seam = createDefaultMongodbSeam(() => makeFakeMongoModule());
    const handle = await seam.open(BASE_CONFIG);
    await expect(seam.close(handle)).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Missing-driver error path
// ---------------------------------------------------------------------------

describe("createDefaultMongodbSeam — missing-driver error path", () => {
  const missingFn: DriverRequireFn = () => {
    throw new Error("Cannot find module 'mongodb'");
  };

  it("open() rejects with a DbConnectorError", async () => {
    const seam = createDefaultMongodbSeam(missingFn);
    await expect(seam.open(BASE_CONFIG)).rejects.toBeInstanceOf(DbConnectorError);
  });

  it("the error has code DB_CONNECTION_FAILED", async () => {
    const seam = createDefaultMongodbSeam(missingFn);
    try {
      await seam.open(BASE_CONFIG);
      expect.fail("should have rejected");
    } catch (e) {
      expect((e as DbConnectorError).code).toBe(DB_ERROR_CODES.DB_CONNECTION_FAILED);
    }
  });

  it("the error has engine 'mongodb'", async () => {
    const seam = createDefaultMongodbSeam(missingFn);
    try {
      await seam.open(BASE_CONFIG);
      expect.fail("should have rejected");
    } catch (e) {
      expect((e as DbConnectorError).engine).toBe("mongodb");
    }
  });

  it("the error message contains 'npm install' install hint", async () => {
    const seam = createDefaultMongodbSeam(missingFn);
    try {
      await seam.open(BASE_CONFIG);
      expect.fail("should have rejected");
    } catch (e) {
      expect((e as DbConnectorError).message).toContain("npm install");
    }
  });

  it("the error message is secret-free (no URI or credentials from config)", async () => {
    const cfg: ConnectionConfig = {
      type: "mongodb",
      uri: "mongodb://user:secret_mongo_pass@host:27017/db",
    };
    const seam = createDefaultMongodbSeam(missingFn);
    try {
      await seam.open(cfg);
      expect.fail("should have rejected");
    } catch (e) {
      expect((e as DbConnectorError).message).not.toContain("secret_mongo_pass");
      expect((e as DbConnectorError).message).not.toContain(
        "mongodb://user:secret_mongo_pass@host:27017/db",
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Default-arg construction
// ---------------------------------------------------------------------------

describe("createDefaultMongodbSeam — default-arg construction (no requireFn)", () => {
  it("constructs without throwing when called with no arguments", () => {
    expect(() => createDefaultMongodbSeam()).not.toThrow();
  });

  it("returns an object with the correct seam method shapes", () => {
    const seam = createDefaultMongodbSeam();
    expect(typeof seam.open).toBe("function");
    expect(typeof seam.runCommand).toBe("function");
    expect(typeof seam.close).toBe("function");
  });
});
