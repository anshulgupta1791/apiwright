import { describe, it, expect } from "vitest";

import { createLimit } from "../../../../src/runner/execute/concurrency-limiter.js";

/** Returns a deferred — `{ promise, resolve, reject }`. */
function defer<T>(): {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
} {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("createLimit", () => {
  it("rejects non-positive / non-integer concurrency", () => {
    expect(() => createLimit(0)).toThrow(RangeError);
    expect(() => createLimit(-1)).toThrow(RangeError);
    expect(() => createLimit(1.5)).toThrow(RangeError);
    expect(() => createLimit(Number.NaN)).toThrow(RangeError);
  });

  it("runs tasks sequentially when n = 1", async () => {
    const limit = createLimit(1);
    const trace: string[] = [];
    const t1 = limit(async () => {
      trace.push("a-start");
      await Promise.resolve();
      trace.push("a-end");
      return 1;
    });
    const t2 = limit(async () => {
      trace.push("b-start");
      await Promise.resolve();
      trace.push("b-end");
      return 2;
    });
    const [a, b] = await Promise.all([t1, t2]);
    expect(a).toBe(1);
    expect(b).toBe(2);
    expect(trace).toEqual(["a-start", "a-end", "b-start", "b-end"]);
  });

  it("runs up to n tasks concurrently and queues the rest", async () => {
    const limit = createLimit(3);
    const deferreds = [defer<number>(), defer<number>(), defer<number>(), defer<number>(), defer<number>()];
    let inFlight = 0;
    let peakInFlight = 0;

    const tasks = deferreds.map((d, i) =>
      limit(async () => {
        inFlight++;
        peakInFlight = Math.max(peakInFlight, inFlight);
        const v = await d.promise;
        inFlight--;
        return v + i;
      }),
    );

    // Let scheduling settle so the first three are active.
    await new Promise((r) => setImmediate(r));
    expect(inFlight).toBe(3);
    expect(peakInFlight).toBe(3);

    // Release them one by one and verify queue drains.
    for (let i = 0; i < deferreds.length; i++) {
      const d = deferreds[i];
      if (d) d.resolve(10);
    }
    const results = await Promise.all(tasks);
    expect(results).toEqual([10, 11, 12, 13, 14]);
    expect(peakInFlight).toBe(3);
  });

  it("preserves FIFO submission order for queued tasks", async () => {
    const limit = createLimit(1);
    const completionOrder: number[] = [];
    const tasks: Promise<void>[] = [];
    for (let i = 0; i < 5; i++) {
      tasks.push(
        limit(async () => {
          await Promise.resolve();
          completionOrder.push(i);
        }),
      );
    }
    await Promise.all(tasks);
    expect(completionOrder).toEqual([0, 1, 2, 3, 4]);
  });

  it("releases the slot when a task rejects", async () => {
    const limit = createLimit(1);
    const order: string[] = [];

    const failing = limit(async () => {
      order.push("a");
      throw new Error("boom");
    });

    const following = limit(async () => {
      order.push("b");
      return "ok";
    });

    await expect(failing).rejects.toThrow("boom");
    await expect(following).resolves.toBe("ok");
    expect(order).toEqual(["a", "b"]);
  });

  it("propagates the task's return value unchanged", async () => {
    const limit = createLimit(2);
    const obj = { foo: "bar" };
    const result = await limit(async () => obj);
    expect(result).toBe(obj);
  });

  it("with n >= task count, runs all tasks effectively in parallel", async () => {
    const limit = createLimit(100);
    const deferreds = Array.from({ length: 10 }, () => defer<number>());
    let peak = 0;
    let active = 0;

    const tasks = deferreds.map((d, i) =>
      limit(async () => {
        active++;
        peak = Math.max(peak, active);
        const v = await d.promise;
        active--;
        return v + i;
      }),
    );

    await new Promise((r) => setImmediate(r));
    expect(peak).toBe(10);

    deferreds.forEach((d) => d.resolve(100));
    const results = await Promise.all(tasks);
    expect(results).toEqual([100, 101, 102, 103, 104, 105, 106, 107, 108, 109]);
  });

  it("does not leak slots across many sequential tasks", async () => {
    const limit = createLimit(2);
    for (let i = 0; i < 50; i++) {
      await limit(async () => i);
    }
    // If slots leaked, eventually the limiter would deadlock and the test
    // would time out. Reaching here is the assertion.
    expect(true).toBe(true);
  });
});
