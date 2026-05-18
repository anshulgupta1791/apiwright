/**
 * OperationBodyNormalizer: converts raw OpenAPI/Swagger operation data into
 * FlattenedRequestBody objects.
 *
 * Extracted from OperationFlattener to stay within the 300-line file limit.
 * Pure: does not mutate its inputs. Never throws.
 *
 * Handles:
 *   - OpenAPI 3.x `requestBody` objects (picks a JSON media type by preference)
 *   - Swagger 2.0 `body` parameters (schema lifted from the parameter itself)
 *   - Swagger 2.0 `formData` parameters (synthesized object schema)
 */

import { SpecAccess } from "./spec-access.js";
import type {
  FlattenedParameter,
  FlattenedRequestBody,
  JsonSchema,
  LoadedSpec,
} from "./types.js";

/** JSON media type for request/response body preference. */
const JSON_MEDIA_TYPE = "application/json";

/** Internal type for parameters with raw 2.0 "in" field preserved. */
export interface InternalParam extends FlattenedParameter {
  _raw2xIn?: string;
}

/**
 * Converts raw operation data into a FlattenedRequestBody.
 * Handles 3.x requestBody objects and 2.0 body/formData parameters.
 * Pure; never throws.
 */
export class OperationBodyNormalizer {
  readonly #access: SpecAccess;

  /**
   * Constructs the normalizer with an optional injectable SpecAccess.
   */
  constructor() {
    this.#access = new SpecAccess();
  }

  /**
   * Normalizes the request body for an operation.
   * @param operation - The operation object.
   * @param bodyParams - Swagger 2.0 body parameters.
   * @param formDataParams - Swagger 2.0 formData parameters.
   * @param flavor - The spec flavor.
   * @returns The normalized FlattenedRequestBody, or undefined.
   */
  normalizeRequestBody(
    operation: Record<string, unknown>,
    bodyParams: InternalParam[],
    formDataParams: InternalParam[],
    flavor: LoadedSpec["flavor"],
  ): FlattenedRequestBody | undefined {
    if (flavor === "openapi-3") {
      return this.#normalize3xRequestBody(operation);
    }
    return this.#normalize2xRequestBody(operation, bodyParams, formDataParams);
  }

  /**
   * Normalizes an OpenAPI 3.x requestBody object.
   * @param operation - The operation object.
   * @returns The normalized FlattenedRequestBody, or undefined.
   */
  #normalize3xRequestBody(
    operation: Record<string, unknown>,
  ): FlattenedRequestBody | undefined {
    const requestBody = operation["requestBody"];
    if (!this.#access.isObject(requestBody)) return undefined;

    const content = this.#access.asRecord(requestBody["content"]);
    const mediaType = this.#pickJsonMediaType(content);
    if (mediaType === null) return undefined;

    const mtObj = this.#access.asRecord(content[mediaType]);
    const schema = this.#access.isObject(mtObj["schema"])
      ? (mtObj["schema"] as JsonSchema)
      : undefined;
    const example = mtObj["example"] ?? requestBody["example"];

    const result: FlattenedRequestBody = { mediaType };
    if (schema !== undefined) result.schema = schema;
    if (example !== undefined) result.example = example;
    return result;
  }

  /**
   * Normalizes Swagger 2.0 body/formData parameters into a FlattenedRequestBody.
   * @param operation - The operation object.
   * @param bodyParams - Swagger 2.0 body parameters.
   * @param formDataParams - Swagger 2.0 formData parameters.
   * @returns The normalized FlattenedRequestBody, or undefined.
   */
  #normalize2xRequestBody(
    operation: Record<string, unknown>,
    bodyParams: InternalParam[],
    formDataParams: InternalParam[],
  ): FlattenedRequestBody | undefined {
    if (bodyParams.length > 0) {
      return this.#bodyParamToRequestBody(operation, bodyParams[0]);
    }
    if (formDataParams.length > 0) {
      return this.#formDataToRequestBody(operation, formDataParams);
    }
    return undefined;
  }

  /**
   * Converts a Swagger 2.0 body parameter to a FlattenedRequestBody.
   * @param operation - The operation object (for `consumes`).
   * @param bodyParam - The body parameter (may be undefined).
   * @returns The FlattenedRequestBody.
   */
  #bodyParamToRequestBody(
    operation: Record<string, unknown>,
    bodyParam: InternalParam | undefined,
  ): FlattenedRequestBody {
    const consumes = this.#access.asObjectArray(operation["consumes"]);
    const mediaType = this.#pickJsonFromList(
      consumes.filter((c): c is string => typeof c === "string"),
    ) ?? JSON_MEDIA_TYPE;
    const result: FlattenedRequestBody = { mediaType };
    if (bodyParam?.schema !== undefined) result.schema = bodyParam.schema;
    if (bodyParam?.example !== undefined) result.example = bodyParam.example;
    return result;
  }

  /**
   * Converts Swagger 2.0 formData parameters to a FlattenedRequestBody.
   * @param operation - The operation object (for `consumes`).
   * @param formDataParams - The formData parameters.
   * @returns The FlattenedRequestBody.
   */
  #formDataToRequestBody(
    operation: Record<string, unknown>,
    formDataParams: InternalParam[],
  ): FlattenedRequestBody {
    const consumes = this.#access.asObjectArray(operation["consumes"]);
    const formMediaType =
      (consumes.find(
        (c) => c === "multipart/form-data" || c === "application/x-www-form-urlencoded",
      ) as string | undefined) ?? "application/x-www-form-urlencoded";

    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const p of formDataParams) {
      properties[p.name] = p.schema ?? { type: "string" };
      if (p.required) required.push(p.name);
    }
    const schema: JsonSchema = { type: "object", properties };
    if (required.length > 0) schema["required"] = required;
    return { mediaType: formMediaType, schema };
  }

  /**
   * Picks the JSON media type from a content object by preference order:
   * "application/json" → first *json → first entry.
   * Returns null when the content object is empty.
   * @param content - The content record from the spec.
   * @returns The chosen media type string, or null.
   */
  pickJsonMediaType(content: Record<string, unknown>): string | null {
    return this.#pickJsonMediaType(content);
  }

  /**
   * Internal implementation of pickJsonMediaType.
   * @param content - The content record from the spec.
   * @returns The chosen media type string, or null.
   */
  #pickJsonMediaType(content: Record<string, unknown>): string | null {
    const keys = Object.keys(content);
    if (keys.length === 0) return null;
    if (keys.includes(JSON_MEDIA_TYPE)) return JSON_MEDIA_TYPE;
    const jsonish = keys.find((k) => k.includes("json"));
    if (jsonish !== undefined) return jsonish;
    return keys[0] ?? null;
  }

  /**
   * Picks the first JSON-containing media type from a list.
   * Returns undefined when none found.
   * @param list - The list of media type strings.
   * @returns The first JSON media type, or undefined.
   */
  #pickJsonFromList(list: string[]): string | undefined {
    if (list.includes(JSON_MEDIA_TYPE)) return JSON_MEDIA_TYPE;
    return list.find((mt) => mt.includes("json"));
  }
}
