import { describe, it, expect } from "vitest";

import type { Logger } from "../../../src/cli/logging/logger.js";
import { SecretRegistry } from "../../../src/env/index.js";
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

const EMPTY_SECRETS = new SecretRegistry();

describe("reportRunToConsole", () => {
  it("always emits the run summary (at error level)", () => {
    const log = makeLogger("error");
    reportRunToConsole(BASE, log, EMPTY_SECRETS);
    expect(log.errors.some((m) => m.includes("Run summary"))).toBe(true);
  });

  it("emits failure lines at error level", () => {
    const log = makeLogger("error");
    const r: RunResult = {
      ...BASE,
      endpoints: [{
        endpoint_id: "x.fail", status: "fail", flaky: false,
        attempts: [{
          attempt: 1, verdict: "fail", started_at: 0, ended_at: 1,
          assertions: [], db_verify: [], failure_reason: "boom",
        }],
      }],
      summary: { endpoints_planned: 1, passed: 0, failed: 1, flaky: 0, duration_ms: 1 },
    };
    reportRunToConsole(r, log, EMPTY_SECRETS);
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
    reportRunToConsole(r, log, EMPTY_SECRETS);
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
    reportRunToConsole(r, log, EMPTY_SECRETS);
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
          assertions: [{
            assertion: "x equals 1", target: "x", operator: "equals",
            pass: true, expected: 1, actual: 1,
          }],
          db_verify: [{
            connection: "c", query_id: "q",
            normalized: { rows: [], rowCount: 0, raw: {} }, pass: true,
          }],
        }],
      }],
      summary: { endpoints_planned: 1, passed: 1, failed: 0, flaky: 0, duration_ms: 1 },
    };
    reportRunToConsole(r, log, EMPTY_SECRETS);
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
    reportRunToConsole(r, log, EMPTY_SECRETS);
    expect(log.warns.some((m) => m.startsWith("Flaky tests:"))).toBe(true);
  });

  it("emits plan-generation warnings at warn level (issue #35)", () => {
    const log = makeLogger("warn");
    const r: RunResult = {
      ...BASE,
      warnings: [
        "Endpoint 'users.delete': no response.schema declared; response_schema_validation skipped.",
      ],
    };
    reportRunToConsole(r, log, EMPTY_SECRETS);
    expect(log.warns.some((m) => m.includes("users.delete") && m.includes("skipped"))).toBe(true);
  });

  it("emits no warning lines when result.warnings is absent", () => {
    const log = makeLogger("warn");
    reportRunToConsole(BASE, log, EMPTY_SECRETS);
    expect(log.warns.some((m) => m.includes("skipped"))).toBe(false);
  });
});

// ===========================================================================
// Audit blocker 🚨-2: every emitted string MUST be redacted (§8 line 596).
// ===========================================================================

describe("reportRunToConsole — secret redaction (audit blocker 🚨-2)", () => {
  /** Builds a registry pre-loaded with one secret value. */
  function withSecret(value: string): SecretRegistry {
    const r = new SecretRegistry();
    r.add(value);
    return r;
  }

  it("redacts a secret token appearing in a request header debug line", () => {
    const secrets = withSecret("supersecret-token-xyz");
    const log = makeLogger("debug");
    const r: RunResult = {
      ...BASE,
      endpoints: [{
        endpoint_id: "leak.headers", status: "pass", flaky: false,
        attempts: [{
          attempt: 1, verdict: "pass", started_at: 0, ended_at: 1,
          request: {
            method: "GET",
            url: "https://api.invalid",
            headers: { Authorization: "Bearer supersecret-token-xyz" },
          },
          response: { status: 200, headers: {}, body: {}, time_ms: 1 },
          assertions: [], db_verify: [],
        }],
      }],
      summary: { endpoints_planned: 1, passed: 1, failed: 0, flaky: 0, duration_ms: 1 },
    };
    reportRunToConsole(r, log, secrets);
    const allDebugs = log.debugs.join("\n");
    expect(allDebugs).not.toContain("supersecret-token-xyz");
    expect(allDebugs).toContain("[REDACTED]");
  });

  it("redacts a secret appearing in a response body debug line", () => {
    const secrets = withSecret("leaked-from-body");
    const log = makeLogger("debug");
    const r: RunResult = {
      ...BASE,
      endpoints: [{
        endpoint_id: "leak.body", status: "pass", flaky: false,
        attempts: [{
          attempt: 1, verdict: "pass", started_at: 0, ended_at: 1,
          request: { method: "GET", url: "https://api.invalid", headers: {} },
          response: {
            status: 200, headers: {},
            body: { secret_field: "leaked-from-body" },
            time_ms: 1,
          },
          assertions: [], db_verify: [],
        }],
      }],
      summary: { endpoints_planned: 1, passed: 1, failed: 0, flaky: 0, duration_ms: 1 },
    };
    reportRunToConsole(r, log, secrets);
    const allDebugs = log.debugs.join("\n");
    expect(allDebugs).not.toContain("leaked-from-body");
    expect(allDebugs).toContain("[REDACTED]");
  });

  it("redacts a secret embedded in a failure_reason at error level", () => {
    const secrets = withSecret("creds-in-error-msg");
    const log = makeLogger("error");
    const r: RunResult = {
      ...BASE,
      endpoints: [{
        endpoint_id: "leak.fail", status: "fail", flaky: false,
        attempts: [{
          attempt: 1, verdict: "fail", started_at: 0, ended_at: 1,
          assertions: [], db_verify: [],
          failure_reason: "auth rejected creds-in-error-msg",
        }],
      }],
      summary: { endpoints_planned: 1, passed: 0, failed: 1, flaky: 0, duration_ms: 1 },
    };
    reportRunToConsole(r, log, secrets);
    const allErrors = log.errors.join("\n");
    expect(allErrors).not.toContain("creds-in-error-msg");
    expect(allErrors).toContain("[REDACTED]");
  });

  it("redacts a secret in the request body when emitted as a separate debug line", () => {
    const secrets = withSecret("secret-in-req-body");
    const log = makeLogger("debug");
    const r: RunResult = {
      ...BASE,
      endpoints: [{
        endpoint_id: "leak.reqbody", status: "pass", flaky: false,
        attempts: [{
          attempt: 1, verdict: "pass", started_at: 0, ended_at: 1,
          request: {
            method: "POST",
            url: "https://api.invalid",
            headers: {},
            body: { password: "secret-in-req-body" },
          },
          response: { status: 200, headers: {}, body: {}, time_ms: 1 },
          assertions: [], db_verify: [],
        }],
      }],
      summary: { endpoints_planned: 1, passed: 1, failed: 0, flaky: 0, duration_ms: 1 },
    };
    reportRunToConsole(r, log, secrets);
    const allDebugs = log.debugs.join("\n");
    expect(allDebugs).not.toContain("secret-in-req-body");
  });

  it("redacts a secret appearing in a flaky-notice warn line", () => {
    const secrets = withSecret("flaky-id-leak");
    const log = makeLogger("warn");
    const r: RunResult = {
      ...BASE,
      endpoints: [{
        endpoint_id: "flaky-id-leak", status: "flaky", flaky: true,
        attempts: [
          { attempt: 1, verdict: "fail", started_at: 0, ended_at: 1, assertions: [], db_verify: [] },
          { attempt: 2, verdict: "pass", started_at: 2, ended_at: 3, assertions: [], db_verify: [] },
        ],
      }],
      summary: { endpoints_planned: 1, passed: 0, failed: 0, flaky: 1, duration_ms: 3 },
    };
    reportRunToConsole(r, log, secrets);
    const allWarns = log.warns.join("\n");
    expect(allWarns).not.toContain("flaky-id-leak");
    expect(allWarns).toContain("[REDACTED]");
  });

  it("redacts an assertion string that contains a secret value", () => {
    const secrets = withSecret("token-in-assertion");
    const log = makeLogger("debug");
    const r: RunResult = {
      ...BASE,
      endpoints: [{
        endpoint_id: "a", status: "pass", flaky: false,
        attempts: [{
          attempt: 1, verdict: "pass", started_at: 0, ended_at: 1,
          assertions: [{
            assertion: "response.body.token equals token-in-assertion",
            target: "response.body.token", operator: "equals",
            pass: true, expected: "token-in-assertion", actual: "token-in-assertion",
          }],
          db_verify: [],
        }],
      }],
      summary: { endpoints_planned: 1, passed: 1, failed: 0, flaky: 0, duration_ms: 1 },
    };
    reportRunToConsole(r, log, secrets);
    const allDebugs = log.debugs.join("\n");
    expect(allDebugs).not.toContain("token-in-assertion");
  });

  it("does not redact non-secret strings (passes through cleanly)", () => {
    const secrets = withSecret("specific-secret-value");
    const log = makeLogger("debug");
    const r: RunResult = {
      ...BASE,
      endpoints: [{
        endpoint_id: "clean", status: "pass", flaky: false,
        attempts: [{
          attempt: 1, verdict: "pass", started_at: 0, ended_at: 1,
          request: { method: "GET", url: "https://api.invalid", headers: {} },
          response: { status: 200, headers: {}, body: { id: "12345" }, time_ms: 1 },
          assertions: [], db_verify: [],
        }],
      }],
      summary: { endpoints_planned: 1, passed: 1, failed: 0, flaky: 0, duration_ms: 1 },
    };
    reportRunToConsole(r, log, secrets);
    const allDebugs = log.debugs.join("\n");
    expect(allDebugs).toContain("12345");
    expect(allDebugs).not.toContain("[REDACTED]");
  });

  it("redacts a secret embedded in a plan-generation warning", () => {
    const secrets = withSecret("secret-in-warning");
    const log = makeLogger("warn");
    const r: RunResult = {
      ...BASE,
      warnings: ["Endpoint 'secret-in-warning': no response.schema declared; skipped."],
    };
    reportRunToConsole(r, log, secrets);
    const allWarns = log.warns.join("\n");
    expect(allWarns).not.toContain("secret-in-warning");
    expect(allWarns).toContain("[REDACTED]");
  });
});
