import { describe, it, expect } from "vitest";

import { BoundaryBatteryGenerator } from "../../../../src/test-catalog/generators/boundary-battery-generator.js";
import { MarkerClassifier } from "../../../../src/test-catalog/marker-classifier.js";
import { ProdSafetyClassifier } from "../../../../src/test-catalog/prod-safety-classifier.js";
import { TestCaseIdFactory } from "../../../../src/test-catalog/test-case-id.js";
import { SchemaWalker } from "../../../../src/test-catalog/schema-walker.js";
import type { CanonicalEndpoint } from "../../../../src/core/canonical-model.js";
import type { GenerationContext, BoundaryParams } from "../../../../src/test-catalog/types.js";

/**
 * Unit tests for BoundaryBatteryGenerator.
 *
 * Covers: minimum/maximum numeric inside+outside cases, minLength/maxLength
 * string inside+outside, enum in-bound/out-of-bound, empty enum suppression,
 * minLength=0 outside-case suppression, no constrained fields → zero cases,
 * no body schema → zero cases, depth-warning propagation, regression marker,
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

function makeEndpointWith(bodySchema: Record<string, unknown>): CanonicalEndpoint {
  return {
    id: "ep.test",
    name: "Test",
    method: "POST",
    url: "/ep",
    request: { body_schema: bodySchema },
    response: { expected_status: 201, schema: {} },
  };
}

describe("BoundaryBatteryGenerator", () => {
  describe("constructor — default-seam wiring", () => {
    it("constructs with no arguments", () => {
      expect(() => new BoundaryBatteryGenerator()).not.toThrow();
    });
  });

  describe("generate() — no body schema → zero cases", () => {
    it("emits zero cases when endpoint has no body_schema", () => {
      const gen = new BoundaryBatteryGenerator();
      const ep: CanonicalEndpoint = {
        id: "ep.no-schema",
        name: "No Schema",
        method: "POST",
        url: "/ep",
        request: {},
        response: { expected_status: 201, schema: {} },
      };
      const { cases } = gen.generate(ep, makeCtx());
      expect(cases).toHaveLength(0);
    });
  });

  describe("generate() — unconstrained fields → zero boundary cases", () => {
    it("emits zero boundary cases when no field has any constraint", () => {
      const gen = new BoundaryBatteryGenerator();
      const { cases } = gen.generate(
        makeEndpointWith({
          type: "object",
          properties: {
            name: { type: "string" }, // no minLength/maxLength/enum
            count: { type: "integer" }, // no minimum/maximum
          },
        }),
        makeCtx(),
      );
      expect(cases).toHaveLength(0);
    });
  });

  describe("generate() — minimum constraint", () => {
    it("emits an inside case (value=m, success status) for minimum", () => {
      const gen = new BoundaryBatteryGenerator();
      const { cases } = gen.generate(
        makeEndpointWith({
          type: "object",
          properties: { age: { type: "integer", minimum: 18 } },
        }),
        makeCtx(),
      );
      const inside = cases.find(
        (c) => c.type === "boundary_battery" && (c.params as BoundaryParams).position === "inside"
          && (c.params as BoundaryParams).constraint === "minimum",
      );
      expect(inside).toBeDefined();
      expect((inside!.params as BoundaryParams).value).toBe(18);
      expect((inside!.params as BoundaryParams).expected_status).toBe(201);
    });

    it("emits an outside case (value=m-1, status=400) for minimum", () => {
      const gen = new BoundaryBatteryGenerator();
      const { cases } = gen.generate(
        makeEndpointWith({
          type: "object",
          properties: { age: { type: "integer", minimum: 18 } },
        }),
        makeCtx(),
      );
      const outside = cases.find(
        (c) => c.type === "boundary_battery" && (c.params as BoundaryParams).position === "outside"
          && (c.params as BoundaryParams).constraint === "minimum",
      );
      expect(outside).toBeDefined();
      expect((outside!.params as BoundaryParams).value).toBe(17);
      expect((outside!.params as BoundaryParams).expected_status).toBe(400);
    });
  });

  describe("generate() — maximum constraint", () => {
    it("emits an inside case (value=M, success status) for maximum", () => {
      const gen = new BoundaryBatteryGenerator();
      const { cases } = gen.generate(
        makeEndpointWith({
          type: "object",
          properties: { score: { type: "integer", maximum: 100 } },
        }),
        makeCtx(),
      );
      const inside = cases.find(
        (c) => c.type === "boundary_battery" && (c.params as BoundaryParams).position === "inside"
          && (c.params as BoundaryParams).constraint === "maximum",
      );
      expect(inside).toBeDefined();
      expect((inside!.params as BoundaryParams).value).toBe(100);
      expect((inside!.params as BoundaryParams).expected_status).toBe(201);
    });

    it("emits an outside case (value=M+1, status=400) for maximum", () => {
      const gen = new BoundaryBatteryGenerator();
      const { cases } = gen.generate(
        makeEndpointWith({
          type: "object",
          properties: { score: { type: "integer", maximum: 100 } },
        }),
        makeCtx(),
      );
      const outside = cases.find(
        (c) => c.type === "boundary_battery" && (c.params as BoundaryParams).position === "outside"
          && (c.params as BoundaryParams).constraint === "maximum",
      );
      expect(outside).toBeDefined();
      expect((outside!.params as BoundaryParams).value).toBe(101);
      expect((outside!.params as BoundaryParams).expected_status).toBe(400);
    });
  });

  describe("generate() — minLength constraint", () => {
    it("emits an inside case (string of length n) for minLength", () => {
      const gen = new BoundaryBatteryGenerator();
      const { cases } = gen.generate(
        makeEndpointWith({
          type: "object",
          properties: { tag: { type: "string", minLength: 3 } },
        }),
        makeCtx(),
      );
      const inside = cases.find(
        (c) => c.type === "boundary_battery" && (c.params as BoundaryParams).position === "inside"
          && (c.params as BoundaryParams).constraint === "minLength",
      );
      expect(inside).toBeDefined();
      expect(typeof (inside!.params as BoundaryParams).value).toBe("string");
      expect(((inside!.params as BoundaryParams).value as string).length).toBe(3);
    });

    it("emits an outside case (string of length n-1, status=400) for minLength > 0", () => {
      const gen = new BoundaryBatteryGenerator();
      const { cases } = gen.generate(
        makeEndpointWith({
          type: "object",
          properties: { tag: { type: "string", minLength: 3 } },
        }),
        makeCtx(),
      );
      const outside = cases.find(
        (c) => c.type === "boundary_battery" && (c.params as BoundaryParams).position === "outside"
          && (c.params as BoundaryParams).constraint === "minLength",
      );
      expect(outside).toBeDefined();
      expect(((outside!.params as BoundaryParams).value as string).length).toBe(2);
      expect((outside!.params as BoundaryParams).expected_status).toBe(400);
    });

    it("suppresses the outside case when minLength === 0 (no negative-length string is constructible)", () => {
      const gen = new BoundaryBatteryGenerator();
      const { cases } = gen.generate(
        makeEndpointWith({
          type: "object",
          properties: { tag: { type: "string", minLength: 0 } },
        }),
        makeCtx(),
      );
      const outsideMinLength0 = cases.filter(
        (c) => c.type === "boundary_battery"
          && (c.params as BoundaryParams).constraint === "minLength"
          && (c.params as BoundaryParams).position === "outside",
      );
      expect(outsideMinLength0).toHaveLength(0);
    });
  });

  describe("generate() — maxLength constraint", () => {
    it("emits an inside case (string of length x) for maxLength", () => {
      const gen = new BoundaryBatteryGenerator();
      const { cases } = gen.generate(
        makeEndpointWith({
          type: "object",
          properties: { name: { type: "string", maxLength: 50 } },
        }),
        makeCtx(),
      );
      const inside = cases.find(
        (c) => c.type === "boundary_battery" && (c.params as BoundaryParams).position === "inside"
          && (c.params as BoundaryParams).constraint === "maxLength",
      );
      expect(inside).toBeDefined();
      expect(((inside!.params as BoundaryParams).value as string).length).toBe(50);
    });

    it("emits an outside case (string of length x+1, status=400) for maxLength", () => {
      const gen = new BoundaryBatteryGenerator();
      const { cases } = gen.generate(
        makeEndpointWith({
          type: "object",
          properties: { name: { type: "string", maxLength: 50 } },
        }),
        makeCtx(),
      );
      const outside = cases.find(
        (c) => c.type === "boundary_battery" && (c.params as BoundaryParams).position === "outside"
          && (c.params as BoundaryParams).constraint === "maxLength",
      );
      expect(outside).toBeDefined();
      expect(((outside!.params as BoundaryParams).value as string).length).toBe(51);
      expect((outside!.params as BoundaryParams).expected_status).toBe(400);
    });
  });

  describe("generate() — enum constraint", () => {
    it("emits an inside case (first enum member, success status) for enum", () => {
      const gen = new BoundaryBatteryGenerator();
      const { cases } = gen.generate(
        makeEndpointWith({
          type: "object",
          properties: { role: { type: "string", enum: ["admin", "user"] } },
        }),
        makeCtx(),
      );
      const inside = cases.find(
        (c) => c.type === "boundary_battery" && (c.params as BoundaryParams).position === "inside"
          && (c.params as BoundaryParams).constraint === "enum",
      );
      expect(inside).toBeDefined();
      expect((inside!.params as BoundaryParams).value).toBe("admin");
    });

    it("emits an outside case (value provably not in enum, status=400)", () => {
      const gen = new BoundaryBatteryGenerator();
      const { cases } = gen.generate(
        makeEndpointWith({
          type: "object",
          properties: { role: { type: "string", enum: ["admin", "user"] } },
        }),
        makeCtx(),
      );
      const outside = cases.find(
        (c) => c.type === "boundary_battery" && (c.params as BoundaryParams).position === "outside"
          && (c.params as BoundaryParams).constraint === "enum",
      );
      expect(outside).toBeDefined();
      const outValue = (outside!.params as BoundaryParams).value;
      expect(["admin", "user"]).not.toContain(outValue);
      expect((outside!.params as BoundaryParams).expected_status).toBe(400);
    });

    it("emits no enum boundary cases for an empty enum array", () => {
      const gen = new BoundaryBatteryGenerator();
      const { cases } = gen.generate(
        makeEndpointWith({
          type: "object",
          properties: { role: { type: "string", enum: [] } },
        }),
        makeCtx(),
      );
      const enumCases = cases.filter(
        (c) => c.type === "boundary_battery" && (c.params as BoundaryParams).constraint === "enum",
      );
      expect(enumCases).toHaveLength(0);
    });
  });

  describe("generate() — depth-warning propagation", () => {
    it("propagates depth warnings from the walker", () => {
      const ctx = makeCtx({ maxDepth: 1 });
      const gen = new BoundaryBatteryGenerator();
      const ep = makeEndpointWith({
        type: "object",
        properties: {
          outer: {
            type: "object",
            properties: { val: { type: "integer", minimum: 0 } },
          },
        },
      });
      const { warnings } = gen.generate(ep, ctx);
      expect(warnings.some((w) => w.toLowerCase().includes("depth"))).toBe(true);
    });

    it("does not crash when depth warning is present", () => {
      const ctx = makeCtx({ maxDepth: 1 });
      const gen = new BoundaryBatteryGenerator();
      const ep = makeEndpointWith({
        type: "object",
        properties: {
          outer: {
            type: "object",
            properties: { val: { type: "integer", minimum: 0 } },
          },
        },
      });
      expect(() => gen.generate(ep, ctx)).not.toThrow();
    });
  });

  describe("generate() — marker, prod_safe, and ids", () => {
    const schemaWithMin = {
      type: "object",
      properties: { n: { type: "integer", minimum: 1 } },
    };

    it("marks all cases as boundary_battery type", () => {
      const gen = new BoundaryBatteryGenerator();
      const { cases } = gen.generate(makeEndpointWith(schemaWithMin), makeCtx());
      expect(cases.every((c) => c.type === "boundary_battery")).toBe(true);
    });

    it("marks all cases as regression", () => {
      const gen = new BoundaryBatteryGenerator();
      const { cases } = gen.generate(makeEndpointWith(schemaWithMin), makeCtx());
      expect(cases.every((c) => c.marker === "regression")).toBe(true);
    });

    it("marks all cases as prod_safe=false", () => {
      const gen = new BoundaryBatteryGenerator();
      const { cases } = gen.generate(makeEndpointWith(schemaWithMin), makeCtx());
      expect(cases.every((c) => c.prod_safe === false)).toBe(true);
    });

    it("assigns unique ids within the case set", () => {
      const gen = new BoundaryBatteryGenerator();
      const { cases } = gen.generate(makeEndpointWith(schemaWithMin), makeCtx());
      const ids = cases.map((c) => c.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it("emits inside case before outside case for each constraint", () => {
      const gen = new BoundaryBatteryGenerator();
      const { cases } = gen.generate(makeEndpointWith(schemaWithMin), makeCtx());
      const insideIdx = cases.findIndex((c) => (c.params as BoundaryParams).position === "inside");
      const outsideIdx = cases.findIndex((c) => (c.params as BoundaryParams).position === "outside");
      expect(insideIdx).toBeLessThan(outsideIdx);
    });
  });

  describe("generate() — determinism", () => {
    it("produces byte-identical results for two runs", () => {
      const gen = new BoundaryBatteryGenerator();
      const ep = makeEndpointWith({
        type: "object",
        properties: {
          score: { type: "integer", minimum: 0, maximum: 100 },
          label: { type: "string", minLength: 1, maxLength: 50, enum: ["a", "b"] },
        },
      });
      const r1 = gen.generate(ep, makeCtx());
      const r2 = gen.generate(ep, makeCtx());
      expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
    });
  });
});
