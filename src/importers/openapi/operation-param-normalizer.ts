/**
 * OperationParamNormalizer: normalizes raw OpenAPI/Swagger parameter objects
 * into InternalParam arrays, handles path/query/header location mapping,
 * merges path-level and operation-level parameters, and lifts Swagger 2.0
 * inline type keywords into schema objects.
 *
 * Extracted from OperationFlattener to stay within the 300-line file limit.
 * Pure: does not mutate its inputs. Never throws.
 */

import type { InternalParam } from "./operation-body-normalizer.js";
import { SpecAccess } from "./spec-access.js";
import type { JsonSchema, LoadedSpec } from "./types.js";

/**
 * Normalizes raw parameter arrays and merges path-level + operation-level
 * parameters for OpenAPI 3.x and Swagger 2.0 operations.
 * Pure; never throws.
 */
export class OperationParamNormalizer {
  readonly #access: SpecAccess;

  /**
   * Constructs the normalizer.
   */
  constructor() {
    this.#access = new SpecAccess();
  }

  /**
   * Normalizes an array of raw parameter objects into InternalParam.
   * For 2.0, also handles inline type keywords and body/formData routing.
   * @param rawParams - The raw parameter objects from the spec.
   * @param flavor - The spec flavor.
   * @returns The normalized InternalParam array.
   */
  normalizeParameters(
    rawParams: unknown[],
    flavor: LoadedSpec["flavor"],
  ): InternalParam[] {
    const result: InternalParam[] = [];

    for (const rawParam of rawParams) {
      if (!this.#access.isObject(rawParam)) continue;
      const param = this.#normalizeOneParam(rawParam, flavor);
      if (param !== null) result.push(param);
    }
    return result;
  }

  /**
   * Merges path-level parameters with operation-level parameters.
   * Operation-level wins on name+location conflict.
   * @param pathParams - Path-level normalized parameters.
   * @param opParams - Operation-level normalized parameters.
   * @returns The merged InternalParam array.
   */
  mergeParameters(
    pathParams: InternalParam[],
    opParams: InternalParam[],
  ): InternalParam[] {
    const merged = [...pathParams];
    for (const opParam of opParams) {
      const idx = merged.findIndex(
        (p) => p.name === opParam.name &&
          p.location === opParam.location &&
          p._raw2xIn === opParam._raw2xIn,
      );
      if (idx >= 0) {
        merged[idx] = opParam;
      } else {
        merged.push(opParam);
      }
    }
    return merged;
  }

  /**
   * Normalizes a single raw parameter object into an InternalParam, or returns
   * null when the parameter cannot be mapped (e.g., unrecognized `in` value).
   * @param rawParam - The raw parameter object (already confirmed isObject).
   * @param flavor - The spec flavor.
   * @returns An InternalParam, or null.
   */
  #normalizeOneParam(
    rawParam: Record<string, unknown>,
    flavor: LoadedSpec["flavor"],
  ): InternalParam | null {
    const inVal = this.#access.asString(rawParam["in"]) ?? "";
    const name = this.#access.asString(rawParam["name"]) ?? "";

    if (flavor === "swagger-2") {
      const swaggerParam = this.#trySwagger2SpecialParam(rawParam, inVal, name);
      if (swaggerParam !== null) return swaggerParam;
    }

    const location = this.#toParamLocation(inVal);
    if (location === null) return null;

    const schema = this.#resolveParamSchema(rawParam, flavor);
    const param: InternalParam = {
      name,
      location,
      required: location === "path" ? true : rawParam["required"] === true,
    };
    if (schema !== undefined) param.schema = schema;
    const example = rawParam["example"];
    if (example !== undefined) param.example = example;
    return param;
  }

  /**
   * Attempts to build a Swagger 2.0 special-case parameter (body or formData).
   * Returns null when the param is not a 2.0 body/formData param.
   * @param rawParam - The raw parameter object.
   * @param inVal - The "in" field value.
   * @param name - The parameter name.
   * @returns An InternalParam with _raw2xIn set, or null.
   */
  #trySwagger2SpecialParam(
    rawParam: Record<string, unknown>,
    inVal: string,
    name: string,
  ): InternalParam | null {
    if (inVal === "body") {
      const param: InternalParam = {
        name, location: "path", required: rawParam["required"] === true, _raw2xIn: "body",
      };
      const schema = this.#access.isObject(rawParam["schema"]) ? rawParam["schema"] : undefined;
      if (schema !== undefined) param.schema = schema;
      const example = rawParam["x-example"];
      if (example !== undefined) param.example = example;
      return param;
    }
    if (inVal === "formData") {
      const param: InternalParam = {
        name, location: "path", required: rawParam["required"] === true, _raw2xIn: "formData",
      };
      const schema = this.#lift2xInlineSchema(rawParam);
      if (schema !== undefined) param.schema = schema;
      return param;
    }
    return null;
  }

  /**
   * Resolves a parameter's schema based on flavor.
   * @param rawParam - The raw parameter object.
   * @param flavor - The spec flavor.
   * @returns The resolved JsonSchema, or undefined when none.
   */
  #resolveParamSchema(
    rawParam: Record<string, unknown>,
    flavor: LoadedSpec["flavor"],
  ): JsonSchema | undefined {
    if (flavor === "swagger-2") {
      return this.#lift2xInlineSchema(rawParam);
    }
    return this.#access.isObject(rawParam["schema"]) ? rawParam["schema"] : undefined;
  }

  /**
   * Maps an `in` value to a parameter location, returning null for unknown.
   * @param inVal - The "in" field value from the spec.
   * @returns The canonical location string, or null when unrecognized.
   */
  #toParamLocation(inVal: string): "path" | "query" | "header" | null {
    if (inVal === "path") return "path";
    if (inVal === "query") return "query";
    if (inVal === "header") return "header";
    return null;
  }

  /**
   * Lifts Swagger 2.0 inline type keywords (type, format, items, enum) into
   * a schema object. Returns undefined when none of the keywords are present.
   * @param rawParam - The raw parameter object.
   * @returns The lifted JsonSchema, or undefined.
   */
  #lift2xInlineSchema(rawParam: Record<string, unknown>): JsonSchema | undefined {
    const type = this.#access.asString(rawParam["type"]);
    if (type === undefined) {
      if (this.#access.isObject(rawParam["schema"])) {
        return rawParam["schema"];
      }
      return undefined;
    }
    const schema: JsonSchema = { type };
    if (rawParam["format"] !== undefined) schema["format"] = rawParam["format"];
    if (Array.isArray(rawParam["items"])) schema["items"] = rawParam["items"];
    else if (this.#access.isObject(rawParam["items"])) schema["items"] = rawParam["items"];
    if (Array.isArray(rawParam["enum"])) schema["enum"] = rawParam["enum"];
    return schema;
  }
}
