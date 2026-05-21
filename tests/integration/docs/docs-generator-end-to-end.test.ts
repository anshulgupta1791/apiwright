import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, it, expect } from "vitest";

import { MarkdownDocsGenerator } from "../../../src/docs/index.js";

/** Endpoint with every section populated (auth + db_verify + cleanup + assertions). */
const RICH_ENDPOINT = {
  id: "users.create",
  name: "Create user",
  method: "POST",
  url: "/v1/users",
  auth_strategy: "user_token",
  request: {
    headers: { "Content-Type": "application/json" },
    body_schema: {
      type: "object",
      required: ["email"],
      properties: {
        email: { type: "string", format: "email" },
        age: { type: "integer", minimum: 0, maximum: 120 },
      },
    },
    body_example: { email: "alice@example.com", age: 30 },
  },
  response: {
    expected_status: 201,
    schema: {
      type: "object",
      properties: { id: { type: "string", format: "uuid" } },
    },
    sla_ms: 500,
  },
  db_verify: [
    { connection: "primary_postgres", query: "SELECT 1", expect: "exists", query_id: "q1" },
  ],
  cleanup: { connection: "primary_postgres", query: "DELETE FROM users WHERE email='${request.body.email}'" },
  assertions: ["response.body.id is_uuid_v4"],
  markers: ["smoke", "regression"],
  tags: ["billing", "critical-path"],
};

describe("MarkdownDocsGenerator — end-to-end with real fs", () => {
  let sourceDir: string;
  let outputDir: string;

  beforeEach(async () => {
    sourceDir = join(tmpdir(), `docs-src-${Date.now()}-${Math.random()}`);
    outputDir = join(tmpdir(), `docs-out-${Date.now()}-${Math.random()}`);
    await mkdir(sourceDir, { recursive: true });
    const sub = join(sourceDir, "users");
    await mkdir(sub, { recursive: true });
    await writeFile(join(sub, "create.endpoint.json"), JSON.stringify(RICH_ENDPOINT), "utf8");
    await writeFile(join(sub, "checkout.flow.json"), "{}", "utf8");
    await writeFile(join(sub, "README.md"), "# notes", "utf8");
  });

  afterEach(async () => {
    await rm(sourceDir, { recursive: true, force: true });
    await rm(outputDir, { recursive: true, force: true });
  });

  it("writes one MD per endpoint, ignores .flow.json + README", async () => {
    const gen = new MarkdownDocsGenerator();
    const outcome = await gen.generate({ sourceDir, outputDir });
    expect(outcome.written).toBe(1);
    const entries = await readdir(outputDir);
    expect(entries).toEqual(["users.create.md"]);
  });

  it("emitted MD contains every spec-required section", async () => {
    const gen = new MarkdownDocsGenerator();
    await gen.generate({ sourceDir, outputDir });
    const md = await readFile(join(outputDir, "users.create.md"), "utf8");
    expect(md).toContain("# Create user");
    expect(md).toContain("## Authentication");
    expect(md).toContain("## Request");
    expect(md).toContain("## Response");
    expect(md).toContain("## Database side effects");
    expect(md).toContain("## Test coverage");
    expect(md).toContain("## Markers");
    expect(md).toContain("`user_token`");
    expect(md).toContain("**Expected status:** `201`");
    expect(md).toContain("primary_postgres.q1");
    expect(md).toContain("`response.body.id is_uuid_v4`");
    expect(md).toContain("`billing`");
  });

  it("emits byte-identical output across two runs (deterministic, safe to commit + diff)", async () => {
    const gen1 = new MarkdownDocsGenerator();
    const out1 = join(outputDir, "run1");
    const out2 = join(outputDir, "run2");
    await gen1.generate({ sourceDir, outputDir: out1 });
    await gen1.generate({ sourceDir, outputDir: out2 });
    const a = await readFile(join(out1, "users.create.md"), "utf8");
    const b = await readFile(join(out2, "users.create.md"), "utf8");
    expect(a).toBe(b);
  });

  it("ends each file with a single trailing newline", async () => {
    const gen = new MarkdownDocsGenerator();
    await gen.generate({ sourceDir, outputDir });
    const md = await readFile(join(outputDir, "users.create.md"), "utf8");
    expect(md.endsWith("\n")).toBe(true);
    expect(md.endsWith("\n\n")).toBe(false);
  });
});
