import { describe, it, expect } from "vitest";

import type { CanonicalEndpoint } from "../../../src/core/canonical-model.js";
import { generateTestPlan } from "../../../src/runner/discovery/plan-generator.js";
import type { EndpointLoadRecord } from "../../../src/runner/types.js";

const VALID: CanonicalEndpoint = {
  id: "users.list",
  name: "List users",
  method: "GET",
  url: "/users",
  request: {},
  response: { expected_status: 200, schema: { type: "array" } },
  markers: ["smoke"],
};

describe("generateTestPlan", () => {
  it("expands an endpoint map into a PlannedTestCase list", () => {
    const endpoints = new Map<string, EndpointLoadRecord>([
      ["users.list", { path: "x.endpoint.json", endpoint: VALID }],
    ]);
    const plan = generateTestPlan(endpoints);
    expect(plan.cases.length).toBeGreaterThan(0);
    expect(plan.cases.every((c) => c.endpoint_id === "users.list")).toBe(true);
    expect(plan.endpoints).toBe(endpoints);
  });

  it("yields zero cases for an empty endpoint map", () => {
    const plan = generateTestPlan(new Map());
    expect(plan.cases).toEqual([]);
  });
});
