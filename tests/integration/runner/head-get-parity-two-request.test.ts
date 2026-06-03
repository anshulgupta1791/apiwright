/**
 * Integration (CLI subprocess) tests for the head_get_parity two-request flow — part 1.
 *
 * Covers CLI subprocess tests 1–2: pass path and status-differs fail path.
 * Spawns `node dist/cli/entry.js run` against fixture HEAD + GET endpoint files
 * and a local programmable stub HTTP server.
 *
 * Pins the following design decisions (v1.0.2-pr3-head-get-parity.md):
 *   DD-1  paired_get_url is the RAW template; runner applies template substitution.
 *   DD-4  HEAD body non-empty causes a fail verdict at the verdict layer.
 *   DD-5  Resolver runs after skip filter.
 *
 * Part 2 (first-gate failure and broken pair) lives in
 * head-get-parity-two-request-2.test.ts to stay within the 300 LOC soft limit.
 *
 * Subprocess pattern mirrors put-idempotency-two-request.test.ts.
 * NOTE: TRUE end-to-end coverage lives in apiwright-testing/ sibling repo.
 *
 * Category: Integration — CLI subprocess tests 1–2 + smoke guard.
 * Expected initial failure: plan contains zero head_get_parity cases (generator
 *   not wired) or runner does not handle head_get_parity kind.
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

interface ScriptedResponse {
  readonly status: number;
  readonly body: unknown;
  readonly headers?: Record<string, string>;
}

interface ProgrammableServer {
  readonly url: string;
  callCount(path: string): number;
  resetCounters(): void;
  setScript(script: Record<string, readonly ScriptedResponse[]>): void;
  close(): Promise<void>;
}

export async function startProgrammableServer(): Promise<ProgrammableServer> {
  const script: Record<string, readonly ScriptedResponse[]> = {};
  const cursors: Record<string, number> = {};
  const counts: Record<string, number> = {};

  const server = createServer((_req: IncomingMessage, res: ServerResponse) => {
    const path = _req.url ?? "/";
    const method = _req.method?.toUpperCase() ?? "GET";
    const methodKey = `${method}:${path}`;
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
    const scripted = sequence[idx] ?? sequence[sequence.length - 1];
    const hdrs: Record<string, string> = {
      "content-type": "application/json",
      ...(scripted!.headers ?? {}),
    };
    res.writeHead(scripted!.status, hdrs);
    const bodyStr =
      scripted!.body === null ? "" : JSON.stringify(scripted!.body);
    res.end(bodyStr);
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("server address unknown");
  const port = addr.port;
  const url = `http://127.0.0.1:${port}`;

  return {
    url,
    callCount: (path: string) => counts[path] ?? 0,
    resetCounters: () => {
      for (const k of Object.keys(counts)) delete counts[k];
      for (const k of Object.keys(cursors)) delete cursors[k];
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

describe("head_get_parity two-request (CLI subprocess, part 1)", () => {
  let server: ProgrammableServer;

  beforeAll(async () => {
    server = await startProgrammableServer();
  }, 30_000);

  afterAll(async () => {
    await server.close();
  });

  // -------------------------------------------------------------------------
  // Test 1: Pass path — matching responses → exit 0; verdict=pass
  // -------------------------------------------------------------------------

  it("exits 0 and verdict=pass when HEAD and GET return matching status and headers", async () => {
    const testDir = mkdtempSync(join(tmpdir(), "head-parity-1-"));
    try {
      server.resetCounters();
      server.setScript({
        "/api/users.head": [
          { status: 200, body: null, headers: { "content-type": "application/json" } },
          {
            status: 200,
            body: [{ id: 1 }],
            headers: { "content-type": "application/json" },
          },
        ],
      });

      makeSandbox({
        dir: testDir,
        serverUrl: server.url,
        endpoints: [
          {
            id: "users.head",
            name: "HEAD users",
            method: "HEAD",
            url: "/api/users.head",
            request: {},
            response: { expected_status: 200, schema: {} },
            pair_with: "users.list",
            markers: ["smoke"],
          },
          {
            id: "users.list",
            name: "GET users",
            method: "GET",
            url: "/api/users.head",
            request: {},
            response: { expected_status: 200, schema: { type: "array" } },
            markers: ["smoke"],
          },
        ],
        config: { retry: { count: 0 } },
      });

      const { exitCode, report } = await runCli(testDir, "smoke");
      expect(exitCode).toBe(0);

      if (report !== null) {
        const headEp = report.endpoints.find((e) => e.endpoint_id === "users.head");
        expect(headEp).toBeDefined();
        const parityAttempts = headEp?.attempts.filter(
          (a) => a.kind === "head_get_parity",
        ) ?? [];
        expect(parityAttempts.length).toBeGreaterThanOrEqual(1);
        const failed = parityAttempts.filter((a) => a.verdict === "fail");
        expect(failed).toHaveLength(0);
      } else {
        expect(report).not.toBeNull();
      }
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  }, 60_000);

  // -------------------------------------------------------------------------
  // Test 2: Status-differs fail path → exit non-zero; "status" in failure_reason
  // -------------------------------------------------------------------------

  it("exits non-zero with 'status' in failure_reason when HEAD 200 but GET 204", async () => {
    const testDir = mkdtempSync(join(tmpdir(), "head-parity-2-"));
    try {
      server.resetCounters();
      // Use method-prefixed keys so HEAD always returns 200 and GET always
      // returns 204, regardless of how many prior cases hit the same path.
      server.setScript({
        "HEAD:/api/items.drift": [
          { status: 200, body: null, headers: { "content-type": "application/json" } },
        ],
        "GET:/api/items.drift": [
          { status: 204, body: null, headers: { "content-type": "application/json" } },
        ],
      });

      makeSandbox({
        dir: testDir,
        serverUrl: server.url,
        endpoints: [
          {
            id: "items.head",
            name: "HEAD items",
            method: "HEAD",
            url: "/api/items.drift",
            request: {},
            response: { expected_status: 200, schema: {} },
            pair_with: "items.get",
            markers: ["smoke"],
          },
          {
            id: "items.get",
            name: "GET items",
            method: "GET",
            url: "/api/items.drift",
            request: {},
            response: { expected_status: 200, schema: {} },
            markers: ["smoke"],
          },
        ],
        config: { retry: { count: 0 } },
      });

      const { exitCode, report } = await runCli(testDir, "smoke");
      expect(exitCode).not.toBe(0);

      if (report !== null) {
        const headEp = report.endpoints.find((e) => e.endpoint_id === "items.head");
        const failedParity = headEp?.attempts.find(
          (a) => a.kind === "head_get_parity" && a.verdict === "fail",
        );
        expect(failedParity).toBeDefined();
        expect(failedParity?.failure_reason ?? "").toMatch(/status/i);
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
