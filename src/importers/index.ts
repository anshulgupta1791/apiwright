/**
 * Public barrel re-exports for the src/importers module.
 *
 * Only exports the minimal public surface:
 * - Types from types.ts
 * - NodeImporterFileSystem (the real FS seam)
 * - Warnings (the accumulator)
 * - PostmanImporter (the Postman pipeline orchestrator)
 * - CompositePostmanImporter (the Importer interface implementor)
 *
 * Pipeline-stage classes (loader, flattener, templater, converter, seeder,
 * auth-extractor, assembler, output-writer, path-namer) are internal
 * collaborators and are NOT re-exported from the top barrel.
 */

export type {
  ImporterFileSystem,
  ImporterFsError,
  ImporterFsErrorCode,
  FlattenedRequest,
  FlattenedHeader,
  FlattenedQueryParam,
  FlattenedBody,
  FlattenedAuth,
  FlattenedResponse,
  ConversionResult,
  CollectionLoadResult,
  LoadedCollection,
} from "./types.js";

export { NodeImporterFileSystem } from "./fs-seam.js";
export { Warnings } from "./warnings.js";
export { PostmanImporter } from "./postman/postman-importer.js";
export { CompositePostmanImporter } from "./composite-importer.js";
