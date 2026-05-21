import { describe, it, expect } from "vitest";

import {
  DEFAULT_RETRY_POLICY,
  executeWithRetry,
  resolveRetryPolicy,
  type ResolvedRetryPolicy,
} from "../../../src/runner/execute/retry-policy.js";
import type { AttemptResult, Verdict } from "../../../src/runner/types.js";

/**
 * Builds an attempt-runner that returns the verdict at index `attempt-1`.
 * @param verdicts - Verdicts for each attempt in 1-based order.
 * @returns AttemptFn that records the attempt.
 */
function withVerdicts(verdicts: readonly Verdict[]) {
  return async (attempt: number): Promise<AttemptResult> => {
    const verdict = verdicts[attempt - 1] ?? "fail";
    return {
      attempt,
      verdict,
      started_at: 0,
      ended_at: 1,
      assertions: [],
      db_verify: [],
    };
  };
}

const NO_SLEEP = async (_ms: number): Promise<void> => {};

describe("executeWithRetry", () => {
  it("returns pass on first attempt when verdict is pass", async () => {
    const out = await executeWithRetry(withVerdicts(["pass"]), DEFAULT_RETRY_POLICY, NO_SLEEP);
    expect(out.status).toBe("pass");
    expect(out.flaky).toBe(false);
    expect(out.attempts).toHaveLength(1);
  });

  it("returns flaky when retried and eventually passes (lenient default)", async () => {
    const out = await executeWithRetry(withVerdicts(["fail", "pass"]), DEFAULT_RETRY_POLICY, NO_SLEEP);
    expect(out.status).toBe("flaky");
    expect(out.flaky).toBe(true);
    expect(out.attempts).toHaveLength(2);
  });

  it("returns fail when all retries exhausted", async () => {
    const out = await executeWithRetry(
      withVerdicts(["fail", "fail", "fail"]),
      { ...DEFAULT_RETRY_POLICY, count: 2 },
      NO_SLEEP,
    );
    expect(out.status).toBe("fail");
    expect(out.flaky).toBe(false);
    expect(out.attempts).toHaveLength(3);
  });

  it("strict mode treats first-attempt failure as fail regardless of subsequent pass", async () => {
    const out = await executeWithRetry(
      withVerdicts(["fail", "pass"]),
      { ...DEFAULT_RETRY_POLICY, strict: true },
      NO_SLEEP,
    );
    expect(out.status).toBe("fail");
  });

  it("calls sleep with linear backoff between attempts", async () => {
    const delays: number[] = [];
    const sleep = async (ms: number): Promise<void> => { delays.push(ms); };
    await executeWithRetry(
      withVerdicts(["fail", "fail", "pass"]),
      { count: 2, delay_ms: 100, backoff: "linear", strict: false },
      sleep,
    );
    // Attempt 2: delay = 100, attempt 3: delay = 200
    expect(delays).toEqual([100, 200]);
  });

  it("uses exponential backoff", async () => {
    const delays: number[] = [];
    const sleep = async (ms: number): Promise<void> => { delays.push(ms); };
    await executeWithRetry(
      withVerdicts(["fail", "fail", "pass"]),
      { count: 2, delay_ms: 50, backoff: "exponential", strict: false },
      sleep,
    );
    // Attempt 2: 50 * 2^0 = 50, attempt 3: 50 * 2^1 = 100
    expect(delays).toEqual([50, 100]);
  });

  it("uses zero delay when backoff is none", async () => {
    const delays: number[] = [];
    const sleep = async (ms: number): Promise<void> => { delays.push(ms); };
    await executeWithRetry(
      withVerdicts(["fail", "pass"]),
      { count: 1, delay_ms: 100, backoff: "none", strict: false },
      sleep,
    );
    expect(delays).toEqual([0]);
  });
});

describe("resolveRetryPolicy", () => {
  it("returns defaults when no overrides", () => {
    const p = resolveRetryPolicy(undefined, undefined, undefined);
    expect(p).toEqual(DEFAULT_RETRY_POLICY);
  });

  it("global override wins over default", () => {
    const p = resolveRetryPolicy({ count: 5 }, undefined, undefined);
    expect(p.count).toBe(5);
    expect(p.delay_ms).toBe(DEFAULT_RETRY_POLICY.delay_ms);
  });

  it("endpoint override wins over global", () => {
    const p = resolveRetryPolicy({ count: 5 }, { count: 1 }, undefined);
    expect(p.count).toBe(1);
  });

  it("CLI override wins over endpoint and global", () => {
    const p = resolveRetryPolicy({ count: 5 }, { count: 1 }, 9);
    expect(p.count).toBe(9);
  });

  it("undefined values in override do not overwrite", () => {
    const partial: Partial<ResolvedRetryPolicy> = { count: undefined };
    const p = resolveRetryPolicy(partial, undefined, undefined);
    expect(p.count).toBe(DEFAULT_RETRY_POLICY.count);
  });
});

describe("DEFAULT_RETRY_POLICY", () => {
  it("matches spec defaults (count=2, delay_ms=1000, linear, lenient)", () => {
    expect(DEFAULT_RETRY_POLICY.count).toBe(2);
    expect(DEFAULT_RETRY_POLICY.delay_ms).toBe(1000);
    expect(DEFAULT_RETRY_POLICY.backoff).toBe("linear");
    expect(DEFAULT_RETRY_POLICY.strict).toBe(false);
  });

  it("is frozen", () => {
    expect(Object.isFrozen(DEFAULT_RETRY_POLICY)).toBe(true);
  });
});
