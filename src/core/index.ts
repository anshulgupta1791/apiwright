/**
 * Core module exports: canonical model definitions and schema validation.
 */

export * from "./canonical-model.js";
export { SchemaValidator, ENDPOINT_META_SCHEMA } from "./schema-validator.js";
export { parseJson } from "./safe-json.js";
export type { JsonParseResult } from "./safe-json.js";
export type { NormalizedResult } from "./normalized-result.js";
export { deepEqual, DEEP_EQUAL_MAX_DEPTH } from "./deep-equal.js";
export type { DeepEqualOptions } from "./deep-equal.js";
export { walkPath, MAX_PATH_WALK_DEPTH } from "./path-walk.js";
export type { WalkResult, WalkSegment } from "./path-walk.js";
