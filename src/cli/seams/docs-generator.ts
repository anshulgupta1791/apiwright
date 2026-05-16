/**
 * DocsGenerator seam — stable contract for the future documentation
 * generation engine.
 *
 * Task #11 implements a class satisfying this interface; the CLI requires
 * no changes.
 */

import { NotImplementedError } from "../errors.js";

/** Task number that implements the DocsGenerator seam. */
const IMPLEMENTING_TASK = 11;

/** Result of one documentation generation invocation. */
export interface DocsOutcome {
  /** Number of Markdown files written. */
  written: number;
}

/**
 * Generates per-endpoint Markdown documentation from a source directory.
 *
 * Implemented by Task #11. The CLI depends only on this interface.
 */
export interface DocsGenerator {
  /**
   * Generates per-endpoint Markdown from a source dir into an output dir.
   * @param input - Source and output directory paths.
   * @param input.sourceDir - The source directory containing endpoint definitions.
   * @param input.outputDir - The output directory for generated Markdown files.
   * @returns The generation outcome.
   */
  generate(input: {
    sourceDir: string;
    outputDir: string;
  }): Promise<DocsOutcome>;
}

/**
 * Default binding until Task #11 ships.
 *
 * Rejects with {@link NotImplementedError} naming Task #11 when `generate` is invoked.
 */
export class NotImplementedDocsGenerator implements DocsGenerator {
  /**
   * Always rejects with NotImplementedError naming Task #11.
   * @param _input - Unused; present to satisfy the {@link DocsGenerator} interface.
   * @param _input.sourceDir - The source directory (unused).
   * @param _input.outputDir - The output directory (unused).
   * @returns A rejected promise; never resolves.
   */
  generate(_input: {
    sourceDir: string;
    outputDir: string;
  }): Promise<DocsOutcome> {
    return Promise.reject(
      new NotImplementedError("`apiwright docs generate`", IMPLEMENTING_TASK),
    );
  }
}
