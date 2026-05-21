import { describe, it, expect, vi } from "vitest";

import {
  DEFAULT_ENDPOINT_TIMEOUT_MS,
  withEndpointTimeout,
} from "../../../../src/runner/execute/timeout-watchdog.js";

describe("DEFAULT_ENDPOINT_TIMEOUT_MS", () => {
  it("is a generous-but-bounded positive integer", () => {
    expect(Number.isInteger(DEFAULT_ENDPOINT_TIMEOUT_MS)).toBe(true);
    expect(DEFAULT_ENDPOINT_TIMEOUT_MS).toBeGreaterThan(1_000);
    expect(DEFAULT_ENDPOINT_TIMEOUT_MS).toBeLessThanOrEqual(300_000);
  });
});

describe("withEndpointTimeout", () => {
  it("rejects non-positive / non-integer timeouts", async () => {
    await expect(withEndpointTimeout(0, async () => undefined)).rejects.toThrow(RangeError);
    await expect(withEndpointTimeout(-1, async () => undefined)).rejects.toThrow(RangeError);
    await expect(withEndpointTimeout(1.5, async () => undefined)).rejects.toThrow(RangeError);
    await expect(withEndpointTimeout(Number.NaN, async () => undefined)).rejects.toThrow(RangeError);
  });

  it("resolves with the task's value when it finishes in time", async () => {
    const result = await withEndpointTimeout(1_000, async (signal) => {
      expect(signal.aborted).toBe(false);
      return "ok";
    });
    expect(result.value).toBe("ok");
    expect(result.timedOut).toBe(false);
  });

  it("does not abort the signal when the task finishes early", async () => {
    let observedAborted = false;
    await withEndpointTimeout(1_000, async (signal) => {
      // Yield a tick — the timer is still pending here.
      await new Promise((r) => setImmediate(r));
      observedAborted = signal.aborted;
      return undefined;
    });
    expect(observedAborted).toBe(false);
  });

  it("aborts the signal when the timeout fires", async () => {
    vi.useFakeTimers();
    try {
      const taskStarted: Promise<{ aborted: boolean }> = withEndpointTimeout(50, (signal) =>
        new Promise<{ aborted: boolean }>((resolve) => {
          signal.addEventListener("abort", () => resolve({ aborted: signal.aborted }));
        }),
      ).then((r) => r.value);
      await vi.advanceTimersByTimeAsync(60);
      const v = await taskStarted;
      expect(v.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("sets timedOut=true when the watchdog fires before the task settles", async () => {
    vi.useFakeTimers();
    try {
      const p = withEndpointTimeout(50, (signal) =>
        new Promise<string>((resolve) => {
          signal.addEventListener("abort", () => resolve("aborted"));
        }),
      );
      await vi.advanceTimersByTimeAsync(60);
      const out = await p;
      expect(out.timedOut).toBe(true);
      expect(out.value).toBe("aborted");
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears the timer when the task resolves first (no Node-handle leak)", async () => {
    const clearSpy = vi.spyOn(globalThis, "clearTimeout");
    await withEndpointTimeout(5_000, async () => "fast");
    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });

  it("propagates the inner task's rejection", async () => {
    await expect(
      withEndpointTimeout(1_000, async () => {
        throw new Error("inner boom");
      }),
    ).rejects.toThrow("inner boom");
  });
});
