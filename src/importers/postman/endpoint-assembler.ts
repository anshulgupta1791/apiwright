/**
 * Postman endpoint assembler: combines converter, seeder, and auth extractor
 * results into a complete CanonicalEndpoint and validates against the meta-schema.
 *
 * Drop-not-throw: a request failing conversion or validation is returned as
 * { endpoint: undefined, warnings } with an aggregated warning. Never throws.
 */

import type { CanonicalEndpoint } from "../../core/canonical-model.js";
import { SchemaValidator } from "../../core/schema-validator.js";
import type { ConversionResult, FlattenedRequest } from "../types.js";
import { Warnings } from "../warnings.js";

import { PostmanAuthExtractor } from "./auth-extractor.js";
import { PostmanRequestConverter } from "./request-converter.js";
import { PostmanResponseSeeder } from "./response-seeder.js";

/** Options for PostmanEndpointAssembler. */
export interface PostmanEndpointAssemblerOptions {
  /** Default: new PostmanRequestConverter(). */
  converter?: PostmanRequestConverter;
  /** Default: new PostmanResponseSeeder(). */
  seeder?: PostmanResponseSeeder;
  /** Default: new PostmanAuthExtractor(). */
  authExtractor?: PostmanAuthExtractor;
  /** Default: new SchemaValidator() (from src/core). */
  validator?: SchemaValidator;
}

/**
 * Assembles one complete CanonicalEndpoint from a rewritten flattened request
 * and validates it against ENDPOINT_META_SCHEMA.
 *
 * Pipeline:
 * 1. converter.convert → core fields
 * 2. seeder.seed → response
 * 3. authExtractor.extract → optional auth_strategy
 * 4. Build endpoint object
 * 5. validator.validateEndpoint → valid or drop
 */
export class PostmanEndpointAssembler {
  readonly #converter: PostmanRequestConverter;
  readonly #seeder: PostmanResponseSeeder;
  readonly #authExtractor: PostmanAuthExtractor;
  readonly #validator: SchemaValidator;

  /**
   * Constructs a PostmanEndpointAssembler with optional injectable collaborators.
   * @param options - Optional configuration with injectable collaborators.
   */
  constructor(options?: PostmanEndpointAssemblerOptions) {
    this.#converter = options?.converter ?? new PostmanRequestConverter();
    this.#seeder = options?.seeder ?? new PostmanResponseSeeder();
    this.#authExtractor = options?.authExtractor ?? new PostmanAuthExtractor();
    this.#validator = options?.validator ?? new SchemaValidator();
  }

  /**
   * Assembles one complete CanonicalEndpoint from a rewritten flattened
   * request and validates it against ENDPOINT_META_SCHEMA. A request that
   * fails conversion or validation is dropped (endpoint undefined) with an
   * aggregated warning naming it. Pure; never throws.
   * @param request - The variable-rewritten flattened request.
   * @param fileBasename - Basename of the source collection file.
   * @param usedIds - Mutable id-dedupe set shared across the collection.
   * @returns ConversionResult ({ endpoint?, warnings }).
   */
  assemble(
    request: FlattenedRequest,
    fileBasename: string,
    usedIds: Set<string>,
  ): ConversionResult {
    const warnings = new Warnings();

    // Step 1: Convert to core fields
    const conversionResult = this.#converter.convert(request, usedIds);
    warnings.addAllWithContext(request.name, conversionResult.warnings);

    if (!conversionResult.core) {
      return { warnings: warnings.list() };
    }

    const {
      id,
      name,
      method,
      url,
      request: canonicalRequest,
    } = conversionResult.core;

    // Step 2: Seed response
    const seedResult = this.#seeder.seed(request);
    warnings.addAllWithContext(request.name, seedResult.warnings);

    // Step 3: Extract auth strategy
    const authResult = this.#authExtractor.extract(request);
    warnings.addAllWithContext(request.name, authResult.warnings);

    // Step 4: Build endpoint object
    const endpoint: CanonicalEndpoint = {
      id,
      name,
      method,
      url,
      ...(authResult.authStrategy !== undefined
        ? { auth_strategy: authResult.authStrategy }
        : {}),
      request: canonicalRequest,
      response: seedResult.response,
      source: {
        type: "postman",
        collection: fileBasename,
        ...(request.postmanId ? { endpoint_id: request.postmanId } : {}),
      },
    };

    // Step 5: Validate
    const validation = this.#validator.validateEndpoint(endpoint);
    if (!validation.valid) {
      /* istanbul ignore next — validator always provides errors array when invalid */
      const errorList = validation.errors ?? [];
      const errorStr = errorList.join("; ");
      warnings.add(
        `[${request.name}] dropped: schema validation failed: ${errorStr}`,
      );
      return { warnings: warnings.list() };
    }

    return { endpoint, warnings: warnings.list() };
  }
}
