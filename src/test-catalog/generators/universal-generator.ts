/**
 * Universal generator — emits the 5 always-on smoke test cases for any endpoint.
 *
 * These cases form the core "smoke" family per §3:
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

/** Sentinel marker the importers stamp into a stub schema. */
const PENDING_REVIEW_KEY = "_pending_review";

/**
 * True when the schema offers no meaningful constraint and a
 * `response_schema_validation` case would trivially pass against any 2xx body
 * — making the case a false-positive avenue. Catches three cases:
 * (a) `undefined` (no schema declared), (b) `{}` (empty object — matches
 * anything), (c) `{_pending_review: true}` (importer sentinel: schema needs
 * manual review). Real schemas (incl. `{type:"object"}`) are NOT empty.
 * @param schema - The response schema (may be undefined).
 * @returns True iff the schema is effectively absent.
 */
function isEffectivelyEmptySchema(
  schema: Readonly<Record<string, unknown>> | undefined,
): boolean {
  if (schema === undefined) return true;
  const keys = Object.keys(schema);
  if (keys.length === 0) return true;
  if (schema[PENDING_REVIEW_KEY] === true) return true;
  return false;
}

/**
 * Generates the universal smoke test cases for any canonical endpoint.
 *
 * Emits 5 cases when the endpoint declares a response schema, or 4 when it
 * does not (the `response_schema_validation` case is omitted for bodyless
 * responses — 204/text/status-only — and a warning records the skip). All
 * cases have marker=smoke and prod_safe derived from the method and flag.
 */
export class UniversalGenerator implements TestCaseGenerator {
  /**
   * Expands one endpoint into the universal smoke cases (5, or 4 when no
   * response schema is declared).
   * @param endpoint - The validated canonical endpoint.
   * @param ctx - Shared injected collaborators.
   * @returns The universal cases plus any generation warnings (a schema-skip
   *   notice when `response.schema` is absent).
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
      ...this.#buildSchemaCase(
        endpoint,
        ids.make(endpoint.id, "response_schema_validation", 0),
        marker,
        prodSafe,
      ),
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

    const warnings = isEffectivelyEmptySchema(endpoint.response.schema)
      ? [
          `Endpoint '${endpoint.id}': response.schema is empty or pending review; ` +
            `response_schema_validation skipped to avoid false-positive PASSes against ` +
            `any 2xx body. Tighten the schema in the endpoint file to enable validation.`,
        ]
      : [];
    return { cases, warnings };
  }

  /**
   * Builds the `response_schema_validation` case, or an empty array when the
   * endpoint declares no response schema (bodyless responses). Mirrors the
   * optional-field pattern used by {@link UniversalGenerator.#buildSlaCase}.
   * @param endpoint - The canonical endpoint.
   * @param id - The pre-computed stable case id.
   * @param marker - The case marker (always "smoke").
   * @param prodSafe - The prod-safety classification for this endpoint.
   * @returns A single-element array, or `[]` when no schema is declared.
   */
  #buildSchemaCase(
    endpoint: CanonicalEndpoint,
    id: string,
    marker: "smoke" | "regression" | "e2e",
    prodSafe: boolean,
  ): TestCase[] {
    const schema = endpoint.response.schema;
    // Issue #C: also treat `{}` and `{_pending_review: true}` (importer
    // sentinels) as effectively-absent — running validation against them
    // is a false-positive avenue, not a real test. See
    // `isEffectivelyEmptySchema` for the full rule. The `schema === undefined`
    // narrow keeps TS happy on the params.schema field below.
    if (schema === undefined || isEffectivelyEmptySchema(schema)) return [];
    return [{
      id,
      endpoint_id: endpoint.id,
      type: "response_schema_validation" as const,
      marker,
      title: `Response schema validation for ${endpoint.name}`,
      prod_safe: prodSafe,
      params: { kind: "response_schema_validation" as const, schema },
    }];
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
