/**
 * Regression guard for issue #67 — `apiwright run --markers smoke`
 * must execute declarative assertions. Previously assertions were
 * silently dropped on the default smoke filter (marker-classifier had
 * `assertion: "regression"`), so user-declared business-rule checks
 * never ran in the most common CI pattern.
 *
 * WHY THIS IS AN INTEGRATION TEST:
 *
 *   A unit test against MarkerClassifier confirms the map value (and
 *   does — see tests/unit/test-catalog/marker-classifier.test.ts). But
 *   the user-visible promise is "assertions run on smoke." That cuts
 *   across plan-gen → filter → execute → report. Only an end-to-end
 *   run can prove the whole chain honors the contract.
 */

import { execFile } from "node:child_process";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

async function startServer(): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer((_req: IncomingMessage, res: ServerResponse) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, id: "11111111-1111-4111-8111-111111111111" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no addr");
  return {
    url: `http://127.0.0.1:${addr.port}`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      ),
  };
}

describe("declarative assertions — execute on `--markers smoke` (issue #67)", () => {
  let dir: string;
  let server: { url: string; close: () => Promise<void> };

  beforeAll(async () => {
    server = await startServer();
    dir = mkdtempSync(join(tmpdir(), "apiwright-assertion-smoke-"));
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
    for (const d of ["endpoints", "environments", "reports"]) mkdirSync(join(dir, d));
    writeFileSync(
      join(dir, "endpoints", "with_assertions.endpoint.json"),
      JSON.stringify({
        id: "with_assertions",
        name: "With assertions",
        method: "GET",
        url: "/",
        request: {},
        response: { expected_status: 200 },
        assertions: [
          "response.status equals 200",
          "response.body.id is_uuid_v4",
        ],
      }),
      "utf8",
    );
    writeFileSync(
      join(dir, "environments", "qa.yaml"),
      `name: qa\nbase_url: ${server.url}\nprod: false\n`,
      "utf8",
    );
  });

  afterAll(async () => {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("the default `--markers smoke` run actually executes user-declared assertions", async () => {
    const cliPath = join(process.cwd(), "dist", "cli", "entry.js");
    try {
      await execFileAsync(
        "node",
        [cliPath, "run", "--env", "qa", "--markers", "smoke"],
        { cwd: dir, encoding: "utf8" },
      );
    } catch {
      // CLI may exit non-zero if any case fails; we read the report either way.
    }
    const reportFiles = readdirSync(join(dir, "reports"));
    const jsonFile = reportFiles.find((f) => f.endsWith(".json"));
    expect(jsonFile).toBeDefined();
    if (!jsonFile) return;
    interface AttemptShape { kind?: string }
    interface ReportShape {
      endpoints: Array<{ attempts: AttemptShape[] }>;
    }
    const parsed = JSON.parse(
      readFileSync(join(dir, "reports", jsonFile), "utf8"),
    ) as ReportShape;
    const allAttempts = parsed.endpoints.flatMap((e) => e.attempts);
    const assertionAttempts = allAttempts.filter((a) => a.kind === "assertion");
    // The user-visible promise: declarative assertions MUST run on
    // --markers smoke. Two assertions declared → at least 2 attempts of
    // kind="assertion" in the report.
    expect(assertionAttempts.length).toBeGreaterThanOrEqual(2);
  }, 30_000);
});
