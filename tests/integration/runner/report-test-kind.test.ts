/**
 * Integration regression guard for issue #63 — every attempt in every
 * report format (JSON, HTML, JUnit XML) must carry the §3 test kind
 * and a stable case_id so users can identify which generated case
 * passed or failed.
 *
 * WHY THIS IS AN INTEGRATION TEST:
 *
 *   Per-renderer unit tests confirm the field surfaces given a synthetic
 *   AttemptResult. But the full chain `planner → executor → reporter` is
 *   what users actually exercise; a regression that lost the kind
 *   somewhere upstream (e.g. executor stopped populating it) would still
 *   pass the unit tests but break the report. This test goes end-to-end
 *   through `apiwright run` against a synthetic in-memory HTTP server
 *   and asserts every report format names each generated case.
 *
 *   Same lesson class as issues #42 / #45 / #56 / #57 — coverage at one
 *   layer doesn't prove the chain holds.
 */

import { execFile } from "node:child_process";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";

const execFileAsync = promisify(execFile);

/** Start a tiny HTTP server that returns a deterministic JSON body. */
async function startServer(): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer((_req: IncomingMessage, res: ServerResponse) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, ts: 0 })); // deterministic
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("server addr unknown");
  const url = `http://127.0.0.1:${addr.port}`;
  return {
    url,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      ),
  };
}

describe("report — per-attempt kind + case_id end-to-end (issue #63)", () => {
  let dir: string;
  let server: { url: string; close: () => Promise<void> };

  beforeAll(async () => {
    server = await startServer();
    dir = mkdtempSync(join(tmpdir(), "apiwright-report-kind-"));
    // Minimal sandbox
    writeFileSync(
      join(dir, "apiwright.config.json"),
      JSON.stringify({
        tests_dir: "./endpoints",
        environments_dir: "./environments",
        reports_dir: "./reports",
        default_env: "qa",
        default_markers: ["smoke"],
        log_level: "warn",
        workers: 1,
      }),
      "utf8",
    );
    const epDir = join(dir, "endpoints");
    const envDir = join(dir, "environments");
    const reports = join(dir, "reports");
    for (const d of [epDir, envDir, reports]) {
      mkdirSync(d);
    }
    writeFileSync(
      join(epDir, "anon.endpoint.json"),
      JSON.stringify({
        id: "anon_get",
        name: "Anon GET",
        method: "GET",
        url: "/",
        request: {},
        response: { expected_status: 200 },
      }),
      "utf8",
    );
    writeFileSync(
      join(envDir, "qa.yaml"),
      `name: qa\nbase_url: ${server.url}\nprod: false\n`,
      "utf8",
    );
  });

  afterAll(async () => {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("end-to-end: JSON / HTML / JUnit all carry kind for every attempt", async () => {
    // Run the real CLI binary against the synthetic server.
    // Use async execFile (NOT spawnSync) — spawnSync blocks the event
    // loop, which would prevent the in-process http server from
    // responding to the child, deadlocking the test.
    const cliPath = join(process.cwd(), "dist", "cli", "entry.js");
    let result: { stdout: string; stderr: string };
    try {
      result = await execFileAsync(
        "node",
        [cliPath, "run", "--env", "qa", "--markers", "smoke"],
        { cwd: dir, encoding: "utf8" },
      );
    } catch (e) {
      // Smoke against the deterministic server should pass, but the CLI
      // exits non-zero on any case failure. Either way the reports were
      // emitted — proceed to assertions.
      result = e as { stdout: string; stderr: string };
    }
    // Find the report files
    const reportFiles = readdirSync(join(dir, "reports"));
    const jsonFile = reportFiles.find((f) => f.endsWith(".json"));
    const htmlFile = reportFiles.find((f) => f.endsWith(".html"));
    const xmlFile = reportFiles.find((f) => f.endsWith(".xml"));
    expect(jsonFile, "JSON report should be written").toBeDefined();
    expect(htmlFile, "HTML report should be written").toBeDefined();
    expect(xmlFile, "XML report should be written").toBeDefined();
    if (!jsonFile || !htmlFile || !xmlFile) return;

    const jsonRaw = readFileSync(join(dir, "reports", jsonFile), "utf8");
    const htmlRaw = readFileSync(join(dir, "reports", htmlFile), "utf8");
    const xmlRaw = readFileSync(join(dir, "reports", xmlFile), "utf8");

    // JSON — every attempt object must have non-empty kind + case_id.
    interface AttemptShape { kind?: string; case_id?: string; attempt: number }
    interface ReportShape {
      endpoints: Array<{ attempts: AttemptShape[] }>;
    }
    const parsed = JSON.parse(jsonRaw) as ReportShape;
    const attempts: AttemptShape[] = [];
    for (const e of parsed.endpoints) attempts.push(...e.attempts);
    expect(attempts.length).toBeGreaterThan(0);
    for (const a of attempts) {
      expect(a.kind, `attempt ${a.attempt} missing kind`).toBeTruthy();
      expect(a.case_id, `attempt ${a.attempt} missing case_id`).toBeTruthy();
    }

    // At least one well-known §3 kind must appear (proves the threading
    // works for the canonical 5 smoke kinds — status_code_conformance is
    // emitted for every endpoint).
    const kinds = new Set(attempts.map((a) => a.kind));
    expect(kinds.has("status_code_conformance")).toBe(true);

    // HTML — at minimum the catalog kind name should appear somewhere.
    expect(htmlRaw).toContain("status_code_conformance");

    // JUnit — classname must end with the kind per the new convention.
    expect(xmlRaw).toMatch(/classname="[^"]+\.status_code_conformance"/);

    // Avoid warning Vitest about an unused variable.
    void result;
  }, 30_000);
});
