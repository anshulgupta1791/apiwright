/**
 * Universal generator — emits the 5 always-on smoke test cases for any endpoint.
 *
 * These cases form the core "smoke" family per V1_BUILD_SPEC.md §3:
 * status_code_conformance, content_type_alignment, response_schema_validation,
 * auth_happy_path, response_time_sla.
 */

import type { CanonicalEndpoint } from "../../core/canonical-model.js";
import type {
  GenerationContext,
  GeneratorResult,
  TestCase,
  TestCaseGenerator,
} from "../types.js";

/**
 * Generates the 5 universal smoke test cases for any canonical endpoint.
 *
 * Always emits exactly 5 cases in a fixed order. All cases have marker=smoke
 * and prod_safe derived from the endpoint method and prod_safe flag.
 */
export class UniversalGenerator implements TestCaseGenerator {
  /**
   * Expands one endpoint into the 5 universal smoke cases.
   * @param endpoint - The validated canonical endpoint.
   * @param ctx - Shared injected collaborators.
   * @returns Exactly 5 cases plus an empty warnings array.
   */
  generate(endpoint: CanonicalEndpoint, ctx: GenerationContext): GeneratorResult {
    const { ids, markers, prodSafety } = ctx;
    const marker = markers.markerFor("status_code_conformance"); // always "smoke"
    const prodSafeInput = endpoint.prod_safe !== undefined
      ? { marker, method: endpoint.method, endpointProdSafe: endpoint.prod_safe }
      : { marker, method: endpoint.method };
    const prodSafe = prodSafety.classifyProdSafe(prodSafeInput);

    const cases: TestCase[] = [
      {
        id: ids.make(endpoint.id, "status_code_conformance", 0),
        endpoint_id: endpoint.id,
        type: "status_code_conformance",
        marker,
        title: `Status code conformance for ${endpoint.name}`,
        prod_safe: prodSafe,
        params: {
          kind: "status_code_conformance",
          expected_status: endpoint.response.expected_status,
        },
      },
      {
        id: ids.make(endpoint.id, "content_type_alignment", 0),
        endpoint_id: endpoint.id,
        type: "content_type_alignment",
        marker,
        title: `Content-type alignment for ${endpoint.name}`,
        prod_safe: prodSafe,
        params: { kind: "content_type_alignment" },
      },
      {
        id: ids.make(endpoint.id, "response_schema_validation", 0),
        endpoint_id: endpoint.id,
        type: "response_schema_validation",
        marker,
        title: `Response schema validation for ${endpoint.name}`,
        prod_safe: prodSafe,
        params: {
          kind: "response_schema_validation",
          schema: endpoint.response.schema,
        },
      },
      {
        id: ids.make(endpoint.id, "auth_happy_path", 0),
        endpoint_id: endpoint.id,
        type: "auth_happy_path",
        marker,
        title: `Auth happy path for ${endpoint.name}`,
        prod_safe: prodSafe,
        params: {
          kind: "auth_happy_path",
          auth_strategy: endpoint.auth_strategy ?? null,
          unauthenticated: endpoint.auth_strategy === undefined,
        },
      },
      ...this.#buildSlaCase(
        endpoint,
        ids.make(endpoint.id, "response_time_sla", 0),
        marker,
        prodSafe,
      ),
    ];

    return { cases, warnings: [] };
  }

  #buildSlaCase(
    endpoint: CanonicalEndpoint,
    id: string,
    marker: "smoke" | "regression" | "e2e",
    prodSafe: boolean,
  ): TestCase[] {
    const base = {
      id,
      endpoint_id: endpoint.id,
      type: "response_time_sla" as const,
      marker,
      title: `Response time SLA for ${endpoint.name}`,
      prod_safe: prodSafe,
    };

    if (endpoint.response.sla_ms !== undefined) {
      return [{
        ...base,
        params: {
          kind: "response_time_sla" as const,
          sla_ms: endpoint.response.sla_ms,
          sla_delegated: false,
        },
      }];
    }

    return [{
      ...base,
      params: { kind: "response_time_sla" as const, sla_delegated: true },
    }];
  }
}
