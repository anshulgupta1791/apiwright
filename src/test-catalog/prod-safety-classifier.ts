/**
 * Production-safety classifier for the test-catalog module.
 *
 * Tags each generated test case with a prod_safe boolean, per the rules
 * in V1_BUILD_SPEC.md §3/§7. Does not enforce skipping — that is the
 * runner's responsibility.
 */

import type { HttpMethod, TestMarker } from "../core/canonical-model.js";

/** Read methods that are safe for production smoke tests regardless of opt-in. */
const READ_METHODS = new Set<HttpMethod>(["GET", "HEAD", "OPTIONS"]);

/**
 * Generation-time prod-safety classifier per §3/§7.
 *
 * Rules:
 *   - regression/e2e ⇒ false (never prod-safe)
 *   - smoke + GET/HEAD/OPTIONS ⇒ true (non-destructive, regardless of opt-in)
 *   - smoke + POST/PUT/PATCH/DELETE ⇒ true iff endpointProdSafe === true,
 *     else false (undefined/false ⇒ false)
 */
export class ProdSafetyClassifier {
  /**
   * Classifies whether a test case is safe to run in a production environment.
   * @param input - Classification inputs.
   * @param input.marker - The case's marker.
   * @param input.method - The endpoint HTTP method.
   * @param input.endpointProdSafe - The endpoint's prod_safe flag (may be undefined).
   * @returns Whether this case is safe to run in a prod-flagged environment.
   */
  classifyProdSafe(input: {
    marker: TestMarker;
    method: HttpMethod;
    endpointProdSafe?: boolean;
  }): boolean {
    if (input.marker !== "smoke") {
      return false;
    }
    if (READ_METHODS.has(input.method)) {
      return true;
    }
    return input.endpointProdSafe === true;
  }
}
