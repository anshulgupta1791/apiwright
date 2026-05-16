import { describe, it, expect } from "vitest";

import { NotImplementedTestRunner } from "../../../../src/cli/seams/test-runner.js";
import type {
  TestRunner,
  TestRunOutcome,
} from "../../../../src/cli/seams/test-runner.js";
import { NotImplementedError } from "../../../../src/cli/errors.js";
import { ExitCode } from "../../../../src/cli/exit-codes.js";

/**
 * Unit tests for the TestRunner seam.
 *
 * Verifies: the TestRunner interface shape (structural), NotImplementedTestRunner
 * throws NotImplementedError naming Task #10 with the correct exit code.
 */
describe("NotImplementedTestRunner", () => {
  it("is an instance that implements TestRunner (has a run method)", () => {
    const runner: TestRunner = new NotImplementedTestRunner();
    expect(typeof runner.run).toBe("function");
  });

  it("throws NotImplementedError when run() is called", async () => {
    const runner = new NotImplementedTestRunner();
    await expect(
      runner.run({
        env: "qa",
        markers: ["smoke"],
        logLevel: "warn",
        settings: {} as never,
      }),
    ).rejects.toThrow(NotImplementedError);
  });

  it("thrown error names Task #10 in the message", async () => {
    const runner = new NotImplementedTestRunner();
    let caught: unknown;
    try {
      await runner.run({
        env: "qa",
        markers: ["smoke"],
        logLevel: "warn",
        settings: {} as never,
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(NotImplementedError);
    expect((caught as NotImplementedError).message).toContain("Task #10");
  });

  it("thrown error has ExitCode.NOT_IMPLEMENTED (5)", async () => {
    const runner = new NotImplementedTestRunner();
    let caught: unknown;
    try {
      await runner.run({
        env: "qa",
        markers: ["smoke"],
        logLevel: "warn",
        settings: {} as never,
      });
    } catch (e) {
      caught = e;
    }
    expect((caught as NotImplementedError).code).toBe(ExitCode.NOT_IMPLEMENTED);
  });

  it("thrown error message contains 'not yet implemented'", async () => {
    const runner = new NotImplementedTestRunner();
    let caught: unknown;
    try {
      await runner.run({
        env: "prod",
        markers: ["regression"],
        logLevel: "debug",
        settings: {} as never,
      });
    } catch (e) {
      caught = e;
    }
    expect((caught as NotImplementedError).message.toLowerCase()).toContain(
      "not yet implemented",
    );
  });

  it("TestRunOutcome type: type shape is correct (structural check via fake runner)", () => {
    // This is a structural/compile-time check via a fake implementing the interface.
    const fakeRunner: TestRunner = {
      run: async (): Promise<TestRunOutcome> => ({
        total: 10,
        passed: 8,
        failed: 1,
        flaky: 1,
      }),
    };
    expect(typeof fakeRunner.run).toBe("function");
  });
});
