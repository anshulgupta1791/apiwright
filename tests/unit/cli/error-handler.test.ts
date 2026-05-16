import { describe, it, expect, vi } from "vitest";

import { handleCliError } from "../../../src/cli/error-handler.js";
import {
  ConfigError,
  ValidationFailedError,
  ProdSafetyAbortError,
  NotImplementedError,
} from "../../../src/cli/errors.js";
import { ExitCode } from "../../../src/cli/exit-codes.js";
import type { Logger } from "../../../src/cli/logging/logger.js";

/**
 * Unit tests for handleCliError().
 *
 * Uses a fake Logger and a fake exit function (throws a sentinel) to exercise
 * every branch: CliError subclasses, non-CliError, non-Error thrown values,
 * debug-level stack emission, non-debug stack suppression.
 */

/** Sentinel thrown by fake exit so test can assert the code. */
class FakeExitError extends Error {
  constructor(public readonly code: ExitCode) {
    super(`exit(${code})`);
    this.name = "FakeExitError";
  }
}

/** Creates a fake Logger that captures all calls. */
function makeFakeLogger(
  level: "error" | "warn" | "info" | "debug" = "warn",
): Logger & {
  calls: { method: string; message: string }[];
} {
  const calls: { method: string; message: string }[] = [];
  return {
    level,
    error: vi.fn((msg: string) => {
      calls.push({ method: "error", message: msg });
    }),
    warn: vi.fn((msg: string) => {
      calls.push({ method: "warn", message: msg });
    }),
    info: vi.fn((msg: string) => {
      calls.push({ method: "info", message: msg });
    }),
    debug: vi.fn((msg: string) => {
      calls.push({ method: "debug", message: msg });
    }),
    calls,
  };
}

/** Creates a fake exit function that throws FakeExitError for assertion. */
function makeFakeExit(): (code: ExitCode) => never {
  return (code: ExitCode): never => {
    throw new FakeExitError(code);
  };
}

describe("handleCliError()", () => {
  describe("ConfigError handling", () => {
    it("calls logger.error with the error message", () => {
      const logger = makeFakeLogger();
      const exit = makeFakeExit();
      expect(() =>
        handleCliError(new ConfigError("bad flag --log"), { logger, exit }),
      ).toThrow(FakeExitError);
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("bad flag --log"),
      );
    });

    it("exits with ExitCode.USAGE (2)", () => {
      const logger = makeFakeLogger();
      const exit = makeFakeExit();
      try {
        handleCliError(new ConfigError("x"), { logger, exit });
      } catch (e) {
        expect((e as FakeExitError).code).toBe(ExitCode.USAGE);
      }
    });

    it("does NOT emit stack at non-debug log level", () => {
      const logger = makeFakeLogger("warn");
      const exit = makeFakeExit();
      try {
        handleCliError(new ConfigError("no stack please"), { logger, exit });
      } catch {
        // ignore exit
      }
      const debugCalls = logger.calls.filter((c) => c.method === "debug");
      expect(debugCalls.length).toBe(0);
    });
  });

  describe("ValidationFailedError handling", () => {
    it("exits with ExitCode.VALIDATION (3)", () => {
      const logger = makeFakeLogger();
      const exit = makeFakeExit();
      try {
        handleCliError(new ValidationFailedError("2 invalid"), {
          logger,
          exit,
        });
      } catch (e) {
        expect((e as FakeExitError).code).toBe(ExitCode.VALIDATION);
      }
    });

    it("logs the error message", () => {
      const logger = makeFakeLogger();
      const exit = makeFakeExit();
      try {
        handleCliError(new ValidationFailedError("files failed"), {
          logger,
          exit,
        });
      } catch {
        // ignore exit
      }
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("files failed"),
      );
    });
  });

  describe("ProdSafetyAbortError handling", () => {
    it("exits with ExitCode.PROD_SAFETY (4)", () => {
      const logger = makeFakeLogger();
      const exit = makeFakeExit();
      try {
        handleCliError(new ProdSafetyAbortError("declined"), { logger, exit });
      } catch (e) {
        expect((e as FakeExitError).code).toBe(ExitCode.PROD_SAFETY);
      }
    });
  });

  describe("NotImplementedError handling", () => {
    it("exits with ExitCode.NOT_IMPLEMENTED (5)", () => {
      const logger = makeFakeLogger();
      const exit = makeFakeExit();
      try {
        handleCliError(new NotImplementedError("`apiwright run`", 10), {
          logger,
          exit,
        });
      } catch (e) {
        expect((e as FakeExitError).code).toBe(ExitCode.NOT_IMPLEMENTED);
      }
    });

    it("message contains Task #10 when logged", () => {
      const logger = makeFakeLogger();
      const exit = makeFakeExit();
      try {
        handleCliError(new NotImplementedError("`apiwright run`", 10), {
          logger,
          exit,
        });
      } catch {
        // ignore exit
      }
      const allMessages = logger.calls.map((c) => c.message).join(" ");
      expect(allMessages).toContain("Task #10");
    });
  });

  describe("non-CliError (unexpected error) handling", () => {
    it("exits with ExitCode.INTERNAL (70) for a plain Error", () => {
      const logger = makeFakeLogger();
      const exit = makeFakeExit();
      try {
        handleCliError(new Error("unexpected!"), { logger, exit });
      } catch (e) {
        expect((e as FakeExitError).code).toBe(ExitCode.INTERNAL);
      }
    });

    it("logs a generic 'unexpected error' message for plain Error", () => {
      const logger = makeFakeLogger();
      const exit = makeFakeExit();
      try {
        handleCliError(new Error("boom"), { logger, exit });
      } catch {
        // ignore exit
      }
      const allMessages = logger.calls
        .map((c) => c.message)
        .join(" ")
        .toLowerCase();
      expect(allMessages).toContain("unexpected");
    });

    it("exits with ExitCode.INTERNAL for a thrown string", () => {
      const logger = makeFakeLogger();
      const exit = makeFakeExit();
      try {
        handleCliError("a string was thrown", { logger, exit });
      } catch (e) {
        expect((e as FakeExitError).code).toBe(ExitCode.INTERNAL);
      }
    });

    it("exits with ExitCode.INTERNAL for a thrown number", () => {
      const logger = makeFakeLogger();
      const exit = makeFakeExit();
      try {
        handleCliError(42, { logger, exit });
      } catch (e) {
        expect((e as FakeExitError).code).toBe(ExitCode.INTERNAL);
      }
    });

    it("exits with ExitCode.INTERNAL for null", () => {
      const logger = makeFakeLogger();
      const exit = makeFakeExit();
      try {
        handleCliError(null, { logger, exit });
      } catch (e) {
        expect((e as FakeExitError).code).toBe(ExitCode.INTERNAL);
      }
    });

    it("coerces thrown non-Error via String() into the error message", () => {
      const logger = makeFakeLogger();
      const exit = makeFakeExit();
      try {
        handleCliError("a raw string error", { logger, exit });
      } catch {
        // ignore exit
      }
      const allMessages = logger.calls.map((c) => c.message).join(" ");
      expect(allMessages).toContain("a raw string error");
    });
  });

  describe("debug level — stack trace emission", () => {
    it("emits the stack at debug log level for a CliError", () => {
      const logger = makeFakeLogger("debug");
      const exit = makeFakeExit();
      const err = new ConfigError("debug trace test");
      try {
        handleCliError(err, { logger, exit });
      } catch {
        // ignore exit
      }
      const debugCalls = logger.calls.filter((c) => c.method === "debug");
      expect(debugCalls.length).toBeGreaterThan(0);
    });

    it("emits the stack at debug log level for a plain Error", () => {
      const logger = makeFakeLogger("debug");
      const exit = makeFakeExit();
      const err = new Error("internal debug trace");
      try {
        handleCliError(err, { logger, exit });
      } catch {
        // ignore exit
      }
      const debugCalls = logger.calls.filter((c) => c.method === "debug");
      expect(debugCalls.length).toBeGreaterThan(0);
    });

    it("suppresses stack at error log level", () => {
      const logger = makeFakeLogger("error");
      const exit = makeFakeExit();
      try {
        handleCliError(new ConfigError("no debug at error level"), {
          logger,
          exit,
        });
      } catch {
        // ignore exit
      }
      const debugCalls = logger.calls.filter((c) => c.method === "debug");
      expect(debugCalls.length).toBe(0);
    });

    it("suppresses stack at info log level", () => {
      const logger = makeFakeLogger("info");
      const exit = makeFakeExit();
      try {
        handleCliError(new ConfigError("no stack at info"), { logger, exit });
      } catch {
        // ignore exit
      }
      const debugCalls = logger.calls.filter((c) => c.method === "debug");
      expect(debugCalls.length).toBe(0);
    });
  });

  describe("injectable exit seam", () => {
    it("calls the injected exit function with the correct code (not process.exit)", () => {
      const mockExit = vi.fn().mockImplementation(() => {
        throw new FakeExitError(ExitCode.USAGE);
      });
      const logger = makeFakeLogger();
      try {
        handleCliError(new ConfigError("test injection"), {
          logger,
          exit: mockExit,
        });
      } catch {
        // ignore
      }
      expect(mockExit).toHaveBeenCalledWith(ExitCode.USAGE);
    });

    it("calls exit exactly once per invocation", () => {
      const mockExit = vi.fn().mockImplementation((): never => {
        throw new FakeExitError(ExitCode.USAGE);
      });
      const logger = makeFakeLogger();
      try {
        handleCliError(new ConfigError("once"), { logger, exit: mockExit });
      } catch {
        // ignore
      }
      expect(mockExit).toHaveBeenCalledTimes(1);
    });
  });

  describe("debug-stack branch — CliError with and without stack", () => {
    it("emits err.stack when the CliError has a stack property", () => {
      const logger = makeFakeLogger("debug");
      const exit = makeFakeExit();
      const err = new ConfigError("with-stack");
      // ConfigError (inherits from Error) will have a stack in V8
      expect(err.stack).toBeDefined();
      try {
        handleCliError(err, { logger, exit });
      } catch {
        // ignore FakeExitError
      }
      const debugCalls = logger.calls.filter((c) => c.method === "debug");
      expect(debugCalls.length).toBeGreaterThan(0);
      expect(debugCalls[0]?.message).toContain("ConfigError");
    });

    it("emits empty string when CliError has no stack (err.stack ?? '' fallback)", () => {
      const logger = makeFakeLogger("debug");
      const exit = makeFakeExit();
      const err = new ConfigError("no-stack");
      // Force-delete the stack to hit the ?? '' branch
      delete (err as { stack?: string }).stack;
      expect(err.stack).toBeUndefined();
      try {
        handleCliError(err, { logger, exit });
      } catch {
        // ignore FakeExitError
      }
      const debugCalls = logger.calls.filter((c) => c.method === "debug");
      expect(debugCalls.length).toBeGreaterThan(0);
      // fallback is empty string
      expect(debugCalls[0]?.message).toBe("");
    });
  });

  describe("debug-stack branch — non-Error thrown values", () => {
    it("emits String(err) when a non-Error (string) is thrown at debug level", () => {
      const logger = makeFakeLogger("debug");
      const exit = makeFakeExit();
      try {
        handleCliError("a raw thrown string", { logger, exit });
      } catch {
        // ignore FakeExitError
      }
      const debugCalls = logger.calls.filter((c) => c.method === "debug");
      expect(debugCalls.length).toBeGreaterThan(0);
      expect(debugCalls[0]?.message).toContain("a raw thrown string");
    });

    it("emits String(err) when a non-Error (number) is thrown at debug level", () => {
      const logger = makeFakeLogger("debug");
      const exit = makeFakeExit();
      try {
        handleCliError(99, { logger, exit });
      } catch {
        // ignore FakeExitError
      }
      const debugCalls = logger.calls.filter((c) => c.method === "debug");
      expect(debugCalls.length).toBeGreaterThan(0);
      expect(debugCalls[0]?.message).toBe("99");
    });

    it("emits err.stack when a plain Error (non-CliError) is thrown at debug level", () => {
      const logger = makeFakeLogger("debug");
      const exit = makeFakeExit();
      const err = new Error("plain error with stack");
      expect(err.stack).toBeDefined();
      try {
        handleCliError(err, { logger, exit });
      } catch {
        // ignore FakeExitError
      }
      const debugCalls = logger.calls.filter((c) => c.method === "debug");
      expect(debugCalls.length).toBeGreaterThan(0);
      expect(debugCalls[0]?.message).toContain("Error");
    });

    it("emits empty string when plain Error has no stack at debug level (stack ?? '' fallback)", () => {
      const logger = makeFakeLogger("debug");
      const exit = makeFakeExit();
      const err = new Error("no-stack-error");
      delete (err as { stack?: string }).stack;
      try {
        handleCliError(err, { logger, exit });
      } catch {
        // ignore FakeExitError
      }
      const debugCalls = logger.calls.filter((c) => c.method === "debug");
      expect(debugCalls.length).toBeGreaterThan(0);
      expect(debugCalls[0]?.message).toBe("");
    });
  });

  describe("CliError with empty message", () => {
    it("logs and exits without throwing unexpectedly for ConfigError('')", () => {
      const logger = makeFakeLogger();
      const exit = makeFakeExit();
      expect(() => {
        try {
          handleCliError(new ConfigError(""), { logger, exit });
        } catch (e) {
          if (!(e instanceof FakeExitError)) throw e;
        }
      }).not.toThrow();
    });
  });
});
