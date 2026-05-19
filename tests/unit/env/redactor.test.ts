import { describe, it, expect } from "vitest";

import { SecretRegistry } from "../../../src/env/secrets.js";
import { redactSecrets, REDACTION_PLACEHOLDER } from "../../../src/env/redactor.js";

describe("redactSecrets", () => {
  it("placeholder is the spec-mandated literal [REDACTED]", () => {
    expect(REDACTION_PLACEHOLDER).toBe("[REDACTED]");
  });

  it("replaces every occurrence of a single recorded secret", () => {
    const reg = new SecretRegistry();
    reg.add("s3cr3t");
    const out = redactSecrets("token=s3cr3t and again s3cr3t end", reg);
    expect(out).toBe("token=[REDACTED] and again [REDACTED] end");
  });

  it("replaces multiple distinct recorded secrets", () => {
    const reg = new SecretRegistry();
    reg.add("AAA");
    reg.add("BBB");
    expect(redactSecrets("x=AAA y=BBB", reg)).toBe("x=[REDACTED] y=[REDACTED]");
  });

  it("redacts longest-first so a substring secret cannot corrupt the longer one", () => {
    const reg = new SecretRegistry();
    reg.add("abc");
    reg.add("abcdef");
    // "abcdef" must be replaced wholesale, NOT become "[REDACTED]def"
    expect(redactSecrets("value=abcdef", reg)).toBe("value=[REDACTED]");
  });

  it("leaves text unchanged when no recorded secret is present", () => {
    const reg = new SecretRegistry();
    reg.add("nope");
    expect(redactSecrets("nothing sensitive here", reg)).toBe("nothing sensitive here");
  });

  it("returns text unchanged for an empty registry", () => {
    expect(redactSecrets("plain text", new SecretRegistry())).toBe("plain text");
  });

  it("defensively skips a zero-length recorded value (no over-redaction)", () => {
    const reg = new SecretRegistry();
    reg.add("");
    expect(redactSecrets("untouched", reg)).toBe("untouched");
  });

  it("redacts a secret embedded inside a JSON-serialized string", () => {
    const reg = new SecretRegistry();
    reg.add("pk_live_9");
    const serialized = JSON.stringify({ apiKey: "pk_live_9", note: "ok" });
    expect(redactSecrets(serialized, reg)).toBe(
      JSON.stringify({ apiKey: "[REDACTED]", note: "ok" }),
    );
  });
});
