import { describe, it, expect } from "vitest";

import {
  ConfigError,
  ValidationFailedError,
  ProdSafetyAbortError,
  NotImplementedError,
  CliError,
} from "../../../src/cli/errors.js";
import { ExitCode } from "../../../src/cli/exit-codes.js";

/**
 * Unit tests for the CliError hierarchy.
 *
 * Covers: instanceof relationships, message preservation, exit code
 * assignments, NotImplementedError message format, and name property.
 */
describe("CliError hierarchy", () => {
  describe("ConfigError", () => {
    it("is an instance of Error", () => {
      expect(new ConfigError("bad flag")).toBeInstanceOf(Error);
    });

    it("is an instance of CliError", () => {
      expect(new ConfigError("bad flag")).toBeInstanceOf(CliError);
    });

    it("preserves the message", () => {
      const err = new ConfigError("invalid --log value");
      expect(err.message).toBe("invalid --log value");
    });

    it("has code ExitCode.USAGE (2)", () => {
      const err = new ConfigError("usage error");
      expect(err.code).toBe(ExitCode.USAGE);
    });

    it("has name 'ConfigError'", () => {
      const err = new ConfigError("x");
      expect(err.name).toBe("ConfigError");
    });
  });

  describe("ValidationFailedError", () => {
    it("is an instance of CliError", () => {
      expect(new ValidationFailedError("invalid files")).toBeInstanceOf(
        CliError,
      );
    });

    it("preserves the message", () => {
      const err = new ValidationFailedError("2 files failed");
      expect(err.message).toBe("2 files failed");
    });

    it("has code ExitCode.VALIDATION (3)", () => {
      const err = new ValidationFailedError("fail");
      expect(err.code).toBe(ExitCode.VALIDATION);
    });

    it("has name 'ValidationFailedError'", () => {
      const err = new ValidationFailedError("x");
      expect(err.name).toBe("ValidationFailedError");
    });
  });

  describe("ProdSafetyAbortError", () => {
    it("is an instance of CliError", () => {
      expect(new ProdSafetyAbortError("aborted")).toBeInstanceOf(CliError);
    });

    it("preserves the message", () => {
      const err = new ProdSafetyAbortError("user declined");
      expect(err.message).toBe("user declined");
    });

    it("has code ExitCode.PROD_SAFETY (4)", () => {
      const err = new ProdSafetyAbortError("abort");
      expect(err.code).toBe(ExitCode.PROD_SAFETY);
    });

    it("has name 'ProdSafetyAbortError'", () => {
      const err = new ProdSafetyAbortError("x");
      expect(err.name).toBe("ProdSafetyAbortError");
    });
  });

  describe("NotImplementedError", () => {
    it("is an instance of CliError", () => {
      expect(new NotImplementedError("`apiwright run`", 10)).toBeInstanceOf(
        CliError,
      );
    });

    it("has code ExitCode.NOT_IMPLEMENTED (5)", () => {
      const err = new NotImplementedError("`apiwright run`", 10);
      expect(err.code).toBe(ExitCode.NOT_IMPLEMENTED);
    });

    it("message contains the feature name", () => {
      const err = new NotImplementedError("`apiwright import postman`", 4);
      expect(err.message).toContain("`apiwright import postman`");
    });

    it("message contains 'Task #<n>' with the task number", () => {
      const err = new NotImplementedError("`apiwright run`", 10);
      expect(err.message).toContain("Task #10");
    });

    it("message contains 'Task #4' for postman importer", () => {
      const err = new NotImplementedError("`apiwright import postman`", 4);
      expect(err.message).toContain("Task #4");
    });

    it("message contains 'Task #5' for openapi importer", () => {
      const err = new NotImplementedError("`apiwright import openapi`", 5);
      expect(err.message).toContain("Task #5");
    });

    it("message contains 'Task #11' for docs generator", () => {
      const err = new NotImplementedError("`apiwright docs generate`", 11);
      expect(err.message).toContain("Task #11");
    });

    it("message contains 'not yet implemented'", () => {
      const err = new NotImplementedError("`apiwright run`", 10);
      expect(err.message.toLowerCase()).toContain("not yet implemented");
    });

    it("has name 'NotImplementedError'", () => {
      const err = new NotImplementedError("`apiwright run`", 10);
      expect(err.name).toBe("NotImplementedError");
    });
  });

  describe("instanceof relationships", () => {
    it("ConfigError is not an instance of ValidationFailedError", () => {
      expect(new ConfigError("x")).not.toBeInstanceOf(ValidationFailedError);
    });

    it("ValidationFailedError is not an instance of ConfigError", () => {
      expect(new ValidationFailedError("x")).not.toBeInstanceOf(ConfigError);
    });

    it("all error types are instances of CliError", () => {
      const errors = [
        new ConfigError("x"),
        new ValidationFailedError("x"),
        new ProdSafetyAbortError("x"),
        new NotImplementedError("f", 1),
      ];
      for (const err of errors) {
        expect(err).toBeInstanceOf(CliError);
      }
    });

    it("all error types are instances of Error", () => {
      const errors = [
        new ConfigError("x"),
        new ValidationFailedError("x"),
        new ProdSafetyAbortError("x"),
        new NotImplementedError("f", 1),
      ];
      for (const err of errors) {
        expect(err).toBeInstanceOf(Error);
      }
    });
  });
});
