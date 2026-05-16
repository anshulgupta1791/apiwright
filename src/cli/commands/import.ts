/**
 * ImportCommand — delegates to the Importer seam for postman and openapi imports.
 *
 * Loads config, builds logger, then delegates to the Importer seam.
 * Never imports from src/importers (does not exist); depends only on the
 * Importer interface in src/cli/seams/importer.ts.
 */

import { ConfigLoader } from "../config/loader.js";
import type { LogLevel } from "../config/types.js";
import type { Logger } from "../logging/logger.js";
import type { Importer, ImportOutcome } from "../seams/importer.js";
import { NotImplementedImporter } from "../seams/importer.js";

import { loadConfigOrThrow } from "./load-config.js";

/** Options accepted by {@link ImportCommand}. */
export interface ImportCommandOptions {
  /**
   * Config loader factory. Called with the optional `--config` path so each
   * invocation honours the per-run config override. Required.
   */
  configLoaderFactory: (configPath?: string) => ConfigLoader;
  /** Importer seam. Default NotImplementedImporter. */
  importer?: Importer;
  /** Logger factory. Required. */
  loggerFactory: (lvl: LogLevel) => Logger;
}

/**
 * Handles `apiwright import postman` and `apiwright import openapi` commands.
 *
 * Loads config then delegates to the Importer seam. Throws ConfigError when
 * config load fails; throws NotImplementedError when the default seam is used.
 */
export class ImportCommand {
  readonly #configLoaderFactory: (configPath?: string) => ConfigLoader;
  readonly #importer: Importer;
  readonly #loggerFactory: (lvl: LogLevel) => Logger;

  /**
   * Creates an ImportCommand with injectable collaborators.
   * @param options - Injectable collaborators.
   */
  constructor(options: ImportCommandOptions) {
    this.#configLoaderFactory = options.configLoaderFactory;
    this.#importer = options.importer ?? new NotImplementedImporter();
    this.#loggerFactory = options.loggerFactory;
  }

  /**
   * Imports a Postman v2.1 collection file into endpoint JSON files.
   * @param file - Path to the Postman collection file.
   * @param opts - Output directory and optional config path options.
   * @param opts.outputDir - Destination directory for generated endpoint JSON files.
   * @param opts.configPath - Optional path to apiwright.config.json (from --config flag).
   * @returns The import outcome.
   * @throws ConfigError when config load fails.
   * @throws NotImplementedError when the default importer seam is used.
   */
  async postman(
    file: string,
    opts: { outputDir: string; configPath?: string },
  ): Promise<ImportOutcome> {
    const config = loadConfigOrThrow(
      this.#configLoaderFactory(opts.configPath),
    );
    this.#loggerFactory(config.log_level);
    return this.#importer.postman({ file, outputDir: opts.outputDir });
  }

  /**
   * Imports an OpenAPI/Swagger spec into endpoint JSON files.
   * @param source - URL or file path to the OpenAPI spec.
   * @param opts - Output directory and optional config path options.
   * @param opts.outputDir - Destination directory for generated endpoint JSON files.
   * @param opts.configPath - Optional path to apiwright.config.json (from --config flag).
   * @returns The import outcome.
   * @throws ConfigError when config load fails.
   * @throws NotImplementedError when the default importer seam is used.
   */
  async openapi(
    source: string,
    opts: { outputDir: string; configPath?: string },
  ): Promise<ImportOutcome> {
    const config = loadConfigOrThrow(
      this.#configLoaderFactory(opts.configPath),
    );
    this.#loggerFactory(config.log_level);
    return this.#importer.openapi({ source, outputDir: opts.outputDir });
  }
}
