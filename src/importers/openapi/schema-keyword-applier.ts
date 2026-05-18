/**
 * SchemaKeywordApplier: applies individual JSON Schema keyword groups to a
 * schema result object during conversion.
 *
 * Extracted from OpenApiSchemaConverter to stay within the 300-line file limit.
 * Each method handles one logical keyword group:
 *   - type (with nullable normalization)
 *   - simple keywords: format, enum, const
 *   - composition: allOf, oneOf, anyOf
 *   - properties (with required)
 *   - items
 *   - additionalProperties
 *   - scalar pass-through keywords
 *
 * Pure: never mutates inputs. Never throws.
 */

import type { JsonSchema } from "./types.js";

/** Composition keywords that recurse into arrays of subschemas. */
const COMPOSITION_KEYWORDS = ["allOf", "oneOf", "anyOf"] as const;

/** Scalar pass-through keywords copied verbatim from the source schema. */
const SCALAR_PASS_THROUGH_KEYS = [
  "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum",
  "minLength", "maxLength", "pattern",
  "minItems", "maxItems", "uniqueItems",
  "minProperties", "maxProperties",
  "default", "multipleOf",
] as const;

/**
 * Applies JSON Schema keyword groups to a result record during schema conversion.
 * Each method is a pure transformation; none mutate the source schema.
 */
export class SchemaKeywordApplier {
  /**
   * Applies the `type` field (with optional nullable normalization) to the result.
   * @param raw - The raw schema node.
   * @param nullable - Whether nullable:true was declared.
   * @param result - The result object to mutate.
   */
  applyType(
    raw: Record<string, unknown>,
    nullable: boolean,
    result: Record<string, unknown>,
  ): void {
    const rawType = raw["type"];
    if (rawType !== undefined) {
      result["type"] = nullable && typeof rawType === "string" ? [rawType, "null"] : rawType;
    }
  }

  /**
   * Applies simple pass-through keywords: format, enum, const.
   * @param raw - The raw schema node.
   * @param result - The result object to mutate.
   */
  applySimpleKeywords(raw: Record<string, unknown>, result: Record<string, unknown>): void {
    if (raw["format"] !== undefined) {
      result["format"] = raw["format"];
    }
    if (Array.isArray(raw["enum"])) {
      result["enum"] = raw["enum"];
    }
    if ("const" in raw) {
      result["const"] = raw["const"];
    }
  }

  /**
   * Applies composition keywords (allOf, oneOf, anyOf) by recursing into subschemas.
   * @param raw - The raw schema node.
   * @param convertFn - Recursive conversion function.
   * @param result - The result object to mutate.
   */
  applyComposition(
    raw: Record<string, unknown>,
    convertFn: (node: unknown) => JsonSchema,
    result: Record<string, unknown>,
  ): void {
    for (const compKey of COMPOSITION_KEYWORDS) {
      if (compKey in raw) {
        const arr = raw[compKey];
        if (Array.isArray(arr)) {
          result[compKey] = arr.map((sub) => convertFn(sub));
        }
      }
    }
  }

  /**
   * Applies the `properties` keyword by recursing into each property schema.
   * @param raw - The raw schema node.
   * @param convertFn - Recursive conversion function.
   * @param warnFn - Called with a warning message on malformed properties.
   * @param result - The result object to mutate.
   */
  applyProperties(
    raw: Record<string, unknown>,
    convertFn: (node: unknown) => JsonSchema,
    warnFn: (msg: string) => void,
    result: Record<string, unknown>,
  ): void {
    if (!("properties" in raw)) return;
    const props = raw["properties"];
    if (typeof props !== "object" || props === null || Array.isArray(props)) {
      warnFn(`Dropped malformed 'properties' in schema`);
      return;
    }
    const propsObj = props as Record<string, unknown>;
    const convertedProps: Record<string, unknown> = {};
    for (const [propKey, propVal] of Object.entries(propsObj)) {
      convertedProps[propKey] = convertFn(propVal);
    }
    result["properties"] = convertedProps;
    if (Array.isArray(raw["required"])) {
      result["required"] = raw["required"];
    }
  }

  /**
   * Applies the `items` keyword, recursing into item schemas.
   * @param raw - The raw schema node.
   * @param convertFn - Recursive conversion function.
   * @param result - The result object to mutate.
   */
  applyItems(
    raw: Record<string, unknown>,
    convertFn: (node: unknown) => JsonSchema,
    result: Record<string, unknown>,
  ): void {
    if (!("items" in raw)) return;
    const items = raw["items"];
    if (Array.isArray(items)) {
      result["items"] = items.map((sub) => convertFn(sub));
    } else if (items !== null && typeof items === "object") {
      result["items"] = convertFn(items);
    }
  }

  /**
   * Applies `additionalProperties`, recursing when it is a schema object.
   * @param raw - The raw schema node.
   * @param convertFn - Recursive conversion function.
   * @param result - The result object to mutate.
   */
  applyAdditionalProperties(
    raw: Record<string, unknown>,
    convertFn: (node: unknown) => JsonSchema,
    result: Record<string, unknown>,
  ): void {
    if (!("additionalProperties" in raw)) return;
    const ap = raw["additionalProperties"];
    if (typeof ap === "boolean") {
      result["additionalProperties"] = ap;
    } else if (ap !== null && typeof ap === "object" && !Array.isArray(ap)) {
      result["additionalProperties"] = convertFn(ap);
    }
  }

  /**
   * Copies scalar pass-through keywords verbatim into the result.
   * @param raw - The raw schema node.
   * @param result - The result object to mutate.
   */
  applyScalarKeys(raw: Record<string, unknown>, result: Record<string, unknown>): void {
    for (const key of SCALAR_PASS_THROUGH_KEYS) {
      if (key in raw) {
        result[key] = raw[key];
      }
    }
  }
}
