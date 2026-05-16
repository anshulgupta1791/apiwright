/**
 * TestRunner seam — stable contract for the future test execution engine.
 *
 * The CLI depends only on the `TestRunner` interface. Task #10 implements
 * a class satisfying this contract; the CLI requires no changes.
 */

import type { ResolvedEnvironment } from "../../env/index.js";
import type { EffectiveSettings } from "../config/types.js";
import { NotImplementedError } from "../errors.js";

/** Task number that implements the TestRunner seam. */
const IMPLEMENTING_TASK = 10;

/** Result a future runner returns for one test execution invocation. */
export interface TestRunOutcome {
  /** Total endpoint test cases attempted. */
  total: number;
  /** Cases that passed (including pass-after-retry "flaky"). */
  passed: number;
  /** Cases that failed after retries. */
  failed: number;
  /** Cases that passed only after a retry. */
  flaky: number;
}

/** Input to {@link TestRunner.run}. */
export interface TestRunInput {
  /** Resolved environment name. */
  env: string;
  /** Already loaded + validated environment (CLI loads it via src/env). */
  environment?: ResolvedEnvironment;
  /** Resolved markers (de-`all`-expanded). */
  markers: EffectiveSettings["markers"];
  /** Resolved console log level. */
  logLevel: EffectiveSettings["logLevel"];
  /** Full effective settings (paths, workers, retries, report cfg). */
  settings: EffectiveSettings;
}

/**
 * Executes a resolved test plan for one invocation.
 *
 * Implemented by Task #10. The CLI depends only on this interface.
 */
export interface TestRunner {
  /**
   * Executes the resolved test plan.
   * @param input - Resolved run parameters.
   * @returns The outcome of the test run.
   */
  run(input: TestRunInput): Promise<TestRunOutcome>;
}

/**
 * Default binding until Task #10 ships.
 *
 * Rejects with {@link NotImplementedError} naming Task #10 when `run` is invoked.
 */
export class NotImplementedTestRunner implements TestRunner {
  /**
   * Always rejects with NotImplementedError naming Task #10.
   * @param _input - Unused; present to satisfy the {@link TestRunner} interface.
   * @returns A rejected promise; never resolves.
   */
  run(_input: TestRunInput): Promise<TestRunOutcome> {
    return Promise.reject(
      new NotImplementedError("`apiwright run`", IMPLEMENTING_TASK),
    );
  }
}
