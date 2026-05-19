import { describe, it, expect } from "vitest";

import type {
  EvaluationContext,
} from "../../../src/assertions/index.js";
import type { NormalizedResult } from "../../../src/core/index.js";

/**
 * Unit tests for the assertions type vocabulary — Part 3.
 *
 * Covers: EvaluationContext shape (db keyed connection→queryId→NormalizedResult,
 * now optional vs provided as injectable clock, empty db map).
 *
 * Split from ast-and-result-types-2.test.ts for the 300-line file cap.
 */
describe("EvaluationContext", () => {
  it("compiles with db keyed connection → queryId → NormalizedResult", () => {
    const dbResult: NormalizedResult = {
      rows: [{ count: 1 }],
      rowCount: 1,
      raw: null,
    };
    const ctx: EvaluationContext = {
      request: {
        headers: { authorization: "Bearer tok" },
        body: { email: "test@example.com" },
        url: { full: "https://api.example.com/users", path: "/users", query: {} },
      },
      response: {
        status: 201,
        headers: { "content-type": "application/json" },
        body: { id: "abc", email: "test@example.com" },
        time_ms: 42,
      },
      db: { conn: { q1: dbResult } },
    };
    expect(ctx.response.status).toBe(201);
    expect(ctx.db["conn"]?.["q1"]?.rowCount).toBe(1);
    expect(ctx.now).toBeUndefined();
  });

  it("compiles with now provided — injectable clock for is_recent_timestamp tests", () => {
    const ctx: EvaluationContext = {
      request: {
        headers: {},
        body: null,
        url: { full: "https://api.example.com/", path: "/", query: {} },
      },
      response: { status: 200, headers: {}, body: null, time_ms: 10 },
      db: {},
      now: 1700000000000,
    };
    expect(ctx.now).toBe(1700000000000);
  });

  it("now omitted — default-seam: evaluator calls ctx.now ?? Date.now() at call site", () => {
    const ctx: EvaluationContext = {
      request: {
        headers: {},
        body: null,
        url: { full: "https://api.example.com/", path: "/", query: {} },
      },
      response: { status: 200, headers: {}, body: null, time_ms: 5 },
      db: {},
    };
    // Confirms 'now' is optional — absent by construction, not undefined-valued
    expect("now" in ctx).toBe(false);
  });

  it("compiles with an empty db map (no verification queries)", () => {
    const ctx: EvaluationContext = {
      request: {
        headers: {},
        body: null,
        url: { full: "https://api.example.com/", path: "/", query: {} },
      },
      response: { status: 204, headers: {}, body: null, time_ms: 3 },
      db: {},
    };
    expect(Object.keys(ctx.db)).toHaveLength(0);
  });

  it("db map with multiple connections and queries compiles and is accessible", () => {
    const row: NormalizedResult = { rows: [], rowCount: 0, raw: null };
    const ctx: EvaluationContext = {
      request: {
        headers: {},
        body: null,
        url: { full: "https://api.example.com/", path: "/", query: {} },
      },
      response: { status: 200, headers: {}, body: null, time_ms: 8 },
      db: {
        pg_primary: { check_user: row, check_email: row },
        mongo_logs: { recent: row },
      },
    };
    expect(ctx.db["pg_primary"]?.["check_user"]?.rowCount).toBe(0);
    expect(ctx.db["mongo_logs"]?.["recent"]?.rows).toHaveLength(0);
  });

  it("request.url.query can hold repeated params as string arrays", () => {
    const ctx: EvaluationContext = {
      request: {
        headers: {},
        body: null,
        url: {
          full: "https://api.example.com/?tag=a&tag=b",
          path: "/",
          query: { tag: ["a", "b"] },
        },
      },
      response: { status: 200, headers: {}, body: null, time_ms: 1 },
      db: {},
    };
    expect(ctx.request.url.query["tag"]).toEqual(["a", "b"]);
  });
});
