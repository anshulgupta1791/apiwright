import { describe, it, expect } from "vitest";

import {
  requireDriverOrThrow,
} from "../../../../src/db/drivers/seam-shared.js";
import type { DriverRequireFn } from "../../../../src/db/drivers/seam-shared.js";
import { DbConnectorError, DB_ERROR_CODES } from "../../../../src/db/errors.js";

/**
 * Unit tests for seam-shared.ts (src/db/drivers/seam-shared.ts).
 *
 * Covers: DriverRequireFn type (callable, any return); requireDriverOrThrow
 * happy path (returns the module); missing-driver path (rejects with
 * DbConnectorError whose code/phase/engine/message are correct and
 * secret-free); any-throw-becomes-DbConnectorError (non-MODULE_NOT_FOUND
 * errors still wrapped); cause is attached.
 *
 * RED PHASE: src/db/drivers/seam-shared.ts does not exist yet.
 */

// ---------------------------------------------------------------------------
// DriverRequireFn type — runtime proof
// ---------------------------------------------------------------------------

describe("DriverRequireFn", () => {
  it("accepts a function that returns a plain object (stub module)", () => {
    const fn: DriverRequireFn = (_moduleId: string) => ({ Pool: class {} });
    const result = fn("pg");
    expect(typeof result).toBe("object");
  });

  it("accepts a function that throws (the missing-driver path)", () => {
    const fn: DriverRequireFn = () => {
      throw new Error("Cannot find module 'pg'");
    };
    expect(() => fn("pg")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// requireDriverOrThrow — happy path
// ---------------------------------------------------------------------------

describe("requireDriverOrThrow — happy path (driver present)", () => {
  it("returns the module the requireFn provides without throwing", () => {
    const fakeModule = { Pool: class {}, createPool: () => ({}) };
    const fakeRequire: DriverRequireFn = () => fakeModule;
    const result = requireDriverOrThrow(fakeRequire, "pg", "postgres", "npm install pg");
    expect(result).toBe(fakeModule);
  });

  it("does not throw when requireFn succeeds", () => {
    const fakeRequire: DriverRequireFn = () => ({ execute: () => {} });
    expect(() =>
      requireDriverOrThrow(fakeRequire, "mysql2/promise", "mysql", "npm install mysql2"),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// requireDriverOrThrow — missing-driver / error path
// ---------------------------------------------------------------------------

describe("requireDriverOrThrow — missing driver error path", () => {
  const missingFn: DriverRequireFn = () => {
    throw new Error("Cannot find module 'pg'");
  };

  it("throws a DbConnectorError (not the raw require error)", () => {
    expect(() =>
      requireDriverOrThrow(missingFn, "pg", "postgres", "npm install pg"),
    ).toThrow(DbConnectorError);
  });

  it("the thrown error has code DB_CONNECTION_FAILED", () => {
    let caught: unknown;
    try {
      requireDriverOrThrow(missingFn, "pg", "postgres", "npm install pg");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(DbConnectorError);
    expect((caught as DbConnectorError).code).toBe(DB_ERROR_CODES.DB_CONNECTION_FAILED);
  });

  it("the thrown error has phase 'connect'", () => {
    let caught: unknown;
    try {
      requireDriverOrThrow(missingFn, "pg", "postgres", "npm install pg");
    } catch (e) {
      caught = e;
    }
    expect((caught as DbConnectorError).phase).toBe("connect");
  });

  it("the thrown error has the engine 'postgres'", () => {
    let caught: unknown;
    try {
      requireDriverOrThrow(missingFn, "pg", "postgres", "npm install pg");
    } catch (e) {
      caught = e;
    }
    expect((caught as DbConnectorError).engine).toBe("postgres");
  });

  it("the error message contains the install hint (secret-free)", () => {
    let caught: unknown;
    try {
      requireDriverOrThrow(missingFn, "pg", "postgres", "npm install pg");
    } catch (e) {
      caught = e;
    }
    expect((caught as DbConnectorError).message).toContain("npm install pg");
  });

  it("the error message does NOT contain the raw require error's text (no credential/URI leakage)", () => {
    const secretFn: DriverRequireFn = () => {
      throw new Error("Cannot find module 'pg' at /path/with/credentials?pass=secret123");
    };
    let caught: unknown;
    try {
      requireDriverOrThrow(secretFn, "pg", "postgres", "npm install pg");
    } catch (e) {
      caught = e;
    }
    expect((caught as DbConnectorError).message).not.toContain("secret123");
    expect((caught as DbConnectorError).message).not.toContain("credentials");
  });

  it("the cause is the original require error", () => {
    const originalError = new Error("Cannot find module 'pg'");
    const fn: DriverRequireFn = () => { throw originalError; };
    let caught: unknown;
    try {
      requireDriverOrThrow(fn, "pg", "postgres", "npm install pg");
    } catch (e) {
      caught = e;
    }
    expect((caught as DbConnectorError).cause).toBe(originalError);
  });

  it("any throw from requireFn (not just MODULE_NOT_FOUND) becomes a DbConnectorError", () => {
    const corruptFn: DriverRequireFn = () => {
      throw new RangeError("native binding load failure");
    };
    expect(() =>
      requireDriverOrThrow(corruptFn, "pg", "postgres", "npm install pg"),
    ).toThrow(DbConnectorError);
  });

  it("works for each of the four engines (mysql engine)", () => {
    const fn: DriverRequireFn = () => { throw new Error("not found"); };
    let caught: unknown;
    try {
      requireDriverOrThrow(fn, "mysql2/promise", "mysql", "npm install mysql2");
    } catch (e) {
      caught = e;
    }
    expect((caught as DbConnectorError).engine).toBe("mysql");
  });

  it("works for each of the four engines (mongodb engine)", () => {
    const fn: DriverRequireFn = () => { throw new Error("not found"); };
    let caught: unknown;
    try {
      requireDriverOrThrow(fn, "mongodb", "mongodb", "npm install mongodb");
    } catch (e) {
      caught = e;
    }
    expect((caught as DbConnectorError).engine).toBe("mongodb");
  });

  it("works for each of the four engines (neo4j engine)", () => {
    const fn: DriverRequireFn = () => { throw new Error("not found"); };
    let caught: unknown;
    try {
      requireDriverOrThrow(fn, "neo4j-driver", "neo4j", "npm install neo4j-driver");
    } catch (e) {
      caught = e;
    }
    expect((caught as DbConnectorError).engine).toBe("neo4j");
  });
});
