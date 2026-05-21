import { describe, it, expect } from "vitest";

import { renderHtmlReport } from "../../../src/reporting/index.js";
import type { RunResult } from "../../../src/reporting/index.js";

const BASE: RunResult = {
  started_at: "2026-05-21T00:00:00Z",
  ended_at: "2026-05-21T00:01:00Z",
  env: "test",
  filters: {},
  shard: null,
  workers: 1,
  endpoints: [],
  summary: { endpoints_planned: 0, passed: 0, failed: 0, flaky: 0, duration_ms: 60000 },
};

describe("renderHtmlReport", () => {
  it("emits a valid <!doctype html> document", () => {
    const html = renderHtmlReport(BASE);
    expect(html).toMatch(/^<!doctype html>/i);
    expect(html).toContain("<html");
    expect(html).toContain("</html>");
  });

  it("includes inline CSS (self-contained, no external assets)", () => {
    const html = renderHtmlReport(BASE);
    expect(html).toContain("<style>");
    expect(html).toContain("body{font-family");
  });

  it("renders summary counts (planned/passed/failed/flaky/duration)", () => {
    const r: RunResult = {
      ...BASE,
      summary: { endpoints_planned: 5, passed: 3, failed: 1, flaky: 1, duration_ms: 1234 },
    };
    const html = renderHtmlReport(r);
    expect(html).toContain("Planned: 5");
    expect(html).toContain("Passed: 3");
    expect(html).toContain("Failed: 1");
    expect(html).toContain("Flaky: 1");
    expect(html).toContain("Duration: 1234 ms");
  });

  it("renders one section per endpoint with attempt detail", () => {
    const r: RunResult = {
      ...BASE,
      endpoints: [
        {
          endpoint_id: "users.get",
          status: "pass",
          flaky: false,
          attempts: [
            {
              attempt: 1, verdict: "pass", started_at: 0, ended_at: 50,
              request: { method: "GET", url: "https://api.invalid/users/1", headers: {} },
              response: { status: 200, headers: { "content-type": "application/json" }, body: { id: 1 }, time_ms: 50 },
              assertions: [],
              db_verify: [],
            },
          ],
        },
      ],
    };
    const html = renderHtmlReport(r);
    expect(html).toContain("users.get");
    expect(html).toContain("Attempt 1");
    expect(html).toContain("GET");
    expect(html).toContain("status 200");
    expect(html).toContain("(50 ms)");
  });

  it("renders flaky list when endpoints are flaky", () => {
    const r: RunResult = {
      ...BASE,
      endpoints: [
        {
          endpoint_id: "f.one",
          status: "flaky",
          flaky: true,
          attempts: [
            { attempt: 1, verdict: "fail", started_at: 0, ended_at: 1, assertions: [], db_verify: [] },
            { attempt: 2, verdict: "pass", started_at: 2, ended_at: 3, assertions: [], db_verify: [] },
          ],
        },
      ],
      summary: { endpoints_planned: 1, passed: 0, failed: 0, flaky: 1, duration_ms: 3 },
    };
    const html = renderHtmlReport(r);
    expect(html).toContain("Flaky tests (passed after retry)");
    expect(html).toContain("f.one");
  });

  it("renders failure reasons", () => {
    const r: RunResult = {
      ...BASE,
      endpoints: [
        {
          endpoint_id: "x.fail",
          status: "fail",
          flaky: false,
          attempts: [{
            attempt: 1, verdict: "fail", started_at: 0, ended_at: 1,
            assertions: [], db_verify: [], failure_reason: "expected 200 got 500",
          }],
        },
      ],
    };
    const html = renderHtmlReport(r);
    expect(html).toContain("Reason: expected 200 got 500");
  });

  it("escapes HTML-significant characters", () => {
    const r: RunResult = {
      ...BASE,
      env: '<script>alert("xss")</script>',
    };
    const html = renderHtmlReport(r);
    expect(html).not.toMatch(/<script>alert\("xss"\)<\/script>/);
    expect(html).toContain("&lt;script&gt;");
  });

  it("renders assertions table when assertions present", () => {
    const r: RunResult = {
      ...BASE,
      endpoints: [
        {
          endpoint_id: "a", status: "pass", flaky: false,
          attempts: [{
            attempt: 1, verdict: "pass", started_at: 0, ended_at: 1,
            assertions: [{ assertion: "x equals 1", target: "x", operator: "equals", pass: true, expected: 1, actual: 1 }],
            db_verify: [],
          }],
        },
      ],
    };
    const html = renderHtmlReport(r);
    expect(html).toContain("Assertions");
    expect(html).toContain("x equals 1");
  });

  it("renders db_verify table when present", () => {
    const r: RunResult = {
      ...BASE,
      endpoints: [
        {
          endpoint_id: "b", status: "pass", flaky: false,
          attempts: [{
            attempt: 1, verdict: "pass", started_at: 0, ended_at: 1,
            assertions: [],
            db_verify: [{ connection: "main", query_id: "q0", normalized: { rows: [{ id: 1 }], rowCount: 1, raw: {} }, pass: true }],
          }],
        },
      ],
    };
    const html = renderHtmlReport(r);
    expect(html).toContain("DB Verify");
    expect(html).toContain("main.q0");
    expect(html).toContain("rows=1");
  });

  it("renders cleanup outcome when present", () => {
    const r: RunResult = {
      ...BASE,
      endpoints: [
        {
          endpoint_id: "c", status: "pass", flaky: false,
          attempts: [{ attempt: 1, verdict: "pass", started_at: 0, ended_at: 1, assertions: [], db_verify: [] }],
          cleanup: { ok: false, reason: "DELETE failed" },
        },
      ],
    };
    const html = renderHtmlReport(r);
    expect(html).toContain("Cleanup:");
    expect(html).toContain("DELETE failed");
  });

  it("renders failing assertion + db_verify rows (covers fail branches)", () => {
    const r: RunResult = {
      ...BASE,
      endpoints: [
        {
          endpoint_id: "fb", status: "fail", flaky: false,
          attempts: [{
            attempt: 1, verdict: "fail", started_at: 0, ended_at: 1,
            request: { method: "POST", url: "https://api.invalid", headers: {}, body: { x: 1 } },
            response: { status: 500, headers: {}, body: { err: "x" }, time_ms: 1 },
            assertions: [
              { assertion: "y equals 1", target: "y", operator: "equals", pass: false,
                expected: 1, actual: 0, failureCode: "VALUE_MISMATCH", reason: "got 0" },
            ],
            db_verify: [
              { connection: "main", query_id: "q0",
                normalized: { rows: [], rowCount: 0, raw: {} }, pass: false, reason: "empty" },
            ],
          }],
        },
      ],
    };
    const html = renderHtmlReport(r);
    expect(html).toContain('class="fail">fail');
    expect(html).toContain("got 0");
    expect(html).toContain("empty");
  });

  it("includes shard info when present", () => {
    const r: RunResult = { ...BASE, shard: { index: 2, total: 4 } };
    const html = renderHtmlReport(r);
    expect(html).toContain("Shard: 2/4");
  });
});
