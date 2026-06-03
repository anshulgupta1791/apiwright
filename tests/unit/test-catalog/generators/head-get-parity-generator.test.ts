/**
 * Unit tests for HeadGetParityGenerator.
 *
 * Pins the following design decisions (v1.0.2-pr3-head-get-parity.md):
 *   DD-1  paired_get_url is the RAW template verbatim from pairedEndpoint.url;
 *         the generator emits "" as a placeholder — the resolver populates it.
 *   DD-2  HEAD method is the only activation condition; non-HEAD → 0 cases, 0 warnings.
 *   DD-3  pair_with: "" (empty string) is silently ignored — no warning, no case.
 *   DD-4  HEAD body empty = null | undefined | "" only (checked in verdict, not here).
 *   DD-5  marker = "smoke" per MARKER_MAP (locked in §1.5).
 *   DD-6  prod_safe = true because smoke + HEAD → READ_METHODS branch (§1.5/ProdSafetyClassifier).
 *   DD-7  pair_with self-reference is caught at resolver time, not generator time.
 *   DD-8  Constructor: no-arg construction (default-seam pipeline invariant).
 *   DD-9  paired_get_endpoint_id === endpoint.pair_with verbatim in emitted case.
 *   DD-10 Case id = TestCaseIdFactory.make(endpoint.id, "head_get_parity", 0).
 *
 * Category: Unit — covers all 10 required generator unit tests.
 * Expected initial failure: Cannot find module
 *   '../../../../src/test-catalog/generators/head-get-parity-generator.js'
 */

import { describe, it, expect } from "vitest";

import { HeadGetParityGenerator } from "../../../../src/test-catalog/generators/head-get-parity-generator.js";
import { MarkerClassifier } from "../../../../src/test-catalog/marker-classifier.js";
import { ProdSafetyClassifier } from "../../../../src/test-catalog/prod-safety-classifier.js";
import { TestCaseIdFactory } from "../../../../src/test-catalog/test-case-id.js";
import { SchemaWalker } from "../../../../src/test-catalog/schema-walker.js";
import type { CanonicalEndpoint } from "../../../../src/core/canonical-model.js";
import type { GenerationContext } from "../../../../src/test-catalog/types.js";
import type { HeadGetParityParams } from "../../../../src/test-catalog/test-case-params.js";

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

function makeEndpoint(
  method: CanonicalEndpoint["method"],
  overrides: Partial<CanonicalEndpoint> = {},
): CanonicalEndpoint {
  return {
    id: `ep.${method.toLowerCase()}`,
    name: `${method} Endpoint`,
    method,
    url: "/api/resource",
    request: {},
    response: { expected_status: 200, schema: {} },
    ...overrides,
  };
}

function makeHeadEndpoint(overrides: Partial<CanonicalEndpoint> = {}): CanonicalEndpoint {
  return makeEndpoint("HEAD", {
    id: "ep.head",
    url: "/api/users",
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

/**
 * Unit tests for HeadGetParityGenerator.
 *
 * Each describe block matches exactly one test-number from the
 * "Unit — generator (10 tests)" requirement list.
 */
describe("HeadGetParityGenerator", () => {

  /**
   * Test 1: Constructor — no-arg construction.
   * Pipeline invariant: default-seam constructors must never throw.
   */
  describe("constructor — no-arg", () => {
    it("constructs with no arguments without throwing", () => {
      expect(() => new HeadGetParityGenerator()).not.toThrow();
    });
  });

  /**
   * Test 2: HEAD endpoint with pair_with → 1 case.
   * Verifies kind, paired_get_endpoint_id, and paired_get_url placeholder.
   */
  describe("generate() — HEAD endpoint with pair_with", () => {
    it("emits exactly one case for a HEAD endpoint with pair_with", () => {
      const gen = new HeadGetParityGenerator();
      const endpoint = makeHeadEndpoint({ pair_with: "users.get" });
      const { cases } = gen.generate(endpoint, makeCtx());
      expect(cases).toHaveLength(1);
    });

    it("emitted case has kind === 'head_get_parity'", () => {
      const gen = new HeadGetParityGenerator();
      const endpoint = makeHeadEndpoint({ pair_with: "users.get" });
      const { cases } = gen.generate(endpoint, makeCtx());
      const params = cases[0]?.params as HeadGetParityParams;
      expect(params.kind).toBe("head_get_parity");
    });

    it("emitted case has paired_get_endpoint_id equal to pair_with value", () => {
      const gen = new HeadGetParityGenerator();
      const endpoint = makeHeadEndpoint({ pair_with: "users.get" });
      const { cases } = gen.generate(endpoint, makeCtx());
      const params = cases[0]?.params as HeadGetParityParams;
      expect(params.paired_get_endpoint_id).toBe("users.get");
    });

    it("emitted case has paired_get_url === '' (placeholder filled by resolver)", () => {
      const gen = new HeadGetParityGenerator();
      const endpoint = makeHeadEndpoint({ pair_with: "users.get" });
      const { cases } = gen.generate(endpoint, makeCtx());
      const params = cases[0]?.params as HeadGetParityParams;
      expect(params.paired_get_url).toBe("");
    });

    it("emits zero warnings when pair_with is valid", () => {
      const gen = new HeadGetParityGenerator();
      const endpoint = makeHeadEndpoint({ pair_with: "users.get" });
      const { warnings } = gen.generate(endpoint, makeCtx());
      expect(warnings).toHaveLength(0);
    });
  });

  /**
   * Test 3: HEAD endpoint with no pair_with → 0 cases, 0 warnings.
   * DD-2: absence of pair_with is normal — not a misconfiguration.
   */
  describe("generate() — HEAD endpoint with no pair_with", () => {
    it("emits zero cases when pair_with is absent", () => {
      const gen = new HeadGetParityGenerator();
      const endpoint = makeHeadEndpoint();
      const { cases } = gen.generate(endpoint, makeCtx());
      expect(cases).toHaveLength(0);
    });

    it("emits zero warnings when pair_with is absent", () => {
      const gen = new HeadGetParityGenerator();
      const endpoint = makeHeadEndpoint();
      const { warnings } = gen.generate(endpoint, makeCtx());
      expect(warnings).toHaveLength(0);
    });
  });

  /**
   * Test 4: HEAD endpoint with pair_with: "" (empty string) → 0 cases, 0 warnings.
   * DD-3: empty string is silently ignored — same as absent.
   */
  describe("generate() — HEAD endpoint with pair_with: ''", () => {
    it("emits zero cases when pair_with is an empty string", () => {
      const gen = new HeadGetParityGenerator();
      const endpoint = makeHeadEndpoint({ pair_with: "" });
      const { cases } = gen.generate(endpoint, makeCtx());
      expect(cases).toHaveLength(0);
    });

    it("emits zero warnings when pair_with is an empty string", () => {
      const gen = new HeadGetParityGenerator();
      const endpoint = makeHeadEndpoint({ pair_with: "" });
      const { warnings } = gen.generate(endpoint, makeCtx());
      expect(warnings).toHaveLength(0);
    });
  });

  /**
   * Tests 5–9: Non-HEAD methods with pair_with → 0 cases, 0 warnings.
   * DD-2: pair_with on non-HEAD is reserved for future cross-method generators;
   * today it is NOT a misconfiguration warning, it is silently ignored.
   */
  describe("generate() — non-HEAD methods with pair_with → silent zero", () => {
    const nonHeadMethods: CanonicalEndpoint["method"][] = [
      "GET",
      "POST",
      "PUT",
      "PATCH",
      "DELETE",
      "OPTIONS",
    ];

    for (const method of nonHeadMethods) {
      it(`emits zero cases for ${method} endpoint with pair_with`, () => {
        const gen = new HeadGetParityGenerator();
        const endpoint = makeEndpoint(method, { pair_with: "users.get" });
        const { cases } = gen.generate(endpoint, makeCtx());
        expect(cases).toHaveLength(0);
      });

      it(`emits zero warnings for ${method} endpoint with pair_with`, () => {
        const gen = new HeadGetParityGenerator();
        const endpoint = makeEndpoint(method, { pair_with: "users.get" });
        const { warnings } = gen.generate(endpoint, makeCtx());
        expect(warnings).toHaveLength(0);
      });
    }
  });

  /**
   * Test 10: Marker = "smoke" and prod_safe = true.
   * DD-5: head_get_parity maps to "smoke" in MARKER_MAP.
   * DD-6: smoke + HEAD method → READ_METHODS short-circuit → prod_safe = true.
   */
  describe("generate() — marker and prod_safe classification", () => {
    it("emitted case has marker === 'smoke'", () => {
      const gen = new HeadGetParityGenerator();
      const endpoint = makeHeadEndpoint({ pair_with: "users.get" });
      const { cases } = gen.generate(endpoint, makeCtx());
      expect(cases[0]?.marker).toBe("smoke");
    });

    it("emitted case has prod_safe === true (smoke + HEAD = READ_METHODS branch)", () => {
      const gen = new HeadGetParityGenerator();
      const endpoint = makeHeadEndpoint({ pair_with: "users.get" });
      const { cases } = gen.generate(endpoint, makeCtx());
      expect(cases[0]?.prod_safe).toBe(true);
    });
  });

  /**
   * Extra field invariants — endpoint_id, case id, type field.
   */
  describe("generate() — emitted case field invariants", () => {
    it("emitted case endpoint_id matches the input endpoint id", () => {
      const gen = new HeadGetParityGenerator();
      const endpoint = makeHeadEndpoint({ id: "users.head", pair_with: "users.get" });
      const { cases } = gen.generate(endpoint, makeCtx());
      expect(cases[0]?.endpoint_id).toBe("users.head");
    });

    it("emitted case type === 'head_get_parity'", () => {
      const gen = new HeadGetParityGenerator();
      const endpoint = makeHeadEndpoint({ pair_with: "users.get" });
      const { cases } = gen.generate(endpoint, makeCtx());
      expect(cases[0]?.type).toBe("head_get_parity");
    });

    it("emitted case id matches TestCaseIdFactory.make(endpoint.id, 'head_get_parity', 0)", () => {
      const gen = new HeadGetParityGenerator();
      const endpoint = makeHeadEndpoint({ id: "users.head", pair_with: "users.get" });
      const ctx = makeCtx();
      const { cases } = gen.generate(endpoint, ctx);
      const expected = new TestCaseIdFactory().make("users.head", "head_get_parity", 0);
      expect(cases[0]?.id).toBe(expected);
    });

    it("emitted case id matches the ^[a-z0-9._-]+$ charset", () => {
      const gen = new HeadGetParityGenerator();
      const endpoint = makeHeadEndpoint({ id: "users.head", pair_with: "users.get" });
      const { cases } = gen.generate(endpoint, makeCtx());
      expect(cases[0]?.id).toMatch(/^[a-z0-9._-]+$/);
    });

    it("emitted case has a non-empty title string", () => {
      const gen = new HeadGetParityGenerator();
      const endpoint = makeHeadEndpoint({ pair_with: "users.get" });
      const { cases } = gen.generate(endpoint, makeCtx());
      expect(typeof cases[0]?.title).toBe("string");
      expect((cases[0]?.title ?? "").length).toBeGreaterThan(0);
    });
  });
});
