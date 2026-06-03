/**
 * Unit tests for PutIdempotencyGenerator — params shape, id stability,
 * and determinism. Split from put-idempotency-generator.test.ts to keep
 * each file within the 300-line soft limit.
 *
 * Covers:
 *   - Case 20: Determinism — byte-identical output across two independent calls,
 *     for both body_equality and db_state compare modes.
 *   - Stable case ids matching the expected charset.
 *   - prod_safe field is boolean false (regression cases are not prod-safe).
 *   - Case has a non-empty title string.
 *   - Case has non-empty endpoint_id matching the input endpoint.
 *
 * Design decisions pinned:
 *   DD-6  prod_safe: false is automatic via classifier (regression cases).
 *   DD-9  compare is a two-literal union ("body_equality" | "db_state").
 *   DD-10 putIdempotencyVerdict is pure (no I/O); generator is pure too.
 */

import { describe, it, expect } from "vitest";

import { PutIdempotencyGenerator } from "../../../../src/test-catalog/generators/put-idempotency-generator.js";
import { MarkerClassifier } from "../../../../src/test-catalog/marker-classifier.js";
import { ProdSafetyClassifier } from "../../../../src/test-catalog/prod-safety-classifier.js";
import { TestCaseIdFactory } from "../../../../src/test-catalog/test-case-id.js";
import { SchemaWalker } from "../../../../src/test-catalog/schema-walker.js";
import type { CanonicalEndpoint } from "../../../../src/core/canonical-model.js";
import type { GenerationContext } from "../../../../src/test-catalog/types.js";

// ---------------------------------------------------------------------------
// Helpers (mirror main test file)
// ---------------------------------------------------------------------------

function makeCtx(): GenerationContext {
  return {
    ids: new TestCaseIdFactory(),
    markers: new MarkerClassifier(),
    prodSafety: new ProdSafetyClassifier(),
    walker: new SchemaWalker(),
  };
}

function makePutEndpoint(
  id: string,
  overrides: Partial<CanonicalEndpoint> = {},
): CanonicalEndpoint {
  return {
    id,
    name: `PUT ${id}`,
    method: "PUT",
    url: "/ep",
    request: { body_example: { x: 1 } },
    response: { expected_status: 200, schema: {} },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PutIdempotencyGenerator — params shape, ids, determinism", () => {

  /**
   * Case 20 (a): Determinism for body_equality mode.
   */
  describe("determinism — body_equality mode", () => {
    it("produces byte-identical results for two runs without db_verify", () => {
      const gen = new PutIdempotencyGenerator();
      const endpoint = makePutEndpoint("ep.put.nodelete", {
        request: { body_example: { id: 1, name: "Alice" } },
      });
      const r1 = gen.generate(endpoint, makeCtx());
      const r2 = gen.generate(endpoint, makeCtx());
      expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
    });

    it("produces byte-identical results for two runs with empty db_verify", () => {
      const gen = new PutIdempotencyGenerator();
      const endpoint = makePutEndpoint("ep.put.emptydb", {
        db_verify: [],
      });
      const r1 = gen.generate(endpoint, makeCtx());
      const r2 = gen.generate(endpoint, makeCtx());
      expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
    });
  });

  /**
   * Case 20 (b): Determinism for db_state mode.
   */
  describe("determinism — db_state mode", () => {
    it("produces byte-identical results for two runs with db_verify", () => {
      const gen = new PutIdempotencyGenerator();
      const endpoint = makePutEndpoint("ep.put.db", {
        request: { body_example: { id: 1 } },
        db_verify: [
          { connection: "primary", query: "SELECT id FROM items WHERE id = 1", expect: "exists" },
        ],
      });
      const r1 = gen.generate(endpoint, makeCtx());
      const r2 = gen.generate(endpoint, makeCtx());
      expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
    });
  });

  /**
   * Stable ids across two independent runs.
   */
  describe("stable ids", () => {
    it("assigns stable ids across two runs", () => {
      const gen = new PutIdempotencyGenerator();
      const endpoint = makePutEndpoint("ep.stable");
      const { cases: c1 } = gen.generate(endpoint, makeCtx());
      const { cases: c2 } = gen.generate(endpoint, makeCtx());
      expect(c1[0]?.id).toBe(c2[0]?.id);
    });

    it("assigns id matching ^[a-z0-9._-]+$", () => {
      const gen = new PutIdempotencyGenerator();
      const endpoint = makePutEndpoint("ep.charset");
      const { cases } = gen.generate(endpoint, makeCtx());
      expect(cases[0]?.id).toMatch(/^[a-z0-9._-]+$/);
    });
  });

  /**
   * Case field invariants on the emitted TestCase.
   */
  describe("emitted case field invariants", () => {
    it("emitted case has prod_safe === false (regression cases are not prod-safe)", () => {
      const gen = new PutIdempotencyGenerator();
      const endpoint = makePutEndpoint("ep.prodsafe", {
        request: { body_example: { x: 1 } },
      });
      const { cases } = gen.generate(endpoint, makeCtx());
      expect(cases[0]?.prod_safe).toBe(false);
    });

    it("emitted case has a non-empty title string", () => {
      const gen = new PutIdempotencyGenerator();
      const endpoint = makePutEndpoint("ep.title");
      const { cases } = gen.generate(endpoint, makeCtx());
      expect(typeof cases[0]?.title).toBe("string");
      expect((cases[0]?.title ?? "").length).toBeGreaterThan(0);
    });

    it("emitted case has endpoint_id matching the input endpoint's id", () => {
      const gen = new PutIdempotencyGenerator();
      const endpoint = makePutEndpoint("ep.endpointid");
      const { cases } = gen.generate(endpoint, makeCtx());
      expect(cases[0]?.endpoint_id).toBe("ep.endpointid");
    });
  });
});
