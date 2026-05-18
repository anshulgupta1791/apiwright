/**
 * Marker classifier for the test-catalog module.
 *
 * Maps generated test types to their §3 markers, and expands run-selection
 * marker lists (handling `all`, deduplication, and unknown selectors).
 */

import type { TestMarker } from "../core/canonical-model.js";

import type { GeneratedTestType, MarkerSelector } from "./types.js";

/** Frozen §3 type→marker map (all negative/idempotency/boundary/db = regression). */
const MARKER_MAP: Readonly<Record<GeneratedTestType | "assertion", TestMarker>> = {
  status_code_conformance: "smoke",
  content_type_alignment: "smoke",
  response_time_sla: "smoke",
  response_schema_validation: "smoke",
  auth_happy_path: "smoke",
  no_auth_returns_401: "regression",
  garbage_token_returns_401: "regression",
  method_not_allowed: "regression",
  malformed_json_returns_400: "regression",
  required_field_omission_returns_400: "regression",
  type_violation_returns_400: "regression",
  boundary_battery: "regression",
  get_idempotency: "regression",
  delete_idempotency: "regression",
  db_state_matches_expectation: "regression",
  assertion: "regression", // §4: assertions run with the regression catalog
};

/** Canonical marker order for stable output. */
const MARKER_ORDER: readonly TestMarker[] = ["smoke", "regression", "e2e"];

/**
 * Maps generated test types to their §3 spec markers.
 *
 * Pure and deterministic; relies on the frozen MARKER_MAP constant.
 */
export class MarkerClassifier {
  /**
   * Returns the exact §3 marker for a test type.
   * @param type - The generated test type (or "assertion").
   * @returns The spec marker.
   */
  markerFor(type: GeneratedTestType | "assertion"): TestMarker {
    return MARKER_MAP[type];
  }
}

/**
 * Expands a run-selection marker list to concrete markers: `all` ⇒
 * [smoke, regression] (no e2e in v1.0). Unknown selectors are dropped here;
 * the caller (MarkerFilter) warns on empty/unknown.
 * @param selection - Requested markers (may contain "all").
 * @returns De-duplicated concrete TestMarker[] in [smoke, regression, e2e] order.
 */
export function expandMarkerSelection(selection: readonly MarkerSelector[]): TestMarker[] {
  const collected = new Set<TestMarker>();
  for (const sel of selection) {
    if (sel === "all") {
      collected.add("smoke");
      collected.add("regression");
    } else if (sel === "smoke" || sel === "regression" || sel === "e2e") {
      collected.add(sel);
    }
    // unknown selectors are silently dropped
  }
  return MARKER_ORDER.filter((m) => collected.has(m));
}
