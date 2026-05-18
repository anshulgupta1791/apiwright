/**
 * OpenApiImporter: orchestrates the full OpenAPI/Swagger import pipeline.
 *
 * Drives: spec loading → operation flattening → per-op assembly (request
 * conversion, response seeding, security mapping, validation) → output writing.
 * Resolves an ImportOutcome; only programmer errors throw — all bad user input
 * becomes a warning in the resolved outcome.
 *
 * Does NOT implement the frozen `Importer` interface directly (which also
 * requires `postman()`). The CompositePostmanImporter is the interface
 * implementor, exactly as PostmanImporter does not implement Importer.
 */

import type { ImportOutcome } from "../../cli/seams/importer.js";
import { NodeImporterFileSystem } from "../fs-seam.js";
import type { ImporterFileSystem } from "../types.js";
import { Warnings } from "../warnings.js";

import { OpenApiEndpointAssembler } from "./endpoint-assembler.js";
import { OperationFlattener } from "./operation-flattener.js";
import { OpenApiOutputWriter } from "./output-writer.js";
import { OpenApiSpecLoader } from "./spec-loader.js";
import type { FlattenedOperation, LoadedSpec, OpenApiWritableEndpoint } from "./types.js";

/** Options for OpenApiImporter. */
export interface OpenApiImporterOptions {
  /** Reused write-capable FS seam. Default new NodeImporterFileSystem(). */
  fs?: ImporterFileSystem;
  /** Spec loader. Default new OpenApiSpecLoader({ fs }). */
  loader?: OpenApiSpecLoader;
  /** Flattener. Default new OperationFlattener(). */
  flattener?: OperationFlattener;
  /** Assembler. Default new OpenApiEndpointAssembler(). */
  assembler?: OpenApiEndpointAssembler;
  /** Output writer. Default new OpenApiOutputWriter({ fs }). */
  writer?: OpenApiOutputWriter;
}

/**
 * Orchestrates the full OpenAPI/Swagger import pipeline.
 *
 * Drives: spec loading → operation flattening → per-op assembly → writing.
 * Resolves an ImportOutcome; only programmer errors throw — all bad user
 * input becomes a warning. Both OpenAPI 3.x and Swagger 2.0 inputs drive
 * the same orchestrator (the loader normalizes flavor; downstream is
 * flavor-agnostic).
 */
export class OpenApiImporter {
  readonly #loader: OpenApiSpecLoader;
  readonly #flattener: OperationFlattener;
  readonly #assembler: OpenApiEndpointAssembler;
  readonly #writer: OpenApiOutputWriter;

  /**
   * Constructs the orchestrator with optional injectable collaborators.
   * @param options - Optional configuration.
   * @param options.fs - Injectable FS seam; defaults to NodeImporterFileSystem.
   * @param options.loader - Injectable spec loader; defaults to new OpenApiSpecLoader.
   * @param options.flattener - Injectable operation flattener; defaults to new.
   * @param options.assembler - Injectable endpoint assembler; defaults to new.
   * @param options.writer - Injectable output writer; defaults to new.
   */
  constructor(options?: OpenApiImporterOptions) {
    const fs: ImporterFileSystem = options?.fs ?? new NodeImporterFileSystem();
    this.#loader = options?.loader ?? new OpenApiSpecLoader({ fs });
    this.#flattener = options?.flattener ?? new OperationFlattener();
    this.#assembler = options?.assembler ?? new OpenApiEndpointAssembler();
    this.#writer = options?.writer ?? new OpenApiOutputWriter({ fs });
  }

  /**
   * Drives the full OpenAPI/Swagger import pipeline. Resolves an ImportOutcome;
   * only programmer errors throw — all bad user input becomes a warning.
   * @param input - Source spec and output directory.
   * @param input.source - File path OR http(s) URL to the spec.
   * @param input.outputDir - Destination directory for generated endpoint JSON files.
   * @returns Resolved ImportOutcome with written count and accumulated warnings.
   */
  async openapi(input: { source: string; outputDir: string }): Promise<ImportOutcome> {
    const { source, outputDir } = input;
    const warnings = new Warnings();

    const loadResult = await this.#loader.load(source);
    if (!loadResult.ok) {
      return { written: 0, warnings: [loadResult.error] };
    }

    warnings.addAll(loadResult.warnings);

    const { operations, warnings: flatWarnings } = this.#flattener.flatten(loadResult.spec);
    warnings.addAll(flatWarnings);

    const writable = this.#assembleOperations(operations, loadResult.spec, warnings);

    const written = this.#writeOutput(writable, outputDir, warnings);

    return { written, warnings: warnings.list() };
  }

  /**
   * Assembles all flattened operations into writable endpoints.
   * Skipped operations produce a warning; no exception propagates.
   * @param operations - The flattened operations from the spec.
   * @param spec - The loaded spec (for sourceId and security defs).
   * @param warnings - Accumulator for produced warning strings.
   * @returns The assembled writable endpoints.
   */
  #assembleOperations(
    operations: FlattenedOperation[],
    spec: LoadedSpec,
    warnings: Warnings,
  ): OpenApiWritableEndpoint[] {
    const usedIds = new Set<string>();
    const writable: OpenApiWritableEndpoint[] = [];

    for (const op of operations) {
      try {
        const { endpoint, warnings: opWarnings } = this.#assembler.assemble(op, spec, usedIds);
        warnings.addAll(opWarnings);
        if (endpoint !== undefined) {
          writable.push({ endpoint, tagPath: [op.tags[0] ?? ""] });
        }
      /* istanbul ignore next — unreachable: assembler.assemble() is documented as never throwing */
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        warnings.add(
          `Operation ${op.method.toUpperCase()} ${op.path} skipped: unprocessable (${msg})`,
        );
      }
    }

    return writable;
  }

  /**
   * Writes assembled endpoints to disk, returning the count written.
   * Write errors produce a warning; no exception propagates.
   * @param writable - The assembled endpoints ready to write.
   * @param outputDir - The destination directory.
   * @param warnings - Accumulator for write-error warnings.
   * @returns The count of successfully written files.
   */
  #writeOutput(
    writable: OpenApiWritableEndpoint[],
    outputDir: string,
    warnings: Warnings,
  ): number {
    try {
      const writeResult = this.#writer.write(writable, outputDir);
      warnings.addAll(writeResult.warnings);
      return writeResult.written;
    } catch (err) {
      const errObj = err !== null && typeof err === "object" && "code" in err ? err : null;
      const errRecord = errObj as Record<string, unknown> | null;
      const code = errRecord !== null ? String(errRecord["code"]) : "UNKNOWN";
      warnings.add(`Failed to write output to '${outputDir}': ${code}`);
      return 0;
    }
  }
}
