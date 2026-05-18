import { describe, it, expect } from "vitest";

import { IdempotencyGenerator } from "../../../../src/test-catalog/generators/idempotency-generator.js";
import { MarkerClassifier } from "../../../../src/test-catalog/marker-classifier.js";
import { ProdSafetyClassifier } from "../../../../src/test-catalog/prod-safety-classifier.js";
import { TestCaseIdFactory } from "../../../../src/test-catalog/test-case-id.js";
import { SchemaWalker } from "../../../../src/test-catalog/schema-walker.js";
import type { CanonicalEndpoint } from "../../../../src/core/canonical-model.js";
import type { GenerationContext, DeleteIdempotencyParams, GetIdempotencyParams } from "../../../../src/test-catalog/types.js";

/**
 * Unit tests for IdempotencyGenerator.
 *
 * Covers: GET→get_idempotency (1 case), DELETE→delete_idempotency (1 case) with
 * second_delete_status derivation (204/404 per declaration; non-204/404→default 404),
 * POST/PUT/PATCH/HEAD/OPTIONS→zero cases, regression marker, prod_safe=false,
 * stable ids, and determinism.
 *
 * The TSDoc assumption ("when a DELETE endpoint's expected_status is neither 204
 * nor 404, the second-DELETE expectation defaults to 404") is explicitly tested.
 */

function makeCtx(): GenerationContext {
  return {
    ids: new TestCaseIdFactory(),
    markers: new MarkerClassifier(),
    prodSafety: new ProdSafetyClassifier(),
    walker: new SchemaWalker(),
  };
}

function makeEndpoint(method: CanonicalEndpoint["method"], expectedStatus: number): CanonicalEndpoint {
  return {
    id: `ep.${method.toLowerCase()}`,
    name: `${method} Endpoint`,
    method,
    url: "/ep",
    request: {},
    response: { expected_status: expectedStatus, schema: {} },
  };
}

describe("IdempotencyGenerator", () => {
  describe("constructor — default-seam wiring", () => {
    it("constructs with no arguments", () => {
      expect(() => new IdempotencyGenerator()).not.toThrow();
    });
  });

  describe("generate() — GET endpoint → exactly one get_idempotency case", () => {
    it("emits exactly one case for a GET endpoint", () => {
      const gen = new IdempotencyGenerator();
      const { cases } = gen.generate(makeEndpoint("GET", 200), makeCtx());
      expect(cases).toHaveLength(1);
    });

    it("emits a get_idempotency case type", () => {
      const gen = new IdempotencyGenerator();
      const { cases } = gen.generate(makeEndpoint("GET", 200), makeCtx());
      expect(cases[0].type).toBe("get_idempotency");
    });

    it("get_idempotency params carry compare=body_equality", () => {
      const gen = new IdempotencyGenerator();
      const { cases } = gen.generate(makeEndpoint("GET", 200), makeCtx());
      expect((cases[0].params as GetIdempotencyParams).compare).toBe("body_equality");
    });
  });

  describe("generate() — DELETE endpoint → exactly one delete_idempotency case", () => {
    it("emits exactly one case for a DELETE endpoint", () => {
      const gen = new IdempotencyGenerator();
      const { cases } = gen.generate(makeEndpoint("DELETE", 204), makeCtx());
      expect(cases).toHaveLength(1);
    });

    it("emits a delete_idempotency case type", () => {
      const gen = new IdempotencyGenerator();
      const { cases } = gen.generate(makeEndpoint("DELETE", 204), makeCtx());
      expect(cases[0].type).toBe("delete_idempotency");
    });

    it("uses second_delete_status=204 when expected_status is 204", () => {
      const gen = new IdempotencyGenerator();
      const { cases } = gen.generate(makeEndpoint("DELETE", 204), makeCtx());
      expect((cases[0].params as DeleteIdempotencyParams).second_delete_status).toBe(204);
    });

    it("uses second_delete_status=404 when expected_status is 404", () => {
      const gen = new IdempotencyGenerator();
      const { cases } = gen.generate(makeEndpoint("DELETE", 404), makeCtx());
      expect((cases[0].params as DeleteIdempotencyParams).second_delete_status).toBe(404);
    });

    it("defaults second_delete_status to 404 when expected_status is 200 (not 204 or 404)", () => {
      // Decomposition assumption #2: non-204/404 → default 404
      const gen = new IdempotencyGenerator();
      const { cases } = gen.generate(makeEndpoint("DELETE", 200), makeCtx());
      expect((cases[0].params as DeleteIdempotencyParams).second_delete_status).toBe(404);
    });

    it("defaults second_delete_status to 404 when expected_status is 201", () => {
      const gen = new IdempotencyGenerator();
      const { cases } = gen.generate(makeEndpoint("DELETE", 201), makeCtx());
      expect((cases[0].params as DeleteIdempotencyParams).second_delete_status).toBe(404);
    });

    it("defaults second_delete_status to 404 when expected_status is 500", () => {
      const gen = new IdempotencyGenerator();
      const { cases } = gen.generate(makeEndpoint("DELETE", 500), makeCtx());
      expect((cases[0].params as DeleteIdempotencyParams).second_delete_status).toBe(404);
    });
  });

  describe("generate() — non-GET/non-DELETE methods → zero cases", () => {
    const zeroMethods: CanonicalEndpoint["method"][] = ["POST", "PUT", "PATCH", "HEAD", "OPTIONS"];

    for (const method of zeroMethods) {
      it(`emits zero cases for ${method}`, () => {
        const gen = new IdempotencyGenerator();
        const { cases } = gen.generate(makeEndpoint(method, 200), makeCtx());
        expect(cases).toHaveLength(0);
      });
    }

    it("emits no warnings for zero-case methods", () => {
      const gen = new IdempotencyGenerator();
      const { warnings } = gen.generate(makeEndpoint("POST", 201), makeCtx());
      expect(warnings).toHaveLength(0);
    });
  });

  describe("generate() — marker and prod_safe", () => {
    it("marks get_idempotency as regression", () => {
      const gen = new IdempotencyGenerator();
      const { cases } = gen.generate(makeEndpoint("GET", 200), makeCtx());
      expect(cases[0].marker).toBe("regression");
    });

    it("marks delete_idempotency as regression", () => {
      const gen = new IdempotencyGenerator();
      const { cases } = gen.generate(makeEndpoint("DELETE", 204), makeCtx());
      expect(cases[0].marker).toBe("regression");
    });

    it("marks get_idempotency as prod_safe=false (regression)", () => {
      const gen = new IdempotencyGenerator();
      const { cases } = gen.generate(makeEndpoint("GET", 200), makeCtx());
      expect(cases[0].prod_safe).toBe(false);
    });

    it("marks delete_idempotency as prod_safe=false", () => {
      const gen = new IdempotencyGenerator();
      const { cases } = gen.generate(makeEndpoint("DELETE", 204), makeCtx());
      expect(cases[0].prod_safe).toBe(false);
    });
  });

  describe("generate() — stable ids", () => {
    it("assigns stable ids across two runs", () => {
      const gen = new IdempotencyGenerator();
      const { cases: c1 } = gen.generate(makeEndpoint("GET", 200), makeCtx());
      const { cases: c2 } = gen.generate(makeEndpoint("GET", 200), makeCtx());
      expect(c1[0].id).toBe(c2[0].id);
    });

    it("assigns id matching ^[a-z0-9._-]+$", () => {
      const gen = new IdempotencyGenerator();
      const { cases } = gen.generate(makeEndpoint("DELETE", 204), makeCtx());
      expect(cases[0].id).toMatch(/^[a-z0-9._-]+$/);
    });
  });

  describe("generate() — determinism", () => {
    it("produces byte-identical results for two GET runs", () => {
      const gen = new IdempotencyGenerator();
      const r1 = gen.generate(makeEndpoint("GET", 200), makeCtx());
      const r2 = gen.generate(makeEndpoint("GET", 200), makeCtx());
      expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
    });

    it("produces byte-identical results for two DELETE runs", () => {
      const gen = new IdempotencyGenerator();
      const r1 = gen.generate(makeEndpoint("DELETE", 204), makeCtx());
      const r2 = gen.generate(makeEndpoint("DELETE", 204), makeCtx());
      expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
    });
  });
});
