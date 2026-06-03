/**
 * Unit tests for ConditionalGetGenerator.
 *
 * Pins the following design decisions (v1.0.2-pr4-etag-conditional-get.md):
 *   DD-1  Missing first-response ETag → runtime fail, NOT plan-time error.
 *         The generator has NO plan-time knowledge of response headers.
 *   DD-2  Echo ETag verbatim; generator emits no params beyond the kind discriminant.
 *   DD-6  etag_supported: true on non-GET → silent no-op; no warning emitted.
 *   DD-7  ALL_SKIPPABLE_KINDS size bumps from 18 → 19 (verified in skip-resolver tests).
 *
 * Covers all 8 generator unit tests from the design outline §8 Layer 1:
 *   1. Constructor no-args
 *   2. GET + etag_supported: true → 1 case (kind, marker=regression, prod_safe=false)
 *   3. GET + etag_supported: false → 0 cases
 *   4. GET + etag_supported absent → 0 cases
 *   5. POST + etag_supported: true → 0 cases (silent no-op)
 *   6. PUT + etag_supported: true → 0 cases
 *   7. DELETE + etag_supported: true → 0 cases
 *   8. HEAD + etag_supported: true → 0 cases
 *
 * Category: Unit.
 * Expected initial failure: Cannot find module
 *   '../../../../src/test-catalog/generators/conditional-get-generator.js'
 */

import { describe, it, expect } from "vitest";

import { ConditionalGetGenerator } from "../../../../src/test-catalog/generators/conditional-get-generator.js";
import { MarkerClassifier } from "../../../../src/test-catalog/marker-classifier.js";
import { ProdSafetyClassifier } from "../../../../src/test-catalog/prod-safety-classifier.js";
import { TestCaseIdFactory } from "../../../../src/test-catalog/test-case-id.js";
import { SchemaWalker } from "../../../../src/test-catalog/schema-walker.js";
import type { CanonicalEndpoint } from "../../../../src/core/canonical-model.js";
import type { GenerationContext } from "../../../../src/test-catalog/types.js";
import type { ConditionalGetParams } from "../../../../src/test-catalog/test-case-params.js";

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

function makeGetEndpoint(overrides: Partial<CanonicalEndpoint> = {}): CanonicalEndpoint {
  return makeEndpoint("GET", {
    id: "ep.get",
    name: "GET Endpoint",
    url: "/api/items",
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

/**
 * Unit tests for ConditionalGetGenerator.
 *
 * One describe block per test from the design outline.
 */
describe("ConditionalGetGenerator", () => {

  /**
   * Test 1: Constructor — no-arg construction.
   * Pipeline invariant: default-seam constructors must never throw.
   */
  describe("constructor — no-arg", () => {
    it("constructs with no arguments without throwing", () => {
      expect(() => new ConditionalGetGenerator()).not.toThrow();
    });
  });

  /**
   * Test 2: GET + etag_supported: true → 1 case with correct fields.
   * Verifies kind, marker=regression, prod_safe=false, params.kind.
   */
  describe("generate() — GET endpoint with etag_supported: true", () => {
    it("emits exactly one case", () => {
      const gen = new ConditionalGetGenerator();
      const endpoint = makeGetEndpoint({ etag_supported: true });
      const { cases } = gen.generate(endpoint, makeCtx());
      expect(cases).toHaveLength(1);
    });

    it("emitted case has type === 'conditional_get_304'", () => {
      const gen = new ConditionalGetGenerator();
      const endpoint = makeGetEndpoint({ etag_supported: true });
      const { cases } = gen.generate(endpoint, makeCtx());
      expect(cases[0]?.type).toBe("conditional_get_304");
    });

    it("emitted case has params.kind === 'conditional_get_304'", () => {
      const gen = new ConditionalGetGenerator();
      const endpoint = makeGetEndpoint({ etag_supported: true });
      const { cases } = gen.generate(endpoint, makeCtx());
      const params = cases[0]?.params as ConditionalGetParams;
      expect(params.kind).toBe("conditional_get_304");
    });

    it("emitted case has marker === 'regression' (opt-in deeper check per MARKER_MAP)", () => {
      const gen = new ConditionalGetGenerator();
      const endpoint = makeGetEndpoint({ etag_supported: true });
      const { cases } = gen.generate(endpoint, makeCtx());
      expect(cases[0]?.marker).toBe("regression");
    });

    it("emitted case has prod_safe === false (regression-marker short-circuit)", () => {
      const gen = new ConditionalGetGenerator();
      const endpoint = makeGetEndpoint({ etag_supported: true });
      const { cases } = gen.generate(endpoint, makeCtx());
      expect(cases[0]?.prod_safe).toBe(false);
    });

    it("emitted case endpoint_id matches the input endpoint id", () => {
      const gen = new ConditionalGetGenerator();
      const endpoint = makeGetEndpoint({ id: "users.get", etag_supported: true });
      const { cases } = gen.generate(endpoint, makeCtx());
      expect(cases[0]?.endpoint_id).toBe("users.get");
    });

    it("emitted case id matches TestCaseIdFactory.make(endpoint.id, 'conditional_get_304', 0)", () => {
      const gen = new ConditionalGetGenerator();
      const endpoint = makeGetEndpoint({ id: "users.get", etag_supported: true });
      const { cases } = gen.generate(endpoint, makeCtx());
      const expected = new TestCaseIdFactory().make("users.get", "conditional_get_304", 0);
      expect(cases[0]?.id).toBe(expected);
    });

    it("emitted case has a non-empty title string", () => {
      const gen = new ConditionalGetGenerator();
      const endpoint = makeGetEndpoint({ etag_supported: true });
      const { cases } = gen.generate(endpoint, makeCtx());
      expect(typeof cases[0]?.title).toBe("string");
      expect((cases[0]?.title ?? "").length).toBeGreaterThan(0);
    });

    it("emits zero warnings (generator has no plan-time warnings per DD-1)", () => {
      const gen = new ConditionalGetGenerator();
      const endpoint = makeGetEndpoint({ etag_supported: true });
      const { warnings } = gen.generate(endpoint, makeCtx());
      expect(warnings).toHaveLength(0);
    });
  });

  /**
   * Test 3: GET + etag_supported: false → 0 cases, 0 warnings.
   */
  describe("generate() — GET endpoint with etag_supported: false", () => {
    it("emits zero cases when etag_supported is false", () => {
      const gen = new ConditionalGetGenerator();
      const endpoint = makeGetEndpoint({ etag_supported: false });
      const { cases } = gen.generate(endpoint, makeCtx());
      expect(cases).toHaveLength(0);
    });

    it("emits zero warnings when etag_supported is false", () => {
      const gen = new ConditionalGetGenerator();
      const endpoint = makeGetEndpoint({ etag_supported: false });
      const { warnings } = gen.generate(endpoint, makeCtx());
      expect(warnings).toHaveLength(0);
    });
  });

  /**
   * Test 4: GET + etag_supported absent → 0 cases, 0 warnings.
   */
  describe("generate() — GET endpoint with etag_supported absent", () => {
    it("emits zero cases when etag_supported is not set", () => {
      const gen = new ConditionalGetGenerator();
      const endpoint = makeGetEndpoint();
      const { cases } = gen.generate(endpoint, makeCtx());
      expect(cases).toHaveLength(0);
    });

    it("emits zero warnings when etag_supported is absent", () => {
      const gen = new ConditionalGetGenerator();
      const endpoint = makeGetEndpoint();
      const { warnings } = gen.generate(endpoint, makeCtx());
      expect(warnings).toHaveLength(0);
    });
  });

  /**
   * Test 5: POST + etag_supported: true → 0 cases (silent no-op, DD-6).
   */
  describe("generate() — POST endpoint with etag_supported: true → silent zero", () => {
    it("emits zero cases for POST (silent no-op per DD-6)", () => {
      const gen = new ConditionalGetGenerator();
      const endpoint = makeEndpoint("POST", { etag_supported: true });
      const { cases } = gen.generate(endpoint, makeCtx());
      expect(cases).toHaveLength(0);
    });

    it("emits zero warnings for POST (forward-compat — no misconfiguration warning)", () => {
      const gen = new ConditionalGetGenerator();
      const endpoint = makeEndpoint("POST", { etag_supported: true });
      const { warnings } = gen.generate(endpoint, makeCtx());
      expect(warnings).toHaveLength(0);
    });
  });

  /**
   * Tests 6–8: PUT, DELETE, HEAD + etag_supported: true → 0 cases each (DD-6).
   */
  describe("generate() — non-GET methods with etag_supported: true → silent zero", () => {
    const nonGetMethods: CanonicalEndpoint["method"][] = ["PUT", "DELETE", "HEAD", "OPTIONS", "PATCH"];

    for (const method of nonGetMethods) {
      it(`emits zero cases for ${method} with etag_supported: true`, () => {
        const gen = new ConditionalGetGenerator();
        const endpoint = makeEndpoint(method, { etag_supported: true });
        const { cases } = gen.generate(endpoint, makeCtx());
        expect(cases).toHaveLength(0);
      });

      it(`emits zero warnings for ${method} with etag_supported: true`, () => {
        const gen = new ConditionalGetGenerator();
        const endpoint = makeEndpoint(method, { etag_supported: true });
        const { warnings } = gen.generate(endpoint, makeCtx());
        expect(warnings).toHaveLength(0);
      });
    }
  });

  /**
   * Determinism: identical input → byte-identical output (design §6 item 11).
   */
  describe("generate() — determinism", () => {
    it("produces byte-identical TestCase objects across two independent calls", () => {
      const gen = new ConditionalGetGenerator();
      const endpoint = makeGetEndpoint({ id: "items.get", etag_supported: true });
      const result1 = gen.generate(endpoint, makeCtx());
      const result2 = gen.generate(endpoint, makeCtx());
      expect(JSON.stringify(result1.cases)).toBe(JSON.stringify(result2.cases));
    });
  });

  /**
   * Generator does NOT call ctx.walker (no body-field discovery, design §6 item 13).
   */
  describe("generate() — ctx.walker not called", () => {
    it("does not invoke ctx.walker.walk() or any SchemaWalker method", () => {
      const gen = new ConditionalGetGenerator();
      const endpoint = makeGetEndpoint({ etag_supported: true });

      let walkerCalled = false;
      const fakeCtx: GenerationContext = {
        ids: new TestCaseIdFactory(),
        markers: new MarkerClassifier(),
        prodSafety: new ProdSafetyClassifier(),
        walker: new Proxy(new SchemaWalker(), {
          get(target, prop) {
            walkerCalled = true;
            return Reflect.get(target, prop) as unknown;
          },
        }),
      };

      gen.generate(endpoint, fakeCtx);
      expect(walkerCalled).toBe(false);
    });
  });

  /**
   * Generator never throws on any input (pure + total, design §6 item 12).
   */
  describe("generate() — never throws on any input", () => {
    it("does not throw on null-ish overrides when etag_supported is undefined", () => {
      const gen = new ConditionalGetGenerator();
      expect(() => gen.generate(makeEndpoint("GET"), makeCtx())).not.toThrow();
    });

    it("does not throw on a fully-specified endpoint with etag_supported: true", () => {
      const gen = new ConditionalGetGenerator();
      expect(() => gen.generate(makeGetEndpoint({ etag_supported: true }), makeCtx())).not.toThrow();
    });
  });
});
