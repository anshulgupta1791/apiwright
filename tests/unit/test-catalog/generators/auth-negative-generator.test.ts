import { describe, it, expect, beforeEach } from "vitest";

import { AuthNegativeGenerator } from "../../../../src/test-catalog/generators/auth-negative-generator.js";
import { MarkerClassifier } from "../../../../src/test-catalog/marker-classifier.js";
import { ProdSafetyClassifier } from "../../../../src/test-catalog/prod-safety-classifier.js";
import { TestCaseIdFactory } from "../../../../src/test-catalog/test-case-id.js";
import { SchemaWalker } from "../../../../src/test-catalog/schema-walker.js";
import type { CanonicalEndpoint } from "../../../../src/core/canonical-model.js";
import type { GenerationContext } from "../../../../src/test-catalog/types.js";

/**
 * Unit tests for AuthNegativeGenerator.
 *
 * Covers: authenticated endpoint (exactly 3 cases), unauthenticated endpoint
 * (zero cases), deterministic substitute-method selection (never equals the
 * declared method), stable ids, marker=regression, prod_safe=false, determinism.
 */

function makeCtx(): GenerationContext {
  return {
    ids: new TestCaseIdFactory(),
    markers: new MarkerClassifier(),
    prodSafety: new ProdSafetyClassifier(),
    walker: new SchemaWalker(),
  };
}

const authedPostEndpoint: CanonicalEndpoint = {
  id: "users.create",
  name: "Create User",
  method: "POST",
  url: "/api/v1/users",
  auth_strategy: "user_token",
  request: {},
  response: { expected_status: 201, schema: {} },
};

const unauthedGetEndpoint: CanonicalEndpoint = {
  id: "public.list",
  name: "Public List",
  method: "GET",
  url: "/api/v1/public",
  request: {},
  response: { expected_status: 200, schema: {} },
};

describe("AuthNegativeGenerator", () => {
  describe("constructor — default-seam wiring", () => {
    it("constructs with no arguments", () => {
      expect(() => new AuthNegativeGenerator()).not.toThrow();
    });
  });

  describe("generate() — authenticated endpoint (WITH auth_strategy)", () => {
    let generator: AuthNegativeGenerator;
    let ctx: GenerationContext;

    beforeEach(() => {
      generator = new AuthNegativeGenerator();
      ctx = makeCtx();
    });

    it("emits exactly 3 cases", () => {
      const { cases } = generator.generate(authedPostEndpoint, ctx);
      expect(cases).toHaveLength(3);
    });

    it("emits a no_auth_returns_401 case", () => {
      const { cases } = generator.generate(authedPostEndpoint, ctx);
      const c = cases.find((x) => x.type === "no_auth_returns_401");
      expect(c).toBeDefined();
    });

    it("no_auth_returns_401 params carry auth_strategy and expected_status 401", () => {
      const { cases } = generator.generate(authedPostEndpoint, ctx);
      const c = cases.find((x) => x.type === "no_auth_returns_401")!;
      expect((c.params as { auth_strategy: string }).auth_strategy).toBe("user_token");
      expect((c.params as { expected_status: number }).expected_status).toBe(401);
    });

    it("emits a garbage_token_returns_401 case", () => {
      const { cases } = generator.generate(authedPostEndpoint, ctx);
      const c = cases.find((x) => x.type === "garbage_token_returns_401");
      expect(c).toBeDefined();
    });

    it("garbage_token_returns_401 params carry auth_strategy, a garbage_token string, and expected_status 401", () => {
      const { cases } = generator.generate(authedPostEndpoint, ctx);
      const c = cases.find((x) => x.type === "garbage_token_returns_401")!;
      expect((c.params as { auth_strategy: string }).auth_strategy).toBe("user_token");
      expect(typeof (c.params as { garbage_token: string }).garbage_token).toBe("string");
      expect((c.params as { expected_status: number }).expected_status).toBe(401);
    });

    it("garbage_token is a non-empty deterministic string", () => {
      const { cases: c1 } = generator.generate(authedPostEndpoint, ctx);
      const { cases: c2 } = generator.generate(authedPostEndpoint, makeCtx());
      const t1 = c1.find((x) => x.type === "garbage_token_returns_401")!;
      const t2 = c2.find((x) => x.type === "garbage_token_returns_401")!;
      expect((t1.params as { garbage_token: string }).garbage_token).toBeTruthy();
      expect(
        (t1.params as { garbage_token: string }).garbage_token,
      ).toBe((t2.params as { garbage_token: string }).garbage_token);
    });

    it("emits a method_not_allowed case", () => {
      const { cases } = generator.generate(authedPostEndpoint, ctx);
      const c = cases.find((x) => x.type === "method_not_allowed");
      expect(c).toBeDefined();
    });

    it("method_not_allowed params carry a substitute_method different from the endpoint method", () => {
      const { cases } = generator.generate(authedPostEndpoint, ctx);
      const c = cases.find((x) => x.type === "method_not_allowed")!;
      expect((c.params as { substitute_method: string }).substitute_method).not.toBe("POST");
    });

    it("method_not_allowed expected_status is 405", () => {
      const { cases } = generator.generate(authedPostEndpoint, ctx);
      const c = cases.find((x) => x.type === "method_not_allowed")!;
      expect((c.params as { expected_status: number }).expected_status).toBe(405);
    });

    it("emits no warnings for a well-formed authenticated endpoint", () => {
      const { warnings } = generator.generate(authedPostEndpoint, ctx);
      expect(warnings).toHaveLength(0);
    });
  });

  describe("generate() — substitute method selection", () => {
    it("selects a substitute method that differs from GET when method is GET", () => {
      const gen = new AuthNegativeGenerator();
      const authedGet: CanonicalEndpoint = {
        ...unauthedGetEndpoint,
        auth_strategy: "token",
      };
      const { cases } = gen.generate(authedGet, makeCtx());
      const mna = cases.find((c) => c.type === "method_not_allowed")!;
      expect((mna.params as { substitute_method: string }).substitute_method).not.toBe("GET");
    });

    it("selects a substitute method that differs from DELETE when method is DELETE", () => {
      const gen = new AuthNegativeGenerator();
      const deleteEndpoint: CanonicalEndpoint = {
        id: "ep.delete",
        name: "Delete",
        method: "DELETE",
        url: "/ep",
        auth_strategy: "tok",
        request: {},
        response: { expected_status: 204, schema: {} },
      };
      const { cases } = gen.generate(deleteEndpoint, makeCtx());
      const mna = cases.find((c) => c.type === "method_not_allowed")!;
      expect((mna.params as { substitute_method: string }).substitute_method).not.toBe("DELETE");
    });

    it("is deterministic — same endpoint yields same substitute method across runs", () => {
      const gen = new AuthNegativeGenerator();
      const { cases: c1 } = gen.generate(authedPostEndpoint, makeCtx());
      const { cases: c2 } = gen.generate(authedPostEndpoint, makeCtx());
      const m1 = c1.find((c) => c.type === "method_not_allowed")!;
      const m2 = c2.find((c) => c.type === "method_not_allowed")!;
      expect(
        (m1.params as { substitute_method: string }).substitute_method,
      ).toBe((m2.params as { substitute_method: string }).substitute_method);
    });

    it("forces loop advance when endpoint method is first in the precedence list", () => {
      // POST is first in the typical precedence; test that it still picks a valid alternative
      const gen = new AuthNegativeGenerator();
      const { cases } = gen.generate(authedPostEndpoint, makeCtx());
      const mna = cases.find((c) => c.type === "method_not_allowed")!;
      const substitute = (mna.params as { substitute_method: string }).substitute_method;
      expect(substitute).toBeTruthy();
      expect(substitute).not.toBe("POST");
    });
  });

  describe("generate() — unauthenticated endpoint (NO auth_strategy)", () => {
    it("emits zero cases when endpoint has no auth_strategy", () => {
      const gen = new AuthNegativeGenerator();
      const { cases } = gen.generate(unauthedGetEndpoint, makeCtx());
      expect(cases).toHaveLength(0);
    });

    it("emits no warnings for an unauthenticated endpoint", () => {
      const gen = new AuthNegativeGenerator();
      const { warnings } = gen.generate(unauthedGetEndpoint, makeCtx());
      expect(warnings).toHaveLength(0);
    });
  });

  describe("generate() — marker and prod_safe", () => {
    it("marks all cases as regression", () => {
      const gen = new AuthNegativeGenerator();
      const { cases } = gen.generate(authedPostEndpoint, makeCtx());
      expect(cases.every((c) => c.marker === "regression")).toBe(true);
    });

    it("marks all cases as prod_safe=false", () => {
      const gen = new AuthNegativeGenerator();
      const { cases } = gen.generate(authedPostEndpoint, makeCtx());
      expect(cases.every((c) => c.prod_safe === false)).toBe(true);
    });
  });

  describe("generate() — ids", () => {
    it("assigns unique ids within the case set", () => {
      const gen = new AuthNegativeGenerator();
      const { cases } = gen.generate(authedPostEndpoint, makeCtx());
      const ids = cases.map((c) => c.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it("assigns ids matching ^[a-z0-9._-]+$", () => {
      const gen = new AuthNegativeGenerator();
      const { cases } = gen.generate(authedPostEndpoint, makeCtx());
      cases.forEach((c) => expect(c.id).toMatch(/^[a-z0-9._-]+$/));
    });
  });

  describe("generate() — determinism", () => {
    it("produces byte-identical results for two runs on the same endpoint", () => {
      const gen = new AuthNegativeGenerator();
      const r1 = gen.generate(authedPostEndpoint, makeCtx());
      const r2 = gen.generate(authedPostEndpoint, makeCtx());
      expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
    });
  });
});
