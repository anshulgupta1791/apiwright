import { describe, it, expect } from "vitest";

import { SecretRegistry } from "../../../src/env/index.js";
import {
  REDACT_MAX_DEPTH,
  redactValue,
} from "../../../src/runner/execute/redactor-pipe.js";

describe("redactValue", () => {
  it("redacts a string leaf containing a registered secret", () => {
    const reg = new SecretRegistry();
    reg.add("my-token");
    expect(redactValue("Bearer my-token", reg)).toBe("Bearer [REDACTED]");
  });

  it("passes through non-string primitives", () => {
    const reg = new SecretRegistry();
    expect(redactValue(42, reg)).toBe(42);
    expect(redactValue(true, reg)).toBe(true);
    expect(redactValue(null, reg)).toBeNull();
    expect(redactValue(undefined, reg)).toBeUndefined();
  });

  it("redacts strings inside arrays", () => {
    const reg = new SecretRegistry();
    reg.add("secret-xyz");
    const r = redactValue(["a", "secret-xyz", 1], reg);
    expect(r).toEqual(["a", "[REDACTED]", 1]);
  });

  it("redacts strings inside nested objects", () => {
    const reg = new SecretRegistry();
    reg.add("topsecret");
    const r = redactValue({ headers: { auth: "Bearer topsecret" }, body: { x: 1 } }, reg);
    expect(r).toEqual({ headers: { auth: "Bearer [REDACTED]" }, body: { x: 1 } });
  });

  it("REDACT_MAX_DEPTH is exported as a number", () => {
    expect(typeof REDACT_MAX_DEPTH).toBe("number");
    expect(REDACT_MAX_DEPTH).toBeGreaterThan(0);
  });

  it("clips at REDACT_MAX_DEPTH without throwing", () => {
    const reg = new SecretRegistry();
    reg.add("zzz");
    // Build a deep nested object beyond the cap
    let v: unknown = "zzz";
    for (let i = 0; i < REDACT_MAX_DEPTH + 20; i++) v = { n: v };
    expect(() => redactValue(v, reg)).not.toThrow();
  });
});
