/**
 * Public barrel re-exports for the src/importers module.
 *
 * Only exports the minimal public surface:
 * - Types from types.ts (Postman pipeline)
 * - NodeImporterFileSystem (the real FS seam)
 * - Warnings (the accumulator)
 * - PostmanImporter (the Postman pipeline orchestrator)
 * - CompositePostmanImporter (the Importer interface implementor)
 * - OpenApiImporter (the OpenAPI/Swagger pipeline orchestrator)
 * - OpenAPI public types
 *
 * Pipeline-stage classes are internal collaborators and are NOT re-exported
 * from the top barrel.
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
export { OpenApiImporter } from "./openapi/openapi-importer.js";

export type {
  SpecFlavor,
  LoadedSpec,
  SpecLoadResult,
  FlattenedOperation,
  FlattenedParameter,
  FlattenedRequestBody,
  FlattenedSecurityRequirement,
  SwaggerParserSeam,
  ConversionResult as OpenApiConversionResult,
  OpenApiWritableEndpoint,
  FlattenResult,
  SchemaConversionResult,
  RequestConversionResult,
  ResponseSeedResult,
  SecurityMapResult,
  OutputWriteResult as OpenApiOutputWriteResult,
} from "./openapi/types.js";
