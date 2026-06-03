/**
 * Integration tests for skip_cases / skip_globally in TestPlanGenerator.
 * Covers integration test cases 1–5 from the solution design.
 * Cases 6–10 are in test-plan-skip-cases-2.integration.test.ts.
 *
 * Uses the REAL TestPlanGenerator with fixture endpoints — no collaborator mocks.
 *
 * Design decisions pinned:
 *   DD-1  Malformed tokens warn but never throw.
 *   DD-2  validateSkipTokens runs after generation per-endpoint.
 *   DD-5  (kind, field) is sufficient as case identity.
 *   DD-8  Zero-match warning emitted per token that parsed+kind-known but matched nothing.
 *   DD-9  Kind matching is case-SENSITIVE.
 */

import { describe, it, expect } from "vitest";

import { SkipResolver } from "../../../src/test-catalog/skip-resolver.js";
import { TestPlanGenerator } from "../../../src/test-catalog/test-plan-generator.js";
import type { CanonicalEndpoint } from "../../../src/core/canonical-model.js";

// ---------------------------------------------------------------------------
// Fixture endpoints
// ---------------------------------------------------------------------------

const authenticatedPost: CanonicalEndpoint = {
  id: "products.create",
  name: "Create Product",
  method: "POST",
  url: "/api/v1/products",
  auth_strategy: "user_token",
  request: {
    body_schema: {
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string", minLength: 1, maxLength: 100 },
        tags: { type: "string" },
        price: { type: "number", minimum: 0, maximum: 9999 },
      },
    },
    body_example: { name: "Widget", tags: "electronics", price: 9.99 },
  },
  response: { expected_status: 201, schema: { type: "object" } },
};

const authGet1: CanonicalEndpoint = {
  id: "items.list",
  name: "List Items",
  method: "GET",
  url: "/api/v1/items",
  auth_strategy: "user_token",
  request: {},
  response: { expected_status: 200, schema: { type: "object" } },
};

const authGet2: CanonicalEndpoint = {
  id: "orders.list",
  name: "List Orders",
  method: "GET",
  url: "/api/v1/orders",
  auth_strategy: "user_token",
  request: {},
  response: { expected_status: 200, schema: { type: "object" } },
};

const authGet3: CanonicalEndpoint = {
  id: "users.list",
  name: "List Users",
  method: "GET",
  url: "/api/v1/users",
  auth_strategy: "user_token",
  request: {},
  response: { expected_status: 200, schema: { type: "object" } },
};

const getEndpointA: CanonicalEndpoint = {
  id: "feeds.list",
  name: "List Feeds",
  method: "POST",
  url: "/api/v1/feeds",
  request: {
    body_schema: {
      type: "object",
      properties: { query: { type: "string" } },
    },
  },
  response: { expected_status: 200, schema: { type: "object" } },
};

const getEndpointB: CanonicalEndpoint = {
  id: "events.list",
  name: "List Events",
  method: "POST",
  url: "/api/v1/events",
  request: {
    body_schema: {
      type: "object",
      properties: { filter: { type: "string" } },
    },
  },
  response: { expected_status: 200, schema: { type: "object" } },
};

const plainGet: CanonicalEndpoint = {
  id: "health.check",
  name: "Health Check",
  method: "GET",
  url: "/api/v1/health",
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
// Tests — cases 1–5
// ---------------------------------------------------------------------------

describe("TestPlanGenerator — skip_cases / skip_globally (cases 1–5)", () => {
  /**
   * Test 1: Endpoint-level skip of a whole kind drops all cases of that kind.
   */
  it("endpoint skip_cases ['type_violation_returns_400'] drops all violation cases; others survive", () => {
    const gen = new TestPlanGenerator();
    const endpointWithSkip = {
      ...authenticatedPost,
      skip_cases: ["type_violation_returns_400"],
    } as unknown as CanonicalEndpoint;

    const plan = gen.generate([endpointWithSkip]);

    expect(countByKind(plan, authenticatedPost.id, "type_violation_returns_400")).toBe(0);
    expect(countByKind(plan, authenticatedPost.id, "status_code_conformance")).toBeGreaterThan(0);
    expect(countByKind(plan, authenticatedPost.id, "malformed_json_returns_400")).toBeGreaterThan(0);
  });

  /**
   * Test 2: Field-scoped skip drops only the specific field's case.
   */
  it("endpoint skip_cases ['type_violation_returns_400:tags'] drops only the tags violation", () => {
    const gen = new TestPlanGenerator();
    const endpointWithSkip = {
      ...authenticatedPost,
      skip_cases: ["type_violation_returns_400:tags"],
    } as unknown as CanonicalEndpoint;

    const plan = gen.generate([endpointWithSkip]);

    const violations = plan.cases.filter(
      (c) => c.endpoint_id === authenticatedPost.id && c.type === "type_violation_returns_400",
    );
    const hasTagsViolation = violations.some(
      (c) => (c.params as { field?: string }).field === "tags",
    );
    expect(hasTagsViolation).toBe(false);

    const hasNameViolation = violations.some(
      (c) => (c.params as { field?: string }).field === "name",
    );
    expect(hasNameViolation).toBe(true);
  });

  /**
   * Test 3: Global skip removes no_auth_returns_401 from all 3 auth endpoints.
   */
  it("global skip_globally ['no_auth_returns_401'] removes that case from all 3 auth endpoints", () => {
    const genBaseline = new TestPlanGenerator();
    const planBaseline = genBaseline.generate([authGet1, authGet2, authGet3]);
    expect(countByKind(planBaseline, authGet1.id, "no_auth_returns_401")).toBeGreaterThan(0);

    const genWithSkip = new TestPlanGenerator({
      skipResolver: new SkipResolver(),
      skipGlobally: ["no_auth_returns_401"],
    });
    const planWithSkip = genWithSkip.generate([authGet1, authGet2, authGet3]);
    expect(countByKind(planWithSkip, authGet1.id, "no_auth_returns_401")).toBe(0);
    expect(countByKind(planWithSkip, authGet2.id, "no_auth_returns_401")).toBe(0);
    expect(countByKind(planWithSkip, authGet3.id, "no_auth_returns_401")).toBe(0);
  });

  /**
   * Test 4: UNION semantics — global skip applies to endpoint B even when A
   * also has a local skip for the same kind.
   */
  it("global skip applies to endpoint B even when endpoint A also lists the token locally", () => {
    const epA = {
      ...getEndpointA,
      skip_cases: ["malformed_json_returns_400"],
    } as unknown as CanonicalEndpoint;

    const gen = new TestPlanGenerator({
      skipResolver: new SkipResolver(),
      skipGlobally: ["malformed_json_returns_400"],
    });
    const plan = gen.generate([epA, getEndpointB]);

    expect(countByKind(plan, getEndpointA.id, "malformed_json_returns_400")).toBe(0);
    expect(countByKind(plan, getEndpointB.id, "malformed_json_returns_400")).toBe(0);
  });

  /**
   * Test 5: Malformed token in skip_cases generates plan normally; warning cites reason.
   */
  it("malformed token ':foo' in skip_cases generates plan normally; warning cites 'leading_colon'", () => {
    const gen = new TestPlanGenerator();
    const endpointWithBadToken = {
      ...plainGet,
      skip_cases: [":foo"],
    } as unknown as CanonicalEndpoint;

    const plan = gen.generate([endpointWithBadToken]);

    expect(plan.cases.filter((c) => c.endpoint_id === plainGet.id).length).toBeGreaterThan(0);
    const hasWarning = plan.warnings.some(
      (w) => w.includes(":foo") && w.includes("leading_colon"),
    );
    expect(hasWarning).toBe(true);
  });

  /**
   * Coverage helper — global dead-weight warning: skip_globally token that matches
   * zero cases across the plan emits a "matched zero generated cases across the plan"
   * warning (DD-8, global scope). Uses delete_idempotency on a GET endpoint since
   * that kind never fires on GET.
   */
  it("global skip_globally dead-weight: valid token matching zero cases emits zero-match warning", () => {
    const gen = new TestPlanGenerator({
      skipResolver: new SkipResolver(),
      skipGlobally: ["delete_idempotency"],
    });
    const plan = gen.generate([plainGet]);

    const hasGlobalDeadWeight = plan.warnings.some(
      (w) => w.includes("skip_globally") && w.includes("delete_idempotency") &&
        (w.includes("matched zero") || w.includes("zero generated")),
    );
    expect(hasGlobalDeadWeight).toBe(true);
  });

  /**
   * Coverage helper — extractFieldFromCase fallback: a kind:field token for a
   * non-field-carrier kind never matches (field is always undefined for those kinds).
   * Uses get_idempotency:some_field against a get_idempotency case.
   */
  it("kind:field token for non-field-carrier kind never matches (extractFieldFromCase fallback)", () => {
    const gen = new TestPlanGenerator();

    // plainGet generates get_idempotency cases (smoke marker, GET method)
    const plan = gen.generate([plainGet]);
    const hasIdempotency = plan.cases.some((c) => c.type === "get_idempotency");
    expect(hasIdempotency).toBe(true);

    // Now test that a kind:field token for get_idempotency never matches
    const genWithSkip = new TestPlanGenerator({
      skipResolver: new SkipResolver(),
    });
    const endpointWithSkip = {
      ...plainGet,
      skip_cases: ["get_idempotency:some_field"],
    } as unknown as CanonicalEndpoint;
    const planWithSkip = genWithSkip.generate([endpointWithSkip]);

    // get_idempotency cases must survive since field never matches
    const hasIdempotencyAfterSkip = planWithSkip.cases.some((c) => c.type === "get_idempotency");
    expect(hasIdempotencyAfterSkip).toBe(true);
  });
});
