import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";

import { RealTestRunner } from "../../../src/cli/seams/real-test-runner.js";

const VALID_ENDPOINT = JSON.stringify({
  id: "e",
  name: "e",
  method: "GET",
  url: "/x",
  request: {},
  response: { expected_status: 200, schema: {} },
  markers: ["smoke"],
});

describe("RealTestRunner", () => {
  let testsDir: string;
  let reportsDir: string;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(async () => {
    testsDir = join(tmpdir(), `real-runner-${Date.now()}-${Math.random()}`);
    reportsDir = join(tmpdir(), `real-runner-reports-${Date.now()}-${Math.random()}`);
    await mkdir(testsDir, { recursive: true });
    await writeFile(join(testsDir, "e.endpoint.json"), VALID_ENDPOINT, "utf8");
    originalFetch = globalThis.fetch;
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    await rm(testsDir, { recursive: true, force: true });
    await rm(reportsDir, { recursive: true, force: true });
  });

  it("runs the CLI pipeline end-to-end via the seam", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      text: async () => "{}",
    }));
    const runner = new RealTestRunner();
    const outcome = await runner.run({
      env: "test",
      environment: { name: "test", prod: false, base_url: "https://api.invalid" },
      markers: ["smoke"],
      logLevel: "warn",
      settings: {
        env: "test",
        markers: ["smoke"],
        logLevel: "warn",
        workers: 1,
        retries: 0,
        allowNonSmokeInProd: false,
        config: {
          tests_dir: testsDir,
          environments_dir: "./environments",
          reports_dir: reportsDir,
          default_env: "test",
          default_markers: ["smoke"],
          log_level: "warn",
          workers: 1,
          retry: { count: 0, delay_ms: 0, backoff: "none", strict: false },
          report: { html: false, json: true, junit_xml: false, output_dir: reportsDir },
        },
      },
    });
    expect(outcome.total).toBeGreaterThan(0);
    expect(outcome.passed + outcome.failed + outcome.flaky).toBe(outcome.total);
  });

  it("rejects when environment is missing", async () => {
    const runner = new RealTestRunner();
    await expect(runner.run({
      env: "test",
      markers: ["smoke"],
      logLevel: "warn",
      settings: {} as never,
    })).rejects.toThrow(/environment/i);
  });
});
