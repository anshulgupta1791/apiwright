import { describe, it, expect } from "vitest";

import type { Logger } from "../../../src/cli/logging/logger.js";
import { reportRunToConsole } from "../../../src/reporting/index.js";
import type { RunResult } from "../../../src/reporting/index.js";

/** Captures logger lines per level for assertion. */
interface CapturingLogger extends Logger {
  errors: string[];
  warns: string[];
  infos: string[];
  debugs: string[];
}

function makeLogger(level: Logger["level"]): CapturingLogger {
  const out: CapturingLogger = {
    level,
    errors: [], warns: [], infos: [], debugs: [],
    error(msg: string): void { out.errors.push(msg); },
    warn(msg: string): void { out.warns.push(msg); },
    info(msg: string): void { out.infos.push(msg); },
    debug(msg: string): void { out.debugs.push(msg); },
  };
  return out;
}

const BASE: RunResult = {
  started_at: "x", ended_at: "y", env: "t",
  filters: {}, shard: null, workers: 1,
  endpoints: [],
  summary: { endpoints_planned: 0, passed: 0, failed: 0, flaky: 0, duration_ms: 0 },
};

describe("reportRunToConsole", () => {
  it("always emits the run summary (at error level)", () => {
    const log = makeLogger("error");
    reportRunToConsole(BASE, log);
    expect(log.errors.some((m) => m.includes("Run summary"))).toBe(true);
  });

  it("emits failure lines at error level", () => {
    const log = makeLogger("error");
    const r: RunResult = {
      ...BASE,
      endpoints: [{
        endpoint_id: "x.fail", status: "fail", flaky: false,
        attempts: [{ attempt: 1, verdict: "fail", started_at: 0, ended_at: 1, assertions: [], db_verify: [], failure_reason: "boom" }],
      }],
      summary: { endpoints_planned: 1, passed: 0, failed: 1, flaky: 0, duration_ms: 1 },
    };
    reportRunToConsole(r, log);
    expect(log.errors.some((m) => m.includes("FAIL x.fail"))).toBe(true);
    expect(log.errors.some((m) => m.includes("boom"))).toBe(true);
  });

  it("emits flaky one-liners at warn level", () => {
    const log = makeLogger("warn");
    const r: RunResult = {
      ...BASE,
      endpoints: [{
        endpoint_id: "flaky.one", status: "flaky", flaky: true,
        attempts: [
          { attempt: 1, verdict: "fail", started_at: 0, ended_at: 1, assertions: [], db_verify: [] },
          { attempt: 2, verdict: "pass", started_at: 2, ended_at: 3, assertions: [], db_verify: [] },
        ],
      }],
      summary: { endpoints_planned: 1, passed: 0, failed: 0, flaky: 1, duration_ms: 3 },
    };
    reportRunToConsole(r, log);
    expect(log.warns.some((m) => m.includes("passed on attempt 2 after 1 retry(ies)"))).toBe(true);
  });

  it("emits per-attempt info lines at info level", () => {
    const log = makeLogger("info");
    const r: RunResult = {
      ...BASE,
      endpoints: [{
        endpoint_id: "a", status: "pass", flaky: false,
        attempts: [{ attempt: 1, verdict: "pass", started_at: 0, ended_at: 1, assertions: [], db_verify: [] }],
      }],
      summary: { endpoints_planned: 1, passed: 1, failed: 0, flaky: 0, duration_ms: 1 },
    };
    reportRunToConsole(r, log);
    expect(log.infos.some((m) => m.includes("attempt 1: pass"))).toBe(true);
  });

  it("emits full request/response/assertion/db debug lines at debug level", () => {
    const log = makeLogger("debug");
    const r: RunResult = {
      ...BASE,
      endpoints: [{
        endpoint_id: "d", status: "pass", flaky: false,
        attempts: [{
          attempt: 1, verdict: "pass", started_at: 0, ended_at: 1,
          request: { method: "GET", url: "https://api.invalid", headers: {} },
          response: { status: 200, headers: {}, body: {}, time_ms: 1 },
          assertions: [{ assertion: "x equals 1", target: "x", operator: "equals", pass: true, expected: 1, actual: 1 }],
          db_verify: [{ connection: "c", query_id: "q", normalized: { rows: [], rowCount: 0, raw: {} }, pass: true }],
        }],
      }],
      summary: { endpoints_planned: 1, passed: 1, failed: 0, flaky: 0, duration_ms: 1 },
    };
    reportRunToConsole(r, log);
    expect(log.debugs.some((m) => m.includes("request: GET"))).toBe(true);
    expect(log.debugs.some((m) => m.includes("response: 200"))).toBe(true);
    expect(log.debugs.some((m) => m.includes("assertion 'x equals 1'"))).toBe(true);
    expect(log.debugs.some((m) => m.includes("db.c.q"))).toBe(true);
  });

  it("emits flaky-tests list line at warn level when flaky present", () => {
    const log = makeLogger("warn");
    const r: RunResult = {
      ...BASE,
      endpoints: [{
        endpoint_id: "flaky.one", status: "flaky", flaky: true,
        attempts: [
          { attempt: 1, verdict: "fail", started_at: 0, ended_at: 1, assertions: [], db_verify: [] },
          { attempt: 2, verdict: "pass", started_at: 2, ended_at: 3, assertions: [], db_verify: [] },
        ],
      }],
      summary: { endpoints_planned: 1, passed: 0, failed: 0, flaky: 1, duration_ms: 3 },
    };
    reportRunToConsole(r, log);
    expect(log.warns.some((m) => m.startsWith("Flaky tests:"))).toBe(true);
  });
});
