/**
 * Unit tests for CorsPreflightGenerator.
 *
 * Covers all §6 generator obligations (items 1–17) from the design document
 * v1.0.2-pr6-cors-preflight.md:
 *   1.  OPTIONS + cors declared (all arrays non-empty) → 1 case.
 *   2.  OPTIONS + cors absent → 0 cases, 0 warnings.
 *   3.  Non-OPTIONS methods (GET/POST/PUT/PATCH/DELETE/HEAD) + cors → 0 cases, 0 warnings (silent, DD-1).
 *   4.  OPTIONS + cors.allow_origins empty → 0 cases, 1 warning (DD-7 #1).
 *   5.  OPTIONS + cors.allow_methods empty → 0 cases, 1 warning (DD-7 #2).
 *   6.  OPTIONS + cors.allow_headers empty → 1 case, 0 warnings.
 *   7.  OPTIONS + cors.allow_origins ["*"] → 1 case; params.allow_origins[0] === "*".
 *   8.  OPTIONS + multi-origin allow_origins → 1 case; params.allow_origins echoes both.
 *   9.  Case id matches ids.make(endpoint.id, "cors_preflight", 0).
 *   10. Case marker === "smoke".
 *   11. Case prod_safe === true (smoke + OPTIONS via classifier).
 *   12. Case params.kind === "cors_preflight".
 *   13. params arrays echo endpoint cors arrays structurally.
 *   14. Title format: "CORS preflight for <endpoint.name>".
 *   15. Determinism: two independent generate() calls produce byte-identical output.
 *   16. Generator never throws on any input.
 *   17. Generator does NOT call ctx.walker (no body-field discovery needed).
 *
 * Design decisions pinned:
 *   DD-1  Non-OPTIONS + cors declared → silent no-op; no warning.
 *   DD-7  Empty allow_origins or allow_methods → warning + drop case;
 *         empty allow_headers is valid (no warning; case still emitted).
 *   DD-9  Marker "smoke"; prod_safe computed by ProdSafetyClassifier via OPTIONS.
 *   DD-10 Generator position 9 (after pagination, before db-verify).
 *
 * Category: Unit.
 * Expected initial failure: Cannot find module
 *   '../../../../src/test-catalog/generators/cors-preflight-generator.js'
 */

import { describe, it, expect, vi } from "vitest";

import { CorsPreflightGenerator } from "../../../../src/test-catalog/generators/cors-preflight-generator.js";
import { MarkerClassifier } from "../../../../src/test-catalog/marker-classifier.js";
import { ProdSafetyClassifier } from "../../../../src/test-catalog/prod-safety-classifier.js";
import { TestCaseIdFactory } from "../../../../src/test-catalog/test-case-id.js";
import { SchemaWalker } from "../../../../src/test-catalog/schema-walker.js";
import type { CanonicalEndpoint } from "../../../../src/core/canonical-model.js";
import type { GenerationContext } from "../../../../src/test-catalog/types.js";
import type { CorsPreflightParams } from "../../../../src/test-catalog/test-case-params.js";

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

interface CorsConfigLike {
  allow_origins: readonly string[];
  allow_methods: readonly string[];
  allow_headers: readonly string[];
}

function optionsEndpoint(
  id: string,
  cors?: CorsConfigLike,
  overrides: Partial<CanonicalEndpoint> = {},
): CanonicalEndpoint {
  const base: CanonicalEndpoint = {
    id,
    name: `OPTIONS ${id}`,
    method: "OPTIONS",
    url: `/api/${id}`,
    request: {},
    response: { expected_status: 200, schema: {} },
    ...overrides,
  };
  // CorsConfig lives on CanonicalEndpoint as an optional field (added by this PR).
  // We use `as` cast here because the type is not yet wired — this is red-phase.
  if (cors !== undefined) {
    (base as Record<string, unknown>)["cors"] = cors;
  }
  return base;
}

function corsWith(
  origins: readonly string[],
  methods: readonly string[],
  headers: readonly string[],
): CorsConfigLike {
  return { allow_origins: origins, allow_methods: methods, allow_headers: headers };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CorsPreflightGenerator", () => {

  /**
   * No-arg construction must not throw — pipeline seam rule.
   */
  describe("constructor — default-seam wiring", () => {
    it("constructs with no arguments without throwing", () => {
      expect(() => new CorsPreflightGenerator()).not.toThrow();
    });
  });

  /**
   * Case 1: OPTIONS + cors declared → exactly one case emitted.
   */
  describe("generate() — item 1: OPTIONS + full cors → 1 case", () => {
    it("emits exactly one case for a fully-populated cors config", () => {
      const gen = new CorsPreflightGenerator();
      const ep = optionsEndpoint("users.options", corsWith(
        ["https://app.example.com"],
        ["GET", "POST", "PUT"],
        ["Authorization", "Content-Type"],
      ));
      const { cases } = gen.generate(ep, makeCtx());
      expect(cases).toHaveLength(1);
    });

    it("emits zero warnings for a fully-populated cors config", () => {
      const gen = new CorsPreflightGenerator();
      const ep = optionsEndpoint("users.options", corsWith(
        ["https://app.example.com"],
        ["GET", "POST"],
        ["Authorization"],
      ));
      const { warnings } = gen.generate(ep, makeCtx());
      expect(warnings).toHaveLength(0);
    });
  });

  /**
   * Case 2: OPTIONS + cors absent → 0 cases, 0 warnings.
   */
  describe("generate() — item 2: OPTIONS + cors absent → 0 cases", () => {
    it("emits zero cases when cors is not declared on an OPTIONS endpoint", () => {
      const gen = new CorsPreflightGenerator();
      const ep = optionsEndpoint("users.options"); // no cors
      const { cases } = gen.generate(ep, makeCtx());
      expect(cases).toHaveLength(0);
    });

    it("emits zero warnings when cors is absent on an OPTIONS endpoint", () => {
      const gen = new CorsPreflightGenerator();
      const ep = optionsEndpoint("users.options");
      const { warnings } = gen.generate(ep, makeCtx());
      expect(warnings).toHaveLength(0);
    });
  });

  /**
   * Case 3: Non-OPTIONS methods + cors → 0 cases, 0 warnings (silent, DD-1).
   */
  describe("generate() — item 3: non-OPTIONS + cors → silent no-op", () => {
    const nonOptionsMethods: CanonicalEndpoint["method"][] = [
      "GET", "POST", "PUT", "PATCH", "DELETE", "HEAD",
    ];
    const cors = corsWith(["https://a.com"], ["GET", "POST"], ["Authorization"]);

    for (const method of nonOptionsMethods) {
      describe(`method ${method}`, () => {
        it(`emits zero cases for ${method} endpoint with cors declared`, () => {
          const gen = new CorsPreflightGenerator();
          const ep: CanonicalEndpoint = {
            id: `ep.${method.toLowerCase()}`,
            name: `${method} endpoint`,
            method,
            url: "/api/ep",
            request: {},
            response: { expected_status: 200, schema: {} },
          };
          (ep as Record<string, unknown>)["cors"] = cors;
          const { cases } = gen.generate(ep, makeCtx());
          expect(cases).toHaveLength(0);
        });

        it(`emits zero warnings for ${method} endpoint with cors declared (silent, DD-1)`, () => {
          const gen = new CorsPreflightGenerator();
          const ep: CanonicalEndpoint = {
            id: `ep.${method.toLowerCase()}`,
            name: `${method} endpoint`,
            method,
            url: "/api/ep",
            request: {},
            response: { expected_status: 200, schema: {} },
          };
          (ep as Record<string, unknown>)["cors"] = cors;
          const { warnings } = gen.generate(ep, makeCtx());
          expect(warnings).toHaveLength(0);
        });
      });
    }
  });

  /**
   * Case 4: OPTIONS + cors.allow_origins empty → 0 cases, 1 DD-7 warning.
   */
  describe("generate() — item 4: allow_origins empty → 0 cases + warning (DD-7 #1)", () => {
    it("emits zero cases when allow_origins is an empty array", () => {
      const gen = new CorsPreflightGenerator();
      const ep = optionsEndpoint("ep.cors-no-origins", corsWith([], ["GET"], []));
      const { cases } = gen.generate(ep, makeCtx());
      expect(cases).toHaveLength(0);
    });

    it("emits exactly one warning when allow_origins is empty", () => {
      const gen = new CorsPreflightGenerator();
      const ep = optionsEndpoint("ep.cors-no-origins", corsWith([], ["GET"], []));
      const { warnings } = gen.generate(ep, makeCtx());
      expect(warnings).toHaveLength(1);
    });

    it("warning mentions the endpoint id", () => {
      const gen = new CorsPreflightGenerator();
      const ep = optionsEndpoint("ep.cors-no-origins", corsWith([], ["GET"], []));
      const { warnings } = gen.generate(ep, makeCtx());
      expect(warnings[0]).toContain("ep.cors-no-origins");
    });

    it("warning matches the exact DD-7 #1 template", () => {
      const gen = new CorsPreflightGenerator();
      const ep = optionsEndpoint("ep.cors-no-origins", corsWith([], ["GET"], []));
      const { warnings } = gen.generate(ep, makeCtx());
      expect(warnings[0]).toBe(
        "Endpoint 'ep.cors-no-origins': cors_preflight — allow_origins is empty; case dropped.",
      );
    });
  });

  /**
   * Case 5: OPTIONS + cors.allow_methods empty → 0 cases, 1 DD-7 warning.
   */
  describe("generate() — item 5: allow_methods empty → 0 cases + warning (DD-7 #2)", () => {
    it("emits zero cases when allow_methods is an empty array", () => {
      const gen = new CorsPreflightGenerator();
      const ep = optionsEndpoint("ep.cors-no-methods", corsWith(["https://a.com"], [], []));
      const { cases } = gen.generate(ep, makeCtx());
      expect(cases).toHaveLength(0);
    });

    it("emits exactly one warning when allow_methods is empty", () => {
      const gen = new CorsPreflightGenerator();
      const ep = optionsEndpoint("ep.cors-no-methods", corsWith(["https://a.com"], [], []));
      const { warnings } = gen.generate(ep, makeCtx());
      expect(warnings).toHaveLength(1);
    });

    it("warning matches the exact DD-7 #2 template", () => {
      const gen = new CorsPreflightGenerator();
      const ep = optionsEndpoint("ep.cors-no-methods", corsWith(["https://a.com"], [], []));
      const { warnings } = gen.generate(ep, makeCtx());
      expect(warnings[0]).toBe(
        "Endpoint 'ep.cors-no-methods': cors_preflight — allow_methods is empty; case dropped.",
      );
    });
  });

  /**
   * Case 6: OPTIONS + cors.allow_headers empty → 1 case, 0 warnings (valid, DD-7).
   */
  describe("generate() — item 6: allow_headers empty → 1 case, no warning", () => {
    it("emits exactly one case when allow_headers is empty (valid per design)", () => {
      const gen = new CorsPreflightGenerator();
      const ep = optionsEndpoint("ep.cors-no-headers", corsWith(
        ["https://a.com"],
        ["GET", "POST"],
        [],
      ));
      const { cases } = gen.generate(ep, makeCtx());
      expect(cases).toHaveLength(1);
    });

    it("emits zero warnings when allow_headers is empty", () => {
      const gen = new CorsPreflightGenerator();
      const ep = optionsEndpoint("ep.cors-no-headers", corsWith(
        ["https://a.com"],
        ["GET", "POST"],
        [],
      ));
      const { warnings } = gen.generate(ep, makeCtx());
      expect(warnings).toHaveLength(0);
    });
  });

  /**
   * Case 7: wildcard allow_origins ["*"] → 1 case; first origin is "*".
   */
  describe("generate() — item 7: wildcard allow_origins ['*']", () => {
    it("emits one case and params.allow_origins[0] === '*' for wildcard config", () => {
      const gen = new CorsPreflightGenerator();
      const ep = optionsEndpoint("ep.cors-wildcard", corsWith(["*"], ["GET"], []));
      const { cases } = gen.generate(ep, makeCtx());
      expect(cases).toHaveLength(1);
      const params = cases[0]?.params as CorsPreflightParams;
      expect(params.allow_origins[0]).toBe("*");
    });
  });

  /**
   * Case 8: Multi-origin allow_origins → 1 case; params.allow_origins echoes both.
   */
  describe("generate() — item 8: multi-origin allow_origins", () => {
    it("emits one case for a multi-entry allow_origins list", () => {
      const gen = new CorsPreflightGenerator();
      const ep = optionsEndpoint("ep.cors-multi", corsWith(
        ["https://a.com", "https://b.com"],
        ["GET"],
        [],
      ));
      const { cases } = gen.generate(ep, makeCtx());
      expect(cases).toHaveLength(1);
    });

    it("params.allow_origins echoes the full multi-entry array", () => {
      const gen = new CorsPreflightGenerator();
      const ep = optionsEndpoint("ep.cors-multi", corsWith(
        ["https://a.com", "https://b.com"],
        ["GET"],
        [],
      ));
      const { cases } = gen.generate(ep, makeCtx());
      const params = cases[0]?.params as CorsPreflightParams;
      expect(params.allow_origins).toEqual(["https://a.com", "https://b.com"]);
    });
  });

  /**
   * Case 9: Case id matches ids.make(endpoint.id, "cors_preflight", 0).
   */
  describe("generate() — item 9: case id format", () => {
    it("case id matches the expected TestCaseIdFactory format", () => {
      const gen = new CorsPreflightGenerator();
      const ctx = makeCtx();
      const ep = optionsEndpoint("ep.cors-id", corsWith(["https://a.com"], ["GET"], []));
      const { cases } = gen.generate(ep, ctx);
      const expectedId = new TestCaseIdFactory().make("ep.cors-id", "cors_preflight", 0);
      expect(cases[0]?.id).toBe(expectedId);
    });
  });

  /**
   * Case 10: Case marker === "smoke" (DD-9).
   */
  describe("generate() — item 10: marker === 'smoke'", () => {
    it("emitted case has marker === 'smoke'", () => {
      const gen = new CorsPreflightGenerator();
      const ep = optionsEndpoint("ep.cors-marker", corsWith(["https://a.com"], ["GET"], []));
      const { cases } = gen.generate(ep, makeCtx());
      expect(cases[0]?.marker).toBe("smoke");
    });
  });

  /**
   * Case 11: Case prod_safe === true (smoke + OPTIONS in READ_METHODS, DD-9).
   */
  describe("generate() — item 11: prod_safe === true", () => {
    it("emitted case has prod_safe === true (OPTIONS is in READ_METHODS per DD-9)", () => {
      const gen = new CorsPreflightGenerator();
      const ep = optionsEndpoint("ep.cors-prodsafe", corsWith(["https://a.com"], ["GET"], []));
      const { cases } = gen.generate(ep, makeCtx());
      expect(cases[0]?.prod_safe).toBe(true);
    });
  });

  /**
   * Case 12: params.kind === "cors_preflight".
   */
  describe("generate() — item 12: params.kind", () => {
    it("emitted case has params.kind === 'cors_preflight'", () => {
      const gen = new CorsPreflightGenerator();
      const ep = optionsEndpoint("ep.cors-kind", corsWith(["https://a.com"], ["GET"], []));
      const { cases } = gen.generate(ep, makeCtx());
      expect(cases[0]?.params.kind).toBe("cors_preflight");
    });
  });

  /**
   * Case 13: params arrays echo endpoint cors arrays structurally (not by reference).
   */
  describe("generate() — item 13: params arrays echo cors config", () => {
    it("params.allow_origins echoes cors.allow_origins structurally", () => {
      const origins = ["https://app.example.com", "https://staging.example.com"];
      const gen = new CorsPreflightGenerator();
      const ep = optionsEndpoint("ep.cors-echo", corsWith(origins, ["GET"], []));
      const { cases } = gen.generate(ep, makeCtx());
      const params = cases[0]?.params as CorsPreflightParams;
      expect(params.allow_origins).toEqual(origins);
    });

    it("params.allow_methods echoes cors.allow_methods structurally", () => {
      const methods = ["GET", "POST", "PUT", "DELETE"];
      const gen = new CorsPreflightGenerator();
      const ep = optionsEndpoint("ep.cors-echo-m", corsWith(["https://a.com"], methods, []));
      const { cases } = gen.generate(ep, makeCtx());
      const params = cases[0]?.params as CorsPreflightParams;
      expect(params.allow_methods).toEqual(methods);
    });

    it("params.allow_headers echoes cors.allow_headers structurally", () => {
      const headers = ["Authorization", "Content-Type", "X-Request-Id"];
      const gen = new CorsPreflightGenerator();
      const ep = optionsEndpoint("ep.cors-echo-h", corsWith(["https://a.com"], ["GET"], headers));
      const { cases } = gen.generate(ep, makeCtx());
      const params = cases[0]?.params as CorsPreflightParams;
      expect(params.allow_headers).toEqual(headers);
    });
  });

  /**
   * Case 14: Title format "CORS preflight for <endpoint.name>".
   */
  describe("generate() — item 14: case title format", () => {
    it("case title matches 'CORS preflight for <endpoint.name>'", () => {
      const gen = new CorsPreflightGenerator();
      const ep = optionsEndpoint("ep.cors-title", corsWith(["https://a.com"], ["GET"], []));
      // Override name to something specific for the assertion
      const namedEp: CanonicalEndpoint = { ...ep, name: "CORS Preflight Endpoint" };
      const { cases } = gen.generate(namedEp, makeCtx());
      expect(cases[0]?.title).toBe("CORS preflight for CORS Preflight Endpoint");
    });

    it("case title includes the endpoint name verbatim (no truncation)", () => {
      const gen = new CorsPreflightGenerator();
      const ep: CanonicalEndpoint = {
        id: "ep.cors-longname",
        name: "OPTIONS /api/v1/users/:userId/permissions",
        method: "OPTIONS",
        url: "/api/v1/users/:userId/permissions",
        request: {},
        response: { expected_status: 200, schema: {} },
      };
      (ep as Record<string, unknown>)["cors"] = corsWith(["https://a.com"], ["GET"], []);
      const { cases } = gen.generate(ep, makeCtx());
      expect(cases[0]?.title).toBe("CORS preflight for OPTIONS /api/v1/users/:userId/permissions");
    });
  });

  /**
   * Case 15: Determinism — two independent generate() calls produce byte-identical output.
   */
  describe("generate() — item 15: determinism", () => {
    it("two independent generate() calls on the same endpoint produce identical case ids", () => {
      const ep = optionsEndpoint("ep.cors-det", corsWith(
        ["https://a.com", "https://b.com"],
        ["GET", "POST"],
        ["Authorization"],
      ));
      const result1 = new CorsPreflightGenerator().generate(ep, makeCtx());
      const result2 = new CorsPreflightGenerator().generate(ep, makeCtx());
      expect(result1.cases[0]?.id).toBe(result2.cases[0]?.id);
    });

    it("two independent generate() calls produce identical params", () => {
      const ep = optionsEndpoint("ep.cors-det2", corsWith(
        ["https://a.com"],
        ["GET", "POST", "DELETE"],
        ["Authorization", "Content-Type"],
      ));
      const result1 = new CorsPreflightGenerator().generate(ep, makeCtx());
      const result2 = new CorsPreflightGenerator().generate(ep, makeCtx());
      expect(JSON.stringify(result1.cases[0]?.params)).toBe(
        JSON.stringify(result2.cases[0]?.params),
      );
    });
  });

  /**
   * Case 16: Generator never throws on any input.
   */
  describe("generate() — item 16: no-throw guarantee", () => {
    it("does not throw when cors is absent", () => {
      const gen = new CorsPreflightGenerator();
      const ep = optionsEndpoint("ep.no-cors");
      expect(() => gen.generate(ep, makeCtx())).not.toThrow();
    });

    it("does not throw when method is not OPTIONS", () => {
      const gen = new CorsPreflightGenerator();
      const ep: CanonicalEndpoint = {
        id: "ep.get",
        name: "GET endpoint",
        method: "GET",
        url: "/api/ep",
        request: {},
        response: { expected_status: 200, schema: {} },
      };
      (ep as Record<string, unknown>)["cors"] = corsWith(["https://a.com"], ["GET"], []);
      expect(() => gen.generate(ep, makeCtx())).not.toThrow();
    });

    it("does not throw when both allow_origins and allow_methods are empty", () => {
      const gen = new CorsPreflightGenerator();
      const ep = optionsEndpoint("ep.cors-empty-both", corsWith([], [], []));
      expect(() => gen.generate(ep, makeCtx())).not.toThrow();
    });
  });

  /**
   * Case 17: Generator does NOT call ctx.walker.
   */
  describe("generate() — item 17: does not invoke ctx.walker", () => {
    it("does not call walker.walk during cors_preflight generation", () => {
      const gen = new CorsPreflightGenerator();
      const walker = new SchemaWalker();
      const spyWalk = vi.spyOn(walker, "walk");
      const ctx: GenerationContext = {
        ids: new TestCaseIdFactory(),
        markers: new MarkerClassifier(),
        prodSafety: new ProdSafetyClassifier(),
        walker,
      };
      const ep = optionsEndpoint("ep.cors-no-walk", corsWith(["https://a.com"], ["GET"], []));
      gen.generate(ep, ctx);
      expect(spyWalk).not.toHaveBeenCalled();
    });
  });

  /**
   * Additional coverage: case type field.
   */
  describe("generate() — case type field", () => {
    it("emitted case has type === 'cors_preflight'", () => {
      const gen = new CorsPreflightGenerator();
      const ep = optionsEndpoint("ep.cors-type", corsWith(["https://a.com"], ["GET"], []));
      const { cases } = gen.generate(ep, makeCtx());
      expect(cases[0]?.type).toBe("cors_preflight");
    });

    it("emitted case has endpoint_id matching the endpoint id", () => {
      const gen = new CorsPreflightGenerator();
      const ep = optionsEndpoint("ep.cors-epid", corsWith(["https://a.com"], ["GET"], []));
      const { cases } = gen.generate(ep, makeCtx());
      expect(cases[0]?.endpoint_id).toBe("ep.cors-epid");
    });
  });

  /**
   * Both DD-7 warnings fire independently — only allow_origins empty when both are empty
   * (allow_origins check runs first; only the first failing condition drops).
   */
  describe("generate() — DD-7 warning priority when both origins and methods empty", () => {
    it("emits the allow_origins warning (not allow_methods) when both arrays are empty", () => {
      const gen = new CorsPreflightGenerator();
      const ep = optionsEndpoint("ep.cors-both-empty", corsWith([], [], []));
      const { warnings } = gen.generate(ep, makeCtx());
      // At least one warning, and the allow_origins warning fires
      expect(warnings.some((w) => w.includes("allow_origins"))).toBe(true);
    });
  });
});
