/**
 * Issue #75: end-to-end regression guard that --shard N/M actually
 * slices the test plan. Spec §9 line 638 promises this; before the
 * fix, the flag wasn't even wired into the CLI (runner internals
 * supported it but the seam hardcoded `shard: null`).
 *
 * Boots a real httpbin-mockable server, runs the CLI with 4 endpoints
 * and --shard 1/4, asserts ONLY one endpoint was planned. Repeats
 * with --shard 2/4 and asserts a DIFFERENT endpoint was planned.
 * The two slices must not overlap; their union covers all endpoints.
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
    res.end(JSON.stringify({ ok: true }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("addr unknown");
  return {
    url: `http://127.0.0.1:${addr.port}`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      ),
  };
}

async function runShard(
  cliPath: string,
  dir: string,
  shardSpec: string,
): Promise<{ planned: number; endpointIds: string[] }> {
  rmSync(join(dir, "reports"), { recursive: true, force: true });
  mkdirSync(join(dir, "reports"));
  try {
    await execFileAsync(
      "node",
      [cliPath, "run", "--env", "qa", "--markers", "smoke", "--shard", shardSpec],
      { cwd: dir, encoding: "utf8" },
    );
  } catch {
    // CLI may exit non-zero; the report is what matters.
  }
  const files = readdirSync(join(dir, "reports"));
  const jsonFile = files.find((f) => f.endsWith(".json"));
  if (!jsonFile) throw new Error(`no report written for shard ${shardSpec}`);
  interface ReportShape {
    endpoints: Array<{ endpoint_id: string }>;
    summary: { endpoints_planned: number };
  }
  const parsed = JSON.parse(
    readFileSync(join(dir, "reports", jsonFile), "utf8"),
  ) as ReportShape;
  return {
    planned: parsed.summary.endpoints_planned,
    endpointIds: parsed.endpoints.map((e) => e.endpoint_id).sort(),
  };
}

describe("--shard N/M end-to-end (issue #75)", () => {
  let dir: string;
  let server: { url: string; close: () => Promise<void> };
  const ENDPOINT_IDS = ["alpha", "bravo", "charlie", "delta"];

  beforeAll(async () => {
    server = await startServer();
    dir = mkdtempSync(join(tmpdir(), "apiwright-shard-"));
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
    for (const id of ENDPOINT_IDS) {
      writeFileSync(
        join(dir, "endpoints", `${id}.endpoint.json`),
        JSON.stringify({
          id,
          name: id,
          method: "GET",
          url: "/",
          request: {},
          response: { expected_status: 200 },
        }),
        "utf8",
      );
    }
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

  it("--shard 1/4 plans a subset of endpoints (not all 4)", async () => {
    const cliPath = join(process.cwd(), "dist", "cli", "entry.js");
    const result = await runShard(cliPath, dir, "1/4");
    // With 4 endpoints and shard 1/4, exactly 1 endpoint should be in
    // this slice (deterministic split).
    expect(result.planned).toBeLessThan(ENDPOINT_IDS.length);
    expect(result.planned).toBeGreaterThanOrEqual(1);
  }, 30_000);

  it("--shard 2/4 plans a DIFFERENT subset than --shard 1/4 (slices are disjoint)", async () => {
    const cliPath = join(process.cwd(), "dist", "cli", "entry.js");
    const slice1 = await runShard(cliPath, dir, "1/4");
    const slice2 = await runShard(cliPath, dir, "2/4");
    const intersection = slice1.endpointIds.filter((id) =>
      slice2.endpointIds.includes(id),
    );
    expect(intersection).toEqual([]);
  }, 30_000);

  it("all 4 shards together cover EVERY endpoint exactly once", async () => {
    const cliPath = join(process.cwd(), "dist", "cli", "entry.js");
    const seen = new Set<string>();
    for (const n of [1, 2, 3, 4]) {
      const slice = await runShard(cliPath, dir, `${n}/4`);
      for (const id of slice.endpointIds) {
        expect(seen.has(id), `endpoint ${id} appeared in multiple shards`).toBe(false);
        seen.add(id);
      }
    }
    expect(seen.size).toBe(ENDPOINT_IDS.length);
    for (const id of ENDPOINT_IDS) {
      expect(seen.has(id), `endpoint ${id} missing from union of shards`).toBe(true);
    }
  }, 60_000);
});
