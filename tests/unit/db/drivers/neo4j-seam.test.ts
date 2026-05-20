import { describe, it, expect } from "vitest";

import {
  createDefaultNeo4jSeam,
} from "../../../../src/db/drivers/neo4j-seam.js";
import type {
  Neo4jDriverSeam,
  Neo4jHandle,
  Neo4jQueryResult,
} from "../../../../src/db/drivers/neo4j-seam.js";
import type { DriverRequireFn } from "../../../../src/db/drivers/seam-shared.js";
import { DbConnectorError, DB_ERROR_CODES } from "../../../../src/db/errors.js";
import type { ConnectionConfig } from "../../../../src/db/types.js";

/**
 * Unit tests for createDefaultNeo4jSeam (src/db/drivers/neo4j-seam.ts).
 *
 * Covers: seam interface structural contract (named params, run method, seam
 * owns session); lazy-require; happy-path (open, run with named params, close);
 * missing-driver error (DbConnectorError, correct attrs, secret-free); default-arg.
 *
 * RED PHASE: src/db/drivers/neo4j-seam.ts does not exist yet.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_CONFIG: ConnectionConfig = {
  type: "neo4j",
  uri: "bolt://localhost:7687",
  user: "neo4j",
  password: "test_password",
};

function makeFakeNeo4jModule(): {
  driver: (uri: string, auth: unknown) => {
    session: () => {
      run: (cypher: string, params: Record<string, unknown>) => Promise<{
        records: { toObject: () => Record<string, unknown> }[];
        summary: { counters: { updates: () => Record<string, number> } };
      }>;
      close: () => Promise<void>;
    };
    close: () => Promise<void>;
  };
  auth: { basic: (user: string, pass: string) => unknown };
} {
  return {
    driver: (_uri: string, _auth: unknown) => ({
      session: () => ({
        async run(
          _cypher: string,
          _params: Record<string, unknown>,
        ): Promise<{
          records: { toObject: () => Record<string, unknown> }[];
          summary: { counters: { updates: () => Record<string, number> } };
        }> {
          return {
            records: [
              { toObject: () => ({ id: 1, name: "node_a" }) },
            ],
            summary: {
              counters: {
                updates: () => ({ nodesCreated: 0, nodesDeleted: 0 }),
              },
            },
          };
        },
        async close(): Promise<void> {},
      }),
      async close(): Promise<void> {},
    }),
    auth: {
      basic: (_user: string, _pass: string) => ({ scheme: "basic" }),
    },
  };
}

// ---------------------------------------------------------------------------
// Seam interface structural contract
// ---------------------------------------------------------------------------

describe("Neo4jDriverSeam — interface structural contract", () => {
  it("a hand-written fake literal satisfies the Neo4jDriverSeam interface", () => {
    const fake: Neo4jDriverSeam = {
      async open(_config: ConnectionConfig): Promise<Neo4jHandle> {
        return { __neo4jHandle: true };
      },
      async run(
        _handle: Neo4jHandle,
        _cypher: string,
        _params: Readonly<Record<string, unknown>>,
      ): Promise<Neo4jQueryResult> {
        return { records: [], countersTotal: 0 };
      },
      async close(_handle: Neo4jHandle): Promise<void> {},
    };
    expect(typeof fake.open).toBe("function");
    expect(typeof fake.run).toBe("function");
    expect(typeof fake.close).toBe("function");
  });

  it("Neo4jQueryResult has records array and countersTotal number", () => {
    const result: Neo4jQueryResult = {
      records: [{ nodeId: 1, label: "Person" }],
      countersTotal: 0,
    };
    expect(Array.isArray(result.records)).toBe(true);
    expect(typeof result.countersTotal).toBe("number");
  });

  it("Neo4jQueryResult countersTotal is > 0 for write queries", () => {
    const result: Neo4jQueryResult = { records: [], countersTotal: 5 };
    expect(result.countersTotal).toBe(5);
  });

  it("run() accepts named params as Readonly<Record<string, unknown>>", async () => {
    const capturedParams: Record<string, unknown>[] = [];
    const fake: Neo4jDriverSeam = {
      async open(_config: ConnectionConfig): Promise<Neo4jHandle> {
        return { __neo4jHandle: true };
      },
      async run(
        _handle: Neo4jHandle,
        _cypher: string,
        params: Readonly<Record<string, unknown>>,
      ): Promise<Neo4jQueryResult> {
        capturedParams.push({ ...params });
        return { records: [], countersTotal: 0 };
      },
      async close(_handle: Neo4jHandle): Promise<void> {},
    };
    const handle = await fake.open(BASE_CONFIG);
    await fake.run(handle, "MATCH (n) WHERE n.id = $id RETURN n", { id: 42 });
    expect(capturedParams[0]).toEqual({ id: 42 });
  });
});

// ---------------------------------------------------------------------------
// Lazy-require
// ---------------------------------------------------------------------------

describe("createDefaultNeo4jSeam — lazy-require", () => {
  it("does NOT call requireFn on construction", () => {
    let called = false;
    const fn: DriverRequireFn = () => {
      called = true;
      return makeFakeNeo4jModule();
    };
    createDefaultNeo4jSeam(fn);
    expect(called).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe("createDefaultNeo4jSeam — happy path (fake requireFn)", () => {
  it("open() calls requireFn with 'neo4j-driver'", async () => {
    const calledWith: string[] = [];
    const fn: DriverRequireFn = (id) => {
      calledWith.push(id);
      return makeFakeNeo4jModule();
    };
    const seam = createDefaultNeo4jSeam(fn);
    await seam.open(BASE_CONFIG);
    expect(calledWith[0]).toBe("neo4j-driver");
  });

  it("open() resolves with a handle that has the __neo4jHandle brand", async () => {
    const seam = createDefaultNeo4jSeam(() => makeFakeNeo4jModule());
    const handle = await seam.open(BASE_CONFIG);
    expect(handle.__neo4jHandle).toBe(true);
  });

  it("run() resolves with a Neo4jQueryResult containing records and countersTotal", async () => {
    const seam = createDefaultNeo4jSeam(() => makeFakeNeo4jModule());
    const handle = await seam.open(BASE_CONFIG);
    const result = await seam.run(
      handle,
      "MATCH (n:Person) WHERE n.id = $id RETURN n",
      { id: 1 },
    );
    expect(Array.isArray(result.records)).toBe(true);
    expect(typeof result.countersTotal).toBe("number");
  });

  it("run() forwards named params (not positional) to the underlying session", async () => {
    const capturedParams: Record<string, unknown>[] = [];
    const fn: DriverRequireFn = () => ({
      driver: (_uri: string, _auth: unknown) => ({
        session: () => ({
          async run(
            _cypher: string,
            params: Record<string, unknown>,
          ): Promise<{
            records: { toObject: () => Record<string, unknown> }[];
            summary: { counters: { updates: () => Record<string, number> } };
          }> {
            capturedParams.push({ ...params });
            return {
              records: [],
              summary: { counters: { updates: () => ({}) } },
            };
          },
          async close(): Promise<void> {},
        }),
        async close(): Promise<void> {},
      }),
      auth: { basic: (_u: string, _p: string) => ({}) },
    });
    const seam = createDefaultNeo4jSeam(fn);
    const handle = await seam.open(BASE_CONFIG);
    await seam.run(handle, "MATCH (n) WHERE n.id = $userId RETURN n", { userId: 99 });
    expect(capturedParams[0]).toEqual({ userId: 99 });
  });

  it("the seam owns session lifecycle (open session per run, close session after)", async () => {
    // The design specifies the seam opens+closes a session inside run().
    // We verify the session's close() was called by tracking it.
    let sessionClosed = false;
    const fn: DriverRequireFn = () => ({
      driver: (_uri: string, _auth: unknown) => ({
        session: () => ({
          async run(): Promise<{
            records: { toObject: () => Record<string, unknown> }[];
            summary: { counters: { updates: () => Record<string, number> } };
          }> {
            return {
              records: [],
              summary: { counters: { updates: () => ({}) } },
            };
          },
          async close(): Promise<void> {
            sessionClosed = true;
          },
        }),
        async close(): Promise<void> {},
      }),
      auth: { basic: (_u: string, _p: string) => ({}) },
    });
    const seam = createDefaultNeo4jSeam(fn);
    const handle = await seam.open(BASE_CONFIG);
    await seam.run(handle, "MATCH (n) RETURN n", {});
    expect(sessionClosed).toBe(true);
  });

  it("close() resolves without throwing", async () => {
    const seam = createDefaultNeo4jSeam(() => makeFakeNeo4jModule());
    const handle = await seam.open(BASE_CONFIG);
    await expect(seam.close(handle)).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Missing-driver error path
// ---------------------------------------------------------------------------

describe("createDefaultNeo4jSeam — missing-driver error path", () => {
  const missingFn: DriverRequireFn = () => {
    throw new Error("Cannot find module 'neo4j-driver'");
  };

  it("open() rejects with a DbConnectorError", async () => {
    const seam = createDefaultNeo4jSeam(missingFn);
    await expect(seam.open(BASE_CONFIG)).rejects.toBeInstanceOf(DbConnectorError);
  });

  it("the error has code DB_CONNECTION_FAILED", async () => {
    const seam = createDefaultNeo4jSeam(missingFn);
    try {
      await seam.open(BASE_CONFIG);
      expect.fail("should have rejected");
    } catch (e) {
      expect((e as DbConnectorError).code).toBe(DB_ERROR_CODES.DB_CONNECTION_FAILED);
    }
  });

  it("the error has engine 'neo4j'", async () => {
    const seam = createDefaultNeo4jSeam(missingFn);
    try {
      await seam.open(BASE_CONFIG);
      expect.fail("should have rejected");
    } catch (e) {
      expect((e as DbConnectorError).engine).toBe("neo4j");
    }
  });

  it("the error message contains 'npm install' install hint", async () => {
    const seam = createDefaultNeo4jSeam(missingFn);
    try {
      await seam.open(BASE_CONFIG);
      expect.fail("should have rejected");
    } catch (e) {
      expect((e as DbConnectorError).message).toContain("npm install");
    }
  });

  it("the error message is secret-free (no bolt URI or password)", async () => {
    const cfg: ConnectionConfig = {
      type: "neo4j",
      uri: "bolt://admin:bolt_secret_pass@host:7687",
      password: "bolt_secret_pass",
    };
    const seam = createDefaultNeo4jSeam(missingFn);
    try {
      await seam.open(cfg);
      expect.fail("should have rejected");
    } catch (e) {
      expect((e as DbConnectorError).message).not.toContain("bolt_secret_pass");
    }
  });
});

// ---------------------------------------------------------------------------
// Default-arg construction
// ---------------------------------------------------------------------------

describe("createDefaultNeo4jSeam — default-arg construction (no requireFn)", () => {
  it("constructs without throwing when called with no arguments", () => {
    expect(() => createDefaultNeo4jSeam()).not.toThrow();
  });

  it("returns an object with the correct seam method shapes", () => {
    const seam = createDefaultNeo4jSeam();
    expect(typeof seam.open).toBe("function");
    expect(typeof seam.run).toBe("function");
    expect(typeof seam.close).toBe("function");
  });
});
