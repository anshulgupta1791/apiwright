import { describe, it, expect, beforeEach } from "vitest";

import { UniversalGenerator } from "../../../../src/test-catalog/generators/universal-generator.js";
import { MarkerClassifier } from "../../../../src/test-catalog/marker-classifier.js";
import { ProdSafetyClassifier } from "../../../../src/test-catalog/prod-safety-classifier.js";
import { TestCaseIdFactory } from "../../../../src/test-catalog/test-case-id.js";
import { SchemaWalker } from "../../../../src/test-catalog/schema-walker.js";
import type { CanonicalEndpoint } from "../../../../src/core/canonical-model.js";
import type { GenerationContext } from "../../../../src/test-catalog/types.js";

/**
 * Unit tests for UniversalGenerator.
 *
 * Covers: the 5 always-emitted smoke test cases for any endpoint, the
 * response_time_sla delegated vs explicit behavior, auth_happy_path with
 * and without auth_strategy, prod_safe classification, stable ids, and
 * determinism (deep-equality of two runs).
 */

function makeCtx(): GenerationContext {
  return {
    ids: new TestCaseIdFactory(),
    markers: new MarkerClassifier(),
    prodSafety: new ProdSafetyClassifier(),
    walker: new SchemaWalker(),
  };
}

const baseGetEndpoint: CanonicalEndpoint = {
  id: "test.get",
  name: "Test GET",
  method: "GET",
  url: "/test",
  request: {},
  response: {
    expected_status: 200,
    schema: { type: "object" },
    sla_ms: 500,
  },
};

const basePostEndpoint: CanonicalEndpoint = {
  id: "test.post",
  name: "Test POST",
  method: "POST",
  url: "/test",
  auth_strategy: "user_token",
  request: {},
  response: {
    expected_status: 201,
    schema: { type: "object" },
  },
};

describe("UniversalGenerator", () => {
  describe("constructor — default-seam wiring", () => {
    it("constructs with no arguments", () => {
      expect(() => new UniversalGenerator()).not.toThrow();
    });
  });

  describe("generate() — emits 5 universal cases when a response schema is declared", () => {
    let generator: UniversalGenerator;
    let ctx: GenerationContext;

    beforeEach(() => {
      generator = new UniversalGenerator();
      ctx = makeCtx();
    });

    it("emits exactly 5 cases for a GET endpoint", () => {
      const { cases } = generator.generate(baseGetEndpoint, ctx);
      expect(cases).toHaveLength(5);
    });

    it("emits exactly 5 cases for a POST endpoint", () => {
      const { cases } = generator.generate(basePostEndpoint, ctx);
      expect(cases).toHaveLength(5);
    });

    it("emits no warnings for a well-formed endpoint", () => {
      const { warnings } = generator.generate(baseGetEndpoint, ctx);
      expect(warnings).toHaveLength(0);
    });

    it("treats an empty schema object as declared (still emits the case, no warning)", () => {
      const emptySchema: CanonicalEndpoint = {
        ...baseGetEndpoint,
        response: { expected_status: 200, schema: {} },
      };
      const { cases, warnings } = generator.generate(emptySchema, ctx);
      expect(cases.some((c) => c.type === "response_schema_validation")).toBe(true);
      expect(warnings).toHaveLength(0);
    });
  });

  describe("generate() — bodyless endpoint (no response.schema, issue #35)", () => {
    const noSchemaEndpoint: CanonicalEndpoint = {
      id: "test.delete",
      name: "Test DELETE",
      method: "DELETE",
      url: "/test/1",
      request: {},
      response: { expected_status: 204 },
    };

    it("emits exactly 4 cases (drops response_schema_validation)", () => {
      const { cases } = new UniversalGenerator().generate(noSchemaEndpoint, makeCtx());
      expect(cases).toHaveLength(4);
    });

    it("does NOT emit a response_schema_validation case", () => {
      const { cases } = new UniversalGenerator().generate(noSchemaEndpoint, makeCtx());
      expect(cases.some((c) => c.type === "response_schema_validation")).toBe(false);
    });

    it("still emits the other 4 universal cases", () => {
      const { cases } = new UniversalGenerator().generate(noSchemaEndpoint, makeCtx());
      const types = cases.map((c) => c.type);
      expect(types).toEqual([
        "status_code_conformance",
        "content_type_alignment",
        "auth_happy_path",
        "response_time_sla",
      ]);
    });

    it("emits a skip warning naming the endpoint", () => {
      const { warnings } = new UniversalGenerator().generate(noSchemaEndpoint, makeCtx());
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("test.delete");
      expect(warnings[0]).toContain("response_schema_validation skipped");
    });
  });

  describe("generate() — status_code_conformance case", () => {
    it("emits a status_code_conformance case with params.expected_status from response", () => {
      const gen = new UniversalGenerator();
      const { cases } = gen.generate(baseGetEndpoint, makeCtx());
      const scc = cases.find((c) => c.type === "status_code_conformance");
      expect(scc).toBeDefined();
      expect((scc!.params as { expected_status: number }).expected_status).toBe(200);
    });

    it("carries the correct expected_status from a 201 endpoint", () => {
      const gen = new UniversalGenerator();
      const { cases } = gen.generate(basePostEndpoint, makeCtx());
      const scc = cases.find((c) => c.type === "status_code_conformance");
      expect((scc!.params as { expected_status: number }).expected_status).toBe(201);
    });
  });

  describe("generate() — content_type_alignment case", () => {
    it("emits a content_type_alignment case", () => {
      const gen = new UniversalGenerator();
      const { cases } = gen.generate(baseGetEndpoint, makeCtx());
      const cta = cases.find((c) => c.type === "content_type_alignment");
      expect(cta).toBeDefined();
    });
  });

  describe("generate() — response_schema_validation case", () => {
    it("emits a response_schema_validation case with params.schema from response", () => {
      const gen = new UniversalGenerator();
      const { cases } = gen.generate(baseGetEndpoint, makeCtx());
      const rsv = cases.find((c) => c.type === "response_schema_validation");
      expect(rsv).toBeDefined();
      expect((rsv!.params as { schema: unknown }).schema).toEqual({ type: "object" });
    });
  });

  describe("generate() — auth_happy_path case", () => {
    it("emits auth_happy_path with auth_strategy name for authenticated endpoint", () => {
      const gen = new UniversalGenerator();
      const { cases } = gen.generate(basePostEndpoint, makeCtx());
      const ahp = cases.find((c) => c.type === "auth_happy_path");
      expect(ahp).toBeDefined();
      expect((ahp!.params as { auth_strategy: unknown }).auth_strategy).toBe("user_token");
      expect((ahp!.params as { unauthenticated: boolean }).unauthenticated).toBe(false);
    });

    it("emits auth_happy_path with unauthenticated=true for endpoint with no auth_strategy", () => {
      const gen = new UniversalGenerator();
      const { cases } = gen.generate(baseGetEndpoint, makeCtx());
      const ahp = cases.find((c) => c.type === "auth_happy_path");
      expect(ahp).toBeDefined();
      expect((ahp!.params as { unauthenticated: boolean }).unauthenticated).toBe(true);
      expect((ahp!.params as { auth_strategy: unknown }).auth_strategy).toBeNull();
    });

    it("does NOT silently drop auth_happy_path on an unauthenticated endpoint", () => {
      const gen = new UniversalGenerator();
      const { cases } = gen.generate(baseGetEndpoint, makeCtx());
      const ahp = cases.filter((c) => c.type === "auth_happy_path");
      expect(ahp).toHaveLength(1);
    });
  });

  describe("generate() — response_time_sla case", () => {
    it("emits response_time_sla with sla_ms and sla_delegated=false when sla_ms is present", () => {
      const gen = new UniversalGenerator();
      const { cases } = gen.generate(baseGetEndpoint, makeCtx());
      const rts = cases.find((c) => c.type === "response_time_sla");
      expect(rts).toBeDefined();
      expect((rts!.params as { sla_ms: unknown }).sla_ms).toBe(500);
      expect((rts!.params as { sla_delegated: boolean }).sla_delegated).toBe(false);
    });

    it("emits response_time_sla with sla_delegated=true and no sla_ms key when sla_ms is absent", () => {
      const gen = new UniversalGenerator();
      const endpointNoSla: CanonicalEndpoint = {
        ...basePostEndpoint,
        response: { expected_status: 201, schema: {} },
        // sla_ms intentionally absent
      };
      const { cases } = gen.generate(endpointNoSla, makeCtx());
      const rts = cases.find((c) => c.type === "response_time_sla");
      expect(rts).toBeDefined();
      expect((rts!.params as { sla_delegated: boolean }).sla_delegated).toBe(true);
      // sla_ms key must be absent (not undefined) for JSON round-trip safety
      expect("sla_ms" in rts!.params).toBe(false);
    });

    it("always emits response_time_sla regardless of sla_ms presence", () => {
      const gen = new UniversalGenerator();
      const endpointNoSla: CanonicalEndpoint = {
        ...basePostEndpoint,
        response: { expected_status: 201, schema: {} },
      };
      const { cases: withSla } = gen.generate(baseGetEndpoint, makeCtx());
      const { cases: withoutSla } = gen.generate(endpointNoSla, makeCtx());
      expect(withSla.filter((c) => c.type === "response_time_sla")).toHaveLength(1);
      expect(withoutSla.filter((c) => c.type === "response_time_sla")).toHaveLength(1);
    });
  });

  describe("generate() — marker and prod_safe classification", () => {
    it("marks all cases as smoke", () => {
      const gen = new UniversalGenerator();
      const { cases } = gen.generate(baseGetEndpoint, makeCtx());
      expect(cases.every((c) => c.marker === "smoke")).toBe(true);
    });

    it("marks smoke cases on GET endpoint as prod_safe=true", () => {
      const gen = new UniversalGenerator();
      const { cases } = gen.generate(baseGetEndpoint, makeCtx());
      expect(cases.every((c) => c.prod_safe === true)).toBe(true);
    });

    it("marks smoke cases on POST endpoint as prod_safe=false when prod_safe not set", () => {
      const gen = new UniversalGenerator();
      const { cases } = gen.generate(basePostEndpoint, makeCtx());
      expect(cases.every((c) => c.prod_safe === false)).toBe(true);
    });

    it("marks smoke cases on POST endpoint as prod_safe=true when prod_safe=true", () => {
      const gen = new UniversalGenerator();
      const prodSafeEndpoint: CanonicalEndpoint = {
        ...basePostEndpoint,
        prod_safe: true,
      };
      const { cases } = gen.generate(prodSafeEndpoint, makeCtx());
      expect(cases.every((c) => c.prod_safe === true)).toBe(true);
    });
  });

  describe("generate() — stable ids and ordering", () => {
    it("assigns stable ids via makeTestCaseId", () => {
      const gen = new UniversalGenerator();
      const { cases: c1 } = gen.generate(baseGetEndpoint, makeCtx());
      const { cases: c2 } = gen.generate(baseGetEndpoint, makeCtx());
      expect(c1.map((c) => c.id)).toEqual(c2.map((c) => c.id));
    });

    it("emits cases in the fixed order: status_code_conformance first", () => {
      const gen = new UniversalGenerator();
      const { cases } = gen.generate(baseGetEndpoint, makeCtx());
      expect(cases[0].type).toBe("status_code_conformance");
    });

    it("has all cases with endpoint_id equal to the endpoint id", () => {
      const gen = new UniversalGenerator();
      const { cases } = gen.generate(baseGetEndpoint, makeCtx());
      expect(cases.every((c) => c.endpoint_id === "test.get")).toBe(true);
    });

    it("has unique ids within the case set", () => {
      const gen = new UniversalGenerator();
      const { cases } = gen.generate(baseGetEndpoint, makeCtx());
      const ids = cases.map((c) => c.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  describe("generate() — determinism", () => {
    it("produces byte-identical results for two runs on the same endpoint", () => {
      const gen = new UniversalGenerator();
      const r1 = gen.generate(baseGetEndpoint, makeCtx());
      const r2 = gen.generate(baseGetEndpoint, makeCtx());
      expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
    });
  });
});
