/**
 * PostmanImporter: orchestrates the full Postman v2.1 import pipeline.
 *
 * Pipeline stages (in order):
 * 1. Load collection (PostmanCollectionLoader)
 * 2. Flatten item tree (PostmanFlattener)
 * 3. For each request:
 *    a. Skip disabled requests (with warning)
 *    b. Rewrite {{var}} tokens (PostmanVariableTemplater)
 *    c. Assemble endpoint (PostmanEndpointAssembler)
 * 4. Write endpoints to disk (PostmanOutputWriter)
 * 5. Return ImportOutcome with written count and all warnings
 *
 * Resolves ImportOutcome for all user-input errors; only genuine programmer
 * errors (bugs) can propagate as rejections.
 */

import type { ImportOutcome } from "../../cli/seams/importer.js";
import { NodeImporterFileSystem } from "../fs-seam.js";
import type { ImporterFsError, ImporterFileSystem } from "../types.js";
import { Warnings } from "../warnings.js";

import { PostmanCollectionLoader } from "./collection-loader.js";
import { PostmanEndpointAssembler } from "./endpoint-assembler.js";
import { PostmanFlattener } from "./flattener.js";
import type { WritableEndpoint } from "./output-writer.js";
import { PostmanOutputWriter } from "./output-writer.js";
import { PostmanVariableTemplater } from "./variable-templating.js";

/** Options for PostmanImporter. */
export interface PostmanImporterOptions {
  /** Write-capable FS seam. Default: new NodeImporterFileSystem(). */
  fs?: ImporterFileSystem;
  /** Collection loader. Default: new PostmanCollectionLoader({ fs }). */
  loader?: PostmanCollectionLoader;
  /** Flattener. Default: new PostmanFlattener(). */
  flattener?: PostmanFlattener;
  /** Variable templater. Default: new PostmanVariableTemplater(). */
  templater?: PostmanVariableTemplater;
  /** Endpoint assembler. Default: new PostmanEndpointAssembler(). */
  assembler?: PostmanEndpointAssembler;
  /** Output writer. Default: new PostmanOutputWriter({ fs }). */
  writer?: PostmanOutputWriter;
}

/**
 * Orchestrates the full Postman v2.1 import pipeline.
 *
 * Note: PostmanImporter does NOT implement the Importer interface (which also
 * requires openapi()). The CompositePostmanImporter is the Importer implementor.
 */
export class PostmanImporter {
  readonly #loader: PostmanCollectionLoader;
  readonly #flattener: PostmanFlattener;
  readonly #templater: PostmanVariableTemplater;
  readonly #assembler: PostmanEndpointAssembler;
  readonly #writer: PostmanOutputWriter;

  /**
   * Constructs a PostmanImporter with optional injectable collaborators.
   * @param options - Optional configuration with injectable collaborators.
   *   All collaborators default to their real implementations wired with the
   *   same FS seam so that tests constructing with no options exercise the
   *   real default wiring.
   */
  constructor(options?: PostmanImporterOptions) {
    const fs = options?.fs ?? new NodeImporterFileSystem();
    this.#loader = options?.loader ?? new PostmanCollectionLoader({ fs });
    this.#flattener = options?.flattener ?? new PostmanFlattener();
    this.#templater = options?.templater ?? new PostmanVariableTemplater();
    this.#assembler = options?.assembler ?? new PostmanEndpointAssembler();
    this.#writer = options?.writer ?? new PostmanOutputWriter({ fs });
  }

  /**
   * Drives the full Postman import pipeline. Resolves an ImportOutcome;
   * only programmer errors throw — all bad input becomes a warning.
   * @param input - File path and output directory.
   * @param input.file - Path to the Postman collection file.
   * @param input.outputDir - Destination directory.
   * @returns Promise<ImportOutcome> ({ written, warnings }).
   */
  postman(input: { file: string; outputDir: string }): Promise<ImportOutcome> {
    return Promise.resolve(this.#run(input));
  }

  /**
   * Synchronous implementation of the import pipeline.
   * @param input - File path and output directory.
   * @param input.file - Path to the Postman collection file.
   * @param input.outputDir - Destination directory.
   * @returns ImportOutcome with written count and all warnings.
   */
  #run(input: { file: string; outputDir: string }): ImportOutcome {
    const { file, outputDir } = input;
    const warnings = new Warnings();

    // Step 1: Load collection
    const loadResult = this.#loader.load(file);
    if (!loadResult.ok) {
      warnings.add(loadResult.error);
      return { written: 0, warnings: warnings.list() };
    }

    const { collection: loaded } = loadResult;

    // Step 2: Flatten item tree
    const flatRequests = this.#flattener.flatten(loaded);

    // Step 3: Process each request
    const usedIds = new Set<string>();
    const writable: WritableEndpoint[] = [];
    // Union of every ${env.X} key the templater emitted. We surface this as a
    // single end-of-import summary so the user knows which YAML keys their
    // environments/<name>.yaml must define before they can `apiwright run`.
    const allEnvKeys = new Set<string>();

    for (const request of flatRequests) {
      // Skip disabled requests
      if (request.disabled) {
        warnings.add(`Skipped disabled request '${request.name}'`);
        continue;
      }

      // Rewrite {{var}} tokens and assemble endpoint.
      // Wrapped in try/catch: an excessively nested body can overflow the call
      // stack in JsonSchemaInferrer.infer. One bad request must never abort
      // the entire import — it becomes a drop-with-warning instead.
      try {
        const {
          request: rewritten,
          warnings: templateWarnings,
          envKeys,
        } = this.#templater.rewrite(request);
        warnings.addAll(templateWarnings);
        for (const k of envKeys) {
          allEnvKeys.add(k);
        }

        // Assemble endpoint
        const assembleResult = this.#assembler.assemble(
          rewritten,
          loaded.fileBasename,
          usedIds,
        );
        warnings.addAll(assembleResult.warnings);

        if (assembleResult.endpoint) {
          writable.push({
            endpoint: assembleResult.endpoint,
            folderPath: request.folderPath,
          });
        }
      } catch {
        warnings.add(
          `Request '${request.name}' skipped: unprocessable` +
            ` (e.g. excessively nested body)`,
        );
      }
    }

    // Step 4: Write endpoints
    let written = 0;
    try {
      const writeResult = this.#writer.write(writable, outputDir);
      written = writeResult.written;
      warnings.addAll(writeResult.warnings);
    } catch (err: unknown) {
      const fsErr = err as ImporterFsError;
      const code = fsErr?.code ?? "UNKNOWN";
      warnings.add(`Failed to write output to '${outputDir}': ${code}`);
      written = 0;
    }

    // Step 5: Emit env-var summary (last warning, most visible). Only when we
    // wrote endpoint files that reference at least one ${env.*} key — silent
    // when there is nothing for the user to author.
    this.#emitEnvSummary(warnings, written, allEnvKeys);

    return { written, warnings: warnings.list() };
  }

  /**
   * Adds a single end-of-import summary warning listing every ${env.X} key
   * referenced by the imported endpoints — the user copies these straight
   * into their environments/<name>.yaml. Silent when nothing was written or
   * no env keys were referenced.
   * @param warnings - The accumulator to append into.
   * @param written - Count of endpoint files written this run.
   * @param envKeys - Union of every env key the templater emitted.
   */
  #emitEnvSummary(
    warnings: Warnings,
    written: number,
    envKeys: Set<string>,
  ): void {
    if (written === 0 || envKeys.size === 0) return;
    const keys = [...envKeys].sort();
    warnings.add(
      `Imported endpoints reference these env variables — define them in` +
        ` your environments/<name>.yaml before running: ${keys.join(", ")}`,
    );
  }
}
