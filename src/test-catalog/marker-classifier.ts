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
  put_idempotency: "regression",
  // HEAD/GET parity is a happy-path correctness check per RFC 7231 §4.3.2:
  // it confirms the server behaves correctly for a standard HTTP method,
  // so it belongs in the smoke catalog alongside other conformance tests.
  head_get_parity: "smoke",
  // conditional_get_304 is an opt-in deeper correctness check (RFC 7232 §4.1):
  // it verifies that the server honours If-None-Match semantics, which is a
  // non-trivial server-side feature rather than a basic conformance property.
  // Classifying as regression keeps it out of smoke runs by default.
  conditional_get_304: "regression",
  // pagination_boundary probes mostly assert 400 responses (negative tests).
  // Negative tests are regression-tier by precedent (auth-negative, body-negative,
  // boundary-battery all regression). The size_max "happy path" probe is regression
  // too — boundary-at-max is not a basic conformance smoke check.
  pagination_boundary: "regression",
  db_state_matches_expectation: "regression",
  // §4 + docs/test-catalog.md + docs/markers-and-lifecycle.md: declarative
  // assertions are CORRECTNESS checks (business rules), so they belong with
  // the happy-path / smoke catalog. Classifying as "regression" historically
  // meant `apiwright run --markers smoke` silently skipped user-declared
  // assertions — the most common CI pattern, the most surprising drop
  // (issue #67).
  assertion: "smoke",
  // cors_preflight is a conformance smoke check (RFC 6454): it verifies that
  // the server correctly handles the OPTIONS preflight handshake, which is a
  // basic HTTP correctness property (not a negative or edge-case test).
  cors_preflight: "smoke",
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
