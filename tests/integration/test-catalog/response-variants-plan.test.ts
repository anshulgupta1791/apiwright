/**
 * Integration tests for plan-time response_variants invariants.
 *
 * Covers §6.8 items 70-74 and §6.9 items 75-80 (skip-mechanism regression checks).
 *
 * Design decisions pinned:
 *   DD-1  ALL_SKIPPABLE_KINDS.size === 21 (no new entries).
 *   DD-9  Malformed response_variants → endpoint invalid → endpoints_skipped++.
 *   DD-11 response_variants lives on CanonicalEndpoint; TestPlan does NOT re-emit it.
 *   DD-12 DD-12 warnings emit into TestPlan.warnings.
 *
 * Category: Integration — TestPlanGenerator + SchemaValidator real instances.
 * Expected initial failure: response_variants meta-schema block absent in
 *   ENDPOINT_META_SCHEMA; TestPlanGenerator does not emit DD-12 warnings.
 */

import { describe, it, expect } from "vitest";

import { TestPlanGenerator } from "../../../src/test-catalog/test-plan-generator.js";
import { ALL_SKIPPABLE_KINDS } from "../../../src/test-catalog/skip-resolver.js";
import type { CanonicalEndpoint } from "../../../src/core/canonical-model.js";
import type { TestPlan } from "../../../src/test-catalog/types.js";
import { parseJson } from "../../../src/core/safe-json.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEndpoint(overrides: Partial<CanonicalEndpoint> = {}): CanonicalEndpoint {
  return {
    id: "users.create",
    name: "Create User",
    method: "POST",
    url: "/api/v1/users",
    request: {
      body_schema: {
        type: "object",
        required: ["name"],
        properties: { name: { type: "string" } },
      },
      body_example: { name: "Alice" },
    },
    response: { expected_status: 201, schema: { type: "object", required: ["id"] } },
    markers: ["smoke"],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// §6.8 — Plan-time integration
// ---------------------------------------------------------------------------

describe("response_variants plan-time integration", () => {

  /**
   * Item 70: endpoint with malformed response_variants → endpoints_skipped++; standard warning.
   */
  it("item 70: malformed response_variants causes endpoint to be skipped with standard warning", () => {
    const badEndpoint = {
      id: "users.bad",
      name: "Bad endpoint",
      method: "POST",
      url: "/api/v1/users",
      request: {},
      response: { expected_status: 201 },
      // Invalid: string value instead of object
      response_variants: "invalid",
    } as unknown as CanonicalEndpoint;

    const gen = new TestPlanGenerator();
    const plan = gen.generate([badEndpoint]);

    expect(plan.endpoints_skipped).toBe(1);
    expect(plan.endpoints_planned).toBe(0);
    expect(plan.cases).toHaveLength(0);
    // Standard skip warning present
    expect(plan.warnings.some((w) => w.includes("users.bad") && w.includes("skipped"))).toBe(true);
  });

  /**
   * Item 71: endpoint with happy-path-key variant → DD-12 warning row 1 emitted.
   */
  it("item 71: happy-path-key variant triggers DD-12 warning row 1 in TestPlan.warnings", () => {
    const endpoint = makeEndpoint({
      response_variants: {
        "201": { schema: { type: "object" } },
        "400": { schema: { type: "object", required: ["error"] } },
      },
    });
    const gen = new TestPlanGenerator();
    const plan = gen.generate([endpoint]);

    expect(plan.endpoints_planned).toBe(1);
    expect(plan.warnings.some((w) =>
      w.includes("users.create") &&
      w.includes("response_variants['201']") &&
      w.includes("happy-path status"),
    )).toBe(true);
  });

  /**
   * Item 72: endpoint with empty response_variants → DD-12 warning row 3 emitted.
   */
  it("item 72: empty response_variants triggers DD-12 warning row 3 in TestPlan.warnings", () => {
    const endpoint = makeEndpoint({ response_variants: {} });
    const gen = new TestPlanGenerator();
    const plan = gen.generate([endpoint]);

    expect(plan.endpoints_planned).toBe(1);
    expect(plan.warnings.some((w) =>
      w.includes("users.create") &&
      w.includes("response_variants is empty"),
    )).toBe(true);
  });

  /**
   * Item 73: endpoint with valid response_variants → no DD-12 warning; cases generated normally.
   */
  it("item 73: valid response_variants triggers no DD-12 warning; cases generated normally", () => {
    const endpoint = makeEndpoint({
      response_variants: {
        "400": { schema: { type: "object", required: ["error"] } },
        "500": { schema: { type: "object" } },
      },
    });
    const gen = new TestPlanGenerator();
    const plan = gen.generate([endpoint]);

    expect(plan.endpoints_planned).toBe(1);
    expect(plan.cases.length).toBeGreaterThan(0);
    expect(plan.warnings.some((w) =>
      w.includes("response_variants") && (
        w.includes("happy-path") || w.includes("empty")
      ),
    )).toBe(false);
  });

  /**
   * Item 74: JSON round-trip of TestPlan does NOT include response_variants
   * (per DD-11: field lives on the endpoint, not on the plan cases).
   */
  it("item 74: JSON-serialized TestPlan does not re-emit response_variants on cases", () => {
    const endpoint = makeEndpoint({
      response_variants: {
        "400": { schema: { type: "object" } },
      },
    });
    const gen = new TestPlanGenerator();
    const plan = gen.generate([endpoint]);
    const serialized = JSON.stringify(plan);
    const reparsed = JSON.parse(serialized) as TestPlan;

    // TestCase objects must not carry response_variants
    for (const c of reparsed.cases) {
      const caseObj = c as unknown as Record<string, unknown>;
      expect(caseObj["response_variants"]).toBeUndefined();
      const params = caseObj["params"] as Record<string, unknown>;
      expect(params?.["response_variants"]).toBeUndefined();
    }
  });

  /**
   * §6.9 Item 75: ALL_SKIPPABLE_KINDS.size === 21 (regression check, DD-1).
   */
  it("item 75: ALL_SKIPPABLE_KINDS.size is exactly 21 (lock confirmation, DD-1)", () => {
    expect(ALL_SKIPPABLE_KINDS.size).toBe(21);
  });

  /**
   * §6.9 Item 76: ALL_SKIPPABLE_KINDS contains NO response_variant_* entry (DD-1 / DD-5).
   */
  it("item 76: ALL_SKIPPABLE_KINDS contains no 'response_variant_*' entry (DD-1 / DD-5)", () => {
    for (const kind of ALL_SKIPPABLE_KINDS) {
      expect(kind).not.toMatch(/^response_variant/);
    }
  });

  /**
   * §6.9 Item 79: TestCaseParams union unchanged (no response_variants variant added) —
   * asserted by confirming the plan generates valid cases for a post endpoint without
   * crashing on the params discriminant.
   */
  it("item 79: plan generation succeeds without new TestCaseParams variants (regression check)", () => {
    const gen = new TestPlanGenerator();
    expect(() => gen.generate([makeEndpoint()])).not.toThrow();
  });

  /**
   * §6.9 Item 80: skip_cases on an endpoint with response_variants declared →
   * skipped exactly as before (no interaction).
   */
  it("item 80: skip_cases still works normally on an endpoint with response_variants declared", () => {
    const endpoint = makeEndpoint({
      skip_cases: ["status_code_conformance"],
      response_variants: {
        "400": { schema: { type: "object" } },
      },
    });
    const gen = new TestPlanGenerator();
    const plan = gen.generate([endpoint]);

    // status_code_conformance should be skipped
    const statusConf = plan.cases.find(
      (c) => c.endpoint_id === endpoint.id && c.params.kind === "status_code_conformance",
    );
    expect(statusConf).toBeUndefined();
    // Other cases still present
    expect(plan.cases.filter((c) => c.endpoint_id === endpoint.id).length).toBeGreaterThan(0);
  });
});
