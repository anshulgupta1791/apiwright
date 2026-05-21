import { afterEach, describe, it, expect, vi } from "vitest";

import {
  currentEndpointId,
  installRejectionAttributor,
  runInEndpointContext,
} from "../../../../src/runner/execute/rejection-attributor.js";

describe("runInEndpointContext + currentEndpointId", () => {
  it("returns undefined outside any context", () => {
    expect(currentEndpointId()).toBeUndefined();
  });

  it("exposes the endpoint id to code inside the context", async () => {
    const seen: string[] = [];
    await runInEndpointContext("foo.bar", async () => {
      seen.push(currentEndpointId() ?? "<undef>");
      await Promise.resolve();
      seen.push(currentEndpointId() ?? "<undef>");
    });
    expect(seen).toEqual(["foo.bar", "foo.bar"]);
    expect(currentEndpointId()).toBeUndefined();
  });

  it("scopes contexts independently for concurrent endpoints", async () => {
    const a: string[] = [];
    const b: string[] = [];
    await Promise.all([
      runInEndpointContext("alpha", async () => {
        a.push(currentEndpointId() ?? "");
        await new Promise((r) => setImmediate(r));
        a.push(currentEndpointId() ?? "");
      }),
      runInEndpointContext("beta", async () => {
        b.push(currentEndpointId() ?? "");
        await new Promise((r) => setImmediate(r));
        b.push(currentEndpointId() ?? "");
      }),
    ]);
    expect(a).toEqual(["alpha", "alpha"]);
    expect(b).toEqual(["beta", "beta"]);
  });

  it("returns the inner function's value", async () => {
    const v = await runInEndpointContext("x", async () => 42);
    expect(v).toBe(42);
  });
});

describe("installRejectionAttributor", () => {
  let uninstalls: Array<() => void> = [];

  afterEach(() => {
    uninstalls.forEach((u) => u());
    uninstalls = [];
  });

  it("routes rejections raised inside a context to onAttribute", async () => {
    const attributed: Array<{ id: string; reason: unknown }> = [];
    const orphans: unknown[] = [];
    uninstalls.push(
      installRejectionAttributor({
        onAttribute: (id, reason) => attributed.push({ id, reason }),
        onUnattributed: (reason) => orphans.push(reason),
      }),
    );

    await runInEndpointContext("ctx-1", async () => {
      // Schedule an unhandled rejection then yield so the event-loop
      // emits it before the context exits.
      void Promise.reject(new Error("escaped"));
      await new Promise((r) => setImmediate(r));
    });
    // Yield once more to ensure the rejection has been processed.
    await new Promise((r) => setImmediate(r));

    expect(attributed).toHaveLength(1);
    expect(attributed[0]?.id).toBe("ctx-1");
    expect(orphans).toHaveLength(0);
  });

  it("routes rejections outside any context to onUnattributed", async () => {
    const attributed: unknown[] = [];
    const orphans: unknown[] = [];
    uninstalls.push(
      installRejectionAttributor({
        onAttribute: (_, reason) => attributed.push(reason),
        onUnattributed: (reason) => orphans.push(reason),
      }),
    );

    void Promise.reject(new Error("orphan"));
    await new Promise((r) => setImmediate(r));

    expect(orphans).toHaveLength(1);
    expect(attributed).toHaveLength(0);
  });

  it("uninstaller removes the listener and is idempotent", () => {
    const beforeCount = process.listenerCount("unhandledRejection");
    const off = installRejectionAttributor({
      onAttribute: vi.fn(),
      onUnattributed: vi.fn(),
    });
    expect(process.listenerCount("unhandledRejection")).toBe(beforeCount + 1);
    off();
    expect(process.listenerCount("unhandledRejection")).toBe(beforeCount);
    // Second call is a no-op.
    off();
    expect(process.listenerCount("unhandledRejection")).toBe(beforeCount);
  });

  it("does not remove other listeners on uninstall", () => {
    const other = vi.fn();
    process.on("unhandledRejection", other);
    const before = process.listenerCount("unhandledRejection");
    const off = installRejectionAttributor({
      onAttribute: vi.fn(),
      onUnattributed: vi.fn(),
    });
    expect(process.listenerCount("unhandledRejection")).toBe(before + 1);
    off();
    expect(process.listenerCount("unhandledRejection")).toBe(before);
    process.off("unhandledRejection", other);
  });
});
