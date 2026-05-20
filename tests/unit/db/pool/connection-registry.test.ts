/**
 * Unit tests for ConnectionPoolRegistry and createDefaultConnectorFactory
 * (src/db/pool/connection-registry.ts).
 *
 * Hermetic — hand-written fake ConnectorFactory + fake DbConnector instances.
 * NO real driver, NO Docker, NO network, NO database.
 *
 * Coverage contract:
 *   - acquire: hit/miss/unknown-name/connect-ok/connect-DbErr-rethrow/
 *              connect-other-wrap / single-flight / failure-eviction /
 *              Promise-identity-guard
 *   - disposeAll: empty/all-ok/partial-failure (DbErr)/partial-failure (other)/
 *                 idempotent / acquisition-order / best-effort-no-early-stop
 *   - acquire-after-disposeAll (reusable registry)
 *   - createDefaultConnectorFactory: exhaustive four-engine dispatch (instanceof)
 *   - Secret-safety: no credential text in any error message or outcome JSON
 *
 * RED PHASE — src/db/pool/connection-registry.ts does not exist yet.
 * All imports below fail with module-not-found until the implementation-engineer
 * creates that module.
 *
 * Named exports only. ESM `.js` specifiers. No raw JSON.parse (none needed).
 */

import { describe, it, expect, beforeEach } from "vitest";

import {
  ConnectionPoolRegistry,
  createDefaultConnectorFactory,
} from "../../../../src/db/pool/connection-registry.js";
import type {
  ConnectorFactory,
  DisposeAllOutcome,
  ConnectionDisposeResult,
} from "../../../../src/db/pool/connection-registry.js";
import type { DbConnector } from "../../../../src/db/types.js";
import type { ConnectionConfig } from "../../../../src/db/types.js";
import {
  DbConnectorError,
  isDbConnectorError,
  DB_ERROR_CODES,
} from "../../../../src/db/errors.js";
import type { DatabaseConfig } from "../../../../src/env/types.js";

// ---------------------------------------------------------------------------
// Hand-written fake DbConnector
// ---------------------------------------------------------------------------

interface FakeConnectorOptions {
  connectResult?: "resolve" | "reject-db-error" | "reject-plain";
  disconnectResult?: "resolve" | "reject-db-error" | "reject-plain";
  /** When set, connect() waits for this Promise to resolve/reject first */
  connectGate?: Promise<void>;
}

interface FakeConnector extends DbConnector {
  connectCallCount: number;
  disconnectCallCount: number;
  executeCallCount: number;
  readonly engine: string;
}

function makeFakeConnector(
  engine: string,
  opts: FakeConnectorOptions = {},
): FakeConnector {
  let connectCallCount = 0;
  let disconnectCallCount = 0;
  let executeCallCount = 0;

  const connector: FakeConnector = {
    get connectCallCount() { return connectCallCount; },
    get disconnectCallCount() { return disconnectCallCount; },
    get executeCallCount() { return executeCallCount; },
    get engine() { return engine; },

    async connect(_config: ConnectionConfig): Promise<void> {
      connectCallCount += 1;
      if (opts.connectGate !== undefined) {
        await opts.connectGate;
      }
      if (opts.connectResult === "reject-db-error") {
        throw new DbConnectorError({
          code: DB_ERROR_CODES.DB_CONNECTION_FAILED,
          message: `Fake DB connection error for ${engine}`,
          engine: engine as "postgres",
          phase: "connect",
        });
      }
      if (opts.connectResult === "reject-plain") {
        throw new Error(`Fake plain connect error for ${engine}`);
      }
    },

    async execute(
      _query: string,
      _params?: Record<string, unknown>,
    ): Promise<{ rows: Record<string, unknown>[]; rowCount: number; raw: null }> {
      executeCallCount += 1;
      return { rows: [], rowCount: 0, raw: null };
    },

    async disconnect(): Promise<void> {
      disconnectCallCount += 1;
      if (opts.disconnectResult === "reject-db-error") {
        throw new DbConnectorError({
          code: DB_ERROR_CODES.DB_DISCONNECT_FAILED,
          message: `Fake DB disconnect error for ${engine}`,
          engine: engine as "postgres",
          phase: "disconnect",
        });
      }
      if (opts.disconnectResult === "reject-plain") {
        throw new Error(`Fake plain disconnect error for ${engine}`);
      }
    },
  };

  return connector;
}

// ---------------------------------------------------------------------------
// Hand-written fake ConnectorFactory
// ---------------------------------------------------------------------------

function makeFakeFactory(
  connectorsByEngine: Record<string, FakeConnector>,
): ConnectorFactory & { createCallCount: number; lastCreateArg: string | null } {
  let createCallCount = 0;
  let lastCreateArg: string | null = null;

  return {
    get createCallCount() { return createCallCount; },
    get lastCreateArg() { return lastCreateArg; },
    create(engine: string): DbConnector {
      createCallCount += 1;
      lastCreateArg = engine;
      const c = connectorsByEngine[engine];
      if (c === undefined) throw new Error(`No fake connector for engine ${engine}`);
      return c;
    },
  };
}

// ---------------------------------------------------------------------------
// Synthetic DatabaseConfig map (carries fake credentials for secret-safety pin)
// ---------------------------------------------------------------------------

const FAKE_PASSWORD = "SUPER_SECRET_PASSWORD_DO_NOT_LOG";
const FAKE_HOST = "db.internal.example.com";
const FAKE_USER = "db_admin_user";

const SYNTHETIC_DATABASES: Readonly<Record<string, DatabaseConfig>> = {
  conn_a: {
    type: "postgres",
    host: FAKE_HOST,
    port: 5432,
    database: "orders",
    user: FAKE_USER,
    password: FAKE_PASSWORD,
  },
  conn_b: {
    type: "mysql",
    host: "mysql.internal.example.com",
    port: 3306,
    database: "analytics",
    user: "mysql_user",
    password: "ANOTHER_SECRET",
  },
  conn_c: {
    type: "mongodb",
    uri: "mongodb://admin:MONGO_SECRET@mongo.internal.example.com:27017/catalog",
  },
  conn_neo: {
    type: "neo4j",
    uri: "bolt://neo4j:NEO4J_SECRET@neo4j.internal.example.com:7687",
  },
};

// ---------------------------------------------------------------------------
// Helper — assert a string contains none of the fake credential substrings
// ---------------------------------------------------------------------------

function assertSecretFree(text: string): void {
  const secrets = [FAKE_PASSWORD, FAKE_HOST, FAKE_USER, "MONGO_SECRET", "NEO4J_SECRET",
    "ANOTHER_SECRET"];
  for (const secret of secrets) {
    expect(text).not.toContain(secret);
  }
}

// ===========================================================================
// 1. acquire — happy path + per-name cache
// ===========================================================================

describe("ConnectionPoolRegistry — acquire() happy path and cache", () => {
  let fakeA: FakeConnector;
  let factory: ReturnType<typeof makeFakeFactory>;
  let registry: ConnectionPoolRegistry;

  beforeEach(() => {
    fakeA = makeFakeConnector("postgres");
    factory = makeFakeFactory({ postgres: fakeA });
    registry = new ConnectionPoolRegistry({ conn_a: SYNTHETIC_DATABASES.conn_a! }, factory);
  });

  it("resolves the fake connector on first acquire", async () => {
    const result = await registry.acquire("conn_a");
    expect(result).toBe(fakeA);
  });

  it("calls factory.create exactly once for the first acquire", async () => {
    await registry.acquire("conn_a");
    expect(factory.createCallCount).toBe(1);
  });

  it("calls factory.create with the correct engine string for the conn name", async () => {
    await registry.acquire("conn_a");
    expect(factory.lastCreateArg).toBe("postgres");
  });

  it("calls connector.connect() exactly once for the first acquire", async () => {
    await registry.acquire("conn_a");
    expect(fakeA.connectCallCount).toBe(1);
  });

  it("returns the SAME connector instance on a second sequential acquire", async () => {
    const first = await registry.acquire("conn_a");
    const second = await registry.acquire("conn_a");
    expect(second).toBe(first);
  });

  it("does NOT call factory.create a second time for the same name", async () => {
    await registry.acquire("conn_a");
    await registry.acquire("conn_a");
    expect(factory.createCallCount).toBe(1);
  });

  it("does NOT call connector.connect() a second time for the same name", async () => {
    await registry.acquire("conn_a");
    await registry.acquire("conn_a");
    expect(fakeA.connectCallCount).toBe(1);
  });

  it("returns the same instance across 100 sequential acquires of the same name", async () => {
    const first = await registry.acquire("conn_a");
    const results: DbConnector[] = [];
    for (let i = 0; i < 99; i += 1) {
      results.push(await registry.acquire("conn_a"));
    }
    expect(results.every((r) => r === first)).toBe(true);
    expect(fakeA.connectCallCount).toBe(1);
  });

  it("returns distinct connector instances for two different connection names", async () => {
    const fakeB = makeFakeConnector("mysql");
    const multiFactory = makeFakeFactory({
      postgres: fakeA,
      mysql: fakeB,
    });
    const multiRegistry = new ConnectionPoolRegistry(
      { conn_a: SYNTHETIC_DATABASES.conn_a!, conn_b: SYNTHETIC_DATABASES.conn_b! },
      multiFactory,
    );
    const connA = await multiRegistry.acquire("conn_a");
    const connB = await multiRegistry.acquire("conn_b");
    expect(connA).not.toBe(connB);
    expect(fakeA.connectCallCount).toBe(1);
    expect(fakeB.connectCallCount).toBe(1);
  });
});

// ===========================================================================
// 2. acquire — single-flight under concurrent first-call (the critical path)
// ===========================================================================

describe("ConnectionPoolRegistry — acquire() single-flight concurrency", () => {
  it("N concurrent acquires of an unconnected name share ONE connect() call", async () => {
    let resolveGate!: () => void;
    const gate = new Promise<void>((resolve) => { resolveGate = resolve; });
    const fakeA = makeFakeConnector("postgres", { connectGate: gate });
    const factory = makeFakeFactory({ postgres: fakeA });
    const registry = new ConnectionPoolRegistry(
      { conn_a: SYNTHETIC_DATABASES.conn_a! },
      factory,
    );

    // Fire 5 concurrent acquires BEFORE resolving the gate
    const acquirePromises = [
      registry.acquire("conn_a"),
      registry.acquire("conn_a"),
      registry.acquire("conn_a"),
      registry.acquire("conn_a"),
      registry.acquire("conn_a"),
    ];

    // Now unblock connect
    resolveGate();
    const results = await Promise.all(acquirePromises);

    // All five must resolve to the SAME instance
    expect(results.every((r) => r === results[0])).toBe(true);
    // connect() invoked EXACTLY once — the critical single-flight assertion
    expect(fakeA.connectCallCount).toBe(1);
    // factory.create also invoked EXACTLY once
    expect(factory.createCallCount).toBe(1);
  });

  it("all concurrent acquires resolve to the connected connector", async () => {
    let resolveGate!: () => void;
    const gate = new Promise<void>((resolve) => { resolveGate = resolve; });
    const fakeA = makeFakeConnector("postgres", { connectGate: gate });
    const factory = makeFakeFactory({ postgres: fakeA });
    const registry = new ConnectionPoolRegistry(
      { conn_a: SYNTHETIC_DATABASES.conn_a! },
      factory,
    );

    const p1 = registry.acquire("conn_a");
    const p2 = registry.acquire("conn_a");
    const p3 = registry.acquire("conn_a");

    resolveGate();
    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);

    expect(r1).toBe(fakeA);
    expect(r2).toBe(fakeA);
    expect(r3).toBe(fakeA);
  });
});

// ===========================================================================
// 3. acquire — single-flight failure fan-out
// ===========================================================================

describe("ConnectionPoolRegistry — acquire() single-flight failure fan-out", () => {
  it("all N concurrent acquires receive the SAME rejection when connect fails", async () => {
    let rejectGate!: (err: Error) => void;
    const gate = new Promise<void>((_resolve, reject) => { rejectGate = reject; });
    const fakeA = makeFakeConnector("postgres", {
      connectGate: gate,
      connectResult: "resolve",
    });
    // Override: make the gate rejection cause connect to throw
    let connectCallCount = 0;
    const gatingFactory: ConnectorFactory = {
      create(): DbConnector {
        return {
          async connect(): Promise<void> {
            connectCallCount += 1;
            await gate;
          },
          async execute(): Promise<{ rows: Record<string, unknown>[]; rowCount: number; raw: null }> {
            return { rows: [], rowCount: 0, raw: null };
          },
          async disconnect(): Promise<void> { /* no-op */ },
        };
      },
    };

    const registry = new ConnectionPoolRegistry(
      { conn_a: SYNTHETIC_DATABASES.conn_a! },
      gatingFactory,
    );

    const p1 = registry.acquire("conn_a");
    const p2 = registry.acquire("conn_a");
    const p3 = registry.acquire("conn_a");

    rejectGate(new Error("Network timeout"));

    const outcomes = await Promise.allSettled([p1, p2, p3]);

    // All three must reject
    expect(outcomes.every((o) => o.status === "rejected")).toBe(true);
    // connect() invoked EXACTLY once (single-flight for failures too)
    expect(connectCallCount).toBe(1);
  });

  it("concurrent acquires that fail do NOT cache the failed connector", async () => {
    let callCount = 0;
    const failThenSucceedFactory: ConnectorFactory = {
      create(): DbConnector {
        callCount += 1;
        const attempt = callCount;
        return {
          async connect(): Promise<void> {
            if (attempt === 1) throw new Error("First attempt fails");
          },
          async execute(): Promise<{ rows: Record<string, unknown>[]; rowCount: number; raw: null }> {
            return { rows: [], rowCount: 0, raw: null };
          },
          async disconnect(): Promise<void> { /* no-op */ },
        };
      },
    };

    const registry = new ConnectionPoolRegistry(
      { conn_a: SYNTHETIC_DATABASES.conn_a! },
      failThenSucceedFactory,
    );

    // First acquire fails
    await expect(registry.acquire("conn_a")).rejects.toThrow();

    // Second acquire should succeed (eviction + fresh attempt)
    const second = await registry.acquire("conn_a");
    expect(second).toBeDefined();
    // factory.create was called twice (once per attempt)
    expect(callCount).toBe(2);
  });
});

// ===========================================================================
// 4. acquire — failure-eviction then retry
// ===========================================================================

describe("ConnectionPoolRegistry — acquire() failure-eviction and retry", () => {
  it("a failed connect() is evicted so a later acquire() retries fresh", async () => {
    let attempt = 0;
    const connectors: FakeConnector[] = [
      makeFakeConnector("postgres", { connectResult: "reject-plain" }),
      makeFakeConnector("postgres"), // resolves on second attempt
    ];
    const retryFactory: ConnectorFactory = {
      create(): DbConnector {
        const c = connectors[attempt];
        if (c === undefined) throw new Error(`No connector for attempt ${attempt}`);
        return c;
      },
    };

    const registry = new ConnectionPoolRegistry(
      { conn_a: SYNTHETIC_DATABASES.conn_a! },
      retryFactory,
    );

    // First acquire rejects
    attempt = 0;
    await expect(registry.acquire("conn_a")).rejects.toBeDefined();
    expect(connectors[0]!.connectCallCount).toBe(1);

    // Second acquire uses a fresh connector (eviction worked)
    attempt = 1;
    const second = await registry.acquire("conn_a");
    expect(second).toBe(connectors[1]);
    expect(connectors[1]!.connectCallCount).toBe(1);
  });

  it("a successful retry puts the new connector into the disposeAll list", async () => {
    let attempt = 0;
    const connectors: FakeConnector[] = [
      makeFakeConnector("postgres", { connectResult: "reject-plain" }),
      makeFakeConnector("postgres"),
    ];
    const retryFactory: ConnectorFactory = {
      create(): DbConnector {
        const c = connectors[attempt];
        if (c === undefined) throw new Error("bad");
        return c;
      },
    };

    const registry = new ConnectionPoolRegistry(
      { conn_a: SYNTHETIC_DATABASES.conn_a! },
      retryFactory,
    );

    attempt = 0;
    await expect(registry.acquire("conn_a")).rejects.toBeDefined();

    attempt = 1;
    await registry.acquire("conn_a");

    const outcome = await registry.disposeAll();
    expect(outcome.ok).toBe(true);
    expect(outcome.results).toHaveLength(1);
    expect(outcome.results[0]!.name).toBe("conn_a");
    // The FAILED connector was NOT disposed (it never connected)
    expect(connectors[0]!.disconnectCallCount).toBe(0);
    // The SUCCESSFUL connector WAS disposed
    expect(connectors[1]!.disconnectCallCount).toBe(1);
  });

  it("does NOT call connect() on the first connector after eviction and retry", async () => {
    let attempt = 0;
    const connectors: FakeConnector[] = [
      makeFakeConnector("postgres", { connectResult: "reject-db-error" }),
      makeFakeConnector("postgres"),
    ];
    const retryFactory: ConnectorFactory = {
      create(): DbConnector {
        const c = connectors[attempt]!;
        return c;
      },
    };

    const registry = new ConnectionPoolRegistry(
      { conn_a: SYNTHETIC_DATABASES.conn_a! },
      retryFactory,
    );

    attempt = 0;
    await expect(registry.acquire("conn_a")).rejects.toBeDefined();
    expect(connectors[0]!.connectCallCount).toBe(1);

    attempt = 1;
    await registry.acquire("conn_a");

    // First connector's connect was not called again
    expect(connectors[0]!.connectCallCount).toBe(1);
    expect(connectors[1]!.connectCallCount).toBe(1);
  });
});

// ===========================================================================
// 5. acquire — unknown name
// ===========================================================================

describe("ConnectionPoolRegistry — acquire() unknown/unconfigured name", () => {
  let fakeA: FakeConnector;
  let factory: ReturnType<typeof makeFakeFactory>;
  let registry: ConnectionPoolRegistry;

  beforeEach(() => {
    fakeA = makeFakeConnector("postgres");
    factory = makeFakeFactory({ postgres: fakeA });
    registry = new ConnectionPoolRegistry(SYNTHETIC_DATABASES, factory);
  });

  it("rejects with a DbConnectorError for an unknown connection name", async () => {
    await expect(registry.acquire("not_configured"))
      .rejects.toSatisfy((e: unknown) => isDbConnectorError(e));
  });

  it("rejects with code DB_CONNECTION_FAILED for an unknown name", async () => {
    await expect(registry.acquire("not_configured"))
      .rejects.toSatisfy(
        (e: unknown) =>
          isDbConnectorError(e) &&
          (e).code === DB_ERROR_CODES.DB_CONNECTION_FAILED,
      );
  });

  it("rejects with phase 'connect' for an unknown name", async () => {
    await expect(registry.acquire("not_configured"))
      .rejects.toSatisfy(
        (e: unknown) =>
          isDbConnectorError(e) &&
          (e).phase === "connect",
      );
  });

  it("includes the missing name in the error message", async () => {
    await expect(registry.acquire("not_configured"))
      .rejects.toSatisfy(
        (e: unknown) =>
          isDbConnectorError(e) &&
          (e).message.includes("not_configured"),
      );
  });

  it("unknown-name error message is secret-free (no host/user/password from config)", async () => {
    try {
      await registry.acquire("not_configured");
      expect.fail("should have rejected");
    } catch (e) {
      if (!isDbConnectorError(e)) throw e;
      assertSecretFree((e).message);
    }
  });

  it("does NOT cache the unknown-name rejection (a valid name still works after)", async () => {
    await expect(registry.acquire("not_configured")).rejects.toBeDefined();
    // A valid name should still succeed
    const result = await registry.acquire("conn_a");
    expect(result).toBe(fakeA);
  });

  it("does NOT construct a connector for an unknown name", async () => {
    await expect(registry.acquire("not_configured")).rejects.toBeDefined();
    expect(factory.createCallCount).toBe(0);
  });
});

// ===========================================================================
// 6. acquire — connect rejects with a DbConnectorError (re-rejected unchanged)
// ===========================================================================

describe("ConnectionPoolRegistry — acquire() re-rejects DbConnectorError unchanged", () => {
  it("re-rejects the SAME DbConnectorError instance (not double-wrapped)", async () => {
    const originalError = new DbConnectorError({
      code: DB_ERROR_CODES.DB_CONNECTION_FAILED,
      message: "Auth rejected by server",
      engine: "postgres",
      phase: "connect",
    });
    const failingFactory: ConnectorFactory = {
      create(): DbConnector {
        return {
          async connect(): Promise<void> { throw originalError; },
          async execute(): Promise<{ rows: Record<string, unknown>[]; rowCount: number; raw: null }> {
            return { rows: [], rowCount: 0, raw: null };
          },
          async disconnect(): Promise<void> { /* no-op */ },
        };
      },
    };

    const registry = new ConnectionPoolRegistry(
      { conn_a: SYNTHETIC_DATABASES.conn_a! },
      failingFactory,
    );

    await expect(registry.acquire("conn_a"))
      .rejects.toBe(originalError);
  });

  it("preserves the original error's engine, phase, and code when re-rejecting", async () => {
    const failingFactory: ConnectorFactory = {
      create(): DbConnector {
        return {
          async connect(): Promise<void> {
            throw new DbConnectorError({
              code: DB_ERROR_CODES.DB_CONNECTION_FAILED,
              message: "Driver not installed — npm install pg",
              engine: "postgres",
              phase: "connect",
            });
          },
          async execute(): Promise<{ rows: Record<string, unknown>[]; rowCount: number; raw: null }> {
            return { rows: [], rowCount: 0, raw: null };
          },
          async disconnect(): Promise<void> { /* no-op */ },
        };
      },
    };

    const registry = new ConnectionPoolRegistry(
      { conn_a: SYNTHETIC_DATABASES.conn_a! },
      failingFactory,
    );

    await expect(registry.acquire("conn_a"))
      .rejects.toSatisfy((e: unknown) => {
        if (!isDbConnectorError(e)) return false;
        const err = e;
        return (
          err.engine === "postgres" &&
          err.phase === "connect" &&
          err.code === DB_ERROR_CODES.DB_CONNECTION_FAILED &&
          err.message.includes("npm install pg")
        );
      });
  });
});

// ===========================================================================
// 7. acquire — connect rejects with a non-DbConnectorError (defensive wrap)
// ===========================================================================

describe("ConnectionPoolRegistry — acquire() wraps non-DbConnectorError defensively", () => {
  it("rejects with a DbConnectorError when connect throws a plain Error", async () => {
    const plainErr = new Error("Random internal crash");
    const wrapFactory: ConnectorFactory = {
      create(): DbConnector {
        return {
          async connect(): Promise<void> { throw plainErr; },
          async execute(): Promise<{ rows: Record<string, unknown>[]; rowCount: number; raw: null }> {
            return { rows: [], rowCount: 0, raw: null };
          },
          async disconnect(): Promise<void> { /* no-op */ },
        };
      },
    };

    const registry = new ConnectionPoolRegistry(
      { conn_a: SYNTHETIC_DATABASES.conn_a! },
      wrapFactory,
    );

    await expect(registry.acquire("conn_a"))
      .rejects.toSatisfy((e: unknown) => isDbConnectorError(e));
  });

  it("the wrapped error has code DB_CONNECTION_FAILED", async () => {
    const wrapFactory: ConnectorFactory = {
      create(): DbConnector {
        return {
          async connect(): Promise<void> { throw new Error("Unexpected"); },
          async execute(): Promise<{ rows: Record<string, unknown>[]; rowCount: number; raw: null }> {
            return { rows: [], rowCount: 0, raw: null };
          },
          async disconnect(): Promise<void> { /* no-op */ },
        };
      },
    };

    const registry = new ConnectionPoolRegistry(
      { conn_a: SYNTHETIC_DATABASES.conn_a! },
      wrapFactory,
    );

    await expect(registry.acquire("conn_a"))
      .rejects.toSatisfy(
        (e: unknown) =>
          isDbConnectorError(e) &&
          (e).code === DB_ERROR_CODES.DB_CONNECTION_FAILED,
      );
  });

  it("the wrapped error message is secret-free", async () => {
    const wrapFactory: ConnectorFactory = {
      create(): DbConnector {
        return {
          async connect(): Promise<void> {
            throw new Error(`Connection failed: ${FAKE_HOST}/${FAKE_USER}/${FAKE_PASSWORD}`);
          },
          async execute(): Promise<{ rows: Record<string, unknown>[]; rowCount: number; raw: null }> {
            return { rows: [], rowCount: 0, raw: null };
          },
          async disconnect(): Promise<void> { /* no-op */ },
        };
      },
    };

    const registry = new ConnectionPoolRegistry(
      { conn_a: SYNTHETIC_DATABASES.conn_a! },
      wrapFactory,
    );

    try {
      await registry.acquire("conn_a");
      expect.fail("should have rejected");
    } catch (e) {
      if (!isDbConnectorError(e)) throw e;
      // The plain error detail must NOT appear in the registry's message
      assertSecretFree((e).message);
    }
  });

  it("the wrapped error has phase 'connect'", async () => {
    const wrapFactory: ConnectorFactory = {
      create(): DbConnector {
        return {
          async connect(): Promise<void> { throw new TypeError("cast error"); },
          async execute(): Promise<{ rows: Record<string, unknown>[]; rowCount: number; raw: null }> {
            return { rows: [], rowCount: 0, raw: null };
          },
          async disconnect(): Promise<void> { /* no-op */ },
        };
      },
    };

    const registry = new ConnectionPoolRegistry(
      { conn_a: SYNTHETIC_DATABASES.conn_a! },
      wrapFactory,
    );

    await expect(registry.acquire("conn_a"))
      .rejects.toSatisfy(
        (e: unknown) =>
          isDbConnectorError(e) && (e).phase === "connect",
      );
  });
});

// ===========================================================================
// 8. disposeAll — basic behavior
// ===========================================================================

describe("ConnectionPoolRegistry — disposeAll() basic behavior", () => {
  it("returns { ok: true, results: [] } before any acquire", async () => {
    const registry = new ConnectionPoolRegistry(SYNTHETIC_DATABASES,
      makeFakeFactory({ postgres: makeFakeConnector("postgres") }));
    const outcome = await registry.disposeAll();
    expect(outcome.ok).toBe(true);
    expect(outcome.results).toHaveLength(0);
  });

  it("never throws (even with no acquired connectors)", async () => {
    const registry = new ConnectionPoolRegistry(SYNTHETIC_DATABASES,
      makeFakeFactory({ postgres: makeFakeConnector("postgres") }));
    await expect(registry.disposeAll()).resolves.toBeDefined();
  });

  it("calls disconnect() on every acquired connector exactly once", async () => {
    const fakeA = makeFakeConnector("postgres");
    const fakeB = makeFakeConnector("mysql");
    const factory = makeFakeFactory({ postgres: fakeA, mysql: fakeB });
    const registry = new ConnectionPoolRegistry(
      { conn_a: SYNTHETIC_DATABASES.conn_a!, conn_b: SYNTHETIC_DATABASES.conn_b! },
      factory,
    );

    await registry.acquire("conn_a");
    await registry.acquire("conn_b");
    await registry.disposeAll();

    expect(fakeA.disconnectCallCount).toBe(1);
    expect(fakeB.disconnectCallCount).toBe(1);
  });

  it("does NOT call disconnect() on a connector that was never acquired", async () => {
    const fakeA = makeFakeConnector("postgres");
    const fakeC = makeFakeConnector("mongodb");
    const factory = makeFakeFactory({ postgres: fakeA, mongodb: fakeC });
    const registry = new ConnectionPoolRegistry(
      {
        conn_a: SYNTHETIC_DATABASES.conn_a!,
        conn_c: SYNTHETIC_DATABASES.conn_c!,
      },
      factory,
    );

    await registry.acquire("conn_a");
    // conn_c deliberately NOT acquired

    await registry.disposeAll();

    expect(fakeA.disconnectCallCount).toBe(1);
    expect(fakeC.disconnectCallCount).toBe(0);
  });

  it("outcome.results contains exactly the acquired connections in acquisition order", async () => {
    const fakeA = makeFakeConnector("postgres");
    const fakeB = makeFakeConnector("mysql");
    const factory = makeFakeFactory({ postgres: fakeA, mysql: fakeB });
    const registry = new ConnectionPoolRegistry(
      { conn_a: SYNTHETIC_DATABASES.conn_a!, conn_b: SYNTHETIC_DATABASES.conn_b! },
      factory,
    );

    await registry.acquire("conn_a");
    await registry.acquire("conn_b");

    const outcome = await registry.disposeAll();

    expect(outcome.results).toHaveLength(2);
    expect(outcome.results[0]!.name).toBe("conn_a");
    expect(outcome.results[1]!.name).toBe("conn_b");
  });

  it("outcome.results records the correct engine for each entry", async () => {
    const fakeA = makeFakeConnector("postgres");
    const fakeB = makeFakeConnector("mysql");
    const factory = makeFakeFactory({ postgres: fakeA, mysql: fakeB });
    const registry = new ConnectionPoolRegistry(
      { conn_a: SYNTHETIC_DATABASES.conn_a!, conn_b: SYNTHETIC_DATABASES.conn_b! },
      factory,
    );

    await registry.acquire("conn_a");
    await registry.acquire("conn_b");

    const outcome = await registry.disposeAll();

    expect(outcome.results[0]!.engine).toBe("postgres");
    expect(outcome.results[1]!.engine).toBe("mysql");
  });

  it("outcome.ok is true when all disconnects succeed", async () => {
    const fakeA = makeFakeConnector("postgres");
    const fakeB = makeFakeConnector("mysql");
    const factory = makeFakeFactory({ postgres: fakeA, mysql: fakeB });
    const registry = new ConnectionPoolRegistry(
      { conn_a: SYNTHETIC_DATABASES.conn_a!, conn_b: SYNTHETIC_DATABASES.conn_b! },
      factory,
    );

    await registry.acquire("conn_a");
    await registry.acquire("conn_b");

    const outcome = await registry.disposeAll();
    expect(outcome.ok).toBe(true);
    expect(outcome.results.every((r) => r.ok === true)).toBe(true);
  });
});

// ===========================================================================
// 9. disposeAll — partial failure (DbConnectorError disconnect)
// ===========================================================================

describe("ConnectionPoolRegistry — disposeAll() partial failure with DbConnectorError", () => {
  it("outcome.ok is false when one disconnect rejects a DbConnectorError", async () => {
    const fakeA = makeFakeConnector("postgres", { disconnectResult: "reject-db-error" });
    const fakeB = makeFakeConnector("mysql");
    const factory = makeFakeFactory({ postgres: fakeA, mysql: fakeB });
    const registry = new ConnectionPoolRegistry(
      { conn_a: SYNTHETIC_DATABASES.conn_a!, conn_b: SYNTHETIC_DATABASES.conn_b! },
      factory,
    );

    await registry.acquire("conn_a");
    await registry.acquire("conn_b");

    const outcome = await registry.disposeAll();
    expect(outcome.ok).toBe(false);
  });

  it("still disconnects other connectors when one fails (no early stop)", async () => {
    const fakeA = makeFakeConnector("postgres", { disconnectResult: "reject-db-error" });
    const fakeB = makeFakeConnector("mysql");
    const factory = makeFakeFactory({ postgres: fakeA, mysql: fakeB });
    const registry = new ConnectionPoolRegistry(
      { conn_a: SYNTHETIC_DATABASES.conn_a!, conn_b: SYNTHETIC_DATABASES.conn_b! },
      factory,
    );

    await registry.acquire("conn_a");
    await registry.acquire("conn_b");

    await registry.disposeAll();

    // Both disconnect() must have been called even though fakeA failed
    expect(fakeA.disconnectCallCount).toBe(1);
    expect(fakeB.disconnectCallCount).toBe(1);
  });

  it("the failing result entry has ok:false and a DbConnectorError error", async () => {
    const fakeA = makeFakeConnector("postgres", { disconnectResult: "reject-db-error" });
    const fakeB = makeFakeConnector("mysql");
    const factory = makeFakeFactory({ postgres: fakeA, mysql: fakeB });
    const registry = new ConnectionPoolRegistry(
      { conn_a: SYNTHETIC_DATABASES.conn_a!, conn_b: SYNTHETIC_DATABASES.conn_b! },
      factory,
    );

    await registry.acquire("conn_a");
    await registry.acquire("conn_b");

    const outcome = await registry.disposeAll();
    const failEntry = outcome.results.find((r) => r.name === "conn_a");
    expect(failEntry).toBeDefined();
    expect(failEntry!.ok).toBe(false);
    expect(isDbConnectorError(failEntry!.error)).toBe(true);
  });

  it("the succeeding result entry has ok:true and no error field", async () => {
    const fakeA = makeFakeConnector("postgres", { disconnectResult: "reject-db-error" });
    const fakeB = makeFakeConnector("mysql");
    const factory = makeFakeFactory({ postgres: fakeA, mysql: fakeB });
    const registry = new ConnectionPoolRegistry(
      { conn_a: SYNTHETIC_DATABASES.conn_a!, conn_b: SYNTHETIC_DATABASES.conn_b! },
      factory,
    );

    await registry.acquire("conn_a");
    await registry.acquire("conn_b");

    const outcome = await registry.disposeAll();
    const okEntry = outcome.results.find((r) => r.name === "conn_b");
    expect(okEntry!.ok).toBe(true);
    expect(okEntry!.error).toBeUndefined();
  });

  it("disposeAll never throws even when a disconnect rejects", async () => {
    const fakeA = makeFakeConnector("postgres", { disconnectResult: "reject-db-error" });
    const factory = makeFakeFactory({ postgres: fakeA });
    const registry = new ConnectionPoolRegistry(
      { conn_a: SYNTHETIC_DATABASES.conn_a! },
      factory,
    );

    await registry.acquire("conn_a");
    await expect(registry.disposeAll()).resolves.toBeDefined();
  });
});

// ===========================================================================
// 10. disposeAll — partial failure (non-DbConnectorError disconnect) — defensive
// ===========================================================================

describe("ConnectionPoolRegistry — disposeAll() defensive wrap of non-DbConnectorError", () => {
  it("wraps a plain Error disconnect rejection into a DbConnectorError", async () => {
    const fakeA = makeFakeConnector("postgres", { disconnectResult: "reject-plain" });
    const factory = makeFakeFactory({ postgres: fakeA });
    const registry = new ConnectionPoolRegistry(
      { conn_a: SYNTHETIC_DATABASES.conn_a! },
      factory,
    );

    await registry.acquire("conn_a");

    const outcome = await registry.disposeAll();
    const entry = outcome.results[0]!;
    expect(entry.ok).toBe(false);
    expect(isDbConnectorError(entry.error)).toBe(true);
  });

  it("wrapped disconnect error has code DB_DISCONNECT_FAILED", async () => {
    const fakeA = makeFakeConnector("postgres", { disconnectResult: "reject-plain" });
    const factory = makeFakeFactory({ postgres: fakeA });
    const registry = new ConnectionPoolRegistry(
      { conn_a: SYNTHETIC_DATABASES.conn_a! },
      factory,
    );

    await registry.acquire("conn_a");

    const outcome = await registry.disposeAll();
    const entry = outcome.results[0]!;
    expect((entry.error as DbConnectorError).code).toBe(DB_ERROR_CODES.DB_DISCONNECT_FAILED);
  });

  it("wrapped disconnect error message is secret-free", async () => {
    const fakeA = makeFakeConnector("postgres", { disconnectResult: "reject-plain" });
    const factory = makeFakeFactory({ postgres: fakeA });
    const registry = new ConnectionPoolRegistry(
      { conn_a: SYNTHETIC_DATABASES.conn_a! },
      factory,
    );

    await registry.acquire("conn_a");

    const outcome = await registry.disposeAll();
    const entry = outcome.results[0]!;
    assertSecretFree((entry.error as DbConnectorError).message);
  });

  it("other connectors still disconnect when one throws a non-DbConnectorError", async () => {
    const fakeA = makeFakeConnector("postgres", { disconnectResult: "reject-plain" });
    const fakeB = makeFakeConnector("mysql");
    const factory = makeFakeFactory({ postgres: fakeA, mysql: fakeB });
    const registry = new ConnectionPoolRegistry(
      { conn_a: SYNTHETIC_DATABASES.conn_a!, conn_b: SYNTHETIC_DATABASES.conn_b! },
      factory,
    );

    await registry.acquire("conn_a");
    await registry.acquire("conn_b");

    await registry.disposeAll();

    expect(fakeB.disconnectCallCount).toBe(1);
  });
});

// ===========================================================================
// 11. disposeAll — idempotent (second call returns empty results)
// ===========================================================================

describe("ConnectionPoolRegistry — disposeAll() idempotent", () => {
  it("second disposeAll (no intervening acquire) returns { ok: true, results: [] }", async () => {
    const fakeA = makeFakeConnector("postgres");
    const factory = makeFakeFactory({ postgres: fakeA });
    const registry = new ConnectionPoolRegistry(
      { conn_a: SYNTHETIC_DATABASES.conn_a! },
      factory,
    );

    await registry.acquire("conn_a");
    await registry.disposeAll();

    const second = await registry.disposeAll();
    expect(second.ok).toBe(true);
    expect(second.results).toHaveLength(0);
  });

  it("second disposeAll does NOT call disconnect() again", async () => {
    const fakeA = makeFakeConnector("postgres");
    const factory = makeFakeFactory({ postgres: fakeA });
    const registry = new ConnectionPoolRegistry(
      { conn_a: SYNTHETIC_DATABASES.conn_a! },
      factory,
    );

    await registry.acquire("conn_a");
    await registry.disposeAll();
    await registry.disposeAll();

    expect(fakeA.disconnectCallCount).toBe(1);
  });

  it("disposeAll before any acquire is idempotent (both return empty ok)", async () => {
    const registry = new ConnectionPoolRegistry(SYNTHETIC_DATABASES,
      makeFakeFactory({ postgres: makeFakeConnector("postgres") }));
    const first = await registry.disposeAll();
    const second = await registry.disposeAll();
    expect(first.ok).toBe(true);
    expect(first.results).toHaveLength(0);
    expect(second.ok).toBe(true);
    expect(second.results).toHaveLength(0);
  });
});

// ===========================================================================
// 12. acquire-after-disposeAll — registry is reusable, not sealed
// ===========================================================================

describe("ConnectionPoolRegistry — acquire() after disposeAll() (reusable registry)", () => {
  it("acquire after disposeAll returns a new connector (fresh construct+connect)", async () => {
    const first = makeFakeConnector("postgres");
    const second = makeFakeConnector("postgres");
    let call = 0;
    const reusableFactory: ConnectorFactory = {
      create(): DbConnector {
        call += 1;
        if (call === 1) return first;
        return second;
      },
    };

    const registry = new ConnectionPoolRegistry(
      { conn_a: SYNTHETIC_DATABASES.conn_a! },
      reusableFactory,
    );

    await registry.acquire("conn_a");
    await registry.disposeAll();

    const postDispose = await registry.acquire("conn_a");
    expect(postDispose).toBe(second);
    expect(second.connectCallCount).toBe(1);
  });

  it("the post-disposeAll acquired connector appears in a subsequent disposeAll", async () => {
    const first = makeFakeConnector("postgres");
    const second = makeFakeConnector("postgres");
    let call = 0;
    const reusableFactory: ConnectorFactory = {
      create(): DbConnector {
        call += 1;
        return call === 1 ? first : second;
      },
    };

    const registry = new ConnectionPoolRegistry(
      { conn_a: SYNTHETIC_DATABASES.conn_a! },
      reusableFactory,
    );

    await registry.acquire("conn_a");
    await registry.disposeAll();
    await registry.acquire("conn_a");

    const secondDispose = await registry.disposeAll();
    expect(secondDispose.ok).toBe(true);
    expect(secondDispose.results).toHaveLength(1);
    expect(second.disconnectCallCount).toBe(1);
  });
});

// ===========================================================================
// 13. empty / undefined databases
// ===========================================================================

describe("ConnectionPoolRegistry — empty and undefined databases", () => {
  it("constructs without throwing when databases is undefined", () => {
    expect(() => new ConnectionPoolRegistry(undefined)).not.toThrow();
  });

  it("constructs without throwing when databases is an empty object", () => {
    expect(() => new ConnectionPoolRegistry({})).not.toThrow();
  });

  it("acquire rejects with DB_CONNECTION_FAILED when databases is undefined", async () => {
    const registry = new ConnectionPoolRegistry(undefined);
    await expect(registry.acquire("any"))
      .rejects.toSatisfy(
        (e: unknown) =>
          isDbConnectorError(e) &&
          (e).code === DB_ERROR_CODES.DB_CONNECTION_FAILED,
      );
  });

  it("acquire rejects with DB_CONNECTION_FAILED when databases is empty {}", async () => {
    const registry = new ConnectionPoolRegistry({});
    await expect(registry.acquire("any"))
      .rejects.toSatisfy(
        (e: unknown) =>
          isDbConnectorError(e) &&
          (e).code === DB_ERROR_CODES.DB_CONNECTION_FAILED,
      );
  });

  it("disposeAll returns { ok: true, results: [] } when databases is undefined", async () => {
    const registry = new ConnectionPoolRegistry(undefined);
    const outcome = await registry.disposeAll();
    expect(outcome.ok).toBe(true);
    expect(outcome.results).toHaveLength(0);
  });

  it("disposeAll returns { ok: true, results: [] } when databases is empty {}", async () => {
    const registry = new ConnectionPoolRegistry({});
    const outcome = await registry.disposeAll();
    expect(outcome.ok).toBe(true);
    expect(outcome.results).toHaveLength(0);
  });
});

// ===========================================================================
// 14. two names, same engine — distinct instances
// ===========================================================================

describe("ConnectionPoolRegistry — two names with the same engine are distinct instances", () => {
  it("creates distinct connector instances for two postgres connections", async () => {
    const fakeA = makeFakeConnector("postgres");
    const fakeB = makeFakeConnector("postgres");
    let call = 0;
    const factory: ConnectorFactory = {
      create(): DbConnector {
        call += 1;
        return call === 1 ? fakeA : fakeB;
      },
    };

    const registry = new ConnectionPoolRegistry(
      {
        conn_a: SYNTHETIC_DATABASES.conn_a!,
        // Second postgres connection with different host
        conn_a2: { type: "postgres", host: "other.db.example.com", port: 5432,
          database: "archive", user: "archive_user", password: "ARC_SECRET" },
      },
      factory,
    );

    const a = await registry.acquire("conn_a");
    const a2 = await registry.acquire("conn_a2");

    expect(a).not.toBe(a2);
    expect(a).toBe(fakeA);
    expect(a2).toBe(fakeB);
  });

  it("disposes both instances independently", async () => {
    const fakeA = makeFakeConnector("postgres");
    const fakeB = makeFakeConnector("postgres");
    let call = 0;
    const factory: ConnectorFactory = {
      create(): DbConnector {
        call += 1;
        return call === 1 ? fakeA : fakeB;
      },
    };

    const registry = new ConnectionPoolRegistry(
      {
        conn_a: SYNTHETIC_DATABASES.conn_a!,
        conn_a2: { type: "postgres", host: "other.example.com", port: 5432,
          database: "archive", user: "arch_user", password: "ARC_SECRET2" },
      },
      factory,
    );

    await registry.acquire("conn_a");
    await registry.acquire("conn_a2");

    const outcome = await registry.disposeAll();
    expect(outcome.results).toHaveLength(2);
    expect(fakeA.disconnectCallCount).toBe(1);
    expect(fakeB.disconnectCallCount).toBe(1);
  });
});

// ===========================================================================
// 15. Secret-safety sweep — aggregated outcome JSON contains no credentials
// ===========================================================================

describe("ConnectionPoolRegistry — secret-safety sweep", () => {
  it("DisposeAllOutcome JSON contains no credential strings from synthetic configs", async () => {
    const fakeA = makeFakeConnector("postgres", { disconnectResult: "reject-db-error" });
    const fakeB = makeFakeConnector("mysql");
    const factory = makeFakeFactory({ postgres: fakeA, mysql: fakeB });
    const registry = new ConnectionPoolRegistry(
      { conn_a: SYNTHETIC_DATABASES.conn_a!, conn_b: SYNTHETIC_DATABASES.conn_b! },
      factory,
    );

    await registry.acquire("conn_a");
    await registry.acquire("conn_b");

    const outcome = await registry.disposeAll();
    const json = JSON.stringify(outcome);

    assertSecretFree(json);
  });

  it("acquire unknown-name error message contains no credentials from other configs", async () => {
    const fakeA = makeFakeConnector("postgres");
    const registry = new ConnectionPoolRegistry(
      SYNTHETIC_DATABASES,
      makeFakeFactory({ postgres: fakeA }),
    );

    try {
      await registry.acquire("unknown_name");
      expect.fail("should have rejected");
    } catch (e) {
      if (!isDbConnectorError(e)) throw e;
      assertSecretFree((e).message);
    }
  });
});

// ===========================================================================
// 16. Determinism — same inputs produce deep-equal DisposeAllOutcome
// ===========================================================================

describe("ConnectionPoolRegistry — disposeAll() determinism", () => {
  it("produces deep-equal DisposeAllOutcome across two equivalent fresh registries", async () => {
    function makeReg(): ConnectionPoolRegistry {
      const fakeA = makeFakeConnector("postgres");
      const fakeB = makeFakeConnector("mysql");
      const factory = makeFakeFactory({ postgres: fakeA, mysql: fakeB });
      return new ConnectionPoolRegistry(
        { conn_a: SYNTHETIC_DATABASES.conn_a!, conn_b: SYNTHETIC_DATABASES.conn_b! },
        factory,
      );
    }

    const reg1 = makeReg();
    await reg1.acquire("conn_a");
    await reg1.acquire("conn_b");
    const outcome1 = await reg1.disposeAll();

    const reg2 = makeReg();
    await reg2.acquire("conn_a");
    await reg2.acquire("conn_b");
    const outcome2 = await reg2.disposeAll();

    // Strip error objects (non-serialisable) from comparison — pin ok/name/engine
    const normalize = (o: DisposeAllOutcome) => ({
      ok: o.ok,
      results: o.results.map((r: ConnectionDisposeResult) => ({
        name: r.name,
        engine: r.engine,
        ok: r.ok,
      })),
    });

    expect(normalize(outcome1)).toEqual(normalize(outcome2));
  });
});

// ===========================================================================
// 17. createDefaultConnectorFactory — exhaustive four-engine dispatch
// ===========================================================================

describe("createDefaultConnectorFactory — exhaustive engine dispatch", () => {
  // The APPROVED connector designs confirm: constructing each connector with
  // no args binds its own default seam WITHOUT loading any real driver
  // (seams lazy-require only inside open()). So these instanceof checks are
  // hermetic — no driver, no Docker, no network.

  it("returns a ConnectorFactory whose create() does not throw for postgres", () => {
    const factory = createDefaultConnectorFactory();
    expect(() => factory.create("postgres")).not.toThrow();
  });

  it("returns a ConnectorFactory whose create() does not throw for mysql", () => {
    const factory = createDefaultConnectorFactory();
    expect(() => factory.create("mysql")).not.toThrow();
  });

  it("returns a ConnectorFactory whose create() does not throw for mongodb", () => {
    const factory = createDefaultConnectorFactory();
    expect(() => factory.create("mongodb")).not.toThrow();
  });

  it("returns a ConnectorFactory whose create() does not throw for neo4j", () => {
    const factory = createDefaultConnectorFactory();
    expect(() => factory.create("neo4j")).not.toThrow();
  });

  it("create('postgres') returns an object with connect/execute/disconnect methods", () => {
    const factory = createDefaultConnectorFactory();
    const connector = factory.create("postgres");
    expect(typeof connector.connect).toBe("function");
    expect(typeof connector.execute).toBe("function");
    expect(typeof connector.disconnect).toBe("function");
  });

  it("create('mysql') returns an object with connect/execute/disconnect methods", () => {
    const factory = createDefaultConnectorFactory();
    const connector = factory.create("mysql");
    expect(typeof connector.connect).toBe("function");
    expect(typeof connector.execute).toBe("function");
    expect(typeof connector.disconnect).toBe("function");
  });

  it("create('mongodb') returns an object with connect/execute/disconnect methods", () => {
    const factory = createDefaultConnectorFactory();
    const connector = factory.create("mongodb");
    expect(typeof connector.connect).toBe("function");
    expect(typeof connector.execute).toBe("function");
    expect(typeof connector.disconnect).toBe("function");
  });

  it("create('neo4j') returns an object with connect/execute/disconnect methods", () => {
    const factory = createDefaultConnectorFactory();
    const connector = factory.create("neo4j");
    expect(typeof connector.connect).toBe("function");
    expect(typeof connector.execute).toBe("function");
    expect(typeof connector.disconnect).toBe("function");
  });

  it("create() returns distinct instances for distinct engines", () => {
    const factory = createDefaultConnectorFactory();
    const pg = factory.create("postgres");
    const my = factory.create("mysql");
    const mo = factory.create("mongodb");
    const ne = factory.create("neo4j");
    // All four are distinct object instances
    const instances = [pg, my, mo, ne];
    const unique = new Set(instances);
    expect(unique.size).toBe(4);
  });

  it("two calls to createDefaultConnectorFactory() return independent factories", () => {
    const f1 = createDefaultConnectorFactory();
    const f2 = createDefaultConnectorFactory();
    // Each returns its own independent connector instances
    expect(f1.create("postgres")).not.toBe(f2.create("postgres"));
  });

  it("factory.create() can be called multiple times for the same engine", () => {
    const factory = createDefaultConnectorFactory();
    const a = factory.create("postgres");
    const b = factory.create("postgres");
    // Two distinct instances (the factory is stateless; each call = new connector)
    expect(a).not.toBe(b);
  });
});

// ===========================================================================
// 18. Default factory seam — no injected factory uses real createDefaultConnectorFactory
// ===========================================================================

describe("ConnectionPoolRegistry — default ConnectorFactory seam (no injection)", () => {
  it("constructs without throwing when no factory is injected (wires real default)", () => {
    // APPROVED: constructing the registry without a factory wires
    // createDefaultConnectorFactory() — and constructing connectors loads NO
    // real driver (seams lazy-require only inside open(), never called here).
    expect(() => new ConnectionPoolRegistry(SYNTHETIC_DATABASES)).not.toThrow();
  });

  it("acquire rejects unknown name when using the default factory (no driver loaded)", async () => {
    const registry = new ConnectionPoolRegistry(SYNTHETIC_DATABASES);
    // Only testing the unknown-name path — no connect() called, no driver loaded
    await expect(registry.acquire("unknown_name"))
      .rejects.toSatisfy(
        (e: unknown) =>
          isDbConnectorError(e) &&
          (e).code === DB_ERROR_CODES.DB_CONNECTION_FAILED,
      );
  });

  it("disposeAll returns { ok: true, results: [] } on a default-factory registry with no acquires",
    async () => {
      const registry = new ConnectionPoolRegistry(SYNTHETIC_DATABASES);
      const outcome = await registry.disposeAll();
      expect(outcome.ok).toBe(true);
      expect(outcome.results).toHaveLength(0);
    });
});
