/**
 * Integration tests for the skip_cases / skip_globally feature.
 * Spawns the compiled CLI binary as a subprocess and asserts on JSON
 * report content and process output, with a local stub HTTP server
 * (no real services). Covers cases 1–4 from the solution design;
 * cases 5–8 are in skip-cases-2.integration.test.ts.
 *
 * NOTE: TRUE end-to-end coverage (against real services like Apicurio,
 * MLflow, Library API) lives in the apiwright-testing/ sibling repo per
 * the project's e2e-out-of-public-repo architecture. This file exercises
 * the CLI seam against a TS stub, not against real services.
 *
 * Design decisions pinned:
 *   DD-1  Malformed tokens warn but never throw (CLI run continues normally).
 *   DD-3  Global skip warning appears once per endpoint in warnings array.
 *   DD-9  Kind matching is case-SENSITIVE.
 *
 * Subprocess pattern follows shard-flag.test.ts — execFile + local stub
 * HTTP server. No live network calls.
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
} from "./skip-cases-helpers.js";

describe("skip_cases / skip_globally — integration part 1 (cases 1–4)", () => {
  let server: Awaited<ReturnType<typeof startStubServer>>;

  beforeAll(async () => {
    server = await startStubServer();
  }, 30_000);

  afterAll(async () => {
    await server.close();
  });

  /**
   * E2E-1: Global skip_globally: ["no_auth_returns_401"] removes that case
   * from all endpoints; warnings array contains the global-skip warning.
   */
  it("global skip_globally removes no_auth_returns_401 from all endpoints; warning present", async () => {
    const testDir = mkdtempSync(join(tmpdir(), "skip-e2e-1-"));
    try {
      makeSandbox({
        dir: testDir,
        serverUrl: server.url,
        endpoints: [
          {
            id: "ep.alpha",
            name: "Alpha",
            method: "GET",
            url: "/alpha",
            auth_strategy: "user_token",
            request: {},
            response: { expected_status: 200, schema: { type: "object" } },
          },
          {
            id: "ep.beta",
            name: "Beta",
            method: "GET",
            url: "/beta",
            auth_strategy: "user_token",
            request: {},
            response: { expected_status: 200, schema: { type: "object" } },
          },
        ],
        config: {
          case_generation: { skip_globally: ["no_auth_returns_401"] },
          retry: { count: 0 },
        },
      });

      const { report } = await runCli(testDir);
      if (report !== null) {
        const allKinds = report.endpoints.flatMap((ep) => ep.attempts.map((a) => a.kind));
        expect(allKinds).not.toContain("no_auth_returns_401");
        const warnings = report.warnings ?? [];
        expect(warnings.some((w) => w.includes("no_auth_returns_401"))).toBe(true);
      } else {
        expect(report).not.toBeNull();
      }
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  }, 30_000);

  /**
   * E2E-2: Endpoint skip_cases: ["boundary_battery:price"] removes only the
   * price boundary cases; other fields' boundary cases survive.
   */
  it("endpoint skip_cases drops boundary_battery:price; other boundary cases survive", async () => {
    const testDir = mkdtempSync(join(tmpdir(), "skip-e2e-2-"));
    try {
      makeSandbox({
        dir: testDir,
        serverUrl: server.url,
        endpoints: [
          {
            id: "products.create",
            name: "Create Product",
            method: "POST",
            url: "/products",
            request: {
              body_schema: {
                type: "object",
                properties: {
                  price: { type: "number", minimum: 0, maximum: 9999 },
                  weight: { type: "number", minimum: 0, maximum: 100 },
                },
              },
            },
            response: { expected_status: 201, schema: { type: "object" } },
            skip_cases: ["boundary_battery:price"],
          },
        ],
      });

      // boundary_battery uses regression marker; pass regression to see boundary attempts.
      const { report } = await runCli(testDir, "regression");
      if (report !== null) {
        const warnings = report.warnings ?? [];
        // Defense-in-depth: pin the COUNTED-SKIP warning specifically, not the
        // dead-weight variant. Both warnings mention "boundary_battery" and
        // "price"; only the counted one matches /skipped \d+ case\(s\)/. If
        // the skip mechanism ever stops actually skipping, the warning would
        // shift to the dead-weight wording and this assertion would fail.
        const skipWarning = warnings.find(
          (w) => w.includes("boundary_battery:price") && w.includes("skipped"),
        );
        expect(skipWarning).toBeDefined();
        expect(skipWarning).toMatch(/skipped [1-9]\d* case\(s\)/);
        const ep = report.endpoints.find((e) => e.endpoint_id === "products.create");
        const boundaryAttempts = ep?.attempts.filter((a) => a.kind === "boundary_battery") ?? [];
        // Boundary cases for the OTHER constrained field (weight) should still
        // run — proves the skip is field-scoped, not kind-wide.
        expect(boundaryAttempts.length).toBeGreaterThan(0);
      } else {
        expect(report).not.toBeNull();
      }
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  }, 30_000);

  /**
   * E2E-3: Malformed token in config → run exits normally (exit ≤ 1);
   * malformed-token warning appears; all cases still generated.
   */
  it("malformed token in config does not crash the run; warning present; exit code ≤ 1", async () => {
    const testDir = mkdtempSync(join(tmpdir(), "skip-e2e-3-"));
    try {
      makeSandbox({
        dir: testDir,
        serverUrl: server.url,
        endpoints: [
          {
            id: "simple.get",
            name: "Simple Get",
            method: "GET",
            url: "/simple",
            request: {},
            response: { expected_status: 200, schema: { type: "object" } },
          },
        ],
        config: { case_generation: { skip_globally: [":foo"] } },
      });

      const { report, exitCode } = await runCli(testDir);
      expect(exitCode).toBeLessThanOrEqual(1);
      if (report !== null) {
        const totalAttempts = report.endpoints.flatMap((ep) => ep.attempts).length;
        expect(totalAttempts).toBeGreaterThan(0);
        const warnings = report.warnings ?? [];
        expect(
          warnings.some((w) => w.includes(":foo") || w.includes("malformed")),
        ).toBe(true);
      } else {
        expect(report).not.toBeNull();
      }
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  }, 30_000);

  /**
   * E2E-4: Backward compatibility — no skip config produces no skip-related warnings.
   */
  it("backward compat: no skip config produces no skip-related warnings", async () => {
    const testDir = mkdtempSync(join(tmpdir(), "skip-e2e-4-"));
    try {
      makeSandbox({
        dir: testDir,
        serverUrl: server.url,
        endpoints: [
          {
            id: "legacy.endpoint",
            name: "Legacy Endpoint",
            method: "GET",
            url: "/legacy",
            request: {},
            response: { expected_status: 200, schema: { type: "object" } },
          },
        ],
      });

      const { report } = await runCli(testDir);
      if (report !== null) {
        const skipWarnings = (report.warnings ?? []).filter(
          (w) =>
            w.includes("skip_cases") ||
            w.includes("skip_globally") ||
            w.toLowerCase().includes("skipped") ||
            w.includes("matched zero"),
        );
        expect(skipWarnings).toHaveLength(0);
      } else {
        expect(report).not.toBeNull();
      }
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  }, 30_000);
});
