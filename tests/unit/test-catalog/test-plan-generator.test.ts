import { describe, it, expect } from "vitest";

import { TestPlanGenerator } from "../../../src/test-catalog/test-plan-generator.js";
import type { CanonicalEndpoint } from "../../../src/core/canonical-model.js";
import { parseJson } from "../../../src/core/safe-json.js";

/**
 * Unit tests for TestPlanGenerator (orchestrator).
 *
 * Covers: empty array → empty valid plan; valid endpoint → all generator families
 * fire; invalid endpoint (id present) → skip+warn; invalid endpoint (id absent/
 * non-string) → warn with "index N"; mixed valid+invalid; no-arg construction
 * wires real defaults (tested, NOT istanbul-ignored); injected generators;
 * planned+skipped == input.length; never throws; determinism; JSON round-trip.
 */

// Issue #C: response.schema must be a REAL schema (not `{}`) so the planner
// emits response_schema_validation. An empty `{}` (or the importer sentinel)
// now triggers a "skip-with-WARN" code path to avoid false-positive PASSes.
const validGet: CanonicalEndpoint = {
  id: "users.list",
  name: "List Users",
  method: "GET",
  url: "/api/v1/users",
  request: {},
  response: { expected_status: 200, schema: { type: "object" } },
};

const validPost: CanonicalEndpoint = {
  id: "users.create",
  name: "Create User",
  method: "POST",
  url: "/api/v1/users",
  auth_strategy: "user_token",
  request: {
    body_schema: {
      type: "object",
      required: ["email"],
      properties: { email: { type: "string" } },
    },
  },
  response: { expected_status: 201, schema: { type: "object" } },
};

const invalidEndpointWithId = {
  id: "bad.endpoint",
  name: "Bad",
  method: "GET",
  url: "/bad",
  request: {},
  // response intentionally absent
} as unknown as CanonicalEndpoint;

const invalidEndpointNoId = {
  name: "No ID",
  method: "POST",
  url: "/no-id",
  request: {},
  // id and response intentionally absent
} as unknown as CanonicalEndpoint;

describe("TestPlanGenerator", () => {
  describe("constructor — no-arg default wiring (NOT istanbul-ignored per pipeline rule)", () => {
    it("constructs with no arguments and wires real defaults", () => {
      expect(() => new TestPlanGenerator()).not.toThrow();
    });

    it("default construction expands a valid endpoint into cases (real SchemaValidator wired)", () => {
      const gen = new TestPlanGenerator();
      const { cases, endpoints_planned } = gen.generate([validGet]);
      expect(endpoints_planned).toBe(1);
      expect(cases.length).toBeGreaterThan(0);
    });
  });

  describe("generate() — empty array → empty valid plan", () => {
    it("returns cases=[] for empty input", () => {
      const gen = new TestPlanGenerator();
      const plan = gen.generate([]);
      expect(plan.cases).toHaveLength(0);
    });

    it("returns endpoints_planned=0 for empty input", () => {
      const gen = new TestPlanGenerator();
      expect(gen.generate([]).endpoints_planned).toBe(0);
    });

    it("returns endpoints_skipped=0 for empty input", () => {
      const gen = new TestPlanGenerator();
      expect(gen.generate([]).endpoints_skipped).toBe(0);
    });

    it("returns warnings=[] for empty input", () => {
      const gen = new TestPlanGenerator();
      expect(gen.generate([]).warnings).toHaveLength(0);
    });

    it("does not throw on empty input", () => {
      const gen = new TestPlanGenerator();
      expect(() => gen.generate([])).not.toThrow();
    });
  });

  describe("generate() — valid endpoint produces all applicable families", () => {
    it("expands a GET to include universal (5) smoke cases", () => {
      const gen = new TestPlanGenerator();
      const { cases } = gen.generate([validGet]);
      const universalTypes = [
        "status_code_conformance",
        "content_type_alignment",
        "response_schema_validation",
        "auth_happy_path",
        "response_time_sla",
      ];
      for (const t of universalTypes) {
        expect(cases.some((c) => c.type === t)).toBe(true);
      }
    });

    it("expands a POST with auth+body to include auth-negative cases", () => {
      const gen = new TestPlanGenerator();
      const { cases } = gen.generate([validPost]);
      expect(cases.some((c) => c.type === "no_auth_returns_401")).toBe(true);
      expect(cases.some((c) => c.type === "garbage_token_returns_401")).toBe(true);
      expect(cases.some((c) => c.type === "method_not_allowed")).toBe(true);
    });

    it("expands a POST with body to include body-negative cases", () => {
      const gen = new TestPlanGenerator();
      const { cases } = gen.generate([validPost]);
      expect(cases.some((c) => c.type === "malformed_json_returns_400")).toBe(true);
      expect(cases.some((c) => c.type === "required_field_omission_returns_400")).toBe(true);
    });

    it("expands a GET to include get_idempotency", () => {
      const gen = new TestPlanGenerator();
      const { cases } = gen.generate([validGet]);
      expect(cases.some((c) => c.type === "get_idempotency")).toBe(true);
    });

    it("does NOT generate auth-negative cases for a GET with no auth_strategy", () => {
      const gen = new TestPlanGenerator();
      const { cases } = gen.generate([validGet]);
      expect(cases.some((c) => c.type === "no_auth_returns_401")).toBe(false);
    });
  });

  describe("generate() — invalid endpoint (id present) → skip + warn, never throw", () => {
    it("does not throw on invalid endpoint", () => {
      const gen = new TestPlanGenerator();
      expect(() => gen.generate([invalidEndpointWithId])).not.toThrow();
    });

    it("increments endpoints_skipped for invalid endpoint", () => {
      const gen = new TestPlanGenerator();
      const { endpoints_skipped } = gen.generate([invalidEndpointWithId]);
      expect(endpoints_skipped).toBe(1);
    });

    it("keeps endpoints_planned at 0 for all-invalid input", () => {
      const gen = new TestPlanGenerator();
      const { endpoints_planned } = gen.generate([invalidEndpointWithId]);
      expect(endpoints_planned).toBe(0);
    });

    it("emits zero cases for an invalid endpoint", () => {
      const gen = new TestPlanGenerator();
      const { cases } = gen.generate([invalidEndpointWithId]);
      expect(cases).toHaveLength(0);
    });

    it("adds a warning naming the endpoint id", () => {
      const gen = new TestPlanGenerator();
      const { warnings } = gen.generate([invalidEndpointWithId]);
      expect(warnings.some((w) => w.includes("bad.endpoint"))).toBe(true);
    });

    it("includes schema validation errors in the warning", () => {
      const gen = new TestPlanGenerator();
      const { warnings } = gen.generate([invalidEndpointWithId]);
      expect(warnings[0].length).toBeGreaterThan("bad.endpoint".length);
    });
  });

  describe("generate() — invalid endpoint (id absent) → warn with index N", () => {
    it("warns with index reference when id is absent", () => {
      const gen = new TestPlanGenerator();
      const { warnings } = gen.generate([invalidEndpointNoId]);
      expect(warnings.some((w) => w.toLowerCase().includes("index"))).toBe(true);
    });

    it("does not throw when id is absent on invalid endpoint", () => {
      const gen = new TestPlanGenerator();
      expect(() => gen.generate([invalidEndpointNoId])).not.toThrow();
    });
  });

  describe("generate() — planned + skipped === input.length", () => {
    it("planned + skipped = 1 for single valid endpoint", () => {
      const gen = new TestPlanGenerator();
      const { endpoints_planned, endpoints_skipped } = gen.generate([validGet]);
      expect(endpoints_planned + endpoints_skipped).toBe(1);
    });

    it("planned + skipped = 1 for single invalid endpoint", () => {
      const gen = new TestPlanGenerator();
      const { endpoints_planned, endpoints_skipped } = gen.generate([invalidEndpointWithId]);
      expect(endpoints_planned + endpoints_skipped).toBe(1);
    });

    it("planned + skipped = N for mixed input", () => {
      const gen = new TestPlanGenerator();
      const endpoints = [validGet, validPost, invalidEndpointWithId, invalidEndpointNoId];
      const { endpoints_planned, endpoints_skipped } = gen.generate(endpoints);
      expect(endpoints_planned + endpoints_skipped).toBe(endpoints.length);
    });

    it("all valid → endpoints_skipped === 0", () => {
      const gen = new TestPlanGenerator();
      const { endpoints_skipped } = gen.generate([validGet, validPost]);
      expect(endpoints_skipped).toBe(0);
    });

    it("all invalid → endpoints_planned === 0", () => {
      const gen = new TestPlanGenerator();
      const { endpoints_planned } = gen.generate([invalidEndpointWithId, invalidEndpointNoId]);
      expect(endpoints_planned).toBe(0);
    });
  });

  describe("generate() — determinism", () => {
    it("produces byte-identical TestPlan for two runs on the same input", () => {
      const gen = new TestPlanGenerator();
      const r1 = gen.generate([validGet, validPost]);
      const r2 = gen.generate([validGet, validPost]);
      expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
    });

    it("stable case ordering — identical ids in identical positions", () => {
      const gen = new TestPlanGenerator();
      const { cases: c1 } = gen.generate([validGet, validPost]);
      const { cases: c2 } = gen.generate([validGet, validPost]);
      expect(c1.map((c) => c.id)).toEqual(c2.map((c) => c.id));
    });
  });

  describe("generate() — JSON round-trip via parseJson", () => {
    it("TestPlan round-trips through JSON.stringify + parseJson with ok=true", () => {
      const gen = new TestPlanGenerator();
      const plan = gen.generate([validGet, validPost]);
      const serialized = JSON.stringify(plan);
      const result = parseJson(serialized);
      expect(result.ok).toBe(true);
    });

    it("parsed plan deep-equals the original plan (no undefined keys)", () => {
      const gen = new TestPlanGenerator();
      const plan = gen.generate([validGet, validPost]);
      const result = parseJson(JSON.stringify(plan));
      if (!result.ok) throw new Error("parseJson failed");
      expect(result.value).toEqual(plan);
    });
  });

  describe("endpointMarkersOf()", () => {
    it("returns a record mapping endpoint id → declared markers", () => {
      const gen = new TestPlanGenerator();
      const epWithMarkers: CanonicalEndpoint = {
        ...validGet,
        id: "ep.marked",
        markers: ["smoke"],
      };
      const map = gen.endpointMarkersOf([epWithMarkers]);
      expect(map["ep.marked"]).toEqual(["smoke"]);
    });

    it("returns undefined for endpoints with no declared markers", () => {
      const gen = new TestPlanGenerator();
      const map = gen.endpointMarkersOf([validGet]);
      expect(map["users.list"]).toBeUndefined();
    });

    it("handles empty array input", () => {
      const gen = new TestPlanGenerator();
      const map = gen.endpointMarkersOf([]);
      expect(Object.keys(map)).toHaveLength(0);
    });
  });

  describe("generate() — injected generator list", () => {
    it("uses only the injected generators when provided", () => {
      const fakeGenerator = {
        generate: (_ep: CanonicalEndpoint) => ({
          cases: [],
          warnings: ["fake-generator-ran"],
        }),
      };
      const gen = new TestPlanGenerator({ generators: [fakeGenerator] });
      const { warnings } = gen.generate([validGet]);
      expect(warnings.some((w) => w === "fake-generator-ran")).toBe(true);
    });
  });
});
