import { describe, it, expect } from "vitest";

import type { CanonicalEndpoint } from "../../../src/core/canonical-model.js";
import type { NormalizedResult } from "../../../src/core/normalized-result.js";
import type { DbConnector } from "../../../src/db/index.js";
import { ConnectionPoolRegistry } from "../../../src/db/pool/connection-registry.js";
import { runCleanup, runDbVerifications } from "../../../src/runner/execute/db-verify-runner.js";

import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, vi } from "vitest";

import { SecretRegistry } from "../../../src/env/index.js";
import { runOnce } from "../../../src/runner/index.js";

const ROW: NormalizedResult = { rows: [{ id: 1 }], rowCount: 1, raw: {} };

/** Build a fake registry. */
function fakeReg(): ConnectionPoolRegistry {
  const conn: DbConnector = {
    async connect() {},
    async execute(): Promise<NormalizedResult> { return ROW; },
    async disconnect() {},
  };
  return {
    acquire: async () => conn,
    disposeAll: async () => ({ ok: true, results: [] }),
  } as unknown as ConnectionPoolRegistry;
}

const ep = (verify: CanonicalEndpoint["db_verify"], cleanup?: { connection: string; query: string }): CanonicalEndpoint => ({
  id: "e", name: "e", method: "GET", url: "/x",
  request: {}, response: { expected_status: 200, schema: {} },
  ...(verify ? { db_verify: verify } : {}),
  ...(cleanup ? { cleanup } : {}),
});

describe("db-verify-runner: failure branches", () => {
  it("captures ref-extraction failure (malformed template) as a failing step", async () => {
    const r = await runDbVerifications(
      ep([{ connection: "main", query: "SELECT ${secret.unknown}", expect: "exists" }]),
      fakeReg(),
      {},
      undefined,
      undefined,
    );
    expect(r.steps[0]?.pass).toBe(false);
    expect(r.steps[0]?.record.reason ?? "").toMatch(/extraction|resolution|connector/i);
  });

  it("captures ref-resolution failure (missing env ref) as a failing step", async () => {
    const r = await runDbVerifications(
      ep([{ connection: "main", query: "SELECT ${env.nope_missing}", expect: "exists" }]),
      fakeReg(),
      {},
      undefined,
      undefined,
    );
    expect(r.steps[0]?.pass).toBe(false);
    expect(r.steps[0]?.record.reason ?? "").toMatch(/resolution|extraction|connector/i);
  });

  it("runCleanup captures ref-extraction failure", async () => {
    const r = await runCleanup(
      ep([], { connection: "main", query: "DELETE ${secret.unknown}" }),
      fakeReg(),
      {},
      undefined,
      undefined,
    );
    expect(r?.ok).toBe(false);
  });

  it("runCleanup captures ref-resolution failure", async () => {
    const r = await runCleanup(
      ep([], { connection: "main", query: "DELETE FROM x WHERE id = ${env.absent}" }),
      fakeReg(),
      {},
      undefined,
      undefined,
    );
    expect(r?.ok).toBe(false);
  });
});

/** Endpoint that will always fail (expected status 200 but we return 500). */
const FAILING_ENDPOINT_JSON = JSON.stringify({
  id: "fails",
  name: "fails",
  method: "GET",
  url: "/x",
  request: {},
  response: { expected_status: 200, schema: {} },
  markers: ["smoke"],
});

describe("runOnce: aggregates fail status into summary", () => {
  let testsDir: string;
  let reportsDir: string;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(async () => {
    testsDir = join(tmpdir(), `runner-fail-${Date.now()}-${Math.random()}`);
    reportsDir = join(tmpdir(), `runner-fail-reports-${Date.now()}-${Math.random()}`);
    await mkdir(testsDir, { recursive: true });
    await writeFile(join(testsDir, "x.endpoint.json"), FAILING_ENDPOINT_JSON, "utf8");
    originalFetch = globalThis.fetch;
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    await rm(testsDir, { recursive: true, force: true });
    await rm(reportsDir, { recursive: true, force: true });
  });

  it("returns summary.failed > 0 when an endpoint fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      status: 500,
      headers: new Headers(),
      text: async () => "{}",
    }));
    const result = await runOnce({
      testsDir,
      reportsDir,
      env: { name: "test", prod: false, base_url: "https://api.invalid" },
      secrets: new SecretRegistry(),
      filters: { markers: ["smoke"] },
      shard: null,
      workers: 1,
      globalRetryPolicy: { count: 0 },
    });
    expect(result.summary.failed).toBeGreaterThan(0);
  });
});
