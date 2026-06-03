/**
 * Unit tests for PaginationBoundaryGenerator — PART 1.
 * Covers tests 1–12 (page/offset/cursor styles, edge cases, warnings).
 *
 * Pins the following design decisions (v1.0.2-pr5-pagination-boundary.md):
 *   DD-4  Probe set varies by style: page=4, offset=3, cursor=2.
 *   DD-6  page=-1 expected status = 400.
 *   DD-7  Two plan-warning conditions: missing page_param; max_size < default_size.
 *   DD-8  default_size === max_size is VALID; all probes still emit.
 *
 * Covers tests 1–12 from the task outline (tests 13-15 in -2.test.ts).
 *
 * Category: Unit.
 * Expected initial failure: Cannot find module
 *   '../../../../src/test-catalog/generators/pagination-boundary-generator.js'
 */

import { describe, it, expect } from "vitest";

import { PaginationBoundaryGenerator } from "../../../../src/test-catalog/generators/pagination-boundary-generator.js";
import { MarkerClassifier } from "../../../../src/test-catalog/marker-classifier.js";
import { ProdSafetyClassifier } from "../../../../src/test-catalog/prod-safety-classifier.js";
import { TestCaseIdFactory } from "../../../../src/test-catalog/test-case-id.js";
import { SchemaWalker } from "../../../../src/test-catalog/schema-walker.js";
import type { CanonicalEndpoint } from "../../../../src/core/canonical-model.js";
import type { GenerationContext } from "../../../../src/test-catalog/types.js";
import type { PaginationBoundaryParams } from "../../../../src/test-catalog/test-case-params.js";

function makeCtx(): GenerationContext {
  return {
    ids: new TestCaseIdFactory(),
    markers: new MarkerClassifier(),
    prodSafety: new ProdSafetyClassifier(),
    walker: new SchemaWalker(),
  };
}

function makeGetWithPage(overrides: Partial<CanonicalEndpoint> = {}): CanonicalEndpoint {
  return {
    id: "users.list",
    name: "List Users",
    method: "GET",
    url: "/api/users",
    request: {},
    response: { expected_status: 200, schema: {} },
    pagination: { style: "page", size_param: "size", page_param: "page",
      default_size: 20, max_size: 100 },
    ...overrides,
  };
}

function makeGetWithOffset(): CanonicalEndpoint {
  return {
    id: "items.list", name: "List Items", method: "GET", url: "/api/items",
    request: {}, response: { expected_status: 200, schema: {} },
    pagination: { style: "offset", size_param: "limit", default_size: 10, max_size: 50 },
  };
}

function makeGetWithCursor(overrides: Partial<CanonicalEndpoint> = {}): CanonicalEndpoint {
  return {
    id: "posts.list", name: "List Posts", method: "GET", url: "/api/posts",
    request: {}, response: { expected_status: 200, schema: {} },
    pagination: { style: "cursor", size_param: "limit", default_size: 25, max_size: 100 },
    ...overrides,
  };
}

describe("PaginationBoundaryGenerator — part 1 (tests 1–12)", () => {

  describe("constructor", () => {
    it("constructs with no arguments", () => {
      expect(() => new PaginationBoundaryGenerator()).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // Tests 1-4: GET + page-style → 4 cases with correct probes + statuses
  // -------------------------------------------------------------------------

  describe("tests 1-4 — GET + page-style → 4 cases", () => {
    it("emits exactly 4 cases for page-style pagination", () => {
      const { cases } = new PaginationBoundaryGenerator().generate(makeGetWithPage(), makeCtx());
      expect(cases).toHaveLength(4);
    });

    it("probe order is: size_zero, size_max, size_max_plus_one, page_negative", () => {
      const { cases } = new PaginationBoundaryGenerator().generate(makeGetWithPage(), makeCtx());
      expect(cases.map((c) => (c.params as PaginationBoundaryParams).probe)).toEqual(
        ["size_zero", "size_max", "size_max_plus_one", "page_negative"],
      );
    });

    it("size_zero expected_status=400; size_max_plus_one=400; page_negative=400", () => {
      const { cases } = new PaginationBoundaryGenerator().generate(makeGetWithPage(), makeCtx());
      expect((cases[0]!.params as PaginationBoundaryParams).expected_status).toBe(400);
      expect((cases[2]!.params as PaginationBoundaryParams).expected_status).toBe(400);
      expect((cases[3]!.params as PaginationBoundaryParams).expected_status).toBe(400);
    });

    it("size_max probe carries endpoint.response.expected_status (200)", () => {
      const { cases } = new PaginationBoundaryGenerator().generate(makeGetWithPage(), makeCtx());
      expect((cases[1]!.params as PaginationBoundaryParams).expected_status).toBe(200);
    });

    it("size_max probe with endpoint expected_status 206 carries 206", () => {
      const ep = makeGetWithPage({ response: { expected_status: 206, schema: {} } });
      const { cases } = new PaginationBoundaryGenerator().generate(ep, makeCtx());
      expect((cases[1]!.params as PaginationBoundaryParams).expected_status).toBe(206);
    });

    it("all cases have kind='pagination_boundary', marker='regression', prod_safe=false", () => {
      const { cases } = new PaginationBoundaryGenerator().generate(makeGetWithPage(), makeCtx());
      for (const c of cases) {
        expect(c.params.kind).toBe("pagination_boundary");
        expect(c.marker).toBe("regression");
        expect(c.prod_safe).toBe(false);
      }
    });

    it("all cases echo pagination config (size_param, style, default_size, max_size, page_param)", () => {
      const { cases } = new PaginationBoundaryGenerator().generate(makeGetWithPage(), makeCtx());
      for (const c of cases) {
        const p = c.params as PaginationBoundaryParams;
        expect(p.size_param).toBe("size");
        expect(p.style).toBe("page");
        expect(p.default_size).toBe(20);
        expect(p.max_size).toBe(100);
        expect(p.page_param).toBe("page");
      }
    });

    it("case ids contain endpoint id, 'pagination-boundary' (hyphen per id factory), and ordinal 0-3", () => {
      const { cases } = new PaginationBoundaryGenerator().generate(makeGetWithPage(), makeCtx());
      for (const c of cases) {
        expect(c.id).toContain("users.list");
        // TestCaseIdFactory converts underscores to hyphens in the id
        expect(c.id).toContain("pagination-boundary");
        expect(c.endpoint_id).toBe("users.list");
      }
      expect(cases[0]!.id).toMatch(/\.0$/);
      expect(cases[3]!.id).toMatch(/\.3$/);
    });

    it("emits 0 warnings for a fully valid page-style endpoint", () => {
      const { warnings } = new PaginationBoundaryGenerator().generate(makeGetWithPage(), makeCtx());
      expect(warnings).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Tests 5-7: GET + offset-style → 3 cases
  // -------------------------------------------------------------------------

  describe("tests 5-7 — GET + offset-style → 3 cases (no page_negative)", () => {
    it("emits exactly 3 cases for offset-style", () => {
      const { cases } = new PaginationBoundaryGenerator().generate(makeGetWithOffset(), makeCtx());
      expect(cases).toHaveLength(3);
    });

    it("offset probes are size_zero, size_max, size_max_plus_one (no page_negative)", () => {
      const { cases } = new PaginationBoundaryGenerator().generate(makeGetWithOffset(), makeCtx());
      expect(cases.map((c) => (c.params as PaginationBoundaryParams).probe)).toEqual(
        ["size_zero", "size_max", "size_max_plus_one"],
      );
    });

    it("offset cases have no page_param in params", () => {
      const { cases } = new PaginationBoundaryGenerator().generate(makeGetWithOffset(), makeCtx());
      for (const c of cases) {
        expect((c.params as PaginationBoundaryParams).page_param).toBeUndefined();
      }
    });

    it("offset size_max probe expected_status matches endpoint success status", () => {
      const { cases } = new PaginationBoundaryGenerator().generate(makeGetWithOffset(), makeCtx());
      const sizeMax = cases.find((c) => (c.params as PaginationBoundaryParams).probe === "size_max");
      expect((sizeMax!.params as PaginationBoundaryParams).expected_status).toBe(200);
    });
  });

  // -------------------------------------------------------------------------
  // Tests 8-9: GET + cursor-style → 2 cases
  // -------------------------------------------------------------------------

  describe("tests 8-9 — GET + cursor-style → 2 cases (size_zero, size_max only)", () => {
    it("emits exactly 2 cases with probes [size_zero, size_max] for cursor-style", () => {
      const { cases } = new PaginationBoundaryGenerator().generate(makeGetWithCursor(), makeCtx());
      expect(cases).toHaveLength(2);
      expect(cases.map((c) => (c.params as PaginationBoundaryParams).probe)).toEqual(
        ["size_zero", "size_max"],
      );
    });

    it("emits 0 warnings for cursor-style endpoint", () => {
      const { warnings } = new PaginationBoundaryGenerator().generate(makeGetWithCursor(), makeCtx());
      expect(warnings).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Test 10: page-style + missing page_param → 3 cases + exact DD-7 warning
  // -------------------------------------------------------------------------

  describe("test 10 — page-style + missing page_param → 3 cases + exact DD-7 warning", () => {
    function noPageParam(id = "test.ep"): CanonicalEndpoint {
      return makeGetWithPage({
        id,
        pagination: { style: "page", size_param: "size", default_size: 20, max_size: 100 },
      });
    }

    it("emits 3 cases (no page_negative) when page_param is missing", () => {
      const { cases } = new PaginationBoundaryGenerator().generate(noPageParam(), makeCtx());
      expect(cases).toHaveLength(3);
      const probes = cases.map((c) => (c.params as PaginationBoundaryParams).probe);
      expect(probes).not.toContain("page_negative");
      expect(probes).toEqual(["size_zero", "size_max", "size_max_plus_one"]);
    });

    it("emits exactly 1 warning with the exact DD-7 template string", () => {
      const { warnings } = new PaginationBoundaryGenerator().generate(noPageParam("test.ep"), makeCtx());
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toBe(
        "Endpoint 'test.ep': pagination_boundary — style 'page' declared without page_param; page_negative probe omitted.",
      );
    });
  });

  // -------------------------------------------------------------------------
  // Test 11: max_size < default_size → 0 cases + exact DD-7 warning
  // -------------------------------------------------------------------------

  describe("test 11 — max_size < default_size → 0 cases + exact DD-7 warning", () => {
    function badSizes(id = "bad.ep"): CanonicalEndpoint {
      return makeGetWithPage({
        id,
        pagination: { style: "page", size_param: "size", page_param: "page",
          default_size: 10, max_size: 5 },
      });
    }

    it("emits 0 cases when max_size < default_size", () => {
      const { cases } = new PaginationBoundaryGenerator().generate(badSizes(), makeCtx());
      expect(cases).toHaveLength(0);
    });

    it("emits exactly 1 warning with the exact DD-7 template string", () => {
      const { warnings } = new PaginationBoundaryGenerator().generate(badSizes("bad.ep"), makeCtx());
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toBe(
        "Endpoint 'bad.ep': pagination_boundary — max_size (5) is less than default_size (10); all probes omitted.",
      );
    });
  });

  // -------------------------------------------------------------------------
  // Test 12: default_size === max_size → full probe set, 0 warnings (DD-8)
  // -------------------------------------------------------------------------

  describe("test 12 — default_size === max_size → full probe set emitted, 0 warnings (DD-8)", () => {
    it("page-style with equal sizes emits 4 cases and 0 warnings", () => {
      const ep = makeGetWithPage({
        pagination: { style: "page", size_param: "size", page_param: "page",
          default_size: 50, max_size: 50 },
      });
      const { cases, warnings } = new PaginationBoundaryGenerator().generate(ep, makeCtx());
      expect(cases).toHaveLength(4);
      expect(warnings).toHaveLength(0);
    });

    it("cursor-style with equal sizes still emits 2 cases", () => {
      const ep = makeGetWithCursor({
        pagination: { style: "cursor", size_param: "limit", default_size: 25, max_size: 25 },
      });
      const { cases } = new PaginationBoundaryGenerator().generate(ep, makeCtx());
      expect(cases).toHaveLength(2);
    });
  });
});
