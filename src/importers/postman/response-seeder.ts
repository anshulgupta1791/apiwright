/**
 * Postman response seeder: derives CanonicalResponse from saved/example
 * responses in a FlattenedRequest.
 *
 * Reuses the shared JsonSchemaInferrer (DRY: same class as request-converter).
 * Never throws. Always returns a valid CanonicalResponse (defaults when needed).
 */

import type { CanonicalResponse } from "../../core/canonical-model.js";
import { parseJson } from "../../core/safe-json.js";
import type { FlattenedRequest } from "../types.js";

import { JsonSchemaInferrer } from "./schema-infer.js";

/** Result of seeding a response from example responses. */
export interface ResponseSeedResult {
  /** Always populated (a schema-valid default is produced when needed). */
  response: CanonicalResponse;
  /** Warnings (default used, non-2xx chosen, non-JSON body, etc.). */
  warnings: string[];
}

/** Default HTTP status code used when no valid status is available. */
const DEFAULT_STATUS = 200;

/** Minimum valid HTTP status code (inclusive). */
const HTTP_STATUS_MIN = 100;

/** Maximum valid HTTP status code (inclusive). */
const HTTP_STATUS_MAX = 599;

/** Lower bound of the 2xx status range (inclusive). */
const TWO_XX_MIN = 200;

/** Upper bound of the 2xx status range (inclusive). */
const TWO_XX_MAX = 299;

/** Options for PostmanResponseSeeder. */
export interface PostmanResponseSeederOptions {
  /** Shared inferrer (same class as the converter). Default new instance. */
  inferrer?: JsonSchemaInferrer;
}

/**
 * Seeds response.expected_status and response.schema from a request's
 * saved/example responses. Never throws. Always returns a valid
 * CanonicalResponse even when no examples are available.
 *
 * Algorithm:
 * 1. No responses → default 200 + {} schema + manual-review warning.
 * 2. Pick first 2xx; if none, pick first (document order) + non-2xx warning.
 * 3. expected_status = chosen.code when in [100,599]; else 200 + range warning.
 * 4. Body: JSON → inferred schema; non-JSON → {type:"object"} + warning;
 *    empty → {} + warning.
 */
export class PostmanResponseSeeder {
  readonly #inferrer: JsonSchemaInferrer;

  /**
   * Constructs a PostmanResponseSeeder with an optional injectable schema inferrer.
   * @param options - Optional configuration.
   * @param options.inferrer - Injectable schema inferrer; defaults to JsonSchemaInferrer.
   */
  constructor(options?: PostmanResponseSeederOptions) {
    this.#inferrer = options?.inferrer ?? new JsonSchemaInferrer();
  }

  /**
   * Seeds response.expected_status and response.schema from a request's
   * saved/example responses. Never throws.
   * @param request - The flattened request (only responses is read).
   * @returns A complete CanonicalResponse plus warnings.
   */
  seed(request: FlattenedRequest): ResponseSeedResult {
    const warnings: string[] = [];

    // Step 1: No examples → default
    if (request.responses.length === 0) {
      warnings.push(
        `Request '${request.name}' has no example response; defaulted to 200 with empty` +
          ` schema (manual review advised)`,
      );
      return {
        response: { expected_status: DEFAULT_STATUS, schema: {} },
        warnings,
      };
    }

    // Step 2: Choose example — first 2xx, or first overall (responses is non-empty here)
    const twoXx = request.responses.find(
      (r) => r.code >= TWO_XX_MIN && r.code <= TWO_XX_MAX,
    );
    // responses is non-empty (checked above); find returns undefined only when no 2xx
    const firstResponse = request.responses.at(0);
    /* istanbul ignore next — responses is non-empty; at(0) always returns a value here */
    const chosen = twoXx ?? firstResponse ?? { code: DEFAULT_STATUS, body: "" };
    if (!twoXx) {
      warnings.push(
        `Request '${request.name}' has no 2xx example; used status ${chosen.code}`,
      );
    }

    // Step 3: Validate status code range
    let expectedStatus = chosen.code;
    if (expectedStatus < HTTP_STATUS_MIN || expectedStatus > HTTP_STATUS_MAX) {
      warnings.push(
        `Example response status ${expectedStatus} out of range; defaulted to 200`,
      );
      expectedStatus = DEFAULT_STATUS;
    }

    // Step 4: Schema from body
    if (!chosen.body || chosen.body === "") {
      warnings.push(`Example response had no body; used empty schema`);
      return {
        response: { expected_status: expectedStatus, schema: {} },
        warnings,
      };
    }

    const parsed = parseJson(chosen.body);
    if (!parsed.ok) {
      warnings.push(
        `Example response body is not valid JSON; used permissive object schema`,
      );
      return {
        response: {
          expected_status: expectedStatus,
          schema: { type: "object" },
        },
        warnings,
      };
    }

    const schema = this.#inferrer.infer(parsed.value);
    return {
      response: { expected_status: expectedStatus, schema },
      warnings,
    };
  }
}
