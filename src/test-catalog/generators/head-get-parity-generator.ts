/**
 * HEAD/GET parity generator — emits a `head_get_parity` case for HEAD endpoints
 * that declare a `pair_with` reference to a sibling GET endpoint.
 *
 * The generated case instructs the runner to issue a HEAD + a GET against the
 * paired URL and assert (a) identical status codes, (b) identical response
 * headers modulo a known-volatile ignore-list, and (c) the HEAD body is empty
 * per RFC 7231 §4.3.2.
 *
 * Activation: `endpoint.method === "HEAD" && pair_with` is a non-empty string.
 * Any other input → `{ cases: [], warnings: [] }` (silent guard).
 *
 * The generator emits `params.paired_get_url = ""` as a typed placeholder.
 * The resolver pass in `TestPlanGenerator.generate()` populates the field from
 * the paired GET endpoint's `url` after skip-filtering. Cases that cannot be
 * resolved are dropped (never reach the runner).
 *
 * Non-HEAD endpoints with `pair_with` are silently ignored — the field is
 * reserved for future cross-method generators (POST+GET, PUT+GET). No warning
 * is emitted because absence is normal; only HEAD activates today.
 */

import type { CanonicalEndpoint } from "../../core/canonical-model.js";
import type { HeadGetParityParams } from "../test-case-params.js";
import type {
  GenerationContext,
  GeneratorResult,
  TestCase,
  TestCaseGenerator,
} from "../types.js";

/**
 * Generates a `head_get_parity` smoke test case for HEAD endpoints with
 * a `pair_with` sibling GET endpoint reference.
 *
 * Pure and total: never throws, never performs I/O. Mirrors the
 * `PutIdempotencyGenerator` structure (one-case-per-qualifying-endpoint).
 */
export class HeadGetParityGenerator implements TestCaseGenerator {
  /**
   * Expands one endpoint into a `head_get_parity` case (0 or 1).
   *
   * Active iff `endpoint.method === "HEAD"` AND `endpoint.pair_with` is a
   * non-empty string. For all other inputs returns `{ cases: [], warnings: [] }`
   * silently (non-HEAD methods are reserved for future cross-method generators).
   *
   * The emitted case carries `params.paired_get_url = ""` as a placeholder —
   * the resolver pass in `TestPlanGenerator` populates it from the paired GET
   * endpoint's raw `url` field after skip-filtering.
   * @param endpoint - The validated canonical endpoint.
   * @param ctx - Shared injected collaborators.
   * @returns 0 or 1 smoke cases; warnings array is always empty (no generator
   *   warnings; resolution warnings are emitted by the resolver pass).
   */
  generate(
    endpoint: CanonicalEndpoint,
    ctx: GenerationContext,
  ): GeneratorResult {
    if (endpoint.method !== "HEAD") {
      return { cases: [], warnings: [] };
    }

    const pairWith = endpoint.pair_with;
    if (typeof pairWith !== "string" || pairWith.length === 0) {
      return { cases: [], warnings: [] };
    }

    const { ids, markers, prodSafety } = ctx;
    const marker = markers.markerFor("head_get_parity");
    const prodSafe = prodSafety.classifyProdSafe({
      marker,
      method: endpoint.method,
    });

    const params: HeadGetParityParams = {
      kind: "head_get_parity",
      paired_get_endpoint_id: pairWith,
      // Placeholder — the resolver pass in TestPlanGenerator.generate() populates
      // this from the paired GET endpoint's raw url AFTER skip-filtering.
      paired_get_url: "",
    };

    const tc: TestCase = {
      id: ids.make(endpoint.id, "head_get_parity", 0),
      endpoint_id: endpoint.id,
      type: "head_get_parity",
      marker,
      title: `HEAD/GET parity for ${endpoint.name}`,
      prod_safe: prodSafe,
      params,
    };

    return { cases: [tc], warnings: [] };
  }
}
