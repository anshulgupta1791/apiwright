import { describe, it, expect } from "vitest";

import { parseJson } from "../../../src/core/safe-json.js";
import { AssertionBinder } from "../../../src/test-catalog/assertion-binder.js";
import { MarkerClassifier } from "../../../src/test-catalog/marker-classifier.js";
import { ProdSafetyClassifier } from "../../../src/test-catalog/prod-safety-classifier.js";
import { TestCaseIdFactory } from "../../../src/test-catalog/test-case-id.js";
import { SchemaWalker } from "../../../src/test-catalog/schema-walker.js";
import type { CanonicalEndpoint } from "../../../src/core/canonical-model.js";
import type { GenerationContext, AssertionParams } from "../../../src/test-catalog/types.js";

/**
 * Unit tests for AssertionBinder.
 *
 * Covers: M assertion strings → M bound entries (verbatim, stable id, regression);
 * no assertions (absent/empty) → zero entries; no parse/interpret/reject; declared
 * order; regression marker; prod_safe=false; stable ids; JSON-serializable shape;
 * determinism.
 */

function makeCtx(): GenerationContext {
  return {
    ids: new TestCaseIdFactory(),
    markers: new MarkerClassifier(),
    prodSafety: new ProdSafetyClassifier(),
    walker: new SchemaWalker(),
  };
}

const endpointWith2Assertions: CanonicalEndpoint = {
  id: "ep.create",
  name: "Create",
  method: "POST",
  url: "/ep",
  request: {},
  response: { expected_status: 201, schema: {} },
  assertions: [
    "response.body.id is_uuid_v4",
    "response.body.email equals request.body.email",
  ],
};

const endpointNoAssertions: CanonicalEndpoint = {
  id: "ep.no-assert",
  name: "No Assertions",
  method: "GET",
  url: "/ep",
  request: {},
  response: { expected_status: 200, schema: {} },
};

const endpointEmptyAssertions: CanonicalEndpoint = {
  id: "ep.empty-assert",
  name: "Empty Assertions",
  method: "GET",
  url: "/ep",
  request: {},
  response: { expected_status: 200, schema: {} },
  assertions: [],
};

describe("AssertionBinder", () => {
  describe("constructor — default-seam wiring", () => {
    it("constructs with no arguments", () => {
      expect(() => new AssertionBinder()).not.toThrow();
    });
  });

  describe("generate() — M assertion strings → M bound TestCase entries", () => {
    it("emits exactly 2 entries for 2 assertions", () => {
      const binder = new AssertionBinder();
      const { cases } = binder.generate(endpointWith2Assertions, makeCtx());
      expect(cases).toHaveLength(2);
    });

    it("each entry has type=assertion", () => {
      const binder = new AssertionBinder();
      const { cases } = binder.generate(endpointWith2Assertions, makeCtx());
      expect(cases.every((c) => c.type === "assertion")).toBe(true);
    });

    it("carries the verbatim assertion string in params.assertion", () => {
      const binder = new AssertionBinder();
      const { cases } = binder.generate(endpointWith2Assertions, makeCtx());
      expect((cases[0].params as AssertionParams).assertion).toBe("response.body.id is_uuid_v4");
      expect((cases[1].params as AssertionParams).assertion).toBe(
        "response.body.email equals request.body.email",
      );
    });

    it("does NOT parse, interpret, or reject assertion syntax", () => {
      // Even syntactically invalid assertions must pass through verbatim
      const binder = new AssertionBinder();
      const epWithWeirdAssertion: CanonicalEndpoint = {
        ...endpointNoAssertions,
        id: "ep.weird",
        assertions: ["this is not valid assertion syntax #$%!@"],
      };
      const { cases } = binder.generate(epWithWeirdAssertion, makeCtx());
      expect(cases).toHaveLength(1);
      expect((cases[0].params as AssertionParams).assertion).toBe(
        "this is not valid assertion syntax #$%!@",
      );
    });

    it("each entry has endpoint_id equal to the endpoint id", () => {
      const binder = new AssertionBinder();
      const { cases } = binder.generate(endpointWith2Assertions, makeCtx());
      expect(cases.every((c) => c.endpoint_id === "ep.create")).toBe(true);
    });

    it("follows declared assertions array order", () => {
      const binder = new AssertionBinder();
      const { cases } = binder.generate(endpointWith2Assertions, makeCtx());
      expect((cases[0].params as AssertionParams).assertion).toBe("response.body.id is_uuid_v4");
      expect((cases[1].params as AssertionParams).assertion).toBe(
        "response.body.email equals request.body.email",
      );
    });
  });

  describe("generate() — no assertions → zero entries, no warning", () => {
    it("emits zero entries when assertions is absent", () => {
      const binder = new AssertionBinder();
      const { cases } = binder.generate(endpointNoAssertions, makeCtx());
      expect(cases).toHaveLength(0);
    });

    it("emits no warnings when assertions is absent", () => {
      const binder = new AssertionBinder();
      const { warnings } = binder.generate(endpointNoAssertions, makeCtx());
      expect(warnings).toHaveLength(0);
    });

    it("emits zero entries when assertions is an empty array", () => {
      const binder = new AssertionBinder();
      const { cases } = binder.generate(endpointEmptyAssertions, makeCtx());
      expect(cases).toHaveLength(0);
    });

    it("emits no warnings when assertions is empty array", () => {
      const binder = new AssertionBinder();
      const { warnings } = binder.generate(endpointEmptyAssertions, makeCtx());
      expect(warnings).toHaveLength(0);
    });
  });

  describe("generate() — marker and prod_safe", () => {
    it("marks all entries as SMOKE (issue #67 — assertions run with the smoke catalog so default --markers smoke executes them)", () => {
      const binder = new AssertionBinder();
      const { cases } = binder.generate(endpointWith2Assertions, makeCtx());
      expect(cases.every((c) => c.marker === "smoke")).toBe(true);
    });

    it("marks all entries as prod_safe=false", () => {
      const binder = new AssertionBinder();
      const { cases } = binder.generate(endpointWith2Assertions, makeCtx());
      expect(cases.every((c) => c.prod_safe === false)).toBe(true);
    });
  });

  describe("generate() — stable ids", () => {
    it("assigns unique ids within the entry set", () => {
      const binder = new AssertionBinder();
      const { cases } = binder.generate(endpointWith2Assertions, makeCtx());
      const ids = cases.map((c) => c.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it("ids match ^[a-z0-9._-]+$", () => {
      const binder = new AssertionBinder();
      const { cases } = binder.generate(endpointWith2Assertions, makeCtx());
      cases.forEach((c) => expect(c.id).toMatch(/^[a-z0-9._-]+$/));
    });

    it("ids are stable across two runs", () => {
      const binder = new AssertionBinder();
      const { cases: c1 } = binder.generate(endpointWith2Assertions, makeCtx());
      const { cases: c2 } = binder.generate(endpointWith2Assertions, makeCtx());
      expect(c1.map((c) => c.id)).toEqual(c2.map((c) => c.id));
    });
  });

  describe("generate() — JSON-serializable shape", () => {
    it("entries are fully JSON-serializable (no undefined values, no functions)", () => {
      const binder = new AssertionBinder();
      const { cases } = binder.generate(endpointWith2Assertions, makeCtx());
      const serialized = JSON.stringify(cases);
      expect(serialized).not.toContain("undefined");
      const roundTrip = parseJson(serialized);
      expect(roundTrip.ok).toBe(true);
    });
  });

  describe("generate() — determinism", () => {
    it("produces byte-identical results for two runs on the same endpoint", () => {
      const binder = new AssertionBinder();
      const r1 = binder.generate(endpointWith2Assertions, makeCtx());
      const r2 = binder.generate(endpointWith2Assertions, makeCtx());
      expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
    });
  });
});
