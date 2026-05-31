import { describe, it, expect } from "vitest";

import { SchemaValidator } from "../../../src/core/index.js";
import type { CanonicalEndpoint } from "../../../src/core/canonical-model.js";
import type { ResolvedEnvironment } from "../../../src/env/types.js";
import type { TestCase } from "../../../src/test-catalog/index.js";

import {
  authModeFor,
  buildBaseRequest,
  computeVerdict,
  deleteIdempotencyVerdict,
  getIdempotencyVerdict,
  mutateRequest,
} from "../../../src/runner/execute/case-runners.js";
import type { ResponseRecord } from "../../../src/runner/types.js";

/**
 * Build a minimal env stub. base_url is required by ResolvedEnvironment;
 * extras (for `${env.X}` lookups) merge on top.
 * @param base_url - The base URL.
 * @param extras - Extra env keys (e.g. for templating tests).
 * @returns A ResolvedEnvironment.
 */
function env(base_url: string, extras: Record<string, unknown> = {}): ResolvedEnvironment {
  return { name: "test", prod: false, base_url, ...extras };
}

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
    const r = buildBaseRequest(ep({ url: "/users", method: "POST" }), env("https://api.example.com"));
    expect(r.url).toBe("https://api.example.com/users");
    expect(r.method).toBe("POST");
  });

  it("handles trailing slash in base + leading slash in path", () => {
    const r = buildBaseRequest(ep({ url: "/users" }), env("https://api.example.com/"));
    expect(r.url).toBe("https://api.example.com/users");
  });

  it("handles missing leading slash in path", () => {
    const r = buildBaseRequest(ep({ url: "users" }), env("https://api.example.com"));
    expect(r.url).toBe("https://api.example.com/users");
  });

  it("copies endpoint request.headers and body_example", () => {
    const e = ep({ request: { headers: { "x-test": "1" }, body_example: { a: 1 } } });
    const r = buildBaseRequest(e, env("https://api.example.com"));
    expect(r.headers).toEqual({ "x-test": "1" });
    expect(r.body).toEqual({ a: 1 });
  });

  // === Issue #79: ${env.X} substitution at request-build time ==============

  it("issue #79: substitutes ${env.X} in URL path segments", () => {
    const e = ep({ url: "/v1/users/${env.tenant_id}/items" });
    const r = buildBaseRequest(e, env("https://api.example.com", { tenant_id: "acme" }));
    expect(r.url).toBe("https://api.example.com/v1/users/acme/items");
  });

  it("issue #79: substitutes ${env.X} in header values", () => {
    const e = ep({ request: { headers: { "X-Tenant": "${env.tenant_id}" } } });
    const r = buildBaseRequest(e, env("https://h.invalid", { tenant_id: "acme" }));
    expect(r.headers["X-Tenant"]).toBe("acme");
  });

  it("issue #79: substitutes ${env.X} in body_example string leaves", () => {
    const e = ep({
      method: "POST",
      request: { body_example: { name: "${env.book_name}", author: "${env.author}" } },
    });
    const r = buildBaseRequest(e, env("https://h.invalid", { book_name: "Dune", author: "Herbert" }));
    expect(r.body).toEqual({ name: "Dune", author: "Herbert" });
  });

  it("issue #79: substitutes ${env.X} in nested body_example object leaves", () => {
    const e = ep({
      method: "POST",
      request: { body_example: { meta: { tag: "${env.tag}", count: 7 } } },
    });
    const r = buildBaseRequest(e, env("https://h.invalid", { tag: "v1" }));
    expect(r.body).toEqual({ meta: { tag: "v1", count: 7 } });
  });

  it("issue #79: leaves body unchanged when no template tokens", () => {
    const e = ep({ method: "POST", request: { body_example: { plain: "value" } } });
    const r = buildBaseRequest(e, env("https://h.invalid"));
    expect(r.body).toEqual({ plain: "value" });
  });

  it("issue #79: throws an internal error when ${env.X} cannot resolve (validate gap)", () => {
    const e = ep({ url: "/x/${env.missing}" });
    expect(() => buildBaseRequest(e, env("https://h.invalid"))).toThrow(/env template resolution failed/);
  });

  // === Issue #79: joinUrl absolute-URL detection ============================

  it("issue #79: returns the resolved URL unchanged when it is absolute (http)", () => {
    // User wrote `${env.base_url}/path` — substitution yields an absolute URL.
    const e = ep({ url: "${env.base_url}/api/items" });
    const r = buildBaseRequest(e, env("https://outer.example.com", { base_url: "http://inner.example.com" }));
    // base_url is the SUBSTITUTED inner URL (path is already absolute), not doubled.
    expect(r.url).toBe("http://inner.example.com/api/items");
  });

  it("issue #79: returns the resolved URL unchanged when it is absolute (https)", () => {
    const e = ep({ url: "${env.base_url}/api/items" });
    const r = buildBaseRequest(e, env("https://outer.example.com", { base_url: "https://inner.example.com" }));
    expect(r.url).toBe("https://inner.example.com/api/items");
  });

  it("issue #79: case-insensitive scheme match (HTTPS)", () => {
    const e = ep({ url: "HTTPS://EXAMPLE.com/path" });
    const r = buildBaseRequest(e, env("https://other.example.com"));
    expect(r.url).toBe("HTTPS://EXAMPLE.com/path");
  });
});

describe("mutateRequest", () => {
  const base = buildBaseRequest(ep({ request: { body_example: { name: "x", age: 5 } } }), env("https://h.invalid"));

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

  // Issue #50: idempotency cases are now TWO-request. `computeVerdict` is
  // the FIRST-RESPONSE GATE only — must be 2xx to proceed. The actual
  // comparison verdict is computed by `getIdempotencyVerdict` /
  // `deleteIdempotencyVerdict` after the second response (covered in a
  // dedicated describe block below).

  it("delete_idempotency first-response gate FAILS when first call returned 404 (nothing to delete)", () => {
    // Previous (buggy) behaviour: 404 on a single response passed because
    // the runner conflated "second-delete expected status" with "first
    // response status". With the two-request fix, the gate requires the
    // FIRST DELETE to actually succeed.
    const tcDel = tc({ kind: "delete_idempotency", second_delete_status: 404 });
    const v = computeVerdict(tcDel, e, res(404), true, true, 100, validator);
    expect(v.verdict).toBe("fail");
    expect(v.reason).toContain("2xx");
  });

  it("delete_idempotency first-response gate passes on 2xx", () => {
    const tcDel = tc({ kind: "delete_idempotency", second_delete_status: 404 });
    const v = computeVerdict(tcDel, e, res(204), true, true, 100, validator);
    expect(v.verdict).toBe("pass");
  });

  it("delete_idempotency first-response gate fails on non-2xx", () => {
    const tcDel = tc({ kind: "delete_idempotency", second_delete_status: 404 });
    const v = computeVerdict(tcDel, e, res(500), true, true, 100, validator);
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

// =============================================================================
// Issue #50 — two-response idempotency comparison helpers
// =============================================================================

/** Build a response record with a JSON body. */
function jsonRes(status: number, body: unknown): ResponseRecord {
  return {
    status,
    headers: { "content-type": "application/json" },
    body,
    time_ms: 1,
  };
}

describe("getIdempotencyVerdict (issue #50)", () => {
  it("passes when both responses are 2xx AND bodies deep-equal (primitive equality)", () => {
    const r1 = jsonRes(200, { v: 42 });
    const r2 = jsonRes(200, { v: 42 });
    expect(getIdempotencyVerdict(r1, r2).verdict).toBe("pass");
  });

  it("passes when bodies are object-equal regardless of key order (canonical JSON)", () => {
    const r1 = jsonRes(200, { a: 1, b: 2, c: 3 });
    const r2 = jsonRes(200, { c: 3, b: 2, a: 1 });
    expect(getIdempotencyVerdict(r1, r2).verdict).toBe("pass");
  });

  it("passes when nested arrays + objects match deeply", () => {
    const r1 = jsonRes(200, { items: [{ id: 1, t: "a" }, { id: 2, t: "b" }] });
    const r2 = jsonRes(200, { items: [{ t: "a", id: 1 }, { t: "b", id: 2 }] });
    expect(getIdempotencyVerdict(r1, r2).verdict).toBe("pass");
  });

  it("fails when bodies differ even by a single field (the classic timestamp bug)", () => {
    const r1 = jsonRes(200, { v: 42, ts: 1000 });
    const r2 = jsonRes(200, { v: 42, ts: 1001 });
    const v = getIdempotencyVerdict(r1, r2);
    expect(v.verdict).toBe("fail");
    expect(v.reason).toContain("diverged");
  });

  it("fails when the second response is non-2xx (regression on retry)", () => {
    const r1 = jsonRes(200, { v: 42 });
    const r2 = jsonRes(503, { error: "transient" });
    const v = getIdempotencyVerdict(r1, r2);
    expect(v.verdict).toBe("fail");
    expect(v.reason).toMatch(/second response status 503/);
  });

  it("fails when array order differs (order matters)", () => {
    const r1 = jsonRes(200, { xs: [1, 2, 3] });
    const r2 = jsonRes(200, { xs: [3, 2, 1] });
    expect(getIdempotencyVerdict(r1, r2).verdict).toBe("fail");
  });

  it("handles primitive bodies (string equality)", () => {
    const r1 = jsonRes(200, "hello");
    const r2 = jsonRes(200, "hello");
    expect(getIdempotencyVerdict(r1, r2).verdict).toBe("pass");
    const r3 = jsonRes(200, "world");
    expect(getIdempotencyVerdict(r1, r3).verdict).toBe("fail");
  });

  it("handles null vs object — different shapes are NOT equal", () => {
    const r1 = jsonRes(200, null);
    const r2 = jsonRes(200, {});
    expect(getIdempotencyVerdict(r1, r2).verdict).toBe("fail");
  });
});

describe("deleteIdempotencyVerdict (issue #50)", () => {
  it("passes when the second DELETE returns the expected status (default 404)", () => {
    const r2 = jsonRes(404, null);
    expect(deleteIdempotencyVerdict(r2, 404).verdict).toBe("pass");
  });

  it("passes when expected status is 204 and second DELETE returns 204", () => {
    const r2 = jsonRes(204, null);
    expect(deleteIdempotencyVerdict(r2, 204).verdict).toBe("pass");
  });

  it("fails when second DELETE returns 204 but expected was 404 (the sticky-delete bug)", () => {
    const r2 = jsonRes(204, null);
    const v = deleteIdempotencyVerdict(r2, 404);
    expect(v.verdict).toBe("fail");
    expect(v.reason).toContain("expected 404");
    expect(v.reason).toContain("returned 204");
  });

  it("fails when second DELETE returns 200 (server didn't actually remove)", () => {
    const r2 = jsonRes(200, { error: "still exists" });
    expect(deleteIdempotencyVerdict(r2, 404).verdict).toBe("fail");
  });

  it("fails when second DELETE returns 500 (server error on second call)", () => {
    const r2 = jsonRes(500, null);
    const v = deleteIdempotencyVerdict(r2, 404);
    expect(v.verdict).toBe("fail");
    expect(v.reason).toContain("returned 500");
  });
});
