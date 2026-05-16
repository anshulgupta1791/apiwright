/**
 * Importer seam — stable contract for the future Postman and OpenAPI
 * import engines.
 *
 * Tasks #4 (Postman) and #5 (OpenAPI) implement classes satisfying this
 * interface; the CLI requires no changes.
 */

import { NotImplementedError } from "../errors.js";

/** Task number for the Postman importer. */
const POSTMAN_TASK = 4;

/** Task number for the OpenAPI importer. */
const OPENAPI_TASK = 5;

/** Result of one import operation. */
export interface ImportOutcome {
  /** Number of endpoint files written. */
  written: number;
  /** Human-readable warnings (e.g. unparseable pre-request scripts). */
  warnings: string[];
}

/**
 * Converts source formats into endpoint JSON files.
 *
 * Implemented by Tasks #4 and #5. The CLI depends only on this interface.
 */
export interface Importer {
  /**
   * Converts a Postman v2.1 collection file into endpoint JSON files.
   * @param input - File path and output directory.
   * @param input.file - Path to the Postman collection file.
   * @param input.outputDir - Destination directory for generated endpoint JSON files.
   * @returns The import outcome.
   */
  postman(input: { file: string; outputDir: string }): Promise<ImportOutcome>;

  /**
   * Converts an OpenAPI/Swagger spec (URL or file) into endpoint JSON files.
   * @param input - Source URL or file path and output directory.
   * @param input.source - URL or file path to the OpenAPI spec.
   * @param input.outputDir - Destination directory for generated endpoint JSON files.
   * @returns The import outcome.
   */
  openapi(input: { source: string; outputDir: string }): Promise<ImportOutcome>;
}

/**
 * Default binding until Tasks #4 and #5 ship.
 *
 * Rejects with {@link NotImplementedError} naming the responsible task when
 * `postman` or `openapi` is invoked.
 */
export class NotImplementedImporter implements Importer {
  /**
   * Always rejects with NotImplementedError naming Task #4.
   * @param _input - Unused; present to satisfy the {@link Importer} interface.
   * @param _input.file - The Postman collection file path (unused).
   * @param _input.outputDir - The output directory (unused).
   * @returns A rejected promise; never resolves.
   */
  postman(_input: { file: string; outputDir: string }): Promise<ImportOutcome> {
    return Promise.reject(
      new NotImplementedError("`apiwright import postman`", POSTMAN_TASK),
    );
  }

  /**
   * Always rejects with NotImplementedError naming Task #5.
   * @param _input - Unused; present to satisfy the {@link Importer} interface.
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
