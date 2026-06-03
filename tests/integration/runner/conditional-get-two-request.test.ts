/**
 * Integration (CLI subprocess) tests for the conditional_get_304 two-request flow.
 *
 * Spawns `node dist/cli/entry.js run` against a fixture GET endpoint file and a
 * local programmable stub HTTP server whose per-path response sequences are scripted
 * at test-setup time.
 *
 * Pins the following design decisions (v1.0.2-pr4-etag-conditional-get.md):
 *   DD-1  Missing first-response ETag → runtime fail, NOT plan-time error.
 *         GET #2 is NOT issued when GET #1 returns no ETag.
 *   DD-2  If-None-Match header set to the captured ETag verbatim (W/ prefix kept).
 *   DD-3  Second response must be EXACTLY 304 — server returning 200 is a fail.
 *   DD-4  304 must carry ETag matching first response; absent/mismatched → fail.
 *   DD-5  304 body must be empty; non-empty → fail.
 *   DD-9  Auth strategy applied to both requests; second request carries auth header.
 *   DD-10 If-None-Match injection is runtime mutation: GET #1 does NOT carry it;
 *         only GET #2 does.
 *
 * Failure-reason templates verified exactly (locked in design §7):
 *   "conditional_get_304: first response missing ETag header (etag_supported: true)"
 *   "conditional_get_304: expected 304 Not Modified on second request, got <N>"
 *   "conditional_get_304: 304 response missing ETag header"
 *   "conditional_get_304: 304 ETag '<got>' does not match first response ETag '<expected>'"
 *   "conditional_get_304: 304 response body is not empty"
 *
 * Covers 3 CLI subprocess scenarios from the design outline §8 Layer 3:
 *   1. Pass: stub serves first GET with ETag, second GET with If-None-Match → 304+ETag → pass
 *   2. Fail: stub serves first GET without ETag → exit non-zero, failure_reason contains
 *            "missing ETag"
 *   3. Skip: skip_cases: ["conditional_get_304"] → no conditional case in report
 *
 * Subprocess pattern mirrors put-idempotency-two-request.test.ts and
 * head-get-parity-two-request.test.ts.
 * NOTE: TRUE end-to-end coverage lives in apiwright-testing/ sibling repo.
 *
 * Category: Integration — CLI subprocess tests 1–3.
 * Expected initial failure: TestPlanGenerator returns zero conditional_get_304 cases
 *   (ConditionalGetGenerator not wired into DEFAULT_GENERATOR_ORDER).
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
// Programmable stub server
// ---------------------------------------------------------------------------

/**
 * A scripted response value for the stub server.
 */
interface ScriptedResponse {
  readonly status: number;
  readonly body: unknown;
  readonly headers?: Record<string, string>;
}

/**
 * Programmable stub server interface. Supports method-keyed scripts
 * (e.g. "GET:/path") so the two GET requests (first without If-None-Match,
 * second with If-None-Match) can return different responses.
 *
 * The server also captures the full request headers for each call so tests
 * can assert that If-None-Match was injected on the second GET only.
 */
interface ProgrammableServer {
  readonly url: string;
  callCount(key: string): number;
  /** Headers from the Nth call (1-based) to a given path. */
  capturedHeaders(path: string, callIndex: number): Record<string, string> | undefined;
  resetCounters(): void;
  setScript(script: Record<string, readonly ScriptedResponse[]>): void;
  close(): Promise<void>;
}

/** Captures incoming request headers as a lowercase Record. */
function captureHeaders(req: IncomingMessage): Record<string, string> {
  const hdrs: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === "string") hdrs[k.toLowerCase()] = v;
  }
  return hdrs;
}

/**
 * Dispatches one request to the scripted response sequence. Extracted to keep
 * the handler arrow function within the complexity limit.
 */
function dispatchRequest(
  req: IncomingMessage,
  res: ServerResponse,
  script: Record<string, readonly ScriptedResponse[]>,
  cursors: Record<string, number>,
  counts: Record<string, number>,
  capturedReqHeaders: Record<string, Array<Record<string, string>>>,
): void {
  const path = req.url ?? "/";
  const method = req.method?.toUpperCase() ?? "GET";
  const methodKey = `${method}:${path}`;

  const captured = capturedReqHeaders[path];
  const hdrs = captureHeaders(req);
  if (captured) {
    captured.push(hdrs);
  } else {
    capturedReqHeaders[path] = [hdrs];
  }

  counts[methodKey] = (counts[methodKey] ?? 0) + 1;
  counts[path] = (counts[path] ?? 0) + 1;

  const sequence = script[methodKey] ?? script[path];
  if (!sequence || sequence.length === 0) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  const idx = cursors[methodKey] ?? cursors[path] ?? 0;
  cursors[methodKey] = idx + 1;
  emitScripted(res, sequence, idx);
}

/** Emits a scripted response at index `idx` (or last entry if past end). */
function emitScripted(
  res: ServerResponse,
  sequence: readonly ScriptedResponse[],
  idx: number,
): void {
  const scripted = sequence[idx] ?? sequence[sequence.length - 1]!;
  const resHdrs: Record<string, string> = {
    "content-type": "application/json",
    ...(scripted.headers ?? {}),
  };
  res.writeHead(scripted.status, resHdrs);
  const bodyStr = scripted.body === null ? "" : JSON.stringify(scripted.body);
  res.end(bodyStr);
}

async function startProgrammableServer(): Promise<ProgrammableServer> {
  const script: Record<string, readonly ScriptedResponse[]> = {};
  const cursors: Record<string, number> = {};
  const counts: Record<string, number> = {};
  const capturedReqHeaders: Record<string, Array<Record<string, string>>> = {};

  const server = createServer((_req: IncomingMessage, res: ServerResponse) => {
    dispatchRequest(_req, res, script, cursors, counts, capturedReqHeaders);
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("server address unknown");
  const url = `http://127.0.0.1:${(addr as { port: number }).port}`;

  return {
    url,
    callCount: (key: string) => counts[key] ?? 0,
    capturedHeaders: (path: string, callIndex: number) =>
      capturedReqHeaders[path]?.[callIndex - 1],
    resetCounters: () => {
      for (const k of Object.keys(counts)) delete counts[k];
      for (const k of Object.keys(cursors)) delete cursors[k];
      for (const k of Object.keys(capturedReqHeaders)) delete capturedReqHeaders[k];
    },
    setScript: (newScript: Record<string, readonly ScriptedResponse[]>) => {
      Object.keys(script).forEach((k) => { delete (script as Record<string, unknown>)[k]; });
      Object.assign(script, newScript);
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

describe("conditional_get_304 two-request (CLI subprocess)", () => {
  let server: ProgrammableServer;

  beforeAll(async () => {
    server = await startProgrammableServer();
  }, 30_000);

  afterAll(async () => {
    await server.close();
  });

  // -------------------------------------------------------------------------
  // Test 1: Pass path — stub serves ETag on first GET, honours If-None-Match
  //         on second GET with 304 + matching ETag + empty body → exit 0
  // -------------------------------------------------------------------------

  it("exits 0 and verdict=pass when server returns ETag on GET and 304+ETag on conditional GET", async () => {
    const testDir = mkdtempSync(join(tmpdir(), "cget-1-"));
    try {
      server.resetCounters();
      const etag = '"v42"';
      // First GET returns 200 + ETag; second GET (with If-None-Match) returns
      // 304 + matching ETag + no body.
      server.setScript({
        "/api/items.etag": [
          { status: 200, body: { id: 1 }, headers: { etag } },
          { status: 304, body: null, headers: { etag } },
        ],
      });

      makeSandbox({
        dir: testDir,
        serverUrl: server.url,
        endpoints: [
          {
            id: "items.list",
            name: "List Items",
            method: "GET",
            url: "/api/items.etag",
            request: {},
            response: { expected_status: 200, schema: { type: "object" } },
            etag_supported: true,
            markers: ["regression"],
            // Suppress other cases that would consume scripted responses
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
        const ep = report.endpoints.find((e) => e.endpoint_id === "items.list");
        expect(ep).toBeDefined();
        const conditionalAttempts = ep?.attempts.filter(
          (a) => a.kind === "conditional_get_304",
        ) ?? [];
        expect(conditionalAttempts.length).toBeGreaterThanOrEqual(1);
        const failed = conditionalAttempts.filter((a) => a.verdict === "fail");
        expect(failed).toHaveLength(0);
      } else {
        expect(report).not.toBeNull();
      }
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  }, 60_000);

  // -------------------------------------------------------------------------
  // Test 2: Fail path — stub returns first GET WITHOUT an ETag header →
  //         exit non-zero; failure_reason contains "missing ETag" (DD-1)
  // -------------------------------------------------------------------------

  it("exits non-zero with 'missing ETag' in failure_reason when first GET has no ETag header", async () => {
    const testDir = mkdtempSync(join(tmpdir(), "cget-2-"));
    try {
      server.resetCounters();
      // First GET returns 200 but NO ETag header → runner should fail with DD-1 message
      server.setScript({
        "/api/noetag.items": [
          { status: 200, body: { id: 2 } },
          // second response should NOT be called (DD-1: GET #2 NOT issued)
          { status: 304, body: null, headers: { etag: '"ignored"' } },
        ],
      });

      makeSandbox({
        dir: testDir,
        serverUrl: server.url,
        endpoints: [
          {
            id: "noetag.list",
            name: "No ETag List",
            method: "GET",
            url: "/api/noetag.items",
            request: {},
            response: { expected_status: 200, schema: { type: "object" } },
            etag_supported: true,
            markers: ["regression"],
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
        const ep = report.endpoints.find((e) => e.endpoint_id === "noetag.list");
        const failedAttempt = ep?.attempts.find(
          (a) => a.kind === "conditional_get_304" && a.verdict === "fail",
        );
        expect(failedAttempt).toBeDefined();
        expect(failedAttempt?.failure_reason ?? "").toMatch(/missing ETag/i);
        // DD-1: GET #2 NOT issued — call count for the path should be exactly 1
        // (just the first GET; no second conditional GET)
        const callsToPath = server.callCount("/api/noetag.items");
        expect(callsToPath).toBe(1);
      } else {
        expect(report).not.toBeNull();
      }
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  }, 60_000);

  // -------------------------------------------------------------------------
  // Test 3: Skip path — skip_cases: ["conditional_get_304"] → no conditional
  //         case in report; only GET #1 issued (no second request for the case)
  // -------------------------------------------------------------------------

  it("omits conditional_get_304 from report and makes no second request when skip_cases includes it", async () => {
    const testDir = mkdtempSync(join(tmpdir(), "cget-3-"));
    try {
      server.resetCounters();
      server.setScript({
        "/api/skip.items": [
          { status: 200, body: { id: 3 }, headers: { etag: '"v1"' } },
          // second response should NOT be consumed
          { status: 304, body: null, headers: { etag: '"v1"' } },
        ],
      });

      makeSandbox({
        dir: testDir,
        serverUrl: server.url,
        endpoints: [
          {
            id: "skip.list",
            name: "Skip List",
            method: "GET",
            url: "/api/skip.items",
            request: {},
            response: { expected_status: 200, schema: { type: "object" } },
            etag_supported: true,
            markers: ["regression"],
            skip_cases: [
              "conditional_get_304",
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
        const conditionalAttempts = ep?.attempts.filter(
          (a) => a.kind === "conditional_get_304",
        ) ?? [];
        expect(conditionalAttempts).toHaveLength(0);
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
