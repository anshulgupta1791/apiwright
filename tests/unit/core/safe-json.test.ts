import { describe, it, expect } from "vitest";

import { parseJson } from "../../../src/core/safe-json.js";

describe("parseJson", () => {
  it("parses a valid JSON object", () => {
    const result = parseJson('{"a":1,"b":"x"}');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ a: 1, b: "x" });
    }
  });

  it("parses a valid JSON array", () => {
    const result = parseJson("[1,2,3]");
    expect(result).toEqual({ ok: true, value: [1, 2, 3] });
  });

  it("parses a JSON primitive", () => {
    expect(parseJson("true")).toEqual({ ok: true, value: true });
    expect(parseJson("42")).toEqual({ ok: true, value: 42 });
    expect(parseJson('"hello"')).toEqual({ ok: true, value: "hello" });
    expect(parseJson("null")).toEqual({ ok: true, value: null });
  });

  it("returns ok:false with a message for malformed JSON", () => {
    const result = parseJson("{not valid}");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.length).toBeGreaterThan(0);
    }
  });

  it("returns ok:false for an empty string", () => {
    const result = parseJson("");
    expect(result.ok).toBe(false);
  });

  it("returns ok:false for a truncated object", () => {
    const result = parseJson('{"a":');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(typeof result.error).toBe("string");
    }
  });
});
