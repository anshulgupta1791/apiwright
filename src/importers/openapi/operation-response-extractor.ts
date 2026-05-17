/**
 * OperationResponseExtractor: extracts normalized FlattenedResponse objects
 * from raw OpenAPI/Swagger operation response maps.
 *
 * Extracted from OperationFlattener to stay within the 300-line file limit.
 * Pure: does not mutate its inputs. Never throws.
 */

import { OperationBodyNormalizer } from "./operation-body-normalizer.js";
import { SpecAccess } from "./spec-access.js";
import type { FlattenedResponse, JsonSchema, LoadedSpec } from "./types.js";

/** JSON media type for Swagger 2.0 response schema fallback. */
const JSON_MEDIA_TYPE = "application/json";

/**
 * Extracts FlattenedResponse objects from an operation's response map.
 * Handles both OpenAPI 3.x (content-typed) and Swagger 2.0 (schema-on-response).
 * Pure; never throws.
 */
export class OperationResponseExtractor {
  readonly #access: SpecAccess;
  readonly #bodyNormalizer: OperationBodyNormalizer;

  /**
   * Constructs the extractor.
   */
  constructor() {
    this.#access = new SpecAccess();
    this.#bodyNormalizer = new OperationBodyNormalizer();
  }

  /**
   * Normalizes the responses for an operation.
   * @param operation - The operation object.
   * @param flavor - The spec flavor.
   * @returns The normalized FlattenedResponse array.
   */
  normalizeResponses(
    operation: Record<string, unknown>,
    flavor: LoadedSpec["flavor"],
  ): FlattenedResponse[] {
    const responsesRaw = operation["responses"];
    if (!this.#access.isObject(responsesRaw)) return [];

    const result: FlattenedResponse[] = [];
    for (const [statusKey, responseVal] of Object.entries(responsesRaw)) {
      if (!this.#access.isObject(responseVal)) continue;
      const { schema, mediaType } = this.#extractResponseSchema(responseVal, flavor);
      const resp: FlattenedResponse = { statusKey, mediaType };
      if (schema !== undefined) resp.schema = schema;
      result.push(resp);
    }
    return result;
  }

  /**
   * Extracts the schema and media type from a response object.
   * @param response - The response object from the spec.
   * @param flavor - The spec flavor.
   * @returns The schema and media type pair.
   */
  #extractResponseSchema(
    response: Record<string, unknown>,
    flavor: LoadedSpec["flavor"],
  ): { schema: JsonSchema | undefined; mediaType: string } {
    if (flavor === "openapi-3") {
      const content = this.#access.asRecord(response["content"]);
      const mediaType = this.#bodyNormalizer.pickJsonMediaType(content);
      if (mediaType === null) return { schema: undefined, mediaType: "" };
      const mtObj = this.#access.asRecord(content[mediaType]);
      const schema = this.#access.isObject(mtObj["schema"]) ? mtObj["schema"] : undefined;
      return { schema, mediaType };
    }
    // Swagger 2.0: schema is directly on the response
    const schema = this.#access.isObject(response["schema"]) ? response["schema"] : undefined;
    return { schema, mediaType: schema !== undefined ? JSON_MEDIA_TYPE : "" };
  }
}
