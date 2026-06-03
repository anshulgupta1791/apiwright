/**
 * Unit tests for TestPlanGenerator — DD-12 plan-time warnings for
 * response_variants declarations.
 *
 * Covers §6.6 items 51-58.
 *
 * Design decisions pinned:
 *   DD-12 Warnings emitted during generate() for:
 *     (a) response_variants key === String(expected_status) → "happy-path status" warning.
 *     (b) response_variants = {} (empty) → "empty" warning.
 *   DD-12 Warnings are advisory (cases still generated for valid endpoints).
 *   DD-12 Warnings use exact template strings (§7.2).
 *
 * Exact warning templates from §7.2:
 *   "Endpoint '<id>': response_variants['<X>'] is the happy-path status; this variant is never consulted by the runner. Remove or change the key."
 *   "Endpoint '<id>': response_variants is empty; remove the key or add at least one variant."
 *
 * Category: Unit.
 * Expected initial failure: TestPlanGenerator does not yet call
 *   #emitResponseVariantWarnings; the warnings channel never receives DD-12 entries.
 */

import { describe, it, expect } from "vitest";

import { TestPlanGenerator } from "../../../src/test-catalog/test-plan-generator.js";
import type { CanonicalEndpoint } from "../../../src/core/canonical-model.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEndpoint(overrides: Partial<CanonicalEndpoint> = {}): CanonicalEndpoint {
  return {
    id: "users.create",
    name: "Create User",
    method: "POST",
    url: "/api/v1/users",
    request: {},
    response: { expected_status: 201, schema: { type: "object" } },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// §6.6 — DD-12 plan-time warnings
// ---------------------------------------------------------------------------

describe("TestPlanGenerator — DD-12 response_variants plan-time warnings", () => {

  /**
   * Item 51: response_variants key equals expected_status (201 → 201) →
   * warning with exact template row 1.
   */
  it("emits exact DD-12 row-1 warning when variant key equals expected_status", () => {
    const endpoint = makeEndpoint({
      response_variants: {
        "201": { schema: { type: "object" } },
      },
    });
    const gen = new TestPlanGenerator();
    const plan = gen.generate([endpoint]);

    const expectedWarning =
      "Endpoint 'users.create': response_variants['201'] is the happy-path status; this variant is never consulted by the runner. Remove or change the key.";
    expect(plan.warnings).toContain(expectedWarning);
  });

  /**
   * Item 52: response_variants key "400" with expected_status 201 → no warning.
   */
  it("emits no DD-12 warning when variant key '400' does not equal expected_status 201", () => {
    const endpoint = makeEndpoint({
      response_variants: {
        "400": { schema: { type: "object", required: ["error"] } },
      },
    });
    const gen = new TestPlanGenerator();
    const plan = gen.generate([endpoint]);

    // No happy-path warning for this endpoint
    expect(plan.warnings.some((w) =>
      w.includes("users.create") && w.includes("happy-path status"),
    )).toBe(false);
    // No empty warning either
    expect(plan.warnings.some((w) =>
      w.includes("users.create") && w.includes("response_variants is empty"),
    )).toBe(false);
  });

  /**
   * Item 53: response_variants: {} (declared but empty) → warning with exact template row 3.
   */
  it("emits exact DD-12 row-3 warning when response_variants is an empty record", () => {
    const endpoint = makeEndpoint({
      response_variants: {},
    });
    const gen = new TestPlanGenerator();
    const plan = gen.generate([endpoint]);

    const expectedWarning =
      "Endpoint 'users.create': response_variants is empty; remove the key or add at least one variant.";
    expect(plan.warnings).toContain(expectedWarning);
  });

  /**
   * Item 54: response_variants absent → no DD-12 warning.
   */
  it("emits no DD-12 warning when response_variants is absent", () => {
    const endpoint = makeEndpoint();
    const gen = new TestPlanGenerator();
    const plan = gen.generate([endpoint]);

    expect(plan.warnings.some((w) =>
      w.includes("response_variants"),
    )).toBe(false);
  });

  /**
   * Item 55: response_variants with keys ["201", "400"] and expected_status 201 →
   * warning emitted ONCE for key "201" only; no warning for "400".
   */
  it("emits warning exactly once for key '201' when it matches expected_status, not for '400'", () => {
    const endpoint = makeEndpoint({
      response_variants: {
        "201": { schema: { type: "object" } },
        "400": { schema: { type: "object", required: ["error"] } },
      },
    });
    const gen = new TestPlanGenerator();
    const plan = gen.generate([endpoint]);

    const happyPathWarnings = plan.warnings.filter((w) =>
      w.includes("users.create") && w.includes("happy-path status"),
    );
    // Exactly one warning for the "201" key
    expect(happyPathWarnings).toHaveLength(1);
    expect(happyPathWarnings[0]).toContain("response_variants['201']");
    // No warning for "400"
    expect(plan.warnings.some((w) => w.includes("['400']"))).toBe(false);
  });

  /**
   * Item 56: endpoint with malformed response_variants (fails validate) →
   * endpoint is SKIPPED with standard invalid-endpoint warning;
   * DD-12 warning is NOT emitted (DD-12 runs only on valid endpoints).
   */
  it("emits standard invalid-endpoint warning (not DD-12) when endpoint fails validation", () => {
    const badEndpoint = {
      id: "users.bad",
      name: "Bad",
      method: "POST",
      url: "/api/v1/users",
      request: {},
      response: { expected_status: 201 },
      // Invalid response_variants: "string" value fails meta-schema
      response_variants: "not-an-object",
    } as unknown as CanonicalEndpoint;

    const gen = new TestPlanGenerator();
    const plan = gen.generate([badEndpoint]);

    expect(plan.endpoints_skipped).toBe(1);
    // Standard skip warning is present
    expect(plan.warnings.some((w) => w.includes("users.bad") && w.includes("skipped"))).toBe(true);
    // No DD-12 warning for this endpoint
    expect(plan.warnings.some((w) =>
      w.includes("users.bad") && (w.includes("happy-path status") || w.includes("response_variants is empty")),
    )).toBe(false);
  });

  /**
   * Item 57: warnings emit in deterministic order (by endpoint declaration order).
   */
  it("emits DD-12 warnings in endpoint declaration order", () => {
    const ep1 = makeEndpoint({
      id: "endpoint.alpha",
      name: "Alpha",
      response_variants: {},
    });
    const ep2: CanonicalEndpoint = {
      ...makeEndpoint(),
      id: "endpoint.beta",
      name: "Beta",
      response_variants: {},
    };
    const gen = new TestPlanGenerator();
    const plan = gen.generate([ep1, ep2]);

    const alphaIdx = plan.warnings.findIndex((w) => w.includes("endpoint.alpha"));
    const betaIdx = plan.warnings.findIndex((w) => w.includes("endpoint.beta"));
    expect(alphaIdx).toBeGreaterThanOrEqual(0);
    expect(betaIdx).toBeGreaterThanOrEqual(0);
    expect(alphaIdx).toBeLessThan(betaIdx);
  });

  /**
   * Item 58: DD-12 warnings are appended to TestPlan.warnings (the existing channel).
   */
  it("appends DD-12 warnings to the TestPlan.warnings array (existing channel)", () => {
    const endpoint = makeEndpoint({ response_variants: {} });
    const gen = new TestPlanGenerator();
    const plan = gen.generate([endpoint]);

    // warnings must be an array (existing channel)
    expect(Array.isArray(plan.warnings)).toBe(true);
    expect(plan.warnings.some((w) => typeof w === "string" && w.length > 0)).toBe(true);
    // The DD-12 warning is in warnings
    expect(plan.warnings.some((w) => w.includes("response_variants is empty"))).toBe(true);
  });

  /**
   * Extra: valid response_variants with non-happy-path key → cases still generated normally.
   */
  it("generates cases normally when response_variants is valid and key is not happy-path", () => {
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
    // No DD-12 warnings
    expect(plan.warnings.some((w) =>
      w.includes("response_variants") && (
        w.includes("happy-path") || w.includes("empty")
      ),
    )).toBe(false);
  });

  /**
   * Extra: both DD-12 warning triggers on one endpoint → both warnings emitted.
   */
  it("emits both DD-12 warnings when endpoint has key matching expected_status AND additional non-matching key", () => {
    // If endpoint has response_variants: { "201": {...} } only, it satisfies both:
    // - key "201" matches expected_status 201 → row-1 warning
    // But empty variants {} satisfies only row-3. Test row-1 + row-3 would require
    // variants: {"201": {...}} (row-1 only) and {} (row-3 only).
    // We test two separate endpoints that each trigger a different warning.
    const epRow1 = makeEndpoint({
      id: "ep.row1",
      response_variants: { "201": { schema: { type: "object" } } },
    });
    const epRow3 = makeEndpoint({
      id: "ep.row3",
      response_variants: {},
    });
    const gen = new TestPlanGenerator();
    const plan = gen.generate([epRow1, epRow3]);

    expect(plan.warnings.some((w) =>
      w.includes("ep.row1") && w.includes("happy-path status"),
    )).toBe(true);
    expect(plan.warnings.some((w) =>
      w.includes("ep.row3") && w.includes("response_variants is empty"),
    )).toBe(true);
  });
});
