/**
 * Type definitions for the OpenAPI/Swagger importer pipeline.
 *
 * Coverage-exempt (named types.ts per design). No executable logic lives
 * here — only type declarations and interfaces.
 *
 * Re-uses {@link ImporterFileSystem} from `../types.js` (proves no new FS seam).
 * Re-uses canonical model types from `../../core/canonical-model.js`.
 */

import type {
  CanonicalEndpoint,
  HttpMethod,
  JsonSchema,
} from "../../core/canonical-model.js";
// Re-used (NOT re-declared) — proves "no new FS seam".
import type { ImporterFileSystem } from "../types.js";

// Re-export ImporterFileSystem so other openapi modules can import it here.
export type { ImporterFileSystem };

// Re-export canonical model types used throughout the module.
export type { CanonicalEndpoint, HttpMethod, JsonSchema };

/** Detected document flavor. */
export type SpecFlavor = "openapi-3" | "swagger-2";

/**
 * A fully dereferenced spec plus derived metadata. `document` is the
 * dereferenced root (no `$ref` keys remain except those intentionally
 * bundled to break a cycle — see {@link SpecLoadResult}).
 */
export interface LoadedSpec {
  /** Dereferenced root document (narrow via SpecAccess; never `any`). */
  document: Record<string, unknown>;
  /** Detected flavor. */
  flavor: SpecFlavor;
  /**
   * Resolved base URL/path (servers[0] for 3.x; schemes+host+basePath
   * for 2.0; "/" fallback). Used to prefix operation `url` if relative
   * semantics require it.
   */
  baseUrl: string;
  /**
   * Source identifier recorded for `source.spec_url`: the URL verbatim
   * when the source was an http(s) URL, else the file basename.
   */
  sourceId: string;
  /**
   * True when a circular `$ref` forced a bundled (not fully inlined)
   * document; the orchestrator surfaces the accompanying warning.
   */
  circular: boolean;
}

/** Discriminated load result. NEVER represents a thrown error. */
export type SpecLoadResult =
  | { ok: true; spec: LoadedSpec; warnings: string[] }
  | { ok: false; error: string };

/** A path/query/header parameter, flavor-normalized. */
export interface FlattenedParameter {
  /** Parameter name. */
  name: string;
  /**
   * Location. (Swagger 2.0 `formData`/`body` are NOT parameters here —
   * they are normalized into {@link FlattenedRequestBody}.)
   */
  location: "path" | "query" | "header";
  /** True when the spec marks it required (path params are always true). */
  required: boolean;
  /**
   * The parameter's schema (3.x `schema`, or 2.0 inline type keywords
   * lifted into a schema object), or undefined when none was given.
   */
  schema?: JsonSchema;
  /** Spec-provided example/default for the parameter, if any. */
  example?: unknown;
}

/**
 * A request body, normalized across 3.x `requestBody` and 2.0
 * `body`/`formData` parameters.
 */
export interface FlattenedRequestBody {
  /** Chosen media type (e.g. "application/json"); "" when unknown. */
  mediaType: string;
  /**
   * The body schema (3.x content[mt].schema; 2.0 body param schema or a
   * synthesized object schema from formData params), or undefined.
   */
  schema?: JsonSchema;
  /** Spec-provided request example, if any. */
  example?: unknown;
}

/** One declared response, flavor-normalized. */
export interface FlattenedResponse {
  /** Status key as written: "200".."599", or "default". */
  statusKey: string;
  /**
   * The body schema for the chosen JSON media type, or undefined when the
   * response declares no schema or only non-JSON content.
   */
  schema?: JsonSchema;
  /** The media type the schema was taken from; "" when none. */
  mediaType: string;
}

/**
 * One security requirement: an AND-set of scheme references (each with
 * its OAuth scopes, unused by the closed allowlist). An operation's
 * `security` is an OR-list of these.
 */
export interface FlattenedSecurityRequirement {
  /** Scheme reference names ANDed together in this requirement. */
  schemeNames: string[];
}

/**
 * Exactly one per (path template, HTTP method). The single shape every
 * downstream stage consumes regardless of 3.x vs 2.0.
 */
export interface FlattenedOperation {
  /** Source path template, verbatim (e.g. "/users/{id}"). */
  path: string;
  /**
   * Lowercased HTTP method (e.g. "get"); already validated as a
   * canonical method by the flattener (others are skipped upstream).
   */
  method: string;
  /** operationId when present; undefined otherwise. */
  operationId?: string;
  /** `summary` when present; "" otherwise. */
  summary: string;
  /** `description` when present; "" otherwise. */
  description: string;
  /** Tags in document order; never empty (default bucket assigned). */
  tags: string[];
  /**
   * Merged path-level + operation-level parameters (operation wins on
   * name+location), document order.
   */
  parameters: FlattenedParameter[];
  /** Normalized request body, or undefined when none. */
  requestBody?: FlattenedRequestBody;
  /**
   * Effective security: operation-level when present (incl. explicit
   * `[]` meaning "no auth"), else the root default; undefined when
   * neither exists. An empty array means "explicitly no auth".
   */
  security?: FlattenedSecurityRequirement[];
  /** Declared responses in document order (status keys as written). */
  responses: FlattenedResponse[];
}

/**
 * Injectable boundary over @apidevtools/swagger-parser (validate +
 * dereference / bundle), so unit tests need no real network or disk.
 */
export interface SwaggerParserSeam {
  /** Validate + fully dereference (3.x or 2.0). Rejects on invalid input. */
  dereference(source: string): Promise<unknown>;
  /**
   * Validate + bundle (keeps internal $refs local; used to break cycles
   * so a circular spec does not infinitely inline).
   */
  bundle(source: string): Promise<unknown>;
}

/**
 * Per-operation conversion result. `endpoint` absent ⇒ the operation was
 * dropped (unconvertible or schema-invalid). Structurally identical to the
 * Task #4 `ConversionResult` pattern (intentional uniformity).
 */
export interface ConversionResult {
  /** The assembled, schema-valid endpoint, or undefined when dropped. */
  endpoint?: CanonicalEndpoint;
  /** Human-readable warnings accumulated for this operation. */
  warnings: string[];
}

/** One endpoint plus its resolved tag path, ready to write. */
export interface OpenApiWritableEndpoint {
  /** The validated endpoint. */
  endpoint: CanonicalEndpoint;
  /**
   * Resolved tag/folder segments (already chosen: first tag) for
   * directory placement; [] ⇒ written directly under outputDir.
   */
  tagPath: string[];
}

/** Result of a flattening operation. */
export interface FlattenResult {
  /** One FlattenedOperation per (path, method), document order. */
  operations: FlattenedOperation[];
  /** Accumulated warnings (skipped methods, multi-tag choice, etc.). */
  warnings: string[];
}

/** Schema conversion result. */
export interface SchemaConversionResult {
  /**
   * Canonical JSON Schema (always present; permissive fallback on
   * failure). Deterministic, fixed key order.
   */
  schema: JsonSchema;
  /** Warnings (depth exceeded, unrecognized schema, dropped keyword). */
  warnings: string[];
}

/** Request conversion result. */
export interface RequestConversionResult {
  /**
   * Partial endpoint core, or undefined when the operation must be
   * dropped (e.g. unsupported method).
   */
  core?: {
    id: string;
    name: string;
    method: HttpMethod;
    url: string;
    request: import("../../core/canonical-model.js").CanonicalRequest;
  };
  /** Warnings accumulated during conversion. */
  warnings: string[];
}

/** Response seeding result. */
export interface ResponseSeedResult {
  /** Always populated (schema-valid default produced when needed). */
  response: import("../../core/canonical-model.js").CanonicalResponse;
  /** Warnings (default used, non-2xx chosen, no schema, etc.). */
  warnings: string[];
}

/** Security mapping result. */
export interface SecurityMapResult {
  /** Canonical auth strategy name, or undefined when none/unmapped. */
  authStrategy?: string;
  /** Warnings (manual-review prompts naming the operation). */
  warnings: string[];
}

/** Output write result. */
export interface OutputWriteResult {
  /** Count of files successfully written. */
  written: number;
  /** Rename/collision warnings. */
  warnings: string[];
}
