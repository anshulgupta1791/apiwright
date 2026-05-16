import { describe, it, expect } from "vitest";

import { ExitCode, errorToExitCode } from "../../../src/cli/exit-codes.js";
import {
  ConfigError,
  ValidationFailedError,
  ProdSafetyAbortError,
  NotImplementedError,
} from "../../../src/cli/errors.js";

/**
 * Unit tests for the ExitCode enum and errorToExitCode().
 *
 * Verifies each code's numeric value, that the mapping function correctly
 * routes CliError subclasses to their declared code and any non-CliError to
 * INTERNAL, and edge cases (thrown string, thrown number).
 */
describe("ExitCode enum", () => {
  it("SUCCESS is 0", () => {
    expect(ExitCode.SUCCESS).toBe(0);
  });

  it("USAGE is 2", () => {
    expect(ExitCode.USAGE).toBe(2);
  });

  it("VALIDATION is 3", () => {
    expect(ExitCode.VALIDATION).toBe(3);
  });

  it("PROD_SAFETY is 4", () => {
    expect(ExitCode.PROD_SAFETY).toBe(4);
  });

  it("NOT_IMPLEMENTED is 5", () => {
    expect(ExitCode.NOT_IMPLEMENTED).toBe(5);
  });

  it("INTERNAL is 70", () => {
    expect(ExitCode.INTERNAL).toBe(70);
  });

  it("codes are all distinct values", () => {
    const codes = [
      ExitCode.SUCCESS,
      ExitCode.USAGE,
      ExitCode.VALIDATION,
      ExitCode.PROD_SAFETY,
      ExitCode.NOT_IMPLEMENTED,
      ExitCode.INTERNAL,
    ];
    const unique = new Set(codes);
    expect(unique.size).toBe(codes.length);
  });

  it("1 is NOT one of the defined exit codes (generic crash is distinguishable)", () => {
    const codes = [
      ExitCode.SUCCESS,
      ExitCode.USAGE,
      ExitCode.VALIDATION,
      ExitCode.PROD_SAFETY,
      ExitCode.NOT_IMPLEMENTED,
      ExitCode.INTERNAL,
    ];
    expect(codes).not.toContain(1);
  });
});

describe("errorToExitCode()", () => {
  it("maps ConfigError → ExitCode.USAGE", () => {
    expect(errorToExitCode(new ConfigError("bad"))).toBe(ExitCode.USAGE);
  });

  it("maps ValidationFailedError → ExitCode.VALIDATION", () => {
    expect(errorToExitCode(new ValidationFailedError("invalid"))).toBe(
      ExitCode.VALIDATION,
    );
  });

  it("maps ProdSafetyAbortError → ExitCode.PROD_SAFETY", () => {
    expect(errorToExitCode(new ProdSafetyAbortError("abort"))).toBe(
      ExitCode.PROD_SAFETY,
    );
  });

  it("maps NotImplementedError → ExitCode.NOT_IMPLEMENTED", () => {
    expect(errorToExitCode(new NotImplementedError("f", 10))).toBe(
      ExitCode.NOT_IMPLEMENTED,
    );
  });

  it("maps a plain Error to ExitCode.INTERNAL", () => {
    expect(errorToExitCode(new Error("unexpected"))).toBe(ExitCode.INTERNAL);
  });

  it("maps a thrown string to ExitCode.INTERNAL", () => {
    expect(errorToExitCode("something exploded")).toBe(ExitCode.INTERNAL);
  });

  it("maps a thrown number to ExitCode.INTERNAL", () => {
    expect(errorToExitCode(42)).toBe(ExitCode.INTERNAL);
  });

  it("maps null to ExitCode.INTERNAL", () => {
    expect(errorToExitCode(null)).toBe(ExitCode.INTERNAL);
  });

  it("maps undefined to ExitCode.INTERNAL", () => {
    expect(errorToExitCode(undefined)).toBe(ExitCode.INTERNAL);
  });

  it("maps a plain object to ExitCode.INTERNAL", () => {
    expect(errorToExitCode({ code: 1, msg: "oops" })).toBe(ExitCode.INTERNAL);
  });

  it("is a pure function — has no side effects", () => {
    const err = new ConfigError("x");
    // calling twice returns same result
    expect(errorToExitCode(err)).toBe(errorToExitCode(err));
  });
});
