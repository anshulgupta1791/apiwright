import { describe, it, expect, beforeEach } from "vitest";

import {
  ApiwrightConfigSchemaValidator,
  APIWRIGHT_CONFIG_SCHEMA,
  formatConfigErrors,
} from "../../../../src/cli/config/schema.js";

/**
 * Unit tests for the APIWright config schema validator.
 *
 * Covers the APIWRIGHT_CONFIG_SCHEMA constant, formatConfigErrors formatter,
 * and ApiwrightConfigSchemaValidator.validate() across every field constraint
 * documented in the design (§3.1 table), the partial-tolerant empty-object
 * path, the spec example, and non-object input edge cases.
 */
describe("APIWRIGHT_CONFIG_SCHEMA", () => {
  it("is a non-null object (exported constant exists)", () => {
    expect(APIWRIGHT_CONFIG_SCHEMA).toBeDefined();
    expect(typeof APIWRIGHT_CONFIG_SCHEMA).toBe("object");
    expect(APIWRIGHT_CONFIG_SCHEMA).not.toBeNull();
  });
});

describe("formatConfigErrors()", () => {
  it("returns an empty array when errors is undefined", () => {
    expect(formatConfigErrors(undefined)).toEqual([]);
  });

  it("returns an empty array when errors is an empty array", () => {
    expect(formatConfigErrors([])).toEqual([]);
  });

  it("formats an error with an instance path as '<path> <message>'", () => {
    const result = formatConfigErrors([
      {
        instancePath: "/log_level",
        message: "must be one of error, warn, info, debug",
      },
    ]);
    expect(result).toEqual([
      "/log_level must be one of error, warn, info, debug",
    ]);
  });

  it("uses 'root' when instancePath is empty", () => {
    const result = formatConfigErrors([
      { instancePath: "", message: "must be object" },
    ]);
    expect(result).toEqual(["root must be object"]);
  });

  it("uses 'root' when instancePath is absent", () => {
    const result = formatConfigErrors([{ message: "must be object" }]);
    expect(result).toEqual(["root must be object"]);
  });

  it("formats multiple errors, one per element", () => {
    const result = formatConfigErrors([
      { instancePath: "/workers", message: "must be a positive integer" },
      {
        instancePath: "/log_level",
        message: "must be one of error, warn, info, debug",
      },
    ]);
    expect(result).toHaveLength(2);
    expect(result[0]).toContain("/workers");
    expect(result[1]).toContain("/log_level");
  });
});

describe("ApiwrightConfigSchemaValidator.validate()", () => {
  let validator: ApiwrightConfigSchemaValidator;

  beforeEach(() => {
    validator = new ApiwrightConfigSchemaValidator();
  });

  // --- Valid inputs ---

  it("accepts an empty object (all fields optional — partial-tolerant schema)", () => {
    const result = validator.validate({});
    expect(result.valid).toBe(true);
    expect(result.errors).toBeUndefined();
  });

  it("accepts the spec example config from V1_BUILD_SPEC.md lines 706-727", () => {
    const specExample = {
      tests_dir: "./tests",
      environments_dir: "./environments",
      reports_dir: "./reports",
      default_env: "qa",
      default_markers: ["smoke"],
      log_level: "warn",
      workers: 8,
      retry: {
        count: 2,
        delay_ms: 1000,
        backoff: "linear",
        strict: false,
      },
      report: {
        html: true,
        json: true,
        junit_xml: true,
        output_dir: "./reports",
      },
    };
    const result = validator.validate(specExample);
    expect(result.valid).toBe(true);
    expect(result.errors).toBeUndefined();
  });

  it("accepts a config with only log_level set (all other keys absent)", () => {
    const result = validator.validate({ log_level: "debug" });
    expect(result.valid).toBe(true);
  });

  it("accepts a config with only retry block set", () => {
    const result = validator.validate({
      retry: { count: 0, delay_ms: 500, backoff: "exponential", strict: true },
    });
    expect(result.valid).toBe(true);
  });

  it("accepts a config with only report block set", () => {
    const result = validator.validate({
      report: {
        html: false,
        json: true,
        junit_xml: false,
        output_dir: "./out",
      },
    });
    expect(result.valid).toBe(true);
  });

  it("accepts workers=1 (minimum valid positive integer)", () => {
    const result = validator.validate({ workers: 1 });
    expect(result.valid).toBe(true);
  });

  it("accepts retry.count=0 (minimum valid retry count)", () => {
    const result = validator.validate({ retry: { count: 0 } });
    expect(result.valid).toBe(true);
  });

  it("accepts retry.count=5 (maximum valid retry count)", () => {
    const result = validator.validate({ retry: { count: 5 } });
    expect(result.valid).toBe(true);
  });

  it("accepts all three backoff strategies", () => {
    for (const backoff of ["none", "linear", "exponential"]) {
      const result = validator.validate({ retry: { backoff } });
      expect(result.valid).toBe(true);
    }
  });

  it("accepts all four log levels", () => {
    for (const log_level of ["error", "warn", "info", "debug"]) {
      const result = validator.validate({ log_level });
      expect(result.valid).toBe(true);
    }
  });

  it("accepts default_markers with multiple valid values", () => {
    const result = validator.validate({
      default_markers: ["smoke", "regression", "e2e"],
    });
    expect(result.valid).toBe(true);
  });

  // --- Invalid: non-object inputs ---

  it("rejects null with a single clear error", () => {
    const result = validator.validate(null);
    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors!.length).toBeGreaterThan(0);
  });

  it("rejects an array with a clear error", () => {
    const result = validator.validate([]);
    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
  });

  it("rejects a string with a clear error", () => {
    const result = validator.validate("config");
    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
  });

  it("rejects a number with a clear error", () => {
    const result = validator.validate(42);
    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
  });

  // --- Invalid: log_level enum ---

  it("rejects log_level 'verbose' with a message naming the field", () => {
    const result = validator.validate({ log_level: "verbose" });
    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors!.join(" ")).toContain("log_level");
  });

  it("rejects log_level as a number", () => {
    const result = validator.validate({ log_level: 3 });
    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
  });

  it("rejects empty string log_level", () => {
    const result = validator.validate({ log_level: "" });
    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
  });

  // --- Invalid: retry.backoff enum ---

  it("rejects retry.backoff 'constant' with a clear message", () => {
    const result = validator.validate({ retry: { backoff: "constant" } });
    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors!.join(" ")).toContain("backoff");
  });

  // --- Invalid: retry.count range ---

  it("rejects retry.count=6 (above maximum of 5)", () => {
    const result = validator.validate({ retry: { count: 6 } });
    expect(result.valid).toBe(false);
    expect(result.errors!.join(" ")).toContain("count");
  });

  it("rejects retry.count=-1 (below minimum of 0)", () => {
    const result = validator.validate({ retry: { count: -1 } });
    expect(result.valid).toBe(false);
    expect(result.errors!.join(" ")).toContain("count");
  });

  it("rejects retry.count as a float", () => {
    const result = validator.validate({ retry: { count: 1.5 } });
    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
  });

  it("rejects retry.count as a string", () => {
    const result = validator.validate({ retry: { count: "2" } });
    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
  });

  // --- Invalid: retry.delay_ms ---

  it("rejects retry.delay_ms=-1 (negative)", () => {
    const result = validator.validate({ retry: { delay_ms: -1 } });
    expect(result.valid).toBe(false);
    expect(result.errors!.join(" ")).toContain("delay_ms");
  });

  it("rejects retry.delay_ms as a float", () => {
    const result = validator.validate({ retry: { delay_ms: 1.5 } });
    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
  });

  // --- Invalid: retry.strict ---

  it("rejects retry.strict as a non-boolean", () => {
    const result = validator.validate({ retry: { strict: "true" } });
    expect(result.valid).toBe(false);
    expect(result.errors!.join(" ")).toContain("strict");
  });

  // --- Invalid: workers ---

  it("rejects workers=0 (below minimum of 1)", () => {
    const result = validator.validate({ workers: 0 });
    expect(result.valid).toBe(false);
    expect(result.errors!.join(" ")).toContain("workers");
  });

  it("rejects workers as a float", () => {
    const result = validator.validate({ workers: 8.5 });
    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
  });

  it("rejects workers as a string", () => {
    const result = validator.validate({ workers: "8" });
    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
  });

  // --- Invalid: default_markers ---

  it("rejects default_markers containing an unknown marker", () => {
    const result = validator.validate({ default_markers: ["smoke", "all"] });
    expect(result.valid).toBe(false);
    expect(result.errors!.join(" ")).toContain("default_markers");
  });

  it("rejects default_markers as a non-array", () => {
    const result = validator.validate({ default_markers: "smoke" });
    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
  });

  // --- Invalid: string fields empty ---

  it("rejects tests_dir as empty string", () => {
    const result = validator.validate({ tests_dir: "" });
    expect(result.valid).toBe(false);
    expect(result.errors!.join(" ")).toContain("tests_dir");
  });

  it("rejects environments_dir as empty string", () => {
    const result = validator.validate({ environments_dir: "" });
    expect(result.valid).toBe(false);
    expect(result.errors!.join(" ")).toContain("environments_dir");
  });

  it("rejects reports_dir as empty string", () => {
    const result = validator.validate({ reports_dir: "" });
    expect(result.valid).toBe(false);
    expect(result.errors!.join(" ")).toContain("reports_dir");
  });

  it("rejects default_env as empty string", () => {
    const result = validator.validate({ default_env: "" });
    expect(result.valid).toBe(false);
    expect(result.errors!.join(" ")).toContain("default_env");
  });

  // --- Invalid: report fields ---

  it("rejects report.html as non-boolean", () => {
    const result = validator.validate({ report: { html: "true" } });
    expect(result.valid).toBe(false);
    expect(result.errors!.join(" ")).toContain("html");
  });

  it("rejects report.json as non-boolean", () => {
    const result = validator.validate({ report: { json: 1 } });
    expect(result.valid).toBe(false);
    expect(result.errors!.join(" ")).toContain("json");
  });

  it("rejects report.junit_xml as non-boolean", () => {
    const result = validator.validate({ report: { junit_xml: 0 } });
    expect(result.valid).toBe(false);
    expect(result.errors!.join(" ")).toContain("junit_xml");
  });

  it("rejects report.output_dir as empty string", () => {
    const result = validator.validate({ report: { output_dir: "" } });
    expect(result.valid).toBe(false);
    expect(result.errors!.join(" ")).toContain("output_dir");
  });

  // --- additionalProperties ---

  it("rejects an unknown top-level key with the named additionalProperties message", () => {
    const result = validator.validate({ unknown_field: "x" });
    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors!.join(" ").toLowerCase()).toContain("unknown");
  });

  it("rejects an unknown key inside retry block", () => {
    const result = validator.validate({ retry: { unknown_retry_key: true } });
    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
  });

  it("rejects an unknown key inside report block", () => {
    const result = validator.validate({ report: { unknown_report_key: "x" } });
    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
  });

  // --- Result shape ---

  it("returns { valid: true } with no errors property when input is valid", () => {
    const result = validator.validate({ log_level: "info" });
    expect(result.valid).toBe(true);
    expect(result.errors).toBeUndefined();
  });

  it("returns { valid: false, errors: string[] } when input is invalid", () => {
    const result = validator.validate({ workers: 0 });
    expect(result.valid).toBe(false);
    expect(Array.isArray(result.errors)).toBe(true);
    expect(result.errors!.every((e) => typeof e === "string")).toBe(true);
  });

  it("aggregates multiple errors into the errors array", () => {
    const result = validator.validate({
      log_level: "INVALID",
      workers: 0,
      retry: { count: 99 },
    });
    expect(result.valid).toBe(false);
    expect(result.errors!.length).toBeGreaterThanOrEqual(2);
  });
});
