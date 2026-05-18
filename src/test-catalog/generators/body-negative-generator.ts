/**
 * Body-negative generator — emits malformed JSON, required-field omission,
 * and type-violation regression test cases.
 *
 * Active only when a body schema or body example is present. Delegates field
 * discovery to the injected SchemaWalker.
 */

import type { CanonicalEndpoint } from "../../core/canonical-model.js";
import type {
  FieldDescriptor,
  GenerationContext,
  GeneratorResult,
  TestCase,
  TestCaseGenerator,
} from "../types.js";

/** Deterministic invalid-JSON literal sent as the malformed body. */
const MALFORMED_JSON_LITERAL = '{"unterminated":';

/** HTTP 400 Bad Request — expected status for all body-negative cases. */
const HTTP_BAD_REQUEST = 400;

/**
 * Deterministic type-substitution map: original JSON type → wrong-type substitute.
 * Every entry must differ from the key (enforced by construction).
 */
const WRONG_TYPE_MAP: Readonly<Record<string, string>> = {
  string: "number",
  number: "string",
  integer: "string",
  boolean: "string",
  object: "string",
  array: "string",
};

/**
 * Generates body-negative regression test cases for endpoints with body schemas.
 *
 * Emits in fixed order: one malformed_json_returns_400, then one
 * required_field_omission_returns_400 per required field (walker order), then
 * one type_violation_returns_400 per typed field (walker order).
 */
export class BodyNegativeGenerator implements TestCaseGenerator {
  /**
   * Expands one endpoint into body-negative cases (0 or more).
   * @param endpoint - The validated canonical endpoint.
   * @param ctx - Shared injected collaborators.
   * @returns Body-negative regression cases plus any walker depth warnings.
   */
  generate(endpoint: CanonicalEndpoint, ctx: GenerationContext): GeneratorResult {
    const hasBody = endpoint.request.body_schema !== undefined
      || endpoint.request.body_example !== undefined;
    if (!hasBody) {
      return { cases: [], warnings: [] };
    }

    const { ids, markers, prodSafety, walker } = ctx;
    const marker = markers.markerFor("malformed_json_returns_400");
    const prodSafe = prodSafety.classifyProdSafe({ marker, method: endpoint.method });

    const walkerResult = walker.walk(endpoint.request.body_schema ?? {});
    const fields = walkerResult.fields;
    const warnings: string[] = [...walkerResult.warnings];

    const cases: TestCase[] = [];

    // 1. Malformed JSON case (always one)
    cases.push({
      id: ids.make(endpoint.id, "malformed_json_returns_400", 0),
      endpoint_id: endpoint.id,
      type: "malformed_json_returns_400",
      marker,
      title: `Malformed JSON returns 400 for ${endpoint.name}`,
      prod_safe: prodSafe,
      params: {
        kind: "malformed_json_returns_400",
        malformed_body: MALFORMED_JSON_LITERAL,
        expected_status: HTTP_BAD_REQUEST,
      },
    });

    // 2. Required field omission cases
    for (const field of fields) {
      if (!field.required) continue;
      const ordinal = fields.indexOf(field);
      cases.push({
        id: ids.make(endpoint.id, "required_field_omission_returns_400", ordinal),
        endpoint_id: endpoint.id,
        type: "required_field_omission_returns_400",
        marker,
        title: `Required field omission (${field.path}) returns 400 for ${endpoint.name}`,
        prod_safe: prodSafe,
        params: {
          kind: "required_field_omission_returns_400",
          omitted_field: field.path,
          expected_status: HTTP_BAD_REQUEST,
        },
      });
    }

    // 3. Type violation cases (one per typed field)
    this.#buildTypeViolationCases(endpoint.id, endpoint.name, fields, marker, prodSafe, ids, cases);

    return { cases, warnings };
  }

  #buildTypeViolationCases(
    endpointId: string,
    endpointName: string,
    fields: FieldDescriptor[],
    marker: "smoke" | "regression" | "e2e",
    prodSafe: boolean,
    ids: GenerationContext["ids"],
    cases: TestCase[],
  ): void {
    fields.forEach((field, i) => {
      if (field.jsonType === "unknown") {
        return;
      }
      const wrongType: string = WRONG_TYPE_MAP[field.jsonType] ?? "string";
      cases.push({
        id: ids.make(endpointId, "type_violation_returns_400", i),
        endpoint_id: endpointId,
        type: "type_violation_returns_400",
        marker,
        title: `Type violation (${field.path}: ${field.jsonType}) returns 400 for ${endpointName}`,
        prod_safe: prodSafe,
        params: {
          kind: "type_violation_returns_400",
          field: field.path,
          original_type: field.jsonType,
          wrong_type: wrongType,
          expected_status: HTTP_BAD_REQUEST,
        },
      });
    });
  }
}
