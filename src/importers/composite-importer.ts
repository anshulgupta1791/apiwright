/**
 * CompositePostmanImporter: implements the frozen Importer interface.
 *
 * - postman() delegates to the real PostmanImporter.
 * - openapi() delegates to the real OpenApiImporter (Task #5 wiring).
 *
 * The FROZEN Importer interface (src/cli/seams/importer.ts) is imported as a
 * type only — this file never modifies it.
 */

import type { Importer, ImportOutcome } from "../cli/seams/importer.js";

import { OpenApiImporter } from "./openapi/openapi-importer.js";
import { PostmanImporter } from "./postman/postman-importer.js";

/** Options for CompositePostmanImporter. */
export interface CompositePostmanImporterOptions {
  /** Real Postman engine. Default: new PostmanImporter(). */
  postmanImporter?: PostmanImporter;
  /** Real OpenAPI engine. Default: new OpenApiImporter(). */
  openApiImporter?: OpenApiImporter;
}

/**
 * Importer composite: postman() delegates to the real PostmanImporter;
 * openapi() delegates to the real OpenApiImporter (Task #5 wiring).
 * Implements the FROZEN Importer interface unchanged.
 */
export class CompositePostmanImporter implements Importer {
  readonly #postmanImporter: PostmanImporter;
  readonly #openApiImporter: OpenApiImporter;

  /**
   * Constructs a CompositePostmanImporter with optional injectable engines.
   * @param options - Optional configuration.
   * @param options.postmanImporter - Injectable Postman engine;
   *   defaults to new PostmanImporter() (real production wiring).
   * @param options.openApiImporter - Injectable OpenAPI engine;
   *   defaults to new OpenApiImporter() (real production wiring).
   */
  constructor(options?: CompositePostmanImporterOptions) {
    this.#postmanImporter = options?.postmanImporter ?? new PostmanImporter();
    this.#openApiImporter = options?.openApiImporter ?? new OpenApiImporter();
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
   * Delegates to the real OpenApiImporter and passes the ImportOutcome through.
   * @param input - Source spec and output directory.
   * @param input.source - File path or http(s) URL to the OpenAPI/Swagger spec.
   * @param input.outputDir - Destination directory for generated endpoint JSON files.
   * @returns The import outcome from the underlying OpenApiImporter.
   */
  openapi(input: {
    source: string;
    outputDir: string;
  }): Promise<ImportOutcome> {
    return this.#openApiImporter.openapi(input);
  }
}
