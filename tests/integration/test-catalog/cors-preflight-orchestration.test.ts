/**
 * Integration tests for cors_preflight wired into TestPlanGenerator.
 *
 * Uses the REAL TestPlanGenerator (no mocks of its dependencies) with inline
 * fixture endpoints. Verifies that:
 *   1.  OPTIONS endpoint with full cors → 1 cors_preflight case (smoke, prod_safe=true).
 *   2.  OPTIONS + cors.allow_origins: [] → 0 cases + 1 plan warning (exact DD-7 #1 text).
 *   3.  OPTIONS + cors.allow_methods: [] → 0 cases + 1 plan warning (exact DD-7 #2 text).
 *   4.  OPTIONS + cors.allow_headers: [] → 1 case (no warning).
 *   5.  skip_cases: ["cors_preflight"] on endpoint → case absent; counted-skip warning.
 *   6.  skip_cases: ["cors_preflight:anything"] on endpoint → case present (non-field-carrier,
 *       DD-12); dead-weight warning emitted.
 *   7.  skipGlobally: ["cors_preflight"] across two OPTIONS endpoints → all cases absent; global warning.
 *   8.  Non-OPTIONS methods (GET/POST/PUT) with cors → no cors_preflight case (DD-1, silent).
 *   9.  Mixed plan: body-negative + cors_preflight cases coexist without interference.
 *   10. ALL_SKIPPABLE_KINDS.size === 21 (DD-12).
 *
 * Design decisions pinned:
 *   DD-1  Non-OPTIONS + cors → silent no-op; no warning.
 *   DD-7  Empty allow_origins or allow_methods → warning + drop case.
 *   DD-9  marker === "smoke"; prod_safe === true.
 *   DD-12 "cors_preflight" is NOT a field-carrier; "cors_preflight:field" dead-weights.
 *         ALL_SKIPPABLE_KINDS.size === 21.
 *
 * Category: Integration (orchestration — real TestPlanGenerator).
 * Expected initial failure: TestPlanGenerator returns zero cors_preflight cases.
 */

import { describe, it, expect } from "vitest";

import { TestPlanGenerator } from "../../../src/test-catalog/test-plan-generator.js";
import { ALL_SKIPPABLE_KINDS } from "../../../src/test-catalog/skip-resolver.js";
import type { CanonicalEndpoint } from "../../../src/core/canonical-model.js";
import type { CorsPreflightParams } from "../../../src/test-catalog/test-case-params.js";

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

function optionsWithCors(
  id: string,
  cors: {
    allow_origins: readonly string[];
    allow_methods: readonly string[];
    allow_headers: readonly string[];
  },
  overrides: Partial<CanonicalEndpoint> = {},
): CanonicalEndpoint {
  const ep: CanonicalEndpoint = {
    id,
    name: `OPTIONS ${id}`,
    method: "OPTIONS",
    url: `/api/${id}`,
    request: {},
    response: { expected_status: 200, schema: {} },
    ...overrides,
  };
  (ep as Record<string, unknown>)["cors"] = cors;
  return ep;
}

function getEndpoint(id: string): CanonicalEndpoint {
  return {
    id,
    name: `GET ${id}`,
    method: "GET",
    url: `/api/${id}`,
    request: {},
    response: { expected_status: 200, schema: {} },
  };
}

function postEndpointWithBodySchema(id: string): CanonicalEndpoint {
  return {
    id,
    name: `POST ${id}`,
    method: "POST",
    url: `/api/${id}`,
    request: {
      body_schema: {
        type: "object",
        required: ["name"],
        properties: { name: { type: "string" } },
      },
      body_example: { name: "test" },
    },
    response: { expected_status: 201, schema: { type: "object" } },
  };
}

// ---------------------------------------------------------------------------
// Orchestration integration tests
// ---------------------------------------------------------------------------

describe("cors_preflight — TestPlanGenerator orchestration", () => {

  /**
   * Case 1: OPTIONS with full cors → 1 cors_preflight case, smoke, prod_safe=true.
   */
  describe("case 1 — OPTIONS with full cors config → one case emitted", () => {
    const ep = optionsWithCors("users.options", {
      allow_origins: ["https://app.example.com"],
      allow_methods: ["GET", "POST", "PUT"],
      allow_headers: ["Authorization", "Content-Type"],
    });

    it("produces exactly one cors_preflight case", () => {
      const gen = new TestPlanGenerator();
      const plan = gen.generate([ep]);
      const corsCases = plan.cases.filter((c) => c.type === "cors_preflight");
      expect(corsCases).toHaveLength(1);
    });

    it("cors_preflight case has marker === 'smoke'", () => {
      const gen = new TestPlanGenerator();
      const plan = gen.generate([ep]);
      const corsCase = plan.cases.find((c) => c.type === "cors_preflight");
      expect(corsCase?.marker).toBe("smoke");
    });

    it("cors_preflight case has prod_safe === true", () => {
      const gen = new TestPlanGenerator();
      const plan = gen.generate([ep]);
      const corsCase = plan.cases.find((c) => c.type === "cors_preflight");
      expect(corsCase?.prod_safe).toBe(true);
    });

    it("cors_preflight case params.allow_origins echoes the config", () => {
      const gen = new TestPlanGenerator();
      const plan = gen.generate([ep]);
      const corsCase = plan.cases.find((c) => c.type === "cors_preflight");
      const params = corsCase?.params as CorsPreflightParams;
      expect(params.allow_origins).toEqual(["https://app.example.com"]);
    });

    it("cors_preflight case params.allow_methods echoes the config", () => {
      const gen = new TestPlanGenerator();
      const plan = gen.generate([ep]);
      const corsCase = plan.cases.find((c) => c.type === "cors_preflight");
      const params = corsCase?.params as CorsPreflightParams;
      expect(params.allow_methods).toEqual(["GET", "POST", "PUT"]);
    });

    it("endpoints_planned is 1 when there is one valid OPTIONS endpoint", () => {
      const gen = new TestPlanGenerator();
      const plan = gen.generate([ep]);
      expect(plan.endpoints_planned).toBe(1);
    });
  });

  /**
   * Case 2: OPTIONS + allow_origins empty → 0 cases + exact DD-7 #1 warning.
   */
  describe("case 2 — OPTIONS + allow_origins empty → warning + no case", () => {
    const ep = optionsWithCors("ep.no-origins", {
      allow_origins: [],
      allow_methods: ["GET"],
      allow_headers: [],
    });

    it("produces zero cors_preflight cases when allow_origins is empty", () => {
      const gen = new TestPlanGenerator();
      const plan = gen.generate([ep]);
      const corsCases = plan.cases.filter((c) => c.type === "cors_preflight");
      expect(corsCases).toHaveLength(0);
    });

    it("emits a warning matching the exact DD-7 #1 template", () => {
      const gen = new TestPlanGenerator();
      const plan = gen.generate([ep]);
      const expected = "Endpoint 'ep.no-origins': cors_preflight — allow_origins is empty; case dropped.";
      const hasWarning = plan.warnings.some((w) => w === expected);
      expect(hasWarning).toBe(true);
    });
  });

  /**
   * Case 3: OPTIONS + allow_methods empty → 0 cases + exact DD-7 #2 warning.
   */
  describe("case 3 — OPTIONS + allow_methods empty → warning + no case", () => {
    const ep = optionsWithCors("ep.no-methods", {
      allow_origins: ["https://a.com"],
      allow_methods: [],
      allow_headers: [],
    });

    it("produces zero cors_preflight cases when allow_methods is empty", () => {
      const gen = new TestPlanGenerator();
      const plan = gen.generate([ep]);
      const corsCases = plan.cases.filter((c) => c.type === "cors_preflight");
      expect(corsCases).toHaveLength(0);
    });

    it("emits a warning matching the exact DD-7 #2 template", () => {
      const gen = new TestPlanGenerator();
      const plan = gen.generate([ep]);
      const expected = "Endpoint 'ep.no-methods': cors_preflight — allow_methods is empty; case dropped.";
      const hasWarning = plan.warnings.some((w) => w === expected);
      expect(hasWarning).toBe(true);
    });
  });

  /**
   * Case 4: OPTIONS + allow_headers empty → 1 case, no warning.
   */
  describe("case 4 — OPTIONS + allow_headers empty → 1 case, no warning", () => {
    const ep = optionsWithCors("ep.no-headers", {
      allow_origins: ["https://a.com"],
      allow_methods: ["GET", "POST"],
      allow_headers: [],
    });

    it("emits exactly one cors_preflight case when allow_headers is empty", () => {
      const gen = new TestPlanGenerator();
      const plan = gen.generate([ep]);
      const corsCases = plan.cases.filter((c) => c.type === "cors_preflight");
      expect(corsCases).toHaveLength(1);
    });

    it("emits no cors_preflight-related warning when allow_headers is empty", () => {
      const gen = new TestPlanGenerator();
      const plan = gen.generate([ep]);
      const corsWarnings = plan.warnings.filter((w) => w.includes("cors_preflight"));
      expect(corsWarnings).toHaveLength(0);
    });
  });

  /**
   * Case 5: skip_cases: ["cors_preflight"] on endpoint → case absent; counted-skip warning.
   */
  describe("case 5 — skip_cases: ['cors_preflight'] on endpoint", () => {
    const ep = optionsWithCors("ep.cors-skip", {
      allow_origins: ["https://a.com"],
      allow_methods: ["GET"],
      allow_headers: [],
    }, {
      skip_cases: ["cors_preflight"],
    });

    it("removes cors_preflight case when skip_cases includes it", () => {
      const gen = new TestPlanGenerator();
      const plan = gen.generate([ep]);
      const corsCases = plan.cases.filter((c) => c.type === "cors_preflight");
      expect(corsCases).toHaveLength(0);
    });

    it("emits a counted-skip warning naming the endpoint id and token", () => {
      const gen = new TestPlanGenerator();
      const plan = gen.generate([ep]);
      const countedSkip = plan.warnings.find(
        (w) =>
          w.includes("ep.cors-skip") &&
          w.includes("cors_preflight") &&
          w.match(/skipped \d+ case\(s\)/),
      );
      expect(countedSkip).toBeDefined();
    });
  });

  /**
   * Case 6: skip_cases: ["cors_preflight:foo"] on endpoint → case PRESENT (non-field-carrier,
   * DD-12); dead-weight warning emitted.
   */
  describe("case 6 — skip_cases: ['cors_preflight:foo'] → field-qualifier no-match (DD-12)", () => {
    const ep = optionsWithCors("ep.cors-field-skip", {
      allow_origins: ["https://a.com"],
      allow_methods: ["GET"],
      allow_headers: [],
    }, {
      skip_cases: ["cors_preflight:origin"],  // field-qualifier on a non-field-carrier
    });

    it("cors_preflight case is still present when field-qualifier token is used", () => {
      const gen = new TestPlanGenerator();
      const plan = gen.generate([ep]);
      const corsCases = plan.cases.filter((c) => c.type === "cors_preflight");
      expect(corsCases).toHaveLength(1);
    });

    it("emits a dead-weight warning for the unmatched field-qualifier token", () => {
      const gen = new TestPlanGenerator();
      const plan = gen.generate([ep]);
      const deadWeight = plan.warnings.find(
        (w) =>
          w.includes("ep.cors-field-skip") &&
          (w.includes("cors_preflight:origin") || w.includes("matched zero")),
      );
      expect(deadWeight).toBeDefined();
    });
  });

  /**
   * Case 7: skipGlobally: ["cors_preflight"] across two OPTIONS endpoints → all absent.
   */
  describe("case 7 — skipGlobally: ['cors_preflight'] across two OPTIONS endpoints", () => {
    const endpoints: CanonicalEndpoint[] = [
      optionsWithCors("ep.cors-global-1", {
        allow_origins: ["https://a.com"],
        allow_methods: ["GET"],
        allow_headers: [],
      }),
      optionsWithCors("ep.cors-global-2", {
        allow_origins: ["https://b.com"],
        allow_methods: ["POST"],
        allow_headers: ["Authorization"],
      }),
    ];

    it("removes cors_preflight from all OPTIONS endpoints when skipGlobally applied", () => {
      const gen = new TestPlanGenerator({ skipGlobally: ["cors_preflight"] });
      const plan = gen.generate(endpoints);
      const corsCases = plan.cases.filter((c) => c.type === "cors_preflight");
      expect(corsCases).toHaveLength(0);
    });

    it("emits a global skip warning naming the 'cors_preflight' token", () => {
      const gen = new TestPlanGenerator({ skipGlobally: ["cors_preflight"] });
      const plan = gen.generate(endpoints);
      const globalSkipWarning = plan.warnings.find(
        (w) =>
          w.includes("cors_preflight") &&
          w.toLowerCase().includes("skip_globally"),
      );
      expect(globalSkipWarning).toBeDefined();
    });

    it("global skip warning references at least 2 endpoints being affected", () => {
      const gen = new TestPlanGenerator({ skipGlobally: ["cors_preflight"] });
      const plan = gen.generate(endpoints);
      const globalWarning = plan.warnings.find(
        (w) => w.includes("cors_preflight") && w.match(/\d+ endpoint\(s\)/),
      );
      if (globalWarning) {
        const match = /(\d+) endpoint\(s\)/.exec(globalWarning);
        const epCount = parseInt(match?.[1] ?? "0", 10);
        expect(epCount).toBe(2);
      } else {
        expect(globalWarning).toBeDefined();
      }
    });
  });

  /**
   * Case 8: Non-OPTIONS methods with cors → no cors_preflight case (silent, DD-1).
   */
  describe("case 8 — non-OPTIONS methods with cors → silent no-op (DD-1)", () => {
    const nonOptionsMethods: CanonicalEndpoint["method"][] = ["GET", "POST", "PUT"];

    for (const method of nonOptionsMethods) {
      it(`no cors_preflight case for ${method} endpoint with cors declared (silent, DD-1)`, () => {
        const ep: CanonicalEndpoint = {
          id: `ep.${method.toLowerCase()}-cors`,
          name: `${method} with cors`,
          method,
          url: `/api/ep`,
          request: {},
          response: { expected_status: 200, schema: {} },
        };
        (ep as Record<string, unknown>)["cors"] = {
          allow_origins: ["https://a.com"],
          allow_methods: ["GET"],
          allow_headers: [],
        };
        const gen = new TestPlanGenerator();
        const plan = gen.generate([ep]);
        const corsCases = plan.cases.filter((c) => c.type === "cors_preflight");
        expect(corsCases).toHaveLength(0);
      });

      it(`no warning emitted for ${method} endpoint with cors declared (DD-1 silent)`, () => {
        const ep: CanonicalEndpoint = {
          id: `ep.${method.toLowerCase()}-cors-warn`,
          name: `${method} with cors`,
          method,
          url: `/api/ep`,
          request: {},
          response: { expected_status: 200, schema: {} },
        };
        (ep as Record<string, unknown>)["cors"] = {
          allow_origins: ["https://a.com"],
          allow_methods: ["GET"],
          allow_headers: [],
        };
        const gen = new TestPlanGenerator();
        const plan = gen.generate([ep]);
        const corsWarnings = plan.warnings.filter((w) => w.includes("cors_preflight"));
        expect(corsWarnings).toHaveLength(0);
      });
    }
  });

  /**
   * Case 9: Mixed plan — body-negative cases and cors_preflight coexist without interference.
   */
  describe("case 9 — mixed plan: body-negative + cors_preflight coexist", () => {
    const optionsEp = optionsWithCors("ep.cors-mixed", {
      allow_origins: ["https://a.com"],
      allow_methods: ["GET"],
      allow_headers: [],
    });
    const postEp = postEndpointWithBodySchema("ep.post-body");

    it("cors_preflight case is present for the OPTIONS endpoint", () => {
      const gen = new TestPlanGenerator();
      const plan = gen.generate([optionsEp, postEp]);
      const corsCases = plan.cases.filter(
        (c) => c.type === "cors_preflight" && c.endpoint_id === "ep.cors-mixed",
      );
      expect(corsCases).toHaveLength(1);
    });

    it("body-negative cases are present for the POST endpoint", () => {
      const gen = new TestPlanGenerator();
      const plan = gen.generate([optionsEp, postEp]);
      const bodyNegCases = plan.cases.filter(
        (c) =>
          (c.type === "malformed_json_returns_400" ||
           c.type === "required_field_omission_returns_400") &&
          c.endpoint_id === "ep.post-body",
      );
      expect(bodyNegCases.length).toBeGreaterThan(0);
    });

    it("cors_preflight cases do NOT appear on the POST endpoint", () => {
      const gen = new TestPlanGenerator();
      const plan = gen.generate([optionsEp, postEp]);
      const corsCasesOnPost = plan.cases.filter(
        (c) => c.type === "cors_preflight" && c.endpoint_id === "ep.post-body",
      );
      expect(corsCasesOnPost).toHaveLength(0);
    });
  });

  /**
   * Case 10: ALL_SKIPPABLE_KINDS.size === 21 (DD-12).
   */
  describe("case 10 — ALL_SKIPPABLE_KINDS has exactly 21 entries", () => {
    it("ALL_SKIPPABLE_KINDS.size === 21 after cors_preflight added", () => {
      expect(ALL_SKIPPABLE_KINDS.size).toBe(21);
    });

    it("ALL_SKIPPABLE_KINDS contains 'cors_preflight'", () => {
      expect(ALL_SKIPPABLE_KINDS.has("cors_preflight")).toBe(true);
    });
  });
});
