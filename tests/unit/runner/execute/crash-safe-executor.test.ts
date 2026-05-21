import { describe, it, expect, vi } from "vitest";

import type { CanonicalEndpoint } from "../../../../src/core/canonical-model.js";
import {
  executeEndpointSafely,
  synthesizeCrashResult,
} from "../../../../src/runner/execute/crash-safe-executor.js";
import * as executorMod from "../../../../src/runner/execute/endpoint-executor.js";
import type { ExecutorDeps } from "../../../../src/runner/execute/endpoint-executor.js";
import type { EndpointResult, PlannedTestCase } from "../../../../src/runner/types.js";

const ENDPOINT: CanonicalEndpoint = {
  id: "users.create",
  name: "Create",
  method: "POST",
  url: "/users",
  auth_strategy: "user_token",
  response: { expected_status: 201 },
} as unknown as CanonicalEndpoint;

const CASES: readonly PlannedTestCase[] = [];
const DEPS = {} as ExecutorDeps;

describe("executeEndpointSafely", () => {
  it("returns the executor's result unchanged on success", async () => {
    const happy: EndpointResult = {
      endpoint_id: "users.create",
      status: "pass",
      attempts: [
        {
          attempt: 1,
          verdict: "pass",
          started_at: 1,
          ended_at: 2,
          assertions: [],
          db_verify: [],
        },
      ],
      flaky: false,
    };
    vi.spyOn(executorMod, "executeEndpoint").mockResolvedValueOnce(happy);
    const result = await executeEndpointSafely(ENDPOINT, CASES, DEPS);
    expect(result).toBe(happy);
  });

  it("catches synchronous throws and synthesizes a fail result", async () => {
    vi.spyOn(executorMod, "executeEndpoint").mockImplementationOnce(() => {
      throw new Error("sync boom");
    });
    const result = await executeEndpointSafely(ENDPOINT, CASES, DEPS);
    expect(result.status).toBe("fail");
    expect(result.endpoint_id).toBe("users.create");
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0]?.failure_reason).toContain("sync boom");
  });

  it("catches async rejections and synthesizes a fail result", async () => {
    vi.spyOn(executorMod, "executeEndpoint").mockRejectedValueOnce(new Error("async boom"));
    const result = await executeEndpointSafely(ENDPOINT, CASES, DEPS);
    expect(result.status).toBe("fail");
    expect(result.attempts[0]?.failure_reason).toContain("async boom");
  });

  it("handles non-Error thrown values gracefully", async () => {
    vi.spyOn(executorMod, "executeEndpoint").mockRejectedValueOnce("string thrown");
    const result = await executeEndpointSafely(ENDPOINT, CASES, DEPS);
    expect(result.attempts[0]?.failure_reason).toContain("string thrown");
  });

  it("handles thrown null without losing the endpoint id", async () => {
    vi.spyOn(executorMod, "executeEndpoint").mockRejectedValueOnce(null);
    const result = await executeEndpointSafely(ENDPOINT, CASES, DEPS);
    expect(result.endpoint_id).toBe("users.create");
    expect(result.attempts[0]?.failure_reason).toContain("null");
  });

  it("handles thrown undefined", async () => {
    vi.spyOn(executorMod, "executeEndpoint").mockRejectedValueOnce(undefined);
    const result = await executeEndpointSafely(ENDPOINT, CASES, DEPS);
    expect(result.attempts[0]?.failure_reason).toContain("undefined");
  });

  it("handles Error with empty message by falling back to the name", async () => {
    const e = new TypeError();
    vi.spyOn(executorMod, "executeEndpoint").mockRejectedValueOnce(e);
    const result = await executeEndpointSafely(ENDPOINT, CASES, DEPS);
    expect(result.attempts[0]?.failure_reason).toContain("TypeError");
  });

  it("handles thrown number primitives", async () => {
    vi.spyOn(executorMod, "executeEndpoint").mockRejectedValueOnce(42);
    const result = await executeEndpointSafely(ENDPOINT, CASES, DEPS);
    expect(result.attempts[0]?.failure_reason).toContain("42");
  });

  it("handles thrown boolean primitives", async () => {
    vi.spyOn(executorMod, "executeEndpoint").mockRejectedValueOnce(true);
    const result = await executeEndpointSafely(ENDPOINT, CASES, DEPS);
    expect(result.attempts[0]?.failure_reason).toContain("true");
  });

  it("handles thrown bigint primitives", async () => {
    vi.spyOn(executorMod, "executeEndpoint").mockRejectedValueOnce(BigInt(99));
    const result = await executeEndpointSafely(ENDPOINT, CASES, DEPS);
    expect(result.attempts[0]?.failure_reason).toContain("99");
  });

  it("handles thrown plain objects via JSON.stringify", async () => {
    vi.spyOn(executorMod, "executeEndpoint").mockRejectedValueOnce({ code: "WEIRD", k: 1 });
    const result = await executeEndpointSafely(ENDPOINT, CASES, DEPS);
    expect(result.attempts[0]?.failure_reason).toContain("WEIRD");
    expect(result.attempts[0]?.failure_reason).not.toContain("[object Object]");
  });
});

describe("synthesizeCrashResult", () => {
  it("produces a deterministic shape with exactly one attempt", () => {
    const r = synthesizeCrashResult("foo.bar", new Error("x"));
    expect(r.endpoint_id).toBe("foo.bar");
    expect(r.status).toBe("fail");
    expect(r.flaky).toBe(false);
    expect(r.attempts).toHaveLength(1);
    const a = r.attempts[0];
    expect(a?.attempt).toBe(1);
    expect(a?.verdict).toBe("fail");
    expect(a?.assertions).toEqual([]);
    expect(a?.db_verify).toEqual([]);
    expect(a?.failure_reason).toContain("x");
  });

  it("started_at === ended_at (zero wall time for synthetic results)", () => {
    const r = synthesizeCrashResult("foo", new Error("x"));
    expect(r.attempts[0]?.started_at).toBe(r.attempts[0]?.ended_at);
  });
});
