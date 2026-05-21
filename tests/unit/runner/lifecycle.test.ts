import { describe, it, expect } from "vitest";

import { SecretRegistry } from "../../../src/env/index.js";
import { closeLifecycle, openLifecycle } from "../../../src/runner/execute/lifecycle.js";

describe("openLifecycle + closeLifecycle", () => {
  it("opens both registries off the env", () => {
    const lc = openLifecycle({ name: "x", prod: false }, new SecretRegistry());
    expect(lc.connRegistry).toBeDefined();
    expect(lc.authRegistry).toBeDefined();
  });

  it("closeLifecycle does not throw when no connectors were acquired", async () => {
    const lc = openLifecycle({ name: "x", prod: false }, new SecretRegistry());
    await expect(closeLifecycle(lc)).resolves.toBeUndefined();
  });

  it("closeLifecycle is idempotent (calling twice does not throw)", async () => {
    const lc = openLifecycle({ name: "x", prod: false }, new SecretRegistry());
    await closeLifecycle(lc);
    await expect(closeLifecycle(lc)).resolves.toBeUndefined();
  });
});
