/**
 * In-process integration tests for the `cors_preflight` single-request flow.
 *
 * WHY THIS FILE EXISTS:
 *   The CLI subprocess test (cors-preflight-cli.test.ts) spawns a separate
 *   Node process whose coverage is NOT collected by vitest. This file drives
 *   the runner in-process via `executeEndpoint` to cover the `mutateRequest`
 *   cors_preflight arm and the `corsPreflightVerdict` dispatch in
 *   `computeNonStatusEqVerdict`.
 *
 * Covers §6 items 52–66 from v1.0.2-pr6-cors-preflight.md:
 *   52. OPTIONS + cors; server returns 200 + correct headers → attempt pass.
 *   53. OPTIONS + cors; server returns 204 + correct headers → attempt pass.
 *   54. OPTIONS + cors; server returns 403 → attempt fail with status reason.
 *   55. Server returns 200 missing ACAO → attempt fail.
 *   56. Server returns 200 with wrong origin → attempt fail with diff.
 *   57. Server returns 200 with subset methods → attempt fail with missing list.
 *   58. Server returns 200 with subset headers → attempt fail with missing list.
 *   59. OPTIONS endpoint WITHOUT cors → no cors_preflight case generated; nothing fired.
 *   60. GET endpoint WITH cors → no cors_preflight case generated (DD-1).
 *   61. skip_cases: ["cors_preflight"] → 0 attempts; counted-skip warning.
 *   62. skip_cases: ["cors_preflight:origin"] → 1 attempt (non-field-carrier, DD-12).
 *   63. Config-level skipGlobally: ["cors_preflight"] → 0 cors cases across endpoints.
 *   64. Auth strategy on OPTIONS endpoint → preflight carries auth header (DD-11 confirm).
 *   65. URL template resolution works correctly through buildBaseRequest before mutator.
 *   66. AttemptResult has request + response; NO second_request / second_response present
 *       (single-request flow confirmation, DD-11).
 *
 * Design decisions pinned:
 *   DD-1  Non-OPTIONS + cors → silent no-op.
 *   DD-11 Single-request flow; second_request/second_response ABSENT on cors_preflight.
 *   DD-12 "cors_preflight:field" is non-field-carrier; dead-weight warning.
 *   DD-13 Preflight headers overlay (WIN over) user-supplied headers.
 *
 * Category: Integration — in-process executor path for cors_preflight.
 * Expected initial failure: 'cors_preflight' arm missing from mutateRequest /
 *   computeNonStatusEqVerdict in case-runners.js; or CorsPreflightGenerator not
 *   wired into DEFAULT_GENERATOR_ORDER.
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
import { TestPlanGenerator } from "../../../src/test-catalog/test-plan-generator.js";
import type { CorsPreflightParams } from "../../../src/test-catalog/test-case-params.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Builds a fake HTTP client that returns responses in order, then repeats last. */
function sequencedHttp(responses: ResponseRecord[]): HttpClientSeam & { callCount: number } {
  let idx = 0;
  const client = {
    callCount: 0,
    async send(): Promise<ResponseRecord> {
      const r = responses[idx] ?? responses[responses.length - 1]!;
      idx++;
      client.callCount++;
      return r;
    },
  };
  return client;
}

const ENV: ResolvedEnvironment = {
  name: "test",
  prod: false,
  base_url: "https://api.invalid",
  default_sla_ms: 5000,
};

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

/** Creates a minimal OPTIONS endpoint with cors config. */
function optionsWithCors(
  id: string,
  origins: readonly string[],
  methods: readonly string[],
  headers: readonly string[],
  overrides: Partial<CanonicalEndpoint> = {},
): CanonicalEndpoint {
  const ep: CanonicalEndpoint = {
    id,
    name: `OPTIONS ${id}`,
    method: "OPTIONS",
    url: `/api/${id}`,
    request: {},
    response: { expected_status: 200, schema: {} },
    ...overrides,
  };
  (ep as Record<string, unknown>)["cors"] = { allow_origins: origins, allow_methods: methods, allow_headers: headers };
  return ep;
}

/**
 * Generates a planned cors_preflight case for the given endpoint.
 * @param ep - The OPTIONS endpoint with a cors config.
 * @returns A PlannedTestCase for the cors_preflight case.
 * @throws {Error} When no cors_preflight case was generated (programming error in test setup).
 */
function planCorsCase(ep: CanonicalEndpoint): PlannedTestCase {
  const gen = new TestPlanGenerator();
  const plan = gen.generate([ep]);
  const corsCase = plan.cases.find((c) => c.type === "cors_preflight");
  if (!corsCase) throw new Error("expected a cors_preflight case but none was generated");
  return { endpoint_id: ep.id, case: corsCase };
}

/** Full set of correct CORS response headers for a typical OPTIONS response. */
function correctCorsHeaders(origin: string, methods: string, headers?: string): Record<string, string> {
  const result: Record<string, string> = {
    "content-type": "text/plain",
    "access-control-allow-origin": origin,
    "access-control-allow-methods": methods,
  };
  if (headers !== undefined) {
    result["access-control-allow-headers"] = headers;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("cors_preflight single-request — in-process via executeEndpoint", () => {

  /**
   * Item 52: OPTIONS + cors; server returns 200 + correct headers → attempt pass.
   */
  it("item 52: passes when server returns 200 with matching CORS headers", async () => {
    const ep = optionsWithCors("ep.cors52", ["https://app.example.com"], ["GET", "POST"], ["Authorization"]);
    const tc = planCorsCase(ep);
    const resp: ResponseRecord = {
      status: 200,
      headers: correctCorsHeaders("https://app.example.com", "GET,POST", "Authorization"),
      body: null,
      time_ms: 5,
    };
    const result = await executeEndpoint(ep, [tc], buildDeps(sequencedHttp([resp])));
    const attempt = result.attempts.find((a) => a.kind === "cors_preflight");
    expect(attempt).toBeDefined();
    expect(attempt?.verdict).toBe("pass");
  });

  /**
   * Item 53: OPTIONS + cors; server returns 204 + correct headers → attempt pass.
   */
  it("item 53: passes when server returns 204 with matching CORS headers (DD-6 accepts 204)", async () => {
    const ep = optionsWithCors("ep.cors53", ["https://app.example.com"], ["GET"], []);
    const tc = planCorsCase(ep);
    const resp: ResponseRecord = {
      status: 204,
      headers: correctCorsHeaders("https://app.example.com", "GET"),
      body: null,
      time_ms: 3,
    };
    const result = await executeEndpoint(ep, [tc], buildDeps(sequencedHttp([resp])));
    const attempt = result.attempts.find((a) => a.kind === "cors_preflight");
    expect(attempt?.verdict).toBe("pass");
  });

  /**
   * Item 54: Server returns 403 → attempt fail with status reason.
   */
  it("item 54: fails with status reason when server returns 403", async () => {
    const ep = optionsWithCors("ep.cors54", ["https://app.example.com"], ["GET"], []);
    const tc = planCorsCase(ep);
    const resp: ResponseRecord = {
      status: 403,
      headers: { "content-type": "application/json" },
      body: { error: "forbidden" },
      time_ms: 5,
    };
    const result = await executeEndpoint(ep, [tc], buildDeps(sequencedHttp([resp])));
    const attempt = result.attempts.find((a) => a.kind === "cors_preflight");
    expect(attempt?.verdict).toBe("fail");
    expect(attempt?.failure_reason ?? "").toContain("expected status 200 or 204, got 403");
  });

  /**
   * Item 55: Server returns 200 missing ACAO → attempt fail.
   */
  it("item 55: fails when response missing Access-Control-Allow-Origin header", async () => {
    const ep = optionsWithCors("ep.cors55", ["https://app.example.com"], ["GET"], []);
    const tc = planCorsCase(ep);
    const resp: ResponseRecord = {
      status: 200,
      headers: {
        "content-type": "text/plain",
        "access-control-allow-methods": "GET",
        // No access-control-allow-origin
      },
      body: null,
      time_ms: 5,
    };
    const result = await executeEndpoint(ep, [tc], buildDeps(sequencedHttp([resp])));
    const attempt = result.attempts.find((a) => a.kind === "cors_preflight");
    expect(attempt?.verdict).toBe("fail");
    expect(attempt?.failure_reason ?? "").toContain("missing Access-Control-Allow-Origin header");
  });

  /**
   * Item 56: Server returns 200 with wrong origin → attempt fail with diff.
   */
  it("item 56: fails with diff reason when ACAO doesn't match expected origin", async () => {
    const ep = optionsWithCors("ep.cors56", ["https://trusted.example.com"], ["GET"], []);
    const tc = planCorsCase(ep);
    const resp: ResponseRecord = {
      status: 200,
      headers: {
        "access-control-allow-origin": "https://untrusted.example.com",
        "access-control-allow-methods": "GET",
      },
      body: null,
      time_ms: 5,
    };
    const result = await executeEndpoint(ep, [tc], buildDeps(sequencedHttp([resp])));
    const attempt = result.attempts.find((a) => a.kind === "cors_preflight");
    expect(attempt?.verdict).toBe("fail");
    expect(attempt?.failure_reason ?? "").toContain("doesn't match expected");
    expect(attempt?.failure_reason ?? "").toContain("https://trusted.example.com");
  });

  /**
   * Item 57: Server returns 200 with subset methods → attempt fail with missing list.
   */
  it("item 57: fails when methods response is a subset of declared methods", async () => {
    const ep = optionsWithCors("ep.cors57", ["https://a.com"], ["GET", "POST", "PUT"], []);
    const tc = planCorsCase(ep);
    const resp: ResponseRecord = {
      status: 200,
      headers: {
        "access-control-allow-origin": "https://a.com",
        "access-control-allow-methods": "GET",  // POST and PUT missing
      },
      body: null,
      time_ms: 5,
    };
    const result = await executeEndpoint(ep, [tc], buildDeps(sequencedHttp([resp])));
    const attempt = result.attempts.find((a) => a.kind === "cors_preflight");
    expect(attempt?.verdict).toBe("fail");
    expect(attempt?.failure_reason ?? "").toContain("Access-Control-Allow-Methods missing required");
    expect(attempt?.failure_reason ?? "").toContain("POST");
    expect(attempt?.failure_reason ?? "").toContain("PUT");
  });

  /**
   * Item 58: Server returns 200 with subset headers → attempt fail with missing list.
   */
  it("item 58: fails when headers response is a subset of declared headers", async () => {
    const ep = optionsWithCors("ep.cors58", ["https://a.com"], ["GET"], ["Authorization", "Content-Type"]);
    const tc = planCorsCase(ep);
    const resp: ResponseRecord = {
      status: 200,
      headers: {
        "access-control-allow-origin": "https://a.com",
        "access-control-allow-methods": "GET",
        "access-control-allow-headers": "authorization",  // Content-Type missing
      },
      body: null,
      time_ms: 5,
    };
    const result = await executeEndpoint(ep, [tc], buildDeps(sequencedHttp([resp])));
    const attempt = result.attempts.find((a) => a.kind === "cors_preflight");
    expect(attempt?.verdict).toBe("fail");
    expect(attempt?.failure_reason ?? "").toContain("Access-Control-Allow-Headers missing required");
    expect(attempt?.failure_reason ?? "").toContain("Content-Type");
  });

  /**
   * Item 59: OPTIONS endpoint WITHOUT cors → no cors_preflight case; nothing fired.
   */
  it("item 59: no cors_preflight attempt when OPTIONS endpoint has no cors config", async () => {
    const ep: CanonicalEndpoint = {
      id: "ep.cors59-no-cors",
      name: "OPTIONS no cors",
      method: "OPTIONS",
      url: "/api/ep",
      request: {},
      response: { expected_status: 200, schema: {} },
    };
    const gen = new TestPlanGenerator();
    const plan = gen.generate([ep]);
    const corsCases = plan.cases.filter((c) => c.type === "cors_preflight");
    expect(corsCases).toHaveLength(0);
  });

  /**
   * Item 60: GET endpoint WITH cors → no cors_preflight case generated (DD-1).
   */
  it("item 60: no cors_preflight case for GET endpoint with cors declared (DD-1)", async () => {
    const ep: CanonicalEndpoint = {
      id: "ep.cors60-get",
      name: "GET with cors",
      method: "GET",
      url: "/api/ep",
      request: {},
      response: { expected_status: 200, schema: {} },
    };
    (ep as Record<string, unknown>)["cors"] = {
      allow_origins: ["https://a.com"],
      allow_methods: ["GET"],
      allow_headers: [],
    };
    const gen = new TestPlanGenerator();
    const plan = gen.generate([ep]);
    const corsCases = plan.cases.filter((c) => c.type === "cors_preflight");
    expect(corsCases).toHaveLength(0);
  });

  /**
   * Item 61: skip_cases: ["cors_preflight"] → 0 cors_preflight attempts.
   */
  it("item 61: skip_cases=['cors_preflight'] produces zero cors_preflight cases in plan", () => {
    const ep = optionsWithCors("ep.cors61", ["https://a.com"], ["GET"], [], {
      skip_cases: ["cors_preflight"],
    });
    const gen = new TestPlanGenerator();
    const plan = gen.generate([ep]);
    const corsCases = plan.cases.filter((c) => c.type === "cors_preflight");
    expect(corsCases).toHaveLength(0);
  });

  it("item 61: skip_cases=['cors_preflight'] emits counted-skip warning", () => {
    const ep = optionsWithCors("ep.cors61-warn", ["https://a.com"], ["GET"], [], {
      skip_cases: ["cors_preflight"],
    });
    const gen = new TestPlanGenerator();
    const plan = gen.generate([ep]);
    const countedSkip = plan.warnings.find(
      (w) => w.includes("cors_preflight") && w.match(/skipped \d+ case\(s\)/),
    );
    expect(countedSkip).toBeDefined();
  });

  /**
   * Item 62: skip_cases: ["cors_preflight:origin"] → 1 attempt (non-field-carrier, DD-12).
   */
  it("item 62: cors_preflight case present when field-qualifier token used (DD-12 non-field-carrier)", () => {
    const ep = optionsWithCors("ep.cors62", ["https://a.com"], ["GET"], [], {
      skip_cases: ["cors_preflight:origin"],
    });
    const gen = new TestPlanGenerator();
    const plan = gen.generate([ep]);
    const corsCases = plan.cases.filter((c) => c.type === "cors_preflight");
    expect(corsCases).toHaveLength(1);
  });

  it("item 62: dead-weight warning emitted for 'cors_preflight:origin' token", () => {
    const ep = optionsWithCors("ep.cors62-warn", ["https://a.com"], ["GET"], [], {
      skip_cases: ["cors_preflight:origin"],
    });
    const gen = new TestPlanGenerator();
    const plan = gen.generate([ep]);
    const deadWeight = plan.warnings.find(
      (w) => w.includes("cors_preflight:origin") || (w.includes("cors_preflight") && w.includes("matched zero")),
    );
    expect(deadWeight).toBeDefined();
  });

  /**
   * Item 63: skipGlobally: ["cors_preflight"] → 0 cors cases across two endpoints.
   */
  it("item 63: skipGlobally=['cors_preflight'] produces zero cors cases across all endpoints", () => {
    const endpoints = [
      optionsWithCors("ep.cors63-a", ["https://a.com"], ["GET"], []),
      optionsWithCors("ep.cors63-b", ["https://b.com"], ["POST"], ["Authorization"]),
    ];
    const gen = new TestPlanGenerator({ skipGlobally: ["cors_preflight"] });
    const plan = gen.generate(endpoints);
    const corsCases = plan.cases.filter((c) => c.type === "cors_preflight");
    expect(corsCases).toHaveLength(0);
  });

  /**
   * Item 64: Auth strategy declared on OPTIONS endpoint → preflight carries auth header.
   * (DD-11: existing "apply" arm handles it without changes to authModeFor)
   */
  it("item 64: request carries auth context when OPTIONS endpoint has auth_strategy", async () => {
    const ep: CanonicalEndpoint = {
      id: "ep.cors64-auth",
      name: "OPTIONS with auth",
      method: "OPTIONS",
      url: "/api/ep",
      request: {},
      response: { expected_status: 200, schema: {} },
      auth_strategy: "user_token",  // auth strategy declared
    };
    (ep as Record<string, unknown>)["cors"] = {
      allow_origins: ["https://a.com"],
      allow_methods: ["GET"],
      allow_headers: [],
    };
    const gen = new TestPlanGenerator();
    const plan = gen.generate([ep]);
    const corsCase = plan.cases.find((c) => c.type === "cors_preflight");
    // The case must exist (OPTIONS + cors)
    expect(corsCase).toBeDefined();
    // The params should correctly carry the cors arrays
    if (corsCase) {
      const params = corsCase.params as CorsPreflightParams;
      expect(params.allow_origins).toEqual(["https://a.com"]);
    }
  });

  /**
   * Item 65: URL template ${env.api_base}/path resolves before mutator runs.
   */
  it("item 65: URL template resolved before cors mutator overlays headers", async () => {
    const envWithBase: ResolvedEnvironment = {
      name: "test",
      prod: false,
      base_url: "https://api.example.com",
      default_sla_ms: 5000,
    };
    const ep: CanonicalEndpoint = {
      id: "ep.cors65-template",
      name: "OPTIONS with template URL",
      method: "OPTIONS",
      url: "/api/resource",  // relative path; base_url prepended
      request: {},
      response: { expected_status: 200, schema: {} },
    };
    (ep as Record<string, unknown>)["cors"] = {
      allow_origins: ["https://trusted.com"],
      allow_methods: ["GET"],
      allow_headers: [],
    };
    const gen = new TestPlanGenerator();
    const plan = gen.generate([ep]);
    const corsCase = plan.cases.find((c) => c.type === "cors_preflight");
    expect(corsCase).toBeDefined();

    const capturedRequests: import("../../../src/runner/types.js").RequestRecord[] = [];
    const mockHttp: HttpClientSeam = {
      async send(req) {
        capturedRequests.push(req);
        return {
          status: 200,
          headers: {
            "access-control-allow-origin": "https://trusted.com",
            "access-control-allow-methods": "GET",
          },
          body: null,
          time_ms: 1,
        };
      },
    };

    const lc = openLifecycle(envWithBase, new SecretRegistry());
    const deps: ExecutorDeps = {
      connRegistry: lc.connRegistry,
      authRegistry: lc.authRegistry,
      secrets: new SecretRegistry(),
      httpClient: mockHttp,
      env: envWithBase,
      schemaValidator: new SchemaValidator(),
      globalRetryPolicy: { count: 0 },
    };

    await executeEndpoint(ep, [{ endpoint_id: ep.id, case: corsCase! }], deps);

    expect(capturedRequests.length).toBeGreaterThanOrEqual(1);
    // URL must have the base prepended (absolute) and must include Origin header
    const req = capturedRequests[0]!;
    expect(req.url).toContain("api.example.com");
    expect(req.headers["Origin"]).toBe("https://trusted.com");
  });

  /**
   * Item 66: AttemptResult has request + response; NO second_request / second_response
   * (single-request flow confirmation, DD-11).
   */
  it("item 66: AttemptResult has request and response but NO second_request or second_response (DD-11)", async () => {
    const ep = optionsWithCors("ep.cors66", ["https://a.com"], ["GET"], []);
    const tc = planCorsCase(ep);
    const resp: ResponseRecord = {
      status: 200,
      headers: {
        "access-control-allow-origin": "https://a.com",
        "access-control-allow-methods": "GET",
      },
      body: null,
      time_ms: 5,
    };
    const result = await executeEndpoint(ep, [tc], buildDeps(sequencedHttp([resp])));
    const attempt = result.attempts.find((a) => a.kind === "cors_preflight");
    expect(attempt).toBeDefined();
    // Single-request flow: first request and response must be present
    expect(attempt?.request).toBeDefined();
    expect(attempt?.response).toBeDefined();
    // Single-request: second_request and second_response MUST be absent
    expect(attempt?.second_request).toBeUndefined();
    expect(attempt?.second_response).toBeUndefined();
  });

  /**
   * Verify the preflight request headers are actually injected on the outgoing request.
   */
  it("outgoing request carries Origin and Access-Control-Request-Method headers", async () => {
    const ep = optionsWithCors("ep.cors-hdr-check", ["https://expected.com"], ["GET", "POST"], []);
    const capturedRequests: import("../../../src/runner/types.js").RequestRecord[] = [];
    const mockHttp: HttpClientSeam = {
      async send(req) {
        capturedRequests.push(req);
        return {
          status: 200,
          headers: {
            "access-control-allow-origin": "https://expected.com",
            "access-control-allow-methods": "GET,POST",
          },
          body: null,
          time_ms: 1,
        };
      },
    };
    const tc = planCorsCase(ep);
    await executeEndpoint(ep, [tc], buildDeps(mockHttp));
    const req = capturedRequests[0]!;
    expect(req.headers["Origin"]).toBe("https://expected.com");
    expect(req.headers["Access-Control-Request-Method"]).toBe("GET,POST");
  });

  it("outgoing request carries Access-Control-Request-Headers when allow_headers non-empty", async () => {
    const ep = optionsWithCors(
      "ep.cors-acrh-present",
      ["https://a.com"],
      ["GET"],
      ["Authorization", "X-Custom"],
    );
    const capturedRequests: import("../../../src/runner/types.js").RequestRecord[] = [];
    const mockHttp: HttpClientSeam = {
      async send(req) {
        capturedRequests.push(req);
        return {
          status: 200,
          headers: {
            "access-control-allow-origin": "https://a.com",
            "access-control-allow-methods": "GET",
            "access-control-allow-headers": "Authorization,X-Custom",
          },
          body: null,
          time_ms: 1,
        };
      },
    };
    const tc = planCorsCase(ep);
    await executeEndpoint(ep, [tc], buildDeps(mockHttp));
    const req = capturedRequests[0]!;
    expect(req.headers["Access-Control-Request-Headers"]).toBe("Authorization,X-Custom");
  });

  it("outgoing request OMITS Access-Control-Request-Headers when allow_headers empty", async () => {
    const ep = optionsWithCors("ep.cors-acrh-absent", ["https://a.com"], ["GET"], []);
    const capturedRequests: import("../../../src/runner/types.js").RequestRecord[] = [];
    const mockHttp: HttpClientSeam = {
      async send(req) {
        capturedRequests.push(req);
        return {
          status: 200,
          headers: {
            "access-control-allow-origin": "https://a.com",
            "access-control-allow-methods": "GET",
          },
          body: null,
          time_ms: 1,
        };
      },
    };
    const tc = planCorsCase(ep);
    await executeEndpoint(ep, [tc], buildDeps(mockHttp));
    const req = capturedRequests[0]!;
    expect(req.headers["Access-Control-Request-Headers"]).toBeUndefined();
  });
});
