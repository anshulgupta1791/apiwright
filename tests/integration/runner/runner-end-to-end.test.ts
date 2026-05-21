import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";

import { SecretRegistry } from "../../../src/env/index.js";
import type { ResolvedEnvironment } from "../../../src/env/index.js";
import { isRunnerError, runOnce } from "../../../src/runner/index.js";

/**
 * Sets up a temp directory containing a single valid endpoint JSON file.
 * @returns The temp directory path.
 */
async function setupTestsDir(): Promise<string> {
  const dir = await mkdir(join(tmpdir(), `runner-e2e-${Date.now()}-${Math.random()}`), { recursive: true });
  const subdir = join(dir!, "users");
  await mkdir(subdir, { recursive: true });
  const endpoint = {
    id: "users.get",
    name: "Get user",
    method: "GET",
    url: "/users/1",
    request: {},
    response: { expected_status: 200, schema: { type: "object" } },
    markers: ["smoke"],
  };
  await writeFile(join(subdir, "get.endpoint.json"), JSON.stringify(endpoint), "utf8");
  // Add a v1.5 reserved flow file that should be ignored
  await writeFile(join(subdir, "checkout.flow.json"), "{}", "utf8");
  // Add a non-matching file that should be ignored
  await writeFile(join(subdir, "README.md"), "# notes", "utf8");
  return dir!;
}

describe("runner.runOnce — end-to-end with real fs + stubbed fetch", () => {
  let testsDir: string;
  let reportsDir: string;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(async () => {
    testsDir = await setupTestsDir();
    reportsDir = join(tmpdir(), `runner-reports-${Date.now()}-${Math.random()}`);
    originalFetch = globalThis.fetch;
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    await rm(testsDir, { recursive: true, force: true });
    await rm(reportsDir, { recursive: true, force: true });
  });

  it("walks tests dir, runs smoke marker, returns pass for a 200 endpoint", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      text: async () => "{}",
    }));

    const env: ResolvedEnvironment = {
      name: "test",
      prod: false,
      base_url: "https://api.invalid",
      default_sla_ms: 1000,
    };
    const result = await runOnce({
      testsDir,
      reportsDir,
      env,
      secrets: new SecretRegistry(),
      filters: { markers: ["smoke"] },
      shard: null,
      workers: 1,
    });

    expect(result.endpoints).toHaveLength(1);
    expect(result.endpoints[0]?.endpoint_id).toBe("users.get");
    expect(result.summary.passed).toBeGreaterThan(0);
    expect(result.env).toBe("test");
    expect(result.shard).toBeNull();
    expect(result.workers).toBe(1);
  });

  it("throws RUNNER_PLAN_EMPTY when no endpoint files exist", async () => {
    const emptyDir = join(tmpdir(), `runner-empty-${Date.now()}`);
    await mkdir(emptyDir, { recursive: true });
    try {
      const env: ResolvedEnvironment = { name: "x", prod: false };
      try {
        await runOnce({
          testsDir: emptyDir,
          reportsDir,
          env,
          secrets: new SecretRegistry(),
          filters: { markers: ["smoke"] },
          shard: null,
          workers: 1,
        });
        expect.fail("should have thrown");
      } catch (e: unknown) {
        expect(isRunnerError(e)).toBe(true);
      }
    } finally {
      await rm(emptyDir, { recursive: true, force: true });
    }
  });

  it("respects shard slicing across multiple endpoints", async () => {
    // Add a second endpoint to the tests dir
    const subdir = join(testsDir, "users");
    const endpoint2 = {
      id: "users.list",
      name: "List users",
      method: "GET",
      url: "/users",
      request: {},
      response: { expected_status: 200, schema: { type: "array" } },
      markers: ["smoke"],
    };
    await writeFile(join(subdir, "list.endpoint.json"), JSON.stringify(endpoint2), "utf8");

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      text: async () => "[]",
    }));

    const env: ResolvedEnvironment = { name: "x", prod: false, base_url: "https://api.invalid" };

    const shard1 = await runOnce({
      testsDir,
      reportsDir,
      env,
      secrets: new SecretRegistry(),
      filters: { markers: ["smoke"] },
      shard: { index: 1, total: 2 },
      workers: 1,
    });
    const shard2 = await runOnce({
      testsDir,
      reportsDir,
      env,
      secrets: new SecretRegistry(),
      filters: { markers: ["smoke"] },
      shard: { index: 2, total: 2 },
      workers: 1,
    });
    const combined = [...shard1.endpoints, ...shard2.endpoints].map((e) => e.endpoint_id).sort();
    expect(combined).toEqual(["users.get", "users.list"]);
  });

  it("writes a JSON sidecar to the reports directory", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      status: 200,
      headers: new Headers(),
      text: async () => "{}",
    }));
    const env: ResolvedEnvironment = { name: "x", prod: false, base_url: "https://api.invalid" };
    await runOnce({
      testsDir,
      reportsDir,
      env,
      secrets: new SecretRegistry(),
      filters: { markers: ["smoke"] },
      shard: null,
      workers: 1,
    });
    const { readdir } = await import("node:fs/promises");
    const entries = await readdir(reportsDir);
    expect(entries.some((e) => e.startsWith("run-") && e.endsWith(".json"))).toBe(true);
  });
});
