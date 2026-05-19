import { describe, it, expect } from "vitest";

import {
  TargetResolver,
  MAX_RESOLVE_DEPTH,
} from "../../../src/assertions/target-resolver.js";
import type {
  EvaluationContext,
  TargetRef,
  PathSegment,
} from "../../../src/assertions/index.js";

/**
 * Unit tests for the TargetResolver Layer-C resolver.
 *
 * Covers: ResolvedValue shape contract, all TargetRoot variants, header
 * case-insensitivity, body/url case-sensitivity, db lookup and deep-path walk,
 * explicit-null-vs-missing (locked decision #6), prototype-pollution safety,
 * depth bound (MAX_RESOLVE_DEPTH), OOB index, never-throws guarantee.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCtx(overrides?: Partial<EvaluationContext>): EvaluationContext {
  return {
    request: {
      headers: {},
      body: null,
      url: { full: "http://x/", path: "/", query: {} },
    },
    response: {
      status: 200,
      headers: {},
      body: null,
      time_ms: 42,
    },
    db: {},
    ...overrides,
  };
}

function key(k: string): PathSegment {
  return { kind: "key", key: k };
}

function idx(i: number): PathSegment {
  return { kind: "index", index: i };
}

// ---------------------------------------------------------------------------
// Exported constants
// ---------------------------------------------------------------------------

describe("MAX_RESOLVE_DEPTH", () => {
  it("equals 256", () => {
    expect(MAX_RESOLVE_DEPTH).toBe(256);
  });
});

// ---------------------------------------------------------------------------
// TargetResolver.resolve — leaf roots
// ---------------------------------------------------------------------------

describe("TargetResolver.resolve", () => {
  const resolver = new TargetResolver();

  describe("response.status", () => {
    it("returns found:true with numeric status", () => {
      const ctx = makeCtx({ response: { status: 201, headers: {}, body: null, time_ms: 0 } });
      const ref: TargetRef = { root: "response.status" };
      const result = resolver.resolve(ref, ctx);
      expect(result).toEqual({ found: true, value: 201 });
    });
  });

  describe("response.time_ms", () => {
    it("returns found:true with time_ms value", () => {
      const ctx = makeCtx({ response: { status: 200, headers: {}, body: null, time_ms: 123 } });
      const ref: TargetRef = { root: "response.time_ms" };
      const result = resolver.resolve(ref, ctx);
      expect(result).toEqual({ found: true, value: 123 });
    });
  });

  // ---------------------------------------------------------------------------
  // response.body paths
  // ---------------------------------------------------------------------------

  describe("response.body", () => {
    it("returns whole body when path is empty", () => {
      const body = { id: 1, name: "alice" };
      const ctx = makeCtx({ response: { status: 200, headers: {}, body, time_ms: 0 } });
      const ref: TargetRef = { root: "response.body", path: [] };
      expect(resolver.resolve(ref, ctx)).toEqual({ found: true, value: body });
    });

    it("returns nested value via key path", () => {
      const body = { user: { id: 99 } };
      const ctx = makeCtx({ response: { status: 200, headers: {}, body, time_ms: 0 } });
      const ref: TargetRef = { root: "response.body", path: [key("user"), key("id")] };
      expect(resolver.resolve(ref, ctx)).toEqual({ found: true, value: 99 });
    });

    it("returns array element via index path", () => {
      const body = { items: [10, 20, 30] };
      const ctx = makeCtx({ response: { status: 200, headers: {}, body, time_ms: 0 } });
      const ref: TargetRef = { root: "response.body", path: [key("items"), idx(1)] };
      expect(resolver.resolve(ref, ctx)).toEqual({ found: true, value: 20 });
    });

    it("returns found:true with value:null for explicit JSON null at path", () => {
      const body = { x: null };
      const ctx = makeCtx({ response: { status: 200, headers: {}, body, time_ms: 0 } });
      const ref: TargetRef = { root: "response.body", path: [key("x")] };
      // explicit null is FOUND — locked decision #6
      expect(resolver.resolve(ref, ctx)).toEqual({ found: true, value: null });
    });

    it("returns found:false for missing key", () => {
      const body = { a: 1 };
      const ctx = makeCtx({ response: { status: 200, headers: {}, body, time_ms: 0 } });
      const ref: TargetRef = { root: "response.body", path: [key("b")] };
      expect(resolver.resolve(ref, ctx)).toEqual({ found: false });
    });

    it("returns found:false when descending through null (not the final value)", () => {
      const body = { x: null };
      const ctx = makeCtx({ response: { status: 200, headers: {}, body, time_ms: 0 } });
      const ref: TargetRef = { root: "response.body", path: [key("x"), key("y")] };
      // null with more segments remaining → not-found
      expect(resolver.resolve(ref, ctx)).toEqual({ found: false });
    });

    it("returns found:false for index on non-array", () => {
      const body = { x: { a: 1 } };
      const ctx = makeCtx({ response: { status: 200, headers: {}, body, time_ms: 0 } });
      const ref: TargetRef = { root: "response.body", path: [key("x"), idx(0)] };
      expect(resolver.resolve(ref, ctx)).toEqual({ found: false });
    });

    it("returns found:false for OOB index", () => {
      const body = [1, 2, 3];
      const ctx = makeCtx({ response: { status: 200, headers: {}, body, time_ms: 0 } });
      const ref: TargetRef = { root: "response.body", path: [idx(5)] };
      expect(resolver.resolve(ref, ctx)).toEqual({ found: false });
    });

    it("returns found:false for key on array", () => {
      const body = [1, 2];
      const ctx = makeCtx({ response: { status: 200, headers: {}, body, time_ms: 0 } });
      const ref: TargetRef = { root: "response.body", path: [key("length")] };
      expect(resolver.resolve(ref, ctx)).toEqual({ found: false });
    });
  });

  // ---------------------------------------------------------------------------
  // request.body
  // ---------------------------------------------------------------------------

  describe("request.body", () => {
    it("returns found:true for whole body (empty path)", () => {
      const body = { email: "a@b.com" };
      const ctx = makeCtx({ request: { headers: {}, body, url: { full: "/", path: "/", query: {} } } });
      const ref: TargetRef = { root: "request.body", path: [] };
      expect(resolver.resolve(ref, ctx)).toEqual({ found: true, value: body });
    });

    it("returns found:true for nested key", () => {
      const body = { email: "a@b.com" };
      const ctx = makeCtx({ request: { headers: {}, body, url: { full: "/", path: "/", query: {} } } });
      const ref: TargetRef = { root: "request.body", path: [key("email")] };
      expect(resolver.resolve(ref, ctx)).toEqual({ found: true, value: "a@b.com" });
    });
  });

  // ---------------------------------------------------------------------------
  // Headers — case-insensitive (response.headers)
  // ---------------------------------------------------------------------------

  describe("response.headers — case-insensitive lookup", () => {
    it("resolves lowercase header key when stored uppercase", () => {
      const headers = { "Content-Type": "application/json" };
      const ctx = makeCtx({ response: { status: 200, headers, body: null, time_ms: 0 } });
      const ref: TargetRef = { root: "response.headers", path: [key("content-type")] };
      const result = resolver.resolve(ref, ctx);
      expect(result).toEqual({ found: true, value: "application/json" });
    });

    it("resolves uppercase header key when stored lowercase", () => {
      const headers = { "content-type": "text/plain" };
      const ctx = makeCtx({ response: { status: 200, headers, body: null, time_ms: 0 } });
      const ref: TargetRef = { root: "response.headers", path: [key("Content-Type")] };
      const result = resolver.resolve(ref, ctx);
      expect(result).toEqual({ found: true, value: "text/plain" });
    });

    it("resolves mixed-case header name case-insensitively", () => {
      const headers = { "X-Request-Id": "abc-123" };
      const ctx = makeCtx({ response: { status: 200, headers, body: null, time_ms: 0 } });
      const ref: TargetRef = { root: "response.headers", path: [key("x-request-id")] };
      const result = resolver.resolve(ref, ctx);
      expect(result).toEqual({ found: true, value: "abc-123" });
    });

    it("returns found:false when header name has no case-insensitive match", () => {
      const headers = { "Content-Type": "application/json" };
      const ctx = makeCtx({ response: { status: 200, headers, body: null, time_ms: 0 } });
      const ref: TargetRef = { root: "response.headers", path: [key("authorization")] };
      expect(resolver.resolve(ref, ctx)).toEqual({ found: false });
    });

    it("on collision picks the lexicographically first own key", () => {
      // Two headers differing only by case — lexicographically first wins
      const headers = { "Authorization": "Bearer A", "authorization": "Bearer B" };
      const ctx = makeCtx({ response: { status: 200, headers, body: null, time_ms: 0 } });
      const ref: TargetRef = { root: "response.headers", path: [key("AUTHORIZATION")] };
      const result = resolver.resolve(ref, ctx);
      expect(result.found).toBe(true);
      if (result.found) {
        // "Authorization" < "authorization" lexicographically → "Authorization" wins
        expect(result.value).toBe("Bearer A");
      }
    });
  });

  describe("request.headers — case-insensitive lookup", () => {
    it("resolves header case-insensitively", () => {
      const headers = { "Accept": "application/json" };
      const ctx = makeCtx({ request: { headers, body: null, url: { full: "/", path: "/", query: {} } } });
      const ref: TargetRef = { root: "request.headers", path: [key("accept")] };
      expect(resolver.resolve(ref, ctx)).toEqual({ found: true, value: "application/json" });
    });
  });

  // ---------------------------------------------------------------------------
  // request.url
  // ---------------------------------------------------------------------------

  describe("request.url", () => {
    it("returns whole RequestUrlContext for empty path", () => {
      const url = { full: "http://x/users?a=1", path: "/users", query: { a: "1" } };
      const ctx = makeCtx({ request: { headers: {}, body: null, url } });
      const ref: TargetRef = { root: "request.url", path: [] };
      const result = resolver.resolve(ref, ctx);
      expect(result).toEqual({ found: true, value: url });
    });

    it("resolves request.url.path", () => {
      const url = { full: "http://x/users", path: "/users", query: {} };
      const ctx = makeCtx({ request: { headers: {}, body: null, url } });
      const ref: TargetRef = { root: "request.url", path: [key("path")] };
      expect(resolver.resolve(ref, ctx)).toEqual({ found: true, value: "/users" });
    });

    it("resolves query param via key then key", () => {
      const url = { full: "http://x/?tag=a", path: "/", query: { tag: "a" } };
      const ctx = makeCtx({ request: { headers: {}, body: null, url } });
      const ref: TargetRef = { root: "request.url", path: [key("query"), key("tag")] };
      expect(resolver.resolve(ref, ctx)).toEqual({ found: true, value: "a" });
    });

    it("resolves repeated query param array element via index", () => {
      const url = { full: "http://x/?tag=a&tag=b", path: "/", query: { tag: ["a", "b"] } };
      const ctx = makeCtx({ request: { headers: {}, body: null, url } });
      const ref: TargetRef = { root: "request.url", path: [key("query"), key("tag"), idx(0)] };
      expect(resolver.resolve(ref, ctx)).toEqual({ found: true, value: "a" });
    });
  });

  // ---------------------------------------------------------------------------
  // db root
  // ---------------------------------------------------------------------------

  describe("db root", () => {
    const nr = { rows: [{ id: 1 }], rowCount: 1, raw: null };

    function dbCtx(): EvaluationContext {
      return makeCtx({ db: { primary: { user_check: nr } } });
    }

    it("returns whole NormalizedResult for empty path", () => {
      const ref: TargetRef = { root: "db", connection: "primary", queryId: "user_check", path: [] };
      expect(resolver.resolve(ref, dbCtx())).toEqual({ found: true, value: nr });
    });

    it("resolves rowCount via key step", () => {
      const ref: TargetRef = {
        root: "db", connection: "primary", queryId: "user_check",
        path: [key("rowCount")],
      };
      expect(resolver.resolve(ref, dbCtx())).toEqual({ found: true, value: 1 });
    });

    it("resolves rows[0].id via key + index + key steps", () => {
      const ref: TargetRef = {
        root: "db", connection: "primary", queryId: "user_check",
        path: [key("rows"), idx(0), key("id")],
      };
      expect(resolver.resolve(ref, dbCtx())).toEqual({ found: true, value: 1 });
    });

    it("returns found:false for unknown connection", () => {
      const ref: TargetRef = { root: "db", connection: "missing", queryId: "user_check", path: [] };
      expect(resolver.resolve(ref, dbCtx())).toEqual({ found: false });
    });

    it("returns found:false for unknown queryId", () => {
      const ref: TargetRef = { root: "db", connection: "primary", queryId: "missing", path: [] };
      expect(resolver.resolve(ref, dbCtx())).toEqual({ found: false });
    });

    it("returns found:false for missing column in row", () => {
      const ref: TargetRef = {
        root: "db", connection: "primary", queryId: "user_check",
        path: [key("rows"), idx(0), key("nonexistent")],
      };
      expect(resolver.resolve(ref, dbCtx())).toEqual({ found: false });
    });
  });

  // ---------------------------------------------------------------------------
  // Depth bound
  // ---------------------------------------------------------------------------

  describe("depth bound (MAX_RESOLVE_DEPTH)", () => {
    it("resolves a path of exactly MAX_RESOLVE_DEPTH segments", () => {
      // Build a body nested exactly 256 deep, each keyed "a"
      let obj: unknown = "leaf";
      for (let i = 0; i < MAX_RESOLVE_DEPTH; i++) {
        obj = { a: obj };
      }
      const ctx = makeCtx({ response: { status: 200, headers: {}, body: obj, time_ms: 0 } });
      const path: PathSegment[] = Array.from({ length: MAX_RESOLVE_DEPTH }, () => key("a"));
      const ref: TargetRef = { root: "response.body", path };
      const result = resolver.resolve(ref, ctx);
      expect(result).toEqual({ found: true, value: "leaf" });
    });

    it("returns found:false for a path of MAX_RESOLVE_DEPTH + 1 segments", () => {
      let obj: unknown = "leaf";
      for (let i = 0; i < MAX_RESOLVE_DEPTH + 1; i++) {
        obj = { a: obj };
      }
      const ctx = makeCtx({ response: { status: 200, headers: {}, body: obj, time_ms: 0 } });
      const path: PathSegment[] = Array.from({ length: MAX_RESOLVE_DEPTH + 1 }, () => key("a"));
      const ref: TargetRef = { root: "response.body", path };
      const result = resolver.resolve(ref, ctx);
      expect(result).toEqual({ found: false });
    });
  });

  // ---------------------------------------------------------------------------
  // Prototype-pollution safety
  // ---------------------------------------------------------------------------

  describe("prototype-pollution safety", () => {
    it("returns found:false for __proto__ key segment", () => {
      const body = { normal: 1 };
      const ctx = makeCtx({ response: { status: 200, headers: {}, body, time_ms: 0 } });
      const ref: TargetRef = { root: "response.body", path: [key("__proto__")] };
      const result = resolver.resolve(ref, ctx);
      // must NOT traverse prototype chain
      expect(result).toEqual({ found: false });
    });

    it("returns found:false for constructor key segment on plain object", () => {
      const body = { a: 1 };
      const ctx = makeCtx({ response: { status: 200, headers: {}, body, time_ms: 0 } });
      const ref: TargetRef = { root: "response.body", path: [key("constructor")] };
      expect(resolver.resolve(ref, ctx)).toEqual({ found: false });
    });

    it("returns found:true when __proto__ is an OWN data property", () => {
      // Object.create(null) + own __proto__ property
      const body = Object.create(null) as Record<string, unknown>;
      Object.defineProperty(body, "__proto__", {
        value: "my-data",
        enumerable: true,
        configurable: true,
        writable: true,
      });
      const ctx = makeCtx({ response: { status: 200, headers: {}, body, time_ms: 0 } });
      const ref: TargetRef = { root: "response.body", path: [key("__proto__")] };
      const result = resolver.resolve(ref, ctx);
      expect(result).toEqual({ found: true, value: "my-data" });
    });
  });

  // ---------------------------------------------------------------------------
  // Never-throws guarantee
  // ---------------------------------------------------------------------------

  describe("never throws", () => {
    it("does not throw for a garbage context body (primitive)", () => {
      const ctx = makeCtx({ response: { status: 200, headers: {}, body: 42, time_ms: 0 } });
      const ref: TargetRef = { root: "response.body", path: [key("x")] };
      expect(() => resolver.resolve(ref, ctx)).not.toThrow();
    });

    it("does not throw for empty db context", () => {
      const ref: TargetRef = { root: "db", connection: "c", queryId: "q", path: [] };
      expect(() => resolver.resolve(ref, makeCtx())).not.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // Determinism
  // ---------------------------------------------------------------------------

  describe("determinism", () => {
    it("returns the same result for identical inputs called twice", () => {
      const body = { x: { y: 42 } };
      const ctx = makeCtx({ response: { status: 200, headers: {}, body, time_ms: 0 } });
      const ref: TargetRef = { root: "response.body", path: [key("x"), key("y")] };
      expect(resolver.resolve(ref, ctx)).toEqual(resolver.resolve(ref, ctx));
    });
  });
});
