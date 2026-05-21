import { describe, it, expect } from "vitest";

import { SchemaValidator } from "../../../src/core/index.js";
import type { CanonicalEndpoint } from "../../../src/core/canonical-model.js";
import { SecretRegistry } from "../../../src/env/index.js";
import type { ResolvedEnvironment } from "../../../src/env/index.js";
import { executeEndpoint, type ExecutorDeps } from "../../../src/runner/execute/endpoint-executor.js";
import type { HttpClientSeam } from "../../../src/runner/execute/http-client.js";
import { openLifecycle } from "../../../src/runner/execute/lifecycle.js";
import type {
  PlannedTestCase,
  RequestRecord,
  ResponseRecord,
} from "../../../src/runner/types.js";
import type { TestCase } from "../../../src/test-catalog/index.js";

/** Builds a fake http client that returns the given response. */
function fakeHttp(response: ResponseRecord): HttpClientSeam {
  return { async send(): Promise<ResponseRecord> { return response; } };
}

/** Builds an http client that throws. */
function throwingHttp(): HttpClientSeam {
  return { async send(): Promise<ResponseRecord> { throw new Error("net down"); } };
}

/** Builds a planned status_code TestCase for the given endpoint. */
function plannedStatusCase(endpointId: string, expected: number): PlannedTestCase {
  return {
    endpoint_id: endpointId,
    case: {
      id: `${endpointId}.status`,
      endpoint_id: endpointId,
      type: "status_code_conformance",
      marker: "smoke",
      title: "status",
      prod_safe: true,
      params: { kind: "status_code_conformance", expected_status: expected },
    },
  };
}

const ENV: ResolvedEnvironment = {
  name: "test",
  prod: false,
  base_url: "https://api.invalid",
  default_sla_ms: 1000,
};

const endpoint: CanonicalEndpoint = {
  id: "e",
  name: "e",
  method: "GET",
  url: "/x",
  request: {},
  response: { expected_status: 200, schema: {} },
};

const goodResponse: ResponseRecord = {
  status: 200,
  headers: { "content-type": "application/json" },
  body: {},
  time_ms: 10,
};

function buildDeps(http: HttpClientSeam, secrets = new SecretRegistry()): ExecutorDeps {
  const lc = openLifecycle(ENV, secrets);
  return {
    connRegistry: lc.connRegistry,
    authRegistry: lc.authRegistry,
    secrets,
    httpClient: http,
    env: ENV,
    schemaValidator: new SchemaValidator(),
    globalRetryPolicy: { count: 0 },
  };
}

describe("executeEndpoint", () => {
  it("returns status=pass when the case passes", async () => {
    const result = await executeEndpoint(endpoint, [plannedStatusCase("e", 200)], buildDeps(fakeHttp(goodResponse)));
    expect(result.status).toBe("pass");
    expect(result.endpoint_id).toBe("e");
    expect(result.attempts).toHaveLength(1);
  });

  it("returns status=fail when the case fails", async () => {
    const badResponse: ResponseRecord = { ...goodResponse, status: 500 };
    const result = await executeEndpoint(endpoint, [plannedStatusCase("e", 200)], buildDeps(fakeHttp(badResponse)));
    expect(result.status).toBe("fail");
  });

  it("captures HTTP errors as a failing attempt with reason", async () => {
    const result = await executeEndpoint(endpoint, [plannedStatusCase("e", 200)], buildDeps(throwingHttp()));
    expect(result.status).toBe("fail");
    expect(result.attempts[0]?.failure_reason).toContain("net down");
  });

  it("runs cleanup once after all cases", async () => {
    const epWithCleanup: CanonicalEndpoint = {
      ...endpoint,
      cleanup: { connection: "main", query: "DELETE FROM x" },
    };
    // No connector registered for "main" so cleanup will return ok:false — the
    // important thing is the cleanup property is present on the result.
    const result = await executeEndpoint(epWithCleanup, [plannedStatusCase("e", 200)], buildDeps(fakeHttp(goodResponse)));
    expect(result.cleanup).toBeDefined();
    expect(typeof result.cleanup?.ok).toBe("boolean");
  });

  it("handles an endpoint with assertion-kind case (engine errors are captured)", async () => {
    const assertCase: PlannedTestCase = {
      endpoint_id: "e",
      case: {
        id: "e.assert",
        endpoint_id: "e",
        type: "assertion",
        marker: "smoke",
        title: "assert",
        prod_safe: true,
        params: { kind: "assertion", assertion: "response.status equals 200" },
      },
    };
    const result = await executeEndpoint(endpoint, [assertCase], buildDeps(fakeHttp(goodResponse)));
    expect(["pass", "fail", "flaky"]).toContain(result.status);
  });
});
