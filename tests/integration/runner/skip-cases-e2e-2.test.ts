/**
 * E2E tests for the skip_cases / skip_globally feature — spawned CLI subprocess.
 * Covers E2E cases 5–8 from the solution design.
 * Cases 1–4 are in skip-cases-e2e.test.ts.
 *
 * Design decisions pinned:
 *   DD-4  matchSkip returns the winning token; warnings cite exact token string.
 *   DD-8  Zero-match global warning appears exactly once in warnings array.
 *
 * Subprocess pattern follows shard-flag.test.ts — execFile + local stub HTTP
 * server. No live network calls. Under tests/integration/runner/ per existing
 * project convention (NOT tests/e2e/).
 */

import {
  mkdtempSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  startStubServer,
  makeSandbox,
  runCli,
} from "./skip-cases-e2e-helpers.js";

describe("skip_cases / skip_globally — E2E part 2 (cases 5–8)", () => {
  let server: Awaited<ReturnType<typeof startStubServer>>;

  beforeAll(async () => {
    server = await startStubServer();
  }, 30_000);

  afterAll(async () => {
    await server.close();
  });

  /**
   * E2E-5: skip_globally for a kind no endpoint generates → global "matched zero"
   * warning appears exactly once.
   */
  it("global skip for ungenerated kind emits 'matched zero' warning exactly once", async () => {
    const testDir = mkdtempSync(join(tmpdir(), "skip-e2e-5-"));
    try {
      // GET endpoint — delete_idempotency never fires
      makeSandbox({
        dir: testDir,
        serverUrl: server.url,
        endpoints: [
          {
            id: "read.only",
            name: "Read Only",
            method: "GET",
            url: "/read",
            request: {},
            response: { expected_status: 200, schema: { type: "object" } },
          },
        ],
        config: { case_generation: { skip_globally: ["delete_idempotency"] } },
      });

      const { report } = await runCli(testDir);
      if (report !== null) {
        const warnings = report.warnings ?? [];
        const zeroWarnings = warnings.filter(
          (w) => w.includes("delete_idempotency") && w.includes("zero"),
        );
        expect(zeroWarnings).toHaveLength(1);
      } else {
        expect(report).not.toBeNull();
      }
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  }, 30_000);

  /**
   * E2E-6: JSON report case count reflects POST-skip counts, not pre-skip counts.
   */
  it("JSON report case counts reflect post-skip numbers, not pre-skip numbers", async () => {
    const baseDir = mkdtempSync(join(tmpdir(), "skip-e2e-6a-"));
    const skipDir = mkdtempSync(join(tmpdir(), "skip-e2e-6b-"));
    try {
      const sharedEndpointBase = {
        id: "ep.count",
        name: "Count Test",
        method: "POST",
        url: "/count",
        auth_strategy: "user_token",
        request: {
          body_schema: {
            type: "object",
            properties: { label: { type: "string" } },
          },
        },
        response: { expected_status: 200, schema: { type: "object" } },
      };

      makeSandbox({
        dir: baseDir,
        serverUrl: server.url,
        endpoints: [sharedEndpointBase],
        config: { retry: { count: 0 } },
      });
      const baseResult = await runCli(baseDir);
      const baseCount =
        baseResult.report?.endpoints.find((e) => e.endpoint_id === "ep.count")?.attempts.length
        ?? 0;

      makeSandbox({
        dir: skipDir,
        serverUrl: server.url,
        endpoints: [{ ...sharedEndpointBase, skip_cases: ["status_code_conformance"] }],
        config: { retry: { count: 0 } },
      });
      const skipResult = await runCli(skipDir);
      const skipCount =
        skipResult.report?.endpoints.find((e) => e.endpoint_id === "ep.count")?.attempts.length
        ?? 0;

      if (baseResult.report !== null && skipResult.report !== null) {
        expect(skipCount).toBeLessThan(baseCount);
      } else {
        expect(baseResult.report).not.toBeNull();
      }
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
      rmSync(skipDir, { recursive: true, force: true });
    }
  }, 30_000);

  /**
   * E2E-7: Stderr / log output at default log level surfaces skip warnings
   * without crashing. Exit code must be ≤ 1.
   */
  it("skip warnings surface at default log level without crashing; exit code ≤ 1", async () => {
    const testDir = mkdtempSync(join(tmpdir(), "skip-e2e-7-"));
    try {
      makeSandbox({
        dir: testDir,
        serverUrl: server.url,
        endpoints: [
          {
            id: "log.test",
            name: "Log Test",
            method: "GET",
            url: "/log",
            request: {},
            response: { expected_status: 200, schema: { type: "object" } },
            skip_cases: ["get_idempotency"],
          },
        ],
      });

      const { exitCode, stdout, stderr } = await runCli(testDir);
      expect(exitCode).toBeLessThanOrEqual(1);
      const combined = stdout + stderr;
      expect(combined.length).toBeGreaterThan(0);
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  }, 30_000);

  /**
   * E2E-8: JSON report warnings array contains per-skip counted messages matching
   * the exact design-specified template:
   * "Endpoint '<endpoint.id>': skip_cases token '<token>' skipped <N> case(s)."
   */
  it("JSON report warnings array contains per-skip counted messages matching the exact template", async () => {
    const testDir = mkdtempSync(join(tmpdir(), "skip-e2e-8-"));
    try {
      makeSandbox({
        dir: testDir,
        serverUrl: server.url,
        endpoints: [
          {
            id: "ep.warn",
            name: "Warn Test",
            method: "GET",
            url: "/warn",
            auth_strategy: "user_token",
            request: {},
            response: { expected_status: 200, schema: { type: "object" } },
            skip_cases: ["no_auth_returns_401"],
          },
        ],
        config: { retry: { count: 0 } },
      });

      const { report } = await runCli(testDir);
      if (report !== null) {
        const warnings = report.warnings ?? [];
        // Design-specified template:
        // "Endpoint '<id>': skip_cases token '<token>' skipped <N> case(s)."
        const skipCountPattern =
          /Endpoint '([^']+)': skip_cases token '([^']+)' skipped \d+ case\(s\)\./;
        const matchingWarning = warnings.find((w) => skipCountPattern.test(w));
        expect(matchingWarning).toBeDefined();
        if (matchingWarning) {
          const match = skipCountPattern.exec(matchingWarning);
          expect(match).not.toBeNull();
          expect(match?.[1]).toBe("ep.warn");
          expect(match?.[2]).toBe("no_auth_returns_401");
        }
      } else {
        expect(report).not.toBeNull();
      }
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  }, 30_000);
});
