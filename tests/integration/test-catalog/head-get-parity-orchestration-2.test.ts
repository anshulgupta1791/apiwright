/**
 * Integration tests for head_get_parity wired into TestPlanGenerator — part 2.
 *
 * Covers orchestration tests 8–12 and additional edge cases:
 *   - URL mismatch (not a resolver drop — URL is copied verbatim)
 *   - HEAD self-reference (method-mismatch branch at resolver)
 *   - Two HEADs → same GET (each HEAD gets its own case)
 *   - Order independence (GET declared after HEAD still resolves)
 *   - Backward compat (endpoint without pair_with unchanged)
 *   - Resolver runs after skip filter (ordering DD-5)
 *   - Template URL copied verbatim (DD-1)
 *
 * Pins the following design decisions (v1.0.2-pr3-head-get-parity.md):
 *   DD-1  paired_get_url is the RAW template verbatim — ${env.api_base}/users/{id}
 *         is preserved unchanged; runner resolves at request time.
 *   DD-5  Resolver runs AFTER skip filter; bogus pair_with on skipped case → no warning.
 *   DD-6  HEAD self-reference fails the method check (HEAD ≠ GET); no special case.
 *   DD-7  Multiple HEAD endpoints → same GET: each HEAD gets its own case (no dedup).
 *   DD-10 Order independence: resolver builds full endpoint index before iterating.
 *
 * Part 1 (tests 1–7) lives in head-get-parity-orchestration.test.ts.
 *
 * Category: Integration — orchestration tests 8–12 + extras.
 * Expected initial failure: TestPlanGenerator returns zero head_get_parity cases.
 */

import { describe, it, expect } from "vitest";

import { TestPlanGenerator } from "../../../src/test-catalog/test-plan-generator.js";
import type { CanonicalEndpoint } from "../../../src/core/canonical-model.js";
import type { HeadGetParityParams } from "../../../src/test-catalog/test-case-params.js";

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

function headEndpoint(id: string, overrides: Partial<CanonicalEndpoint> = {}): CanonicalEndpoint {
  return {
    id,
    name: `HEAD ${id}`,
    method: "HEAD",
    url: `/api/${id}`,
    request: {},
    response: { expected_status: 200, schema: {} },
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

// ---------------------------------------------------------------------------
// Tests (8–12 + extras)
// ---------------------------------------------------------------------------

describe("head_get_parity — TestPlanGenerator orchestration (part 2)", () => {

  /**
   * Test 8: pair_with targets GET with a different URL.
   * URL mismatch IS a drop condition (spec ambiguity resolution, v1.0.2 PR #3):
   * the parity check is meaningless if HEAD and GET point at different URLs.
   * The resolver checks: (1) unresolved id; (2) method !== "GET"; (3) URL mismatch.
   *
   * Warning template:
   *   "Endpoint '<head_id>': pair_with target '<id>' URL '<get_url>' does not
   *    match HEAD URL '<head_url>'; head_get_parity case dropped."
   */
  describe("case 8 — pair_with targets GET with different URL (URL mismatch → drop)", () => {
    const endpoints: CanonicalEndpoint[] = [
      headEndpoint("users.head", {
        url: "/api/users",
        pair_with: "users.list",
      }),
      getEndpoint("users.list", { url: "/api/users/list" }),
    ];

    it("drops the case when HEAD url and GET url differ (URL mismatch is a drop condition)", () => {
      const gen = new TestPlanGenerator();
      const plan = gen.generate(endpoints);
      const parityCases = plan.cases.filter((c) => c.type === "head_get_parity");
      expect(parityCases).toHaveLength(0);
    });

    it("emits URL-mismatch warning naming HEAD id, GET id, GET url, and HEAD url", () => {
      const gen = new TestPlanGenerator();
      const plan = gen.generate(endpoints);
      const warning = plan.warnings.find(
        (w) =>
          w.includes("users.head") &&
          w.includes("users.list") &&
          w.includes("/api/users/list") &&
          w.includes("/api/users") &&
          (w.includes("does not match") || w.includes("URL") || w.includes("mismatch")),
      );
      expect(warning).toBeDefined();
    });
  });

  /**
   * Test 9: HEAD self-reference → method-mismatch warning (HEAD ≠ GET).
   * DD-6: the resolver finds the endpoint, checks method === "GET" → fails.
   */
  describe("case 9 — HEAD self-reference via pair_with → method-mismatch at resolver", () => {
    it("emits zero cases for HEAD endpoint pointing pair_with at its own id", () => {
      const ep = headEndpoint("users.head", { pair_with: "users.head" });
      const gen = new TestPlanGenerator();
      const plan = gen.generate([ep]);
      const parityCases = plan.cases.filter((c) => c.type === "head_get_parity");
      expect(parityCases).toHaveLength(0);
    });

    it("emits method-mismatch warning containing 'HEAD' and 'GET' for self-reference", () => {
      const ep = headEndpoint("users.head", { pair_with: "users.head" });
      const gen = new TestPlanGenerator();
      const plan = gen.generate([ep]);
      const warning = plan.warnings.find(
        (w) =>
          w.includes("users.head") &&
          w.includes("HEAD") &&
          w.includes("GET"),
      );
      expect(warning).toBeDefined();
    });
  });

  /**
   * Test 10: Two HEAD endpoints → same GET → each HEAD gets its own case (DD-7).
   */
  describe("case 10 — two HEAD endpoints pointing at same GET", () => {
    const endpoints: CanonicalEndpoint[] = [
      headEndpoint("admin.head", { url: "/api/users", pair_with: "users.list" }),
      headEndpoint("user.head", { url: "/api/users", pair_with: "users.list" }),
      getEndpoint("users.list", { url: "/api/users" }),
    ];

    it("produces two head_get_parity cases — one per HEAD endpoint", () => {
      const gen = new TestPlanGenerator();
      const plan = gen.generate(endpoints);
      const parityCases = plan.cases.filter((c) => c.type === "head_get_parity");
      expect(parityCases).toHaveLength(2);
    });

    it("the two cases are owned by different HEAD endpoint ids", () => {
      const gen = new TestPlanGenerator();
      const plan = gen.generate(endpoints);
      const parityCases = plan.cases.filter((c) => c.type === "head_get_parity");
      const ownerIds = new Set(parityCases.map((c) => c.endpoint_id));
      expect(ownerIds.has("admin.head")).toBe(true);
      expect(ownerIds.has("user.head")).toBe(true);
    });

    it("both cases have paired_get_url === GET endpoint's url", () => {
      const gen = new TestPlanGenerator();
      const plan = gen.generate(endpoints);
      const parityCases = plan.cases.filter((c) => c.type === "head_get_parity");
      for (const c of parityCases) {
        const params = c.params as HeadGetParityParams;
        expect(params.paired_get_url).toBe("/api/users");
      }
    });
  });

  /**
   * Test 11: GET declared after HEAD in the array → still resolves (DD-10).
   */
  describe("case 11 — order independence: GET declared after HEAD still resolves", () => {
    it("resolves correctly when GET appears after HEAD in endpoint array", () => {
      const endpoints: CanonicalEndpoint[] = [
        headEndpoint("users.head", { url: "/api/users", pair_with: "users.list" }),
        getEndpoint("users.list", { url: "/api/users" }),
      ];
      const gen = new TestPlanGenerator();
      const plan = gen.generate(endpoints);
      const parityCase = plan.cases.find((c) => c.type === "head_get_parity");
      expect(parityCase).toBeDefined();
      const params = parityCase!.params as HeadGetParityParams;
      expect(params.paired_get_url).toBe("/api/users");
    });
  });

  /**
   * Test 12: Backward compat — endpoint without pair_with behaves identically to v1.0.1.
   */
  describe("case 12 — backward compat: endpoints without pair_with unchanged", () => {
    it("GET endpoint without pair_with produces no head_get_parity case", () => {
      const ep = getEndpoint("users.list");
      const gen = new TestPlanGenerator();
      const plan = gen.generate([ep]);
      const parityCases = plan.cases.filter((c) => c.type === "head_get_parity");
      expect(parityCases).toHaveLength(0);
    });

    it("GET endpoint without pair_with still produces get_idempotency (no regression)", () => {
      const ep = getEndpoint("users.list");
      const gen = new TestPlanGenerator();
      const plan = gen.generate([ep]);
      const getCases = plan.cases.filter((c) => c.type === "get_idempotency");
      expect(getCases).toHaveLength(1);
    });

    it("HEAD endpoint without pair_with produces no head_get_parity case and no parity warning", () => {
      const ep = headEndpoint("users.head");
      const gen = new TestPlanGenerator();
      const plan = gen.generate([ep]);
      const parityCases = plan.cases.filter((c) => c.type === "head_get_parity");
      expect(parityCases).toHaveLength(0);
      const hasParityWarning = plan.warnings.some(
        (w) => w.includes("head_get_parity"),
      );
      expect(hasParityWarning).toBe(false);
    });
  });

  /**
   * Resolver ordering (DD-5): skip filter runs BEFORE pair resolution.
   * A HEAD skipping head_get_parity with a bogus pair_with → NO unresolved warning.
   */
  describe("resolver ordering: skip filter before pair resolution (DD-5)", () => {
    it("does not emit unresolved-pair warning when the head_get_parity case is skipped", () => {
      const ep = headEndpoint("users.head", {
        pair_with: "totally-bogus-id",
        skip_cases: ["head_get_parity"],
      });
      const gen = new TestPlanGenerator();
      const plan = gen.generate([ep]);
      const unresolvedWarning = plan.warnings.find(
        (w) => w.includes("totally-bogus-id") && w.includes("unresolved"),
      );
      expect(unresolvedWarning).toBeUndefined();
    });
  });

  /**
   * Template URL is copied verbatim (DD-1).
   * The runner applies ${env.*} resolution at request time.
   */
  describe("template-bearing URL copied verbatim by resolver (DD-1)", () => {
    it("preserves ${env.api_base}/users/{id} template in paired_get_url unchanged", () => {
      const rawUrl = "${env.api_base}/users/{id}";
      const endpoints: CanonicalEndpoint[] = [
        headEndpoint("users.head", { url: rawUrl, pair_with: "users.get" }),
        getEndpoint("users.get", { url: rawUrl }),
      ];
      const gen = new TestPlanGenerator();
      const plan = gen.generate(endpoints);
      const parityCase = plan.cases.find((c) => c.type === "head_get_parity");
      const params = parityCase!.params as HeadGetParityParams;
      expect(params.paired_get_url).toBe(rawUrl);
    });
  });
});
