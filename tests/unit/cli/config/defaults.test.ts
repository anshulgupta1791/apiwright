import { describe, it, expect } from "vitest";

import {
  DEFAULT_CONFIG,
  cloneDefaults,
} from "../../../../src/cli/config/defaults.js";

/**
 * Unit tests for DEFAULT_CONFIG and cloneDefaults().
 *
 * Verifies every default value matches the spec example (V1_BUILD_SPEC.md
 * lines 706-727), that the constant is frozen (immutable), and that
 * cloneDefaults() returns a deep-clone (no shared references, fully mutable).
 */
describe("DEFAULT_CONFIG", () => {
  it("exports a non-null object", () => {
    expect(DEFAULT_CONFIG).toBeDefined();
    expect(typeof DEFAULT_CONFIG).toBe("object");
    expect(DEFAULT_CONFIG).not.toBeNull();
  });

  it("has tests_dir='./tests'", () => {
    expect(DEFAULT_CONFIG.tests_dir).toBe("./tests");
  });

  it("has environments_dir='./environments'", () => {
    expect(DEFAULT_CONFIG.environments_dir).toBe("./environments");
  });

  it("has reports_dir='./reports'", () => {
    expect(DEFAULT_CONFIG.reports_dir).toBe("./reports");
  });

  it("has default_env='qa'", () => {
    expect(DEFAULT_CONFIG.default_env).toBe("qa");
  });

  it("has default_markers=['smoke']", () => {
    expect(DEFAULT_CONFIG.default_markers).toEqual(["smoke"]);
  });

  it("has log_level='warn'", () => {
    expect(DEFAULT_CONFIG.log_level).toBe("warn");
  });

  it("has workers=8", () => {
    expect(DEFAULT_CONFIG.workers).toBe(8);
  });

  it("has retry.count=2", () => {
    expect(DEFAULT_CONFIG.retry.count).toBe(2);
  });

  it("has retry.delay_ms=1000", () => {
    expect(DEFAULT_CONFIG.retry.delay_ms).toBe(1000);
  });

  it("has retry.backoff='linear'", () => {
    expect(DEFAULT_CONFIG.retry.backoff).toBe("linear");
  });

  it("has retry.strict=false", () => {
    expect(DEFAULT_CONFIG.retry.strict).toBe(false);
  });

  it("has report.html=true", () => {
    expect(DEFAULT_CONFIG.report.html).toBe(true);
  });

  it("has report.json=true", () => {
    expect(DEFAULT_CONFIG.report.json).toBe(true);
  });

  it("has report.junit_xml=true", () => {
    expect(DEFAULT_CONFIG.report.junit_xml).toBe(true);
  });

  it("has report.output_dir='./reports'", () => {
    expect(DEFAULT_CONFIG.report.output_dir).toBe("./reports");
  });

  it("is frozen (cannot be mutated at top level)", () => {
    expect(Object.isFrozen(DEFAULT_CONFIG)).toBe(true);
  });
});

describe("cloneDefaults()", () => {
  it("returns an object equal in value to DEFAULT_CONFIG", () => {
    const clone = cloneDefaults();
    expect(clone).toEqual(DEFAULT_CONFIG);
  });

  it("returns a new object (not the same reference as DEFAULT_CONFIG)", () => {
    const clone = cloneDefaults();
    expect(clone).not.toBe(DEFAULT_CONFIG);
  });

  it("returns a deep clone — retry object is not shared with DEFAULT_CONFIG", () => {
    const clone = cloneDefaults();
    expect(clone.retry).not.toBe(DEFAULT_CONFIG.retry);
  });

  it("returns a deep clone — report object is not shared with DEFAULT_CONFIG", () => {
    const clone = cloneDefaults();
    expect(clone.report).not.toBe(DEFAULT_CONFIG.report);
  });

  it("returns a deep clone — default_markers array is not shared", () => {
    const clone = cloneDefaults();
    expect(clone.default_markers).not.toBe(DEFAULT_CONFIG.default_markers);
  });

  it("returns a mutable clone (can write to its properties)", () => {
    const clone = cloneDefaults();
    expect(() => {
      clone.default_env = "prod";
    }).not.toThrow();
    expect(clone.default_env).toBe("prod");
    // Original unchanged
    expect(DEFAULT_CONFIG.default_env).toBe("qa");
  });

  it("each call returns a distinct new object", () => {
    const a = cloneDefaults();
    const b = cloneDefaults();
    expect(a).not.toBe(b);
    expect(a.retry).not.toBe(b.retry);
  });
});
