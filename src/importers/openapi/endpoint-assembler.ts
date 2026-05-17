/**
 * OpenApiEndpointAssembler: assembles and validates one CanonicalEndpoint
 * from a flattened operation by composing the request converter, response
 * seeder, security mapper, and schema validator.
 *
 * Reuses the shared SchemaValidator + ENDPOINT_META_SCHEMA from src/core.
 * Reuses the shared Warnings accumulator. No re-implemented validation.
 * Pure; never throws.
 */

import type { CanonicalEndpoint } from "../../core/canonical-model.js";
import { SchemaValidator } from "../../core/schema-validator.js";
import { Warnings } from "../warnings.js";

import { OpenApiRequestConverter } from "./request-converter.js";
import { OpenApiResponseSeeder } from "./response-seeder.js";
import { OpenApiSecurityMapper } from "./security-mapper.js";
import type { ConversionResult, FlattenedOperation, LoadedSpec } from "./types.js";

/** Source type literal for OpenAPI-imported endpoints. */
const OPENAPI_SOURCE_TYPE = "openapi" as const;

/** Options for OpenApiEndpointAssembler. */
export interface OpenApiEndpointAssemblerOptions {
  /** Default: new OpenApiRequestConverter(). */
  requestConverter?: OpenApiRequestConverter;
  /** Default: new OpenApiResponseSeeder(). */
  responseSeeder?: OpenApiResponseSeeder;
  /** Default: new OpenApiSecurityMapper(). */
  securityMapper?: OpenApiSecurityMapper;
  /** Default: new SchemaValidator() (from src/core). */
  validator?: SchemaValidator;
}

/**
 * Assembles + validates one CanonicalEndpoint from a flattened operation.
 * Validation failure => dropped (endpoint undefined) with an aggregated
 * warning naming the operation. Pure; never throws.
 */
export class OpenApiEndpointAssembler {
  readonly #requestConverter: OpenApiRequestConverter;
  readonly #responseSeeder: OpenApiResponseSeeder;
  readonly #securityMapper: OpenApiSecurityMapper;
  readonly #validator: SchemaValidator;

  /**
   * Constructs the assembler with optional injectable collaborators.
   * @param options - Optional configuration.
   * @param options.requestConverter - Injectable request converter; defaults to new.
   * @param options.responseSeeder - Injectable response seeder; defaults to new.
   * @param options.securityMapper - Injectable security mapper; defaults to new.
   * @param options.validator - Injectable schema validator; defaults to new.
   */
  constructor(options?: OpenApiEndpointAssemblerOptions) {
    this.#requestConverter =
      options?.requestConverter ?? new OpenApiRequestConverter();
    this.#responseSeeder =
      options?.responseSeeder ?? new OpenApiResponseSeeder();
    this.#securityMapper =
      options?.securityMapper ?? new OpenApiSecurityMapper();
    this.#validator = options?.validator ?? new SchemaValidator();
  }

  /**
   * Assembles + validates one CanonicalEndpoint from a flattened operation.
   * Validation failure => dropped (endpoint undefined) with an aggregated
   * warning naming the operation. Pure; never throws.
   * @param op       - The flattened operation.
   * @param spec     - The loaded spec (sourceId, security defs).
   * @param usedIds  - Mutable id-dedup set shared across the spec.
   * @returns ConversionResult with optional endpoint and merged warnings.
   */
  assemble(
    op: FlattenedOperation,
    spec: LoadedSpec,
    usedIds: Set<string>,
  ): ConversionResult {
    const warnings = new Warnings();
    const ctx = `${op.method.toUpperCase()} ${op.path}`;

    const convResult = this.#requestConverter.convert(op, usedIds);
    warnings.addAllWithContext(ctx, convResult.warnings);

    if (convResult.core === undefined) {
      return { warnings: warnings.list() };
    }

    const seedResult = this.#responseSeeder.seed(op);
    warnings.addAllWithContext(ctx, seedResult.warnings);

    const secResult = this.#securityMapper.map(op, spec);
    warnings.addAllWithContext(ctx, secResult.warnings);

    const { id, name, method, url, request } = convResult.core;
    const endpoint: CanonicalEndpoint = {
      id,
      name,
      method,
      url,
      ...(secResult.authStrategy !== undefined
        ? { auth_strategy: secResult.authStrategy }
        : {}),
      response: seedResult.response,
      tags: op.tags,
      request,
      source: { type: OPENAPI_SOURCE_TYPE, spec_url: spec.sourceId },
    };

    const validation = this.#validator.validateEndpoint(endpoint);
    if (!validation.valid) {
      const errors = (validation.errors ?? []).join("; ");
      warnings.add(`[${ctx}] dropped: schema validation failed: ${errors}`);
      return { warnings: warnings.list() };
    }

    return { endpoint, warnings: warnings.list() };
  }
}
