/**
 * Deterministic test case ID factory for the test-catalog module.
 *
 * Provides a pure function and a stateless OOP wrapper for generating
 * stable, regex-valid test case IDs from their coordinates.
 */

import type { GeneratedTestType } from "./types.js";

/** Characters not allowed in generated id (underscores → hyphens for readability). */
const ID_ALLOWED = /[^a-z0-9._-]+/g;
/** Underscores in type names are converted to hyphens for URL/id friendliness. */
const ID_UNDERSCORES = /_/g;

/**
 * Deterministically derives a stable TestCase id from its coordinates.
 * Same arguments ⇒ byte-identical id. Result matches ^[a-z0-9._-]+$.
 * @param endpointId - Owning endpoint id (already canonical-validated).
 * @param type - The GeneratedTestType or "assertion" sentinel.
 * @param ordinal - Zero-based disambiguator for repeated types.
 * @returns A sanitized stable id "<endpointId>.<type>.<ordinal>".
 */
export function makeTestCaseId(
  endpointId: string,
  type: GeneratedTestType | "assertion",
  ordinal: number,
): string {
  const raw = `${endpointId}.${type}.${ordinal}`;
  return raw.toLowerCase().replace(ID_UNDERSCORES, "-").replace(ID_ALLOWED, "-");
}

/**
 * Stateless factory wrapper over makeTestCaseId.
 * Provides an OOP seam so generators can inject one collaborator.
 */
export class TestCaseIdFactory {
  /**
   * Builds a stable id; thin OOP wrapper over makeTestCaseId for injection.
   * @param endpointId - Owning endpoint id.
   * @param type - The test type / "assertion".
   * @param ordinal - Zero-based disambiguator.
   * @returns The deterministic id.
   */
  make(
    endpointId: string,
    type: GeneratedTestType | "assertion",
    ordinal: number,
  ): string {
    return makeTestCaseId(endpointId, type, ordinal);
  }
}
