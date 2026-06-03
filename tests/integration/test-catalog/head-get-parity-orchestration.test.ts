/**
 * Integration tests for head_get_parity wired into TestPlanGenerator — part 1.
 *
 * Uses REAL TestPlanGenerator (no mocks) with inline fixture endpoints.
 * Covers orchestration tests 1–7 (generator wiring, resolver happy path,
 * skip tokens, unresolved/method-mismatch warnings).
 *
 * Pins the following design decisions (v1.0.2-pr3-head-get-parity.md):
 *   DD-1  paired_get_url is the RAW template verbatim from pairedEndpoint.url.
 *   DD-5  Resolver runs AFTER skip filtering; skipped HEAD → no "unresolved" warning.
 *   DD-6  Self-reference caught by method check (HEAD ≠ GET) at resolver.
 *
 * Warning templates verified (locked in design §4):
 *   Unresolved pair: "Endpoint '<id>': head_get_parity — unresolved pair_with id '<id>'; case dropped."
 *   Wrong method:   "Endpoint '<id>': head_get_parity — pair_with target '<id>' has method <X>, expected GET; case dropped."
 *   URL mismatch is NOT a resolver drop condition per locked §4 algorithm — test 8
 *   is in head-get-parity-orchestration-2.test.ts and verifies the URL is copied.
 *
 * Part 2 (multi-HEAD, ordering, backward compat, template URL) lives in
 * head-get-parity-orchestration-2.test.ts to stay within the 300 LOC soft limit.
 *
 * Category: Integration — orchestration tests 1–7.
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
// Tests (1–7)
// ---------------------------------------------------------------------------

describe("head_get_parity — TestPlanGenerator orchestration (part 1)", () => {

  /**
   * Test 1: HEAD + matching GET → 1 resolved case; params.paired_get_url = GET's url.
   */
  describe("case 1 — HEAD + matching GET produces one resolved case", () => {
    const endpoints: CanonicalEndpoint[] = [
      headEndpoint("users.head", { url: "/api/users", pair_with: "users.list" }),
      getEndpoint("users.list", { url: "/api/users" }),
    ];

    it("produces exactly one head_get_parity case", () => {
      const gen = new TestPlanGenerator();
      const plan = gen.generate(endpoints);
      const parityCases = plan.cases.filter((c) => c.type === "head_get_parity");
      expect(parityCases).toHaveLength(1);
    });

    it("resolved case has paired_get_url === GET endpoint's url verbatim (DD-1)", () => {
      const gen = new TestPlanGenerator();
      const plan = gen.generate(endpoints);
      const parityCase = plan.cases.find((c) => c.type === "head_get_parity");
      expect(parityCase).toBeDefined();
      const params = parityCase!.params as HeadGetParityParams;
      expect(params.paired_get_url).toBe("/api/users");
    });

    it("resolved case has paired_get_endpoint_id === 'users.list'", () => {
      const gen = new TestPlanGenerator();
      const plan = gen.generate(endpoints);
      const parityCase = plan.cases.find((c) => c.type === "head_get_parity");
      const params = parityCase!.params as HeadGetParityParams;
      expect(params.paired_get_endpoint_id).toBe("users.list");
    });

    it("emits no unresolved-pair warning for a valid resolved pair", () => {
      const gen = new TestPlanGenerator();
      const plan = gen.generate(endpoints);
      const hasDropWarning = plan.warnings.some(
        (w) => w.includes("head_get_parity") && w.includes("case dropped"),
      );
      expect(hasDropWarning).toBe(false);
    });
  });

  /**
   * Test 2: skip_cases: ["head_get_parity"] on HEAD → suppressed; counted-skip warning.
   */
  describe("case 2 — per-endpoint skip_cases suppresses and emits counted-skip warning", () => {
    const endpoints: CanonicalEndpoint[] = [
      headEndpoint("users.head", {
        pair_with: "users.list",
        skip_cases: ["head_get_parity"],
      }),
      getEndpoint("users.list"),
    ];

    it("removes head_get_parity case from plan when skip_cases includes it", () => {
      const gen = new TestPlanGenerator();
      const plan = gen.generate(endpoints);
      const parityCases = plan.cases.filter((c) => c.type === "head_get_parity");
      expect(parityCases).toHaveLength(0);
    });

    it("emits counted-skip warning naming endpoint and token", () => {
      const gen = new TestPlanGenerator();
      const plan = gen.generate(endpoints);
      const countedSkip = plan.warnings.find(
        (w) =>
          w.includes("users.head") &&
          w.includes("head_get_parity") &&
          w.match(/skipped \d+ case\(s\)/),
      );
      expect(countedSkip).toBeDefined();
    });
  });

  /**
   * Test 3: skipGlobally: ["head_get_parity"] → suppressed across all HEAD endpoints.
   */
  describe("case 3 — skipGlobally suppresses across all HEAD endpoints", () => {
    const endpoints: CanonicalEndpoint[] = [
      headEndpoint("a.head", { pair_with: "a.list" }),
      headEndpoint("b.head", { pair_with: "b.list" }),
      getEndpoint("a.list"),
      getEndpoint("b.list"),
    ];

    it("removes all head_get_parity cases when skipGlobally includes it", () => {
      const gen = new TestPlanGenerator({ skipGlobally: ["head_get_parity"] });
      const plan = gen.generate(endpoints);
      const parityCases = plan.cases.filter((c) => c.type === "head_get_parity");
      expect(parityCases).toHaveLength(0);
    });

    it("emits a global-skip warning naming the token and 'skip_globally'", () => {
      const gen = new TestPlanGenerator({ skipGlobally: ["head_get_parity"] });
      const plan = gen.generate(endpoints);
      const globalWarning = plan.warnings.find(
        (w) =>
          w.includes("head_get_parity") &&
          w.toLowerCase().includes("skip_globally"),
      );
      expect(globalWarning).toBeDefined();
    });
  });

  /**
   * Test 4: skip_cases on a non-HEAD endpoint → dead-weight warning.
   */
  describe("case 4 — dead-weight skip token on GET endpoint", () => {
    const ep = getEndpoint("items.list", { skip_cases: ["head_get_parity"] });

    it("emits dead-weight warning when token matches zero cases on a GET endpoint", () => {
      const gen = new TestPlanGenerator();
      const plan = gen.generate([ep]);
      const deadWeightWarning = plan.warnings.find(
        (w) =>
          w.includes("items.list") &&
          w.includes("head_get_parity") &&
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
   * Test 5: Typo "head_get_partiy" → unknown-kind warning.
   */
  describe("case 5 — unknown-kind warning for typo in skip token", () => {
    it("emits unknown-kind warning for 'head_get_partiy' (typo)", () => {
      const ep = headEndpoint("users.head", {
        pair_with: "users.list",
        skip_cases: ["head_get_partiy"],
      });
      const gen = new TestPlanGenerator();
      const plan = gen.generate([ep, getEndpoint("users.list")]);
      const unknownKindWarning = plan.warnings.find(
        (w) => w.toLowerCase().includes("unknown") && w.includes("head_get_partiy"),
      );
      expect(unknownKindWarning).toBeDefined();
    });

    it("correct spelling 'head_get_parity' does NOT trigger unknown-kind warning", () => {
      const ep = headEndpoint("users.head", {
        pair_with: "users.list",
        skip_cases: ["head_get_parity"],
      });
      const gen = new TestPlanGenerator();
      const plan = gen.generate([ep, getEndpoint("users.list")]);
      const unknownKindWarning = plan.warnings.find(
        (w) => w.toLowerCase().includes("unknown") && w.includes("head_get_parity"),
      );
      expect(unknownKindWarning).toBeUndefined();
    });
  });

  /**
   * Test 6: Unresolved pair_with id → 0 cases + "unresolved" warning.
   */
  describe("case 6 — unresolved pair_with id drops case with warning", () => {
    it("emits zero head_get_parity cases when pair_with is unresolvable", () => {
      const ep = headEndpoint("users.head", { pair_with: "nonexistent.get" });
      const gen = new TestPlanGenerator();
      const plan = gen.generate([ep]);
      const parityCases = plan.cases.filter((c) => c.type === "head_get_parity");
      expect(parityCases).toHaveLength(0);
    });

    it("emits warning naming the HEAD endpoint id and the missing target id", () => {
      const ep = headEndpoint("users.head", { pair_with: "nonexistent.get" });
      const gen = new TestPlanGenerator();
      const plan = gen.generate([ep]);
      const warning = plan.warnings.find(
        (w) =>
          w.includes("users.head") &&
          w.includes("nonexistent.get") &&
          (w.includes("unresolved") || w.includes("not found")),
      );
      expect(warning).toBeDefined();
    });
  });

  /**
   * Test 7: pair_with targets POST → 0 cases + method-mismatch warning.
   */
  describe("case 7 — pair_with targets POST endpoint → method-mismatch warning", () => {
    const endpoints: CanonicalEndpoint[] = [
      headEndpoint("users.head", { pair_with: "users.create" }),
      postEndpoint("users.create"),
    ];

    it("emits zero head_get_parity cases when pair_with targets a POST endpoint", () => {
      const gen = new TestPlanGenerator();
      const plan = gen.generate(endpoints);
      const parityCases = plan.cases.filter((c) => c.type === "head_get_parity");
      expect(parityCases).toHaveLength(0);
    });

    it("emits method-mismatch warning containing 'POST' and 'GET'", () => {
      const gen = new TestPlanGenerator();
      const plan = gen.generate(endpoints);
      const warning = plan.warnings.find(
        (w) =>
          w.includes("users.head") &&
          w.includes("users.create") &&
          w.includes("POST") &&
          w.includes("GET"),
      );
      expect(warning).toBeDefined();
    });
  });
});
