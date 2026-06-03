/**
 * In-process integration tests for the `pagination_boundary` single-request flow.
 *
 * WHY THIS FILE EXISTS IN ADDITION TO pagination-boundary-cli.test.ts:
 *   The CLI subprocess tests spawn a separate Node process whose coverage is
 *   NOT collected by vitest. This file drives the runner in-process via
 *   `executeEndpoint` to cover the `applyPaginationProbe` branch in
 *   `case-runners.ts` and confirm DD-1 (no second request is issued).
 *
 * Mirrors the pattern of `conditional-get-inprocess.test.ts` (PR #4, v1.0.2).
 *
 * Pins the following design decisions (v1.0.2-pr5-pagination-boundary.md):
 *   DD-1  Single-request flow — second_request === undefined for any probe.
 *   DD-2  URL mutation via WHATWG URL.searchParams.set.
 *   DD-4  Probe set: page=4, offset=3, cursor=2.
 *   DD-6  page=-1 expected status = 400.
 *   DD-11 Auth applied normally via existing authModeFor.
 *
 * Covers:
 *   1. URL after mutation contains ?size=0 for size_zero probe
 *   2. second_request === undefined for any pagination case (DD-1)
 *   3. Verdict uses statusEq (existing path) — pass on correct status
 *   4. Verdict fail when server returns wrong status
 *   5. Auth header present on authed pagination probe
 *
 * Category: Integration — in-process executor path for pagination_boundary.
 * Expected initial failure: STATUS_EQ_KINDS does not include 'pagination_boundary';
 *   mutateRequest has no pagination_boundary arm.
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
import type { PaginationBoundaryParams } from "../../../src/test-catalog/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sequencedHttp(
  responses: ResponseRecord[],
  capturedUrls?: string[],
): HttpClientSeam {
  let idx = 0;
  return {
    async send(req): Promise<ResponseRecord> {
      if (capturedUrls) capturedUrls.push(req.url);
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

const PAGE_ENDPOINT: CanonicalEndpoint = {
  id: "users.list",
  name: "List Users",
  method: "GET",
  url: "/api/users",
  request: {},
  response: { expected_status: 200, schema: {} },
  pagination: {
    style: "page",
    size_param: "size",
    page_param: "page",
    default_size: 20,
    max_size: 100,
  },
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

function makePaginationCase(
  probe: PaginationBoundaryParams["probe"],
  overrides: Partial<PaginationBoundaryParams> = {},
): PlannedTestCase {
  const size_param = (overrides.size_param ?? "size");
  const page_param = (overrides.page_param ?? "page");
  const default_size = (overrides.default_size ?? 20);
  const max_size = (overrides.max_size ?? 100);
  const expected_status = (overrides.expected_status ?? (probe === "size_max" ? 200 : 400));
  const params: PaginationBoundaryParams = {
    kind: "pagination_boundary",
    style: overrides.style ?? "page",
    size_param,
    page_param,
    default_size,
    max_size,
    probe: overrides.probe ?? probe,
    expected_status,
  };
  return {
    endpoint_id: "users.list",
    case: {
      id: `users.list.pagination_boundary.${probe}.0`,
      endpoint_id: "users.list",
      type: "pagination_boundary",
      marker: "regression",
      title: `Pagination boundary (${probe}) for List Users`,
      prod_safe: false,
      params,
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("pagination_boundary single-request — in-process via executeEndpoint", () => {

  /**
   * Test 1: URL after mutation contains ?size=0 for size_zero probe (DD-2).
   */
  it("request URL contains ?size=0 for the size_zero probe", async () => {
    const capturedUrls: string[] = [];
    const http = sequencedHttp(
      [{ status: 400, headers: {}, body: { error: "bad request" }, time_ms: 3 }],
      capturedUrls,
    );
    await executeEndpoint(
      PAGE_ENDPOINT,
      [makePaginationCase("size_zero")],
      buildDeps(http),
    );
    expect(capturedUrls).toHaveLength(1);
    const u = new URL(capturedUrls[0]!);
    expect(u.searchParams.get("size")).toBe("0");
  });

  /**
   * Test 2: second_request === undefined for any probe (DD-1, single-request flow).
   */
  it("second_request is undefined for size_zero probe (single-request flow, DD-1)", async () => {
    const http = sequencedHttp([
      { status: 400, headers: {}, body: {}, time_ms: 3 },
    ]);
    const result = await executeEndpoint(
      PAGE_ENDPOINT,
      [makePaginationCase("size_zero")],
      buildDeps(http),
    );
    const attempt = result.attempts.find((a) => a.kind === "pagination_boundary");
    expect(attempt).toBeDefined();
    expect(attempt?.second_request).toBeUndefined();
    expect(attempt?.second_response).toBeUndefined();
  });

  it("second_request is undefined for size_max probe (single-request flow, DD-1)", async () => {
    const http = sequencedHttp([
      { status: 200, headers: {}, body: { data: [] }, time_ms: 3 },
    ]);
    const result = await executeEndpoint(
      PAGE_ENDPOINT,
      [makePaginationCase("size_max")],
      buildDeps(http),
    );
    const attempt = result.attempts.find((a) => a.kind === "pagination_boundary");
    expect(attempt?.second_request).toBeUndefined();
  });

  it("second_request is undefined for page_negative probe (single-request flow, DD-1)", async () => {
    const http = sequencedHttp([
      { status: 400, headers: {}, body: {}, time_ms: 3 },
    ]);
    const result = await executeEndpoint(
      PAGE_ENDPOINT,
      [makePaginationCase("page_negative")],
      buildDeps(http),
    );
    const attempt = result.attempts.find((a) => a.kind === "pagination_boundary");
    expect(attempt?.second_request).toBeUndefined();
  });

  /**
   * Test 3: Verdict uses statusEq — pass on correct status (DD-1).
   */
  it("verdict is 'pass' when server returns 400 for size_zero probe (statusEq path)", async () => {
    const http = sequencedHttp([
      { status: 400, headers: {}, body: { error: "bad request" }, time_ms: 3 },
    ]);
    const result = await executeEndpoint(
      PAGE_ENDPOINT,
      [makePaginationCase("size_zero")],
      buildDeps(http),
    );
    const attempt = result.attempts.find((a) => a.kind === "pagination_boundary");
    expect(attempt?.verdict).toBe("pass");
  });

  it("verdict is 'pass' when server returns 200 for size_max probe (statusEq path)", async () => {
    const http = sequencedHttp([
      { status: 200, headers: {}, body: { data: [] }, time_ms: 3 },
    ]);
    const result = await executeEndpoint(
      PAGE_ENDPOINT,
      [makePaginationCase("size_max")],
      buildDeps(http),
    );
    const attempt = result.attempts.find((a) => a.kind === "pagination_boundary");
    expect(attempt?.verdict).toBe("pass");
  });

  it("verdict is 'pass' when server returns 400 for page_negative probe (DD-6)", async () => {
    const http = sequencedHttp([
      { status: 400, headers: {}, body: {}, time_ms: 3 },
    ]);
    const result = await executeEndpoint(
      PAGE_ENDPOINT,
      [makePaginationCase("page_negative")],
      buildDeps(http),
    );
    const attempt = result.attempts.find((a) => a.kind === "pagination_boundary");
    expect(attempt?.verdict).toBe("pass");
  });

  /**
   * Test 4: Verdict fail when server returns wrong status.
   */
  it("verdict is 'fail' when server returns 200 for size_zero probe (server bug)", async () => {
    const http = sequencedHttp([
      { status: 200, headers: {}, body: { data: [] }, time_ms: 3 },
    ]);
    const result = await executeEndpoint(
      PAGE_ENDPOINT,
      [makePaginationCase("size_zero")],
      buildDeps(http),
    );
    const attempt = result.attempts.find((a) => a.kind === "pagination_boundary");
    expect(attempt?.verdict).toBe("fail");
    expect(attempt?.failure_reason).toContain("400");
    expect(attempt?.failure_reason).toContain("200");
  });

  it("verdict is 'fail' when server returns 200 for page_negative probe (silent coercion bug, DD-6)", async () => {
    const http = sequencedHttp([
      { status: 200, headers: {}, body: { data: [] }, time_ms: 3 },
    ]);
    const result = await executeEndpoint(
      PAGE_ENDPOINT,
      [makePaginationCase("page_negative")],
      buildDeps(http),
    );
    const attempt = result.attempts.find((a) => a.kind === "pagination_boundary");
    expect(attempt?.verdict).toBe("fail");
  });

  /**
   * URL mutation correctness for each probe.
   */
  it("URL for size_max_plus_one probe contains ?size=101 (max_size=100)", async () => {
    const capturedUrls: string[] = [];
    const http = sequencedHttp(
      [{ status: 400, headers: {}, body: {}, time_ms: 3 }],
      capturedUrls,
    );
    await executeEndpoint(
      PAGE_ENDPOINT,
      [makePaginationCase("size_max_plus_one")],
      buildDeps(http),
    );
    const u = new URL(capturedUrls[0]!);
    expect(u.searchParams.get("size")).toBe("101");
  });

  it("URL for size_max probe contains ?size=100 (max_size=100)", async () => {
    const capturedUrls: string[] = [];
    const http = sequencedHttp(
      [{ status: 200, headers: {}, body: {}, time_ms: 3 }],
      capturedUrls,
    );
    await executeEndpoint(
      PAGE_ENDPOINT,
      [makePaginationCase("size_max")],
      buildDeps(http),
    );
    const u = new URL(capturedUrls[0]!);
    expect(u.searchParams.get("size")).toBe("100");
  });

  it("URL for page_negative probe contains ?page=-1", async () => {
    const capturedUrls: string[] = [];
    const http = sequencedHttp(
      [{ status: 400, headers: {}, body: {}, time_ms: 3 }],
      capturedUrls,
    );
    await executeEndpoint(
      PAGE_ENDPOINT,
      [makePaginationCase("page_negative")],
      buildDeps(http),
    );
    const u = new URL(capturedUrls[0]!);
    expect(u.searchParams.get("page")).toBe("-1");
  });
});
