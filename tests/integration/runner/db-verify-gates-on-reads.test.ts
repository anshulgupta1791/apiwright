/**
 * Integration regression guard — db_verify failures on read methods MUST
 * gate the verdict.
 *
 * The v1.0 silent-failure bug: the catalog generator only emitted the
 * `db_state_matches_expectation` case for write methods, but the runner's
 * `runDbVerifications()` executed the queries on ALL methods. So a GET
 * endpoint with `db_verify` would execute the query, record `pass: false`
 * in the attempt trace, and exit GREEN because no test case ever consulted
 * `dbVerifyOk`.
 *
 * This integration test goes through the REAL planner + executor with a
 * fake connector that returns a no-match result. Without the fix, the
 * endpoint passes (the four universal smoke kinds all run against a 200
 * response and ignore `dbVerifyOk`). With the fix, the planner emits
 * `db_state_matches_expectation` for the GET, the executor runs it, the
 * fake connector returns zero rows, the verdict is FAIL.
 *
 * Lesson: unit-level catalog tests caught the catalog gap, but only an
 * integration test through the executor proves the gating actually fires.
 */

import { describe, it, expect } from "vitest";

import type { CanonicalEndpoint } from "../../../src/core/canonical-model.js";
import type { NormalizedResult } from "../../../src/core/normalized-result.js";
import { SchemaValidator } from "../../../src/core/index.js";
import type { DbConnector } from "../../../src/db/index.js";
import { ConnectionPoolRegistry } from "../../../src/db/pool/connection-registry.js";
import { SecretRegistry } from "../../../src/env/index.js";
import type { ResolvedEnvironment } from "../../../src/env/index.js";
import { executeEndpoint } from "../../../src/runner/execute/endpoint-executor.js";
import type { HttpClientSeam } from "../../../src/runner/execute/http-client.js";
import { AuthStrategyRegistry } from "../../../src/auth/strategy-registry.js";
import { TestPlanGenerator } from "../../../src/test-catalog/index.js";
import type {
  PlannedTestCase,
  RequestRecord,
  ResponseRecord,
} from "../../../src/runner/types.js";

const ENV: ResolvedEnvironment = {
  name: "test",
  prod: false,
  base_url: "https://api.invalid",
  default_sla_ms: 1000,
};

/** Fake HTTP client that always returns a 200 with a JSON body. */
const fakeHttp: HttpClientSeam = {
  async send(_req: RequestRecord): Promise<ResponseRecord> {
    return {
      status: 200,
      time_ms: 5,
      headers: { "content-type": "application/json" },
      body: { ok: true },
    };
  },
};

/**
 * Build a fake connection-pool registry whose acquire returns a connector
 * yielding the given canned result.
 */
function fakeRegistry(result: NormalizedResult): ConnectionPoolRegistry {
  const fakeConn: DbConnector = {
    async connect() {},
    async execute() { return result; },
    async disconnect() {},
  };
  return {
    acquire: async () => fakeConn,
    disposeAll: async () => ({ ok: true, results: [] }),
  } as unknown as ConnectionPoolRegistry;
}

/** Builds the executor deps with the given fake db result. */
function depsWith(dbResult: NormalizedResult) {
  const secrets = new SecretRegistry();
  return {
    connRegistry: fakeRegistry(dbResult),
    // No auth strategies declared — the endpoint under test has no auth_strategy.
    authRegistry: new AuthStrategyRegistry({}, secrets),
    secrets,
    httpClient: fakeHttp,
    env: ENV,
    schemaValidator: new SchemaValidator(),
  };
}

const ROW: NormalizedResult = { rows: [{ id: 1 }], rowCount: 1, raw: {} };
const EMPTY: NormalizedResult = { rows: [], rowCount: 0, raw: {} };

/** Make a GET endpoint with a single db_verify entry asserting a row exists. */
function getEndpointWithDbVerify(): CanonicalEndpoint {
  return {
    id: "users.get",
    name: "Get user",
    method: "GET",
    url: "/users/1",
    request: {},
    response: { expected_status: 200, schema: { type: "object" } },
    db_verify: [
      {
        connection: "primary",
        query: "SELECT id FROM users WHERE id = 1",
        expect: "exists",
      },
    ],
  };
}

describe("db_verify on read methods gates the verdict (issue fix)", () => {
  it("issue fix: GET with db_verify=exists FAILS when the DB returns zero rows", async () => {
    const endpoint = getEndpointWithDbVerify();
    const plan = new TestPlanGenerator().generate([endpoint]);

    // The fix: planner now emits db_state_matches_expectation for GET.
    const dbCases = plan.cases.filter(
      (c) => c.endpoint_id === "users.get" && c.type === "db_state_matches_expectation",
    );
    expect(dbCases).toHaveLength(1);

    // Execute: db returns EMPTY → the db_state_matches_expectation case must fail.
    const planned: PlannedTestCase[] = plan.cases
      .filter((c) => c.endpoint_id === "users.get")
      .map((c) => ({ case: c, shard: { index: 0, total: 1 } }) as PlannedTestCase);
    const result = await executeEndpoint(endpoint, planned, depsWith(EMPTY));

    expect(result.status).toBe("fail");
    const dbAttempt = result.attempts.find((a) => a.kind === "db_state_matches_expectation");
    expect(dbAttempt).toBeDefined();
    expect(dbAttempt?.verdict).toBe("fail");
    expect(dbAttempt?.failure_reason).toMatch(/db_verify/i);
  });

  it("issue fix: GET with db_verify=exists PASSES when the DB returns matching rows", async () => {
    const endpoint = getEndpointWithDbVerify();
    const plan = new TestPlanGenerator().generate([endpoint]);
    const planned: PlannedTestCase[] = plan.cases
      .filter((c) => c.endpoint_id === "users.get")
      .map((c) => ({ case: c, shard: { index: 0, total: 1 } }) as PlannedTestCase);

    const result = await executeEndpoint(endpoint, planned, depsWith(ROW));
    expect(result.status).toBe("pass");
    const dbAttempt = result.attempts.find((a) => a.kind === "db_state_matches_expectation");
    expect(dbAttempt?.verdict).toBe("pass");
  });

  it("regression guard: POST with db_verify still gates (the originally-working path)", async () => {
    const postEndpoint: CanonicalEndpoint = {
      ...getEndpointWithDbVerify(),
      id: "users.create",
      method: "POST",
    };
    const plan = new TestPlanGenerator().generate([postEndpoint]);
    const planned: PlannedTestCase[] = plan.cases
      .filter((c) => c.endpoint_id === "users.create")
      .map((c) => ({ case: c, shard: { index: 0, total: 1 } }) as PlannedTestCase);

    const passing = await executeEndpoint(postEndpoint, planned, depsWith(ROW));
    expect(passing.status).toBe("pass");

    const failing = await executeEndpoint(postEndpoint, planned, depsWith(EMPTY));
    expect(failing.status).toBe("fail");
  });

  it("issue fix: HEAD with db_verify also gates", async () => {
    const endpoint: CanonicalEndpoint = {
      ...getEndpointWithDbVerify(),
      id: "users.head",
      method: "HEAD",
    };
    const plan = new TestPlanGenerator().generate([endpoint]);
    const planned: PlannedTestCase[] = plan.cases
      .filter((c) => c.endpoint_id === "users.head")
      .map((c) => ({ case: c, shard: { index: 0, total: 1 } }) as PlannedTestCase);

    const result = await executeEndpoint(endpoint, planned, depsWith(EMPTY));
    const dbAttempt = result.attempts.find((a) => a.kind === "db_state_matches_expectation");
    expect(dbAttempt?.verdict).toBe("fail");
    expect(result.status).toBe("fail");
  });
});
