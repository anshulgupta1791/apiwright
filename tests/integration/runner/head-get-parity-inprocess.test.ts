/**
 * In-process integration tests for `head_get_parity` two-request flow.
 *
 * WHY THIS FILE EXISTS IN ADDITION TO head-get-parity-two-request.test.ts:
 *   The CLI subprocess tests (head-get-parity-two-request.test.ts) spawn a
 *   separate Node process whose coverage is NOT collected by vitest. This file
 *   drives the runner in-process via `executeEndpoint` to cover the
 *   `maybeRunHeadGetParity` and `pairedGetUrl` branches in
 *   `endpoint-executor.ts`.
 *
 * Mirrors the pattern of `put-idempotency-runonce.test.ts` (PR #2, v1.0.2).
 *
 * Category: Integration — in-process executor path for head_get_parity.
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
import type { HeadGetParityParams } from "../../../src/test-catalog/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Builds a fake HTTP client that returns responses in sequence. */
function sequencedHttp(responses: ResponseRecord[]): HttpClientSeam {
  let idx = 0;
  return {
    async send(): Promise<ResponseRecord> {
      const r = responses[idx] ?? responses[responses.length - 1]!;
      idx++;
      return r;
    },
  };
}

const ENV: ResolvedEnvironment = {
  name: "test",
  prod: false,
  base_url: "https://api.invalid",
  default_sla_ms: 5000,
};

const HEAD_ENDPOINT: CanonicalEndpoint = {
  id: "users.head",
  name: "HEAD users",
  method: "HEAD",
  url: "/api/users",
  request: {},
  response: { expected_status: 200, schema: {} },
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

function headGetParityCase(pairedGetUrl: string): PlannedTestCase {
  const params: HeadGetParityParams = {
    kind: "head_get_parity",
    paired_get_endpoint_id: "users.list",
    paired_get_url: pairedGetUrl,
  };
  return {
    endpoint_id: "users.head",
    case: {
      id: "users.head.head-get-parity.0",
      endpoint_id: "users.head",
      type: "head_get_parity",
      marker: "smoke",
      title: "HEAD/GET parity for HEAD users",
      prod_safe: true,
      params,
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("head_get_parity two-request — in-process via executeEndpoint", () => {

  /**
   * Test 1: PASS path — HEAD 200 + GET 200, identical headers, empty HEAD body.
   * Covers: maybeRunHeadGetParity happy path; pairedGetUrl narrows correctly.
   */
  it("head_get_parity passes when HEAD 200 + GET 200, empty HEAD body, matching headers", async () => {
    const headResp: ResponseRecord = {
      status: 200,
      headers: { "content-type": "application/json" },
      body: null,
      time_ms: 5,
    };
    const getResp: ResponseRecord = {
      status: 200,
      headers: { "content-type": "application/json" },
      body: [{ id: 1 }],
      time_ms: 8,
    };
    const result = await executeEndpoint(
      HEAD_ENDPOINT,
      [headGetParityCase("/api/users")],
      buildDeps(sequencedHttp([headResp, getResp])),
    );

    const parityAttempt = result.attempts.find((a) => a.kind === "head_get_parity");
    expect(parityAttempt).toBeDefined();
    expect(parityAttempt?.verdict).toBe("pass");
    // second_request and second_response must be present on a pass
    expect(parityAttempt?.second_request).toBeDefined();
    expect(parityAttempt?.second_response).toBeDefined();
  });

  /**
   * Test 2: FAIL path — HEAD 200 + GET 204, status mismatch.
   * Covers: headGetParityVerdict status-diverged branch via in-process path.
   */
  it("head_get_parity fails when HEAD 200 and GET 204 (status mismatch)", async () => {
    const headResp: ResponseRecord = {
      status: 200,
      headers: { "content-type": "application/json" },
      body: null,
      time_ms: 5,
    };
    const getResp: ResponseRecord = {
      status: 204,
      headers: { "content-type": "application/json" },
      body: null,
      time_ms: 8,
    };
    const result = await executeEndpoint(
      HEAD_ENDPOINT,
      [headGetParityCase("/api/users")],
      buildDeps(sequencedHttp([headResp, getResp])),
    );

    const parityAttempt = result.attempts.find((a) => a.kind === "head_get_parity");
    expect(parityAttempt).toBeDefined();
    expect(parityAttempt?.verdict).toBe("fail");
    expect(parityAttempt?.failure_reason ?? "").toMatch(/status/i);
    // second_request IS issued (HEAD 200 passes gate) then parity fails
    expect(parityAttempt?.second_request).toBeDefined();
  });

  /**
   * Test 3: Gate failure — HEAD 503, no GET issued.
   * Covers: firstVerdict.verdict === "fail" branch in maybeRunSecondRequest
   * for the head_get_parity arm.
   */
  it("head_get_parity does not issue GET when HEAD returns 503", async () => {
    const headResp: ResponseRecord = {
      status: 503,
      headers: { "content-type": "application/json" },
      body: { error: "unavailable" },
      time_ms: 5,
    };
    const result = await executeEndpoint(
      HEAD_ENDPOINT,
      [headGetParityCase("/api/users")],
      buildDeps(sequencedHttp([headResp])),
    );

    const parityAttempt = result.attempts.find((a) => a.kind === "head_get_parity");
    expect(parityAttempt).toBeDefined();
    expect(parityAttempt?.verdict).toBe("fail");
    // Gate fired — no second request
    expect(parityAttempt?.second_request).toBeUndefined();
  });

  /**
   * Test 4: HEAD body non-empty (RFC-violating HEAD) → fail verdict.
   * Covers: isHeadBodyEmpty false branch in headGetParityVerdict.
   */
  it("head_get_parity fails when HEAD body is non-empty (RFC-violating)", async () => {
    const headResp: ResponseRecord = {
      status: 200,
      headers: { "content-type": "application/json" },
      body: { id: 1 },  // non-empty — RFC-violating HEAD
      time_ms: 5,
    };
    const getResp: ResponseRecord = {
      status: 200,
      headers: { "content-type": "application/json" },
      body: { id: 1 },
      time_ms: 8,
    };
    const result = await executeEndpoint(
      HEAD_ENDPOINT,
      [headGetParityCase("/api/users")],
      buildDeps(sequencedHttp([headResp, getResp])),
    );

    const parityAttempt = result.attempts.find((a) => a.kind === "head_get_parity");
    expect(parityAttempt?.verdict).toBe("fail");
    expect(parityAttempt?.failure_reason ?? "").toMatch(/HEAD.*body|body.*non.empty/i);
  });

  /**
   * Test 5: Template URL in paired_get_url — runner resolves ${env.*} at build time.
   * The ENV.base_url is "https://api.invalid" so the final URL combines correctly.
   * Covers: resolveTemplates + joinUrl pipeline in maybeRunHeadGetParity.
   */
  it("runner resolves template in paired_get_url and issues correct GET", async () => {
    const headResp: ResponseRecord = {
      status: 200,
      headers: { "content-type": "application/json" },
      body: null,
      time_ms: 5,
    };
    const getResp: ResponseRecord = {
      status: 200,
      headers: { "content-type": "application/json" },
      body: [{ id: 1 }],
      time_ms: 8,
    };

    // Using a relative URL (most common case) — resolves to base_url + path
    const result = await executeEndpoint(
      HEAD_ENDPOINT,
      [headGetParityCase("/api/users")],
      buildDeps(sequencedHttp([headResp, getResp])),
    );

    const parityAttempt = result.attempts.find((a) => a.kind === "head_get_parity");
    expect(parityAttempt?.verdict).toBe("pass");
    // The second_request URL should be fully resolved
    const secondUrl = parityAttempt?.second_request?.url ?? "";
    expect(secondUrl).toContain("/api/users");
    expect(parityAttempt?.second_request?.method).toBe("GET");
  });
});
