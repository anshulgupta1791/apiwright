/**
 * Integration regression guard for issue #79 — template substitution at
 * request-build time. The runner MUST resolve `${env.X}` references
 * across the endpoint URL, request headers, and `body_example` BEFORE
 * the HTTP request goes out. Verifying with unit tests alone is not
 * enough — that's how this bug shipped: per-renderer unit tests passed
 * because they checked the report shape, but no test exercised what
 * the actual outgoing HTTP request looked like.
 *
 * Same coverage-gaming class as the discipline lesson — every fix needs
 * UNIT + INTEGRATION + E2E coverage.
 *
 * Discovered by the Library Postman walkthrough on 2026-05-31: a
 * Postman collection imported via `apiwright import postman` produced
 * endpoint URLs like `${env.base_url}/Library/AddBook.php` that were
 * sent VERBATIM (with the literal `${env.base_url}` token in the URL)
 * because `buildBaseRequest` copied `endpoint.url` raw.
 */

import { execFile } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

interface CapturedRequest {
  url: string;
  method: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

/** Start an HTTP server that records every request it receives. */
async function startServer(): Promise<{
  url: string;
  captured: CapturedRequest[];
  close: () => Promise<void>;
}> {
  const captured: CapturedRequest[] = [];
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      captured.push({
        url: req.url ?? "",
        method: req.method ?? "",
        headers: req.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("server addr unknown");
  const url = `http://127.0.0.1:${addr.port}`;
  return {
    url,
    captured,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      ),
  };
}

/**
 * Writes a minimal sandbox: apiwright.config.json, environments/qa.yaml,
 * and one endpoint JSON.
 */
function makeSandbox(
  dir: string,
  envExtras: Record<string, string>,
  endpoint: Record<string, unknown>,
  baseUrl: string,
): void {
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
  mkdirSync(join(dir, "endpoints"));
  mkdirSync(join(dir, "environments"));
  const envLines = [
    "name: qa",
    "prod: false",
    `base_url: ${baseUrl}`,
    ...Object.entries(envExtras).map(([k, v]) => `${k}: "${v}"`),
  ];
  writeFileSync(join(dir, "environments", "qa.yaml"), envLines.join("\n"), "utf8");
  writeFileSync(
    join(dir, "endpoints", `${endpoint["id"] as string}.endpoint.json`),
    JSON.stringify(endpoint, null, 2),
    "utf8",
  );
}

describe("runtime template substitution end-to-end (issue #79)", () => {
  let dir: string;
  let server: Awaited<ReturnType<typeof startServer>>;
  const cli = join(process.cwd(), "dist", "cli", "entry.js");

  beforeAll(async () => {
    server = await startServer();
    dir = mkdtempSync(join(tmpdir(), "apiwright-tmpl-subst-"));
  });

  afterAll(async () => {
    rmSync(dir, { recursive: true, force: true });
    await server.close();
  });

  it("substitutes ${env.X} in the URL path before the request is sent", async () => {
    // Reset capture buffer & sandbox for this test.
    server.captured.length = 0;
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir);

    makeSandbox(
      dir,
      { tenant_id: "acme" },
      {
        id: "fetch_items",
        name: "FetchItems",
        method: "GET",
        url: "/v1/tenants/${env.tenant_id}/items",
        request: {},
        response: { expected_status: 200, schema: {} },
      },
      server.url,
    );

    await execFileAsync("node", [cli, "run", "--env", "qa", "--markers", "smoke"], {
      cwd: dir,
    }).catch(() => undefined); // non-zero exit is OK; we only inspect captures

    // The server received a request whose URL path was substituted.
    const urls = server.captured.map((r) => r.url);
    expect(urls.length).toBeGreaterThan(0);
    for (const u of urls) {
      expect(u).not.toContain("${env.");
      expect(u).toContain("/v1/tenants/acme/items");
    }
  });

  it("substitutes ${env.X} in request header values before the request is sent", async () => {
    server.captured.length = 0;
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir);

    makeSandbox(
      dir,
      { tenant_id: "globex" },
      {
        id: "header_subst",
        name: "HeaderSubst",
        method: "GET",
        url: "/ping",
        request: { headers: { "X-Tenant": "${env.tenant_id}" } },
        response: { expected_status: 200, schema: {} },
      },
      server.url,
    );

    await execFileAsync("node", [cli, "run", "--env", "qa", "--markers", "smoke"], {
      cwd: dir,
    }).catch(() => undefined);

    const headers = server.captured.map((r) => r.headers);
    expect(headers.length).toBeGreaterThan(0);
    for (const h of headers) {
      expect(h["x-tenant"]).toBe("globex");
    }
  });

  it("substitutes ${env.X} in body_example string leaves before the request is sent", async () => {
    server.captured.length = 0;
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir);

    makeSandbox(
      dir,
      { book_name: "Dune", author_name: "Herbert" },
      {
        id: "addbook",
        name: "AddBook",
        method: "POST",
        url: "/books",
        request: {
          body_schema: {
            type: "object",
            properties: { name: { type: "string" }, author: { type: "string" } },
            required: ["name", "author"],
          },
          body_example: { name: "${env.book_name}", author: "${env.author_name}" },
        },
        response: { expected_status: 200, schema: {} },
      },
      server.url,
    );

    await execFileAsync("node", [cli, "run", "--env", "qa", "--markers", "smoke"], {
      cwd: dir,
    }).catch(() => undefined);

    const postBodies = server.captured
      .filter((r) => r.method === "POST" && r.body.length > 0)
      .map((r) => r.body);
    expect(postBodies.length).toBeGreaterThan(0);
    for (const b of postBodies) {
      expect(b).not.toContain("${env.");
      const parsed = JSON.parse(b) as { name?: string; author?: string };
      // The base body, with substitution applied.
      if (parsed.name !== undefined && parsed.author !== undefined) {
        expect(parsed.name).toBe("Dune");
        expect(parsed.author).toBe("Herbert");
      }
    }
  });

  it("does NOT double the host when endpoint URL substitutes to an absolute URL", async () => {
    server.captured.length = 0;
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir);

    // env.base_url is the test server (used by the runner as the auto-prepend
    // base). The endpoint URL starts with `${env.base_url}` — a common
    // Postman-import pattern. After substitution, the URL is absolute; the
    // runner MUST NOT prepend env.base_url again.
    makeSandbox(
      dir,
      {},
      {
        id: "tmpl_base_url",
        name: "TmplBaseUrl",
        method: "GET",
        url: "${env.base_url}/Library/GetBook.php",
        request: {},
        response: { expected_status: 200, schema: {} },
      },
      server.url,
    );

    await execFileAsync("node", [cli, "run", "--env", "qa", "--markers", "smoke"], {
      cwd: dir,
    }).catch(() => undefined);

    expect(server.captured.length).toBeGreaterThan(0);
    for (const r of server.captured) {
      // The path that the server received (via req.url) must be exactly
      // `/Library/GetBook.php` — NOT `/${env.base_url}/Library/GetBook.php`
      // (the pre-fix bug) and NOT `/http://127.0.0.1:PORT/Library/...` (the
      // would-be doubled prefix). Also assert the literal token is gone.
      expect(r.url).toBe("/Library/GetBook.php");
      expect(r.url).not.toContain("${env.");
      expect(r.url).not.toContain("127.0.0.1");
    }
  });
});
