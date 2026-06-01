import { describe, it, expect } from "vitest";

import { DbVerifyGenerator } from "../../../../src/test-catalog/generators/db-verify-generator.js";
import { MarkerClassifier } from "../../../../src/test-catalog/marker-classifier.js";
import { ProdSafetyClassifier } from "../../../../src/test-catalog/prod-safety-classifier.js";
import { TestCaseIdFactory } from "../../../../src/test-catalog/test-case-id.js";
import { SchemaWalker } from "../../../../src/test-catalog/schema-walker.js";
import type { CanonicalEndpoint } from "../../../../src/core/canonical-model.js";
import type { GenerationContext, DbStateParams } from "../../../../src/test-catalog/types.js";

/**
 * Unit tests for DbVerifyGenerator.
 *
 * Covers: ANY method with K db_verify entries → K cases (issue: was previously
 * write-only, but `dbVerifyOk` only gates the `db_state_matches_expectation`
 * kind, so read methods with db_verify silently passed); method with
 * empty/absent db_verify → zero cases, no warning; unrecognized expect →
 * warn+skip not throw; verbatim query/connection/expect/fields/query_id
 * preserved; regression marker; prod_safe=false; stable ids; determinism.
 */

function makeCtx(): GenerationContext {
  return {
    ids: new TestCaseIdFactory(),
    markers: new MarkerClassifier(),
    prodSafety: new ProdSafetyClassifier(),
    walker: new SchemaWalker(),
  };
}

const postWith2DbVerify: CanonicalEndpoint = {
  id: "ep.create",
  name: "Create EP",
  method: "POST",
  url: "/ep",
  request: {},
  response: { expected_status: 201, schema: {} },
  db_verify: [
    {
      connection: "primary_postgres",
      query: "SELECT * FROM users WHERE id = ${request.body.id}",
      expect: "match",
      fields: { email: "${request.body.email}" },
      query_id: "check_user",
    },
    {
      connection: "primary_postgres",
      query: "SELECT COUNT(*) FROM audit WHERE action='create'",
      expect: "exists",
    },
  ],
};

const postWithEmptyDbVerify: CanonicalEndpoint = {
  id: "ep.empty-verify",
  name: "Empty Verify",
  method: "POST",
  url: "/ep",
  request: {},
  response: { expected_status: 201, schema: {} },
  db_verify: [],
};

const postWithNoDbVerify: CanonicalEndpoint = {
  id: "ep.no-verify",
  name: "No Verify",
  method: "POST",
  url: "/ep",
  request: {},
  response: { expected_status: 201, schema: {} },
};

const getWithDbVerify: CanonicalEndpoint = {
  id: "ep.get-verify",
  name: "GET with Verify",
  method: "GET",
  url: "/ep",
  request: {},
  response: { expected_status: 200, schema: {} },
  db_verify: [
    {
      connection: "primary",
      query: "SELECT 1",
      expect: "exists",
    },
  ],
};

describe("DbVerifyGenerator", () => {
  describe("constructor — default-seam wiring", () => {
    it("constructs with no arguments", () => {
      expect(() => new DbVerifyGenerator()).not.toThrow();
    });
  });

  describe("generate() — write method with db_verify entries", () => {
    it("emits exactly K cases for K db_verify entries", () => {
      const gen = new DbVerifyGenerator();
      const { cases } = gen.generate(postWith2DbVerify, makeCtx());
      expect(cases).toHaveLength(2);
    });

    it("emits db_state_matches_expectation type for each entry", () => {
      const gen = new DbVerifyGenerator();
      const { cases } = gen.generate(postWith2DbVerify, makeCtx());
      expect(cases.every((c) => c.type === "db_state_matches_expectation")).toBe(true);
    });

    it("carries verbatim connection string in params", () => {
      const gen = new DbVerifyGenerator();
      const { cases } = gen.generate(postWith2DbVerify, makeCtx());
      expect((cases[0].params as DbStateParams).connection).toBe("primary_postgres");
    });

    it("carries verbatim query string in params (never executed)", () => {
      const gen = new DbVerifyGenerator();
      const { cases } = gen.generate(postWith2DbVerify, makeCtx());
      expect((cases[0].params as DbStateParams).query).toBe(
        "SELECT * FROM users WHERE id = ${request.body.id}",
      );
    });

    it("carries verbatim expect mode in params", () => {
      const gen = new DbVerifyGenerator();
      const { cases } = gen.generate(postWith2DbVerify, makeCtx());
      expect((cases[0].params as DbStateParams).expect).toBe("match");
    });

    it("carries verbatim fields when present", () => {
      const gen = new DbVerifyGenerator();
      const { cases } = gen.generate(postWith2DbVerify, makeCtx());
      expect((cases[0].params as DbStateParams).fields).toEqual({
        email: "${request.body.email}",
      });
    });

    it("carries verbatim query_id when present", () => {
      const gen = new DbVerifyGenerator();
      const { cases } = gen.generate(postWith2DbVerify, makeCtx());
      expect((cases[0].params as DbStateParams).query_id).toBe("check_user");
    });

    it("omits fields key when absent from db_verify entry (round-trip safe)", () => {
      const gen = new DbVerifyGenerator();
      const { cases } = gen.generate(postWith2DbVerify, makeCtx());
      // Second entry has no fields key
      expect("fields" in cases[1].params).toBe(false);
    });

    it("omits query_id key when absent (round-trip safe)", () => {
      const gen = new DbVerifyGenerator();
      const { cases } = gen.generate(postWith2DbVerify, makeCtx());
      expect("query_id" in cases[1].params).toBe(false);
    });

    it("emits no warnings for valid db_verify entries", () => {
      const gen = new DbVerifyGenerator();
      const { warnings } = gen.generate(postWith2DbVerify, makeCtx());
      expect(warnings).toHaveLength(0);
    });

    it("follows db_verify array order", () => {
      const gen = new DbVerifyGenerator();
      const { cases } = gen.generate(postWith2DbVerify, makeCtx());
      expect((cases[0].params as DbStateParams).query_id).toBe("check_user");
      expect((cases[1].params as DbStateParams).expect).toBe("exists");
    });
  });

  describe("generate() — write method with empty db_verify → zero cases, no warning", () => {
    it("emits zero cases for empty db_verify array", () => {
      const gen = new DbVerifyGenerator();
      const { cases } = gen.generate(postWithEmptyDbVerify, makeCtx());
      expect(cases).toHaveLength(0);
    });

    it("emits no warnings for empty db_verify", () => {
      const gen = new DbVerifyGenerator();
      const { warnings } = gen.generate(postWithEmptyDbVerify, makeCtx());
      expect(warnings).toHaveLength(0);
    });
  });

  describe("generate() — write method with no db_verify → zero cases, no warning", () => {
    it("emits zero cases when db_verify is absent", () => {
      const gen = new DbVerifyGenerator();
      const { cases } = gen.generate(postWithNoDbVerify, makeCtx());
      expect(cases).toHaveLength(0);
    });

    it("emits no warnings when db_verify is absent", () => {
      const gen = new DbVerifyGenerator();
      const { warnings } = gen.generate(postWithNoDbVerify, makeCtx());
      expect(warnings).toHaveLength(0);
    });
  });

  describe("generate() — read methods (GET / HEAD / OPTIONS) with db_verify → cases generated (issue fix)", () => {
    // Issue fix: db_verify on read methods was previously dropped with an
    // "ignored" warning, but the runtime still executed the queries and
    // recorded `pass: false` in the attempt trace — without a generated
    // db_state_matches_expectation case, no test ever validated the result,
    // so the run exited green. Silent failure. These tests pin the fix.

    it("issue fix: GET with db_verify emits the case (was: zero cases)", () => {
      const gen = new DbVerifyGenerator();
      const { cases } = gen.generate(getWithDbVerify, makeCtx());
      expect(cases).toHaveLength(1);
      expect(cases[0].type).toBe("db_state_matches_expectation");
    });

    it("issue fix: GET with db_verify emits NO 'ignored' warning (was: one warning)", () => {
      const gen = new DbVerifyGenerator();
      const { warnings } = gen.generate(getWithDbVerify, makeCtx());
      expect(warnings).toHaveLength(0);
    });

    it("issue fix: HEAD with db_verify emits the case", () => {
      const gen = new DbVerifyGenerator();
      const headEp: CanonicalEndpoint = {
        ...getWithDbVerify,
        id: "ep.head",
        method: "HEAD",
      };
      const { cases, warnings } = gen.generate(headEp, makeCtx());
      expect(cases).toHaveLength(1);
      expect(warnings).toHaveLength(0);
    });

    it("issue fix: OPTIONS with db_verify emits the case", () => {
      const gen = new DbVerifyGenerator();
      const optEp: CanonicalEndpoint = {
        ...getWithDbVerify,
        id: "ep.options",
        method: "OPTIONS",
      };
      const { cases, warnings } = gen.generate(optEp, makeCtx());
      expect(cases).toHaveLength(1);
      expect(warnings).toHaveLength(0);
    });

    it("issue fix: GET with K db_verify entries emits K cases (parity with writes)", () => {
      const gen = new DbVerifyGenerator();
      const getWith2: CanonicalEndpoint = {
        ...getWithDbVerify,
        id: "ep.get-multi",
        db_verify: [
          { connection: "primary", query: "SELECT 1", expect: "exists" },
          { connection: "primary", query: "SELECT 2", expect: "not_exists" },
        ],
      };
      const { cases } = gen.generate(getWith2, makeCtx());
      expect(cases).toHaveLength(2);
    });

    it("issue fix: GET with db_verify still carries verbatim query/connection/expect", () => {
      const gen = new DbVerifyGenerator();
      const { cases } = gen.generate(getWithDbVerify, makeCtx());
      const params = cases[0].params as DbStateParams;
      expect(params.connection).toBe("primary");
      expect(params.query).toBe("SELECT 1");
      expect(params.expect).toBe("exists");
    });
  });

  describe("generate() — unrecognized expect value → warn+skip, never throw", () => {
    it("skips the entry and emits a warning for unrecognized expect", () => {
      const gen = new DbVerifyGenerator();
      const epWithBadExpect: CanonicalEndpoint = {
        id: "ep.bad-expect",
        name: "Bad Expect",
        method: "POST",
        url: "/ep",
        request: {},
        response: { expected_status: 201, schema: {} },
        db_verify: [
          {
            connection: "primary",
            query: "SELECT 1",
            expect: "bogus" as never,
          },
          {
            connection: "primary",
            query: "SELECT 2",
            expect: "exists",
          },
        ],
      };
      const { cases, warnings } = gen.generate(epWithBadExpect, makeCtx());
      // First entry skipped (bad expect), second processed
      expect(cases).toHaveLength(1);
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings.some((w) => w.toLowerCase().includes("bogus"))).toBe(true);
    });

    it("does not throw on unrecognized expect", () => {
      const gen = new DbVerifyGenerator();
      const epWithBadExpect: CanonicalEndpoint = {
        id: "ep.no-throw",
        name: "No Throw",
        method: "PUT",
        url: "/ep",
        request: {},
        response: { expected_status: 200, schema: {} },
        db_verify: [{ connection: "c", query: "q", expect: "invalid_mode" as never }],
      };
      expect(() => gen.generate(epWithBadExpect, makeCtx())).not.toThrow();
    });
  });

  describe("generate() — write methods: PUT, PATCH, DELETE", () => {
    for (const method of ["PUT", "PATCH", "DELETE"] as const) {
      it(`emits cases for ${method} with db_verify`, () => {
        const gen = new DbVerifyGenerator();
        const ep: CanonicalEndpoint = {
          id: `ep.${method.toLowerCase()}`,
          name: method,
          method,
          url: "/ep",
          request: {},
          response: { expected_status: 200, schema: {} },
          db_verify: [{ connection: "c", query: "SELECT 1", expect: "exists" }],
        };
        const { cases } = gen.generate(ep, makeCtx());
        expect(cases).toHaveLength(1);
      });
    }
  });

  describe("generate() — marker and prod_safe", () => {
    it("marks all cases as regression", () => {
      const gen = new DbVerifyGenerator();
      const { cases } = gen.generate(postWith2DbVerify, makeCtx());
      expect(cases.every((c) => c.marker === "regression")).toBe(true);
    });

    it("marks all cases as prod_safe=false", () => {
      const gen = new DbVerifyGenerator();
      const { cases } = gen.generate(postWith2DbVerify, makeCtx());
      expect(cases.every((c) => c.prod_safe === false)).toBe(true);
    });
  });

  describe("generate() — stable ids", () => {
    it("assigns unique ids within the case set", () => {
      const gen = new DbVerifyGenerator();
      const { cases } = gen.generate(postWith2DbVerify, makeCtx());
      const ids = cases.map((c) => c.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it("ids match ^[a-z0-9._-]+$", () => {
      const gen = new DbVerifyGenerator();
      const { cases } = gen.generate(postWith2DbVerify, makeCtx());
      cases.forEach((c) => expect(c.id).toMatch(/^[a-z0-9._-]+$/));
    });
  });

  describe("generate() — determinism", () => {
    it("produces byte-identical results for two runs", () => {
      const gen = new DbVerifyGenerator();
      const r1 = gen.generate(postWith2DbVerify, makeCtx());
      const r2 = gen.generate(postWith2DbVerify, makeCtx());
      expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
    });
  });
});
