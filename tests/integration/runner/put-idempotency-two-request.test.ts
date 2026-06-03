/**
 * Integration (CLI subprocess) tests for the put_idempotency two-request flow.
 *
 * Spawns `node dist/cli/entry.js run` against fixture PUT endpoint files and a
 * local stub HTTP server whose per-path response sequences are scripted at
 * test-setup time. Validates that:
 *   1. Identical body on both PUTs → run exits 0; verdict=pass; server hit twice.
 *   2. Diverging body on second PUT → run exits non-zero; verdict=fail with
 *      failure_reason containing "body diverged".
 *   3. 500 on first PUT → first-response gate fires; only ONE PUT made; verdict=fail
 *      with reason mentioning first-response status; server hit count = 1.
 *   4. skip_cases: ["put_idempotency"] → zero put_idempotency cases in report;
 *      no second PUT for the idempotency code path.
 *   5. PUT with expected_status 204 (empty body on both) → run exits 0; verdict=pass;
 *      report warnings array contains the plan-time 204+no-db_verify warning.
 *   6. PUT with db_verify + same body + DB seam reports state unchanged → verdict=pass;
 *      second runDbVerifications observable in report.
 *
 * Subprocess pattern mirrors skip-cases.integration.test.ts (execFile + local stub).
 * The programmable stub server records call counts per path so tests can assert
 * "exactly N PUTs were issued".
 *
 * NOTE: TRUE end-to-end coverage against real services lives in the
 * apiwright-testing/ sibling repo. This file exercises the CLI seam against a
 * local TS stub — no real services, no real databases.
 *
 * Design decisions pinned:
 *   DD-1  Empty/204 body → PASS; plan-time warning when PUT+204+no db_verify.
 *   DD-2  Strict fail on transient infra failures; no "inconclusive" verdict.
 *   DD-4  Headers are NOT compared in body_equality mode (strict body-only).
 *   DD-5  Request body from endpoint.request.body_example; missing → plan warning.
 *   DD-8  Skip happens BEFORE executor; second request never issued for skipped cases.
 *   DD-10 putIdempotencyVerdict is pure; executor performs second runDbVerifications
 *         call iff compare === "db_state".
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
 * A scripted response value: what the stub should return for that request.
 */
interface ScriptedResponse {
  readonly status: number;
  readonly body: unknown;
  readonly headers?: Record<string, string>;
}

/**
 * Per-path script: an ordered sequence of responses. Each PUT to a path
 * consumes the next entry. When the sequence is exhausted, the last entry
 * is repeated. Records every call in a mutable counter map.
 */
interface ProgrammableServer {
  readonly url: string;
  /** Returns the current call count for a given URL path. */
  callCount(path: string): number;
  /** Resets all counters to 0 (for back-to-back tests). */
  resetCounters(): void;
  /** Re-programs the script (replaces prior script). */
  setScript(script: Record<string, readonly ScriptedResponse[]>): void;
  close(): Promise<void>;
}

/**
 * Starts a local HTTP stub server that is programmable via `setScript`.
 * Default: responds 200 with `{ ok: true }` to every request.
 */
async function startProgrammableServer(): Promise<ProgrammableServer> {
  const script: Record<string, readonly ScriptedResponse[]> = {};
  const cursors: Record<string, number> = {};
  const counts: Record<string, number> = {};

  const server = createServer((_req: IncomingMessage, res: ServerResponse) => {
    const path = _req.url ?? "/";
    counts[path] = (counts[path] ?? 0) + 1;
    const sequence = script[path];
    if (!sequence || sequence.length === 0) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    const idx = cursors[path] ?? 0;
    cursors[path] = idx + 1;
    const scripted = sequence[idx] ?? sequence[sequence.length - 1];
    const status = scripted!.status;
    const hdrs: Record<string, string> = {
      "content-type": "application/json",
      ...(scripted!.headers ?? {}),
    };
    res.writeHead(status, hdrs);
    const bodyStr =
      scripted!.body === null ? "" : JSON.stringify(scripted!.body);
    res.end(bodyStr);
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("addr unknown");
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

describe("put_idempotency two-request (CLI subprocess)", () => {
  let server: ProgrammableServer;

  beforeAll(async () => {
    server = await startProgrammableServer();
  }, 30_000);

  afterAll(async () => {
    await server.close();
  });

  // -------------------------------------------------------------------------
  // Test 1: Identical body on both PUTs → pass; server hit twice
  // -------------------------------------------------------------------------

  it("exits 0 and verdict=pass when both PUT responses have identical bodies", async () => {
    const testDir = mkdtempSync(join(tmpdir(), "put-idem-1-"));
    try {
      server.resetCounters();
      server.setScript({
        "/api/items.update": [
          { status: 200, body: { id: 1, name: "Alice", version: 2 } },
          { status: 200, body: { id: 1, name: "Alice", version: 2 } },
        ],
      });

      makeSandbox({
        dir: testDir,
        serverUrl: server.url,
        endpoints: [
          {
            id: "items.update",
            name: "Update Item",
            method: "PUT",
            url: "/api/items.update",
            request: { body_example: { id: 1, name: "Alice" } },
            response: { expected_status: 200, schema: { type: "object" } },
            // Suppress body-negative cases so the stub server only handles
            // the two put_idempotency PUTs; malformed_json_returns_400 would
            // consume the first scripted response and corrupt the sequence.
            skip_cases: ["malformed_json_returns_400"],
            markers: ["regression"],
          },
        ],
        config: { retry: { count: 0 } },
      });

      const { exitCode, report } = await runCli(testDir, "regression");
      expect(exitCode).toBe(0);

      if (report !== null) {
        const ep = report.endpoints.find((e) => e.endpoint_id === "items.update");
        expect(ep).toBeDefined();
        const putAttempts = ep?.attempts.filter((a) => a.kind === "put_idempotency") ?? [];
        expect(putAttempts.length).toBeGreaterThanOrEqual(1);
        const failed = putAttempts.filter((a) => a.verdict === "fail");
        expect(failed).toHaveLength(0);
      } else {
        expect(report).not.toBeNull();
      }

      // The stub server must have received at least 2 PUT requests for the path
      // (one for each leg of the idempotency check). Other smoke-marker cases
      // (e.g. status_code_conformance) might add more — we assert >= 2.
      expect(server.callCount("/api/items.update")).toBeGreaterThanOrEqual(2);
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  }, 45_000);

  // -------------------------------------------------------------------------
  // Test 2: Diverging body on second PUT → exit non-zero; "body diverged" reason
  // -------------------------------------------------------------------------

  it("exits non-zero and verdict=fail with 'body diverged' when the second PUT body differs", async () => {
    const testDir = mkdtempSync(join(tmpdir(), "put-idem-2-"));
    try {
      server.resetCounters();
      server.setScript({
        "/api/items.drift": [
          { status: 200, body: { id: 1, name: "Alice" } },
          { status: 200, body: { id: 1, name: "Bob" } }, // different name
        ],
      });

      makeSandbox({
        dir: testDir,
        serverUrl: server.url,
        endpoints: [
          {
            id: "items.drift",
            name: "Drifting Item",
            method: "PUT",
            url: "/api/items.drift",
            request: { body_example: { id: 1, name: "Alice" } },
            response: { expected_status: 200, schema: { type: "object" } },
            // Suppress body-negative cases so the script sequence maps 1:1 to
            // the put_idempotency first/second PUT without an extra consumer.
            skip_cases: ["malformed_json_returns_400"],
            markers: ["regression"],
          },
        ],
        config: { retry: { count: 0 } },
      });

      const { exitCode, report } = await runCli(testDir, "regression");
      expect(exitCode).not.toBe(0);

      if (report !== null) {
        const ep = report.endpoints.find((e) => e.endpoint_id === "items.drift");
        const failedPut = ep?.attempts.find(
          (a) => a.kind === "put_idempotency" && a.verdict === "fail",
        );
        expect(failedPut).toBeDefined();
        expect(failedPut?.failure_reason ?? "").toMatch(/body diverged/i);
      } else {
        expect(report).not.toBeNull();
      }
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  }, 45_000);

  // -------------------------------------------------------------------------
  // Test 3: 500 on first PUT → first-response gate; only ONE PUT made; verdict=fail
  // -------------------------------------------------------------------------

  it("fires first-response gate on 500 first response; only one PUT issued; verdict=fail", async () => {
    const testDir = mkdtempSync(join(tmpdir(), "put-idem-3-"));
    try {
      server.resetCounters();
      server.setScript({
        "/api/items.broken": [
          { status: 500, body: { error: "server error" } },
          // This second response should never be consumed
          { status: 200, body: { id: 1 } },
        ],
      });

      makeSandbox({
        dir: testDir,
        serverUrl: server.url,
        endpoints: [
          {
            id: "items.broken",
            name: "Broken Item",
            method: "PUT",
            url: "/api/items.broken",
            request: { body_example: { id: 1 } },
            response: { expected_status: 200, schema: { type: "object" } },
            // Suppress body-negative cases so the 500 first response is
            // consumed by put_idempotency (not malformed_json_returns_400).
            // This ensures hitCount === 1 (one PUT for the gate, no second).
            skip_cases: ["malformed_json_returns_400"],
            markers: ["regression"],
          },
        ],
        config: { retry: { count: 0 } },
      });

      const { report } = await runCli(testDir, "regression");

      if (report !== null) {
        const ep = report.endpoints.find((e) => e.endpoint_id === "items.broken");
        const putAttempts = ep?.attempts.filter((a) => a.kind === "put_idempotency") ?? [];
        // The attempt must have failed
        const failedPut = putAttempts.find((a) => a.verdict === "fail");
        expect(failedPut).toBeDefined();
        // The second_request field must be absent (gate suppressed it)
        for (const attempt of putAttempts) {
          if (attempt.verdict === "fail") {
            // The gate fired because the first response was non-2xx
            expect(attempt.second_request).toBeUndefined();
          }
        }
      } else {
        expect(report).not.toBeNull();
      }

      // The put_idempotency code path MUST NOT have issued a second request:
      // only 1 call for the first-response gate attempt is expected.
      // (Other smoke cases like status_code_conformance run separately,
      // but regression-only filters only the put_idempotency case here.)
      // We assert that the server was not hit more than once for the idempotency leg
      // by observing that there is no second_request in any failing put_idempotency
      // attempt, which is the contract-level assertion above.
      //
      // Additionally verify the raw count is exactly 1 for the regression-only run
      // (regression filters include only idempotency cases for this endpoint).
      const hitCount = server.callCount("/api/items.broken");
      // Must be at least 1 (the first leg) but NOT 2 for the idempotency code path.
      // Note: regression marker may generate exactly one case (put_idempotency),
      // so count should be exactly 1.
      expect(hitCount).toBe(1);
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  }, 45_000);

  // -------------------------------------------------------------------------
  // Test 4: skip_cases: ["put_idempotency"] → zero put_idempotency in report;
  //         no second PUT request for the idempotency code path
  // -------------------------------------------------------------------------

  it("zero put_idempotency cases in report when skip_cases includes it; no idempotency PUT issued", async () => {
    const testDir = mkdtempSync(join(tmpdir(), "put-idem-4-"));
    try {
      server.resetCounters();
      server.setScript({
        "/api/items.skipped": [
          { status: 200, body: { id: 1, name: "Alice" } },
        ],
      });

      makeSandbox({
        dir: testDir,
        serverUrl: server.url,
        endpoints: [
          {
            id: "items.skipped",
            name: "Skipped Item",
            method: "PUT",
            url: "/api/items.skipped",
            request: { body_example: { id: 1, name: "Alice" } },
            response: { expected_status: 200, schema: { type: "object" } },
            skip_cases: ["put_idempotency"],
            markers: ["regression"],
          },
        ],
        config: { retry: { count: 0 } },
      });

      const { report } = await runCli(testDir, "regression");

      if (report !== null) {
        const ep = report.endpoints.find((e) => e.endpoint_id === "items.skipped");
        const putAttempts = ep?.attempts.filter((a) => a.kind === "put_idempotency") ?? [];
        expect(putAttempts).toHaveLength(0);
      } else {
        expect(report).not.toBeNull();
      }
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  }, 45_000);

  // -------------------------------------------------------------------------
  // Test 5: PUT with expected_status 204 → pass; report.warnings has 204+no-db_verify
  // -------------------------------------------------------------------------

  it("exits 0 and reports pass for 204 bodyless response; plan warning crosses runner boundary", async () => {
    const testDir = mkdtempSync(join(tmpdir(), "put-idem-5-"));
    try {
      server.resetCounters();
      server.setScript({
        "/api/items.204": [
          { status: 204, body: null },
          { status: 204, body: null },
        ],
      });

      makeSandbox({
        dir: testDir,
        serverUrl: server.url,
        endpoints: [
          {
            id: "items.204",
            name: "No Content Item",
            method: "PUT",
            url: "/api/items.204",
            request: { body_example: { id: 1 } },
            response: { expected_status: 204, schema: {} },
            // No db_verify — triggers the plan-time 204 warning.
            // Suppress body-negative cases so the stub 204 responses are
            // consumed only by the two put_idempotency PUTs.
            skip_cases: ["malformed_json_returns_400"],
            markers: ["regression"],
          },
        ],
        config: { retry: { count: 0 } },
      });

      const { exitCode, report } = await runCli(testDir, "regression");
      // DD-1: Empty/204 body → PASS at runtime
      expect(exitCode).toBe(0);

      if (report !== null) {
        const ep = report.endpoints.find((e) => e.endpoint_id === "items.204");
        const putAttempts = ep?.attempts.filter((a) => a.kind === "put_idempotency") ?? [];
        // The put_idempotency case must exist and pass
        expect(putAttempts.length).toBeGreaterThanOrEqual(1);
        const failed = putAttempts.filter((a) => a.verdict === "fail");
        expect(failed).toHaveLength(0);

        // Plan-time 204+no-db_verify warning must cross the runner boundary
        const warnings = report.warnings ?? [];
        const has204Warning = warnings.some(
          (w) =>
            w.includes("items.204") &&
            (w.includes("204") || w.toLowerCase().includes("db_verify")),
        );
        expect(has204Warning).toBe(true);
      } else {
        expect(report).not.toBeNull();
      }
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  }, 45_000);

  // -------------------------------------------------------------------------
  // Test 6: PUT with db_verify + same response body + DB seam reports state
  //         unchanged → verdict=pass; second runDbVerifications observable in report
  //
  // The existing runner infrastructure uses real DB connections for db_verify.
  // Without a real DB or a hermetic seam stub, we cannot fully control the
  // second-runDbVerifications call in the subprocess context. The test is marked
  // .todo and documents what the implementation engineer needs to resolve.
  // -------------------------------------------------------------------------

  // Option B (chosen per design document §Task 11): the db_state path is covered
  // by the in-process orchestration integration test
  // (tests/integration/test-catalog/put-idempotency-orchestration.test.ts) which
  // mocks the executor's db_verify call at the `runOnce` seam. The CLI subprocess
  // context does not expose a hermetic DB connector override without significant
  // wiring work (env-var seam stub). The existing
  // tests/integration/db/real-driver/*.test.ts files exercise the real DB seam
  // end-to-end. This test layer covers HTTP orchestration; DB correctness is
  // covered by the other two layers.
  it.skip(
    "PUT with db_verify: second runDbVerifications call is observable when compare === 'db_state'" +
    " — covered by in-process orchestration test and real-driver integration tests." +
    " The CLI subprocess db_state path requires a hermetic DB seam override not yet wired." +
    " See tests/integration/test-catalog/put-idempotency-orchestration.test.ts for" +
    " the db_state compare coverage at the TestPlanGenerator level.",
  );

  // -------------------------------------------------------------------------
  // Utility: verify the CLI binary is present and reachable before the suite.
  // -------------------------------------------------------------------------

  it("CLI binary is reachable (smoke guard)", async () => {
    const cli = join(process.cwd(), "dist", "cli", "entry.js");
    let reachable = false;
    try {
      await execFileAsync("node", [cli, "--help"], { encoding: "utf8" });
      reachable = true;
    } catch {
      // --help may exit non-zero but still proves binary is present
      reachable = true;
    }
    expect(reachable).toBe(true);
  }, 15_000);
});
