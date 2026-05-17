/**
 * Postman request converter: converts one variable-rewritten FlattenedRequest
 * into the core CanonicalEndpoint fields (id, name, method, url, request).
 *
 * Never throws — all failures become warnings. Uses JsonSchemaInferrer (shared)
 * and PathNamer (shared) for body schema inference and id/slug generation.
 */

import type {
  CanonicalRequest,
  HttpMethod,
} from "../../core/canonical-model.js";
import { parseJson } from "../../core/safe-json.js";
import type { FlattenedRequest } from "../types.js";

import { PathNamer } from "./path-naming.js";
import { JsonSchemaInferrer } from "./schema-infer.js";

/** Supported HTTP methods as a set for O(1) lookup. */
const SUPPORTED_METHODS = new Set<string>([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
]);

/** Result of converting one FlattenedRequest to core endpoint fields. */
export interface RequestConversionResult {
  /** Partial endpoint core (id, name, method, url, request) or undefined. */
  core?: {
    id: string;
    name: string;
    method: HttpMethod;
    url: string;
    request: CanonicalRequest;
  };
  /** Warnings accumulated during conversion. */
  warnings: string[];
}

/** Options for PostmanRequestConverter. */
export interface PostmanRequestConverterOptions {
  /** Shared inferrer. Default: new JsonSchemaInferrer(). */
  inferrer?: JsonSchemaInferrer;
  /** Shared namer. Default: new PathNamer(). */
  namer?: PathNamer;
}

/**
 * Converts one variable-rewritten FlattenedRequest into the core
 * CanonicalEndpoint fields. Never throws — failures become warnings.
 *
 * Rules:
 * - id: slugified name or postmanId, deduped against usedIds set.
 * - method: uppercased, must be one of 7 HttpMethod members.
 * - url: rawUrl verbatim; empty → "/" + warning.
 * - headers: enabled only, last-write-wins on duplicates.
 * - body: raw mode JSON → body_example + body_schema; non-JSON → raw example + warning.
 * - query_params: enabled params only, all values are {type:"string"}.
 */
export class PostmanRequestConverter {
  readonly #inferrer: JsonSchemaInferrer;
  readonly #namer: PathNamer;

  /**
   * Constructs a PostmanRequestConverter with optional injectable collaborators.
   * @param options - Optional configuration.
   * @param options.inferrer - Injectable schema inferrer; defaults to JsonSchemaInferrer.
   * @param options.namer - Injectable path namer; defaults to PathNamer.
   */
  constructor(options?: PostmanRequestConverterOptions) {
    this.#inferrer = options?.inferrer ?? new JsonSchemaInferrer();
    this.#namer = options?.namer ?? new PathNamer();
  }

  /**
   * Converts one (already variable-rewritten) FlattenedRequest into the
   * core CanonicalEndpoint fields. Never throws — failures become warnings.
   * @param request - The rewritten flattened request.
   * @param usedIds - Mutable set for deterministic id de-duplication
   *                   across the whole collection.
   * @returns The core fields (or none) plus warnings.
   */
  convert(
    request: FlattenedRequest,
    usedIds: Set<string>,
  ): RequestConversionResult {
    const warnings: string[] = [];

    const id = this.#namer.dedupe(
      this.#namer.toIdSlug(request.name || request.postmanId || "endpoint"),
      usedIds,
    );
    const name = request.name || id;
    if (!request.name) warnings.push(`Request had no name; using id '${id}'`);

    const method = request.method.toUpperCase();
    if (!SUPPORTED_METHODS.has(method)) {
      return {
        warnings: [
          ...warnings,
          `Unsupported or missing HTTP method '${method}'; request skipped`,
        ],
      };
    }

    const url = request.rawUrl || "/";
    if (!request.rawUrl) warnings.push(`Request URL is empty; using '/'`);

    const canonicalRequest = this.#buildRequest(request, warnings);
    return {
      core: {
        id,
        name,
        method: method as HttpMethod,
        url,
        request: canonicalRequest,
      },
      warnings,
    };
  }

  /**
   * Builds the canonical request object with headers, body, and query params.
   * @param request - The flattened request.
   * @param warnings - Mutable warnings array to append to.
   * @returns The assembled CanonicalRequest.
   */
  #buildRequest(
    request: FlattenedRequest,
    warnings: string[],
  ): CanonicalRequest {
    const canonicalRequest: CanonicalRequest = {};

    const enabledHeaders = request.headers.filter((h) => !h.disabled);
    if (enabledHeaders.length > 0) {
      const headers: Record<string, string> = {};
      for (const h of enabledHeaders) {
        headers[h.key] = h.value;
      }
      canonicalRequest.headers = headers;
    }

    if (request.body?.mode === "raw" && request.body.raw !== "") {
      const parsed = parseJson(request.body.raw);
      if (parsed.ok) {
        canonicalRequest.body_example = parsed.value;
        canonicalRequest.body_schema = this.#inferrer.infer(parsed.value);
      } else {
        canonicalRequest.body_example = request.body.raw;
        warnings.push("Request body is not valid JSON; stored as raw example");
      }
    }

    const enabledQuery = request.query.filter((q) => !q.disabled);
    if (enabledQuery.length > 0) {
      const queryParams: Record<string, { type: string }> = {};
      for (const q of enabledQuery) {
        queryParams[q.key] = { type: "string" };
      }
      canonicalRequest.query_params = queryParams;
    }

    return canonicalRequest;
  }
}
