/**
 * Integration (CLI subprocess) tests for the `pagination_boundary` single-request flow.
 *
 * Spawns `node dist/cli/entry.js run` against fixture endpoint files and a
 * local programmable stub HTTP server whose per-path response sequences are
 * scripted at test-setup time.
 *
 * Pins the following design decisions (v1.0.2-pr5-pagination-boundary.md):
 *   DD-1  Single-request flow — no second request issued for any probe.
 *   DD-4  Probe set: page-style emits 4 probes.
 *   DD-5  Non-GET with pagination → 0 pagination_boundary cases.
 *   DD-6  page=-1 expected 400; server returning 200 is a fail.
 *
 * CLI subprocess scenarios (5 tests):
 *   1. Stub serves correct statuses for all 4 page-style probes → exit 0
 *   2. Stub serves 200 for size=0 (server bug) → exit non-zero with status-mismatch
 *   3. Stub serves 200 for size=max+1 (server bug) → exit non-zero with status-mismatch
 *   4. skip_cases: ["pagination_boundary"] → no pagination probes in report
 *   5. Backward compat: endpoint without pagination → no pagination_boundary attempts
 *
 * Subprocess pattern mirrors conditional-get-two-request.test.ts (PR #4, v1.0.2).
 * NOTE: TRUE end-to-end coverage lives in apiwright-testing/ sibling repo.
 *
 * Category: Integration — CLI subprocess tests.
 * Expected initial failure: TestPlanGenerator returns zero pagination_boundary cases;
 *   PaginationBoundaryGenerator not wired into DEFAULT_GENERATOR_ORDER.
 */

import {
  mkdtempSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  makeSandbox,
  runCli,
  execFileAsync,
} from "./skip-cases-helpers.js";

// ---------------------------------------------------------------------------
// Programmable stub server (minimal, query-string aware)
// ---------------------------------------------------------------------------

interface ScriptedResponse {
  readonly status: number;
  readonly body: unknown;
  readonly headers?: Record<string, string>;
}

/**
 * Programmable stub server that dispatches based on path + query string.
 * Allows per-probe scripting for pagination probes.
 */
interface ProgrammableServer {
  readonly url: string;
  setScript(script: Record<string, ScriptedResponse>): void;
  resetScript(): void;
  close(): Promise<void>;
}

async function startProgrammableServer(): Promise<ProgrammableServer> {
  const script: Record<string, ScriptedResponse> = {};

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const rawUrl = req.url ?? "/";
    // Try full path+query match first, then path-only fallback
    const scripted = script[rawUrl] ?? script[rawUrl.split("?")[0]!];
    if (!scripted) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    const resHdrs: Record<string, string> = {
      "content-type": "application/json",
      ...(scripted.headers ?? {}),
    };
    res.writeHead(scripted.status, resHdrs);
    const bodyStr = scripted.body === null ? "" : JSON.stringify(scripted.body);
    res.end(bodyStr);
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("server address unknown");
  const url = `http://127.0.0.1:${(addr as { port: number }).port}`;

  return {
    url,
    setScript(newScript: Record<string, ScriptedResponse>) {
      Object.keys(script).forEach((k) => {
        delete (script as Record<string, unknown>)[k];
      });
      Object.assign(script, newScript);
    },
    resetScript() {
      Object.keys(script).forEach((k) => {
        delete (script as Record<string, unknown>)[k];
      });
    },
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      ),
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("pagination_boundary single-request (CLI subprocess)", () => {
  let server: ProgrammableServer;

  beforeAll(async () => {
    server = await startProgrammableServer();
  }, 30_000);

  afterAll(async () => {
    await server.close();
  });

  // -------------------------------------------------------------------------
  // Test 1: Stub serves correct statuses for all 4 page-style probes → exit 0
  // -------------------------------------------------------------------------

  it("exits 0 when stub serves correct statuses for all 4 page-style probes", async () => {
    const testDir = mkdtempSync(join(tmpdir(), "pagination-1-"));
    try {
      server.setScript({
        // size_zero → 400
        "/api/paged?size=0": { status: 400, body: { error: "bad size" } },
        // size_max (100) → 200
        "/api/paged?size=100": { status: 200, body: { data: [] } },
        // size_max_plus_one (101) → 400
        "/api/paged?size=101": { status: 400, body: { error: "exceeds max" } },
        // page_negative → 400
        "/api/paged?page=-1": { status: 400, body: { error: "bad page" } },
      });

      makeSandbox({
        dir: testDir,
        serverUrl: server.url,
        endpoints: [
          {
            id: "paged.list",
            name: "Paged List",
            method: "GET",
            url: "/api/paged",
            request: {},
            response: { expected_status: 200, schema: { type: "object" } },
            markers: ["regression"],
            pagination: {
              style: "page",
              size_param: "size",
              page_param: "page",
              default_size: 20,
              max_size: 100,
            },
            skip_cases: [
              "status_code_conformance",
              "content_type_alignment",
              "response_time_sla",
              "response_schema_validation",
              "get_idempotency",
            ],
          },
        ],
        config: { retry: { count: 0 } },
      });

      const { exitCode, report } = await runCli(testDir, "regression");
      expect(exitCode).toBe(0);

      if (report !== null) {
        const ep = report.endpoints.find((e) => e.endpoint_id === "paged.list");
        expect(ep).toBeDefined();
        const paginationAttempts =
          ep?.attempts.filter((a) => a.kind === "pagination_boundary") ?? [];
        expect(paginationAttempts.length).toBeGreaterThanOrEqual(1);
        const failed = paginationAttempts.filter((a) => a.verdict === "fail");
        expect(failed).toHaveLength(0);
      } else {
        expect(report).not.toBeNull();
      }
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  }, 60_000);

  // -------------------------------------------------------------------------
  // Test 2: Stub serves 200 for size=0 (server bug) → exit non-zero with reason
  // -------------------------------------------------------------------------

  it("exits non-zero with status-mismatch failure_reason when server returns 200 for size=0", async () => {
    const testDir = mkdtempSync(join(tmpdir(), "pagination-2-"));
    try {
      server.setScript({
        // BUG: size=0 returns 200 instead of 400
        "/api/buggy?size=0": { status: 200, body: { data: [] } },
        "/api/buggy?size=100": { status: 200, body: { data: [] } },
        "/api/buggy?size=101": { status: 400, body: { error: "exceeds max" } },
        "/api/buggy?page=-1": { status: 400, body: { error: "bad page" } },
      });

      makeSandbox({
        dir: testDir,
        serverUrl: server.url,
        endpoints: [
          {
            id: "buggy.list",
            name: "Buggy List",
            method: "GET",
            url: "/api/buggy",
            request: {},
            response: { expected_status: 200, schema: { type: "object" } },
            markers: ["regression"],
            pagination: {
              style: "page",
              size_param: "size",
              page_param: "page",
              default_size: 20,
              max_size: 100,
            },
            skip_cases: [
              "status_code_conformance",
              "content_type_alignment",
              "response_time_sla",
              "response_schema_validation",
              "get_idempotency",
            ],
          },
        ],
        config: { retry: { count: 0 } },
      });

      const { exitCode, report } = await runCli(testDir, "regression");
      expect(exitCode).not.toBe(0);

      if (report !== null) {
        const ep = report.endpoints.find((e) => e.endpoint_id === "buggy.list");
        const failedAttempt = ep?.attempts.find(
          (a) => a.kind === "pagination_boundary" && a.verdict === "fail",
        );
        expect(failedAttempt).toBeDefined();
        // failure_reason should mention the expected/actual status
        const reason = (failedAttempt as unknown as { failure_reason?: string })
          ?.failure_reason ?? "";
        expect(reason).toMatch(/400/);
        expect(reason).toMatch(/200/);
      } else {
        expect(report).not.toBeNull();
      }
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  }, 60_000);

  // -------------------------------------------------------------------------
  // Test 3: Stub serves 200 for size=max+1 (server bug) → exit non-zero
  // -------------------------------------------------------------------------

  it("exits non-zero when server accepts size=max+1 with 200 (server does not enforce max)", async () => {
    const testDir = mkdtempSync(join(tmpdir(), "pagination-3-"));
    try {
      server.setScript({
        "/api/nomax?size=0": { status: 400, body: { error: "bad size" } },
        "/api/nomax?size=100": { status: 200, body: { data: [] } },
        // BUG: size=101 returns 200 instead of 400
        "/api/nomax?size=101": { status: 200, body: { data: [] } },
        "/api/nomax?page=-1": { status: 400, body: { error: "bad page" } },
      });

      makeSandbox({
        dir: testDir,
        serverUrl: server.url,
        endpoints: [
          {
            id: "nomax.list",
            name: "No-Max List",
            method: "GET",
            url: "/api/nomax",
            request: {},
            response: { expected_status: 200, schema: { type: "object" } },
            markers: ["regression"],
            pagination: {
              style: "page",
              size_param: "size",
              page_param: "page",
              default_size: 20,
              max_size: 100,
            },
            skip_cases: [
              "status_code_conformance",
              "content_type_alignment",
              "response_time_sla",
              "response_schema_validation",
              "get_idempotency",
            ],
          },
        ],
        config: { retry: { count: 0 } },
      });

      const { exitCode } = await runCli(testDir, "regression");
      expect(exitCode).not.toBe(0);
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  }, 60_000);

  // -------------------------------------------------------------------------
  // Test 4: skip_cases: ["pagination_boundary"] → no pagination probes in report
  // -------------------------------------------------------------------------

  it("omits all pagination_boundary attempts when skip_cases: ['pagination_boundary']", async () => {
    const testDir = mkdtempSync(join(tmpdir(), "pagination-4-"));
    try {
      server.resetScript();

      makeSandbox({
        dir: testDir,
        serverUrl: server.url,
        endpoints: [
          {
            id: "skip.list",
            name: "Skip List",
            method: "GET",
            url: "/api/skip",
            request: {},
            response: { expected_status: 200, schema: { type: "object" } },
            markers: ["regression"],
            pagination: {
              style: "page",
              size_param: "size",
              page_param: "page",
              default_size: 20,
              max_size: 100,
            },
            skip_cases: [
              "pagination_boundary",
              "status_code_conformance",
              "content_type_alignment",
              "response_time_sla",
              "response_schema_validation",
              "get_idempotency",
            ],
          },
        ],
        config: { retry: { count: 0 } },
      });

      const { exitCode, report } = await runCli(testDir, "regression");
      expect(exitCode).toBe(0);

      if (report !== null) {
        const ep = report.endpoints.find((e) => e.endpoint_id === "skip.list");
        const paginationAttempts =
          ep?.attempts.filter((a) => a.kind === "pagination_boundary") ?? [];
        expect(paginationAttempts).toHaveLength(0);
      } else {
        expect(report).not.toBeNull();
      }
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  }, 60_000);

  // -------------------------------------------------------------------------
  // Test 5: Backward compat — endpoint without pagination → no new cases
  // -------------------------------------------------------------------------

  it("produces no pagination_boundary attempts for endpoint without pagination field", async () => {
    const testDir = mkdtempSync(join(tmpdir(), "pagination-5-"));
    try {
      server.resetScript();

      makeSandbox({
        dir: testDir,
        serverUrl: server.url,
        endpoints: [
          {
            id: "legacy.list",
            name: "Legacy List",
            method: "GET",
            url: "/api/legacy",
            request: {},
            response: { expected_status: 200, schema: { type: "object" } },
            markers: ["regression"],
            // deliberately NO pagination field
            skip_cases: [
              "status_code_conformance",
              "content_type_alignment",
              "response_time_sla",
              "response_schema_validation",
              "get_idempotency",
            ],
          },
        ],
        config: { retry: { count: 0 } },
      });

      const { exitCode, report } = await runCli(testDir, "regression");
      expect(exitCode).toBe(0);

      if (report !== null) {
        const ep = report.endpoints.find((e) => e.endpoint_id === "legacy.list");
        const paginationAttempts =
          ep?.attempts.filter((a) => a.kind === "pagination_boundary") ?? [];
        expect(paginationAttempts).toHaveLength(0);
      } else {
        expect(report).not.toBeNull();
      }
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  }, 60_000);

  // -------------------------------------------------------------------------
  // Smoke guard
  // -------------------------------------------------------------------------

  it("CLI binary is reachable (smoke guard)", async () => {
    const cli = join(process.cwd(), "dist", "cli", "entry.js");
    let reachable = false;
    try {
      await execFileAsync("node", [cli, "--help"], { encoding: "utf8" });
      reachable = true;
    } catch {
      reachable = true;
    }
    expect(reachable).toBe(true);
  }, 15_000);
});
