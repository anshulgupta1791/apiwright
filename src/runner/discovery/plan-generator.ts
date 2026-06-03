/**
 * Combines loaded endpoints with the §3 Test Catalog (Task #6) into a flat
 * list of executable {@link PlannedTestCase}s.
 *
 * Uses {@link TestPlanGenerator} to expand every endpoint into its auto-
 * generated tests plus declarative assertion-bound cases. The runner
 * iterates the flat list as one unit.
 */

import type { CanonicalEndpoint } from "../../core/canonical-model.js";
import { TestPlanGenerator } from "../../test-catalog/index.js";
import type { EndpointLoadRecord, PlannedTestCase, TestPlanReport } from "../types.js";

/** Options for {@link generateTestPlan}. */
export interface GenerateTestPlanOptions {
  /** Global skip tokens from `config.case_generation.skip_globally`. */
  readonly skipGlobally?: readonly string[];
}

/**
 * Generates the full TestPlanReport from the loaded endpoint map.
 * @param endpoints - The map of `endpoint.id` → record (in id order).
 * @param planner - Optional injectable {@link TestPlanGenerator}; defaults
 *   to the real instance wired with skip logic when `options.skipGlobally`
 *   is present.
 * @param options - Optional skip configuration forwarded to the planner.
 * @returns The {@link TestPlanReport} carrying the flat cases list plus the
 *   endpoint map (forwarded for the executor's lookup).
 * @throws {Error} when both a custom `planner` AND a non-empty
 *   `options.skipGlobally` are provided. The custom planner's own skip
 *   configuration would be silently overridden by the wrapper, so the
 *   contract requires the caller to pick exactly one path.
 */
export function generateTestPlan(
  endpoints: ReadonlyMap<string, EndpointLoadRecord>,
  planner?: TestPlanGenerator,
  options?: GenerateTestPlanOptions,
): TestPlanReport {
  const skipGlobally = options?.skipGlobally ?? [];
  // Guard against the silent-drop footgun: if a caller passes BOTH a custom
  // planner AND a non-empty skipGlobally, the planner already has its own
  // skip configuration baked in and the options.skipGlobally would be
  // ignored — a confusing failure mode for callers (especially future PRs
  // #2-#7 tests that may inject custom planners). Fail loudly here so the
  // caller picks one path: either configure skipGlobally on the planner
  // they construct, OR pass options.skipGlobally without a custom planner.
  if (planner !== undefined && skipGlobally.length > 0) {
    throw new Error(
      "generateTestPlan: cannot pass both a custom 'planner' and a non-empty " +
        "'options.skipGlobally' — the custom planner's own skip config would " +
        "be overridden silently. Configure skipGlobally on the planner instance, " +
        "or drop the planner argument so this wrapper constructs one for you.",
    );
  }
  const resolvedPlanner = planner ?? new TestPlanGenerator({ skipGlobally });
  const endpointList: CanonicalEndpoint[] = [];
  for (const { endpoint } of endpoints.values()) endpointList.push(endpoint);
  const plan = resolvedPlanner.generate(endpointList);
  const cases: PlannedTestCase[] = plan.cases.map((c) => ({
    endpoint_id: c.endpoint_id,
    case: c,
  }));
  return { cases, endpoints, warnings: plan.warnings };
}
