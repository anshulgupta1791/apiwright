/**
 * Boundary-battery generator — emits inside/outside boundary test cases for
 * constrained fields in a request body schema.
 *
 * Handles minimum/maximum (numeric), minLength/maxLength (string), and enum
 * constraints. Special cases: minLength=0 outside suppressed; empty enum
 * suppressed.
 */

import type { CanonicalEndpoint } from "../../core/canonical-model.js";
import type {
  BoundaryParams,
  FieldDescriptor,
  GenerationContext,
  GeneratorResult,
  TestCase,
  TestCaseGenerator,
} from "../types.js";

/** HTTP 400 Bad Request — expected status for all outside-boundary cases. */
const HTTP_BAD_REQUEST = 400;

/** Sentinel used as the primary candidate for the "outside enum" value. */
const ENUM_OUTSIDE_SENTINEL = "__apiwright_not_in_enum__";

/** Ordered constraint keys processed per field (determines ordinal offset). */
const CONSTRAINT_KEYS = ["minimum", "maximum", "minLength", "maxLength", "enum"] as const;

type ConstraintKey = typeof CONSTRAINT_KEYS[number];

/**
 * Generates boundary-battery regression test cases for constrained schema fields.
 *
 * For each constrained field and constraint, emits an inside case (at the
 * boundary value, expects success) and an outside case (beyond boundary, expects
 * 400). Suppresses: outside case for minLength=0; all enum cases for empty enum.
 */
export class BoundaryBatteryGenerator implements TestCaseGenerator {
  /**
   * Expands one endpoint into boundary-battery cases (0 or more).
   * @param endpoint - The validated canonical endpoint.
   * @param ctx - Shared injected collaborators.
   * @returns Boundary cases plus any walker depth warnings.
   */
  generate(endpoint: CanonicalEndpoint, ctx: GenerationContext): GeneratorResult {
    if (endpoint.request.body_schema === undefined) {
      return { cases: [], warnings: [] };
    }

    const { ids, markers, prodSafety, walker } = ctx;
    const marker = markers.markerFor("boundary_battery");
    const prodSafe = prodSafety.classifyProdSafe({ marker, method: endpoint.method });
    const successStatus = endpoint.response.expected_status;

    const walkerResult = walker.walk(endpoint.request.body_schema);
    const warnings: string[] = [...walkerResult.warnings];
    const cases: TestCase[] = [];

    walkerResult.fields.forEach((field, fieldIdx) => {
      let constraintOffset = 0;

      for (const constraintKey of CONSTRAINT_KEYS) {
        const constraintValue: number | unknown[] | undefined = field.constraints[constraintKey];
        if (constraintValue === undefined) {
          constraintOffset += 2; // reserve ordinal space for each constraint slot
          continue;
        }

        const basedOrdinal = fieldIdx * CONSTRAINT_KEYS.length * 2 + constraintOffset;
        this.#buildConstraintCases(
          endpoint.id,
          endpoint.name,
          field,
          constraintKey,
          constraintValue,
          successStatus,
          marker,
          prodSafe,
          basedOrdinal,
          ids,
          cases,
        );

        constraintOffset += 2;
      }
    });

    return { cases, warnings };
  }

  #buildConstraintCases(
    endpointId: string,
    endpointName: string,
    field: FieldDescriptor,
    constraintKey: ConstraintKey,
    constraintValue: number | unknown[],
    successStatus: number,
    marker: "smoke" | "regression" | "e2e",
    prodSafe: boolean,
    baseOrdinal: number,
    ids: GenerationContext["ids"],
    cases: TestCase[],
  ): void {
    const makeCase = (
      position: "inside" | "outside",
      value: unknown,
      expectedStatus: number,
      ordinal: number,
    ): TestCase => ({
      id: ids.make(endpointId, "boundary_battery", ordinal),
      endpoint_id: endpointId,
      type: "boundary_battery",
      marker,
      title: `Boundary battery (${field.path} ${constraintKey} ${position}) for ${endpointName}`,
      prod_safe: prodSafe,
      params: {
        kind: "boundary_battery",
        field: field.path,
        constraint: constraintKey,
        position,
        value,
        expected_status: expectedStatus,
      } satisfies BoundaryParams,
    });

    if (constraintKey === "minimum") {
      const m = constraintValue as number;
      cases.push(makeCase("inside", m, successStatus, baseOrdinal));
      cases.push(makeCase("outside", m - 1, HTTP_BAD_REQUEST, baseOrdinal + 1));
    } else if (constraintKey === "maximum") {
      const M = constraintValue as number;
      cases.push(makeCase("inside", M, successStatus, baseOrdinal));
      cases.push(makeCase("outside", M + 1, HTTP_BAD_REQUEST, baseOrdinal + 1));
    } else if (constraintKey === "minLength") {
      const n = constraintValue as number;
      cases.push(makeCase("inside", "a".repeat(n), successStatus, baseOrdinal));
      if (n > 0) {
        cases.push(makeCase("outside", "a".repeat(n - 1), HTTP_BAD_REQUEST, baseOrdinal + 1));
      }
      // minLength === 0: suppress outside case (no negative-length string constructible)
    } else if (constraintKey === "maxLength") {
      const x = constraintValue as number;
      cases.push(makeCase("inside", "a".repeat(x), successStatus, baseOrdinal));
      cases.push(makeCase("outside", "a".repeat(x + 1), HTTP_BAD_REQUEST, baseOrdinal + 1));
    } else if (constraintKey === "enum") {
      const enumValues = constraintValue as unknown[];
      if (enumValues.length === 0) {
        return; // empty enum: suppress all boundary cases
      }
      const insideValue = enumValues[0];
      const outsideValue = this.#firstAbsentValue(enumValues);
      cases.push(makeCase("inside", insideValue, successStatus, baseOrdinal));
      cases.push(makeCase("outside", outsideValue, HTTP_BAD_REQUEST, baseOrdinal + 1));
    }
  }

  /**
   * Returns a deterministic literal not deep-equal to any member of the enum.
   * @param enumValues - The enum members to avoid.
   * @returns A value provably absent from enumValues.
   */
  #firstAbsentValue(enumValues: unknown[]): unknown {
    if (!enumValues.includes(ENUM_OUTSIDE_SENTINEL)) {
      return ENUM_OUTSIDE_SENTINEL;
    }
    if (!enumValues.includes(0)) {
      return 0;
    }
    if (!enumValues.includes(false)) {
      return false;
    }
    // Fallback: find a numeric sentinel not in the enum
    let n = 1;
    while (enumValues.includes(n)) {
      n++;
    }
    return n;
  }
}
