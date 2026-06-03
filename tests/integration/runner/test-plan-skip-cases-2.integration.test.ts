/**
 * Integration tests for skip_cases / skip_globally in TestPlanGenerator.
 * Covers integration test cases 6–10 from the solution design.
 * Cases 1–5 are in test-plan-skip-cases.integration.test.ts.
 *
 * Uses the REAL TestPlanGenerator with fixture endpoints — no collaborator mocks.
 *
 * Design decisions pinned:
 *   DD-3  Global validateSkipTokens runs ONCE at end of generate() — allKnownKinds
 *         is the union of kinds that fired across all endpoints.
 *   DD-8  Zero-match warning per token that parsed+kind-known but matched nothing.
 *   DD-10 skip_globally array REPLACES on merge (matches default_markers semantics).
 */

import { describe, it, expect } from "vitest";

import { TestPlanGenerator } from "../../../src/test-catalog/test-plan-generator.js";
import type { CanonicalEndpoint } from "../../../src/core/canonical-model.js";

// ---------------------------------------------------------------------------
// Fixture endpoints
// ---------------------------------------------------------------------------

/** A GET endpoint used to test dead-weight skip detection. */
const plainGet: CanonicalEndpoint = {
  id: "health.check",
  name: "Health Check",
  method: "GET",
  url: "/api/v1/health",
  request: {},
  response: { expected_status: 200, schema: { type: "object" } },
};

/**
 * A POST endpoint with 5 boundary-constrained fields.
 * Each field has two constraints (minimum+maximum or minLength+maxLength),
 * so 5 fields × 2 constraints × 2 positions (inside/outside) = 20 boundary cases.
 * When boundary_battery is skipped, the warning must cite the exact count.
 */
const boundaryHeavyPost: CanonicalEndpoint = {
  id: "shipping.create",
  name: "Create Shipment",
  method: "POST",
  url: "/api/v1/shipments",
  request: {
    body_schema: {
      type: "object",
      properties: {
        weight: { type: "number", minimum: 0, maximum: 100 },
        length: { type: "number", minimum: 1, maximum: 200 },
        width: { type: "number", minimum: 1, maximum: 200 },
        height: { type: "number", minimum: 1, maximum: 200 },
        label: { type: "string", minLength: 1, maxLength: 50 },
      },
    },
  },
  response: { expected_status: 201, schema: { type: "object" } },
};

/** A simple endpoint without any skip config (v1.0.1 backward-compat fixture). */
const legacyEndpoint: CanonicalEndpoint = {
  id: "legacy.get",
  name: "Legacy Get",
  method: "GET",
  url: "/api/v1/legacy",
  request: {},
  response: { expected_status: 200, schema: { type: "object" } },
};

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function countByKind(
  plan: { cases: Array<{ type: string; endpoint_id: string }> },
  endpointId: string,
  type: string,
): number {
  return plan.cases.filter((c) => c.endpoint_id === endpointId && c.type === type).length;
}

// ---------------------------------------------------------------------------
// Tests — cases 6–10
// ---------------------------------------------------------------------------

describe("TestPlanGenerator — skip_cases / skip_globally (cases 6–10)", () => {
  /**
   * Test 6: Unknown kind in skip_cases generates plan normally; warning names
   * the endpoint and the unknown kind.
   */
  it("unknown kind 'nonexistent_kind' in skip_cases generates plan normally; warning names endpoint", () => {
    const gen = new TestPlanGenerator();
    const endpointWithUnknown = {
      ...plainGet,
      skip_cases: ["nonexistent_kind"],
    } as unknown as CanonicalEndpoint;

    const plan = gen.generate([endpointWithUnknown]);

    expect(plan.cases.filter((c) => c.endpoint_id === plainGet.id).length).toBeGreaterThan(0);
    const hasWarning = plan.warnings.some(
      (w) => w.includes("nonexistent_kind") && w.includes(plainGet.id),
    );
    expect(hasWarning).toBe(true);
  });

  /**
   * Test 7: Skip for a kind that didn't fire on the endpoint emits a
   * "matched zero generated cases" dead-weight warning (design decision DD-8).
   * delete_idempotency never fires on a GET endpoint; skipping it is a no-op.
   */
  it("skip for 'delete_idempotency' on a GET endpoint emits dead-weight warning", () => {
    const gen = new TestPlanGenerator();
    const getWithDeadSkip = {
      ...plainGet,
      skip_cases: ["delete_idempotency"],
    } as unknown as CanonicalEndpoint;

    const plan = gen.generate([getWithDeadSkip]);

    // get_idempotency case must survive (it's different from delete_idempotency)
    expect(countByKind(plan, plainGet.id, "get_idempotency")).toBeGreaterThan(0);

    // Dead-weight warning must be present
    const hasDeadWeightWarning = plan.warnings.some(
      (w) =>
        w.includes("delete_idempotency") &&
        (w.includes("matched zero") || w.includes("zero generated")),
    );
    expect(hasDeadWeightWarning).toBe(true);
  });

  /**
   * Test 8: Counted-warning format — skipping boundary_battery on an endpoint
   * with constrained fields produces a warning containing an N + "case(s)" pattern.
   */
  it("skipping boundary_battery produces a warning with the N case(s) count pattern", () => {
    const gen = new TestPlanGenerator();
    const endpointWithSkip = {
      ...boundaryHeavyPost,
      skip_cases: ["boundary_battery"],
    } as unknown as CanonicalEndpoint;

    const plan = gen.generate([endpointWithSkip]);

    // No boundary_battery cases remain
    expect(countByKind(plan, boundaryHeavyPost.id, "boundary_battery")).toBe(0);

    // Warning must cite the count (N case(s) pattern)
    const countWarning = plan.warnings.find(
      (w) => w.includes("boundary_battery") && w.includes("case(s)"),
    );
    expect(countWarning).toBeDefined();
    expect(countWarning).toMatch(/\d+ case\(s\)/);
  });

  /**
   * Test 9: Backward compatibility — endpoint without skip_cases generates a
   * byte-identical plan across two independent calls; no skip-related warnings.
   */
  it("backward compat: endpoint without skip_cases generates identical plan; no skip warnings", () => {
    const gen1 = new TestPlanGenerator();
    const gen2 = new TestPlanGenerator();

    const plan1 = gen1.generate([legacyEndpoint]);
    const plan2 = gen2.generate([legacyEndpoint]);

    expect(JSON.stringify(plan1)).toBe(JSON.stringify(plan2));

    const skipWarnings = plan1.warnings.filter(
      (w) => w.includes("skip") || w.includes("skipped"),
    );
    expect(skipWarnings).toHaveLength(0);
  });

  /**
   * Test 10: Empty skip_cases array is treated identically to omitted skip_cases.
   */
  it("skip_cases: [] (empty array) is identical to omitted — no warnings, no skips", () => {
    const gen = new TestPlanGenerator();

    const endpointWithEmpty = {
      ...legacyEndpoint,
      skip_cases: [],
    } as unknown as CanonicalEndpoint;

    const planWithEmpty = gen.generate([endpointWithEmpty]);
    const planWithOmitted = gen.generate([legacyEndpoint]);

    expect(planWithEmpty.cases.length).toBe(planWithOmitted.cases.length);

    const skipWarnings = planWithEmpty.warnings.filter(
      (w) => w.includes("skip") || w.includes("skipped"),
    );
    expect(skipWarnings).toHaveLength(0);
  });
});
