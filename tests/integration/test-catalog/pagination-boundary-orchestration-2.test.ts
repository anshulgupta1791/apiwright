/**
 * Integration tests for pagination_boundary wired into TestPlanGenerator — PART 2.
 * Covers orchestration scenarios 9–12 from the task outline.
 *
 * Pins the following design decisions (v1.0.2-pr5-pagination-boundary.md):
 *   DD-5  Non-GET + pagination → silent no-op (0 cases, 0 warnings).
 *   DD-7  Two plan-warning conditions: missing page_param; max_size < default_size.
 *
 * Scenarios in this file (9-12):
 *   9.   Mixed plan: 3 endpoints with different styles → correct case counts
 *   10.  Backward compat: endpoint without pagination → identical to v1.0.1
 *   11.  Page-style + missing page_param → 3 cases + plan warning (exact DD-7)
 *   12.  max_size < default_size → 0 cases + plan warning (exact DD-7)
 *
 * See pagination-boundary-orchestration.test.ts for scenarios 1-8.
 *
 * Category: Integration (orchestration — real TestPlanGenerator).
 * Expected initial failure: TestPlanGenerator returns zero pagination_boundary cases.
 */

import { describe, it, expect } from "vitest";

import { TestPlanGenerator } from "../../../src/test-catalog/test-plan-generator.js";
import type { CanonicalEndpoint } from "../../../src/core/canonical-model.js";

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

function getWithPage(id: string, overrides: Partial<CanonicalEndpoint> = {}): CanonicalEndpoint {
  return {
    id, name: `GET ${id}`, method: "GET", url: `/api/${id}`,
    request: {}, response: { expected_status: 200, schema: {} },
    pagination: { style: "page", size_param: "size", page_param: "page",
      default_size: 20, max_size: 100 },
    ...overrides,
  };
}

function getWithOffset(id: string): CanonicalEndpoint {
  return {
    id, name: `GET ${id}`, method: "GET", url: `/api/${id}`,
    request: {}, response: { expected_status: 200, schema: {} },
    pagination: { style: "offset", size_param: "limit", default_size: 10, max_size: 50 },
  };
}

function getWithCursor(id: string): CanonicalEndpoint {
  return {
    id, name: `GET ${id}`, method: "GET", url: `/api/${id}`,
    request: {}, response: { expected_status: 200, schema: {} },
    pagination: { style: "cursor", size_param: "limit", default_size: 25, max_size: 100 },
  };
}

function plainGet(id: string): CanonicalEndpoint {
  return {
    id, name: `GET ${id}`, method: "GET", url: `/api/${id}`,
    request: {}, response: { expected_status: 200, schema: {} },
  };
}

function postWithPagination(id: string): CanonicalEndpoint {
  return {
    id, name: `POST ${id}`, method: "POST", url: `/api/${id}`,
    request: {}, response: { expected_status: 201, schema: {} },
    pagination: { style: "page", size_param: "size", page_param: "page",
      default_size: 20, max_size: 100 },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("pagination_boundary — TestPlanGenerator orchestration (part 2, cases 9-12)", () => {

  describe("case 9 — mixed plan: 3 styles → correct per-endpoint case counts", () => {
    const endpoints = [getWithPage("page.list"), getWithOffset("offset.list"), getWithCursor("cursor.list")];

    it("total pagination_boundary cases = 4 + 3 + 2 = 9", () => {
      const plan = new TestPlanGenerator().generate(endpoints);
      expect(plan.cases.filter((c) => c.type === "pagination_boundary")).toHaveLength(9);
    });

    it("page endpoint contributes exactly 4 pagination_boundary cases", () => {
      const plan = new TestPlanGenerator().generate(endpoints);
      expect(
        plan.cases.filter((c) => c.type === "pagination_boundary" && c.endpoint_id === "page.list"),
      ).toHaveLength(4);
    });

    it("offset endpoint contributes exactly 3 pagination_boundary cases", () => {
      const plan = new TestPlanGenerator().generate(endpoints);
      expect(
        plan.cases.filter((c) => c.type === "pagination_boundary" && c.endpoint_id === "offset.list"),
      ).toHaveLength(3);
    });

    it("cursor endpoint contributes exactly 2 pagination_boundary cases", () => {
      const plan = new TestPlanGenerator().generate(endpoints);
      expect(
        plan.cases.filter((c) => c.type === "pagination_boundary" && c.endpoint_id === "cursor.list"),
      ).toHaveLength(2);
    });
  });

  describe("case 10 — backward compat: endpoint without pagination field", () => {
    it("produces zero pagination_boundary cases for endpoint without pagination", () => {
      const plan = new TestPlanGenerator().generate([plainGet("legacy.list")]);
      expect(plan.cases.filter((c) => c.type === "pagination_boundary")).toHaveLength(0);
    });

    it("still produces get_idempotency case (not contaminated by PR #5)", () => {
      const plan = new TestPlanGenerator().generate([plainGet("legacy.list")]);
      expect(plan.cases.filter((c) => c.type === "get_idempotency")).toHaveLength(1);
    });

    it("emits no pagination_boundary-related warnings for legacy endpoint", () => {
      const plan = new TestPlanGenerator().generate([plainGet("legacy.list")]);
      expect(plan.warnings.filter((w) => w.includes("pagination_boundary"))).toHaveLength(0);
    });
  });

  describe("case 10b — POST with pagination → 0 cases, 0 warnings (DD-5, silent)", () => {
    it("emits 0 pagination_boundary cases for POST with pagination declared", () => {
      const plan = new TestPlanGenerator().generate([postWithPagination("items.create")]);
      expect(plan.cases.filter((c) => c.type === "pagination_boundary")).toHaveLength(0);
    });

    it("emits 0 pagination_boundary warnings for POST with pagination declared", () => {
      const plan = new TestPlanGenerator().generate([postWithPagination("items.create")]);
      expect(plan.warnings.filter((w) => w.includes("pagination_boundary"))).toHaveLength(0);
    });
  });

  describe("case 11 — page-style + missing page_param → 3 cases + exact DD-7 warning", () => {
    const ep: CanonicalEndpoint = {
      id: "ep.nopage", name: "GET without page_param", method: "GET", url: "/api/items",
      request: {}, response: { expected_status: 200, schema: {} },
      pagination: { style: "page", size_param: "size", default_size: 20, max_size: 100 },
    };

    it("produces exactly 3 pagination_boundary cases (page_negative omitted)", () => {
      const plan = new TestPlanGenerator().generate([ep]);
      expect(plan.cases.filter((c) => c.type === "pagination_boundary")).toHaveLength(3);
    });

    it("emits exactly 1 plan warning with the exact DD-7 template string", () => {
      const plan = new TestPlanGenerator().generate([ep]);
      const warns = plan.warnings.filter(
        (w) => w.includes("ep.nopage") && w.includes("pagination_boundary"),
      );
      expect(warns).toHaveLength(1);
      expect(warns[0]).toBe(
        "Endpoint 'ep.nopage': pagination_boundary — style 'page' declared without page_param; page_negative probe omitted.",
      );
    });
  });

  describe("case 12 — max_size < default_size → 0 cases + exact DD-7 warning", () => {
    const ep: CanonicalEndpoint = {
      id: "ep.badsize", name: "GET with bad size config", method: "GET", url: "/api/items",
      request: {}, response: { expected_status: 200, schema: {} },
      pagination: { style: "page", size_param: "size", page_param: "page",
        default_size: 10, max_size: 5 },
    };

    it("produces zero pagination_boundary cases when max_size < default_size", () => {
      const plan = new TestPlanGenerator().generate([ep]);
      expect(plan.cases.filter((c) => c.type === "pagination_boundary")).toHaveLength(0);
    });

    it("emits exactly 1 plan warning with the exact DD-7 template string", () => {
      const plan = new TestPlanGenerator().generate([ep]);
      const warns = plan.warnings.filter(
        (w) => w.includes("ep.badsize") && w.includes("pagination_boundary"),
      );
      expect(warns).toHaveLength(1);
      expect(warns[0]).toBe(
        "Endpoint 'ep.badsize': pagination_boundary — max_size (5) is less than default_size (10); all probes omitted.",
      );
    });

    it("still produces other GET cases (get_idempotency) despite pagination warning", () => {
      const plan = new TestPlanGenerator().generate([ep]);
      expect(
        plan.cases.filter((c) => c.type === "get_idempotency" && c.endpoint_id === "ep.badsize"),
      ).toHaveLength(1);
    });
  });

  describe("determinism guard", () => {
    it("produces byte-identical pagination_boundary case ids on two generate() calls", () => {
      const endpoints = [getWithPage("a.list"), getWithOffset("b.list"), getWithCursor("c.list")];
      const gen1 = new TestPlanGenerator();
      const gen2 = new TestPlanGenerator();
      const ids1 = gen1.generate(endpoints).cases
        .filter((c) => c.type === "pagination_boundary").map((c) => c.id).join(",");
      const ids2 = gen2.generate(endpoints).cases
        .filter((c) => c.type === "pagination_boundary").map((c) => c.id).join(",");
      expect(ids1).toBe(ids2);
    });
  });
});
