import { describe, it, expect } from "vitest";

import type {
  DbConnector,
  DbEngine,
  ConnectionConfig,
  QueryParams,
} from "../../../src/db/types.js";
import type { DatabaseConfig } from "../../../src/env/types.js";
import type { NormalizedResult } from "../../../src/core/normalized-result.js";

/**
 * Unit tests for the S5 DB connector types (src/db/types.ts).
 *
 * src/db/types.ts is declaration-only and covered by the "src/types.ts" glob
 * coverage exclusion in vitest config - it carries zero runtime statements.
 * These tests exercise the structural contracts at runtime (typed literals)
 * and pin type-level correctness via @ts-expect-error directives, exactly as
 * tests/unit/core/normalized-result.test.ts does for its declaration-only
 * module.
 *
 * RED PHASE: src/db/types.ts does not exist yet. This file fails with
 * module-not-found until the implementation-engineer creates that module.
 *
 * Categories covered:
 * - DbConnector structural contract (three async methods, correct signatures)
 * - DbEngine alias: accepts exactly the four v1 engines; rejects unknown values
 * - ConnectionConfig alias: structurally identical to DatabaseConfig (alias identity)
 * - QueryParams: Record<string, unknown>; execute() with no params type-checks
 */

// ---------------------------------------------------------------------------
// DbConnector structural contract
// ---------------------------------------------------------------------------

describe("DbConnector - structural interface contract", () => {
  it("accepts an object with connect/execute/disconnect of the correct async signatures", () => {
    // This is a runtime-typed structural proof: the object literal satisfies
    // DbConnector at the TypeScript level AND its methods are callable.
    const stub: DbConnector = {
      connect: async (_config: ConnectionConfig) => { /* no-op */ },
      execute: async (_query: string, _params?: QueryParams): Promise<NormalizedResult> => ({
        rows: [],
        rowCount: 0,
        raw: null,
      }),
      disconnect: async () => { /* no-op */ },
    };

    expect(typeof stub.connect).toBe("function");
    expect(typeof stub.execute).toBe("function");
    expect(typeof stub.disconnect).toBe("function");
  });

  it("connect returns a Promise<void> when called with a valid ConnectionConfig", async () => {
    let connected = false;
    const stub: DbConnector = {
      connect: async (_config: ConnectionConfig) => { connected = true; },
      execute: async (_query: string): Promise<NormalizedResult> => ({
        rows: [], rowCount: 0, raw: null,
      }),
      disconnect: async () => { /* no-op */ },
    };
    await stub.connect({ type: "postgres", host: "localhost", database: "test" });
    expect(connected).toBe(true);
  });

  it("execute returns a Promise<NormalizedResult> when called with query only (no params)", async () => {
    const expected: NormalizedResult = {
      rows: [{ id: 1, name: "row1" }],
      rowCount: 1,
      raw: null,
    };
    const stub: DbConnector = {
      connect: async () => { /* no-op */ },
      execute: async (_query: string): Promise<NormalizedResult> => expected,
      disconnect: async () => { /* no-op */ },
    };
    const result = await stub.execute("SELECT 1");
    expect(result).toEqual(expected);
  });

  it("execute accepts an optional QueryParams second argument", async () => {
    const params: QueryParams = { userId: 42, name: "alice" };
    const capturedParams: QueryParams[] = [];
    const stub: DbConnector = {
      connect: async () => { /* no-op */ },
      execute: async (_query: string, p?: QueryParams): Promise<NormalizedResult> => {
        if (p !== undefined) capturedParams.push(p);
        return { rows: [], rowCount: 0, raw: null };
      },
      disconnect: async () => { /* no-op */ },
    };
    await stub.execute("SELECT * FROM users WHERE id = :userId", params);
    expect(capturedParams).toHaveLength(1);
    expect(capturedParams[0]).toEqual({ userId: 42, name: "alice" });
  });

  it("disconnect returns a Promise<void> when called", async () => {
    let disconnected = false;
    const stub: DbConnector = {
      connect: async () => { /* no-op */ },
      execute: async (): Promise<NormalizedResult> => ({ rows: [], rowCount: 0, raw: null }),
      disconnect: async () => { disconnected = true; },
    };
    await stub.disconnect();
    expect(disconnected).toBe(true);
  });

  it("a class implementing DbConnector satisfies the interface (class implements pattern)", () => {
    class StubConnector implements DbConnector {
      async connect(_config: ConnectionConfig): Promise<void> { /* no-op */ }
      async execute(_query: string, _params?: QueryParams): Promise<NormalizedResult> {
        return { rows: [], rowCount: 0, raw: null };
      }
      async disconnect(): Promise<void> { /* no-op */ }
    }

    const c: DbConnector = new StubConnector();
    expect(typeof c.connect).toBe("function");
    expect(typeof c.execute).toBe("function");
    expect(typeof c.disconnect).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// DbEngine alias - exactly the four v1 engines
// ---------------------------------------------------------------------------

describe("DbEngine - alias of DatabaseType, accepts exactly the four v1 engines", () => {
  it("accepts 'postgres' as a DbEngine", () => {
    const engine: DbEngine = "postgres";
    expect(engine).toBe("postgres");
  });

  it("accepts 'mysql' as a DbEngine", () => {
    const engine: DbEngine = "mysql";
    expect(engine).toBe("mysql");
  });

  it("accepts 'mongodb' as a DbEngine", () => {
    const engine: DbEngine = "mongodb";
    expect(engine).toBe("mongodb");
  });

  it("accepts 'neo4j' as a DbEngine", () => {
    const engine: DbEngine = "neo4j";
    expect(engine).toBe("neo4j");
  });

  it("all four engine strings are distinct values", () => {
    const engines: DbEngine[] = ["postgres", "mysql", "mongodb", "neo4j"];
    const unique = new Set<string>(engines);
    expect(unique.size).toBe(4);
  });

  // @ts-expect-error - 'redis' is NOT in the four-engine union; compile error proves
  // the closed union is enforced. Runtime fallthrough is intentional.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _redisCheck: DbEngine = "redis";
});

// ---------------------------------------------------------------------------
// ConnectionConfig alias - structurally identical to DatabaseConfig
// ---------------------------------------------------------------------------

describe("ConnectionConfig - type alias of env DatabaseConfig", () => {
  it("accepts a value assignable to DatabaseConfig (alias identity - forward direction)", () => {
    const dbConfig: DatabaseConfig = {
      type: "postgres",
      host: "db.example.com",
      port: 5432,
      database: "mydb",
      user: "qa_user",
      password: "secret",
    };
    // Alias identity: DatabaseConfig IS assignable to ConnectionConfig
    const connConfig: ConnectionConfig = dbConfig;
    expect(connConfig.type).toBe("postgres");
    expect(connConfig.host).toBe("db.example.com");
    expect(connConfig.port).toBe(5432);
  });

  it("accepts a ConnectionConfig back as a DatabaseConfig (alias identity - reverse direction)", () => {
    const connConfig: ConnectionConfig = {
      type: "mongodb",
      uri: "mongodb://localhost:27017/testdb",
    };
    // Alias identity: ConnectionConfig IS assignable back to DatabaseConfig
    const dbConfig: DatabaseConfig = connConfig;
    expect(dbConfig.type).toBe("mongodb");
    expect(dbConfig.uri).toBe("mongodb://localhost:27017/testdb");
  });

  it("accepts a minimal ConnectionConfig with only the required 'type' field", () => {
    const config: ConnectionConfig = { type: "neo4j" };
    expect(config.type).toBe("neo4j");
  });

  it("accepts engine-specific extra options via the index signature", () => {
    const config: ConnectionConfig = {
      type: "mysql",
      host: "mysql.example.com",
      port: 3306,
      database: "qa_db",
      ssl: true,
      connectTimeout: 5000,
    };
    expect(config["ssl"]).toBe(true);
    expect(config["connectTimeout"]).toBe(5000);
  });

  it("resolves field values are concrete strings (no template references)", () => {
    // Documents the design invariant: by the time a connector receives a
    // ConnectionConfig, all ${secret.*} / ${env.*} references are resolved.
    const config: ConnectionConfig = {
      type: "postgres",
      user: "qa_user_resolved",
      password: "resolved_password_value",
    };
    // The values are plain strings - no template markers remain
    expect(config.user).not.toContain("${");
    expect(config.password).not.toContain("${");
  });
});

// ---------------------------------------------------------------------------
// QueryParams - Record<string, unknown>
// ---------------------------------------------------------------------------

describe("QueryParams - Record<string, unknown>", () => {
  it("accepts a plain object with string keys and mixed unknown values", () => {
    const params: QueryParams = {
      userId: 42,
      name: "alice",
      active: true,
      tags: ["admin", "editor"],
      meta: { region: "us-west" },
    };
    expect(params["userId"]).toBe(42);
    expect(params["name"]).toBe("alice");
    expect(Array.isArray(params["tags"])).toBe(true);
  });

  it("accepts an empty object (zero parameters - distinct from undefined)", () => {
    const params: QueryParams = {};
    expect(Object.keys(params)).toHaveLength(0);
  });

  it("accepts null as a value for a key (SQL NULL binding)", () => {
    const params: QueryParams = { deletedAt: null };
    expect(params["deletedAt"]).toBeNull();
  });

  it("accepts an array value for a key (multi-value bind)", () => {
    const params: QueryParams = { ids: [1, 2, 3] };
    expect(params["ids"]).toEqual([1, 2, 3]);
  });
});
