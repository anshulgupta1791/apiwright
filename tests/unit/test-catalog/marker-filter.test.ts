import { describe, it, expect } from "vitest";

import { MarkerFilter } from "../../../src/test-catalog/marker-filter.js";
import type { TestPlan, TestCase } from "../../../src/test-catalog/types.js";

/**
 * Unit tests for MarkerFilter.
 *
 * Covers: [smoke]→only smoke, [regression]→only regression, all→smoke+regression
 * union; e2e→zero cases in v1.0; endpoint declared markers intersection; no
 * declared markers → participates in all selected; empty/unknown selection → zero
 * cases + warning; never mutates input; deterministic order-preserving; counts
 * and warnings preserved from input plan.
 */

function makeCase(id: string, marker: "smoke" | "regression" | "e2e", endpointId: string): TestCase {
  return {
    id,
    endpoint_id: endpointId,
    type: "status_code_conformance",
    marker,
    title: `Test ${id}`,
    prod_safe: marker === "smoke",
    params: { kind: "status_code_conformance", expected_status: 200 },
  };
}

function makePlan(cases: TestCase[], extra?: Partial<TestPlan>): TestPlan {
  return {
    cases,
    endpoints_planned: extra?.endpoints_planned ?? 2,
    endpoints_skipped: extra?.endpoints_skipped ?? 0,
    warnings: extra?.warnings ?? [],
  };
}

const smokeCase = makeCase("ep.smoke.0", "smoke", "ep.one");
const regressionCase = makeCase("ep.regression.0", "regression", "ep.one");
const smokeCase2 = makeCase("ep2.smoke.0", "smoke", "ep.two");
const regressionCase2 = makeCase("ep2.regression.0", "regression", "ep.two");

const mixedPlan = makePlan([smokeCase, regressionCase, smokeCase2, regressionCase2]);

describe("MarkerFilter", () => {
  describe("constructor", () => {
    it("constructs with no arguments", () => {
      expect(() => new MarkerFilter()).not.toThrow();
    });
  });

  describe("filter() — [smoke] selection", () => {
    it("returns only smoke-marker cases", () => {
      const filter = new MarkerFilter();
      const result = filter.filter(mixedPlan, ["smoke"]);
      expect(result.cases.every((c) => c.marker === "smoke")).toBe(true);
    });

    it("excludes regression cases", () => {
      const filter = new MarkerFilter();
      const result = filter.filter(mixedPlan, ["smoke"]);
      expect(result.cases.some((c) => c.marker === "regression")).toBe(false);
    });
  });

  describe("filter() — [regression] selection", () => {
    it("returns only regression-marker cases", () => {
      const filter = new MarkerFilter();
      const result = filter.filter(mixedPlan, ["regression"]);
      expect(result.cases.every((c) => c.marker === "regression")).toBe(true);
    });

    it("excludes smoke cases", () => {
      const filter = new MarkerFilter();
      const result = filter.filter(mixedPlan, ["regression"]);
      expect(result.cases.some((c) => c.marker === "smoke")).toBe(false);
    });
  });

  describe("filter() — all → smoke + regression union", () => {
    it("returns both smoke and regression cases for all selection", () => {
      const filter = new MarkerFilter();
      const result = filter.filter(mixedPlan, ["all"]);
      const markers = new Set(result.cases.map((c) => c.marker));
      expect(markers.has("smoke")).toBe(true);
      expect(markers.has("regression")).toBe(true);
    });

    it("returns same number of cases as smoke+regression combined", () => {
      const filter = new MarkerFilter();
      const smokeResult = filter.filter(mixedPlan, ["smoke"]);
      const regressionResult = filter.filter(mixedPlan, ["regression"]);
      const allResult = filter.filter(mixedPlan, ["all"]);
      expect(allResult.cases).toHaveLength(
        smokeResult.cases.length + regressionResult.cases.length,
      );
    });
  });

  describe("filter() — e2e → zero cases in v1.0", () => {
    it("returns zero cases for e2e selection (no e2e cases generated in v1.0)", () => {
      const filter = new MarkerFilter();
      const result = filter.filter(mixedPlan, ["e2e"]);
      expect(result.cases).toHaveLength(0);
    });
  });

  describe("filter() — endpoint declared markers intersection", () => {
    it("excludes cases for endpoints whose declared markers do not include the selected marker", () => {
      const filter = new MarkerFilter();
      // ep.one has markers: ["smoke"] — regression cases for ep.one should be excluded
      const endpointMarkers: Record<string, Array<"smoke" | "regression" | "e2e"> | undefined> = {
        "ep.one": ["smoke"],
        "ep.two": undefined, // no declared markers → participates in all
      };
      const result = filter.filter(mixedPlan, ["regression"], endpointMarkers);
      // ep.one regression case excluded because ep.one only declares smoke
      const ep1Regression = result.cases.filter(
        (c) => c.endpoint_id === "ep.one" && c.marker === "regression",
      );
      expect(ep1Regression).toHaveLength(0);
    });

    it("includes cases for endpoints whose declared markers include the selected marker", () => {
      const filter = new MarkerFilter();
      const endpointMarkers: Record<string, Array<"smoke" | "regression" | "e2e"> | undefined> = {
        "ep.one": ["smoke", "regression"],
      };
      const result = filter.filter(mixedPlan, ["regression"], endpointMarkers);
      const ep1Regression = result.cases.filter(
        (c) => c.endpoint_id === "ep.one" && c.marker === "regression",
      );
      expect(ep1Regression).toHaveLength(1);
    });

    it("participates in all selected markers when endpoint has no declared markers", () => {
      const filter = new MarkerFilter();
      // No endpointMarkers map provided at all
      const result = filter.filter(mixedPlan, ["regression"]);
      expect(result.cases.some((c) => c.marker === "regression")).toBe(true);
    });

    it("participates in all selected when endpoint id absent from the markers map", () => {
      const filter = new MarkerFilter();
      const endpointMarkers: Record<string, Array<"smoke" | "regression" | "e2e"> | undefined> = {
        // ep.one is absent — should default to participate in all
      };
      const result = filter.filter(mixedPlan, ["regression"], endpointMarkers);
      expect(result.cases.some((c) => c.endpoint_id === "ep.one" && c.marker === "regression")).toBe(true);
    });

    it("participates in all selected when endpoint markers value is undefined", () => {
      const filter = new MarkerFilter();
      const endpointMarkers: Record<string, Array<"smoke" | "regression" | "e2e"> | undefined> = {
        "ep.one": undefined,
      };
      const result = filter.filter(mixedPlan, ["regression"], endpointMarkers);
      expect(result.cases.some((c) => c.endpoint_id === "ep.one" && c.marker === "regression")).toBe(true);
    });

    it("participates in all selected when endpoint markers value is empty array", () => {
      const filter = new MarkerFilter();
      const endpointMarkers: Record<string, Array<"smoke" | "regression" | "e2e"> | undefined> = {
        "ep.one": [],
      };
      // Empty array = declared nothing → participates in all (documented default)
      const result = filter.filter(mixedPlan, ["regression"], endpointMarkers);
      expect(result.cases.some((c) => c.endpoint_id === "ep.one" && c.marker === "regression")).toBe(true);
    });
  });

  describe("filter() — never mutates the input plan", () => {
    it("returns a new plan reference (not the same object)", () => {
      const filter = new MarkerFilter();
      const result = filter.filter(mixedPlan, ["smoke"]);
      expect(result).not.toBe(mixedPlan);
    });

    it("does not modify the original plan's cases array", () => {
      const filter = new MarkerFilter();
      const originalCaseCount = mixedPlan.cases.length;
      filter.filter(mixedPlan, ["smoke"]);
      expect(mixedPlan.cases).toHaveLength(originalCaseCount);
    });
  });

  describe("filter() — endpoints_planned, endpoints_skipped, and warnings preserved", () => {
    it("preserves endpoints_planned from the input plan", () => {
      const filter = new MarkerFilter();
      const plan = makePlan([smokeCase], { endpoints_planned: 7, endpoints_skipped: 2 });
      const result = filter.filter(plan, ["smoke"]);
      expect(result.endpoints_planned).toBe(7);
    });

    it("preserves endpoints_skipped from the input plan", () => {
      const filter = new MarkerFilter();
      const plan = makePlan([smokeCase], { endpoints_planned: 7, endpoints_skipped: 2 });
      const result = filter.filter(plan, ["smoke"]);
      expect(result.endpoints_skipped).toBe(2);
    });

    it("preserves warnings from the input plan", () => {
      const filter = new MarkerFilter();
      const plan = makePlan([smokeCase], { warnings: ["some warning"] });
      const result = filter.filter(plan, ["smoke"]);
      expect(result.warnings).toContain("some warning");
    });
  });

  describe("filter() — empty/unknown selection → zero cases + warning", () => {
    it("returns zero cases for empty selection", () => {
      const filter = new MarkerFilter();
      const result = filter.filter(mixedPlan, []);
      expect(result.cases).toHaveLength(0);
    });

    it("appends a warning for empty selection", () => {
      const filter = new MarkerFilter();
      const result = filter.filter(mixedPlan, []);
      expect(result.warnings.some((w) => w.toLowerCase().includes("marker")
        || w.toLowerCase().includes("select"))).toBe(true);
    });

    it("does not throw for empty selection", () => {
      const filter = new MarkerFilter();
      expect(() => filter.filter(mixedPlan, [])).not.toThrow();
    });

    it("returns zero cases for all-unknown selection", () => {
      const filter = new MarkerFilter();
      const result = filter.filter(mixedPlan, ["bogus" as never]);
      expect(result.cases).toHaveLength(0);
    });

    it("does not throw for all-unknown selection", () => {
      const filter = new MarkerFilter();
      expect(() => filter.filter(mixedPlan, ["bogus" as never])).not.toThrow();
    });
  });

  describe("filter() — deterministic order-preserving", () => {
    it("preserves the relative order of cases from the input plan", () => {
      const filter = new MarkerFilter();
      const result = filter.filter(mixedPlan, ["all"]);
      const resultIds = result.cases.map((c) => c.id);
      const planIds = mixedPlan.cases.map((c) => c.id);
      // Result should be a subsequence of the plan ids in original order
      let planPointer = 0;
      for (const id of resultIds) {
        while (planPointer < planIds.length && planIds[planPointer] !== id) {
          planPointer++;
        }
        expect(planPointer).toBeLessThan(planIds.length);
        planPointer++;
      }
    });
  });

  describe("filter() — smoke and regression are disjoint", () => {
    it("smoke-only and regression-only filtered results have no overlapping case ids", () => {
      const filter = new MarkerFilter();
      const smokeResult = filter.filter(mixedPlan, ["smoke"]);
      const regressionResult = filter.filter(mixedPlan, ["regression"]);
      const smokeIds = new Set(smokeResult.cases.map((c) => c.id));
      const regressionIds = new Set(regressionResult.cases.map((c) => c.id));
      for (const id of regressionIds) {
        expect(smokeIds.has(id)).toBe(false);
      }
    });

    it("smoke + regression union equals all-filtered result (by case ids)", () => {
      const filter = new MarkerFilter();
      const smokeResult = filter.filter(mixedPlan, ["smoke"]);
      const regressionResult = filter.filter(mixedPlan, ["regression"]);
      const allResult = filter.filter(mixedPlan, ["all"]);
      const unionIds = new Set([
        ...smokeResult.cases.map((c) => c.id),
        ...regressionResult.cases.map((c) => c.id),
      ]);
      const allIds = new Set(allResult.cases.map((c) => c.id));
      expect(unionIds).toEqual(allIds);
    });
  });
});
