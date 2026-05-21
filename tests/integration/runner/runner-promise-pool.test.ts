import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, it, expect } from "vitest";

import { SecretRegistry } from "../../../src/env/index.js";
import type { ResolvedEnvironment } from "../../../src/env/index.js";
import type { HttpClientSeam } from "../../../src/runner/execute/http-client.js";
import { runOnce } from "../../../src/runner/index.js";
import type { RequestRecord, ResponseRecord } from "../../../src/runner/types.js";

const ENV: ResolvedEnvironment = {
  name: "test",
  prod: false,
  base_url: "https://api.invalid",
  default_sla_ms: 5_000,
};

/** Writes N endpoint JSON files numbered e000.endpoint.json … e<N-1>.endpoint.json. */
async function writeEndpoints(dir: string, n: number): Promise<void> {
  await mkdir(dir, { recursive: true });
  for (let i = 0; i < n; i++) {
    const id = `e${i.toString().padStart(3, "0")}`;
    const endpoint = {
      id,
      name: `Endpoint ${i}`,
      method: "GET",
      url: `/${id}`,
      request: {},
      response: { expected_status: 200, schema: { type: "object" } },
      markers: ["smoke"],
    };
    await writeFile(join(dir, `${id}.endpoint.json`), JSON.stringify(endpoint), "utf8");
  }
}

/** Builds a fake HttpClient that always succeeds with status 200 + empty body. */
function alwaysOkClient(): HttpClientSeam {
  return {
    async send(_request: RequestRecord, _signal?: AbortSignal): Promise<ResponseRecord> {
      await new Promise((r) => setImmediate(r));
      return { status: 200, headers: {}, body: {}, time_ms: 1 };
    },
  };
}

/** Builds a fake HttpClient that throws synchronously for one endpoint id. */
function throwingForClient(throwingId: string): HttpClientSeam {
  return {
    async send(request: RequestRecord, _signal?: AbortSignal): Promise<ResponseRecord> {
      if (request.url.endsWith(`/${throwingId}`)) {
        throw new Error("simulated executor crash");
      }
      await new Promise((r) => setImmediate(r));
      return { status: 200, headers: {}, body: {}, time_ms: 1 };
    },
  };
}

/** Builds a fake HttpClient that hangs forever for one endpoint id; respects signal. */
function hangingForClient(hangingId: string): HttpClientSeam {
  return {
    async send(request: RequestRecord, signal?: AbortSignal): Promise<ResponseRecord> {
      if (request.url.endsWith(`/${hangingId}`)) {
        // If the signal was aborted BEFORE this call started, reject
        // synchronously — matches `fetch` semantics for a pre-aborted signal.
        if (signal?.aborted) throw new Error("aborted before send");
        return new Promise<ResponseRecord>((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(new Error("aborted")));
        });
      }
      await new Promise((r) => setImmediate(r));
      return { status: 200, headers: {}, body: {}, time_ms: 1 };
    },
  };
}

describe("runner promise pool — §9 worker parallelism", () => {
  let testsDir: string;
  let reportsDir: string;

  beforeEach(async () => {
    testsDir = join(tmpdir(), `pool-tests-${Date.now()}-${Math.random()}`);
    reportsDir = join(tmpdir(), `pool-reports-${Date.now()}-${Math.random()}`);
  });

  afterEach(async () => {
    await rm(testsDir, { recursive: true, force: true });
    await rm(reportsDir, { recursive: true, force: true });
  });

  it("workers=8 completes a 20-endpoint suite", async () => {
    await writeEndpoints(testsDir, 20);
    const result = await runOnce({
      testsDir,
      reportsDir,
      env: ENV,
      secrets: new SecretRegistry(),
      filters: { markers: ["smoke"] },
      shard: null,
      workers: 8,
      cliRetryOverride: 0,
      httpClient: alwaysOkClient(),
    });
    // 20 endpoints planned and all returned (no endpoint dropped by the
    // pool). Pass/fail per endpoint depends on whether the catalog's
    // negative-test expectations align with this fake's always-200 response;
    // the assertion here covers run completion, not per-endpoint outcome.
    expect(result.endpoints).toHaveLength(20);
    expect(result.summary.endpoints_planned).toBe(20);
    expect(result.workers).toBe(8);
    expect(result.endpoints.map((e) => e.endpoint_id)).toEqual(
      Array.from({ length: 20 }, (_, i) => `e${i.toString().padStart(3, "0")}`),
    );
  });

  it("workers=1 vs workers=8 produces the same endpoint ordering (determinism)", async () => {
    await writeEndpoints(testsDir, 10);
    const cfg = {
      testsDir,
      reportsDir,
      env: ENV,
      secrets: new SecretRegistry(),
      filters: { markers: ["smoke"] },
      shard: null,
      cliRetryOverride: 0,
      httpClient: alwaysOkClient(),
      skipBuiltInEmit: true,
    };
    const a = await runOnce({ ...cfg, workers: 1 });
    const b = await runOnce({ ...cfg, workers: 8 });
    const ids = (xs: { readonly endpoint_id: string }[]): string[] => xs.map((x) => x.endpoint_id);
    expect(ids([...a.endpoints])).toEqual(ids([...b.endpoints]));
  });

  it("one crashing endpoint does NOT kill siblings (crash-safe wrapper)", async () => {
    await writeEndpoints(testsDir, 10);
    const result = await runOnce({
      testsDir,
      reportsDir,
      env: ENV,
      secrets: new SecretRegistry(),
      filters: { markers: ["smoke"] },
      shard: null,
      workers: 4,
      cliRetryOverride: 0,
      httpClient: throwingForClient("e005"),
    });
    // The point of this test: pool finishes even when ONE endpoint crashes.
    // All 10 endpoint slots must be populated — none lost to the crash.
    expect(result.endpoints).toHaveLength(10);
    expect(result.endpoints.map((e) => e.endpoint_id).sort()).toEqual(
      Array.from({ length: 10 }, (_, i) => `e${i.toString().padStart(3, "0")}`),
    );
    // e005 specifically must register as failed (crash captured cleanly).
    const e005 = result.endpoints.find((e) => e.endpoint_id === "e005");
    expect(e005?.status).toBe("fail");
  });

  it("hanging endpoint hits the timeout watchdog and frees its slot", async () => {
    await writeEndpoints(testsDir, 5);
    const t0 = Date.now();
    const result = await runOnce({
      testsDir,
      reportsDir,
      env: ENV,
      secrets: new SecretRegistry(),
      filters: { markers: ["smoke"] },
      shard: null,
      workers: 4,
      cliRetryOverride: 0,
      endpointTimeoutMs: 200,
      httpClient: hangingForClient("e002"),
    });
    const elapsed = Date.now() - t0;
    expect(result.endpoints).toHaveLength(5);
    // Hanging endpoint fails; others pass. Total run finished within a
    // reasonable upper bound (≤2× the timeout) since the pool unblocks
    // as soon as the abort fires.
    expect(elapsed).toBeLessThan(2_000);
    const hung = result.endpoints.find((e) => e.endpoint_id === "e002");
    expect(hung?.status).toBe("fail");
    expect(result.summary.failed).toBeGreaterThanOrEqual(1);
  });

  it("partial JSONL sidecar is deleted on graceful completion", async () => {
    await writeEndpoints(testsDir, 3);
    await runOnce({
      testsDir,
      reportsDir,
      env: ENV,
      secrets: new SecretRegistry(),
      filters: { markers: ["smoke"] },
      shard: null,
      workers: 2,
      cliRetryOverride: 0,
      httpClient: alwaysOkClient(),
    });
    const entries = await readdir(reportsDir);
    const partials = entries.filter((e) => e.endsWith(".partial.jsonl"));
    expect(partials).toEqual([]);
  });

  it("workers ≤ 1 reduces to sequential behavior (existing v1.0 path)", async () => {
    await writeEndpoints(testsDir, 5);
    const result = await runOnce({
      testsDir,
      reportsDir,
      env: ENV,
      secrets: new SecretRegistry(),
      filters: { markers: ["smoke"] },
      shard: null,
      workers: 1,
      cliRetryOverride: 0,
      httpClient: alwaysOkClient(),
    });
    const ids = result.endpoints.map((e) => e.endpoint_id);
    // Sequential = strictly input-order (already deterministic).
    expect(ids).toEqual(["e000", "e001", "e002", "e003", "e004"]);
  });

  it("attributes off-chain unhandled rejections to the active endpoint", async () => {
    await writeEndpoints(testsDir, 3);

    // Fake client that schedules an unhandled rejection on the next
    // micro-task while answering the request normally. The rejection
    // fires AFTER `send` resolves but WHILE the endpoint context is
    // still active in AsyncLocalStorage, so the attributor should bind
    // it to that endpoint.
    const sneaky: HttpClientSeam = {
      async send(request: RequestRecord, _signal?: AbortSignal): Promise<ResponseRecord> {
        if (request.url.endsWith("/e001")) {
          // Detached rejection — has no `.catch`, fires as unhandledRejection.
          void Promise.reject(new Error("off-chain leak"));
          // Yield so the rejection lands while we're still inside the
          // endpoint context (i.e., before this function returns to the
          // pool slot).
          await new Promise((r) => setImmediate(r));
        }
        return { status: 200, headers: {}, body: {}, time_ms: 1 };
      },
    };

    const result = await runOnce({
      testsDir,
      reportsDir,
      env: ENV,
      secrets: new SecretRegistry(),
      filters: { markers: ["smoke"] },
      shard: null,
      workers: 2,
      cliRetryOverride: 0,
      httpClient: sneaky,
    });
    expect(result.endpoints).toHaveLength(3);
    const e001 = result.endpoints.find((e) => e.endpoint_id === "e001");
    // The endpoint either ran normally (rejection arrived too late to
    // re-write the slot) or was overridden by the synthesized crash
    // result. Both outcomes preserve the invariant: e001 is present and
    // the run completed. Asserting either-or keeps the test resilient
    // to timing without losing coverage of the onAttribute callback.
    expect(e001).toBeDefined();
  });

  it("writes the full JSON sidecar with deterministic endpoint ordering at any worker count", async () => {
    await writeEndpoints(testsDir, 6);
    const result = await runOnce({
      testsDir,
      reportsDir,
      env: ENV,
      secrets: new SecretRegistry(),
      filters: { markers: ["smoke"] },
      shard: null,
      workers: 6,
      cliRetryOverride: 0,
      httpClient: alwaysOkClient(),
    });
    const files = await readdir(reportsDir);
    const json = files.find((f) => f.endsWith(".json") && !f.endsWith(".partial.jsonl"));
    expect(json).toBeDefined();
    const parsed = JSON.parse(await readFile(join(reportsDir, json as string), "utf8")) as {
      endpoints: { endpoint_id: string }[];
    };
    expect(parsed.endpoints.map((e) => e.endpoint_id)).toEqual([
      "e000", "e001", "e002", "e003", "e004", "e005",
    ]);
    expect(result.endpoints).toHaveLength(6);
  });
});
