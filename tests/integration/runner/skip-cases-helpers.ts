/**
 * Shared helpers for the skip-cases integration test suites
 * (skip-cases.integration.test.ts and skip-cases-2.integration.test.ts).
 * Extracted to keep both suites within the 300-line soft limit.
 *
 * These suites are integration-level — CLI subprocess + local TS stub
 * HTTP server, no real services. TRUE end-to-end coverage against real
 * services lives in the apiwright-testing/ sibling repo per the
 * project's e2e-out-of-public-repo architecture.
 *
 * NOT a test file — contains only helper functions and types.
 */

import { execFile } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

export const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RunReport {
  summary: {
    endpoints_planned: number;
    passed: number;
    failed: number;
    flaky: number;
    duration_ms: number;
  };
  endpoints: Array<{
    endpoint_id: string;
    status: "pass" | "fail" | "flaky";
    attempts: Array<{ kind: string; case_id: string; attempt: number; verdict: string }>;
  }>;
  warnings?: string[];
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

/**
 * Starts a local HTTP server that responds 200/JSON to every request.
 * @returns Object with server URL and close() function.
 */
export async function startStubServer(): Promise<{
  url: string;
  close: () => Promise<void>;
}> {
  const server = createServer((_req: IncomingMessage, res: ServerResponse) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, id: "abc123" }));
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

// ---------------------------------------------------------------------------
// Sandbox
// ---------------------------------------------------------------------------

/**
 * Creates a minimal apiwright sandbox directory with config, environment, and endpoints.
 * @param opts - Sandbox options object.
 * @param opts.dir - Temp directory to write into.
 * @param opts.serverUrl - Local stub server URL (used as base_url).
 * @param opts.endpoints - Array of endpoint JSON objects to write.
 * @param opts.config - Optional config overrides merged into the base config.
 */
export function makeSandbox(opts: {
  dir: string;
  serverUrl: string;
  endpoints: Array<Record<string, unknown>>;
  config?: Record<string, unknown>;
}): void {
  const { dir, serverUrl, endpoints, config } = opts;
  mkdirSync(join(dir, "endpoints"), { recursive: true });
  mkdirSync(join(dir, "environments"), { recursive: true });
  mkdirSync(join(dir, "reports"), { recursive: true });

  const baseConfig: Record<string, unknown> = {
    tests_dir: "./endpoints",
    environments_dir: "./environments",
    reports_dir: "./reports",
    default_env: "qa",
    default_markers: ["smoke"],
    log_level: "warn",
    workers: 1,
    report: { json: true },
  };

  writeFileSync(
    join(dir, "apiwright.config.json"),
    JSON.stringify({ ...baseConfig, ...config }, null, 2),
    "utf8",
  );
  writeFileSync(
    join(dir, "environments", "qa.yaml"),
    `name: qa\nbase_url: ${serverUrl}\nprod: false\n`,
    "utf8",
  );
  for (const ep of endpoints) {
    const id = ep["id"] as string;
    writeFileSync(
      join(dir, "endpoints", `${id}.endpoint.json`),
      JSON.stringify(ep, null, 2),
      "utf8",
    );
  }
}

// ---------------------------------------------------------------------------
// CLI runner
// ---------------------------------------------------------------------------

/**
 * Spawns the CLI binary with `run --env qa --markers <markers>` and returns the
 * parsed JSON report (or null if no report was written) plus process output.
 * @param dir - The sandbox directory (must contain apiwright.config.json).
 * @param markers - Comma-separated marker list (default: "smoke").
 * @returns Parsed JSON report, stdout, stderr, and process exit code.
 */
export async function runCli(dir: string, markers = "smoke"): Promise<{
  report: RunReport | null;
  stderr: string;
  stdout: string;
  exitCode: number;
}> {
  const cli = join(process.cwd(), "dist", "cli", "entry.js");
  let stdout = "";
  let stderr = "";
  let exitCode = 0;
  try {
    const result = await execFileAsync(
      "node",
      [cli, "run", "--env", "qa", "--markers", markers],
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
  let report: RunReport | null = null;
  try {
    const files = readdirSync(join(dir, "reports"));
    const jsonFile = files.find((f) => f.endsWith(".json"));
    if (jsonFile) {
      report = JSON.parse(
        readFileSync(join(dir, "reports", jsonFile), "utf8"),
      ) as RunReport;
    }
  } catch {
    // report stays null if file unreadable
  }
  return { report, stderr, stdout, exitCode };
}
