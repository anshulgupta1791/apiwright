/**
 * In-process integration tests for `put_idempotency` two-request flow.
 *
 * WHY THIS FILE EXISTS IN ADDITION TO put-idempotency-two-request.test.ts:
 *   The CLI subprocess tests (put-idempotency-two-request.test.ts) spawn a
 *   separate Node process whose coverage is not collected by vitest. This file
 *   drives the runner in-process to cover the `maybeRunSecondRequest` branches
 *   for put_idempotency, the `putCompare` helper, and the db_state secondary
 *   `runDbVerifications` call.
 *
 * Tests 1–4 use `runOnce` with a scripted fetch stub (same as
 * idempotency-two-request.test.ts). Tests 5–6 use `executeEndpoint` directly
 * with a fake `connRegistry` to cover the db_state branch without a real DB.
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";

import { SecretRegistry } from "../../../src/env/index.js";
import type { ResolvedEnvironment } from "../../../src/env/index.js";
import { runOnce } from "../../../src/runner/index.js";
import { SchemaValidator } from "../../../src/core/index.js";
import { executeEndpoint } from "../../../src/runner/execute/endpoint-executor.js";
import type { ExecutorDeps } from "../../../src/runner/execute/endpoint-executor.js";
import type { PlannedTestCase } from "../../../src/runner/types.js";
import type { CanonicalEndpoint } from "../../../src/core/canonical-model.js";
import type { ConnectionPoolRegistry } from "../../../src/runner/execute/layer-imports.js";

/** Shape of a scripted response for the fetch stub. */
interface ScriptedResponse {
  readonly status: number;
  readonly body: unknown;
}

/**
 * Builds a scripted fetch stub that returns responses in sequence per path.
 * @param script - Per-path response sequences.
 * @returns The stub and a call counter.
 */
function scriptedFetch(
  script: Record<string, readonly ScriptedResponse[]>,
): {
  fetchImpl: typeof globalThis.fetch;
  pathCallCount: () => Record<string, number>;
} {
  const cursors: Record<string, number> = {};
  const calls: Record<string, number> = {};
  const fetchImpl = vi.fn(async (input: unknown): Promise<Response> => {
    const url = typeof input === "string" ? input : (input as URL).toString();
    const parsed = new URL(url);
    const key = parsed.pathname;
    calls[key] = (calls[key] ?? 0) + 1;
    const sequence = script[key];
    if (!sequence) {
      return {
        status: 404,
        headers: new Headers({ "content-type": "application/json" }),
        text: async () => JSON.stringify({ error: "unknown path", path: key }),
      } as unknown as Response;
    }
    const idx = cursors[key] ?? 0;
    cursors[key] = idx + 1;
    const scripted = sequence[idx] ?? sequence[sequence.length - 1];
    return {
      status: scripted!.status,
      headers: new Headers({ "content-type": "application/json" }),
      text: async () =>
        scripted!.body === null ? "" : JSON.stringify(scripted!.body),
    } as unknown as Response;
  });
  return { fetchImpl, pathCallCount: () => ({ ...calls }) };
}

// ---------------------------------------------------------------------------
// Tests 1–4 via runOnce
// ---------------------------------------------------------------------------

describe("put_idempotency two-request — in-process via runOnce", () => {
  let testsDir: string;
  let reportsDir: string;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(async () => {
    testsDir = await mkdir(
      join(tmpdir(), `put-idem-runonce-${Date.now()}-${Math.random()}`),
      { recursive: true },
    ) as unknown as string;
    reportsDir = join(tmpdir(), `put-idem-reports-${Date.now()}-${Math.random()}`);
    originalFetch = globalThis.fetch;
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    await rm(testsDir, { recursive: true, force: true });
    await rm(reportsDir, { recursive: true, force: true });
  });

  async function writeEndpoint(filename: string, payload: object): Promise<void> {
    await writeFile(join(testsDir, filename), JSON.stringify(payload), "utf8");
  }

  const env: ResolvedEnvironment = {
    name: "test", prod: false, base_url: "https://api.invalid",
  };

  it("put_idempotency issues TWO PUTs and PASSES when both bodies are equal", async () => {
    await writeEndpoint("update.endpoint.json", {
      id: "ep.update",
      name: "PUT Update",
      method: "PUT",
      url: "/update",
      request: { body_example: { id: 1, name: "Alice" } },
      response: { expected_status: 200, schema: { type: "object" } },
      markers: ["regression"],
      skip_cases: ["malformed_json_returns_400"],
    });

    const { fetchImpl, pathCallCount } = scriptedFetch({
      "/update": [
        { status: 200, body: { id: 1, name: "Alice" } },
        { status: 200, body: { id: 1, name: "Alice" } },
      ],
    });
    vi.stubGlobal("fetch", fetchImpl);

    const result = await runOnce({
      testsDir, reportsDir, env, secrets: new SecretRegistry(),
      filters: { markers: ["regression"] },
      shard: null, workers: 1, cliRetryOverride: 0,
    });

    expect(pathCallCount()["/update"]).toBeGreaterThanOrEqual(2);
    const ep = result.endpoints.find((e) => e.endpoint_id === "ep.update");
    expect(ep).toBeDefined();
    const putFails = ep?.attempts.filter(
      (a) => a.kind === "put_idempotency" && a.verdict === "fail",
    ) ?? [];
    expect(putFails).toHaveLength(0);
  });

  it("put_idempotency FAILS when the two response bodies diverge", async () => {
    await writeEndpoint("drift.endpoint.json", {
      id: "ep.drift",
      name: "PUT Drift",
      method: "PUT",
      url: "/drift",
      request: { body_example: { id: 1, name: "Alice" } },
      response: { expected_status: 200, schema: { type: "object" } },
      markers: ["regression"],
      skip_cases: ["malformed_json_returns_400"],
    });

    const { fetchImpl, pathCallCount } = scriptedFetch({
      "/drift": [
        { status: 200, body: { id: 1, name: "Alice" } },
        { status: 200, body: { id: 1, name: "Bob" } },
      ],
    });
    vi.stubGlobal("fetch", fetchImpl);

    const result = await runOnce({
      testsDir, reportsDir, env, secrets: new SecretRegistry(),
      filters: { markers: ["regression"] },
      shard: null, workers: 1, cliRetryOverride: 0,
    });

    expect(pathCallCount()["/drift"]).toBeGreaterThanOrEqual(2);
    const ep = result.endpoints.find((e) => e.endpoint_id === "ep.drift");
    const idempotencyFail = ep?.attempts.find(
      (a) => a.verdict === "fail" && (a.failure_reason ?? "").includes("body diverged"),
    );
    expect(idempotencyFail).toBeDefined();
  });

  it("put_idempotency does NOT issue the second PUT when the first returns 500", async () => {
    await writeEndpoint("broken.endpoint.json", {
      id: "ep.broken",
      name: "PUT Broken",
      method: "PUT",
      url: "/broken",
      request: { body_example: { id: 1 } },
      response: { expected_status: 200, schema: {} },
      markers: ["regression"],
      skip_cases: ["malformed_json_returns_400"],
    });

    const { fetchImpl, pathCallCount } = scriptedFetch({
      "/broken": [
        { status: 500, body: { error: "server failure" } },
        { status: 200, body: { id: 1 } },
      ],
    });
    vi.stubGlobal("fetch", fetchImpl);

    const result = await runOnce({
      testsDir, reportsDir, env, secrets: new SecretRegistry(),
      filters: { markers: ["regression"] },
      shard: null, workers: 1, cliRetryOverride: 0,
    });

    expect(pathCallCount()["/broken"]).toBe(1);
    const ep = result.endpoints.find((e) => e.endpoint_id === "ep.broken");
    const putAttempt = ep?.attempts.find((a) => a.kind === "put_idempotency");
    expect(putAttempt?.verdict).toBe("fail");
    expect(putAttempt?.second_request).toBeUndefined();
  });

  it("AttemptResult carries second_request and second_response when put_idempotency runs", async () => {
    await writeEndpoint("fields.endpoint.json", {
      id: "ep.fields",
      name: "PUT Fields",
      method: "PUT",
      url: "/fields",
      request: { body_example: { id: 1 } },
      response: { expected_status: 200, schema: {} },
      markers: ["regression"],
      skip_cases: ["malformed_json_returns_400"],
    });

    const { fetchImpl } = scriptedFetch({
      "/fields": [
        { status: 200, body: { id: 1 } },
        { status: 200, body: { id: 1 } },
      ],
    });
    vi.stubGlobal("fetch", fetchImpl);

    const result = await runOnce({
      testsDir, reportsDir, env, secrets: new SecretRegistry(),
      filters: { markers: ["regression"] },
      shard: null, workers: 1, cliRetryOverride: 0,
    });

    const ep = result.endpoints.find((e) => e.endpoint_id === "ep.fields");
    const putAttempt = ep?.attempts.find((a) => a.kind === "put_idempotency");
    expect(putAttempt?.second_request).toBeDefined();
    expect(putAttempt?.second_response).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Tests 5–6 via executeEndpoint (db_state path — requires fake connRegistry)
// ---------------------------------------------------------------------------

describe("put_idempotency db_state path — via executeEndpoint with fake connRegistry", () => {

  const TEST_ENV: ResolvedEnvironment = {
    name: "test", prod: false, base_url: "https://api.invalid",
  };

  const TEST_ENDPOINT: CanonicalEndpoint = {
    id: "ep.dbstate",
    name: "PUT DB State",
    method: "PUT",
    url: "https://api.invalid/items",
    request: { body_example: { id: 1 } },
    response: { expected_status: 200, schema: {} },
    db_verify: [
      {
        connection: "primary",
        query: "SELECT id FROM items WHERE id = 1",
        expect: "exists",
      },
    ],
  };

  /** Build a scripted in-process HTTP client stub. */
  function buildHttpClient(
    responses: ReadonlyArray<{ status: number; body: unknown }>,
  ): ExecutorDeps["httpClient"] {
    let idx = 0;
    return {
      send: async (_req) => {
        const r = responses[idx] ?? responses[responses.length - 1];
        idx++;
        return {
          status: r!.status,
          headers: { "content-type": "application/json" },
          body: r!.body,
          time_ms: 1,
        };
      },
    };
  }

  /**
   * Build a fake connRegistry that runs the given execute function.
   * @param executeFn - Invoked for every DB query; returns NormalizedResult rows.
   * @returns A minimal ConnectionPoolRegistry-compatible fake.
   */
  function buildFakeConnRegistry(
    executeFn: () => Promise<Record<string, unknown>[]>,
  ): ConnectionPoolRegistry {
    const fakeConnector = {
      connect: async () => { /* no-op */ },
      disconnect: async () => { /* no-op */ },
      execute: async () => {
        const rows = await executeFn();
        return { rows, rowCount: rows.length, raw: rows };
      },
    };
    return {
      has: () => true,
      acquire: async () => fakeConnector,
      disposeAll: async () => ({ ok: true, results: [] }),
    } as unknown as ConnectionPoolRegistry;
  }

  /** Build a put_idempotency PlannedTestCase with db_state compare. */
  const putDbStateCase: PlannedTestCase = {
    endpoint_id: "ep.dbstate",
    case: {
      id: "ep.dbstate.put-idempotency.0",
      endpoint_id: "ep.dbstate",
      type: "put_idempotency",
      marker: "regression",
      title: "PUT idempotency for PUT DB State",
      prod_safe: false,
      params: { kind: "put_idempotency", compare: "db_state" },
    },
  };

  it("put_idempotency db_state mode PASSES when second PUT is 2xx and db verify ok", async () => {
    // Rows always return a match (state unchanged after second PUT)
    const fakeConn = buildFakeConnRegistry(async () => [{ id: "1" }]);
    const fakeAuthRegistry = (
      { acquire: () => ({ apply: async (r: unknown) => r }) }
    ) as unknown as ExecutorDeps["authRegistry"];

    const deps: ExecutorDeps = {
      connRegistry: fakeConn,
      authRegistry: fakeAuthRegistry,
      secrets: new SecretRegistry(),
      httpClient: buildHttpClient([
        { status: 200, body: { id: 1, lastModified: "2026-01-01" } },
        { status: 200, body: { id: 1, lastModified: "2026-01-02" } }, // body drifts — db_state is oracle
      ]),
      env: TEST_ENV,
      schemaValidator: new SchemaValidator(),
    };

    const result = await executeEndpoint(TEST_ENDPOINT, [putDbStateCase], deps);
    const putAttempt = result.attempts.find((a) => a.kind === "put_idempotency");
    // Body drifted but db_state is the oracle → should pass
    expect(putAttempt?.verdict).toBe("pass");
  });

  it("put_idempotency db_state mode FAILS when db verify diverges on second PUT", async () => {
    let queryCallCount = 0;
    const fakeConn = buildFakeConnRegistry(async () => {
      queryCallCount++;
      // Second db_verify call returns no rows (state diverged after second PUT)
      return queryCallCount <= 1 ? [{ id: "1" }] : [];
    });
    const fakeAuthRegistry = (
      { acquire: () => ({ apply: async (r: unknown) => r }) }
    ) as unknown as ExecutorDeps["authRegistry"];

    const deps: ExecutorDeps = {
      connRegistry: fakeConn,
      authRegistry: fakeAuthRegistry,
      secrets: new SecretRegistry(),
      httpClient: buildHttpClient([
        { status: 200, body: { id: 1 } },
        { status: 200, body: { id: 1 } },
      ]),
      env: TEST_ENV,
      schemaValidator: new SchemaValidator(),
    };

    const result = await executeEndpoint(TEST_ENDPOINT, [putDbStateCase], deps);
    const putAttempt = result.attempts.find((a) => a.kind === "put_idempotency");
    expect(putAttempt?.verdict).toBe("fail");
    expect(putAttempt?.failure_reason ?? "").toMatch(/db state diverged/i);
  });
});
