/**
 * CLI subprocess integration tests for response_variants.
 *
 * Spawns `node dist/cli/entry.js validate` and `node dist/cli/entry.js run`
 * against a fixture sandbox containing endpoints with response_variants.
 * Uses a local programmable stub HTTP server.
 *
 * Covers §6.10 items 81-84:
 *   81. `apiwright validate` on a fixture with malformed response_variants → exit non-zero.
 *   82. `apiwright validate` on a fixture with valid response_variants → exit zero.
 *   83. `apiwright run --markers smoke` with response_variants["500"] declared + stub
 *       returning 500 with matching body → exit non-zero; report contains enriched
 *       reason A template exactly.
 *   84. Same scenario but stub returns 500 with mismatched body → report contains
 *       enriched reason B + AJV detail tail.
 *
 * The stub server pattern mirrors cors-preflight-cli.test.ts.
 *
 * Design decisions pinned:
 *   DD-1  Scope A — no new generated kind.
 *   DD-6  Variant match → fail with enriched reason; overall verdict still fail.
 *   DD-9  `apiwright validate` catches malformed response_variants at load time.
 *
 * Category: Integration (CLI subprocess — real compiled binary).
 * Expected initial failure: response_variants meta-schema block absent from
 *   ENDPOINT_META_SCHEMA; variant-enrichment.ts does not exist; computeVerdict
 *   does not thread variants to statusEqDispatch.
 */

import {
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { makeSandbox, runCli } from "../runner/skip-cases-helpers.js";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Programmable stub server
// ---------------------------------------------------------------------------

interface ScriptedVariantResponse {
  status: number;
  body: unknown;
}

interface VariantStubServer {
  readonly url: string;
  setResponse(resp: ScriptedVariantResponse): void;
  close(): Promise<void>;
}

async function startVariantStubServer(): Promise<VariantStubServer> {
  let scripted: ScriptedVariantResponse = {
    status: 201,
    body: { id: "new-resource" },
  };

  const server = createServer((_req: IncomingMessage, res: ServerResponse) => {
    res.writeHead(scripted.status, { "content-type": "application/json" });
    res.end(JSON.stringify(scripted.body));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("addr unknown");
  const port = addr.port;

  return {
    url: `http://127.0.0.1:${port}`,
    setResponse(resp: ScriptedVariantResponse) {
      scripted = resp;
    },
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      ),
  };
}

// ---------------------------------------------------------------------------
// CLI helpers
// ---------------------------------------------------------------------------

const CLI = join(process.cwd(), "dist", "cli", "entry.js");

async function runValidateCli(dir: string): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
}> {
  let stdout = "";
  let stderr = "";
  let exitCode = 0;
  try {
    const result = await execFileAsync(
      "node",
      [CLI, "validate", dir],
      { cwd: dir, encoding: "utf8" },
    );
    stdout = result.stdout;
    stderr = result.stderr;
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; code?: number };
    stdout = e.stdout ?? "";
    stderr = e.stderr ?? "";
    exitCode = e.code ?? 1;
  }
  return { stdout, stderr, exitCode };
}

// ---------------------------------------------------------------------------
// Endpoint factories
// ---------------------------------------------------------------------------

function makeValidEndpoint(serverUrl: string): Record<string, unknown> {
  return {
    id: "users.create",
    name: "Create User",
    method: "POST",
    url: `${serverUrl}/api/v1/users`,
    request: {
      body_schema: {
        type: "object",
        required: ["name"],
        properties: { name: { type: "string" } },
      },
      body_example: { name: "Alice" },
    },
    response: {
      expected_status: 201,
      schema: { type: "object", required: ["id"] },
    },
    response_variants: {
      "400": {
        schema: {
          type: "object",
          required: ["error"],
          properties: { error: { type: "string" } },
        },
      },
      "500": {
        schema: {
          type: "object",
          required: ["error"],
          properties: { error: { type: "string" } },
        },
      },
    },
    markers: ["smoke"],
  };
}

function makeMalformedVariantEndpoint(serverUrl: string): Record<string, unknown> {
  return {
    id: "users.bad",
    name: "Bad variants endpoint",
    method: "POST",
    url: `${serverUrl}/api/v1/users`,
    request: {},
    response: { expected_status: 201 },
    // Invalid: response_variants value must be an object with required "schema"
    response_variants: {
      "400": {},      // missing required "schema"
    },
    markers: ["smoke"],
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("response_variants — CLI subprocess integration", () => {
  let server: VariantStubServer;

  beforeAll(async () => {
    server = await startVariantStubServer();
  }, 30_000);

  afterAll(async () => {
    await server.close();
  });

  /**
   * Item 81: `apiwright validate` on a fixture with malformed response_variants →
   * exit non-zero; output references the invalid field or endpoint.
   */
  it("item 81: apiwright validate exits non-zero when response_variants is malformed", async () => {
    const testDir = mkdtempSync(join(tmpdir(), "rv-cli-81-"));
    try {
      makeSandbox({
        dir: testDir,
        serverUrl: server.url,
        endpoints: [makeMalformedVariantEndpoint(server.url)],
      });

      const { exitCode, stderr, stdout } = await runValidateCli(testDir);
      expect(exitCode).not.toBe(0);
      // Output must mention the endpoint or the problematic field
      const combined = stdout + stderr;
      expect(combined).toMatch(/users\.bad|response_variants|schema|skipped/i);
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  /**
   * Item 82: `apiwright validate` on a fixture with valid response_variants → exit zero.
   */
  it("item 82: apiwright validate exits 0 when response_variants is valid", async () => {
    const testDir = mkdtempSync(join(tmpdir(), "rv-cli-82-"));
    try {
      makeSandbox({
        dir: testDir,
        serverUrl: server.url,
        endpoints: [makeValidEndpoint(server.url)],
      });

      const { exitCode } = await runValidateCli(testDir);
      expect(exitCode).toBe(0);
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  /**
   * Item 83: `apiwright run --markers smoke` with response_variants["500"] declared,
   * stub returns 500 with matching body → exit non-zero (test still fails);
   * JSON report contains exactly enriched reason A.
   */
  it("item 83: run report contains enriched reason A when 500 stub body matches variant schema", async () => {
    const testDir = mkdtempSync(join(tmpdir(), "rv-cli-83-"));
    try {
      // Stub returns 500 with matching body
      server.setResponse({
        status: 500,
        body: { error: "internal_server_error" },
      });

      makeSandbox({
        dir: testDir,
        serverUrl: server.url,
        endpoints: [makeValidEndpoint(server.url)],
        config: { retry: { count: 0 } },
      });

      const { exitCode, report } = await runCli(testDir, "smoke");
      // Exit non-zero because tests fail
      expect(exitCode).not.toBe(0);

      if (report !== null) {
        const ep = report.endpoints.find((e) => e.endpoint_id === "users.create");
        expect(ep).toBeDefined();
        const failedAttempts = ep?.attempts.filter(
          (a) => a.verdict === "fail" && a.kind === "status_code_conformance",
        ) ?? [];
        expect(failedAttempts.length).toBeGreaterThan(0);

        const firstFailed = failedAttempts[0] as { failure_reason?: string };
        expect(firstFailed.failure_reason).toBe(
          "expected status 201, got 500 (response body matched declared variant schema for 500)",
        );
      } else {
        expect(report).not.toBeNull();
      }
    } finally {
      server.setResponse({ status: 201, body: { id: "new-resource" } });
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  /**
   * Item 84: `apiwright run --markers smoke` with response_variants["500"] declared,
   * stub returns 500 with mismatched body → report contains enriched reason B + AJV detail tail.
   */
  it("item 84: run report contains enriched reason B + AJV detail when 500 stub body fails variant schema", async () => {
    const testDir = mkdtempSync(join(tmpdir(), "rv-cli-84-"));
    try {
      // Stub returns 500 with body MISSING required 'error' field
      server.setResponse({
        status: 500,
        body: { message: "missing error field" },
      });

      makeSandbox({
        dir: testDir,
        serverUrl: server.url,
        endpoints: [makeValidEndpoint(server.url)],
        config: { retry: { count: 0 } },
      });

      const { exitCode, report } = await runCli(testDir, "smoke");
      expect(exitCode).not.toBe(0);

      if (report !== null) {
        const ep = report.endpoints.find((e) => e.endpoint_id === "users.create");
        expect(ep).toBeDefined();
        const failedAttempts = ep?.attempts.filter(
          (a) => a.verdict === "fail" && a.kind === "status_code_conformance",
        ) ?? [];
        expect(failedAttempts.length).toBeGreaterThan(0);

        const firstFailed = failedAttempts[0] as { failure_reason?: string };
        expect(firstFailed.failure_reason).toMatch(
          /^expected status 201, got 500 \(response body did not match declared variant schema for 500:/,
        );
        // AJV detail tail must be present (mentions missing 'error' field)
        expect(firstFailed.failure_reason).toMatch(/error|required/i);
      } else {
        expect(report).not.toBeNull();
      }
    } finally {
      server.setResponse({ status: 201, body: { id: "new-resource" } });
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  /**
   * Backward compat: fixture without response_variants runs normally (no crash).
   */
  it("backward compat: fixture without response_variants runs without error", async () => {
    const testDir = mkdtempSync(join(tmpdir(), "rv-cli-bc-"));
    try {
      server.setResponse({ status: 201, body: { id: "abc" } });

      const plainEndpoint: Record<string, unknown> = {
        id: "users.plain",
        name: "Plain endpoint",
        method: "POST",
        url: `${server.url}/api/v1/users`,
        request: {
          body_example: { name: "Alice" },
        },
        response: {
          expected_status: 201,
          schema: { type: "object", required: ["id"] },
        },
        markers: ["smoke"],
      };

      makeSandbox({
        dir: testDir,
        serverUrl: server.url,
        endpoints: [plainEndpoint],
        config: { retry: { count: 0 } },
      });

      // Should not throw or crash; exit code is determined by test results
      await expect(runCli(testDir, "smoke")).resolves.toBeDefined();
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  });
});
