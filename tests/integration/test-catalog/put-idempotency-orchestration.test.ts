/**
 * Integration tests for PutIdempotencyGenerator wired into TestPlanGenerator.
 *
 * Uses REAL TestPlanGenerator (no mocks of its dependencies) with inline fixture
 * endpoints. Verifies that:
 *   - PUT endpoints without db_verify produce exactly one put_idempotency case
 *     with compare === "body_equality"
 *   - PUT endpoints with db_verify produce BOTH the put_idempotency case
 *     (compare === "db_state") AND the existing db_state_matches_expectation case
 *   - skip_cases: ["put_idempotency"] on the endpoint suppresses the case and
 *     emits the counted-skip warning
 *   - skipGlobally: ["put_idempotency"] suppresses across all PUT endpoints and
 *     emits a global-skip warning
 *   - skip_cases: ["put_idempotency"] on a GET endpoint emits a dead-weight warning
 *     and leaves the GET's own get_idempotency case untouched
 *   - Bogus token "put_idemptoncy" (typo) fires the unknown-kind warning,
 *     proving ALL_SKIPPABLE_KINDS includes "put_idempotency"
 *   - Mixed plan with PUT + GET + DELETE endpoints has exactly one of each
 *     idempotency kind (no cross-contamination)
 *   - Backward compat: v1.0.1-shape PUT endpoint (no db_verify, no body_example)
 *     still emits ONE put_idempotency case with body_equality + warnings about
 *     missing body_example; existing cases unaffected
 *
 * Design decisions pinned:
 *   DD-1  Empty/204 body → PASS at runtime; plan-time warning when PUT+204+no db_verify.
 *   DD-5  Request body from endpoint.request.body_example; missing → plan warning.
 *   DD-9  compare is a two-literal union ("body_equality" | "db_state").
 *   Locked routing rule: compare === "db_state" IFF endpoint.db_verify?.length > 0.
 *   DD-skip-count: counted skip warning template:
 *     "Endpoint '<id>': skip_cases token 'put_idempotency' skipped 1 case(s)."
 *   DD-dead-weight: dead-weight warning template:
 *     "Endpoint '<id>': skip_cases token 'put_idempotency' matched zero generated cases
 *      on this endpoint."
 */

import { describe, it, expect } from "vitest";

import { TestPlanGenerator } from "../../../src/test-catalog/test-plan-generator.js";
import type { CanonicalEndpoint } from "../../../src/core/canonical-model.js";
import type { PutIdempotencyParams } from "../../../src/test-catalog/test-case-params.js";

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

function putEndpoint(id: string, overrides: Partial<CanonicalEndpoint> = {}): CanonicalEndpoint {
  return {
    id,
    name: `PUT ${id}`,
    method: "PUT",
    url: `/api/${id}`,
    request: { body_example: { value: "updated" } },
    response: { expected_status: 200, schema: { type: "object" } },
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
    response: { expected_status: 200, schema: { type: "object" } },
    ...overrides,
  };
}

function deleteEndpoint(id: string, overrides: Partial<CanonicalEndpoint> = {}): CanonicalEndpoint {
  return {
    id,
    name: `DELETE ${id}`,
    method: "DELETE",
    url: `/api/${id}`,
    request: {},
    response: { expected_status: 204, schema: {} },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Orchestration integration tests
// ---------------------------------------------------------------------------

describe("put_idempotency — TestPlanGenerator orchestration", () => {

  /**
   * Case 1: PUT fixture without db_verify → plan contains exactly one put_idempotency
   * case with compare === "body_equality"; endpoints_planned reflects the endpoint.
   */
  describe("case 1 — PUT without db_verify", () => {
    it("produces exactly one put_idempotency case for a PUT endpoint without db_verify", () => {
      const gen = new TestPlanGenerator();
      const plan = gen.generate([putEndpoint("items.update")]);
      const putCases = plan.cases.filter((c) => c.type === "put_idempotency");
      expect(putCases).toHaveLength(1);
    });

    it("put_idempotency case has compare === 'body_equality' when no db_verify", () => {
      const gen = new TestPlanGenerator();
      const plan = gen.generate([putEndpoint("items.update")]);
      const putCase = plan.cases.find((c) => c.type === "put_idempotency");
      expect(putCase).toBeDefined();
      const params = putCase!.params as PutIdempotencyParams;
      expect(params.compare).toBe("body_equality");
    });

    it("endpoints_planned is 1 when there is one valid PUT endpoint", () => {
      const gen = new TestPlanGenerator();
      const plan = gen.generate([putEndpoint("items.update")]);
      expect(plan.endpoints_planned).toBe(1);
    });
  });

  /**
   * Case 2: PUT fixture with db_verify → plan contains BOTH the put_idempotency case
   * (compare === "db_state") AND the db_state_matches_expectation case; they coexist.
   */
  describe("case 2 — PUT with db_verify: both put_idempotency and db_state coexist", () => {
    const ep = putEndpoint("orders.update", {
      db_verify: [
        {
          connection: "primary",
          query: "SELECT id FROM orders WHERE id = 1",
          expect: "exists",
        },
      ],
    });

    it("plan contains one put_idempotency case with compare === 'db_state'", () => {
      const gen = new TestPlanGenerator();
      const plan = gen.generate([ep]);
      const putCase = plan.cases.find((c) => c.type === "put_idempotency");
      expect(putCase).toBeDefined();
      const params = putCase!.params as PutIdempotencyParams;
      expect(params.compare).toBe("db_state");
    });

    it("plan also contains at least one db_state_matches_expectation case", () => {
      const gen = new TestPlanGenerator();
      const plan = gen.generate([ep]);
      const dbCases = plan.cases.filter((c) => c.type === "db_state_matches_expectation");
      expect(dbCases.length).toBeGreaterThanOrEqual(1);
    });

    it("both case types are present simultaneously (they coexist)", () => {
      const gen = new TestPlanGenerator();
      const plan = gen.generate([ep]);
      const types = plan.cases.map((c) => c.type);
      expect(types).toContain("put_idempotency");
      expect(types).toContain("db_state_matches_expectation");
    });
  });

  /**
   * Case 3: skip_cases: ["put_idempotency"] on endpoint → no put_idempotency case in
   * plan; warnings contains counted-skip message.
   */
  describe("case 3 — endpoint skip_cases: ['put_idempotency']", () => {
    const ep = putEndpoint("items.patch", {
      skip_cases: ["put_idempotency"],
      request: { body_example: { x: 1 } },
    });

    it("removes put_idempotency case from plan when skip_cases includes it", () => {
      const gen = new TestPlanGenerator();
      const plan = gen.generate([ep]);
      const putCases = plan.cases.filter((c) => c.type === "put_idempotency");
      expect(putCases).toHaveLength(0);
    });

    it("emits counted-skip warning naming the endpoint id and token", () => {
      const gen = new TestPlanGenerator();
      const plan = gen.generate([ep]);
      const warnings = plan.warnings;
      // Template: "Endpoint '<id>': skip_cases token 'put_idempotency' skipped N case(s)."
      const countedSkip = warnings.find(
        (w) =>
          w.includes("items.patch") &&
          w.includes("put_idempotency") &&
          w.match(/skipped \d+ case\(s\)/),
      );
      expect(countedSkip).toBeDefined();
    });
  });

  /**
   * Case 4: Plan-level skipGlobally: ["put_idempotency"] removes the case from ALL
   * PUT endpoints; global-skip warning emitted with correct count.
   */
  describe("case 4 — skipGlobally: ['put_idempotency']", () => {
    const endpoints: CanonicalEndpoint[] = [
      putEndpoint("a.update", { request: { body_example: { v: 1 } } }),
      putEndpoint("b.update", { request: { body_example: { v: 2 } } }),
    ];

    it("removes put_idempotency from all PUT endpoints", () => {
      const gen = new TestPlanGenerator({ skipGlobally: ["put_idempotency"] });
      const plan = gen.generate(endpoints);
      const putCases = plan.cases.filter((c) => c.type === "put_idempotency");
      expect(putCases).toHaveLength(0);
    });

    it("emits a global skip warning naming the token and at least one endpoint", () => {
      const gen = new TestPlanGenerator({ skipGlobally: ["put_idempotency"] });
      const plan = gen.generate(endpoints);
      const warnings = plan.warnings;
      const globalSkipWarning = warnings.find(
        (w) =>
          w.includes("put_idempotency") &&
          w.toLowerCase().includes("skip_globally"),
      );
      expect(globalSkipWarning).toBeDefined();
    });

    it("global skip warning references at least 2 endpoints being affected", () => {
      const gen = new TestPlanGenerator({ skipGlobally: ["put_idempotency"] });
      const plan = gen.generate(endpoints);
      const warnings = plan.warnings;
      // Template: "config.case_generation: skip_globally token 'put_idempotency'
      //            skipped N case(s) across M endpoint(s)."
      const globalWarning = warnings.find(
        (w) => w.includes("put_idempotency") && w.match(/\d+ endpoint\(s\)/),
      );
      expect(globalWarning).toBeDefined();
      if (globalWarning) {
        const match = /(\d+) endpoint\(s\)/.exec(globalWarning);
        const epCount = parseInt(match?.[1] ?? "0", 10);
        expect(epCount).toBe(2);
      }
    });
  });

  /**
   * Case 5: skip_cases: ["put_idempotency"] on a GET endpoint → dead-weight warning;
   * GET's own get_idempotency case is still present.
   */
  describe("case 5 — dead-weight skip token on GET endpoint", () => {
    const ep = getEndpoint("items.list", {
      skip_cases: ["put_idempotency"],
    });

    it("emits dead-weight warning naming the GET endpoint id and the token", () => {
      const gen = new TestPlanGenerator();
      const plan = gen.generate([ep]);
      const warnings = plan.warnings;
      const deadWeightWarning = warnings.find(
        (w) =>
          w.includes("items.list") &&
          w.includes("put_idempotency") &&
          w.includes("matched zero"),
      );
      expect(deadWeightWarning).toBeDefined();
    });

    it("GET endpoint still emits its own get_idempotency case", () => {
      const gen = new TestPlanGenerator();
      const plan = gen.generate([ep]);
      const getCases = plan.cases.filter(
        (c) => c.endpoint_id === "items.list" && c.type === "get_idempotency",
      );
      expect(getCases).toHaveLength(1);
    });
  });

  /**
   * Case 6: Bogus token "put_idemptoncy" (typo) → unknown-kind warning fires.
   * Validates that the ALL_SKIPPABLE_KINDS set includes "put_idempotency"
   * (so the mis-spelled version is caught as unknown).
   */
  describe("case 6 — unknown-kind warning for typo in skip token", () => {
    it("emits unknown-kind warning for 'put_idemptoncy' (typo)", () => {
      const ep = putEndpoint("things.update", {
        skip_cases: ["put_idemptoncy"], // deliberate typo
        request: { body_example: { v: 1 } },
      });
      const gen = new TestPlanGenerator();
      const plan = gen.generate([ep]);
      const warnings = plan.warnings;
      const unknownKindWarning = warnings.find(
        (w) =>
          w.toLowerCase().includes("unknown") &&
          w.includes("put_idemptoncy"),
      );
      expect(unknownKindWarning).toBeDefined();
    });

    it("'put_idempotency' (correct spelling) does NOT trigger the unknown-kind warning", () => {
      const ep = putEndpoint("things.update", {
        skip_cases: ["put_idempotency"],
        request: { body_example: { v: 1 } },
      });
      const gen = new TestPlanGenerator();
      const plan = gen.generate([ep]);
      const warnings = plan.warnings;
      const unknownKindWarning = warnings.find(
        (w) =>
          w.toLowerCase().includes("unknown") &&
          w.includes("put_idempotency"),
      );
      expect(unknownKindWarning).toBeUndefined();
    });
  });

  /**
   * Case 7: Mixed plan with 1 PUT + 1 GET + 1 DELETE → exactly one of each
   * idempotency kind; no cross-contamination.
   */
  describe("case 7 — mixed plan with PUT + GET + DELETE", () => {
    const endpoints: CanonicalEndpoint[] = [
      putEndpoint("users.update", { request: { body_example: { name: "Alice" } } }),
      getEndpoint("users.list"),
      deleteEndpoint("users.delete"),
    ];

    it("plan contains exactly one put_idempotency case", () => {
      const gen = new TestPlanGenerator();
      const plan = gen.generate(endpoints);
      const putCases = plan.cases.filter((c) => c.type === "put_idempotency");
      expect(putCases).toHaveLength(1);
    });

    it("plan contains exactly one get_idempotency case", () => {
      const gen = new TestPlanGenerator();
      const plan = gen.generate(endpoints);
      const getCases = plan.cases.filter((c) => c.type === "get_idempotency");
      expect(getCases).toHaveLength(1);
    });

    it("plan contains exactly one delete_idempotency case", () => {
      const gen = new TestPlanGenerator();
      const plan = gen.generate(endpoints);
      const deleteCases = plan.cases.filter((c) => c.type === "delete_idempotency");
      expect(deleteCases).toHaveLength(1);
    });

    it("put_idempotency case is owned by the PUT endpoint only", () => {
      const gen = new TestPlanGenerator();
      const plan = gen.generate(endpoints);
      const putCase = plan.cases.find((c) => c.type === "put_idempotency");
      expect(putCase?.endpoint_id).toBe("users.update");
    });

    it("get_idempotency case is owned by the GET endpoint only", () => {
      const gen = new TestPlanGenerator();
      const plan = gen.generate(endpoints);
      const getCase = plan.cases.find((c) => c.type === "get_idempotency");
      expect(getCase?.endpoint_id).toBe("users.list");
    });

    it("delete_idempotency case is owned by the DELETE endpoint only", () => {
      const gen = new TestPlanGenerator();
      const plan = gen.generate(endpoints);
      const deleteCase = plan.cases.find((c) => c.type === "delete_idempotency");
      expect(deleteCase?.endpoint_id).toBe("users.delete");
    });
  });

  /**
   * Case 8: Backward compat — v1.0.1-shape PUT endpoint (no db_verify, no body_example)
   * still emits ONE put_idempotency case with body_equality + warnings about missing
   * body_example; existing cases unaffected.
   */
  describe("case 8 — backward compat with v1.0.1-shape PUT endpoint", () => {
    // A PUT endpoint with none of the new fields: no db_verify, no body_example
    const legacyPutEndpoint: CanonicalEndpoint = {
      id: "legacy.update",
      name: "Legacy Update",
      method: "PUT",
      url: "/api/legacy",
      request: {}, // no body_example — v1.0.1 shape
      response: { expected_status: 200, schema: { type: "object" } },
      // no db_verify — v1.0.1 shape
    };

    it("still emits exactly one put_idempotency case", () => {
      const gen = new TestPlanGenerator();
      const plan = gen.generate([legacyPutEndpoint]);
      const putCases = plan.cases.filter((c) => c.type === "put_idempotency");
      expect(putCases).toHaveLength(1);
    });

    it("puts compare === 'body_equality' for the legacy endpoint (no db_verify)", () => {
      const gen = new TestPlanGenerator();
      const plan = gen.generate([legacyPutEndpoint]);
      const putCase = plan.cases.find((c) => c.type === "put_idempotency");
      const params = putCase!.params as PutIdempotencyParams;
      expect(params.compare).toBe("body_equality");
    });

    it("emits a plan warning about missing body_example", () => {
      const gen = new TestPlanGenerator();
      const plan = gen.generate([legacyPutEndpoint]);
      const warnings = plan.warnings;
      const bodyWarning = warnings.find(
        (w) => w.toLowerCase().includes("body_example") && w.includes("legacy.update"),
      );
      expect(bodyWarning).toBeDefined();
    });

    it("endpoints_planned is still 1 (endpoint is not skipped)", () => {
      const gen = new TestPlanGenerator();
      const plan = gen.generate([legacyPutEndpoint]);
      expect(plan.endpoints_planned).toBe(1);
    });

    it("existing universal cases are still generated (not regressed by new generator)", () => {
      const gen = new TestPlanGenerator();
      const plan = gen.generate([legacyPutEndpoint]);
      const types = plan.cases.map((c) => c.type);
      expect(types).toContain("status_code_conformance");
      expect(types).toContain("content_type_alignment");
    });
  });
});
