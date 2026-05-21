import { describe, it, expect } from "vitest";

import { SchemaValidator } from "../../../src/core/index.js";
import type { CanonicalEndpoint } from "../../../src/core/canonical-model.js";
import { SecretRegistry } from "../../../src/env/index.js";
import type { ResolvedEnvironment } from "../../../src/env/index.js";
import { executeEndpoint, type ExecutorDeps } from "../../../src/runner/execute/endpoint-executor.js";
import type { HttpClientSeam } from "../../../src/runner/execute/http-client.js";
import { openLifecycle } from "../../../src/runner/execute/lifecycle.js";
import type { PlannedTestCase, RequestRecord, ResponseRecord } from "../../../src/runner/types.js";
import type { TestCase } from "../../../src/test-catalog/index.js";

const ENV_WITH_AUTH: ResolvedEnvironment = {
  name: "test",
  prod: false,
  base_url: "https://api.invalid",
  default_sla_ms: 1000,
  auth_strategies: {
    sso: {
      type: "static_token",
      token: "fixture-token-value",
      header: "Authorization",
      header_value: "Bearer ${token}",
    },
  },
};

const endpointWithAuth: CanonicalEndpoint = {
  id: "auth-endpoint",
  name: "Auth Endpoint",
  method: "GET",
  url: "/secure",
  auth_strategy: "sso",
  request: {},
  response: { expected_status: 200, schema: {} },
};

/** Records the headers actually sent for assertions. */
class CapturingHttpClient implements HttpClientSeam {
  lastRequest: RequestRecord | undefined;
  async send(request: RequestRecord): Promise<ResponseRecord> {
    this.lastRequest = request;
    return { status: 200, headers: { "content-type": "application/json" }, body: {}, time_ms: 5 };
  }
}

function caseFor(kind: "status_code_conformance" | "no_auth_returns_401" | "garbage_token_returns_401"): PlannedTestCase {
  const params = kind === "status_code_conformance"
    ? { kind, expected_status: 200 as const }
    : { kind, auth_strategy: "sso", expected_status: 401 as const, ...(kind === "garbage_token_returns_401" ? { garbage_token: "g" } : {}) };
  return {
    endpoint_id: "auth-endpoint",
    case: {
      id: `auth-endpoint.${kind}`,
      endpoint_id: "auth-endpoint",
      type: kind,
      marker: "smoke",
      title: kind,
      prod_safe: true,
      params: params as TestCase["params"],
    },
  };
}

function buildDeps(http: HttpClientSeam): ExecutorDeps {
  const secrets = new SecretRegistry();
  const lc = openLifecycle(ENV_WITH_AUTH, secrets);
  return {
    connRegistry: lc.connRegistry,
    authRegistry: lc.authRegistry,
    secrets,
    httpClient: http,
    env: ENV_WITH_AUTH,
    schemaValidator: new SchemaValidator(),
    globalRetryPolicy: { count: 0 },
  };
}

describe("executeEndpoint — auth-mode dispatch (covers applyAuthForCase branches)", () => {
  it("applies the auth strategy when mode=apply (header is attached)", async () => {
    const client = new CapturingHttpClient();
    await executeEndpoint(endpointWithAuth, [caseFor("status_code_conformance")], buildDeps(client));
    expect(client.lastRequest?.headers["Authorization"]).toBe("Bearer fixture-token-value");
  });

  it("skips auth for no_auth_returns_401 mode (no Authorization header)", async () => {
    const client = new CapturingHttpClient();
    // Expected 401 won't actually come back from fake (it returns 200);
    // we just want the auth-mode dispatch coverage.
    await executeEndpoint(endpointWithAuth, [caseFor("no_auth_returns_401")], buildDeps(client));
    expect(client.lastRequest?.headers["Authorization"]).toBeUndefined();
  });

  it("wraps with garbage marker for garbage_token_returns_401 (header is mangled)", async () => {
    const client = new CapturingHttpClient();
    await executeEndpoint(endpointWithAuth, [caseFor("garbage_token_returns_401")], buildDeps(client));
    // Per the §6 marker, the Authorization header is replaced by the literal garbage value.
    expect(client.lastRequest?.headers["Authorization"]).toContain("garbage");
  });
});
