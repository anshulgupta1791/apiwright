import { describe, it, expect } from "vitest";

import { SchemaValidator } from "../../../src/core/index.js";
import type { CanonicalEndpoint } from "../../../src/core/canonical-model.js";
import type { TestCase } from "../../../src/test-catalog/index.js";

import {
  authModeFor,
  buildBaseRequest,
  computeVerdict,
  mutateRequest,
} from "../../../src/runner/execute/case-runners.js";
import type { ResponseRecord } from "../../../src/runner/types.js";

/**
 * Build a minimal endpoint stub for case-runner tests.
 * @param overrides - Optional field overrides.
 * @returns A CanonicalEndpoint.
 */
function ep(overrides: Partial<CanonicalEndpoint> = {}): CanonicalEndpoint {
  return {
    id: "e",
    name: "e",
    method: "GET",
    url: "/x",
    request: {},
    response: { expected_status: 200, schema: {} },
    ...overrides,
  };
}

/**
 * Builds a TestCase with a given params payload.
 * @param params - The TestCase.params discriminated union.
 * @returns A TestCase.
 */
function tc(params: TestCase["params"]): TestCase {
  return {
    id: "e.c",
    endpoint_id: "e",
    type: params.kind,
    marker: "smoke",
    title: "t",
    prod_safe: true,
    params,
  };
}

/**
 * Builds a ResponseRecord with given fields.
 * @param status - HTTP status.
 * @param time_ms - Response time.
 * @param headers - Response headers.
 * @param body - Response body.
 * @returns A ResponseRecord.
 */
function res(
  status: number,
  time_ms = 10,
  headers: Record<string, string> = { "content-type": "application/json" },
  body: unknown = {},
): ResponseRecord {
  return { status, time_ms, headers, body };
}

describe("buildBaseRequest", () => {
  it("joins base URL and endpoint path", () => {
    const r = buildBaseRequest(ep({ url: "/users", method: "POST" }), "https://api.example.com");
    expect(r.url).toBe("https://api.example.com/users");
    expect(r.method).toBe("POST");
  });

  it("handles trailing slash in base + leading slash in path", () => {
    const r = buildBaseRequest(ep({ url: "/users" }), "https://api.example.com/");
    expect(r.url).toBe("https://api.example.com/users");
  });

  it("handles missing leading slash in path", () => {
    const r = buildBaseRequest(ep({ url: "users" }), "https://api.example.com");
    expect(r.url).toBe("https://api.example.com/users");
  });

  it("copies endpoint request.headers and body_example", () => {
    const e = ep({ request: { headers: { "x-test": "1" }, body_example: { a: 1 } } });
    const r = buildBaseRequest(e, "https://api.example.com");
    expect(r.headers).toEqual({ "x-test": "1" });
    expect(r.body).toEqual({ a: 1 });
  });
});

describe("mutateRequest", () => {
  const base = buildBaseRequest(ep({ request: { body_example: { name: "x", age: 5 } } }), "https://h.invalid");

  it("substitute_method for method_not_allowed", () => {
    const r = mutateRequest(base, tc({ kind: "method_not_allowed", substitute_method: "POST", expected_status: 405 }));
    expect(r.method).toBe("POST");
  });

  it("malformed_body for malformed_json_returns_400", () => {
    const r = mutateRequest(base, tc({ kind: "malformed_json_returns_400", malformed_body: "{invalid}", expected_status: 400 }));
    expect(r.body).toBe("{invalid}");
    expect(r.headers["Content-Type"]).toBe("application/json");
  });

  it("required_field_omission_returns_400 omits the named field", () => {
    const r = mutateRequest(base, tc({ kind: "required_field_omission_returns_400", omitted_field: "name", expected_status: 400 }));
    expect((r.body as { name?: string }).name).toBeUndefined();
    expect((r.body as { age?: number }).age).toBe(5);
  });

  it("type_violation_returns_400 substitutes wrong-type value", () => {
    const r = mutateRequest(base, tc({ kind: "type_violation_returns_400", field: "age", original_type: "number", wrong_type: "string", expected_status: 400 }));
    expect(typeof (r.body as { age: unknown }).age).toBe("string");
  });

  it("boundary_battery substitutes value at path", () => {
    const r = mutateRequest(base, tc({ kind: "boundary_battery", field: "age", constraint: "minimum", position: "outside", value: -1, expected_status: 400 }));
    expect((r.body as { age: number }).age).toBe(-1);
  });

  it("returns base unchanged for kinds with no mutation", () => {
    const r = mutateRequest(base, tc({ kind: "status_code_conformance", expected_status: 200 }));
    expect(r).toEqual(base);
  });
});

describe("authModeFor", () => {
  it("returns 'skip' for no_auth_returns_401", () => {
    const m = authModeFor(tc({ kind: "no_auth_returns_401", auth_strategy: "x", expected_status: 401 }), ep({ auth_strategy: "x" }));
    expect(m).toBe("skip");
  });

  it("returns 'garbage' for garbage_token_returns_401", () => {
    const m = authModeFor(tc({ kind: "garbage_token_returns_401", auth_strategy: "x", garbage_token: "g", expected_status: 401 }), ep({ auth_strategy: "x" }));
    expect(m).toBe("garbage");
  });

  it("returns 'none' when endpoint has no auth_strategy", () => {
    const m = authModeFor(tc({ kind: "status_code_conformance", expected_status: 200 }), ep({}));
    expect(m).toBe("none");
  });

  it("returns 'apply' when endpoint has auth_strategy and case is normal", () => {
    const m = authModeFor(tc({ kind: "status_code_conformance", expected_status: 200 }), ep({ auth_strategy: "x" }));
    expect(m).toBe("apply");
  });
});

describe("computeVerdict", () => {
  const validator = new SchemaValidator();
  const e = ep();

  it("status_code_conformance pass", () => {
    const v = computeVerdict(tc({ kind: "status_code_conformance", expected_status: 200 }), e, res(200), true, true, 100, validator);
    expect(v.verdict).toBe("pass");
  });

  it("status_code_conformance fail with reason", () => {
    const v = computeVerdict(tc({ kind: "status_code_conformance", expected_status: 200 }), e, res(500), true, true, 100, validator);
    expect(v.verdict).toBe("fail");
    expect(v.reason).toContain("200");
    expect(v.reason).toContain("500");
  });

  it("content_type_alignment fail when header missing", () => {
    const v = computeVerdict(tc({ kind: "content_type_alignment" }), e, res(200, 10, {}, {}), true, true, 100, validator);
    expect(v.verdict).toBe("fail");
  });

  it("response_time_sla pass when within SLA", () => {
    const v = computeVerdict(tc({ kind: "response_time_sla", sla_ms: 100, sla_delegated: false }), e, res(200, 50), true, true, 100, validator);
    expect(v.verdict).toBe("pass");
  });

  it("response_time_sla fail when over SLA", () => {
    const v = computeVerdict(tc({ kind: "response_time_sla", sla_ms: 30, sla_delegated: false }), e, res(200, 100), true, true, 30, validator);
    expect(v.verdict).toBe("fail");
  });

  it("response_time_sla delegates to env default when configured", () => {
    const v = computeVerdict(tc({ kind: "response_time_sla", sla_delegated: true }), e, res(200, 50), true, true, 100, validator);
    expect(v.verdict).toBe("pass");
  });

  it("response_schema_validation pass for matching body", () => {
    const v = computeVerdict(
      tc({ kind: "response_schema_validation", schema: { type: "object" } }),
      e,
      res(200, 10, {}, {}),
      true,
      true,
      100,
      validator,
    );
    expect(v.verdict).toBe("pass");
  });

  it("response_schema_validation fail for mismatching body", () => {
    const v = computeVerdict(
      tc({ kind: "response_schema_validation", schema: { type: "string" } }),
      e,
      res(200, 10, {}, {}),
      true,
      true,
      100,
      validator,
    );
    expect(v.verdict).toBe("fail");
  });

  it("auth_happy_path pass on 2xx", () => {
    const v = computeVerdict(tc({ kind: "auth_happy_path", auth_strategy: "x", unauthenticated: false }), e, res(200), true, true, 100, validator);
    expect(v.verdict).toBe("pass");
  });

  it("no_auth_returns_401 pass when status is 401", () => {
    const v = computeVerdict(tc({ kind: "no_auth_returns_401", auth_strategy: "x", expected_status: 401 }), e, res(401), true, true, 100, validator);
    expect(v.verdict).toBe("pass");
  });

  it("garbage_token_returns_401 pass when status is 401", () => {
    const v = computeVerdict(tc({ kind: "garbage_token_returns_401", auth_strategy: "x", garbage_token: "g", expected_status: 401 }), e, res(401), true, true, 100, validator);
    expect(v.verdict).toBe("pass");
  });

  it("method_not_allowed pass on 405", () => {
    const v = computeVerdict(tc({ kind: "method_not_allowed", substitute_method: "PUT", expected_status: 405 }), e, res(405), true, true, 100, validator);
    expect(v.verdict).toBe("pass");
  });

  it("malformed_json_returns_400 pass on 400", () => {
    const v = computeVerdict(tc({ kind: "malformed_json_returns_400", malformed_body: "x", expected_status: 400 }), e, res(400), true, true, 100, validator);
    expect(v.verdict).toBe("pass");
  });

  it("required_field_omission_returns_400 pass on 400", () => {
    const v = computeVerdict(tc({ kind: "required_field_omission_returns_400", omitted_field: "x", expected_status: 400 }), e, res(400), true, true, 100, validator);
    expect(v.verdict).toBe("pass");
  });

  it("type_violation_returns_400 pass on 400", () => {
    const v = computeVerdict(tc({ kind: "type_violation_returns_400", field: "x", original_type: "string", wrong_type: "number", expected_status: 400 }), e, res(400), true, true, 100, validator);
    expect(v.verdict).toBe("pass");
  });

  it("boundary_battery pass on expected status", () => {
    const v = computeVerdict(tc({ kind: "boundary_battery", field: "x", constraint: "maximum", position: "outside", value: 100, expected_status: 400 }), e, res(400), true, true, 100, validator);
    expect(v.verdict).toBe("pass");
  });

  it("get_idempotency pass on 2xx", () => {
    const v = computeVerdict(tc({ kind: "get_idempotency", compare: "body_equality" }), e, res(200), true, true, 100, validator);
    expect(v.verdict).toBe("pass");
  });

  it("delete_idempotency pass on expected second_delete_status", () => {
    const v = computeVerdict(tc({ kind: "delete_idempotency", second_delete_status: 404 }), e, res(404), true, true, 100, validator);
    expect(v.verdict).toBe("pass");
  });

  it("delete_idempotency pass on 2xx", () => {
    const v = computeVerdict(tc({ kind: "delete_idempotency", second_delete_status: 404 }), e, res(204), true, true, 100, validator);
    expect(v.verdict).toBe("pass");
  });

  it("delete_idempotency fail on unexpected non-2xx", () => {
    const v = computeVerdict(tc({ kind: "delete_idempotency", second_delete_status: 404 }), e, res(500), true, true, 100, validator);
    expect(v.verdict).toBe("fail");
  });

  it("db_state_matches_expectation pass when dbVerifyOk", () => {
    const v = computeVerdict(tc({ kind: "db_state_matches_expectation", connection: "c", query: "q", expect: "exists" }), e, res(200), true, true, 100, validator);
    expect(v.verdict).toBe("pass");
  });

  it("db_state_matches_expectation fail when dbVerifyOk is false", () => {
    const v = computeVerdict(tc({ kind: "db_state_matches_expectation", connection: "c", query: "q", expect: "exists" }), e, res(200), true, false, 100, validator);
    expect(v.verdict).toBe("fail");
  });

  it("assertion pass when assertionOk is true", () => {
    const v = computeVerdict(tc({ kind: "assertion", assertion: "response.status equals 200" }), e, res(200), true, true, 100, validator);
    expect(v.verdict).toBe("pass");
  });

  it("assertion fail when assertionOk is false", () => {
    const v = computeVerdict(tc({ kind: "assertion", assertion: "response.status equals 200" }), e, res(200), false, true, 100, validator);
    expect(v.verdict).toBe("fail");
  });
});
