import { describe, it, expect } from "vitest";

import {
  DB_ERROR_CODES,
  DbConnectorError,
  isDbConnectorError,
} from "../../../src/db/errors.js";
import type {
  DbPhase,
  DbErrorCode,
  DbConnectorErrorInit,
} from "../../../src/db/errors.js";

/**
 * Unit tests for the S5 DB connector error taxonomy (src/db/errors.ts).
 *
 * src/db/errors.ts carries runtime exports (class + frozen record + guard)
 * and is NOT coverage-excluded. These tests drive it to ~100% branch coverage.
 *
 * RED PHASE: src/db/errors.ts does not exist yet. This file fails with
 * module-not-found until the implementation-engineer creates that module.
 *
 * Categories covered:
 * - DB_ERROR_CODES: key===value for every member; Object.isFrozen; four distinct codes;
 *   all expected keys present.
 * - DbConnectorError: instanceof Error; name === "DbConnectorError"; message/code/
 *   phase/engine round-trip; cause attached when provided; cause absent when omitted;
 *   secret-free message contract pin.
 * - isDbConnectorError: true for DbConnectorError; false for plain Error, null,
 *   undefined, string, and POJO look-alike.
 */

// ---------------------------------------------------------------------------
// DB_ERROR_CODES - frozen record, keys === values, four distinct codes
// ---------------------------------------------------------------------------

describe("DB_ERROR_CODES", () => {
  it("is frozen (Object.isFrozen returns true)", () => {
    expect(Object.isFrozen(DB_ERROR_CODES)).toBe(true);
  });

  it("contains exactly the four design-specified codes as own keys", () => {
    const keys = Object.keys(DB_ERROR_CODES).sort();
    expect(keys).toEqual([
      "DB_CONNECTION_FAILED",
      "DB_DISCONNECT_FAILED",
      "DB_PARAM_NOT_BINDABLE",
      "DB_QUERY_FAILED",
    ]);
  });

  it("has key === value for DB_CONNECTION_FAILED", () => {
    expect(DB_ERROR_CODES.DB_CONNECTION_FAILED).toBe("DB_CONNECTION_FAILED");
  });

  it("has key === value for DB_QUERY_FAILED", () => {
    expect(DB_ERROR_CODES.DB_QUERY_FAILED).toBe("DB_QUERY_FAILED");
  });

  it("has key === value for DB_PARAM_NOT_BINDABLE", () => {
    expect(DB_ERROR_CODES.DB_PARAM_NOT_BINDABLE).toBe("DB_PARAM_NOT_BINDABLE");
  });

  it("has key === value for DB_DISCONNECT_FAILED", () => {
    expect(DB_ERROR_CODES.DB_DISCONNECT_FAILED).toBe("DB_DISCONNECT_FAILED");
  });

  it("all four codes are mutually distinct string values", () => {
    const values = Object.values(DB_ERROR_CODES);
    const unique = new Set<string>(values);
    expect(unique.size).toBe(4);
  });

  it("does not mutate when an assignment is attempted (frozen object)", () => {
    // In strict mode (ESM modules always run strict) this would throw; in
    // non-strict it silently fails. We verify the value is unchanged either way.
    try {
      // @ts-expect-error - intentional attempt to mutate a frozen object
      DB_ERROR_CODES["DB_CONNECTION_FAILED"] = "MUTATED";
    } catch {
      // expected in strict mode
    }
    expect(DB_ERROR_CODES.DB_CONNECTION_FAILED).toBe("DB_CONNECTION_FAILED");
  });
});

// ---------------------------------------------------------------------------
// DbConnectorError - Error subclass with code / phase / engine
// ---------------------------------------------------------------------------

describe("DbConnectorError - construction and shape", () => {
  it("is an instance of Error", () => {
    const err = new DbConnectorError({
      code: "DB_CONNECTION_FAILED",
      phase: "connect",
      engine: "postgres",
      message: "host unreachable",
    });
    expect(err).toBeInstanceOf(Error);
  });

  it("is an instance of DbConnectorError", () => {
    const err = new DbConnectorError({
      code: "DB_QUERY_FAILED",
      phase: "execute",
      engine: "mysql",
      message: "query syntax error",
    });
    expect(err).toBeInstanceOf(DbConnectorError);
  });

  it("has name === 'DbConnectorError' (matches new.target.name pattern)", () => {
    const err = new DbConnectorError({
      code: "DB_QUERY_FAILED",
      phase: "execute",
      engine: "mongodb",
      message: "bad aggregation pipeline",
    });
    expect(err.name).toBe("DbConnectorError");
  });

  it("carries the message passed in the init object", () => {
    const err = new DbConnectorError({
      code: "DB_CONNECTION_FAILED",
      phase: "connect",
      engine: "neo4j",
      message: "bolt connection refused",
    });
    expect(err.message).toBe("bolt connection refused");
  });

  it("carries the code from the init object (DB_CONNECTION_FAILED)", () => {
    const err = new DbConnectorError({
      code: "DB_CONNECTION_FAILED",
      phase: "connect",
      engine: "postgres",
      message: "auth rejected",
    });
    const code: DbErrorCode = err.code;
    expect(code).toBe("DB_CONNECTION_FAILED");
  });

  it("carries the code from the init object (DB_QUERY_FAILED)", () => {
    const err = new DbConnectorError({
      code: "DB_QUERY_FAILED",
      phase: "execute",
      engine: "mysql",
      message: "table does not exist",
    });
    expect(err.code).toBe("DB_QUERY_FAILED");
  });

  it("carries the code from the init object (DB_PARAM_NOT_BINDABLE)", () => {
    const err = new DbConnectorError({
      code: "DB_PARAM_NOT_BINDABLE",
      phase: "bind",
      engine: "postgres",
      message: "parameter type cannot be bound natively",
    });
    expect(err.code).toBe("DB_PARAM_NOT_BINDABLE");
  });

  it("carries the code from the init object (DB_DISCONNECT_FAILED)", () => {
    const err = new DbConnectorError({
      code: "DB_DISCONNECT_FAILED",
      phase: "disconnect",
      engine: "mongodb",
      message: "socket close error",
    });
    expect(err.code).toBe("DB_DISCONNECT_FAILED");
  });

  it("carries the phase from the init object (connect)", () => {
    const err = new DbConnectorError({
      code: "DB_CONNECTION_FAILED",
      phase: "connect",
      engine: "postgres",
      message: "unreachable",
    });
    const phase: DbPhase = err.phase;
    expect(phase).toBe("connect");
  });

  it("carries the phase from the init object (execute)", () => {
    const err = new DbConnectorError({
      code: "DB_QUERY_FAILED",
      phase: "execute",
      engine: "mysql",
      message: "syntax error",
    });
    expect(err.phase).toBe("execute");
  });

  it("carries the phase from the init object (bind)", () => {
    const err = new DbConnectorError({
      code: "DB_PARAM_NOT_BINDABLE",
      phase: "bind",
      engine: "postgres",
      message: "non-bindable param",
    });
    expect(err.phase).toBe("bind");
  });

  it("carries the phase from the init object (disconnect)", () => {
    const err = new DbConnectorError({
      code: "DB_DISCONNECT_FAILED",
      phase: "disconnect",
      engine: "neo4j",
      message: "teardown failed",
    });
    expect(err.phase).toBe("disconnect");
  });

  it("carries the engine from the init object (postgres)", () => {
    const err = new DbConnectorError({
      code: "DB_CONNECTION_FAILED",
      phase: "connect",
      engine: "postgres",
      message: "pg unreachable",
    });
    expect(err.engine).toBe("postgres");
  });

  it("carries the engine from the init object (mysql)", () => {
    const err = new DbConnectorError({
      code: "DB_QUERY_FAILED",
      phase: "execute",
      engine: "mysql",
      message: "bad query",
    });
    expect(err.engine).toBe("mysql");
  });

  it("carries the engine from the init object (mongodb)", () => {
    const err = new DbConnectorError({
      code: "DB_CONNECTION_FAILED",
      phase: "connect",
      engine: "mongodb",
      message: "srv lookup failed",
    });
    expect(err.engine).toBe("mongodb");
  });

  it("carries the engine from the init object (neo4j)", () => {
    const err = new DbConnectorError({
      code: "DB_QUERY_FAILED",
      phase: "execute",
      engine: "neo4j",
      message: "cypher parse error",
    });
    expect(err.engine).toBe("neo4j");
  });
});

describe("DbConnectorError - cause attachment", () => {
  it("attaches cause when provided in the init object", () => {
    const driverError = new Error("underlying driver error");
    const err = new DbConnectorError({
      code: "DB_QUERY_FAILED",
      phase: "execute",
      engine: "postgres",
      message: "query failed",
      cause: driverError,
    });
    expect(err.cause).toBe(driverError);
  });

  it("cause is undefined when not provided in the init object", () => {
    const err = new DbConnectorError({
      code: "DB_CONNECTION_FAILED",
      phase: "connect",
      engine: "mysql",
      message: "host unreachable",
    });
    expect(err.cause).toBeUndefined();
  });

  it("accepts any value as cause (not restricted to Error instances)", () => {
    const err = new DbConnectorError({
      code: "DB_QUERY_FAILED",
      phase: "execute",
      engine: "mongodb",
      message: "driver rejected",
      cause: { code: 42, detail: "raw driver object" },
    });
    expect(err.cause).toEqual({ code: 42, detail: "raw driver object" });
  });
});

describe("DbConnectorError - secret-free message contract", () => {
  it("a message built from a fake credential config does not surface the credential in .message", () => {
    // The design's secret-safety invariant: the class NEVER adds leakage on its own.
    // The connector is responsible for sanitizing before construction; this test
    // verifies the class itself does not inject the raw init fields into .message.
    const fakePassword = "p@ssw0rd_from_secret_store";
    const fakeUri = "mongodb://user:p@ssw0rd_from_secret_store@host:27017/db";
    const sanitizedMessage = "connection refused (credentials omitted)";

    const err = new DbConnectorError({
      code: "DB_CONNECTION_FAILED",
      phase: "connect",
      engine: "mongodb",
      message: sanitizedMessage,
      // The cause might carry raw driver output - but the class does NOT include
      // cause content in .message, so even an injected cause cannot leak via .message.
      cause: new Error(`failed with uri ${fakeUri}`),
    });

    // Only the sanitized message string was passed - it does not contain credentials
    expect(err.message).toBe(sanitizedMessage);
    expect(err.message).not.toContain(fakePassword);
    expect(err.message).not.toContain(fakeUri);
  });

  it("the engine field in .message is the engine string (not a URI or credential)", () => {
    const err = new DbConnectorError({
      code: "DB_CONNECTION_FAILED",
      phase: "connect",
      engine: "postgres",
      message: "connection timeout",
    });
    // .message is exactly what was passed - a safe string, not a formatted message
    // that concatenates engine+credentials
    expect(err.message).toBe("connection timeout");
    expect(err.engine).toBe("postgres");
  });

  it("DbConnectorErrorInit type accepts all required fields with a readonly message", () => {
    // Structural check: build an init object and assert the types are correct at runtime
    const init: DbConnectorErrorInit = {
      code: "DB_PARAM_NOT_BINDABLE",
      phase: "bind",
      engine: "mysql",
      message: "parameter 'id' cannot be bound natively",
    };
    expect(init.code).toBe("DB_PARAM_NOT_BINDABLE");
    expect(init.phase).toBe("bind");
    expect(init.engine).toBe("mysql");
    expect(init.message).toBe("parameter 'id' cannot be bound natively");
  });
});

// ---------------------------------------------------------------------------
// isDbConnectorError - type guard, both branches
// ---------------------------------------------------------------------------

describe("isDbConnectorError - type guard", () => {
  it("returns true for a DbConnectorError instance", () => {
    const err = new DbConnectorError({
      code: "DB_QUERY_FAILED",
      phase: "execute",
      engine: "postgres",
      message: "query failed",
    });
    expect(isDbConnectorError(err)).toBe(true);
  });

  it("returns false for a plain Error (not a DbConnectorError)", () => {
    const err = new Error("plain error");
    expect(isDbConnectorError(err)).toBe(false);
  });

  it("returns false for null", () => {
    expect(isDbConnectorError(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isDbConnectorError(undefined)).toBe(false);
  });

  it("returns false for a string", () => {
    expect(isDbConnectorError("DB_CONNECTION_FAILED")).toBe(false);
  });

  it("returns false for a POJO look-alike with code/phase/engine fields", () => {
    // A plain object with the same shape is NOT an instanceof DbConnectorError
    const lookalike = {
      code: "DB_QUERY_FAILED",
      phase: "execute",
      engine: "postgres",
      message: "fake",
    };
    expect(isDbConnectorError(lookalike)).toBe(false);
  });

  it("returns false for a number", () => {
    expect(isDbConnectorError(42)).toBe(false);
  });

  it("returns false for a TypeError (different Error subclass)", () => {
    const err = new TypeError("type mismatch");
    expect(isDbConnectorError(err)).toBe(false);
  });

  it("narrows the type to DbConnectorError in a conditional branch (type narrowing)", () => {
    const value: unknown = new DbConnectorError({
      code: "DB_DISCONNECT_FAILED",
      phase: "disconnect",
      engine: "neo4j",
      message: "teardown error",
    });

    if (isDbConnectorError(value)) {
      // Inside this branch, TypeScript knows value is DbConnectorError
      // Accessing .code without a cast proves the narrowing works
      const code: DbErrorCode = value.code;
      expect(code).toBe("DB_DISCONNECT_FAILED");
      expect(value.phase).toBe("disconnect");
      expect(value.engine).toBe("neo4j");
    } else {
      // This branch must not be reached in this test
      expect.fail("isDbConnectorError should have returned true for a DbConnectorError");
    }
  });
});
