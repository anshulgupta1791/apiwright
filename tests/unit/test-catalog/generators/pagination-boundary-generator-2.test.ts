/**
 * Unit tests for PaginationBoundaryGenerator — PART 2.
 * Covers tests 13–15 (non-GET no-op, no-pagination no-op, determinism + coverage).
 *
 * Pins the following design decisions (v1.0.2-pr5-pagination-boundary.md):
 *   DD-5  Non-GET + pagination → silent no-op (0 cases, 0 warnings).
 *
 * Covers tests 13–15 from the task outline:
 *   13. Non-GET + pagination → 0 cases, 0 warnings (all 6 non-GET methods)
 *   14. GET without pagination → 0 cases, 0 warnings
 *   15. Determinism + generator never calls ctx.walker + never throws
 *
 * See pagination-boundary-generator.test.ts for tests 1–12.
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
    pagination: {
      style: "page",
      size_param: "size",
      page_param: "page",
      default_size: 20,
      max_size: 100,
    },
    ...overrides,
  };
}

function makeEndpointWithPagination(
  method: CanonicalEndpoint["method"],
): CanonicalEndpoint {
  return {
    id: `ep.${method.toLowerCase()}`,
    name: `${method} Endpoint`,
    method,
    url: "/api/resource",
    request: {},
    response: { expected_status: 200, schema: {} },
    pagination: {
      style: "page",
      size_param: "size",
      page_param: "page",
      default_size: 20,
      max_size: 100,
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PaginationBoundaryGenerator — part 2 (tests 13–15)", () => {

  // -------------------------------------------------------------------------
  // Test 13: Non-GET + pagination → 0 cases, 0 warnings (DD-5)
  // -------------------------------------------------------------------------

  describe("test 13 — non-GET methods + pagination → 0 cases, 0 warnings (DD-5)", () => {
    const nonGetMethods: Array<CanonicalEndpoint["method"]> = [
      "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS",
    ];

    for (const method of nonGetMethods) {
      it(`${method} + pagination → 0 cases`, () => {
        const gen = new PaginationBoundaryGenerator();
        const { cases } = gen.generate(makeEndpointWithPagination(method), makeCtx());
        expect(cases).toHaveLength(0);
      });

      it(`${method} + pagination → 0 warnings (silent, DD-5)`, () => {
        const gen = new PaginationBoundaryGenerator();
        const { warnings } = gen.generate(makeEndpointWithPagination(method), makeCtx());
        expect(warnings).toHaveLength(0);
      });
    }
  });

  // -------------------------------------------------------------------------
  // Test 14: GET without pagination → 0 cases, 0 warnings
  // -------------------------------------------------------------------------

  describe("test 14 — GET without pagination → 0 cases, 0 warnings", () => {
    const ep: CanonicalEndpoint = {
      id: "users.list",
      name: "List Users",
      method: "GET",
      url: "/api/users",
      request: {},
      response: { expected_status: 200, schema: {} },
    };

    it("emits 0 cases when endpoint has no pagination field", () => {
      const gen = new PaginationBoundaryGenerator();
      const { cases } = gen.generate(ep, makeCtx());
      expect(cases).toHaveLength(0);
    });

    it("emits 0 warnings when endpoint has no pagination field", () => {
      const gen = new PaginationBoundaryGenerator();
      const { warnings } = gen.generate(ep, makeCtx());
      expect(warnings).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Test 15: Determinism + generator safety
  // -------------------------------------------------------------------------

  describe("test 15 — determinism and generator safety", () => {
    it("produces byte-identical case arrays on two independent invocations", () => {
      const gen = new PaginationBoundaryGenerator();
      const ep = makeGetWithPage();
      const r1 = gen.generate(ep, makeCtx());
      const r2 = gen.generate(ep, makeCtx());
      expect(JSON.stringify(r1.cases)).toBe(JSON.stringify(r2.cases));
    });

    it("produces identical warnings on repeated calls with same warning trigger", () => {
      const gen = new PaginationBoundaryGenerator();
      const ep = makeGetWithPage({
        id: "warn.ep",
        pagination: { style: "page", size_param: "size", default_size: 20, max_size: 100 },
      });
      const r1 = gen.generate(ep, makeCtx());
      const r2 = gen.generate(ep, makeCtx());
      expect(JSON.stringify(r1.warnings)).toBe(JSON.stringify(r2.warnings));
    });

    it("does not throw on any valid combination of inputs (pure + total)", () => {
      const gen = new PaginationBoundaryGenerator();
      const inputs: CanonicalEndpoint[] = [
        makeGetWithPage(),
        makeGetWithPage({
          id: "offset.list",
          pagination: { style: "offset", size_param: "limit", default_size: 10, max_size: 50 },
        }),
        makeGetWithPage({
          id: "cursor.list",
          pagination: { style: "cursor", size_param: "limit", default_size: 25, max_size: 100 },
        }),
        makeGetWithPage({
          id: "bad.sizes",
          pagination: { style: "page", size_param: "s", page_param: "p",
            default_size: 10, max_size: 5 },
        }),
        makeGetWithPage({
          id: "nopage.param",
          pagination: { style: "page", size_param: "s", default_size: 20, max_size: 100 },
        }),
      ];
      for (const ep of inputs) {
        expect(() => gen.generate(ep, makeCtx())).not.toThrow();
      }
    });

    it("generator does NOT call ctx.walker (no body-field discovery needed)", () => {
      let walkerCalled = false;
      const ctx = makeCtx();
      const walkerProxy = new Proxy(ctx.walker, {
        get(target, prop) {
          walkerCalled = true;
          return (target as Record<string | symbol, unknown>)[prop as string];
        },
      });
      const gen = new PaginationBoundaryGenerator();
      gen.generate(makeGetWithPage(), { ...ctx, walker: walkerProxy });
      expect(walkerCalled).toBe(false);
    });

    it("case type field === 'pagination_boundary' for every emitted case", () => {
      const gen = new PaginationBoundaryGenerator();
      const { cases } = gen.generate(makeGetWithPage(), makeCtx());
      for (const c of cases) {
        expect(c.type).toBe("pagination_boundary");
      }
    });
  });
});
