/**
 * Unit tests for the `applyPaginationProbe` URL mutation helper and the
 * `STATUS_EQ_KINDS` membership for `pagination_boundary`.
 *
 * The helper is private in case-runners.ts, so it is tested indirectly via
 * `mutateRequest` which is exported. `STATUS_EQ_KINDS` membership is verified
 * by exercising `computeVerdict` with a pagination_boundary case.
 *
 * Pins the following design decisions (v1.0.2-pr5-pagination-boundary.md):
 *   DD-1  Single-request flow (no second request).
 *   DD-2  URL mutation via WHATWG URL.searchParams.set (not append).
 *   DD-6  page=-1 expected status = 400.
 *
 * Covers URL mutation tests 1–9 from the task outline:
 *   1. Bare URL (no query string) + size_zero probe
 *   2. URL with existing query string + size_zero probe
 *   3. URL with pre-existing same param (size=5) + size_max probe → REPLACED
 *   4. size_max_plus_one probe with max_size=100 → ?size=101
 *   5. size_max probe with max_size=50 → ?size=50
 *   6. page_negative probe + base URL with other params
 *   7. URL with percent-encoded path characters preserved
 *   8. URL with trailing '?' handled correctly
 *   9. URL fragment preserved across mutation
 *
 * Covers verdict tests:
 *   V1. status 400 + expected 400 → pass
 *   V2. status 200 + expected 200 (size_max happy path) → pass
 *   V3. status 200 + expected 400 → fail with "expected status 400, got 200"
 *   V4. status 500 + expected 400 → fail with "expected status 400, got 500"
 *
 * Category: Unit.
 * Expected initial failure: `pagination_boundary` not in STATUS_EQ_KINDS;
 *   `case "pagination_boundary"` arm missing from mutateRequest.
 */

import { describe, it, expect } from "vitest";

import {
  mutateRequest,
  computeVerdict,
} from "../../../../src/runner/execute/case-runners.js";
import type { RequestRecord, ResponseRecord } from "../../../../src/runner/types.js";
import type { TestCase } from "../../../../src/test-catalog/types.js";
import type { PaginationBoundaryParams } from "../../../../src/test-catalog/test-case-params.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBaseRequest(url: string): RequestRecord {
  return {
    method: "GET",
    url,
    headers: {},
    body: undefined,
  };
}

function makePaginationCase(
  probe: PaginationBoundaryParams["probe"],
  overrides: Partial<PaginationBoundaryParams> = {},
): TestCase {
  const params: PaginationBoundaryParams = {
    kind: "pagination_boundary",
    style: "page",
    size_param: "size",
    page_param: "page",
    default_size: 20,
    max_size: 100,
    probe,
    expected_status: probe === "size_max" ? 200 : 400,
    ...overrides,
  };
  return {
    id: `ep.pagination_boundary.${probe}.0`,
    endpoint_id: "ep",
    type: "pagination_boundary",
    marker: "regression",
    title: `Pagination boundary (${probe})`,
    prod_safe: false,
    params,
  };
}

function makeResponse(status: number): ResponseRecord {
  return {
    status,
    headers: { "content-type": "application/json" },
    body: {},
    time_ms: 5,
  };
}

// ---------------------------------------------------------------------------
// URL mutation tests
// ---------------------------------------------------------------------------

describe("applyPaginationProbe URL mutation (via mutateRequest)", () => {

  describe("test 1 — bare URL (no query string) + size_zero → adds ?size=0", () => {
    it("adds size=0 query param to URL with no existing query string", () => {
      const base = makeBaseRequest("https://api.example.com/users");
      const result = mutateRequest(base, makePaginationCase("size_zero"));
      expect(result.url).toBe("https://api.example.com/users?size=0");
    });
  });

  describe("test 2 — URL with existing query string + size_zero → appends size=0", () => {
    it("preserves existing query params and adds size=0", () => {
      const base = makeBaseRequest("https://api.example.com/users?sort=name");
      const result = mutateRequest(base, makePaginationCase("size_zero"));
      const u = new URL(result.url);
      expect(u.searchParams.get("sort")).toBe("name");
      expect(u.searchParams.get("size")).toBe("0");
    });
  });

  describe("test 3 — URL with pre-existing same param → REPLACED (not appended), DD-2", () => {
    it("overwrites pre-existing size=5 with size_max value (not duplicate)", () => {
      const base = makeBaseRequest("https://api.example.com/users?size=5");
      const result = mutateRequest(base, makePaginationCase("size_max"));
      const u = new URL(result.url);
      // Must be exactly one 'size' param with value 100, not 'size=5&size=100'
      expect(u.searchParams.getAll("size")).toHaveLength(1);
      expect(u.searchParams.get("size")).toBe("100");
    });
  });

  describe("test 4 — size_max_plus_one with max_size=100 → ?size=101", () => {
    it("sets size to max_size+1 for size_max_plus_one probe", () => {
      const base = makeBaseRequest("https://api.example.com/users");
      const result = mutateRequest(
        base,
        makePaginationCase("size_max_plus_one", { max_size: 100 }),
      );
      const u = new URL(result.url);
      expect(u.searchParams.get("size")).toBe("101");
    });
  });

  describe("test 5 — size_max with max_size=50 → ?size=50", () => {
    it("sets size to max_size for size_max probe", () => {
      const base = makeBaseRequest("https://api.example.com/posts");
      const result = mutateRequest(
        base,
        makePaginationCase("size_max", { max_size: 50, expected_status: 200 }),
      );
      const u = new URL(result.url);
      expect(u.searchParams.get("size")).toBe("50");
    });
  });

  describe("test 6 — page_negative probe + base URL with existing params", () => {
    it("adds page=-1 while preserving existing size param", () => {
      const base = makeBaseRequest("https://api.example.com/users?size=10");
      const result = mutateRequest(
        base,
        makePaginationCase("page_negative", { page_param: "page" }),
      );
      const u = new URL(result.url);
      expect(u.searchParams.get("page")).toBe("-1");
      expect(u.searchParams.get("size")).toBe("10");
    });

    it("page_negative uses the page_param name from params", () => {
      const base = makeBaseRequest("https://api.example.com/users");
      const result = mutateRequest(
        base,
        makePaginationCase("page_negative", { page_param: "p" }),
      );
      const u = new URL(result.url);
      expect(u.searchParams.get("p")).toBe("-1");
    });
  });

  describe("test 7 — URL with percent-encoded path characters preserved", () => {
    it("preserves percent-encoded path characters in URL after mutation", () => {
      const base = makeBaseRequest("https://api.example.com/users%2Factive");
      const result = mutateRequest(base, makePaginationCase("size_zero"));
      expect(result.url).toContain("/users%2Factive");
      const u = new URL(result.url);
      expect(u.searchParams.get("size")).toBe("0");
    });
  });

  describe("test 8 — URL with trailing '?' handled correctly", () => {
    it("handles URL with trailing '?' without producing double '?'", () => {
      const base = makeBaseRequest("https://api.example.com/users?");
      const result = mutateRequest(base, makePaginationCase("size_zero"));
      // Should NOT produce ?size=0 as ??size=0 or similar
      expect(result.url).not.toContain("??");
      const u = new URL(result.url);
      expect(u.searchParams.get("size")).toBe("0");
    });
  });

  describe("test 9 — URL fragment preserved across mutation", () => {
    it("preserves URL fragment after query param mutation", () => {
      const base = makeBaseRequest("https://api.example.com/users#section");
      const result = mutateRequest(base, makePaginationCase("size_zero"));
      const u = new URL(result.url);
      expect(u.hash).toBe("#section");
      expect(u.searchParams.get("size")).toBe("0");
    });
  });

  describe("mutation does not touch method, headers, or body", () => {
    it("method remains unchanged after URL mutation", () => {
      const base = makeBaseRequest("https://api.example.com/users");
      const result = mutateRequest(base, makePaginationCase("size_zero"));
      expect(result.method).toBe("GET");
    });

    it("headers remain unchanged after URL mutation", () => {
      const base: RequestRecord = {
        ...makeBaseRequest("https://api.example.com/users"),
        headers: { "Authorization": "Bearer tok" },
      };
      const result = mutateRequest(base, makePaginationCase("size_zero"));
      expect(result.headers).toEqual({ "Authorization": "Bearer tok" });
    });

    it("body remains undefined after URL mutation", () => {
      const base = makeBaseRequest("https://api.example.com/users");
      const result = mutateRequest(base, makePaginationCase("size_zero"));
      expect(result.body).toBeUndefined();
    });
  });
});

// ---------------------------------------------------------------------------
// Verdict / STATUS_EQ_KINDS tests
// ---------------------------------------------------------------------------

describe("pagination_boundary verdict via STATUS_EQ_KINDS dispatch", () => {

  describe("verdict test V1 — status 400 + expected 400 → pass", () => {
    it("returns pass when response status equals expected_status (400)", () => {
      const tc = makePaginationCase("size_zero");
      const { verdict } = computeVerdict(tc, {} as never, makeResponse(400));
      expect(verdict).toBe("pass");
    });
  });

  describe("verdict test V2 — status 200 + expected 200 → pass (size_max)", () => {
    it("returns pass when response status equals expected_status (200, size_max probe)", () => {
      const tc = makePaginationCase("size_max", { expected_status: 200 });
      const { verdict } = computeVerdict(tc, {} as never, makeResponse(200));
      expect(verdict).toBe("pass");
    });
  });

  describe("verdict test V3 — status 200 + expected 400 → fail", () => {
    it("returns fail when server returns 200 but expected 400 (size_zero probe)", () => {
      const tc = makePaginationCase("size_zero");
      const { verdict, reason } = computeVerdict(tc, {} as never, makeResponse(200));
      expect(verdict).toBe("fail");
      expect(reason).toContain("400");
      expect(reason).toContain("200");
    });
  });

  describe("verdict test V4 — status 500 + expected 400 → fail", () => {
    it("returns fail with status-mismatch reason when server returns 500", () => {
      const tc = makePaginationCase("size_max_plus_one");
      const { verdict, reason } = computeVerdict(tc, {} as never, makeResponse(500));
      expect(verdict).toBe("fail");
      expect(reason).toContain("400");
      expect(reason).toContain("500");
    });
  });

  describe("second_request is undefined (single-request flow, DD-1)", () => {
    it("second_request field not present in mutated request (URL mutation only)", () => {
      const base = makeBaseRequest("https://api.example.com/users");
      const result = mutateRequest(base, makePaginationCase("size_zero"));
      // The returned RequestRecord must NOT have a second_request property
      expect("second_request" in result).toBe(false);
    });
  });
});
