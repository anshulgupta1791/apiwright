/**
 * JSON Schema inferrer: derives a JSON Schema from a concrete JSON example value.
 *
 * Deterministic and total: identical input → byte-identical schema output.
 * Throws a RangeError only when the value nests deeper than
 * {@link JsonSchemaInferrer.MAX_DEPTH} — a deterministic, platform-independent
 * limit chosen far below any JS engine's call-stack ceiling, so a pathological
 * body fails the same way on every machine (the importer catches it and skips
 * the request with a warning). Shared by PostmanRequestConverter (request
 * body) and PostmanResponseSeeder (response body) — single source, DRY.
 */

import type { JsonSchema } from "../../core/canonical-model.js";

/**
 * Maximum supported nesting depth. Real API bodies nest far shallower; this
 * ceiling is orders of magnitude below any JS engine's call-stack limit, so
 * exceeding it throws a deterministic, catchable RangeError BEFORE a native
 * "Maximum call stack size exceeded" can occur — making deep-body handling
 * identical on every platform (CI Linux vs. a developer's machine) instead
 * of depending on stack size.
 */
const MAX_DEPTH = 512;

/**
 * Infers JSON Schemas from concrete JSON example values.
 *
 * Algorithm (recursive, deterministic):
 *   null → {type:"null"}
 *   boolean → {type:"boolean"}
 *   integer → {type:"integer"}, float → {type:"number"}
 *   string → {type:"string"}
 *   empty array → {type:"array", items:{}}
 *   uniform array → items = element schema
 *   heterogeneous array → items = {oneOf:[...distinct schemas, first-seen order]}
 *   empty object → {type:"object", properties:{}, required:[]}
 *   non-empty object → properties (insertion order) + required (all keys)
 *   undefined → {} (matches anything; defensive guard for sparse arrays)
 */
export class JsonSchemaInferrer {
  /**
   * Infers a JSON Schema from a concrete JSON example value.
   * Deterministic and total for any value nesting within {@link MAX_DEPTH}.
   * @param example - Any JSON value (object/array/primitive/null/undefined).
   * @param depth - Current recursion depth (internal; callers omit it).
   * @returns A JSON Schema describing the example's structure.
   * @throws RangeError when nesting exceeds {@link MAX_DEPTH}.
   */
  infer(example: unknown, depth = 0): JsonSchema {
    if (depth > MAX_DEPTH) {
      throw new RangeError(
        `JSON value nesting exceeds the maximum supported depth ` +
          `(${MAX_DEPTH})`,
      );
    }

    if (example === undefined) {
      // Defensive guard: callers only pass parsed JSON which never yields
      // undefined at the root; this guard is for nested holes in sparse arrays.
      return {};
    }

    if (example === null) {
      return { type: "null" };
    }

    if (typeof example === "boolean") {
      return { type: "boolean" };
    }

    if (typeof example === "number") {
      return Number.isInteger(example)
        ? { type: "integer" }
        : { type: "number" };
    }

    if (typeof example === "string") {
      return { type: "string" };
    }

    if (Array.isArray(example)) {
      return this.#inferArray(example, depth);
    }

    if (typeof example === "object") {
      return this.#inferObject(example as Record<string, unknown>, depth);
    }

    // Fallback (unreachable for valid JSON types, but TypeScript requires it)
    return {};
  }

  /**
   * Infers the schema for an array value.
   * @param arr - The array to infer a schema for.
   * @param depth - Current recursion depth (propagated to elements).
   * @returns A JSON Schema for the array.
   */
  #inferArray(arr: unknown[], depth: number): JsonSchema {
    if (arr.length === 0) {
      return { type: "array", items: {} };
    }

    // Infer schema for each element
    const elementSchemas = arr.map((el) => this.infer(el, depth + 1));

    // De-duplicate schemas by deep equality (preserve first-seen order).
    // INVARIANT: correctness of this JSON.stringify comparison (and the
    // diff-clean re-import contract) depends on this inferrer being the
    // ONLY schema source and always emitting a fixed key order (`type`
    // first; objects `type,properties,required`; arrays `type,items`).
    // Any future change introducing variable key ordering into produced
    // schemas would silently break this dedup and re-import stability.
    const distinct: JsonSchema[] = [];
    for (const schema of elementSchemas) {
      const serialized = JSON.stringify(schema);
      if (!distinct.some((s) => JSON.stringify(s) === serialized)) {
        distinct.push(schema);
      }
    }

    if (distinct.length === 1) {
      // All elements have the same schema
      return { type: "array", items: distinct[0] };
    }

    // Heterogeneous: use oneOf with distinct schemas in first-seen order
    return { type: "array", items: { oneOf: distinct } };
  }

  /**
   * Infers the schema for a plain object value.
   * @param obj - The object to infer a schema for.
   * @param depth - Current recursion depth (propagated to property values).
   * @returns A JSON Schema for the object.
   */
  #inferObject(obj: Record<string, unknown>, depth: number): JsonSchema {
    const keys = Object.keys(obj);
    const properties: Record<string, JsonSchema> = {};

    for (const key of keys) {
      properties[key] = this.infer(obj[key], depth + 1);
    }

    return {
      type: "object",
      properties,
      required: [...keys],
    };
  }
}
