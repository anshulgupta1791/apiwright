/**
 * Conditional GET (RFC 7232) generator — emits a `conditional_get_304` case for
 * GET endpoints that declare `etag_supported: true`.
 *
 * The generated case instructs the runner to issue GET #1 → capture the
 * `ETag` response header → GET #2 with `If-None-Match: <etag>` → assert that
 * the second response is exactly `304 Not Modified` with a matching ETag and
 * an empty body per RFC 7232 §4.1.
 *
 * Activation: `endpoint.method === "GET" && endpoint.etag_supported === true`.
 * Any other input → `{ cases: [], warnings: [] }` (silent guard, DD-6).
 *
 * The generator has NO plan-time knowledge of response headers — the ETag is
 * captured at runtime by the executor. Consequently, no plan-time warnings are
 * emitted for missing-ETag scenarios (DD-1).
 *
 * Non-GET endpoints with `etag_supported: true` are silently ignored —
 * the field is forward-compatible for a future HEAD extension (DD-6).
 */

import type { CanonicalEndpoint } from "../../core/canonical-model.js";
import type { ConditionalGetParams } from "../test-case-params.js";
import type {
  GenerationContext,
  GeneratorResult,
  TestCase,
  TestCaseGenerator,
} from "../types.js";

/**
 * Generates a `conditional_get_304` regression test case for GET endpoints
 * that opt in to ETag / If-None-Match conditional-request testing.
 *
 * Pure and total: never throws, never performs I/O. Mirrors the
 * `HeadGetParityGenerator` structure (one-case-per-qualifying-endpoint).
 */
export class ConditionalGetGenerator implements TestCaseGenerator {
  /**
   * Expands one endpoint into a `conditional_get_304` case (0 or 1).
   *
   * Active iff `endpoint.method === "GET"` AND `endpoint.etag_supported === true`.
   * For all other inputs returns `{ cases: [], warnings: [] }` silently
   * (non-GET methods are reserved for future extensions; absent or false flag
   * is simply opt-out).
   *
   * No plan-time warnings are emitted (the ETag presence is a runtime
   * concern — DD-1; forward-compat non-GET silence — DD-6).
   * @param endpoint - The validated canonical endpoint.
   * @param ctx - Shared injected collaborators.
   * @returns 0 or 1 regression cases; warnings array is always empty.
   */
  generate(
    endpoint: CanonicalEndpoint,
    ctx: GenerationContext,
  ): GeneratorResult {
    if (endpoint.method !== "GET") {
      return { cases: [], warnings: [] };
    }

    if (endpoint.etag_supported !== true) {
      return { cases: [], warnings: [] };
    }

    const { ids, markers, prodSafety } = ctx;
    const marker = markers.markerFor("conditional_get_304");
    const prodSafe = prodSafety.classifyProdSafe({
      marker,
      method: endpoint.method,
    });

    const params: ConditionalGetParams = {
      kind: "conditional_get_304",
    };

    const tc: TestCase = {
      id: ids.make(endpoint.id, "conditional_get_304", 0),
      endpoint_id: endpoint.id,
      type: "conditional_get_304",
      marker,
      title: `Conditional GET (RFC 7232) for ${endpoint.name}`,
      prod_safe: prodSafe,
      params,
    };

    return { cases: [tc], warnings: [] };
  }
}
