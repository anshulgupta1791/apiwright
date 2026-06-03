/**
 * Integration tests for pagination_boundary wired into TestPlanGenerator — PART 1.
 * Covers orchestration scenarios 1–8 from the task outline.
 *
 * Pins the following design decisions (v1.0.2-pr5-pagination-boundary.md):
 *   DD-4  Probe set: page=4, offset=3, cursor=2 probes.
 *   DD-9  Skip-token field-carrier semantics.
 *
 * Scenarios in this file (1-8):
 *   1.  Page-style endpoint → 4 pagination_boundary cases
 *   2.  Offset-style → 3 cases
 *   3.  Cursor-style → 2 cases
 *   4.  skip_cases: ["pagination_boundary"] → all probes suppressed + counted-skip
 *   5.  skip_cases: ["pagination_boundary:size_zero"] → only size_zero suppressed
 *   6.  skipGlobally: ["pagination_boundary:size_max"] → size_max suppressed on every endpoint
 *   7.  skip_cases for non-existent probe → dead-weight warning
 *   8.  ALL_SKIPPABLE_KINDS.size === 20
 *
 * See pagination-boundary-orchestration-2.test.ts for scenarios 9-12.
 *
 * Category: Integration (orchestration — real TestPlanGenerator).
 * Expected initial failure: TestPlanGenerator returns zero pagination_boundary cases.
 */

import { describe, it, expect } from "vitest";

import { TestPlanGenerator } from "../../../src/test-catalog/test-plan-generator.js";
import { ALL_SKIPPABLE_KINDS } from "../../../src/test-catalog/skip-resolver.js";
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("pagination_boundary — TestPlanGenerator orchestration (part 1, cases 1-8)", () => {

  describe("case 1 — GET + page-style → 4 pagination_boundary cases", () => {
    it("produces exactly 4 pagination_boundary cases for page-style", () => {
      const plan = new TestPlanGenerator().generate([getWithPage("users.list")]);
      expect(plan.cases.filter((c) => c.type === "pagination_boundary")).toHaveLength(4);
    });

    it("all 4 cases have marker='regression' and prod_safe=false", () => {
      const plan = new TestPlanGenerator().generate([getWithPage("users.list")]);
      const cases = plan.cases.filter((c) => c.type === "pagination_boundary");
      for (const c of cases) {
        expect(c.marker).toBe("regression");
        expect(c.prod_safe).toBe(false);
      }
    });
  });

  describe("case 2 — GET + offset-style → 3 pagination_boundary cases", () => {
    it("produces exactly 3 pagination_boundary cases for offset-style", () => {
      const plan = new TestPlanGenerator().generate([getWithOffset("items.list")]);
      expect(plan.cases.filter((c) => c.type === "pagination_boundary")).toHaveLength(3);
    });
  });

  describe("case 3 — GET + cursor-style → 2 pagination_boundary cases", () => {
    it("produces exactly 2 pagination_boundary cases for cursor-style", () => {
      const plan = new TestPlanGenerator().generate([getWithCursor("posts.list")]);
      expect(plan.cases.filter((c) => c.type === "pagination_boundary")).toHaveLength(2);
    });
  });

  describe("case 4 — skip_cases: ['pagination_boundary'] suppresses all probes", () => {
    const ep = getWithPage("users.list", { skip_cases: ["pagination_boundary"] });

    it("removes all pagination_boundary cases when bare token is in skip_cases", () => {
      const plan = new TestPlanGenerator().generate([ep]);
      expect(plan.cases.filter((c) => c.type === "pagination_boundary")).toHaveLength(0);
    });

    it("emits counted-skip warning naming endpoint id and 'pagination_boundary'", () => {
      const plan = new TestPlanGenerator().generate([ep]);
      const warn = plan.warnings.find(
        (w) => w.includes("users.list") && w.includes("pagination_boundary") &&
          w.match(/skipped \d+ case\(s\)/),
      );
      expect(warn).toBeDefined();
    });
  });

  describe("case 5 — skip_cases: ['pagination_boundary:size_zero'] suppresses only size_zero", () => {
    const ep = getWithPage("users.list", { skip_cases: ["pagination_boundary:size_zero"] });

    it("removes only size_zero, leaving 3 cases", () => {
      const plan = new TestPlanGenerator().generate([ep]);
      expect(plan.cases.filter((c) => c.type === "pagination_boundary")).toHaveLength(3);
    });

    it("emits counted-skip warning naming the 'size_zero' field qualifier", () => {
      const plan = new TestPlanGenerator().generate([ep]);
      const warn = plan.warnings.find(
        (w) => w.includes("users.list") && w.includes("pagination_boundary") &&
          w.includes("size_zero"),
      );
      expect(warn).toBeDefined();
    });
  });

  describe("case 6 — skipGlobally: ['pagination_boundary:size_max'] suppresses size_max across all endpoints", () => {
    const endpoints = [getWithPage("a.list"), getWithPage("b.list")];

    it("removes size_max probe from all page-style endpoints (2*3=6 remaining)", () => {
      const gen = new TestPlanGenerator({ skipGlobally: ["pagination_boundary:size_max"] });
      const plan = gen.generate(endpoints);
      expect(plan.cases.filter((c) => c.type === "pagination_boundary")).toHaveLength(6);
    });

    it("emits a global-skip warning referencing 'skip_globally'", () => {
      const gen = new TestPlanGenerator({ skipGlobally: ["pagination_boundary:size_max"] });
      const plan = gen.generate(endpoints);
      const warn = plan.warnings.find(
        (w) => w.includes("pagination_boundary") && w.toLowerCase().includes("skip_globally"),
      );
      expect(warn).toBeDefined();
    });
  });

  describe("case 7 — skip_cases with unknown probe qualifier → dead-weight warning", () => {
    const ep = getWithPage("users.list", { skip_cases: ["pagination_boundary:nonexistent_probe"] });

    it("emits dead-weight warning naming the unknown probe token", () => {
      const plan = new TestPlanGenerator().generate([ep]);
      const warn = plan.warnings.find(
        (w) => w.includes("users.list") && w.includes("pagination_boundary") &&
          w.includes("matched zero"),
      );
      expect(warn).toBeDefined();
    });

    it("all 4 pagination_boundary cases still present (token matched nothing)", () => {
      const plan = new TestPlanGenerator().generate([ep]);
      expect(plan.cases.filter((c) => c.type === "pagination_boundary")).toHaveLength(4);
    });
  });

  describe("case 8 — ALL_SKIPPABLE_KINDS has 21 entries after adding cors_preflight", () => {
    it("ALL_SKIPPABLE_KINDS.size === 21", () => {
      expect(ALL_SKIPPABLE_KINDS.size).toBe(21);
    });

    it("ALL_SKIPPABLE_KINDS contains 'pagination_boundary'", () => {
      expect(ALL_SKIPPABLE_KINDS.has("pagination_boundary")).toBe(true);
    });
  });
});
