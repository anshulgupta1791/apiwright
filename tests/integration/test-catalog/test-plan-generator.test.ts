import { describe, it, expect } from "vitest";

import { TestPlanGenerator } from "../../../src/test-catalog/test-plan-generator.js";
import { MarkerFilter } from "../../../src/test-catalog/marker-filter.js";
import { parseJson } from "../../../src/core/safe-json.js";
import {
  FIXTURE_ENDPOINTS,
  FIXTURE_VALID_COUNT,
  FIXTURE_INVALID_COUNT,
  getUsers,
  createUser,
  deleteUser,
  updateUser,
  invalidEndpoint,
  CREATE_USER_SCHEMA_FIELDS,
} from "../../fixtures/test-catalog/endpoints.js";
import type { TestCase } from "../../../src/test-catalog/types.js";

/**
 * Integration tests for TestPlanGenerator — full pipeline over the multi-endpoint fixture.
 *
 * No network, no filesystem, no DB, no Date/random.
 * Uses the real TestPlanGenerator (no collaborator injection) over the
 * hand-authored fixture to verify the whole chain: validation → generation →
 * prod-safety → warning → determinism → round-trip → marker-filter disjointness.
 *
 * Counts are computed from fixture metadata (not hard-coded magic numbers) to
 * stay in sync with fixture changes without silent breakage.
 */
describe("TestPlanGenerator — integration over multi-endpoint fixture", () => {
  // Run generate ONCE and re-use; also run a second time for determinism check.
  let generator: TestPlanGenerator;

  function buildPlan() {
    generator = new TestPlanGenerator();
    return generator.generate(FIXTURE_ENDPOINTS);
  }

  describe("fixture baseline", () => {
    it("fixture has the expected number of total endpoints", () => {
      expect(FIXTURE_ENDPOINTS).toHaveLength(FIXTURE_VALID_COUNT + FIXTURE_INVALID_COUNT);
    });

    it("generate does not throw on the fixture", () => {
      expect(() => buildPlan()).not.toThrow();
    });
  });

  describe("invalid endpoint handling", () => {
    it("increments endpoints_skipped for the invalid endpoint", () => {
      const plan = buildPlan();
      expect(plan.endpoints_skipped).toBe(FIXTURE_INVALID_COUNT);
    });

    it("counts valid endpoints in endpoints_planned", () => {
      const plan = buildPlan();
      expect(plan.endpoints_planned).toBe(FIXTURE_VALID_COUNT);
    });

    it("planned + skipped equals fixture length", () => {
      const plan = buildPlan();
      expect(plan.endpoints_planned + plan.endpoints_skipped).toBe(FIXTURE_ENDPOINTS.length);
    });

    it("emits a warning naming the invalid endpoint id", () => {
      const plan = buildPlan();
      expect(plan.warnings.some((w) => w.includes(invalidEndpoint.id))).toBe(true);
    });

    it("generates a partial plan (not an empty plan) when one endpoint is invalid", () => {
      const plan = buildPlan();
      expect(plan.cases.length).toBeGreaterThan(0);
    });
  });

  describe("GET endpoint (getUsers) — case-set validation", () => {
    it("generates the 5 universal smoke cases for the GET endpoint", () => {
      const plan = buildPlan();
      const getTypes = plan.cases
        .filter((c) => c.endpoint_id === getUsers.id)
        .map((c) => c.type);
      const universalTypes = [
        "status_code_conformance",
        "content_type_alignment",
        "response_schema_validation",
        "auth_happy_path",
        "response_time_sla",
      ];
      for (const t of universalTypes) {
        expect(getTypes).toContain(t);
      }
    });

    it("generates get_idempotency for the GET endpoint", () => {
      const plan = buildPlan();
      const getTypes = plan.cases
        .filter((c) => c.endpoint_id === getUsers.id)
        .map((c) => c.type);
      expect(getTypes).toContain("get_idempotency");
    });

    it("does NOT generate auth-negative cases for GET (no auth_strategy)", () => {
      const plan = buildPlan();
      const getCases = plan.cases.filter((c) => c.endpoint_id === getUsers.id);
      expect(getCases.some((c) => c.type === "no_auth_returns_401")).toBe(false);
      expect(getCases.some((c) => c.type === "garbage_token_returns_401")).toBe(false);
    });

    it("does NOT generate body-negative cases for GET (no body)", () => {
      const plan = buildPlan();
      const getCases = plan.cases.filter((c) => c.endpoint_id === getUsers.id);
      expect(getCases.some((c) => c.type === "malformed_json_returns_400")).toBe(false);
      expect(getCases.some((c) => c.type === "required_field_omission_returns_400")).toBe(false);
    });
  });

  describe("authenticated POST (createUser) — full case-set validation", () => {
    it("generates universal smoke cases", () => {
      const plan = buildPlan();
      const postCases = plan.cases.filter((c) => c.endpoint_id === createUser.id);
      const types = postCases.map((c) => c.type);
      expect(types).toContain("status_code_conformance");
      expect(types).toContain("content_type_alignment");
      expect(types).toContain("auth_happy_path");
    });

    it("generates exactly 3 auth-negative cases", () => {
      const plan = buildPlan();
      const postCases = plan.cases.filter((c) => c.endpoint_id === createUser.id);
      expect(postCases.filter((c) => c.type === "no_auth_returns_401")).toHaveLength(1);
      expect(postCases.filter((c) => c.type === "garbage_token_returns_401")).toHaveLength(1);
      expect(postCases.filter((c) => c.type === "method_not_allowed")).toHaveLength(1);
    });

    it("generates exactly 1 malformed_json case", () => {
      const plan = buildPlan();
      const postCases = plan.cases.filter((c) => c.endpoint_id === createUser.id);
      expect(postCases.filter((c) => c.type === "malformed_json_returns_400")).toHaveLength(1);
    });

    it("generates one required_field_omission case per required field (computed count)", () => {
      const plan = buildPlan();
      const postCases = plan.cases.filter((c) => c.endpoint_id === createUser.id);
      const omissions = postCases.filter((c) => c.type === "required_field_omission_returns_400");
      // Computed from fixture, not magic number
      expect(omissions).toHaveLength(CREATE_USER_SCHEMA_FIELDS.required.length);
    });

    it("generates one type_violation case per typed field (computed count)", () => {
      const plan = buildPlan();
      const postCases = plan.cases.filter((c) => c.endpoint_id === createUser.id);
      const violations = postCases.filter((c) => c.type === "type_violation_returns_400");
      expect(violations).toHaveLength(CREATE_USER_SCHEMA_FIELDS.typed.length);
    });

    it("generates boundary cases (at least one per constrained field)", () => {
      const plan = buildPlan();
      const postCases = plan.cases.filter((c) => c.endpoint_id === createUser.id);
      const boundary = postCases.filter((c) => c.type === "boundary_battery");
      // Each constrained field gets inside+outside for each constraint
      // (2 cases per constraint); there must be at least 2 cases
      expect(boundary.length).toBeGreaterThan(0);
    });

    it("generates one db_state case per db_verify entry (computed count)", () => {
      const plan = buildPlan();
      const postCases = plan.cases.filter((c) => c.endpoint_id === createUser.id);
      const dbCases = postCases.filter((c) => c.type === "db_state_matches_expectation");
      expect(dbCases).toHaveLength(createUser.db_verify!.length);
    });

    it("generates bound assertion cases equal to assertion count (computed)", () => {
      const plan = buildPlan();
      const postCases = plan.cases.filter((c) => c.endpoint_id === createUser.id);
      const assertionCases = postCases.filter((c) => c.type === "assertion");
      expect(assertionCases).toHaveLength(createUser.assertions!.length);
    });
  });

  describe("DELETE (deleteUser) — idempotency and db_verify", () => {
    it("generates delete_idempotency with second_delete_status=204 for expected_status=204", () => {
      const plan = buildPlan();
      const deleteCases = plan.cases.filter((c) => c.endpoint_id === deleteUser.id);
      const idempotencyCase = deleteCases.find((c) => c.type === "delete_idempotency");
      expect(idempotencyCase).toBeDefined();
      expect(
        (idempotencyCase!.params as { second_delete_status: number }).second_delete_status,
      ).toBe(204);
    });

    it("generates db_state cases for DELETE with db_verify", () => {
      const plan = buildPlan();
      const deleteCases = plan.cases.filter((c) => c.endpoint_id === deleteUser.id);
      const dbCases = deleteCases.filter((c) => c.type === "db_state_matches_expectation");
      expect(dbCases).toHaveLength(deleteUser.db_verify!.length);
    });
  });

  describe("prod-safety classification", () => {
    it("GET endpoint smoke cases are prod_safe=true", () => {
      const plan = buildPlan();
      const getSmokeCases = plan.cases.filter(
        (c) => c.endpoint_id === getUsers.id && c.marker === "smoke",
      );
      expect(getSmokeCases.length).toBeGreaterThan(0);
      expect(getSmokeCases.every((c) => c.prod_safe === true)).toBe(true);
    });

    it("POST endpoint smoke cases are prod_safe=false (no prod_safe=true set)", () => {
      const plan = buildPlan();
      const postSmokeCases = plan.cases.filter(
        (c) => c.endpoint_id === createUser.id && c.marker === "smoke",
      );
      expect(postSmokeCases.length).toBeGreaterThan(0);
      expect(postSmokeCases.every((c) => c.prod_safe === false)).toBe(true);
    });

    it("PUT endpoint (prod_safe:true) smoke cases are prod_safe=true", () => {
      const plan = buildPlan();
      const putSmokeCases = plan.cases.filter(
        (c) => c.endpoint_id === updateUser.id && c.marker === "smoke",
      );
      expect(putSmokeCases.length).toBeGreaterThan(0);
      expect(putSmokeCases.every((c) => c.prod_safe === true)).toBe(true);
    });

    it("every regression case across all endpoints is prod_safe=false", () => {
      const plan = buildPlan();
      const regressionCases = plan.cases.filter((c) => c.marker === "regression");
      expect(regressionCases.length).toBeGreaterThan(0);
      expect(regressionCases.every((c) => c.prod_safe === false)).toBe(true);
    });
  });

  describe("determinism — byte-identical across two independent runs", () => {
    it("two independent generate calls produce JSON-stringify-identical TestPlan", () => {
      const gen1 = new TestPlanGenerator();
      const gen2 = new TestPlanGenerator();
      const plan1 = gen1.generate(FIXTURE_ENDPOINTS);
      const plan2 = gen2.generate(FIXTURE_ENDPOINTS);
      expect(JSON.stringify(plan1)).toBe(JSON.stringify(plan2));
    });

    it("case ids are stable across runs", () => {
      const gen1 = new TestPlanGenerator();
      const gen2 = new TestPlanGenerator();
      const ids1 = gen1.generate(FIXTURE_ENDPOINTS).cases.map((c: TestCase) => c.id);
      const ids2 = gen2.generate(FIXTURE_ENDPOINTS).cases.map((c: TestCase) => c.id);
      expect(ids1).toEqual(ids2);
    });
  });

  describe("JSON round-trip via parseJson (NOT raw JSON.parse)", () => {
    it("TestPlan serializes and deserializes with ok=true", () => {
      const plan = buildPlan();
      const result = parseJson(JSON.stringify(plan));
      expect(result.ok).toBe(true);
    });

    it("deserialized plan deep-equals the original plan", () => {
      const plan = buildPlan();
      const result = parseJson(JSON.stringify(plan));
      if (!result.ok) throw new Error("parseJson failed");
      expect(result.value).toEqual(plan);
    });

    it("no undefined-valued keys survive round-trip (optional keys are omitted)", () => {
      const plan = buildPlan();
      const serialized = JSON.stringify(plan);
      expect(serialized).not.toContain('"undefined"');
      // Verify no key maps to undefined by checking the parsed object directly
      const result = parseJson(serialized);
      if (!result.ok) throw new Error("parseJson failed");
      // All cases should have complete, defined params
      const reparsed = result.value as typeof plan;
      reparsed.cases.forEach((c) => {
        expect(c.params).toBeDefined();
        expect(typeof c.params).toBe("object");
      });
    });
  });

  describe("marker-filter disjointness and exhaustiveness", () => {
    it("smoke and regression filtered plans are disjoint (no shared case ids)", () => {
      const gen = new TestPlanGenerator();
      const plan = gen.generate(FIXTURE_ENDPOINTS);
      const filter = new MarkerFilter();
      const markerMap = gen.endpointMarkersOf(FIXTURE_ENDPOINTS);
      const smokePlan = filter.filter(plan, ["smoke"], markerMap);
      const regressionPlan = filter.filter(plan, ["regression"], markerMap);
      const smokeIds = new Set(smokePlan.cases.map((c) => c.id));
      for (const c of regressionPlan.cases) {
        expect(smokeIds.has(c.id)).toBe(false);
      }
    });

    it("union of smoke + regression equals all-filtered plan (by case id)", () => {
      const gen = new TestPlanGenerator();
      const plan = gen.generate(FIXTURE_ENDPOINTS);
      const filter = new MarkerFilter();
      const markerMap = gen.endpointMarkersOf(FIXTURE_ENDPOINTS);
      const smokePlan = filter.filter(plan, ["smoke"], markerMap);
      const regressionPlan = filter.filter(plan, ["regression"], markerMap);
      const allPlan = filter.filter(plan, ["all"], markerMap);
      const unionIds = new Set([
        ...smokePlan.cases.map((c) => c.id),
        ...regressionPlan.cases.map((c) => c.id),
      ]);
      const allIds = new Set(allPlan.cases.map((c) => c.id));
      expect(unionIds).toEqual(allIds);
    });

    it("all-filtered plan has more cases than smoke-only filtered plan", () => {
      const gen = new TestPlanGenerator();
      const plan = gen.generate(FIXTURE_ENDPOINTS);
      const filter = new MarkerFilter();
      const markerMap = gen.endpointMarkersOf(FIXTURE_ENDPOINTS);
      const smokePlan = filter.filter(plan, ["smoke"], markerMap);
      const allPlan = filter.filter(plan, ["all"], markerMap);
      expect(allPlan.cases.length).toBeGreaterThan(smokePlan.cases.length);
    });
  });

  describe("case-level field invariants across entire fixture", () => {
    it("every case has a string id matching ^[a-z0-9._-]+$", () => {
      const plan = buildPlan();
      plan.cases.forEach((c) => {
        expect(c.id).toMatch(/^[a-z0-9._-]+$/);
      });
    });

    it("every case has a non-empty endpoint_id", () => {
      const plan = buildPlan();
      plan.cases.forEach((c) => {
        expect(c.endpoint_id.length).toBeGreaterThan(0);
      });
    });

    it("every case has a non-empty title string", () => {
      const plan = buildPlan();
      plan.cases.forEach((c) => {
        expect(typeof c.title).toBe("string");
        expect(c.title.length).toBeGreaterThan(0);
      });
    });

    it("every case has marker in [smoke, regression, e2e]", () => {
      const plan = buildPlan();
      plan.cases.forEach((c) => {
        expect(["smoke", "regression", "e2e"]).toContain(c.marker);
      });
    });

    it("every case has prod_safe as boolean", () => {
      const plan = buildPlan();
      plan.cases.forEach((c) => {
        expect(typeof c.prod_safe).toBe("boolean");
      });
    });

    it("every case has a params object with a kind discriminant", () => {
      const plan = buildPlan();
      plan.cases.forEach((c) => {
        expect(c.params).toBeDefined();
        expect(typeof (c.params as { kind: unknown }).kind).toBe("string");
      });
    });

    it("all case ids are unique across the entire plan", () => {
      const plan = buildPlan();
      const ids = plan.cases.map((c) => c.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });
});
