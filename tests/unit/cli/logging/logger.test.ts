import { describe, it, expect, vi, afterEach } from "vitest";
import { Writable } from "node:stream";

import { createLogger } from "../../../../src/cli/logging/logger.js";

/**
 * Unit tests for createLogger() and PinoLogger.
 *
 * Uses an injectable in-memory writable stream to assert emitted lines
 * deterministically without writing to real stdout. Covers all four log
 * levels, level filtering behavior (messages at lower priority are
 * suppressed), the invalid-level error, multi-line message safety, and the
 * Logger interface shape (error/warn/info/debug/level).
 */

/**
 * Creates an in-memory writable stream that collects all written chunks.
 * Returns the stream and a function to retrieve collected output.
 */
function makeCapture(): { stream: Writable; getOutput: () => string } {
  let buf = "";
  const stream = new Writable({
    write(chunk: Buffer | string, _encoding, cb) {
      buf += chunk.toString();
      cb();
    },
  });
  return {
    stream,
    getOutput: () => buf,
  };
}

describe("createLogger()", () => {
  describe("Logger interface shape", () => {
    it("returns an object with error, warn, info, debug methods", () => {
      const { stream } = makeCapture();
      const logger = createLogger("warn", { stream });
      expect(typeof logger.error).toBe("function");
      expect(typeof logger.warn).toBe("function");
      expect(typeof logger.info).toBe("function");
      expect(typeof logger.debug).toBe("function");
    });

    it("exposes the level property matching the created level", () => {
      const { stream } = makeCapture();
      const logger = createLogger("info", { stream });
      expect(logger.level).toBe("info");
    });

    it("exposes level='error' when created at error level", () => {
      const { stream } = makeCapture();
      const logger = createLogger("error", { stream });
      expect(logger.level).toBe("error");
    });

    it("exposes level='debug' when created at debug level", () => {
      const { stream } = makeCapture();
      const logger = createLogger("debug", { stream });
      expect(logger.level).toBe("debug");
    });

    it("exposes level='warn' when created at warn level", () => {
      const { stream } = makeCapture();
      const logger = createLogger("warn", { stream });
      expect(logger.level).toBe("warn");
    });
  });

  describe("level 'error' — filtering behavior", () => {
    it("emits error-level records", () => {
      const { stream, getOutput } = makeCapture();
      const logger = createLogger("error", { stream });
      logger.error("this is an error");
      expect(getOutput()).toContain("this is an error");
    });

    it("does not emit warn records at error level", () => {
      const { stream, getOutput } = makeCapture();
      const logger = createLogger("error", { stream });
      logger.warn("this warn should be suppressed");
      expect(getOutput()).not.toContain("this warn should be suppressed");
    });

    it("does not emit info records at error level", () => {
      const { stream, getOutput } = makeCapture();
      const logger = createLogger("error", { stream });
      logger.info("this info should be suppressed");
      expect(getOutput()).not.toContain("this info should be suppressed");
    });

    it("does not emit debug records at error level", () => {
      const { stream, getOutput } = makeCapture();
      const logger = createLogger("error", { stream });
      logger.debug("this debug should be suppressed");
      expect(getOutput()).not.toContain("this debug should be suppressed");
    });
  });

  describe("level 'warn' — filtering behavior (spec default)", () => {
    it("emits error records at warn level", () => {
      const { stream, getOutput } = makeCapture();
      const logger = createLogger("warn", { stream });
      logger.error("error message");
      expect(getOutput()).toContain("error message");
    });

    it("emits warn records at warn level", () => {
      const { stream, getOutput } = makeCapture();
      const logger = createLogger("warn", { stream });
      logger.warn("warn message");
      expect(getOutput()).toContain("warn message");
    });

    it("suppresses info records at warn level", () => {
      const { stream, getOutput } = makeCapture();
      const logger = createLogger("warn", { stream });
      logger.info("info should be suppressed");
      expect(getOutput()).not.toContain("info should be suppressed");
    });

    it("suppresses debug records at warn level", () => {
      const { stream, getOutput } = makeCapture();
      const logger = createLogger("warn", { stream });
      logger.debug("debug should be suppressed");
      expect(getOutput()).not.toContain("debug should be suppressed");
    });
  });

  describe("level 'info' — filtering behavior", () => {
    it("emits error, warn, and info records at info level", () => {
      const { stream, getOutput } = makeCapture();
      const logger = createLogger("info", { stream });
      logger.error("err");
      logger.warn("wrn");
      logger.info("inf");
      const out = getOutput();
      expect(out).toContain("err");
      expect(out).toContain("wrn");
      expect(out).toContain("inf");
    });

    it("suppresses debug records at info level", () => {
      const { stream, getOutput } = makeCapture();
      const logger = createLogger("info", { stream });
      logger.debug("debug suppressed at info");
      expect(getOutput()).not.toContain("debug suppressed at info");
    });
  });

  describe("level 'debug' — filtering behavior", () => {
    it("emits all four levels at debug level", () => {
      const { stream, getOutput } = makeCapture();
      const logger = createLogger("debug", { stream });
      logger.error("e-msg");
      logger.warn("w-msg");
      logger.info("i-msg");
      logger.debug("d-msg");
      const out = getOutput();
      expect(out).toContain("e-msg");
      expect(out).toContain("w-msg");
      expect(out).toContain("i-msg");
      expect(out).toContain("d-msg");
    });
  });

  describe("invalid level string", () => {
    it("throws when level is 'verbose' (not a valid LogLevel)", () => {
      const { stream } = makeCapture();
      expect(() => createLogger("verbose" as "error", { stream })).toThrow();
    });

    it("throws when level is empty string", () => {
      const { stream } = makeCapture();
      expect(() => createLogger("" as "error", { stream })).toThrow();
    });

    it("thrown error mentions accepted values (error, warn, info, debug)", () => {
      const { stream } = makeCapture();
      let caught: unknown;
      try {
        createLogger("nope" as "error", { stream });
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeDefined();
      const msg = (caught as Error).message ?? String(caught);
      expect(msg).toContain("error");
      expect(msg).toContain("warn");
      expect(msg).toContain("info");
      expect(msg).toContain("debug");
    });
  });

  describe("stream injection", () => {
    it("writes to the injected stream instead of real stdout", () => {
      const { stream, getOutput } = makeCapture();
      const logger = createLogger("debug", { stream });
      logger.error("injected stream test");
      expect(getOutput()).toContain("injected stream test");
    });

    it("does not write to real stdout when stream is injected", () => {
      // We can't fully assert stdout is clean, but if stream receives data,
      // the implementation is using the injected stream.
      const { stream, getOutput } = makeCapture();
      const logger = createLogger("info", { stream });
      logger.info("stream check");
      expect(getOutput()).toContain("stream check");
    });
  });

  describe("default process.stdout stream wiring", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("writes to process.stdout when no stream option is given", () => {
      // Spy on process.stdout.write to verify the default path.
      const chunks: string[] = [];
      const spy = vi
        .spyOn(process.stdout, "write")
        .mockImplementation((chunk: Uint8Array | string) => {
          chunks.push(typeof chunk === "string" ? chunk : chunk.toString());
          return true;
        });

      // Call createLogger with no opts so opts?.stream ?? process.stdout → process.stdout
      const logger = createLogger("error");
      logger.error("stdout-default-test-line");

      expect(spy).toHaveBeenCalled();
      expect(chunks.join("")).toContain("stdout-default-test-line");
    });

    it("does not throw when logging with no stream option", () => {
      const spy = vi
        .spyOn(process.stdout, "write")
        .mockImplementation(() => true);
      try {
        const logger = createLogger("warn");
        expect(() => logger.warn("no-throw-stdout")).not.toThrow();
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe("message edge cases", () => {
    it("logs a message containing a newline without crashing", () => {
      const { stream, getOutput } = makeCapture();
      const logger = createLogger("debug", { stream });
      expect(() => logger.error("line one\nline two")).not.toThrow();
      expect(getOutput()).toContain("line one");
    });

    it("logs an empty string message without crashing", () => {
      const { stream } = makeCapture();
      const logger = createLogger("debug", { stream });
      expect(() => logger.warn("")).not.toThrow();
    });

    it("logs a long message without crashing", () => {
      const { stream, getOutput } = makeCapture();
      const logger = createLogger("info", { stream });
      const long = "x".repeat(10000);
      logger.info(long);
      expect(getOutput()).toContain(long);
    });
  });

  describe("summary() — always-emit, unprefixed channel", () => {
    it("emits the message verbatim at error level", () => {
      const { stream, getOutput } = makeCapture();
      const logger = createLogger("error", { stream });
      logger.summary("Run summary: planned=3 passed=3 failed=0 flaky=0 duration_ms=42");
      expect(getOutput()).toContain(
        "Run summary: planned=3 passed=3 failed=0 flaky=0 duration_ms=42",
      );
    });

    it("does NOT prefix the message with `ERROR:` (the bug this method fixes)", () => {
      const { stream, getOutput } = makeCapture();
      const logger = createLogger("error", { stream });
      logger.summary("Run summary: planned=1 passed=1 failed=0 flaky=0 duration_ms=1");
      // pino-pretty would prefix `logger.error(...)` with `ERROR:`; the
      // dedicated summary channel writes directly to the stream so the
      // line surfaces clean.
      expect(getOutput()).not.toMatch(/^ERROR:\s*Run summary/m);
    });

    it("emits at warn level too (always shows)", () => {
      const { stream, getOutput } = makeCapture();
      const logger = createLogger("warn", { stream });
      logger.summary("Run summary: x");
      expect(getOutput()).toContain("Run summary: x");
    });

    it("emits at info level too (always shows)", () => {
      const { stream, getOutput } = makeCapture();
      const logger = createLogger("info", { stream });
      logger.summary("Run summary: y");
      expect(getOutput()).toContain("Run summary: y");
    });

    it("emits at debug level too (always shows)", () => {
      const { stream, getOutput } = makeCapture();
      const logger = createLogger("debug", { stream });
      logger.summary("Run summary: z");
      expect(getOutput()).toContain("Run summary: z");
    });

    it("appends a trailing newline (matches the rest of the logger's line-oriented contract)", () => {
      const { stream, getOutput } = makeCapture();
      const logger = createLogger("error", { stream });
      logger.summary("hello");
      expect(getOutput()).toMatch(/hello\n$/);
    });
  });
});
