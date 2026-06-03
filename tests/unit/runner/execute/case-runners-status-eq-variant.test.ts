/**
 * Unit tests for computeVerdict wiring — STATUS_EQ_KINDS dispatch through
 * statusEqDispatch (variant-enrichment integration).
 *
 * Covers §6.5 items 45-50: for each of the 9 STATUS_EQ_KINDS, asserts that
 * computeVerdict correctly threads endpoint.response_variants through to the
 * variant-enrichment helper across 5 scenarios:
 *   1. actual === expected, no variants → pass.
 *   2. actual === expected, variants present → pass (variant ignored, DD-4).
 *   3. actual !== expected, no variants → fail (plain template).
 *   4. actual !== expected, variant declared, body matches schema → fail (enriched reason A).
 *   5. actual !== expected, variant declared, body fails schema → fail (enriched reason B + AJV detail).
 *
 * Plus item 50: NON-STATUS_EQ kind with variants → variants IGNORED; existing
 * behaviour unchanged.
 *
 * Design decisions pinned:
 *   DD-4  Variant lookup suppressed when actual === expected.
 *   DD-5  Enrichment applies ONLY to STATUS_EQ_KINDS (9 kinds).
 *   DD-11 response_variants on CanonicalEndpoint, not TestCaseParams.
 *
 * Category: Unit.
 * Expected initial failure: computeVerdict still references the old statusEq()
 *   helper and passes _endpoint (underscore-prefixed, unused). The wiring to
 *   statusEqDispatch in variant-enrichment.ts does not exist yet.
 */

import { describe, it, expect } from "vitest";

import { computeVerdict } from "../../../../src/runner/execute/case-runners.js";
import { SchemaValidator } from "../../../../src/core/schema-validator.js";
import type { CanonicalEndpoint } from "../../../../src/core/canonical-model.js";
import type { ResponseRecord } from "../../../../src/runner/types.js";
import type { TestCase } from "../../../../src/test-catalog/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const schemaValidator = new SchemaValidator();

function makeResponse(status: number, body: unknown = null): ResponseRecord {
  return {
    status,
    headers: { "content-type": "application/json" },
    body,
    time_ms: 10,
  };
}

function makeEndpoint(
  overrides: Partial<CanonicalEndpoint> = {},
): CanonicalEndpoint {
  return {
    id: "users.create",
    name: "Create User",
    method: "POST",
    url: "/api/v1/users",
    request: {},
    response: { expected_status: 201, schema: { type: "object" } },
    ...overrides,
  };
}

function makeCase(kind: string, expectedStatus: number, overrides: Partial<TestCase> = {}): TestCase {
  return {
    id: `test.${kind}`,
    endpoint_id: "users.create",
    type: kind as TestCase["type"],
    marker: "regression",
    title: `${kind} test`,
    prod_safe: false,
    params: {
      kind,
      expected_status: expectedStatus,
    } as TestCase["params"],
    ...overrides,
  };
}

// The 9 STATUS_EQ_KINDS as an array for table-driven testing
const STATUS_EQ_KINDS = [
  "status_code_conformance",
  "no_auth_returns_401",
  "garbage_token_returns_401",
  "method_not_allowed",
  "malformed_json_returns_400",
  "required_field_omission_returns_400",
  "type_violation_returns_400",
  "boundary_battery",
  "pagination_boundary",
] as const;

const VARIANT_SCHEMA = {
  type: "object",
  required: ["error"],
  properties: { error: { type: "string" } },
};

// Body that matches VARIANT_SCHEMA
const MATCHING_BODY = { error: "bad_request" };
// Body that does NOT match VARIANT_SCHEMA (missing required 'error')
const FAILING_BODY = { message: "no error field" };

// ---------------------------------------------------------------------------
// §6.5 — TABLE-DRIVEN: 9 STATUS_EQ_KINDS × 5 scenarios
// ---------------------------------------------------------------------------

describe("computeVerdict — STATUS_EQ_KINDS dispatch through statusEqDispatch", () => {

  for (const kind of STATUS_EQ_KINDS) {
    const expectedStatus = kind.includes("400") ? 400 : kind.includes("401") ? 401 : 201;

    describe(`kind: ${kind}`, () => {

      /**
       * Scenario 1 (item 45): actual === expected, no variants → pass.
       */
      it(`returns pass when actual equals expected_status (no variants)`, () => {
        const testCase = makeCase(kind, expectedStatus);
        const endpoint = makeEndpoint({ response: { expected_status: expectedStatus } });
        const response = makeResponse(expectedStatus);
        const result = computeVerdict(testCase, endpoint, response, true, true, 5000, schemaValidator);
        expect(result.verdict).toBe("pass");
        expect(result.reason).toBeUndefined();
      });

      /**
       * Scenario 2 (item 46): actual === expected, variants present → pass (DD-4: variant ignored).
       */
      it(`returns pass when actual equals expected_status even with variants declared (DD-4)`, () => {
        const variants = {
          [String(expectedStatus)]: { schema: VARIANT_SCHEMA },
          "500": { schema: { type: "object" } },
        };
        const testCase = makeCase(kind, expectedStatus);
        const endpoint = makeEndpoint({
          response: { expected_status: expectedStatus },
          response_variants: variants,
        });
        const response = makeResponse(expectedStatus, MATCHING_BODY);
        const result = computeVerdict(testCase, endpoint, response, true, true, 5000, schemaValidator);
        expect(result.verdict).toBe("pass");
        expect(result.reason).toBeUndefined();
      });

      /**
       * Scenario 3 (item 47): actual !== expected, no variants → fail (plain template).
       */
      it(`returns fail with plain 'expected status E, got A' when actual mismatches (no variants)`, () => {
        const testCase = makeCase(kind, expectedStatus);
        const endpoint = makeEndpoint({ response: { expected_status: expectedStatus } });
        const response = makeResponse(500, { error: "internal" });
        const result = computeVerdict(testCase, endpoint, response, true, true, 5000, schemaValidator);
        expect(result.verdict).toBe("fail");
        expect(result.reason).toBe(`expected status ${expectedStatus}, got 500`);
      });

      /**
       * Scenario 4 (item 48): actual !== expected, variant declared, body matches →
       * fail with enriched reason A.
       */
      it(`returns fail with enriched 'matched' reason when body satisfies the variant schema`, () => {
        const actualStatus = 500;
        const testCase = makeCase(kind, expectedStatus);
        const endpoint = makeEndpoint({
          response: { expected_status: expectedStatus },
          response_variants: { "500": { schema: VARIANT_SCHEMA } },
        });
        const response = makeResponse(actualStatus, MATCHING_BODY);
        const result = computeVerdict(testCase, endpoint, response, true, true, 5000, schemaValidator);
        expect(result.verdict).toBe("fail");
        expect(result.reason).toBe(
          `expected status ${expectedStatus}, got ${actualStatus} (response body matched declared variant schema for ${actualStatus})`,
        );
      });

      /**
       * Scenario 5 (item 49): actual !== expected, variant declared, body fails schema →
       * fail with enriched reason B + AJV detail.
       */
      it(`returns fail with 'did not match' reason + AJV detail when body fails the variant schema`, () => {
        const actualStatus = 500;
        const testCase = makeCase(kind, expectedStatus);
        const endpoint = makeEndpoint({
          response: { expected_status: expectedStatus },
          response_variants: { "500": { schema: VARIANT_SCHEMA } },
        });
        const response = makeResponse(actualStatus, FAILING_BODY);
        const result = computeVerdict(testCase, endpoint, response, true, true, 5000, schemaValidator);
        expect(result.verdict).toBe("fail");
        expect(result.reason).toMatch(
          new RegExp(
            `^expected status ${expectedStatus}, got ${actualStatus} \\(response body did not match declared variant schema for ${actualStatus}:`,
          ),
        );
        // AJV detail tail must be present
        expect(result.reason).toMatch(/error|required/i);
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Item 50: NON-STATUS_EQ kind — variants IGNORED, existing behaviour unchanged
  // ---------------------------------------------------------------------------

  describe("NON-STATUS_EQ kind — variants IGNORED", () => {

    /**
     * Item 50a: content_type_alignment with response_variants declared + 5xx response →
     * existing behaviour (checks Content-Type), variant NOT consulted.
     */
    it("ignores response_variants for content_type_alignment kind (non-status-eq kind, DD-5)", () => {
      const testCase: TestCase = {
        id: "test.cta",
        endpoint_id: "users.create",
        type: "content_type_alignment",
        marker: "smoke",
        title: "Content type alignment",
        prod_safe: false,
        params: { kind: "content_type_alignment" },
      };
      const endpoint = makeEndpoint({
        response_variants: {
          "500": { schema: { type: "object", required: ["error"] } },
        },
      });
      // Status 500, matching variant body — but content_type_alignment checks Content-Type header
      const response: ResponseRecord = {
        status: 500,
        headers: { "content-type": "application/json" },
        body: { error: "server error" },
        time_ms: 10,
      };
      const result = computeVerdict(testCase, endpoint, response, true, true, 5000, schemaValidator);
      // content_type_alignment passes when content-type is present
      expect(result.verdict).toBe("pass");
      // No variant-enrichment in the reason
      expect(result.reason).toBeUndefined();
    });

    /**
     * Item 50b: response_schema_validation with variants declared — uses happy-path schema only.
     */
    it("ignores response_variants for response_schema_validation kind (non-status-eq, DD-5)", () => {
      const happySchema = {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string" } },
      };
      const testCase: TestCase = {
        id: "test.rsv",
        endpoint_id: "users.create",
        type: "response_schema_validation",
        marker: "smoke",
        title: "Response schema validation",
        prod_safe: false,
        params: { kind: "response_schema_validation", schema: happySchema },
      };
      const endpoint = makeEndpoint({
        response: { expected_status: 201, schema: happySchema },
        response_variants: {
          "400": { schema: { type: "object" } },
        },
      });
      // Body valid against happy schema → pass regardless of variants
      const response = makeResponse(201, { id: "abc123" });
      const result = computeVerdict(testCase, endpoint, response, true, true, 5000, schemaValidator);
      expect(result.verdict).toBe("pass");
    });

    /**
     * Item 50c: auth_happy_path with variants declared → is2xx check, not statusEq.
     */
    it("ignores response_variants for auth_happy_path kind (non-status-eq, DD-5)", () => {
      const testCase: TestCase = {
        id: "test.ahp",
        endpoint_id: "users.create",
        type: "auth_happy_path",
        marker: "smoke",
        title: "Auth happy path",
        prod_safe: false,
        params: { kind: "auth_happy_path" },
      };
      const endpoint = makeEndpoint({
        response_variants: { "500": { schema: { type: "object" } } },
      });
      const response = makeResponse(201, { id: "x" });
      const result = computeVerdict(testCase, endpoint, response, true, true, 5000, schemaValidator);
      expect(result.verdict).toBe("pass");
    });
  });
});
