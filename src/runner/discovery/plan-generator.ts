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

/**
 * Generates the full TestPlanReport from the loaded endpoint map.
 * @param endpoints - The map of `endpoint.id` → record (in id order).
 * @param planner - Optional injectable {@link TestPlanGenerator}; defaults
 *   to the real instance.
 * @returns The {@link TestPlanReport} carrying the flat cases list plus the
 *   endpoint map (forwarded for the executor's lookup).
 */
export function generateTestPlan(
  endpoints: ReadonlyMap<string, EndpointLoadRecord>,
  planner: TestPlanGenerator = new TestPlanGenerator(),
): TestPlanReport {
  const endpointList: CanonicalEndpoint[] = [];
  for (const { endpoint } of endpoints.values()) endpointList.push(endpoint);
  const plan = planner.generate(endpointList);
  const cases: PlannedTestCase[] = plan.cases.map((c) => ({
    endpoint_id: c.endpoint_id,
    case: c,
  }));
  return { cases, endpoints };
}
