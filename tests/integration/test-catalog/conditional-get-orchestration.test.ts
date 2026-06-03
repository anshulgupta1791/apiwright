/**
 * Integration tests for conditional_get_304 wired into TestPlanGenerator.
 *
 * Uses REAL TestPlanGenerator (no mocks) with inline fixture endpoints.
 * Covers orchestration tests 1–10 from the design outline §8 Layer 2.
 *
 * Pins the following design decisions (v1.0.2-pr4-etag-conditional-get.md):
 *   DD-1  Missing ETag → runtime fail, NOT plan-time error. Generator has
 *         NO plan-time warnings (verified: warnings array stays empty from
 *         the ConditionalGetGenerator).
 *   DD-6  etag_supported: true on non-GET → silent no-op (0 cases, 0 warnings).
 *   DD-7  ALL_SKIPPABLE_KINDS must contain 'conditional_get_304' (size === 19).
 *
 * Covers the following orchestration scenarios (locked in design §8 Layer 2):
 *   1. GET + etag_supported: true → 1 conditional_get_304 case in plan
 *   2. GET without flag → 0 conditional_get_304 cases
 *   3. skip_cases: ["conditional_get_304"] → suppressed + counted-skip warning
 *   4. skipGlobally: ["conditional_get_304"] → suppressed across all GETs
 *   5. Dead-weight on POST endpoint → matched-zero warning
 *   6. Typo "conditional_get_304x" → unknown-kind warning
 *   7. ALL_SKIPPABLE_KINDS.size === 19
 *   8. Mixed: GET+etag + GET+no-etag + POST → only first GET emits the case
 *   9. Backward compat: endpoint without etag_supported → identical to v1.0.1
 *   10. Determinism: identical input → identical output
 *
 * Category: Integration (orchestration — real TestPlanGenerator).
 * Expected initial failure: TestPlanGenerator returns zero conditional_get_304 cases.
 */

import { describe, it, expect } from "vitest";

import { TestPlanGenerator } from "../../../src/test-catalog/test-plan-generator.js";
import { ALL_SKIPPABLE_KINDS } from "../../../src/test-catalog/skip-resolver.js";
import type { CanonicalEndpoint } from "../../../src/core/canonical-model.js";

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

function getEndpointWithEtag(
  id: string,
  overrides: Partial<CanonicalEndpoint> = {},
): CanonicalEndpoint {
  return {
    id,
    name: `GET ${id}`,
    method: "GET",
    url: `/api/${id}`,
    request: {},
    response: { expected_status: 200, schema: {} },
    etag_supported: true,
    ...overrides,
  };
}

function getEndpoint(id: string, overrides: Partial<CanonicalEndpoint> = {}): CanonicalEndpoint {
  return {
    id,
    name: `GET ${id}`,
    method: "GET",
    url: `/api/${id}`,
    request: {},
    response: { expected_status: 200, schema: {} },
    ...overrides,
  };
}

function postEndpoint(id: string, overrides: Partial<CanonicalEndpoint> = {}): CanonicalEndpoint {
  return {
    id,
    name: `POST ${id}`,
    method: "POST",
    url: `/api/${id}`,
    request: {},
    response: { expected_status: 201, schema: {} },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("conditional_get_304 — TestPlanGenerator orchestration", () => {

  /**
   * Test 1: GET + etag_supported: true → 1 conditional_get_304 case.
   */
  describe("case 1 — GET with etag_supported: true produces one case", () => {
    it("produces exactly one conditional_get_304 case", () => {
      const gen = new TestPlanGenerator();
      const plan = gen.generate([getEndpointWithEtag("items.list")]);
      const cases = plan.cases.filter((c) => c.type === "conditional_get_304");
      expect(cases).toHaveLength(1);
    });

    it("case has marker === 'regression'", () => {
      const gen = new TestPlanGenerator();
      const plan = gen.generate([getEndpointWithEtag("items.list")]);
      const c = plan.cases.find((c) => c.type === "conditional_get_304");
      expect(c?.marker).toBe("regression");
    });

    it("case has prod_safe === false (regression-marker short-circuit)", () => {
      const gen = new TestPlanGenerator();
      const plan = gen.generate([getEndpointWithEtag("items.list")]);
      const c = plan.cases.find((c) => c.type === "conditional_get_304");
      expect(c?.prod_safe).toBe(false);
    });

    it("generator emits no plan-time warnings for etag_supported: true endpoint (DD-1)", () => {
      const gen = new TestPlanGenerator();
      const plan = gen.generate([getEndpointWithEtag("items.list")]);
      const conditionalWarnings = plan.warnings.filter(
        (w) => w.includes("conditional_get_304") && !w.match(/skip/i),
      );
      expect(conditionalWarnings).toHaveLength(0);
    });
  });

  /**
   * Test 2: GET without etag_supported flag → 0 conditional_get_304 cases.
   */
  describe("case 2 — GET without etag_supported → no conditional_get_304 cases", () => {
    it("produces zero conditional_get_304 cases when etag_supported is absent", () => {
      const gen = new TestPlanGenerator();
      const plan = gen.generate([getEndpoint("items.list")]);
      const cases = plan.cases.filter((c) => c.type === "conditional_get_304");
      expect(cases).toHaveLength(0);
    });

    it("still produces regular GET cases (get_idempotency etc.) when etag_supported absent", () => {
      const gen = new TestPlanGenerator();
      const plan = gen.generate([getEndpoint("items.list")]);
      const getCases = plan.cases.filter((c) => c.type === "get_idempotency");
      expect(getCases).toHaveLength(1);
    });
  });

  /**
   * Test 3: skip_cases: ["conditional_get_304"] → suppressed + counted-skip warning.
   */
  describe("case 3 — per-endpoint skip_cases suppresses and emits counted-skip warning", () => {
    const ep = getEndpointWithEtag("items.list", {
      skip_cases: ["conditional_get_304"],
    });

    it("removes conditional_get_304 case from plan when skip_cases includes it", () => {
      const gen = new TestPlanGenerator();
      const plan = gen.generate([ep]);
      const cases = plan.cases.filter((c) => c.type === "conditional_get_304");
      expect(cases).toHaveLength(0);
    });

    it("emits counted-skip warning naming endpoint id and token", () => {
      const gen = new TestPlanGenerator();
      const plan = gen.generate([ep]);
      const countedSkip = plan.warnings.find(
        (w) =>
          w.includes("items.list") &&
          w.includes("conditional_get_304") &&
          w.match(/skipped \d+ case\(s\)/),
      );
      expect(countedSkip).toBeDefined();
    });
  });

  /**
   * Test 4: skipGlobally: ["conditional_get_304"] → suppressed across all GET+etag endpoints.
   */
  describe("case 4 — skipGlobally suppresses across all GET+etag endpoints", () => {
    const endpoints: CanonicalEndpoint[] = [
      getEndpointWithEtag("a.list"),
      getEndpointWithEtag("b.list"),
    ];

    it("removes all conditional_get_304 cases when skipGlobally includes it", () => {
      const gen = new TestPlanGenerator({ skipGlobally: ["conditional_get_304"] });
      const plan = gen.generate(endpoints);
      const cases = plan.cases.filter((c) => c.type === "conditional_get_304");
      expect(cases).toHaveLength(0);
    });

    it("emits a global-skip warning naming the token and 'skip_globally'", () => {
      const gen = new TestPlanGenerator({ skipGlobally: ["conditional_get_304"] });
      const plan = gen.generate(endpoints);
      const globalWarning = plan.warnings.find(
        (w) =>
          w.includes("conditional_get_304") &&
          w.toLowerCase().includes("skip_globally"),
      );
      expect(globalWarning).toBeDefined();
    });
  });

  /**
   * Test 5: Dead-weight on POST endpoint → matched-zero warning (design §6 item 49).
   */
  describe("case 5 — dead-weight skip token on POST endpoint", () => {
    const ep = postEndpoint("items.create", {
      skip_cases: ["conditional_get_304"],
    });

    it("emits dead-weight warning naming endpoint id and token when applied to POST", () => {
      const gen = new TestPlanGenerator();
      const plan = gen.generate([ep]);
      const deadWeightWarning = plan.warnings.find(
        (w) =>
          w.includes("items.create") &&
          w.includes("conditional_get_304") &&
          w.includes("matched zero"),
      );
      expect(deadWeightWarning).toBeDefined();
    });
  });

  /**
   * Test 6: Typo "conditional_get_304x" → unknown-kind warning.
   */
  describe("case 6 — unknown-kind warning for typo in skip token", () => {
    it("emits unknown-kind warning for 'conditional_get_304x' (typo)", () => {
      const ep = getEndpointWithEtag("items.list", {
        skip_cases: ["conditional_get_304x"],
      });
      const gen = new TestPlanGenerator();
      const plan = gen.generate([ep]);
      const unknownKindWarning = plan.warnings.find(
        (w) =>
          w.toLowerCase().includes("unknown") &&
          w.includes("conditional_get_304x"),
      );
      expect(unknownKindWarning).toBeDefined();
    });

    it("correct spelling 'conditional_get_304' does NOT trigger unknown-kind warning", () => {
      const ep = getEndpointWithEtag("items.list", {
        skip_cases: ["conditional_get_304"],
      });
      const gen = new TestPlanGenerator();
      const plan = gen.generate([ep]);
      const unknownKindWarning = plan.warnings.find(
        (w) =>
          w.toLowerCase().includes("unknown") &&
          w.includes("conditional_get_304"),
      );
      expect(unknownKindWarning).toBeUndefined();
    });
  });

  /**
   * Test 7: ALL_SKIPPABLE_KINDS.size === 20 (bumped from 19 by PR #5
   * pagination_boundary, from 18 by conditional_get_304, design §1.5).
   */
  describe("case 7 — ALL_SKIPPABLE_KINDS has 20 entries", () => {
    it("ALL_SKIPPABLE_KINDS.size === 20 after adding pagination_boundary", () => {
      expect(ALL_SKIPPABLE_KINDS.size).toBe(20);
    });

    it("ALL_SKIPPABLE_KINDS contains 'conditional_get_304'", () => {
      expect(ALL_SKIPPABLE_KINDS.has("conditional_get_304")).toBe(true);
    });
  });

  /**
   * Test 8: Mixed plan — GET+etag + GET+no-etag + POST → only first GET emits the case.
   */
  describe("case 8 — mixed plan: only GET+etag emits conditional_get_304", () => {
    const endpoints: CanonicalEndpoint[] = [
      getEndpointWithEtag("users.list"),
      getEndpoint("users.get"),
      postEndpoint("users.create"),
    ];

    it("produces exactly one conditional_get_304 case (from GET+etag only)", () => {
      const gen = new TestPlanGenerator();
      const plan = gen.generate(endpoints);
      const cases = plan.cases.filter((c) => c.type === "conditional_get_304");
      expect(cases).toHaveLength(1);
    });

    it("the conditional_get_304 case belongs to the GET+etag endpoint", () => {
      const gen = new TestPlanGenerator();
      const plan = gen.generate(endpoints);
      const c = plan.cases.find((c) => c.type === "conditional_get_304");
      expect(c?.endpoint_id).toBe("users.list");
    });

    it("GET+no-etag endpoint still emits get_idempotency case (not contaminated)", () => {
      const gen = new TestPlanGenerator();
      const plan = gen.generate(endpoints);
      const getCases = plan.cases.filter(
        (c) => c.endpoint_id === "users.get" && c.type === "get_idempotency",
      );
      expect(getCases).toHaveLength(1);
    });

    it("POST endpoint emits no conditional_get_304 case (DD-6 silent no-op)", () => {
      const gen = new TestPlanGenerator();
      const plan = gen.generate(endpoints);
      const postConditional = plan.cases.filter(
        (c) => c.endpoint_id === "users.create" && c.type === "conditional_get_304",
      );
      expect(postConditional).toHaveLength(0);
    });
  });

  /**
   * Test 9: Backward compat — endpoint without etag_supported field behaves
   * identically to v1.0.1 (no conditional_get_304 case, no warning).
   */
  describe("case 9 — backward compat: endpoint without etag_supported field", () => {
    const legacyGetEndpoint: CanonicalEndpoint = {
      id: "legacy.list",
      name: "Legacy GET",
      method: "GET",
      url: "/api/legacy",
      request: {},
      response: { expected_status: 200, schema: { type: "array" } },
      // deliberately NO etag_supported field
    };

    it("produces zero conditional_get_304 cases for legacy GET endpoint", () => {
      const gen = new TestPlanGenerator();
      const plan = gen.generate([legacyGetEndpoint]);
      const cases = plan.cases.filter((c) => c.type === "conditional_get_304");
      expect(cases).toHaveLength(0);
    });

    it("still produces get_idempotency case for legacy GET endpoint", () => {
      const gen = new TestPlanGenerator();
      const plan = gen.generate([legacyGetEndpoint]);
      const getCases = plan.cases.filter((c) => c.type === "get_idempotency");
      expect(getCases).toHaveLength(1);
    });

    it("emits no conditional_get_304-related warnings for legacy endpoint", () => {
      const gen = new TestPlanGenerator();
      const plan = gen.generate([legacyGetEndpoint]);
      const conditionalWarnings = plan.warnings.filter(
        (w) => w.includes("conditional_get_304"),
      );
      expect(conditionalWarnings).toHaveLength(0);
    });
  });

  /**
   * Test 10: Determinism — identical input → identical output.
   */
  describe("case 10 — determinism: identical input → identical output", () => {
    it("produces byte-identical plan output across two independent generate() calls", () => {
      const endpoints: CanonicalEndpoint[] = [
        getEndpointWithEtag("items.list"),
        getEndpoint("items.get"),
        postEndpoint("items.create"),
      ];
      const gen1 = new TestPlanGenerator();
      const gen2 = new TestPlanGenerator();
      const plan1 = gen1.generate(endpoints);
      const plan2 = gen2.generate(endpoints);

      const ids1 = plan1.cases.map((c) => c.id).join(",");
      const ids2 = plan2.cases.map((c) => c.id).join(",");
      expect(ids1).toBe(ids2);
    });
  });
});
