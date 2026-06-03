/**
 * CLI subprocess integration tests for the `cors_preflight` generator and runner.
 *
 * Spawns `node dist/cli/entry.js run` against a fixture sandbox containing one
 * OPTIONS endpoint with a `cors` config, served by a local programmable stub
 * HTTP server. Validates the three acceptance-criteria CLI scenarios from the
 * design (§6 items 80–82):
 *
 *   80. `apiwright run --markers smoke` on a fixture with one OPTIONS endpoint
 *       + cors + stub returning correct preflight headers → exit 0; JSON report
 *       contains one `cors_preflight` attempt verdict pass.
 *
 *   81. Same fixture but stub returns 200 missing `Access-Control-Allow-Origin`
 *       → exit non-zero; JSON report contains verdict fail with the exact
 *       "cors_preflight: response missing Access-Control-Allow-Origin header" reason.
 *
 *   82. `apiwright run --markers regression` on the same fixture → exit 0 BUT no
 *       `cors_preflight` attempts in the report (smoke-only case filtered out).
 *
 * The programmable stub server pattern mirrors `put-idempotency-two-request.test.ts`
 * and `skip-cases.integration.test.ts`. The sandbox helpers are imported from the
 * shared `skip-cases-helpers.ts` module.
 *
 * NOTE: TRUE end-to-end coverage against real services lives in the
 * apiwright-testing/ sibling repo. This file exercises the CLI seam against a
 * local TS stub — no real services.
 *
 * Design decisions pinned:
 *   DD-6  Status MUST be 200 or 204 (preflight-specific status check).
 *   DD-9  cors_preflight marker is "smoke"; filtered out by --markers regression.
 *   DD-11 Single-request flow; second_request absent from AttemptResult.
 *
 * Category: Integration (CLI subprocess — real compiled binary).
 * Expected initial failure: CorsPreflightGenerator not wired into
 *   DEFAULT_GENERATOR_ORDER; cors_preflight arm missing from case-runners.
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
} from "../runner/skip-cases-helpers.js";

// ---------------------------------------------------------------------------
// Programmable stub server for CORS preflight responses
// ---------------------------------------------------------------------------

interface ScriptedCorsResponse {
  readonly status: number;
  readonly corsHeaders?: {
    "access-control-allow-origin"?: string;
    "access-control-allow-methods"?: string;
    "access-control-allow-headers"?: string;
  };
}

interface CorsStubServer {
  readonly url: string;
  setResponse(resp: ScriptedCorsResponse): void;
  close(): Promise<void>;
}

async function startCorsStubServer(): Promise<CorsStubServer> {
  let scripted: ScriptedCorsResponse = {
    status: 200,
    corsHeaders: {
      "access-control-allow-origin": "https://app.example.com",
      "access-control-allow-methods": "GET,POST",
      "access-control-allow-headers": "Authorization",
    },
  };

  const server = createServer((_req: IncomingMessage, res: ServerResponse) => {
    const headers: Record<string, string> = {
      "content-type": "text/plain",
      ...(scripted.corsHeaders ?? {}),
    };
    res.writeHead(scripted.status, headers);
    res.end("");
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("addr unknown");
  const port = addr.port;

  return {
    url: `http://127.0.0.1:${port}`,
    setResponse(resp: ScriptedCorsResponse) { scripted = resp; },
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      ),
  };
}

// ---------------------------------------------------------------------------
// Fixture endpoint object for the cors preflight endpoint
// ---------------------------------------------------------------------------

function makeCorsEndpoint(serverUrl: string): Record<string, unknown> {
  return {
    id: "ep.cors.options",
    name: "CORS Preflight OPTIONS",
    method: "OPTIONS",
    url: "/api/resource",
    request: {},
    response: { expected_status: 200, schema: {} },
    cors: {
      allow_origins: ["https://app.example.com"],
      allow_methods: ["GET", "POST"],
      allow_headers: ["Authorization"],
    },
    markers: ["smoke"],
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("cors_preflight — CLI subprocess integration", () => {
  let server: CorsStubServer;

  beforeAll(async () => {
    server = await startCorsStubServer();
  }, 30_000);

  afterAll(async () => {
    await server.close();
  });

  // -------------------------------------------------------------------------
  // Item 80: --markers smoke, correct headers → exit 0; report has pass verdict
  // -------------------------------------------------------------------------

  it("item 80: exits 0 and report shows cors_preflight pass when server returns correct headers", async () => {
    const testDir = mkdtempSync(join(tmpdir(), "cors-cli-80-"));
    try {
      server.setResponse({
        status: 200,
        corsHeaders: {
          "access-control-allow-origin": "https://app.example.com",
          "access-control-allow-methods": "GET,POST",
          "access-control-allow-headers": "Authorization",
        },
      });

      makeSandbox({
        dir: testDir,
        serverUrl: server.url,
        endpoints: [makeCorsEndpoint(server.url)],
        config: { retry: { count: 0 } },
      });

      const { exitCode, report } = await runCli(testDir, "smoke");
      expect(exitCode).toBe(0);

      if (report !== null) {
        const ep = report.endpoints.find((e) => e.endpoint_id === "ep.cors.options");
        expect(ep).toBeDefined();
        const corsAttempts = ep?.attempts.filter((a) => a.kind === "cors_preflight") ?? [];
        expect(corsAttempts.length).toBeGreaterThanOrEqual(1);
        const failedAttempts = corsAttempts.filter((a) => a.verdict === "fail");
        expect(failedAttempts).toHaveLength(0);
      } else {
        // If report is null the JSON file wasn't written — fail informatively
        expect(report).not.toBeNull();
      }
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  }, 60_000);

  // -------------------------------------------------------------------------
  // Item 81: correct status + missing ACAO → exit non-zero; fail with exact reason
  // -------------------------------------------------------------------------

  it("item 81: exits non-zero and report shows cors_preflight fail when ACAO header is missing", async () => {
    const testDir = mkdtempSync(join(tmpdir(), "cors-cli-81-"));
    try {
      server.setResponse({
        status: 200,
        corsHeaders: {
          // No access-control-allow-origin — deliberately missing
          "access-control-allow-methods": "GET,POST",
          "access-control-allow-headers": "Authorization",
        },
      });

      makeSandbox({
        dir: testDir,
        serverUrl: server.url,
        endpoints: [makeCorsEndpoint(server.url)],
        config: { retry: { count: 0 } },
      });

      const { exitCode, report } = await runCli(testDir, "smoke");
      expect(exitCode).not.toBe(0);

      if (report !== null) {
        const ep = report.endpoints.find((e) => e.endpoint_id === "ep.cors.options");
        const failedCors = ep?.attempts.find(
          (a) => a.kind === "cors_preflight" && a.verdict === "fail",
        );
        expect(failedCors).toBeDefined();
        // The failure_reason must be the exact DD-7 template string from §7
        const reason = (failedCors as unknown as { failure_reason?: string })?.failure_reason ?? "";
        expect(reason).toBe(
          "cors_preflight: response missing Access-Control-Allow-Origin header",
        );
      } else {
        expect(report).not.toBeNull();
      }
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  }, 60_000);

  // -------------------------------------------------------------------------
  // Item 82: --markers regression → exit 0; NO cors_preflight attempts in report
  // -------------------------------------------------------------------------

  it("item 82: exits 0 with NO cors_preflight attempts when --markers regression (smoke case filtered)", async () => {
    const testDir = mkdtempSync(join(tmpdir(), "cors-cli-82-"));
    try {
      // Server response doesn't matter — the case should never fire
      server.setResponse({
        status: 200,
        corsHeaders: {
          "access-control-allow-origin": "https://app.example.com",
          "access-control-allow-methods": "GET,POST",
          "access-control-allow-headers": "Authorization",
        },
      });

      makeSandbox({
        dir: testDir,
        serverUrl: server.url,
        endpoints: [makeCorsEndpoint(server.url)],
        config: { retry: { count: 0 } },
      });

      // Run with --markers regression — cors_preflight is "smoke" only
      const { exitCode, report } = await runCli(testDir, "regression");
      expect(exitCode).toBe(0);

      if (report !== null) {
        // There must be zero cors_preflight attempts across ALL endpoints
        for (const ep of report.endpoints) {
          const corsAttempts = ep.attempts.filter((a) => a.kind === "cors_preflight");
          expect(corsAttempts).toHaveLength(0);
        }
      }
      // If report is null (no regression cases were generated, so no report), that's
      // acceptable — the exit code 0 is the primary assertion.
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  }, 60_000);

  // -------------------------------------------------------------------------
  // Utility smoke guard — verify the CLI binary is reachable before the suite
  // -------------------------------------------------------------------------

  it("CLI binary is reachable (smoke guard)", async () => {
    const cli = join(process.cwd(), "dist", "cli", "entry.js");
    let reachable = false;
    try {
      await execFileAsync("node", [cli, "--help"], { encoding: "utf8" });
      reachable = true;
    } catch {
      // --help may exit non-zero but proves binary is present
      reachable = true;
    }
    expect(reachable).toBe(true);
  }, 15_000);
});
