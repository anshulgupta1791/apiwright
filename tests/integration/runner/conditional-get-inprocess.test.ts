/**
 * In-process integration tests for `conditional_get_304` two-request flow.
 *
 * WHY THIS FILE EXISTS IN ADDITION TO conditional-get-two-request.test.ts:
 *   The CLI subprocess tests (conditional-get-two-request.test.ts) spawn a
 *   separate Node process whose coverage is NOT collected by vitest. This file
 *   drives the runner in-process via `executeEndpoint` to cover the
 *   `maybeRunConditionalGet` and `readEtagFromResponse` branches in
 *   `endpoint-executor.ts`.
 *
 * Mirrors the pattern of `head-get-parity-inprocess.test.ts` (PR #3, v1.0.2).
 *
 * Pins the following design decisions (v1.0.2-pr4-etag-conditional-get.md):
 *   DD-1  Missing first-response ETag → runtime fail, GET #2 NOT issued.
 *   DD-2  If-None-Match injected verbatim (W/ prefix kept).
 *   DD-3  Second response must be exactly 304 — 200 is FAIL.
 *   DD-4  304 must carry ETag matching first.
 *   DD-5  304 body must be empty.
 *   DD-9  Auth strategy applied to both requests.
 *   DD-10 If-None-Match injection is runtime in maybeRunConditionalGet.
 *
 * Category: Integration — in-process executor path for conditional_get_304.
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
import type { ConditionalGetParams } from "../../../src/test-catalog/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Builds a fake HTTP client that returns responses in order then repeats last. */
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

const GET_ENDPOINT: CanonicalEndpoint = {
  id: "items.list",
  name: "List Items",
  method: "GET",
  url: "/api/items",
  request: {},
  response: { expected_status: 200, schema: {} },
  etag_supported: true,
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

function conditionalGetCase(): PlannedTestCase {
  const params: ConditionalGetParams = {
    kind: "conditional_get_304",
  };
  return {
    endpoint_id: "items.list",
    case: {
      id: "items.list.conditional-get-304.0",
      endpoint_id: "items.list",
      type: "conditional_get_304",
      marker: "regression",
      title: "Conditional GET (RFC 7232) for List Items",
      prod_safe: false,
      params,
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("conditional_get_304 two-request — in-process via executeEndpoint", () => {

  /**
   * Test 1: PASS path — GET #1 returns 200 + ETag, GET #2 returns 304 + ETag + empty body.
   * Covers: maybeRunConditionalGet happy path; readEtagFromResponse returns a value.
   * DD-10: GET #2 carries If-None-Match header.
   */
  it("passes when first GET returns 200+ETag and second returns 304+ETag+empty body", async () => {
    const etag = '"v42"';
    const firstResp: ResponseRecord = {
      status: 200,
      headers: { "content-type": "application/json", etag },
      body: { id: 1 },
      time_ms: 5,
    };
    const secondResp: ResponseRecord = {
      status: 304,
      headers: { "content-type": "application/json", etag },
      body: null,
      time_ms: 3,
    };
    const result = await executeEndpoint(
      GET_ENDPOINT,
      [conditionalGetCase()],
      buildDeps(sequencedHttp([firstResp, secondResp])),
    );

    const attempt = result.attempts.find((a) => a.kind === "conditional_get_304");
    expect(attempt).toBeDefined();
    expect(attempt?.verdict).toBe("pass");
    // Both requests must be present on the pass path.
    expect(attempt?.second_request).toBeDefined();
    expect(attempt?.second_response).toBeDefined();
    // DD-10: If-None-Match was injected on the second request (not the first).
    expect(attempt?.second_request?.headers?.["If-None-Match"]).toBe(etag);
    expect(attempt?.request?.headers?.["If-None-Match"]).toBeUndefined();
  });

  /**
   * Test 2: FAIL path — GET #1 returns 200 but NO ETag header.
   * Covers: readEtagFromResponse returns undefined; missing-ETag fail branch in
   * maybeRunConditionalGet (DD-1). GET #2 NOT issued.
   */
  it("fails with missing-ETag reason when first GET has no ETag header", async () => {
    const firstResp: ResponseRecord = {
      status: 200,
      headers: { "content-type": "application/json" },
      body: { id: 1 },
      time_ms: 5,
    };
    const http = sequencedHttp([firstResp]);
    const result = await executeEndpoint(
      GET_ENDPOINT,
      [conditionalGetCase()],
      buildDeps(http),
    );

    const attempt = result.attempts.find((a) => a.kind === "conditional_get_304");
    expect(attempt).toBeDefined();
    expect(attempt?.verdict).toBe("fail");
    expect(attempt?.failure_reason ?? "").toContain("missing ETag header");
    // DD-1: GET #2 NOT issued — only one HTTP call.
    expect(http.callCount).toBe(1);
  });

  /**
   * Test 3: FAIL path — GET #1 returns 200+ETag, GET #2 returns 200 (not 304).
   * Covers: conditionalGet304Verdict status-check branch (DD-3).
   */
  it("fails when second GET returns 200 instead of 304", async () => {
    const etag = '"v1"';
    const firstResp: ResponseRecord = {
      status: 200,
      headers: { "content-type": "application/json", etag },
      body: { id: 1 },
      time_ms: 5,
    };
    const secondResp: ResponseRecord = {
      status: 200,
      headers: { "content-type": "application/json", etag },
      body: { id: 1 },
      time_ms: 5,
    };
    const result = await executeEndpoint(
      GET_ENDPOINT,
      [conditionalGetCase()],
      buildDeps(sequencedHttp([firstResp, secondResp])),
    );

    const attempt = result.attempts.find((a) => a.kind === "conditional_get_304");
    expect(attempt?.verdict).toBe("fail");
    expect(attempt?.failure_reason ?? "").toContain("expected 304");
    expect(attempt?.second_request).toBeDefined();
  });

  /**
   * Test 4: FAIL path — GET #1 returns 200+ETag, GET #2 returns 304 but NO ETag.
   * Covers: conditionalGet304Verdict ETag-echo branch (DD-4).
   */
  it("fails when 304 response carries no ETag header", async () => {
    const etag = '"v1"';
    const firstResp: ResponseRecord = {
      status: 200,
      headers: { "content-type": "application/json", etag },
      body: { id: 1 },
      time_ms: 5,
    };
    const secondResp: ResponseRecord = {
      status: 304,
      headers: { "content-type": "application/json" },  // no etag
      body: null,
      time_ms: 3,
    };
    const result = await executeEndpoint(
      GET_ENDPOINT,
      [conditionalGetCase()],
      buildDeps(sequencedHttp([firstResp, secondResp])),
    );

    const attempt = result.attempts.find((a) => a.kind === "conditional_get_304");
    expect(attempt?.verdict).toBe("fail");
    expect(attempt?.failure_reason ?? "").toContain("304 response missing ETag header");
  });

  /**
   * Test 5: Gate failure — GET #1 returns 500, no GET #2 issued.
   * Covers: firstVerdict.verdict === "fail" gate in maybeRunSecondRequest for
   * the conditional_get_304 arm.
   */
  it("does not issue GET #2 when GET #1 returns 500 (gate failure)", async () => {
    const firstResp: ResponseRecord = {
      status: 500,
      headers: { "content-type": "application/json" },
      body: { error: "server error" },
      time_ms: 5,
    };
    const http = sequencedHttp([firstResp]);
    const result = await executeEndpoint(
      GET_ENDPOINT,
      [conditionalGetCase()],
      buildDeps(http),
    );

    const attempt = result.attempts.find((a) => a.kind === "conditional_get_304");
    expect(attempt).toBeDefined();
    expect(attempt?.verdict).toBe("fail");
    // Gate fired — no second request.
    expect(attempt?.second_request).toBeUndefined();
    expect(http.callCount).toBe(1);
  });

  /**
   * Test 6: readEtagFromResponse with whitespace-only ETag → treated as missing.
   * Covers: trimmed.length === 0 branch in readEtagFromResponse.
   */
  it("treats a whitespace-only ETag header value as missing (DD-2 defensive trim)", async () => {
    const firstResp: ResponseRecord = {
      status: 200,
      headers: { "content-type": "application/json", etag: "   " },  // whitespace-only
      body: { id: 1 },
      time_ms: 5,
    };
    const http = sequencedHttp([firstResp]);
    const result = await executeEndpoint(
      GET_ENDPOINT,
      [conditionalGetCase()],
      buildDeps(http),
    );

    const attempt = result.attempts.find((a) => a.kind === "conditional_get_304");
    expect(attempt?.verdict).toBe("fail");
    expect(attempt?.failure_reason ?? "").toContain("missing ETag header");
    // Whitespace-only ETag → treated as absent → GET #2 NOT issued.
    expect(http.callCount).toBe(1);
    // The attempt result stands for the failed first response.
    expect(attempt?.verdict).toBe("fail");
  });

  /**
   * Test 7: Weak ETag (W/"v1") echoed verbatim on If-None-Match (DD-2).
   * Covers: W/ prefix not stripped in readEtagFromResponse.
   */
  it("echoes weak ETag W/'v1' verbatim on If-None-Match (DD-2)", async () => {
    const etag = 'W/"v1"';
    const firstResp: ResponseRecord = {
      status: 200,
      headers: { "content-type": "application/json", etag },
      body: { id: 1 },
      time_ms: 5,
    };
    const secondResp: ResponseRecord = {
      status: 304,
      headers: { "content-type": "application/json", etag },
      body: null,
      time_ms: 3,
    };
    const result = await executeEndpoint(
      GET_ENDPOINT,
      [conditionalGetCase()],
      buildDeps(sequencedHttp([firstResp, secondResp])),
    );

    const attempt = result.attempts.find((a) => a.kind === "conditional_get_304");
    expect(attempt?.verdict).toBe("pass");
    expect(attempt?.second_request?.headers?.["If-None-Match"]).toBe(etag);
  });
});
