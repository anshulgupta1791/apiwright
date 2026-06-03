/**
 * Integration (CLI subprocess) tests for head_get_parity two-request flow — part 2.
 *
 * Covers CLI subprocess tests 3–4: first-gate failure (HEAD 503 → no GET issued)
 * and broken pair (pair_with: "nonexistent" → run completes normally without
 * head_get_parity in report, warning included).
 *
 * Pins the following design decisions (v1.0.2-pr3-head-get-parity.md):
 *   DD-5  Resolver drops head_get_parity case before runner; no case in report
 *         when pair_with is unresolvable; warning crosses runner boundary.
 *   DD-7  First-response gate (idempotencyFirstResponseGate): HEAD must be 2xx
 *         before the runner issues the GET. HEAD 503 → no second request.
 *
 * Part 1 (pass path + status-differs) lives in head-get-parity-two-request.test.ts.
 * NOTE: TRUE end-to-end coverage lives in apiwright-testing/ sibling repo.
 *
 * Category: Integration — CLI subprocess tests 3–4.
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
} from "./skip-cases-helpers.js";

// ---------------------------------------------------------------------------
// Programmable stub server (duplicate of part 1 to keep files self-contained)
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

async function startProgrammableServer(): Promise<ProgrammableServer> {
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
  const url = `http://127.0.0.1:${(addr as { port: number }).port}`;

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

describe("head_get_parity two-request (CLI subprocess, part 2)", () => {
  let server: ProgrammableServer;

  beforeAll(async () => {
    server = await startProgrammableServer();
  }, 30_000);

  afterAll(async () => {
    await server.close();
  });

  // -------------------------------------------------------------------------
  // Test 3: HEAD first-gate failure (HEAD 503) → no GET issued
  // -------------------------------------------------------------------------

  it("does not issue GET when HEAD returns 503; second_request is absent in report", async () => {
    const testDir = mkdtempSync(join(tmpdir(), "head-parity-3-"));
    try {
      server.resetCounters();
      server.setScript({
        "HEAD:/api/orders.gate": [
          { status: 503, body: null },
        ],
        "GET:/api/orders.gate": [
          { status: 200, body: { id: 1 } },
        ],
        "/api/orders.gate": [
          { status: 200, body: { id: 1 } },
        ],
      });

      makeSandbox({
        dir: testDir,
        serverUrl: server.url,
        endpoints: [
          {
            id: "orders.head",
            name: "HEAD orders",
            method: "HEAD",
            url: "/api/orders.gate",
            request: {},
            response: { expected_status: 200, schema: {} },
            pair_with: "orders.get",
            markers: ["smoke"],
            skip_cases: [
              "status_code_conformance",
              "content_type_alignment",
              "response_time_sla",
            ],
          },
          {
            id: "orders.get",
            name: "GET orders",
            method: "GET",
            url: "/api/orders.gate",
            request: {},
            response: { expected_status: 200, schema: {} },
            markers: ["smoke"],
          },
        ],
        config: { retry: { count: 0 } },
      });

      const { report } = await runCli(testDir, "smoke");

      if (report !== null) {
        const headEp = report.endpoints.find((e) => e.endpoint_id === "orders.head");
        const parityAttempts = headEp?.attempts.filter(
          (a) => a.kind === "head_get_parity",
        ) ?? [];
        const failed = parityAttempts.find((a) => a.verdict === "fail");
        expect(failed).toBeDefined();
        // Gate fired — second_request must be absent for the failed parity attempt
        for (const attempt of parityAttempts) {
          if (attempt.verdict === "fail") {
            expect(attempt.second_request).toBeUndefined();
          }
        }
      } else {
        expect(report).not.toBeNull();
      }
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  }, 60_000);

  // -------------------------------------------------------------------------
  // Test 4: Broken pair (pair_with nonexistent) → no head_get_parity in report;
  //         run completes normally; warning present
  // -------------------------------------------------------------------------

  it("run completes normally without head_get_parity when pair_with is unresolvable", async () => {
    const testDir = mkdtempSync(join(tmpdir(), "head-parity-4-"));
    try {
      server.resetCounters();
      server.setScript({
        "/api/products.broken": [
          { status: 200, body: null, headers: { "content-type": "application/json" } },
        ],
      });

      makeSandbox({
        dir: testDir,
        serverUrl: server.url,
        endpoints: [
          {
            id: "products.head",
            name: "HEAD products",
            method: "HEAD",
            url: "/api/products.broken",
            request: {},
            response: { expected_status: 200, schema: {} },
            pair_with: "nonexistent.get",
            markers: ["smoke"],
          },
        ],
        config: { retry: { count: 0 } },
      });

      const { report } = await runCli(testDir, "smoke");

      if (report !== null) {
        const headEp = report.endpoints.find((e) => e.endpoint_id === "products.head");
        const parityAttempts = headEp?.attempts.filter(
          (a) => a.kind === "head_get_parity",
        ) ?? [];
        // Resolver dropped the case — no parity attempt in report
        expect(parityAttempts).toHaveLength(0);

        // Warning about the unresolvable pair must appear in report.warnings
        const warnings = report.warnings ?? [];
        const hasDropWarning = warnings.some(
          (w) => w.includes("nonexistent.get") || w.includes("products.head"),
        );
        expect(hasDropWarning).toBe(true);
      } else {
        expect(report).not.toBeNull();
      }
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  }, 60_000);
});
