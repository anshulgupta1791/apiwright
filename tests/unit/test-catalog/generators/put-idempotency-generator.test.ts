/**
 * Unit tests for PutIdempotencyGenerator.
 *
 * Covers:
 *   - No-arg construction (default-seam wiring, design decision #6)
 *   - PUT endpoint → exactly one put_idempotency case with correct type, marker, params
 *   - compare discriminant routing: body_equality when no db_verify or empty db_verify,
 *     db_state when db_verify has one or more entries (locked routing rule)
 *   - Plan-time warning for PUT+204+no db_verify (design decision #1)
 *   - Plan-time warning for missing body_example (design decision #5)
 *   - Non-PUT methods → zero cases, zero warnings (design decisions #14–#19)
 *   - Determinism: byte-identical output across two independent invocations
 *
 * Design decisions pinned:
 *   DD-1  Empty/204 body → PASS at runtime; plan warning when PUT+204+no db_verify.
 *   DD-5  Request body from endpoint.request.body_example; missing → plan warning.
 *   DD-6  prod_safe: false is automatic via classifier; generator does NOT set it.
 *   DD-9  compare is a discrete two-literal union ("body_equality" | "db_state").
 *   DD-10 putIdempotencyVerdict is pure; no I/O in the generator.
 *   Locked routing rule: compare === "db_state" IFF endpoint.db_verify?.length > 0
 *     (count, not presence — empty array routes to body_equality).
 */

import { describe, it, expect } from "vitest";

import { PutIdempotencyGenerator } from "../../../../src/test-catalog/generators/put-idempotency-generator.js";
import { MarkerClassifier } from "../../../../src/test-catalog/marker-classifier.js";
import { ProdSafetyClassifier } from "../../../../src/test-catalog/prod-safety-classifier.js";
import { TestCaseIdFactory } from "../../../../src/test-catalog/test-case-id.js";
import { SchemaWalker } from "../../../../src/test-catalog/schema-walker.js";
import type { CanonicalEndpoint } from "../../../../src/core/canonical-model.js";
import type { GenerationContext } from "../../../../src/test-catalog/types.js";
import type { PutIdempotencyParams } from "../../../../src/test-catalog/test-case-params.js";

// ---------------------------------------------------------------------------
// Helpers (mirror idempotency-generator.test.ts pattern)
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
  expectedStatus: number,
  overrides: Partial<CanonicalEndpoint> = {},
): CanonicalEndpoint {
  return {
    id: `ep.${method.toLowerCase()}`,
    name: `${method} Endpoint`,
    method,
    url: "/ep",
    request: {},
    response: { expected_status: expectedStatus, schema: {} },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PutIdempotencyGenerator", () => {

  /**
   * Case 1: Constructor — no-arg construction.
   * The default-seam wiring must not throw (pipeline rule: always tested).
   */
  describe("constructor — default-seam wiring", () => {
    it("constructs with no arguments", () => {
      expect(() => new PutIdempotencyGenerator()).not.toThrow();
    });
  });

  /**
   * Cases 2–6: PUT endpoint without db_verify → exactly 1 case with correct fields.
   */
  describe("generate() — PUT endpoint without db_verify", () => {
    it("emits exactly one case", () => {
      const gen = new PutIdempotencyGenerator();
      const endpoint = makeEndpoint("PUT", 200, {
        request: { body_example: { id: 1, name: "Alice" } },
      });
      const { cases } = gen.generate(endpoint, makeCtx());
      expect(cases).toHaveLength(1);
    });

    it("emitted case has type === 'put_idempotency'", () => {
      const gen = new PutIdempotencyGenerator();
      const endpoint = makeEndpoint("PUT", 200, {
        request: { body_example: { id: 1, name: "Alice" } },
      });
      const { cases } = gen.generate(endpoint, makeCtx());
      expect(cases[0]?.type).toBe("put_idempotency");
    });

    it("emitted case has marker === 'regression'", () => {
      const gen = new PutIdempotencyGenerator();
      const endpoint = makeEndpoint("PUT", 200, {
        request: { body_example: { id: 1, name: "Alice" } },
      });
      const { cases } = gen.generate(endpoint, makeCtx());
      expect(cases[0]?.marker).toBe("regression");
    });

    it("emitted case has params.kind === 'put_idempotency'", () => {
      const gen = new PutIdempotencyGenerator();
      const endpoint = makeEndpoint("PUT", 200, {
        request: { body_example: { id: 1, name: "Alice" } },
      });
      const { cases } = gen.generate(endpoint, makeCtx());
      const params = cases[0]?.params as PutIdempotencyParams;
      expect(params.kind).toBe("put_idempotency");
    });

    it("emitted case has params.compare === 'body_equality' when no db_verify", () => {
      const gen = new PutIdempotencyGenerator();
      const endpoint = makeEndpoint("PUT", 200, {
        request: { body_example: { id: 1, name: "Alice" } },
      });
      const { cases } = gen.generate(endpoint, makeCtx());
      const params = cases[0]?.params as PutIdempotencyParams;
      expect(params.compare).toBe("body_equality");
    });
  });

  /**
   * Case 7: PUT endpoint with db_verify (one entry) → compare === 'db_state'.
   */
  describe("generate() — PUT endpoint with db_verify entries", () => {
    it("emits compare === 'db_state' when db_verify has one entry", () => {
      const gen = new PutIdempotencyGenerator();
      const endpoint = makeEndpoint("PUT", 200, {
        request: { body_example: { id: 1 } },
        db_verify: [
          {
            connection: "primary",
            query: "SELECT id FROM items WHERE id = 1",
            expect: "exists",
          },
        ],
      });
      const { cases } = gen.generate(endpoint, makeCtx());
      const params = cases[0]?.params as PutIdempotencyParams;
      expect(params.compare).toBe("db_state");
    });

    /**
     * Case 8: db_verify: [] (empty array) → body_equality (count discriminator).
     * The locked routing rule says: compare === "db_state" IFF length > 0.
     */
    it("emits compare === 'body_equality' when db_verify is an empty array", () => {
      const gen = new PutIdempotencyGenerator();
      const endpoint = makeEndpoint("PUT", 200, {
        request: { body_example: { id: 1 } },
        db_verify: [],
      });
      const { cases } = gen.generate(endpoint, makeCtx());
      const params = cases[0]?.params as PutIdempotencyParams;
      expect(params.compare).toBe("body_equality");
    });

    /**
     * Case 9: db_verify with multiple entries → compare === 'db_state'.
     */
    it("emits compare === 'db_state' when db_verify has multiple entries", () => {
      const gen = new PutIdempotencyGenerator();
      const endpoint = makeEndpoint("PUT", 200, {
        request: { body_example: { id: 1 } },
        db_verify: [
          { connection: "primary", query: "SELECT 1", expect: "exists" },
          { connection: "primary", query: "SELECT 2", expect: "not_exists" },
          { connection: "secondary", query: "SELECT 3", expect: "match", fields: { col: "val" } },
        ],
      });
      const { cases } = gen.generate(endpoint, makeCtx());
      const params = cases[0]?.params as PutIdempotencyParams;
      expect(params.compare).toBe("db_state");
    });
  });

  /**
   * Cases 10–11: 204 + db_verify interaction.
   */
  describe("generate() — 204 status plan warnings", () => {
    /**
     * Case 10: PUT + expected_status 204 + no db_verify → plan warning with endpoint id
     * and advice to add db_verify.
     */
    it("emits plan warning for PUT with expected_status 204 and no db_verify", () => {
      const gen = new PutIdempotencyGenerator();
      const endpoint = makeEndpoint("PUT", 204, {
        id: "ep.update204",
        request: { body_example: { id: 1 } },
      });
      const { warnings } = gen.generate(endpoint, makeCtx());
      expect(warnings.length).toBeGreaterThan(0);
      const combinedWarnings = warnings.join("\n");
      expect(combinedWarnings).toContain("ep.update204");
      expect(combinedWarnings.toLowerCase()).toMatch(/db_verify/i);
    });

    /**
     * Case 11: PUT + expected_status 204 + db_verify present → NO warning.
     * db_state mode covers idempotency for bodyless responses.
     */
    it("emits no 204 warning when db_verify is present (db_state covers idempotency)", () => {
      const gen = new PutIdempotencyGenerator();
      const endpoint = makeEndpoint("PUT", 204, {
        request: { body_example: { id: 1 } },
        db_verify: [
          { connection: "primary", query: "SELECT id FROM rows WHERE id = 1", expect: "exists" },
        ],
      });
      const { warnings } = gen.generate(endpoint, makeCtx());
      // No 204-related warning should be present
      const has204Warning = warnings.some(
        (w) => w.includes("204") || w.toLowerCase().includes("empty body") ||
               w.toLowerCase().includes("no body"),
      );
      expect(has204Warning).toBe(false);
    });
  });

  /**
   * Cases 12–13: body_example warnings.
   */
  describe("generate() — body_example warnings", () => {
    /**
     * Case 12: body_example declared → no warning about missing body.
     */
    it("emits no warning when body_example is declared", () => {
      const gen = new PutIdempotencyGenerator();
      const endpoint = makeEndpoint("PUT", 200, {
        request: { body_example: { id: 1, name: "Bob" } },
      });
      const { warnings } = gen.generate(endpoint, makeCtx());
      const hasMissingBodyWarning = warnings.some(
        (w) => w.toLowerCase().includes("body_example"),
      );
      expect(hasMissingBodyWarning).toBe(false);
    });

    /**
     * Case 13: body_example absent → plan warning with endpoint id and advice.
     */
    it("emits plan warning when body_example is missing", () => {
      const gen = new PutIdempotencyGenerator();
      const endpoint = makeEndpoint("PUT", 200, {
        id: "ep.nobody",
        request: {}, // no body_example
      });
      const { warnings } = gen.generate(endpoint, makeCtx());
      expect(warnings.length).toBeGreaterThan(0);
      const combinedWarnings = warnings.join("\n");
      expect(combinedWarnings).toContain("ep.nobody");
      expect(combinedWarnings.toLowerCase()).toMatch(/body_example/i);
    });
  });

  /**
   * Cases 14–19: Non-PUT methods → zero cases, zero warnings.
   * (Full method-grid and determinism tests are in
   *  put-idempotency-generator-params.test.ts to keep each file ≤ 300 lines.)
   */
  describe("generate() — non-PUT methods → zero cases", () => {
    const nonPutMethods: CanonicalEndpoint["method"][] = [
      "GET",
      "POST",
      "DELETE",
      "PATCH",
      "HEAD",
      "OPTIONS",
    ];

    for (const method of nonPutMethods) {
      it(`emits zero cases for ${method}`, () => {
        const gen = new PutIdempotencyGenerator();
        const { cases } = gen.generate(makeEndpoint(method, 200), makeCtx());
        expect(cases).toHaveLength(0);
      });

      it(`emits zero warnings for ${method}`, () => {
        const gen = new PutIdempotencyGenerator();
        const { warnings } = gen.generate(makeEndpoint(method, 200), makeCtx());
        expect(warnings).toHaveLength(0);
      });
    }
  });
});
