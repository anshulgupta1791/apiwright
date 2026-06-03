/**
 * In-process integration tests for response_variants verdict enrichment.
 *
 * Drives the runner via executeEndpoint with a scripted HTTP client.
 * Covers §6.7 items 59-69.
 *
 * Test cases are built directly as PlannedTestCase objects (bypassing
 * TestPlanGenerator) because the meta-schema change is part of this PR;
 * using the plan generator would create a circular dependency between
 * M-1 (meta-schema) and M-6 (integration). Direct construction isolates
 * the verdict-enrichment behaviour from the plan-generation change.
 *
 * Design decisions pinned:
 *   DD-4  Variant lookup suppressed when actual === expected.
 *   DD-5  Enrichment applies ONLY to STATUS_EQ_KINDS.
 *   DD-6  Variant match → fail with enriched reason; verdict is still fail.
 *   DD-11 response_variants lives on CanonicalEndpoint, not TestCaseParams.
 *
 * Exact failure-reason templates verified:
 *   "expected status <E>, got <A>"
 *   "expected status <E>, got <A> (response body matched declared variant schema for <A>)"
 *   "expected status <E>, got <A> (response body did not match declared variant schema for <A>: <detail>)"
 *
 * Category: Integration (in-process executor path).
 * Expected initial failure: variant-enrichment.ts does not exist; computeVerdict
 *   does not call statusEqDispatch; endpoint.response_variants is not consulted.
 */

import { describe, it, expect } from "vitest";

import type { CanonicalEndpoint } from "../../../src/core/canonical-model.js";
import { SchemaValidator } from "../../../src/core/index.js";
import { SecretRegistry } from "../../../src/env/index.js";
import type { ResolvedEnvironment } from "../../../src/env/index.js";
import { openLifecycle } from "../../../src/runner/execute/lifecycle.js";
import {
  executeEndpoint,
  type ExecutorDeps,
} from "../../../src/runner/execute/endpoint-executor.js";
import type {
  PlannedTestCase,
  ResponseRecord,
} from "../../../src/runner/types.js";
import type { HttpClientSeam } from "../../../src/runner/execute/http-client.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ENV: ResolvedEnvironment = {
  name: "test",
  prod: false,
  base_url: "https://api.invalid",
  default_sla_ms: 5000,
};

function makeResp(status: number, body: unknown): ResponseRecord {
  return {
    status,
    headers: { "content-type": "application/json" },
    body,
    time_ms: 10,
  };
}

/** HTTP client seam that always returns the same scripted response. */
function staticHttp(response: ResponseRecord): HttpClientSeam {
  return {
    async send(): Promise<ResponseRecord> {
      return response;
    },
  };
}

function buildDeps(http: HttpClientSeam): ExecutorDeps {
  const lc = openLifecycle(ENV, new SecretRegistry());
  return {
    connRegistry: lc.connRegistry,
    authRegistry: lc.authRegistry,
    secrets: new SecretRegistry(),
    httpClient: http,
    env: ENV,
    schemaValidator: new SchemaValidator(),
    globalRetryPolicy: { count: 0 },
  };
}

function makeEndpoint(overrides: Partial<CanonicalEndpoint> = {}): CanonicalEndpoint {
  return {
    id: "users.create",
    name: "Create User",
    method: "POST",
    url: "/api/v1/users",
    markers: ["smoke"],
    request: {
      body_example: { name: "Alice" },
    },
    response: { expected_status: 201, schema: { type: "object", required: ["id"] } },
    ...overrides,
  };
}

/** Builds a minimal PlannedTestCase for status_code_conformance. */
function makeStatusConfCase(endpointId: string, expectedStatus: number): PlannedTestCase {
  return {
    endpoint_id: endpointId,
    case: {
      id: `${endpointId}.status_code_conformance.1`,
      endpoint_id: endpointId,
      type: "status_code_conformance",
      marker: "smoke",
      title: "Status code conformance",
      prod_safe: false,
      params: { kind: "status_code_conformance", expected_status: expectedStatus },
    },
  };
}

/** Builds a minimal PlannedTestCase for auth_happy_path. */
function makeAuthHappyCase(endpointId: string): PlannedTestCase {
  return {
    endpoint_id: endpointId,
    case: {
      id: `${endpointId}.auth_happy_path.1`,
      endpoint_id: endpointId,
      type: "auth_happy_path",
      marker: "smoke",
      title: "Auth happy path",
      prod_safe: false,
      params: { kind: "auth_happy_path" },
    },
  };
}

/** Builds a minimal PlannedTestCase for malformed_json_returns_400. */
function makeMalformedJsonCase(endpointId: string, expectedStatus: number): PlannedTestCase {
  return {
    endpoint_id: endpointId,
    case: {
      id: `${endpointId}.malformed_json.1`,
      endpoint_id: endpointId,
      type: "malformed_json_returns_400",
      marker: "regression",
      title: "Malformed JSON returns 400",
      prod_safe: false,
      params: {
        kind: "malformed_json_returns_400",
        expected_status: expectedStatus,
        malformed_body: "not-json{{{",
      },
    },
  };
}

// ---------------------------------------------------------------------------
// §6.7 Items 59-69
// ---------------------------------------------------------------------------

describe("response_variants orchestration — executeEndpoint in-process", () => {

  /**
   * Item 59: expected_status 201, stub returns 201 → status_code_conformance passes.
   */
  it("item 59: status_code_conformance passes when stub returns 201 (the expected status)", async () => {
    const endpoint = makeEndpoint();
    const cases: PlannedTestCase[] = [makeStatusConfCase(endpoint.id, 201)];

    const deps = buildDeps(staticHttp(makeResp(201, { id: "abc" })));
    const result = await executeEndpoint(endpoint, cases, deps);

    const attempt = result.attempts.find((a) => a.kind === "status_code_conformance");
    expect(attempt).toBeDefined();
    expect(attempt?.verdict).toBe("pass");
    expect(attempt?.failure_reason).toBeUndefined();
  });

  /**
   * Item 60: No response_variants declared, stub returns 400 →
   * status_code_conformance fails with plain "expected status 201, got 400".
   */
  it("item 60: STATUS_EQ case fails with plain reason when no variants and stub returns 400", async () => {
    const endpoint = makeEndpoint();
    const cases: PlannedTestCase[] = [makeStatusConfCase(endpoint.id, 201)];

    const deps = buildDeps(staticHttp(makeResp(400, { error: "bad" })));
    const result = await executeEndpoint(endpoint, cases, deps);

    const attempt = result.attempts.find((a) => a.kind === "status_code_conformance");
    expect(attempt).toBeDefined();
    expect(attempt?.verdict).toBe("fail");
    expect(attempt?.failure_reason).toBe("expected status 201, got 400");
  });

  /**
   * Item 61: response_variants["400"] declared, stub returns 400 + matching body →
   * status_code_conformance fails with enriched reason A.
   */
  it("item 61: STATUS_EQ case fails with enriched 'matched' reason when 400 variant matches body", async () => {
    const endpoint = makeEndpoint({
      response_variants: {
        "400": {
          schema: {
            type: "object",
            required: ["error", "message"],
            properties: {
              error: { type: "string" },
              message: { type: "string" },
            },
          },
        },
      },
    });
    const cases: PlannedTestCase[] = [makeStatusConfCase(endpoint.id, 201)];

    const matchingBody = { error: "validation_error", message: "Name is required" };
    const deps = buildDeps(staticHttp(makeResp(400, matchingBody)));
    const result = await executeEndpoint(endpoint, cases, deps);

    const attempt = result.attempts.find((a) => a.kind === "status_code_conformance");
    expect(attempt).toBeDefined();
    expect(attempt?.verdict).toBe("fail");
    expect(attempt?.failure_reason).toBe(
      "expected status 201, got 400 (response body matched declared variant schema for 400)",
    );
  });

  /**
   * Item 62: response_variants["400"] declared, stub returns 400 + body missing required field →
   * status_code_conformance fails with enriched reason B + AJV detail.
   */
  it("item 62: STATUS_EQ case fails with 'did not match' reason + AJV detail when body fails variant schema", async () => {
    const endpoint = makeEndpoint({
      response_variants: {
        "400": {
          schema: {
            type: "object",
            required: ["error"],
            properties: { error: { type: "string" } },
          },
        },
      },
    });
    const cases: PlannedTestCase[] = [makeStatusConfCase(endpoint.id, 201)];

    // Body is missing required 'error' field
    const badBody = { message: "missing error field" };
    const deps = buildDeps(staticHttp(makeResp(400, badBody)));
    const result = await executeEndpoint(endpoint, cases, deps);

    const attempt = result.attempts.find((a) => a.kind === "status_code_conformance");
    expect(attempt).toBeDefined();
    expect(attempt?.verdict).toBe("fail");
    expect(attempt?.failure_reason).toMatch(
      /^expected status 201, got 400 \(response body did not match declared variant schema for 400:/,
    );
    expect(attempt?.failure_reason).toMatch(/error|required/i);
  });

  /**
   * Item 63: response_variants["500"] declared, stub returns 500 + matching shape →
   * enriched reason A; AttemptResult shape preserved.
   */
  it("item 63: enriched reason A for 500 variant match; AttemptResult shape preserved", async () => {
    const endpoint = makeEndpoint({
      response_variants: {
        "500": {
          schema: {
            type: "object",
            required: ["error"],
            properties: { error: { type: "string" } },
          },
        },
      },
    });
    const cases: PlannedTestCase[] = [makeStatusConfCase(endpoint.id, 201)];

    const body500 = { error: "internal_server_error" };
    const deps = buildDeps(staticHttp(makeResp(500, body500)));
    const result = await executeEndpoint(endpoint, cases, deps);

    const attempt = result.attempts.find((a) => a.kind === "status_code_conformance");
    expect(attempt).toBeDefined();
    expect(attempt?.verdict).toBe("fail");
    expect(attempt?.failure_reason).toBe(
      "expected status 201, got 500 (response body matched declared variant schema for 500)",
    );
    // AttemptResult shape preserved
    expect(attempt?.case_id).toBeDefined();
    expect(attempt?.kind).toBe("status_code_conformance");
    expect(attempt?.attempt).toBe(1);
  });

  /**
   * Item 64: response_variants["500"] declared, stub returns 503 (no variant for 503) →
   * plain reason (no variant match for 503).
   */
  it("item 64: plain reason when actual 503 has no matching variant (only '500' is declared)", async () => {
    const endpoint = makeEndpoint({
      response_variants: {
        "500": { schema: { type: "object", required: ["error"] } },
      },
    });
    const cases: PlannedTestCase[] = [makeStatusConfCase(endpoint.id, 201)];

    const deps = buildDeps(staticHttp(makeResp(503, { error: "service unavailable" })));
    const result = await executeEndpoint(endpoint, cases, deps);

    const attempt = result.attempts.find((a) => a.kind === "status_code_conformance");
    expect(attempt).toBeDefined();
    expect(attempt?.verdict).toBe("fail");
    expect(attempt?.failure_reason).toBe("expected status 201, got 503");
  });

  /**
   * Item 65: response_variants["400"] declared, stub returns 201 (happy path) →
   * pass; variant NEVER consulted (DD-4).
   */
  it("item 65: pass when stub returns 201 (happy path); variant never consulted (DD-4)", async () => {
    const endpoint = makeEndpoint({
      response_variants: {
        "400": { schema: { type: "object", required: ["error"] } },
      },
    });
    const cases: PlannedTestCase[] = [makeStatusConfCase(endpoint.id, 201)];

    const deps = buildDeps(staticHttp(makeResp(201, { id: "new-id" })));
    const result = await executeEndpoint(endpoint, cases, deps);

    const attempt = result.attempts.find((a) => a.kind === "status_code_conformance");
    expect(attempt).toBeDefined();
    expect(attempt?.verdict).toBe("pass");
    expect(attempt?.failure_reason).toBeUndefined();
  });

  /**
   * Item 66: auth_happy_path (NON-STATUS_EQ) with variants declared, stub returns 500 →
   * failure_reason is "expected 2xx, got 500" (DD-5 unchanged, not enriched).
   */
  it("item 66: auth_happy_path uses is2xx check (not variant), failure reason 'expected 2xx, got 500'", async () => {
    // Note: auth_strategy is intentionally absent — the endpoint registry in buildDeps
    // is empty, so setting auth_strategy would cause an auth-lookup error before the
    // HTTP request fires. The test purpose is to verify is2xx (not variant enrichment)
    // runs as the verdict for auth_happy_path; auth strategy presence is orthogonal.
    const endpoint = makeEndpoint({
      response_variants: {
        "500": { schema: { type: "object" } },
      },
    });
    const cases: PlannedTestCase[] = [makeAuthHappyCase(endpoint.id)];

    const deps = buildDeps(staticHttp(makeResp(500, { error: "server error" })));
    const result = await executeEndpoint(endpoint, cases, deps);

    const ahp = result.attempts.find((a) => a.kind === "auth_happy_path");
    expect(ahp).toBeDefined();
    expect(ahp?.verdict).toBe("fail");
    expect(ahp?.failure_reason).toBe("expected 2xx, got 500");
    // Reason must NOT contain variant enrichment text
    expect(ahp?.failure_reason).not.toContain("variant schema");
  });

  /**
   * Item 67: malformed_json_returns_400 case with expected 400, stub returns 400 →
   * PASS (actual === expected from case's POV; DD-4 suppresses variant lookup).
   */
  it("item 67: malformed_json_returns_400 PASSES when stub returns 400 (actual === case expected, DD-4 suppression)", async () => {
    const endpoint = makeEndpoint({
      response_variants: {
        "400": { schema: { type: "object", required: ["error"] } },
      },
    });
    // Case expects 400 (the "negative" case)
    const cases: PlannedTestCase[] = [makeMalformedJsonCase(endpoint.id, 400)];

    // Stub returns 400 — which is what malformed_json_returns_400 expects
    const deps = buildDeps(staticHttp(makeResp(400, { error: "parse_error" })));
    const result = await executeEndpoint(endpoint, cases, deps);

    const attempt = result.attempts.find((a) => a.kind === "malformed_json_returns_400");
    expect(attempt).toBeDefined();
    expect(attempt?.verdict).toBe("pass");
    expect(attempt?.failure_reason).toBeUndefined();
  });

  /**
   * Item 68: malformed_json_returns_400 case with variants["500"] declared,
   * stub returns 500 (malformed JSON triggers 5xx) →
   * fail with enriched reason (5xx tolerance user-facing value).
   */
  it("item 68: malformed_json_returns_400 fails with enriched reason when stub returns 500 with matching variant", async () => {
    const endpoint = makeEndpoint({
      response_variants: {
        "500": {
          schema: {
            type: "object",
            required: ["error"],
            properties: { error: { type: "string" } },
          },
        },
      },
    });
    // Case expects 400 but server returned 500
    const cases: PlannedTestCase[] = [makeMalformedJsonCase(endpoint.id, 400)];

    // Stub returns 500 with matching variant body
    const body500 = { error: "internal_server_error" };
    const deps = buildDeps(staticHttp(makeResp(500, body500)));
    const result = await executeEndpoint(endpoint, cases, deps);

    const attempt = result.attempts.find((a) => a.kind === "malformed_json_returns_400");
    expect(attempt).toBeDefined();
    expect(attempt?.verdict).toBe("fail");
    // Enriched reason must mention "variant schema for 500"
    expect(attempt?.failure_reason).toMatch(/variant schema for 500/);
  });

  /**
   * Item 69: endpoint with two variants ("400", "500") → each tested in isolation.
   */
  it("item 69: two variant statuses ('400', '500') each produce enriched reasons", async () => {
    const endpoint = makeEndpoint({
      response_variants: {
        "400": {
          schema: {
            type: "object",
            required: ["error"],
            properties: { error: { type: "string" } },
          },
        },
        "500": {
          schema: {
            type: "object",
            required: ["code"],
            properties: { code: { type: "integer" } },
          },
        },
      },
    });
    const cases: PlannedTestCase[] = [makeStatusConfCase(endpoint.id, 201)];

    // Test 400 variant with matching body
    {
      const deps = buildDeps(staticHttp(makeResp(400, { error: "bad_request" })));
      const result = await executeEndpoint(endpoint, cases, deps);
      const attempt = result.attempts[0];
      expect(attempt?.failure_reason).toBe(
        "expected status 201, got 400 (response body matched declared variant schema for 400)",
      );
    }

    // Test 500 variant with matching body
    {
      const deps = buildDeps(staticHttp(makeResp(500, { code: 500 })));
      const result = await executeEndpoint(endpoint, cases, deps);
      const attempt = result.attempts[0];
      expect(attempt?.failure_reason).toBe(
        "expected status 201, got 500 (response body matched declared variant schema for 500)",
      );
    }
  });

  /**
   * Backward compat: endpoint with no response_variants → identical to v1.0.1 behaviour.
   */
  it("backward compat: endpoint without response_variants behaves identically to pre-PR7 (plain reason)", async () => {
    const endpoint = makeEndpoint();
    const cases: PlannedTestCase[] = [makeStatusConfCase(endpoint.id, 201)];

    const deps = buildDeps(staticHttp(makeResp(400, { anything: true })));
    const result = await executeEndpoint(endpoint, cases, deps);

    const attempt = result.attempts.find((a) => a.kind === "status_code_conformance");
    expect(attempt).toBeDefined();
    expect(attempt?.verdict).toBe("fail");
    expect(attempt?.failure_reason).toBe("expected status 201, got 400");
  });
});
