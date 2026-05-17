/**
 * CompositePostmanImporter: implements the frozen Importer interface.
 *
 * - postman() delegates to the real PostmanImporter.
 * - openapi() rejects with NotImplementedError(5) preserving the CLI
 *   exit-code contract until Task #5 ships.
 *
 * The FROZEN Importer interface (src/cli/seams/importer.ts) is imported as a
 * type only — this file never modifies it.
 */

import { NotImplementedError } from "../cli/errors.js";
import type { Importer, ImportOutcome } from "../cli/seams/importer.js";

import { PostmanImporter } from "./postman/postman-importer.js";

/** Task number for the OpenAPI importer (preserves CLI exit-code 5). */
const OPENAPI_TASK = 5;

/** Options for CompositePostmanImporter. */
export interface CompositePostmanImporterOptions {
  /** Real Postman engine. Default: new PostmanImporter(). */
  postmanImporter?: PostmanImporter;
}

/**
 * Importer composite: postman() delegates to the real PostmanImporter;
 * openapi() rejects with NotImplementedError naming Task #5 until that
 * task ships. Implements the FROZEN Importer interface unchanged.
 */
export class CompositePostmanImporter implements Importer {
  readonly #postmanImporter: PostmanImporter;

  /**
   * Constructs a CompositePostmanImporter with optional injectable engine.
   * @param options - Optional configuration.
   * @param options.postmanImporter - Injectable Postman engine;
   *   defaults to new PostmanImporter() (real production wiring).
   */
  constructor(options?: CompositePostmanImporterOptions) {
    this.#postmanImporter = options?.postmanImporter ?? new PostmanImporter();
  }

  /**
   * Delegates to the real PostmanImporter and passes the ImportOutcome through.
   * @param input - File path and output directory.
   * @param input.file - Path to the Postman collection file.
   * @param input.outputDir - Destination directory for generated endpoint JSON files.
   * @returns The import outcome from the underlying PostmanImporter.
   */
  postman(input: { file: string; outputDir: string }): Promise<ImportOutcome> {
    return this.#postmanImporter.postman(input);
  }

  /**
   * Always rejects: NotImplementedError naming Task #5.
   * @param _input - Unused; present to satisfy the Importer interface.
   * @param _input.source - The OpenAPI spec source (unused).
   * @param _input.outputDir - The output directory (unused).
   * @returns A rejected promise; never resolves.
   */
  openapi(_input: {
    source: string;
    outputDir: string;
  }): Promise<ImportOutcome> {
    return Promise.reject(
      new NotImplementedError("`apiwright import openapi`", OPENAPI_TASK),
    );
  }
}
