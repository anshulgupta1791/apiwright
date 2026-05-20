/**
 * Unit tests for the src/db public barrel (src/db/index.ts) and the thin
 * registry-from-env factory (src/db/registry-factory.ts).
 *
 * These tests encode the db-public-api-barrel design contract:
 *   (a) Public surface smoke — every documented public symbol is present with
 *       the correct runtime kind; the four INTERNAL connector classes, per-engine
 *       binders, driver seams, and NEUTRAL_PREFIX sentinel are absent.
 *   (b) createRegistry builds a ConnectionPoolRegistry from a synthetic
 *       ResolvedEnvironment WITHOUT connecting or loading any real driver.
 *   (c) createRegistry with no `databases:` block yields a registry whose
 *       acquire() rejects unknown-name correctly.
 *   (d) createRegistry with no injected factory (default seam) does not throw
 *       and does not load any real driver.
 *   (e) Static text-scan: neither src/db/index.ts nor src/db/registry-factory.ts
 *       imports from test-catalog, cli, or any runner path; only the sanctioned
 *       downward cross-module specifiers (../core and ../env) are used.
 *
 * Hermetic — fake ConnectorFactory + fake DbConnector only; NO real driver,
 * NO Docker, NO network.
 *
 * RED PHASE — src/db/index.ts and src/db/registry-factory.ts do not exist yet.
 * All imports from src/db/index.js fail with module-not-found until the
 * implementation-engineer creates those files.
 *
 * Named exports only. ESM `.js` specifiers. No raw JSON.parse (readFileSync
 * used for text-scan fixture — deliberate string manipulation, not JSON).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as nodePath from "node:path";

// ---------------------------------------------------------------------------
// The barrel import — the single documented consumer import surface
// ---------------------------------------------------------------------------
import * as db from "../../../src/db/index.js";
import type {
  DbConnector,
  DbEngine,
  ConnectionConfig,
  QueryParams,
  ConnectorFactory,
  ConnectionDisposeResult,
  DisposeAllOutcome,
  DbVerifyOutcome,
  DbExpectFailureCode,
  NeutralQuery,
  Ref,
  BoundValue,
  ResolutionContext,
  RefRejectionCode,
  RefRejection,
  ExtractResult,
  ResolveResult,
  TemplateNamespace,
  PgBoundQuery,
  MySqlBoundQuery,
  Neo4jBoundQuery,
  MongoBoundQuery,
  EngineBoundQuery,
  BindResult,
  DbErrorCode,
  DbPhase,
  DbConnectorErrorInit,
} from "../../../src/db/index.js";
import type { NormalizedResult } from "../../../src/db/index.js";
import type { ResolvedEnvironment } from "../../../src/env/types.js";

// ---------------------------------------------------------------------------
// Re-import createRegistry as a value for runtime tests
// ---------------------------------------------------------------------------
import { createRegistry } from "../../../src/db/index.js";
import {
  isDbConnectorError,
  DbConnectorError,
  DB_ERROR_CODES,
} from "../../../src/db/index.js";
import type { DatabaseConfig } from "../../../src/env/types.js";

// ---------------------------------------------------------------------------
// Compile-time type assertions (fail the build if the type shapes drift)
// Shape checks: assign typed literals to typed variables.
// ---------------------------------------------------------------------------

// DbConnector structural shape is importable from the barrel
const _typeCheck_connector: DbConnector = {
  connect: async (_config: ConnectionConfig): Promise<void> => { /* no-op */ },
  execute: async (_query: string, _params?: QueryParams): Promise<NormalizedResult> => ({
    rows: [],
    rowCount: 0,
    raw: null,
  }),
  disconnect: async (): Promise<void> => { /* no-op */ },
};
void _typeCheck_connector;

// DbEngine is importable as a type from the barrel
const _typeCheck_engine: DbEngine = "postgres";
void _typeCheck_engine;

// NormalizedResult re-exported type is usable
const _typeCheck_nr: NormalizedResult = { rows: [], rowCount: 0, raw: null };
void _typeCheck_nr;

// DbVerifyOutcome discriminant union is importable
const _typeCheck_outcome_pass: DbVerifyOutcome = { pass: true };
void _typeCheck_outcome_pass;

// DbExpectFailureCode is a string type
const _typeCheck_fc: DbExpectFailureCode = "DB_EXPECT_EXISTS_EMPTY";
void _typeCheck_fc;

// TemplateNamespace is importable
const _typeCheck_ns: TemplateNamespace = "env";
void _typeCheck_ns;

// RefRejectionCode is importable
const _typeCheck_rrc: RefRejectionCode = "UNKNOWN_NAMESPACE";
void _typeCheck_rrc;

// DbErrorCode is importable
const _typeCheck_ec: DbErrorCode = "DB_CONNECTION_FAILED";
void _typeCheck_ec;

// DbPhase is importable
const _typeCheck_phase: DbPhase = "connect";
void _typeCheck_phase;

// DbConnectorErrorInit is usable as a construction interface
const _typeCheck_errInit: DbConnectorErrorInit = {
  code: "DB_CONNECTION_FAILED",
  message: "test",
  engine: "postgres",
  phase: "connect",
};
void _typeCheck_errInit;

// These type imports merely confirm the types are re-exported from the barrel
// (TS compilation fails if they are not). Runtime tests below verify values.
void (null as unknown as ConnectorFactory);
void (null as unknown as ConnectionDisposeResult);
void (null as unknown as DisposeAllOutcome);
void (null as unknown as Ref);
void (null as unknown as BoundValue);
void (null as unknown as ResolutionContext);
void (null as unknown as RefRejection);
void (null as unknown as ExtractResult);
void (null as unknown as ResolveResult);
void (null as unknown as PgBoundQuery);
void (null as unknown as MySqlBoundQuery);
void (null as unknown as Neo4jBoundQuery);
void (null as unknown as MongoBoundQuery);
void (null as unknown as EngineBoundQuery);
void (null as unknown as BindResult);

// ---------------------------------------------------------------------------
// Synthetic ResolvedEnvironment for createRegistry tests
// ---------------------------------------------------------------------------

const FAKE_HOST = "pg.internal.example.com";
const FAKE_USER = "admin_user";
const FAKE_PW = "REGISTRY_FACTORY_SECRET";

const SYNTH_DB_A: DatabaseConfig = {
  type: "postgres",
  host: FAKE_HOST,
  port: 5432,
  database: "orders",
  user: FAKE_USER,
  password: FAKE_PW,
};

const SYNTH_DB_B: DatabaseConfig = {
  type: "mysql",
  host: "mysql.internal.example.com",
  port: 3306,
  database: "analytics",
  user: "mysql_ro",
  password: "MYSQL_FACTORY_SECRET",
};

const SYNTH_ENV_WITH_DATABASES: ResolvedEnvironment = {
  name: "test",
  prod: false,
  base_url: "http://localhost",
  databases: {
    conn_a: SYNTH_DB_A,
    conn_b: SYNTH_DB_B,
  },
};

const SYNTH_ENV_NO_DATABASES: ResolvedEnvironment = {
  name: "empty",
  prod: false,
  base_url: "http://localhost",
};

// ---------------------------------------------------------------------------
// Hand-written fake ConnectorFactory (identical shape to connection-registry tests)
// ---------------------------------------------------------------------------

interface FakeConnectorCounts {
  connectCallCount: number;
  disconnectCallCount: number;
}

function makeFakeConnector(engine: string): DbConnector & FakeConnectorCounts {
  let connectCallCount = 0;
  let disconnectCallCount = 0;

  const c = {
    get connectCallCount() { return connectCallCount; },
    get disconnectCallCount() { return disconnectCallCount; },
    engine,
    async connect(_config: ConnectionConfig): Promise<void> {
      connectCallCount += 1;
    },
    async execute(
      _query: string,
      _params?: QueryParams,
    ): Promise<NormalizedResult> {
      return { rows: [], rowCount: 0, raw: null };
    },
    async disconnect(): Promise<void> {
      disconnectCallCount += 1;
    },
  };
  return c;
}

function makeFakeFactory(
  connectorsByEngine: Record<string, DbConnector & FakeConnectorCounts>,
): ConnectorFactory {
  return {
    create(engine: string): DbConnector {
      const c = connectorsByEngine[engine];
      if (c === undefined) throw new Error(`No fake for engine ${engine}`);
      return c;
    },
  };
}

// ===========================================================================
// 1. Public-surface smoke — values present with correct kind
// ===========================================================================

describe("src/db/index.ts — public value exports are present and have correct kind", () => {
  it("ConnectionPoolRegistry is a function (class)", () => {
    expect(typeof db.ConnectionPoolRegistry).toBe("function");
  });

  it("createDefaultConnectorFactory is a function", () => {
    expect(typeof db.createDefaultConnectorFactory).toBe("function");
  });

  it("createRegistry is a function", () => {
    expect(typeof db.createRegistry).toBe("function");
  });

  it("evaluate is a function", () => {
    expect(typeof db.evaluate).toBe("function");
  });

  it("extractRefs is a function", () => {
    expect(typeof db.extractRefs).toBe("function");
  });

  it("resolveRefs is a function", () => {
    expect(typeof db.resolveRefs).toBe("function");
  });

  it("bindForEngine is a function", () => {
    expect(typeof db.bindForEngine).toBe("function");
  });

  it("DbConnectorError is a function (class)", () => {
    expect(typeof db.DbConnectorError).toBe("function");
  });

  it("isDbConnectorError is a function (type guard)", () => {
    expect(typeof db.isDbConnectorError).toBe("function");
  });

  it("DB_ERROR_CODES is a non-null object", () => {
    expect(typeof db.DB_ERROR_CODES).toBe("object");
    expect(db.DB_ERROR_CODES).not.toBeNull();
  });

  it("DB_ERROR_CODES is frozen", () => {
    expect(Object.isFrozen(db.DB_ERROR_CODES)).toBe(true);
  });

  it("DB_ERROR_CODES has key===value for DB_CONNECTION_FAILED", () => {
    expect(db.DB_ERROR_CODES.DB_CONNECTION_FAILED).toBe("DB_CONNECTION_FAILED");
  });

  it("DB_ERROR_CODES has key===value for DB_DISCONNECT_FAILED", () => {
    expect(db.DB_ERROR_CODES.DB_DISCONNECT_FAILED).toBe("DB_DISCONNECT_FAILED");
  });

  it("DB_ERROR_CODES has key===value for DB_QUERY_FAILED", () => {
    expect(db.DB_ERROR_CODES.DB_QUERY_FAILED).toBe("DB_QUERY_FAILED");
  });

  it("DB_ERROR_CODES has key===value for DB_PARAM_NOT_BINDABLE", () => {
    expect(db.DB_ERROR_CODES.DB_PARAM_NOT_BINDABLE).toBe("DB_PARAM_NOT_BINDABLE");
  });

  it("DB_EXPECT_FAILURE_CODES is a non-null frozen object", () => {
    expect(typeof db.DB_EXPECT_FAILURE_CODES).toBe("object");
    expect(db.DB_EXPECT_FAILURE_CODES).not.toBeNull();
    expect(Object.isFrozen(db.DB_EXPECT_FAILURE_CODES)).toBe(true);
  });
});

// ===========================================================================
// 2. Public-surface smoke — INTERNAL/EXCLUDED symbols are absent
// ===========================================================================

describe("src/db/index.ts — internal/excluded symbols are NOT exported", () => {
  // The barrel namespace is typed, so we must cast to access potentially absent keys.
  const ns = db as Record<string, unknown>;

  it("PostgresConnector is absent from the barrel namespace", () => {
    expect(ns["PostgresConnector"]).toBeUndefined();
  });

  it("MysqlConnector is absent from the barrel namespace", () => {
    expect(ns["MysqlConnector"]).toBeUndefined();
  });

  it("MongodbConnector is absent from the barrel namespace", () => {
    expect(ns["MongodbConnector"]).toBeUndefined();
  });

  it("Neo4jConnector is absent from the barrel namespace", () => {
    expect(ns["Neo4jConnector"]).toBeUndefined();
  });

  it("bindPg is absent from the barrel namespace", () => {
    expect(ns["bindPg"]).toBeUndefined();
  });

  it("bindMySql is absent from the barrel namespace", () => {
    expect(ns["bindMySql"]).toBeUndefined();
  });

  it("bindNeo4j is absent from the barrel namespace", () => {
    expect(ns["bindNeo4j"]).toBeUndefined();
  });

  it("bindMongo is absent from the barrel namespace", () => {
    expect(ns["bindMongo"]).toBeUndefined();
  });

  it("NEUTRAL_PREFIX (sentinel const) is absent from the barrel namespace", () => {
    // The design calls the sentinel NEUTRAL_PREFIX or NEUTRAL_PLACEHOLDER_PREFIX;
    // both must be absent from the public barrel.
    expect(ns["NEUTRAL_PREFIX"]).toBeUndefined();
    expect(ns["NEUTRAL_PLACEHOLDER_PREFIX"]).toBeUndefined();
  });
});

// ===========================================================================
// 3. createRegistry — builds a registry from a synthetic ResolvedEnvironment
// ===========================================================================

describe("createRegistry() — builds a ConnectionPoolRegistry from ResolvedEnvironment", () => {
  it("returns a ConnectionPoolRegistry instance", () => {
    const fakeA = makeFakeConnector("postgres");
    const fakeB = makeFakeConnector("mysql");
    const factory = makeFakeFactory({ postgres: fakeA, mysql: fakeB });
    const registry = createRegistry(SYNTH_ENV_WITH_DATABASES, factory);
    expect(registry).toBeInstanceOf(db.ConnectionPoolRegistry);
  });

  it("does NOT throw during construction (no connect/driver load)", () => {
    const fakeA = makeFakeConnector("postgres");
    const fakeB = makeFakeConnector("mysql");
    const factory = makeFakeFactory({ postgres: fakeA, mysql: fakeB });
    expect(() => createRegistry(SYNTH_ENV_WITH_DATABASES, factory)).not.toThrow();
  });

  it("does NOT call connect() on any fake connector during construction", () => {
    const fakeA = makeFakeConnector("postgres");
    const fakeB = makeFakeConnector("mysql");
    const factory = makeFakeFactory({ postgres: fakeA, mysql: fakeB });
    createRegistry(SYNTH_ENV_WITH_DATABASES, factory);
    expect(fakeA.connectCallCount).toBe(0);
    expect(fakeB.connectCallCount).toBe(0);
  });

  it("acquire(conn_a) via createRegistry returns the fake connector and connects", async () => {
    const fakeA = makeFakeConnector("postgres");
    const fakeB = makeFakeConnector("mysql");
    const factory = makeFakeFactory({ postgres: fakeA, mysql: fakeB });
    const registry = createRegistry(SYNTH_ENV_WITH_DATABASES, factory);

    const acquired = await registry.acquire("conn_a");
    expect(acquired).toBe(fakeA);
    expect(fakeA.connectCallCount).toBe(1);
  });

  it("acquire(conn_a) twice returns the SAME cached instance", async () => {
    const fakeA = makeFakeConnector("postgres");
    const fakeB = makeFakeConnector("mysql");
    const factory = makeFakeFactory({ postgres: fakeA, mysql: fakeB });
    const registry = createRegistry(SYNTH_ENV_WITH_DATABASES, factory);

    const first = await registry.acquire("conn_a");
    const second = await registry.acquire("conn_a");
    expect(second).toBe(first);
    expect(fakeA.connectCallCount).toBe(1);
  });

  it("disposeAll via createRegistry disconnects all acquired connectors", async () => {
    const fakeA = makeFakeConnector("postgres");
    const fakeB = makeFakeConnector("mysql");
    const factory = makeFakeFactory({ postgres: fakeA, mysql: fakeB });
    const registry = createRegistry(SYNTH_ENV_WITH_DATABASES, factory);

    await registry.acquire("conn_a");
    await registry.acquire("conn_b");

    const outcome = await registry.disposeAll();
    expect(outcome.ok).toBe(true);
    expect(fakeA.disconnectCallCount).toBe(1);
    expect(fakeB.disconnectCallCount).toBe(1);
  });
});

// ===========================================================================
// 4. createRegistry — env with no databases: block
// ===========================================================================

describe("createRegistry() — env with no databases: block", () => {
  it("returns a ConnectionPoolRegistry instance without throwing", () => {
    expect(() => createRegistry(SYNTH_ENV_NO_DATABASES)).not.toThrow();
  });

  it("acquire rejects with DB_CONNECTION_FAILED for any name (no databases configured)", async () => {
    const registry = createRegistry(SYNTH_ENV_NO_DATABASES);
    await expect(registry.acquire("any"))
      .rejects.toSatisfy(
        (e: unknown) =>
          isDbConnectorError(e) &&
          (e).code === DB_ERROR_CODES.DB_CONNECTION_FAILED,
      );
  });

  it("disposeAll returns { ok: true, results: [] } (nothing to dispose)", async () => {
    const registry = createRegistry(SYNTH_ENV_NO_DATABASES);
    const outcome = await registry.disposeAll();
    expect(outcome.ok).toBe(true);
    expect(outcome.results).toHaveLength(0);
  });

  it("forwards undefined databases faithfully (no validation added by createRegistry)", () => {
    // Verify the factory is a pure one-line adapter — it adds NO validation.
    // The registry's own behavior for undefined/empty is the APPROVED contract.
    const envUndefined = { ...SYNTH_ENV_NO_DATABASES, databases: undefined };
    expect(() => createRegistry(envUndefined)).not.toThrow();
  });
});

// ===========================================================================
// 5. createRegistry — default factory path (no injected factory)
// ===========================================================================

describe("createRegistry() — default factory path (no injected factory arg)", () => {
  it("constructs without throwing when no factory is provided", () => {
    // createRegistry without factory → registry wires createDefaultConnectorFactory().
    // APPROVED: constructing real connectors loads NO real driver (seams lazy-require
    // only inside open()). So this is hermetic.
    expect(() => createRegistry(SYNTH_ENV_WITH_DATABASES)).not.toThrow();
  });

  it("returns a ConnectionPoolRegistry instance when no factory is provided", () => {
    const registry = createRegistry(SYNTH_ENV_WITH_DATABASES);
    expect(registry).toBeInstanceOf(db.ConnectionPoolRegistry);
  });

  it("acquire unknown name rejects DB_CONNECTION_FAILED with no driver loaded", async () => {
    const registry = createRegistry(SYNTH_ENV_WITH_DATABASES);
    await expect(registry.acquire("no_such_conn"))
      .rejects.toSatisfy(
        (e: unknown) =>
          isDbConnectorError(e) &&
          (e).code === DB_ERROR_CODES.DB_CONNECTION_FAILED,
      );
  });

  it("disposeAll returns { ok: true, results: [] } on a no-factory registry with no acquires",
    async () => {
      const registry = createRegistry(SYNTH_ENV_WITH_DATABASES);
      const outcome = await registry.disposeAll();
      expect(outcome.ok).toBe(true);
      expect(outcome.results).toHaveLength(0);
    });
});

// ===========================================================================
// 6. evaluate() — round-trip via barrel for each expect mode
// ===========================================================================

describe("src/db/index.ts — evaluate() accessible and callable via barrel", () => {
  // The full evaluate() behavior is covered in the expect-evaluator unit test.
  // Here we verify the barrel surface is callable (not just present as a name)
  // and that each mode discriminant round-trips correctly via the public import.

  const RESULT_WITH_ROWS: NormalizedResult = {
    rows: [{ id: 1, status: "active" }],
    rowCount: 1,
    raw: null,
  };
  const RESULT_EMPTY: NormalizedResult = { rows: [], rowCount: 0, raw: null };

  it("evaluate with mode 'exists' + non-empty result returns pass:true", () => {
    const outcome = db.evaluate(RESULT_WITH_ROWS, {
      connection: "c",
      query: "SELECT 1",
      expect: "exists",
    });
    expect(outcome.pass).toBe(true);
  });

  it("evaluate with mode 'not_exists' + empty result returns pass:true", () => {
    const outcome = db.evaluate(RESULT_EMPTY, {
      connection: "c",
      query: "SELECT 1",
      expect: "not_exists",
    });
    expect(outcome.pass).toBe(true);
  });

  it("evaluate with mode 'exists' + empty result returns pass:false", () => {
    const outcome = db.evaluate(RESULT_EMPTY, {
      connection: "c",
      query: "SELECT 1",
      expect: "exists",
    });
    expect(outcome.pass).toBe(false);
  });

  it("evaluate with mode 'match' + matching row returns pass:true", () => {
    const outcome = db.evaluate(RESULT_WITH_ROWS, {
      connection: "c",
      query: "SELECT 1",
      expect: "match",
      fields: { status: "active" },
    });
    expect(outcome.pass).toBe(true);
  });

  it("evaluate with mode 'exact' + matching row returns pass:true", () => {
    const outcome = db.evaluate(RESULT_WITH_ROWS, {
      connection: "c",
      query: "SELECT 1",
      expect: "exact",
      fields: { id: 1, status: "active" },
    });
    expect(outcome.pass).toBe(true);
  });
});

// ===========================================================================
// 7. extractRefs() — accessible via barrel
// ===========================================================================

describe("src/db/index.ts — extractRefs() accessible and callable via barrel", () => {
  it("returns ok:true for a query with no template refs", () => {
    const result = db.extractRefs("SELECT * FROM orders");
    expect(result.ok).toBe(true);
  });

  it("returns ok:true for a Mongo object query with no template refs", () => {
    const result = db.extractRefs({ find: "orders", filter: { status: "active" } });
    expect(result.ok).toBe(true);
  });

  it("returns ok:false for a query with an unknown namespace ref", () => {
    const result = db.extractRefs("SELECT '${unknown.key}'");
    expect(result.ok).toBe(false);
  });
});

// ===========================================================================
// 8. resolveRefs() — accessible via barrel
// ===========================================================================

describe("src/db/index.ts — resolveRefs() accessible and callable via barrel", () => {
  it("resolves a neutral query with no refs (ok:true, empty resolved params)", () => {
    const extractResult = db.extractRefs("SELECT 1");
    if (!extractResult.ok) throw new Error("Expected ok:true from extractRefs");

    const ctx: ResolutionContext = {
      env: { APP_NAME: "apiwright" },
      requestBody: {},
      responseBody: {},
    };

    const resolveResult = db.resolveRefs(extractResult.neutral.refs, ctx);
    expect(resolveResult.ok).toBe(true);
  });
});

// ===========================================================================
// 9. bindForEngine() — accessible via barrel
// ===========================================================================

describe("src/db/index.ts — bindForEngine() accessible and callable via barrel", () => {
  it("returns ok:true for postgres with zero refs (no params)", () => {
    const extractResult = db.extractRefs("SELECT 1");
    if (!extractResult.ok) throw new Error("Expected ok:true");

    const ctx: ResolutionContext = {
      env: {},
      requestBody: {},
      responseBody: {},
    };

    const resolved = db.resolveRefs(extractResult.neutral.refs, ctx);
    if (!resolved.ok) throw new Error("Expected resolveRefs ok:true");

    const bound = db.bindForEngine("postgres", extractResult.neutral, resolved.values);
    expect(bound.ok).toBe(true);
  });
});

// ===========================================================================
// 10. DbConnectorError and isDbConnectorError — accessible via barrel
// ===========================================================================

describe("src/db/index.ts — DbConnectorError and isDbConnectorError via barrel", () => {
  it("can construct a DbConnectorError via the barrel import", () => {
    const err = new db.DbConnectorError({
      code: DB_ERROR_CODES.DB_CONNECTION_FAILED,
      message: "test error",
      engine: "postgres",
      phase: "connect",
    });
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe("DB_CONNECTION_FAILED");
  });

  it("isDbConnectorError returns true for a DbConnectorError", () => {
    const err = new db.DbConnectorError({
      code: DB_ERROR_CODES.DB_QUERY_FAILED,
      message: "query failed",
      engine: "mysql",
      phase: "execute",
    });
    expect(db.isDbConnectorError(err)).toBe(true);
  });

  it("isDbConnectorError returns false for a plain Error", () => {
    expect(db.isDbConnectorError(new Error("plain"))).toBe(false);
  });

  it("isDbConnectorError returns false for null", () => {
    expect(db.isDbConnectorError(null)).toBe(false);
  });

  it("isDbConnectorError returns false for a plain object", () => {
    expect(db.isDbConnectorError({ code: "DB_CONNECTION_FAILED" })).toBe(false);
  });
});

// ===========================================================================
// 11. Static text-scan — deferred-constraint proof (§4 Layer-E pattern)
// ===========================================================================

describe("src/db/index.ts and registry-factory.ts — static no-import proof", () => {
  const repoRoot = nodePath.resolve(fileURLToPath(import.meta.url), "../../../..");

  function readSrc(relPath: string): string {
    return readFileSync(nodePath.join(repoRoot, relPath), "utf-8");
  }

  it("src/db/index.ts does not import from test-catalog", () => {
    const src = readSrc("src/db/index.ts");
    // Any import/export specifier containing test-catalog must be absent
    expect(src).not.toMatch(/['"].*test-catalog/);
    expect(src).not.toMatch(/\.\.\/test-catalog/);
  });

  it("src/db/index.ts does not import from cli", () => {
    const src = readSrc("src/db/index.ts");
    expect(src).not.toMatch(/['"].*\/cli\//);
    expect(src).not.toMatch(/\.\.\/cli/);
  });

  it("src/db/registry-factory.ts does not import from test-catalog", () => {
    const src = readSrc("src/db/registry-factory.ts");
    expect(src).not.toMatch(/['"].*test-catalog/);
    expect(src).not.toMatch(/\.\.\/test-catalog/);
  });

  it("src/db/registry-factory.ts does not import from cli", () => {
    const src = readSrc("src/db/registry-factory.ts");
    expect(src).not.toMatch(/['"].*\/cli\//);
    expect(src).not.toMatch(/\.\.\/cli/);
  });

  it("src/db/index.ts only has cross-module specifiers pointing to core or env", () => {
    const src = readSrc("src/db/index.ts");
    // Extract all import/export specifiers that cross a module boundary
    // (i.e. contain ../ but not ./db/ internally)
    const crossModuleRe = /from\s+['"](\.\.[^'"]+)['"]/g;
    let match: RegExpExecArray | null;
    const crossModuleSpecifiers: string[] = [];
    while ((match = crossModuleRe.exec(src)) !== null) {
      const spec = match[1];
      if (spec !== undefined) {
        crossModuleSpecifiers.push(spec);
      }
    }
    // Every cross-module specifier must resolve to core or env
    for (const spec of crossModuleSpecifiers) {
      const isCore = spec.includes("../core");
      const isEnv = spec.includes("../env");
      expect(isCore || isEnv).toBe(true);
    }
  });

  it("src/db/registry-factory.ts only has cross-module specifiers pointing to core or env", () => {
    const src = readSrc("src/db/registry-factory.ts");
    const crossModuleRe = /from\s+['"](\.\.[^'"]+)['"]/g;
    let match: RegExpExecArray | null;
    const crossModuleSpecifiers: string[] = [];
    while ((match = crossModuleRe.exec(src)) !== null) {
      const spec = match[1];
      if (spec !== undefined) {
        crossModuleSpecifiers.push(spec);
      }
    }
    for (const spec of crossModuleSpecifiers) {
      // registry-factory.ts may import from ../env/types.js and/or
      // ./pool/connection-registry.js (same-module, starts with ./ — not
      // cross-module). Cross-module specifiers must be env only.
      const isEnv = spec.includes("../env");
      expect(isEnv).toBe(true);
    }
  });
});
