/**
 * CorsPreflightGenerator — emits a `cors_preflight` smoke test case for
 * OPTIONS endpoints that declare a `cors` configuration.
 *
 * Activation: `endpoint.method === "OPTIONS"` AND `endpoint.cors` is present.
 * Non-OPTIONS endpoints with `cors` declared are silently ignored (DD-1).
 *
 * Plan warnings emitted (not thrown) for:
 *   - `cors.allow_origins` is empty → case dropped, DD-7 warning #1.
 *   - `cors.allow_methods` is empty → case dropped, DD-7 warning #2.
 *   - `cors.allow_headers` is empty → valid; no warning; case still emitted (DD-7).
 *
 * The generator does NOT invoke `ctx.walker` — CORS preflight requires no
 * body-field discovery (DD-17).
 */

import type { CanonicalEndpoint } from "../../core/canonical-model.js";
import type { CorsPreflightParams } from "../test-case-params.js";
import type {
  GenerationContext,
  GeneratorResult,
  TestCase,
  TestCaseGenerator,
} from "../types.js";

/** Runtime shape of the cors config field read from an endpoint object. */
interface CorsConfigShape {
  /** Origins to probe (e.g. `["https://app.example.com"]` or `["*"]`). */
  readonly allow_origins: readonly string[];
  /** HTTP methods to assert the server allows. */
  readonly allow_methods: readonly string[];
  /** Request headers to assert the server allows. Empty = no ACRH probe. */
  readonly allow_headers: readonly string[];
}

/**
 * DD-7 warning template when allow_origins is empty.
 * @param id - Endpoint id.
 * @returns Warning string.
 */
function warnEmptyOrigins(id: string): string {
  return `Endpoint '${id}': cors_preflight — allow_origins is empty; case dropped.`;
}

/**
 * DD-7 warning template when allow_methods is empty.
 * @param id - Endpoint id.
 * @returns Warning string.
 */
function warnEmptyMethods(id: string): string {
  return `Endpoint '${id}': cors_preflight — allow_methods is empty; case dropped.`;
}

/**
 * Generates a `cors_preflight` smoke test case for OPTIONS endpoints.
 *
 * Emits exactly 0 or 1 cases per endpoint:
 *   - 0 when method is not OPTIONS (silent, DD-1).
 *   - 0 when `cors` config is absent (no case, no warning).
 *   - 0 when `cors.allow_origins` is empty (1 DD-7 warning).
 *   - 0 when `cors.allow_methods` is empty (1 DD-7 warning).
 *   - 1 when all conditions are met (even if `cors.allow_headers` is empty).
 *
 * The check priority follows the design: allow_origins is checked before
 * allow_methods. When both are empty, only the allow_origins warning fires.
 */
export class CorsPreflightGenerator implements TestCaseGenerator {
  /**
   * Expands one endpoint into a `cors_preflight` case (0 or 1).
   *
   * Pure and total: never throws, never performs I/O.
   * @param endpoint - The validated canonical endpoint.
   * @param ctx - Shared injected collaborators (ids, markers, prodSafety).
   * @returns Cases (0 or 1) plus any plan warnings.
   */
  generate(endpoint: CanonicalEndpoint, ctx: GenerationContext): GeneratorResult {
    // DD-1: Only OPTIONS endpoints activate CORS preflight generation.
    if (endpoint.method !== "OPTIONS") {
      return { cases: [], warnings: [] };
    }

    // Read the cors config. The field was added to CanonicalEndpoint in this PR
    // so it is always typed, but may be absent at runtime on older endpoint files.
    const epRecord = endpoint as unknown as Record<string, unknown>;
    const cors = epRecord["cors"] as CorsConfigShape | undefined;

    if (!cors) {
      return { cases: [], warnings: [] };
    }

    const warnings: string[] = [];

    // DD-7 #1: allow_origins must not be empty.
    if (cors.allow_origins.length === 0) {
      warnings.push(warnEmptyOrigins(endpoint.id));
      return { cases: [], warnings };
    }

    // DD-7 #2: allow_methods must not be empty.
    if (cors.allow_methods.length === 0) {
      warnings.push(warnEmptyMethods(endpoint.id));
      return { cases: [], warnings };
    }

    // All conditions met — emit the single cors_preflight case.
    const marker = ctx.markers.markerFor("cors_preflight");
    const prodSafe = ctx.prodSafety.classifyProdSafe({
      marker,
      method: endpoint.method,
      ...(endpoint.prod_safe !== undefined ? { endpointProdSafe: endpoint.prod_safe } : {}),
    });

    const params: CorsPreflightParams = {
      kind: "cors_preflight",
      allow_origins: cors.allow_origins,
      allow_methods: cors.allow_methods,
      allow_headers: cors.allow_headers,
    };

    const testCase: TestCase = {
      id: ctx.ids.make(endpoint.id, "cors_preflight", 0),
      endpoint_id: endpoint.id,
      type: "cors_preflight",
      marker,
      title: `CORS preflight for ${endpoint.name}`,
      prod_safe: prodSafe,
      params,
    };

    return { cases: [testCase], warnings };
  }
}
