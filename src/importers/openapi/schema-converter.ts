/**
 * OpenApiSchemaConverter: translates a dereferenced OpenAPI 3.x / Swagger 2.0
 * schema object into the canonical JSON Schema dialect.
 *
 * WHY THIS IS NOT JsonSchemaInferrer:
 * `JsonSchemaInferrer` (src/importers/postman/schema-infer.ts) infers a schema
 * FROM a concrete runtime value (null→{type:"null"}, 5→{type:"integer"}, etc.).
 * An OpenAPI schema object IS ALREADY a (dialect of) JSON Schema — it declares
 * `type`, `properties`, `required`, `allOf`/`oneOf`/`anyOf`, `nullable`, etc.
 * Feeding a schema object into JsonSchemaInferrer would describe the schema's
 * own JSON structure, not translate its semantic meaning. These are different
 * operations (declared-schema translation vs. inferred-from-instance), so reuse
 * is not merely sub-optimal — it is semantically incorrect. A dedicated converter
 * is required. This TSDoc comment satisfies the design's auditability criterion.
 *
 * DEPTH BOUNDING:
 * Like JsonSchemaInferrer's MAX_DEPTH=512 discipline, this converter uses an
 * explicit depth bound (SCHEMA_MAX_DEPTH=256) checked BEFORE recursing.
 * Inverted failure mode vs. JsonSchemaInferrer: exceeding the bound yields a
 * permissive {type:"object"} fallback + warning — NEVER throws, NEVER overflows.
 * This guarantees identical behavior on Node 22 and Node 26+ regardless of
 * engine call-stack ceiling differences.
 *
 * Keyword application is delegated to SchemaKeywordApplier (extracted to stay
 * within the 300-line file limit).
 */

import { SchemaKeywordApplier } from "./schema-keyword-applier.js";
import type { JsonSchema, SchemaConversionResult } from "./types.js";

/**
 * Maximum schema nesting depth before the permissive fallback is used.
 * Chosen far below any JS engine call-stack ceiling for platform-identical
 * behavior (mirrors JsonSchemaInferrer's MAX_DEPTH rationale).
 */
const SCHEMA_MAX_DEPTH = 256;

/** Permissive fallback schema used when conversion fails or depth exceeded. */
const PERMISSIVE_FALLBACK: JsonSchema = { type: "object" };

/** Fixed canonical key order for emitted schema objects (determinism). */
const SCHEMA_KEY_ORDER: readonly string[] = [
  "type",
  "format",
  "enum",
  "const",
  "allOf",
  "oneOf",
  "anyOf",
  "properties",
  "required",
  "items",
  "additionalProperties",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "minLength",
  "maxLength",
  "pattern",
  "minItems",
  "maxItems",
  "uniqueItems",
  "minProperties",
  "maxProperties",
  "default",
  "multipleOf",
];

/** Set of all recognized JSON Schema keywords (for hasRecognizedKeywords check). */
const RECOGNIZED_KEYWORDS = new Set<string>([
  "type", "format", "enum", "const", "allOf", "oneOf", "anyOf",
  "properties", "required", "items", "additionalProperties",
  "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum",
  "minLength", "maxLength", "pattern", "minItems", "maxItems",
  "uniqueItems", "minProperties", "maxProperties", "default", "multipleOf",
]);

/**
 * Translates a dereferenced OpenAPI 3.x / Swagger 2.0 schema object into
 * the canonical JSON Schema dialect used by the endpoint meta-schema.
 *
 * Pure: never mutates input. Never throws (depth/garbage → permissive
 * fallback + warning). Deterministic: fixed key order → byte-identical
 * output for identical input.
 */
export class OpenApiSchemaConverter {
  readonly #applier: SchemaKeywordApplier;

  /**
   * Constructs the converter.
   */
  constructor() {
    this.#applier = new SchemaKeywordApplier();
  }

  /**
   * Translates a dereferenced OpenAPI 3.x / Swagger 2.0 schema object into
   * the canonical JSON Schema dialect. Pure; never mutates input; NEVER
   * throws (depth/garbage → permissive fallback + warning).
   * @param specSchema - The raw schema object from the spec (may be unknown).
   * @returns Converted schema plus any accumulated warnings.
   */
  convert(specSchema: unknown): SchemaConversionResult {
    const warnings: string[] = [];
    const schema = this.#convert(specSchema, 0, warnings);
    return { schema, warnings };
  }

  /**
   * Internal recursive converter.
   * @param node - The current schema node.
   * @param depth - Current recursion depth (0-indexed).
   * @param warnings - Mutable warnings accumulator.
   * @returns The converted schema.
   */
  #convert(node: unknown, depth: number, warnings: string[]): JsonSchema {
    if (depth > SCHEMA_MAX_DEPTH) {
      warnings.push(
        `Schema depth exceeded ${SCHEMA_MAX_DEPTH}; substituted a permissive object schema`,
      );
      return { ...PERMISSIVE_FALLBACK };
    }

    if (node === null || node === undefined || typeof node !== "object" || Array.isArray(node)) {
      warnings.push(`Empty or unrecognizable schema; substituted a permissive object schema`);
      return { ...PERMISSIVE_FALLBACK };
    }

    const raw = node as Record<string, unknown>;

    if (!this.#hasRecognizedKeywords(raw)) {
      warnings.push(`Empty or unrecognizable schema; substituted a permissive object schema`);
      return { ...PERMISSIVE_FALLBACK };
    }

    const result = this.#buildSchemaResult(raw, depth, warnings);
    return this.#orderSchema(result);
  }

  /**
   * Builds the schema result object from a recognized raw schema node.
   * Handles type, nullable, composition, properties, items, and scalar keywords.
   * @param raw - The validated raw schema node.
   * @param depth - Current recursion depth.
   * @param warnings - Mutable warnings accumulator.
   * @returns The unordered schema result object.
   */
  #buildSchemaResult(
    raw: Record<string, unknown>,
    depth: number,
    warnings: string[],
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    const nullable = raw["nullable"] === true;
    const recurse = (n: unknown): JsonSchema => this.#convert(n, depth + 1, warnings);
    const warn = (msg: string): void => { warnings.push(msg); };

    this.#applier.applyType(raw, nullable, result);
    this.#applier.applySimpleKeywords(raw, result);
    this.#applier.applyComposition(raw, recurse, result);
    this.#applier.applyProperties(raw, recurse, warn, result);
    this.#applier.applyItems(raw, recurse, result);
    this.#applier.applyAdditionalProperties(raw, recurse, result);
    this.#applier.applyScalarKeys(raw, result);

    return result;
  }

  /**
   * Returns true when the raw node has at least one recognized JSON Schema keyword.
   * Used to distinguish a real schema from an empty/garbage object.
   * @param raw - The raw schema node to check.
   * @returns True when at least one recognized keyword is present.
   */
  #hasRecognizedKeywords(raw: Record<string, unknown>): boolean {
    return Object.keys(raw).some((k) => RECOGNIZED_KEYWORDS.has(k));
  }

  /**
   * Returns a new object with keys in the canonical schema key order.
   * Unknown keys are sorted lexicographically after known keys.
   * @param obj - The schema object to reorder.
   * @returns A new object with canonical key order.
   */
  #orderSchema(obj: Record<string, unknown>): JsonSchema {
    const result: Record<string, unknown> = {};
    for (const key of SCHEMA_KEY_ORDER) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        result[key] = obj[key];
      }
    }
    const knownSet = new Set(SCHEMA_KEY_ORDER);
    const remaining = Object.keys(obj)
      .filter((k) => !knownSet.has(k))
      .sort();
    for (const key of remaining) {
      result[key] = obj[key];
    }
    return result;
  }
}
