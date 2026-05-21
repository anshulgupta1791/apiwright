import { describe, it, expect } from "vitest";

import {
  RUNNER_ERROR_CODES,
  RunnerError,
  isRunnerError,
  type RunnerErrorCode,
} from "../../../src/runner/index.js";

describe("RunnerError", () => {
  it("preserves code, phase, message, cause", () => {
    const cause = new Error("inner");
    const err = new RunnerError({
      code: "RUNNER_HTTP_FAILED",
      phase: "execute",
      message: "boom",
      cause,
    });
    expect(err.code).toBe("RUNNER_HTTP_FAILED");
    expect(err.phase).toBe("execute");
    expect(err.message).toBe("boom");
    expect(err.cause).toBe(cause);
    expect(err.name).toBe("RunnerError");
  });

  it("is instance of Error", () => {
    const err = new RunnerError({
      code: "RUNNER_PLAN_EMPTY",
      phase: "discovery",
      message: "nope",
    });
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(RunnerError);
  });
});

describe("RUNNER_ERROR_CODES", () => {
  it("is frozen with key === value for every code", () => {
    expect(Object.isFrozen(RUNNER_ERROR_CODES)).toBe(true);
    for (const k of Object.keys(RUNNER_ERROR_CODES) as RunnerErrorCode[]) {
      expect(RUNNER_ERROR_CODES[k]).toBe(k);
    }
  });

  it("contains every documented code", () => {
    expect(RUNNER_ERROR_CODES.RUNNER_ASSERTION_PARSE_FAILED).toBe(
      "RUNNER_ASSERTION_PARSE_FAILED",
    );
    expect(RUNNER_ERROR_CODES.RUNNER_DISCOVERY_FAILED).toBe("RUNNER_DISCOVERY_FAILED");
    expect(RUNNER_ERROR_CODES.RUNNER_EMIT_FAILED).toBe("RUNNER_EMIT_FAILED");
    expect(RUNNER_ERROR_CODES.RUNNER_ENDPOINT_PARSE_FAILED).toBe(
      "RUNNER_ENDPOINT_PARSE_FAILED",
    );
    expect(RUNNER_ERROR_CODES.RUNNER_HTTP_FAILED).toBe("RUNNER_HTTP_FAILED");
    expect(RUNNER_ERROR_CODES.RUNNER_LIFECYCLE_FAILED).toBe("RUNNER_LIFECYCLE_FAILED");
    expect(RUNNER_ERROR_CODES.RUNNER_PLAN_EMPTY).toBe("RUNNER_PLAN_EMPTY");
    expect(RUNNER_ERROR_CODES.RUNNER_RETRY_EXHAUSTED).toBe("RUNNER_RETRY_EXHAUSTED");
    expect(RUNNER_ERROR_CODES.RUNNER_SHARD_INVALID).toBe("RUNNER_SHARD_INVALID");
  });
});

describe("isRunnerError", () => {
  it("returns true for RunnerError instances", () => {
    const err = new RunnerError({ code: "RUNNER_HTTP_FAILED", phase: "execute", message: "x" });
    expect(isRunnerError(err)).toBe(true);
  });

  it("returns false for plain Errors and POJOs", () => {
    expect(isRunnerError(new Error("x"))).toBe(false);
    expect(isRunnerError({ code: "RUNNER_HTTP_FAILED", phase: "execute", message: "x" })).toBe(false);
    expect(isRunnerError(null)).toBe(false);
    expect(isRunnerError(undefined)).toBe(false);
    expect(isRunnerError("string")).toBe(false);
  });
});
