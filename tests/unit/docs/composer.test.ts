import { describe, it, expect } from "vitest";

import type { CanonicalEndpoint } from "../../../src/core/canonical-model.js";
import { composeMarkdown } from "../../../src/docs/composer.js";

const SAMPLE: CanonicalEndpoint = {
  id: "users.create",
  name: "Create user",
  method: "POST",
  url: "/v1/users",
  auth_strategy: "user_token",
  request: {
    headers: { "Content-Type": "application/json" },
    body_schema: { type: "object", required: ["email"], properties: { email: { type: "string", format: "email" } } },
    body_example: { email: "a@b.c" },
  },
  response: {
    expected_status: 201,
    schema: { type: "object", properties: { id: { type: "string" } } },
    sla_ms: 500,
  },
  db_verify: [{ connection: "primary_postgres", query: "SELECT 1", expect: "exists", query_id: "q1" }],
  assertions: ["response.status equals 201"],
  markers: ["smoke", "regression"],
};

describe("composeMarkdown", () => {
  it("emits a single trailing newline", () => {
    const out = composeMarkdown({ endpoint: SAMPLE, sourcePath: "x.endpoint.json" });
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
  });

  it("includes every section in fixed spec order", () => {
    const out = composeMarkdown({ endpoint: SAMPLE, sourcePath: "x.endpoint.json" });
    const headerIdx = out.indexOf("# Create user");
    const authIdx = out.indexOf("## Authentication");
    const reqIdx = out.indexOf("## Request");
    const resIdx = out.indexOf("## Response");
    const dbIdx = out.indexOf("## Database side effects");
    const tcIdx = out.indexOf("## Test coverage");
    const mkIdx = out.indexOf("## Markers");
    expect(headerIdx).toBeGreaterThanOrEqual(0);
    expect(headerIdx).toBeLessThan(authIdx);
    expect(authIdx).toBeLessThan(reqIdx);
    expect(reqIdx).toBeLessThan(resIdx);
    expect(resIdx).toBeLessThan(dbIdx);
    expect(dbIdx).toBeLessThan(tcIdx);
    expect(tcIdx).toBeLessThan(mkIdx);
  });

  it("is byte-identical across two runs (determinism)", () => {
    const a = composeMarkdown({ endpoint: SAMPLE, sourcePath: "x.endpoint.json" });
    const b = composeMarkdown({ endpoint: SAMPLE, sourcePath: "x.endpoint.json" });
    expect(a).toBe(b);
  });

  it("separates sections with a single blank line", () => {
    const out = composeMarkdown({ endpoint: SAMPLE, sourcePath: "x.endpoint.json" });
    // No triple newlines anywhere (only single blank line between sections).
    expect(out).not.toMatch(/\n\n\n\n/);
  });
});
