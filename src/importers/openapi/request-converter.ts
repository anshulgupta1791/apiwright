/**
 * OpenApiRequestConverter: converts one FlattenedOperation into the core
 * CanonicalEndpoint fields (id, name, method, url, request).
 *
 * Reuses PathNamer for id slug/dedupe and OpenApiSchemaConverter for all
 * schema translation (DRY — no duplicated slug or schema logic).
 * Never throws — failures become warnings.
 */

import type { CanonicalRequest } from "../../core/canonical-model.js";
import { PathNamer } from "../postman/path-naming.js";

import { OpenApiSchemaConverter } from "./schema-converter.js";
import type {
  FlattenedOperation,
  HttpMethod,
  JsonSchema,
  RequestConversionResult,
} from "./types.js";

/** Canonical HTTP methods set for validation. */
const HTTP_METHODS: ReadonlySet<string> = new Set([
  "GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS",
]);

/** Permissive string schema used for query params with no declared schema. */
const PERMISSIVE_STRING: JsonSchema = { type: "string" };

/** Permissive object schema used as body fallback when no schema is declared. */
const PERMISSIVE_BODY: JsonSchema = { type: "object" };

/** Options for OpenApiRequestConverter. */
export interface OpenApiRequestConverterOptions {
  /** Shared converter. Default: new OpenApiSchemaConverter(). */
  schemaConverter?: OpenApiSchemaConverter;
  /** Shared namer. Default: new PathNamer(). */
  namer?: PathNamer;
}

/**
 * Converts one FlattenedOperation into the core CanonicalEndpoint fields.
 * Never throws — failures become warnings.
 */
export class OpenApiRequestConverter {
  readonly #schemaConverter: OpenApiSchemaConverter;
  readonly #namer: PathNamer;

  /**
   * Constructs the converter with optional injectable collaborators.
   * @param options - Optional configuration.
   * @param options.schemaConverter - Injectable schema converter; defaults to new.
   * @param options.namer - Injectable path namer; defaults to new PathNamer().
   */
  constructor(options?: OpenApiRequestConverterOptions) {
    this.#schemaConverter = options?.schemaConverter ?? new OpenApiSchemaConverter();
    this.#namer = options?.namer ?? new PathNamer();
  }

  /**
   * Converts one FlattenedOperation into the core CanonicalEndpoint fields.
   * Never throws — failures become warnings.
   * @param op - The flattened operation to convert.
   * @param usedIds - Mutable set for deterministic id de-dup across the spec.
   * @returns Conversion result with optional core and accumulated warnings.
   */
  convert(op: FlattenedOperation, usedIds: Set<string>): RequestConversionResult {
    const warnings: string[] = [];

    const idBase =
      op.operationId && op.operationId.trim() !== ""
        ? op.operationId
        : this.#deriveIdFromMethodPath(op.method, op.path);
    const id = this.#namer.dedupe(this.#namer.toIdSlug(idBase), usedIds);

    const name =
      op.summary.trim() !== ""
        ? op.summary
        : op.description.trim() !== ""
          ? op.description
          : `${op.method.toUpperCase()} ${op.path}`;

    const upperMethod = op.method.toUpperCase();
    if (!HTTP_METHODS.has(upperMethod)) {
      warnings.push(`Unsupported HTTP method '${upperMethod}' for ${op.path}; operation skipped`);
      return { warnings };
    }
    const method = upperMethod as HttpMethod;

    let url = op.path;
    if (!url || url.trim() === "") {
      url = "/";
      warnings.push(`Operation path empty; used '/'`);
    }

    const request = this.#buildRequest(op, warnings);

    return { core: { id, name, method, url, request }, warnings };
  }

  /**
   * Derives a base ID from the HTTP method and path template.
   * Replaces path param braces and separators with underscores.
   * @param method - The lowercased HTTP method.
   * @param path - The path template string.
   * @returns A base ID string suitable for slug conversion.
   */
  #deriveIdFromMethodPath(method: string, path: string): string {
    const cleanPath = path
      .replace(/\{[^}]+\}/g, (m) => m.slice(1, -1))
      .replace(/[^a-zA-Z0-9]+/g, "_");
    return `${method}_${cleanPath}`;
  }

  /**
   * Builds the CanonicalRequest from the flattened operation.
   * Delegates sub-building to focused helpers to stay within complexity limits.
   * @param op - The flattened operation.
   * @param warnings - Mutable warnings accumulator.
   * @returns The constructed CanonicalRequest.
   */
  #buildRequest(op: FlattenedOperation, warnings: string[]): CanonicalRequest {
    const request: CanonicalRequest = {};
    this.#applyQueryParams(op, request);
    this.#applyHeaders(op, request, warnings);
    this.#applyBody(op, request, warnings);
    return request;
  }

  /**
   * Applies query parameters to the request object.
   * @param op - The flattened operation.
   * @param request - The request object to mutate.
   */
  #applyQueryParams(op: FlattenedOperation, request: CanonicalRequest): void {
    const queryParams = op.parameters.filter((p) => p.location === "query");
    if (queryParams.length === 0) return;

    const qpObj: Record<string, JsonSchema> = {};
    for (const param of queryParams) {
      const schema =
        param.schema !== undefined
          ? this.#schemaConverter.convert(param.schema).schema
          : PERMISSIVE_STRING;
      qpObj[param.name] = schema;
    }
    request.query_params = qpObj;
  }

  /**
   * Applies header parameters to the request object. Content-Type is skipped.
   * @param op - The flattened operation.
   * @param request - The request object to mutate.
   * @param warnings - Mutable warnings accumulator.
   */
  #applyHeaders(op: FlattenedOperation, request: CanonicalRequest, warnings: string[]): void {
    const headerParams = op.parameters.filter((p) => p.location === "header");
    const relevantHeaders = headerParams.filter((p) => p.required || p.example !== undefined);
    if (relevantHeaders.length === 0) return;

    const hdrs: Record<string, string> = {};
    for (const param of relevantHeaders) {
      if (param.name.toLowerCase() === "content-type") continue;

      const constValue = this.#getConstantValue(param);
      if (constValue !== undefined) {
        hdrs[param.name] = constValue;
      } else {
        const slug = this.#namer.toIdSlug(param.name);
        hdrs[param.name] = `\${env.${slug}}`;
        warnings.push(
          `Header '${param.name}' has no constant value; emitted as ` +
            `\${env.${slug}} placeholder for manual review`,
        );
      }
    }
    if (Object.keys(hdrs).length > 0) {
      request.headers = hdrs;
    }
  }

  /**
   * Applies the request body schema and example to the request object.
   * @param op - The flattened operation.
   * @param request - The request object to mutate.
   * @param warnings - Mutable warnings accumulator.
   */
  #applyBody(op: FlattenedOperation, request: CanonicalRequest, warnings: string[]): void {
    if (op.requestBody === undefined) return;

    const { schema: bodySchema, warnings: convWarn } = op.requestBody.schema !== undefined
      ? this.#schemaConverter.convert(op.requestBody.schema)
      : { schema: undefined, warnings: [] as string[] };

    if (bodySchema !== undefined) {
      warnings.push(...convWarn);
      request.body_schema = bodySchema;
    } else {
      request.body_schema = { ...PERMISSIVE_BODY };
      warnings.push(`Request body has no schema; used permissive object schema`);
    }

    if (op.requestBody.example !== undefined) {
      request.body_example = op.requestBody.example;
    }
  }

  /**
   * Gets the constant string value for a header parameter, if determinable.
   * Returns undefined when the value requires a placeholder.
   * @param param - The parameter with optional schema and example.
   * @param param.schema - Optional JSON schema for the parameter.
   * @param param.example - Optional example value for the parameter.
   * @returns The constant string value, or undefined.
   */
  #getConstantValue(param: { schema?: JsonSchema; example?: unknown }): string | undefined {
    const schema = param.schema;
    const enumArr = schema !== undefined ? schema["enum"] : undefined;
    if (Array.isArray(enumArr) && enumArr.length === 1) {
      const val: unknown = enumArr[0];
      if (typeof val === "string") return val;
    }
    if (schema !== undefined && typeof schema["default"] === "string") {
      return schema["default"];
    }
    if (typeof param.example === "string") {
      return param.example;
    }
    return undefined;
  }
}
