/**
 * OpenApiResponseSeeder: seeds response.expected_status and response.schema
 * from declared FlattenedResponse entries.
 *
 * Reuses OpenApiSchemaConverter (DRY — no second translation path).
 * Never throws. Always produces a schema-valid CanonicalResponse.
 */

import type { CanonicalResponse } from "../../core/canonical-model.js";

import { OpenApiSchemaConverter } from "./schema-converter.js";
import type { FlattenedOperation, JsonSchema, ResponseSeedResult } from "./types.js";

/** Minimum valid 2xx status code. */
const MIN_2XX = 200;
/** Maximum valid 2xx status code. */
const MAX_2XX = 299;
/** Minimum valid HTTP status code. */
const MIN_STATUS = 100;
/** Maximum valid HTTP status code. */
const MAX_STATUS = 599;
/** Synthetic status code used for "default"-only responses. */
const SYNTHETIC_STATUS = 200;
/** Permissive object schema used when no schema is declared. */
const PERMISSIVE_OBJECT: JsonSchema = { type: "object" };

/** Options for OpenApiResponseSeeder. */
export interface OpenApiResponseSeederOptions {
  /** Shared converter (same class as the request converter). Default new. */
  schemaConverter?: OpenApiSchemaConverter;
}

/**
 * Seeds response.expected_status and response.schema from declared responses.
 * Reuses OpenApiSchemaConverter (DRY). Never throws. Always produces a
 * schema-valid CanonicalResponse with a non-null permissive fallback.
 */
export class OpenApiResponseSeeder {
  readonly #schemaConverter: OpenApiSchemaConverter;

  /**
   * Constructs the seeder with an optional injectable schema converter.
   * @param options - Optional configuration.
   * @param options.schemaConverter - Injectable schema converter; defaults to new.
   */
  constructor(options?: OpenApiResponseSeederOptions) {
    this.#schemaConverter = options?.schemaConverter ?? new OpenApiSchemaConverter();
  }

  /**
   * Seeds response.expected_status and response.schema from declared responses.
   * Never throws.
   * @param op - The flattened operation.
   * @returns Always a ResponseSeedResult with a valid response and warnings.
   */
  seed(op: FlattenedOperation): ResponseSeedResult {
    const warnings: string[] = [];
    const ctx = `${op.method.toUpperCase()} ${op.path}`;

    // Step 1: No responses at all
    if (op.responses.length === 0) {
      warnings.push(
        `Operation ${ctx} declares no responses; defaulted to 200 with a ` +
          `permissive object schema (manual review advised)`,
      );
      return {
        response: { expected_status: SYNTHETIC_STATUS, schema: { ...PERMISSIVE_OBJECT } },
        warnings,
      };
    }

    // Step 2: Partition and choose the best response
    const { chosen, choiceWarning } = this.#chooseResponse(op, ctx);
    if (choiceWarning !== null) warnings.push(choiceWarning);

    // Step 3: Parse expected_status
    const expectedStatus = this.#parseStatus(chosen.statusKey, warnings);

    // Step 4: Convert schema
    const schema = this.#convertSchema(chosen.statusKey, chosen.schema, warnings);

    const response: CanonicalResponse = { expected_status: expectedStatus, schema };
    return { response, warnings };
  }

  /**
   * Chooses the best response from the operation's declared responses.
   * Preference: lowest 2xx → first non-default → synthetic 200 for default-only.
   * @param op - The flattened operation whose responses to choose from.
   * @param ctx - The context string (METHOD path) for warning messages.
   * @returns The chosen response and an optional choice warning.
   */
  #chooseResponse(
    op: FlattenedOperation,
    ctx: string,
  ): { chosen: (typeof op.responses)[0]; choiceWarning: string | null } {
    const responses = op.responses;

    // Find 2xx responses (3-digit int in [200,299])
    const twoxxList = responses.filter((r) => {
      const n = parseInt(r.statusKey, 10);
      return !isNaN(n) && n >= MIN_2XX && n <= MAX_2XX;
    });

    if (twoxxList.length > 0) {
      // Choose lowest 2xx (numerically)
      twoxxList.sort((a, b) => parseInt(a.statusKey, 10) - parseInt(b.statusKey, 10));
      const first2xx = twoxxList[0];
      /* istanbul ignore next — unreachable: twoxxList.length > 0 guarantees [0] is defined */
      if (first2xx !== undefined) {
        return { chosen: first2xx, choiceWarning: null };
      }
    }

    // No 2xx: find first non-default numeric response
    const nonDefault = responses.filter((r) => r.statusKey !== "default");
    const firstNonDefault = nonDefault[0];
    if (firstNonDefault !== undefined) {
      const n = parseInt(firstNonDefault.statusKey, 10);
      const statusStr = isNaN(n) ? firstNonDefault.statusKey : String(n);
      return {
        chosen: firstNonDefault,
        choiceWarning: `Operation ${ctx} has no 2xx response; used status ${statusStr}`,
      };
    }

    // Only "default" responses
    const defaultResp = responses.find((r) => r.statusKey === "default");
    if (defaultResp !== undefined) {
      return {
        chosen: { ...defaultResp, statusKey: String(SYNTHETIC_STATUS) },
        choiceWarning:
          `Operation ${ctx} only declares a 'default' response; ` +
          `used synthetic status ${SYNTHETIC_STATUS}`,
      };
    }

    // Defensive: should not reach here (empty responses handled at top of seed())
    /* istanbul ignore next — unreachable: empty responses handled at top of seed() */
    const fallback = responses[0];
    /* istanbul ignore next — unreachable: responses non-empty here; responses[0] defined */
    if (fallback === undefined) {
      return {
        chosen: { statusKey: String(SYNTHETIC_STATUS), mediaType: "" },
        choiceWarning: null,
      };
    }
    /* istanbul ignore next — unreachable: responses[0] always defined here */
    return { chosen: fallback, choiceWarning: null };
  }

  /**
   * Parses the status key to a numeric expected_status.
   * @param statusKey - The status key string (e.g. "200", "default").
   * @param warnings - Mutable warnings accumulator for out-of-range status.
   * @returns The parsed numeric status code, or SYNTHETIC_STATUS as fallback.
   */
  #parseStatus(statusKey: string, warnings: string[]): number {
    const n = parseInt(statusKey, 10);
    if (!isNaN(n) && n >= MIN_STATUS && n <= MAX_STATUS) {
      return n;
    }
    warnings.push(`Response status '${statusKey}' out of range; defaulted to ${SYNTHETIC_STATUS}`);
    return SYNTHETIC_STATUS;
  }

  /**
   * Converts the response schema or returns a permissive fallback.
   * @param statusKey - The status key string (for the fallback warning message).
   * @param specSchema - The raw schema from the spec, or undefined.
   * @param warnings - Mutable warnings accumulator.
   * @returns The converted schema, or a permissive object schema as fallback.
   */
  #convertSchema(
    statusKey: string,
    specSchema: JsonSchema | undefined,
    warnings: string[],
  ): JsonSchema {
    if (specSchema !== undefined) {
      const { schema, warnings: convWarn } = this.#schemaConverter.convert(specSchema);
      warnings.push(...convWarn);
      return schema;
    }
    warnings.push(`Response ${statusKey} has no JSON schema; used a permissive object schema`);
    return { ...PERMISSIVE_OBJECT };
  }
}
