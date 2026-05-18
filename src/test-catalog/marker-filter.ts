/**
 * Marker filter — pure post-generation filter over a TestPlan.
 *
 * Selects cases by marker and optional per-endpoint marker restriction.
 * Never mutates the input plan; always returns a brand-new object.
 */

import type { TestMarker } from "../core/canonical-model.js";

import { expandMarkerSelection } from "./marker-classifier.js";
import type { MarkerSelector, TestCase, TestPlan } from "./types.js";

/**
 * Pure post-generation filter that selects TestPlan cases by marker selection
 * and optional endpoint-level marker restriction.
 *
 * Endpoint intersection rule: when endpointMarkers is provided and an endpoint
 * has a non-empty markers declaration, a case survives only if its marker is in
 * both the concrete selection AND the endpoint's declared markers. When the map
 * is omitted, or the endpoint is absent, or its value is undefined/empty, the
 * endpoint participates in all selected markers.
 */
export class MarkerFilter {
  /**
   * Filters a TestPlan to the cases matching the requested marker selection.
   * @param plan - The full generated plan to filter (never mutated).
   * @param selection - Requested marker selectors (may include "all").
   * @param endpointMarkers - Optional map of endpoint id to declared markers for
   *   per-endpoint intersection. Absent or undefined entries default to "all".
   * @returns A new TestPlan with filtered cases; counts and warnings preserved.
   */
  filter(
    plan: TestPlan,
    selection: readonly MarkerSelector[],
    endpointMarkers?: Record<string, TestMarker[] | undefined>,
  ): TestPlan {
    const concrete = expandMarkerSelection(selection);
    const concreteSet = new Set<TestMarker>(concrete);
    const warnings = [...plan.warnings];

    if (concrete.length === 0) {
      warnings.push(
        `No recognized markers in selection [${selection.join(",")}]; zero cases selected`,
      );
      return {
        cases: [],
        endpoints_planned: plan.endpoints_planned,
        endpoints_skipped: plan.endpoints_skipped,
        warnings,
      };
    }

    const cases = plan.cases.filter((c) =>
      this.#shouldInclude(c, concreteSet, endpointMarkers),
    );

    return {
      cases,
      endpoints_planned: plan.endpoints_planned,
      endpoints_skipped: plan.endpoints_skipped,
      warnings,
    };
  }

  #shouldInclude(
    c: TestCase,
    concreteSet: Set<TestMarker>,
    endpointMarkers?: Record<string, TestMarker[] | undefined>,
  ): boolean {
    if (!concreteSet.has(c.marker)) {
      return false;
    }
    if (!endpointMarkers) {
      return true;
    }
    const declared = endpointMarkers[c.endpoint_id];
    if (!declared || declared.length === 0) {
      return true; // no declared markers → participates in all
    }
    return declared.includes(c.marker);
  }
}
