import { describe, it, expect } from "vitest";

import { BodyNegativeGenerator } from "../../../../src/test-catalog/generators/body-negative-generator.js";
import { MarkerClassifier } from "../../../../src/test-catalog/marker-classifier.js";
import { ProdSafetyClassifier } from "../../../../src/test-catalog/prod-safety-classifier.js";
import { TestCaseIdFactory } from "../../../../src/test-catalog/test-case-id.js";
import { SchemaWalker } from "../../../../src/test-catalog/schema-walker.js";
import type { CanonicalEndpoint } from "../../../../src/core/canonical-model.js";
import type { GenerationContext } from "../../../../src/test-catalog/types.js";

/**
 * Unit tests for BodyNegativeGenerator.
 *
 * Covers: full schema (malformed + omission per required + type_violation
 * per typed), example-only (malformed only, no field cases), no schema
 * no example (zero cases), zero required (no omission, malformed+type_violation
 * still), depth-guard warnings propagated from walker, regression marker,
 * prod_safe=false, stable ids, determinism.
 */

function makeCtx(walkerOpts?: { maxDepth: number }): GenerationContext {
  return {
    ids: new TestCaseIdFactory(),
    markers: new MarkerClassifier(),
    prodSafety: new ProdSafetyClassifier(),
    walker: new SchemaWalker(walkerOpts),
  };
}

const twoRequiredEndpoint: CanonicalEndpoint = {
  id: "ep.post",
  name: "Post EP",
  method: "POST",
  url: "/ep",
  request: {
    body_schema: {
      type: "object",
      required: ["email", "name"],
      properties: {
        email: { type: "string" },
        name: { type: "string" },
        age: { type: "integer" },
      },
    },
  },
  response: { expected_status: 201, schema: {} },
};

const noSchemaEndpoint: CanonicalEndpoint = {
  id: "ep.no-body",
  name: "No Body EP",
  method: "GET",
  url: "/ep",
  request: {},
  response: { expected_status: 200, schema: {} },
};

const exampleOnlyEndpoint: CanonicalEndpoint = {
  id: "ep.example",
  name: "Example Only EP",
  method: "POST",
  url: "/ep",
  request: {
    body_example: { key: "value" },
    // body_schema intentionally absent
  },
  response: { expected_status: 201, schema: {} },
};

const zeroRequiredEndpoint: CanonicalEndpoint = {
  id: "ep.zero-required",
  name: "Zero Required EP",
  method: "POST",
  url: "/ep",
  request: {
    body_schema: {
      type: "object",
      properties: {
        label: { type: "string" },
        count: { type: "integer" },
      },
    },
  },
  response: { expected_status: 200, schema: {} },
};

describe("BodyNegativeGenerator", () => {
  describe("constructor — default-seam wiring", () => {
    it("constructs with no arguments", () => {
      expect(() => new BodyNegativeGenerator()).not.toThrow();
    });
  });

  describe("generate() — no body schema and no body_example → zero cases", () => {
    it("emits zero cases when neither body_schema nor body_example is present", () => {
      const gen = new BodyNegativeGenerator();
      const { cases } = gen.generate(noSchemaEndpoint, makeCtx());
      expect(cases).toHaveLength(0);
    });

    it("emits no warnings for an endpoint with no body", () => {
      const gen = new BodyNegativeGenerator();
      const { warnings } = gen.generate(noSchemaEndpoint, makeCtx());
      expect(warnings).toHaveLength(0);
    });
  });

  describe("generate() — body_example only (no body_schema) → only malformed_json", () => {
    it("emits exactly one malformed_json_returns_400 case", () => {
      const gen = new BodyNegativeGenerator();
      const { cases } = gen.generate(exampleOnlyEndpoint, makeCtx());
      expect(cases.filter((c) => c.type === "malformed_json_returns_400")).toHaveLength(1);
    });

    it("does not emit required_field_omission cases when only body_example is present", () => {
      const gen = new BodyNegativeGenerator();
      const { cases } = gen.generate(exampleOnlyEndpoint, makeCtx());
      expect(cases.filter((c) => c.type === "required_field_omission_returns_400")).toHaveLength(0);
    });

    it("does not emit type_violation cases when only body_example is present", () => {
      const gen = new BodyNegativeGenerator();
      const { cases } = gen.generate(exampleOnlyEndpoint, makeCtx());
      expect(cases.filter((c) => c.type === "type_violation_returns_400")).toHaveLength(0);
    });
  });

  describe("generate() — full body schema with 2 required fields and 3 typed fields", () => {
    it("emits exactly one malformed_json_returns_400 case", () => {
      const gen = new BodyNegativeGenerator();
      const { cases } = gen.generate(twoRequiredEndpoint, makeCtx());
      expect(cases.filter((c) => c.type === "malformed_json_returns_400")).toHaveLength(1);
    });

    it("malformed_json params carry a deterministic malformed_body string and expected_status=400", () => {
      const gen = new BodyNegativeGenerator();
      const { cases } = gen.generate(twoRequiredEndpoint, makeCtx());
      const mj = cases.find((c) => c.type === "malformed_json_returns_400")!;
      expect(typeof (mj.params as { malformed_body: string }).malformed_body).toBe("string");
      expect((mj.params as { malformed_body: string }).malformed_body.length).toBeGreaterThan(0);
      expect((mj.params as { expected_status: number }).expected_status).toBe(400);
    });

    it("emits exactly 2 required_field_omission cases (one per required field)", () => {
      const gen = new BodyNegativeGenerator();
      const { cases } = gen.generate(twoRequiredEndpoint, makeCtx());
      expect(cases.filter((c) => c.type === "required_field_omission_returns_400")).toHaveLength(2);
    });

    it("required_field_omission cases name distinct fields", () => {
      const gen = new BodyNegativeGenerator();
      const { cases } = gen.generate(twoRequiredEndpoint, makeCtx());
      const omissions = cases.filter((c) => c.type === "required_field_omission_returns_400");
      const fields = omissions.map((c) => (c.params as { omitted_field: string }).omitted_field);
      expect(new Set(fields).size).toBe(2);
    });

    it("required_field_omission params carry expected_status=400", () => {
      const gen = new BodyNegativeGenerator();
      const { cases } = gen.generate(twoRequiredEndpoint, makeCtx());
      const omissions = cases.filter((c) => c.type === "required_field_omission_returns_400");
      expect(omissions.every((c) => (c.params as { expected_status: number }).expected_status === 400)).toBe(true);
    });

    it("emits exactly 3 type_violation cases (one per typed field)", () => {
      const gen = new BodyNegativeGenerator();
      const { cases } = gen.generate(twoRequiredEndpoint, makeCtx());
      expect(cases.filter((c) => c.type === "type_violation_returns_400")).toHaveLength(3);
    });

    it("type_violation params carry field, original_type, wrong_type, and expected_status=400", () => {
      const gen = new BodyNegativeGenerator();
      const { cases } = gen.generate(twoRequiredEndpoint, makeCtx());
      const violations = cases.filter((c) => c.type === "type_violation_returns_400");
      violations.forEach((v) => {
        const p = v.params as { field: string; original_type: string; wrong_type: string; expected_status: number };
        expect(typeof p.field).toBe("string");
        expect(typeof p.original_type).toBe("string");
        expect(typeof p.wrong_type).toBe("string");
        expect(p.expected_status).toBe(400);
        expect(p.wrong_type).not.toBe(p.original_type);
      });
    });
  });

  describe("generate() — zero required fields", () => {
    it("emits no required_field_omission cases when schema has no required fields", () => {
      const gen = new BodyNegativeGenerator();
      const { cases } = gen.generate(zeroRequiredEndpoint, makeCtx());
      expect(cases.filter((c) => c.type === "required_field_omission_returns_400")).toHaveLength(0);
    });

    it("still emits malformed_json and type_violation cases when schema has no required fields", () => {
      const gen = new BodyNegativeGenerator();
      const { cases } = gen.generate(zeroRequiredEndpoint, makeCtx());
      expect(cases.filter((c) => c.type === "malformed_json_returns_400")).toHaveLength(1);
      expect(cases.filter((c) => c.type === "type_violation_returns_400").length).toBeGreaterThan(0);
    });
  });

  describe("generate() — depth-guard warnings propagated", () => {
    it("propagates depth warnings from the walker into the generator warnings", () => {
      // Use a very small maxDepth so the nested schema exceeds it
      const ctx = makeCtx({ maxDepth: 1 });
      const gen = new BodyNegativeGenerator();
      const deepEndpoint: CanonicalEndpoint = {
        id: "ep.deep",
        name: "Deep",
        method: "POST",
        url: "/deep",
        request: {
          body_schema: {
            type: "object",
            properties: {
              outer: {
                type: "object",
                properties: {
                  inner: { type: "string" },
                },
              },
            },
          },
        },
        response: { expected_status: 201, schema: {} },
      };
      const { warnings } = gen.generate(deepEndpoint, ctx);
      // Walker with maxDepth=1 hits depth limit on nested object
      expect(warnings.some((w) => w.toLowerCase().includes("depth"))).toBe(true);
    });

    it("does not crash when walker returns depth warnings", () => {
      const ctx = makeCtx({ maxDepth: 1 });
      const gen = new BodyNegativeGenerator();
      const deepEndpoint: CanonicalEndpoint = {
        id: "ep.deep2",
        name: "Deep2",
        method: "POST",
        url: "/deep2",
        request: {
          body_schema: {
            type: "object",
            properties: {
              a: { type: "object", properties: { b: { type: "string" } } },
            },
          },
        },
        response: { expected_status: 201, schema: {} },
      };
      expect(() => gen.generate(deepEndpoint, ctx)).not.toThrow();
    });
  });

  describe("generate() — marker and prod_safe", () => {
    it("marks all cases as regression", () => {
      const gen = new BodyNegativeGenerator();
      const { cases } = gen.generate(twoRequiredEndpoint, makeCtx());
      expect(cases.every((c) => c.marker === "regression")).toBe(true);
    });

    it("marks all cases as prod_safe=false", () => {
      const gen = new BodyNegativeGenerator();
      const { cases } = gen.generate(twoRequiredEndpoint, makeCtx());
      expect(cases.every((c) => c.prod_safe === false)).toBe(true);
    });
  });

  describe("generate() — stable ids and ordering", () => {
    it("assigns unique ids within the case set", () => {
      const gen = new BodyNegativeGenerator();
      const { cases } = gen.generate(twoRequiredEndpoint, makeCtx());
      const ids = cases.map((c) => c.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it("ordered: malformed_json first, then omissions (walker order), then type_violations", () => {
      const gen = new BodyNegativeGenerator();
      const { cases } = gen.generate(twoRequiredEndpoint, makeCtx());
      const malformedIdx = cases.findIndex((c) => c.type === "malformed_json_returns_400");
      const omissionIdx = cases.findIndex((c) => c.type === "required_field_omission_returns_400");
      const violationIdx = cases.findIndex((c) => c.type === "type_violation_returns_400");
      expect(malformedIdx).toBeLessThan(omissionIdx);
      expect(omissionIdx).toBeLessThan(violationIdx);
    });
  });

  describe("generate() — determinism", () => {
    it("produces byte-identical results for two runs on the same endpoint", () => {
      const gen = new BodyNegativeGenerator();
      const r1 = gen.generate(twoRequiredEndpoint, makeCtx());
      const r2 = gen.generate(twoRequiredEndpoint, makeCtx());
      expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
    });
  });
});
