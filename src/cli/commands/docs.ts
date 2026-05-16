/**
 * DocsCommand — delegates to the DocsGenerator seam.
 *
 * Loads config, builds logger, then delegates to the DocsGenerator seam.
 * Never imports from src/docs-generator (does not exist); depends only on the
 * DocsGenerator interface in src/cli/seams/docs-generator.ts.
 */

import { ConfigLoader } from "../config/loader.js";
import type { LogLevel } from "../config/types.js";
import type { Logger } from "../logging/logger.js";
import type { DocsGenerator, DocsOutcome } from "../seams/docs-generator.js";
import { NotImplementedDocsGenerator } from "../seams/docs-generator.js";

import { loadConfigOrThrow } from "./load-config.js";

/** Options accepted by {@link DocsCommand}. */
export interface DocsCommandOptions {
  /**
   * Config loader factory. Called with the optional `--config` path so each
   * invocation honours the per-run config override. Required.
   */
  configLoaderFactory: (configPath?: string) => ConfigLoader;
  /** DocsGenerator seam. Default NotImplementedDocsGenerator. */
  docsGenerator?: DocsGenerator;
  /** Logger factory. Required. */
  loggerFactory: (lvl: LogLevel) => Logger;
}

/**
 * Handles `apiwright docs generate` commands.
 *
 * Loads config then delegates to the DocsGenerator seam. Throws ConfigError
 * when config load fails; throws NotImplementedError when the default seam
 * is used (Task #11 not yet implemented).
 */
export class DocsCommand {
  readonly #configLoaderFactory: (configPath?: string) => ConfigLoader;
  readonly #docsGenerator: DocsGenerator;
  readonly #loggerFactory: (lvl: LogLevel) => Logger;

  /**
   * Creates a DocsCommand with injectable collaborators.
   * @param options - Injectable collaborators.
   */
  constructor(options: DocsCommandOptions) {
    this.#configLoaderFactory = options.configLoaderFactory;
    this.#docsGenerator =
      options.docsGenerator ?? new NotImplementedDocsGenerator();
    this.#loggerFactory = options.loggerFactory;
  }

  /**
   * Generates per-endpoint Markdown documentation.
   * @param opts - Output and source directory options.
   * @param opts.outputDir - Destination directory for generated Markdown files.
   * @param opts.sourceDir - Source directory; defaults to config.tests_dir when absent.
   * @param opts.configPath - Optional path to apiwright.config.json (from --config flag).
   * @returns The generation outcome.
   * @throws ConfigError when config load fails.
   * @throws NotImplementedError when the default seam is used.
   */
  async generate(opts: {
    outputDir: string;
    sourceDir?: string;
    configPath?: string;
  }): Promise<DocsOutcome> {
    const config = loadConfigOrThrow(
      this.#configLoaderFactory(opts.configPath),
    );
    this.#loggerFactory(config.log_level);
    const sourceDir = opts.sourceDir ?? config.tests_dir;
    return this.#docsGenerator.generate({
      sourceDir,
      outputDir: opts.outputDir,
    });
  }
}
