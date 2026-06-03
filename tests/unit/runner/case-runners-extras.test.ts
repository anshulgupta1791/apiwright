import { describe, it, expect } from "vitest";

import {
  buildBaseRequest,
  mutateRequest,
  putIdempotencyVerdict,
} from "../../../src/runner/execute/case-runners.js";
import type { CanonicalEndpoint } from "../../../src/core/canonical-model.js";
import type { ResolvedEnvironment } from "../../../src/env/types.js";
import type { TestCase } from "../../../src/test-catalog/index.js";
import type { ResponseRecord } from "../../../src/runner/types.js";

const ENV: ResolvedEnvironment = { name: "test", prod: false, base_url: "https://h.invalid" };

/**
 * Make a base endpoint with a nested body.
 * @param body - The body example.
 * @returns A CanonicalEndpoint.
 */
function ep(body: unknown): CanonicalEndpoint {
  return {
    id: "e",
    name: "e",
    method: "POST",
    url: "/x",
    request: { body_example: body },
    response: { expected_status: 200, schema: {} },
  };
}

function tc(params: TestCase["params"]): TestCase {
  return {
    id: "e.c", endpoint_id: "e", type: params.kind,
    marker: "smoke", title: "t", prod_safe: true, params,
  };
}

describe("mutateRequest body substitutions for every wrong-type variant", () => {
  const baseObj = buildBaseRequest(ep({ field: "original" }), ENV);

  it("substitutes string for type_violation", () => {
    const r = mutateRequest(baseObj, tc({ kind: "type_violation_returns_400", field: "field", original_type: "number", wrong_type: "string", expected_status: 400 }));
    expect(typeof (r.body as { field: unknown }).field).toBe("string");
  });

  it("substitutes number for type_violation", () => {
    const r = mutateRequest(baseObj, tc({ kind: "type_violation_returns_400", field: "field", original_type: "string", wrong_type: "number", expected_status: 400 }));
    expect(typeof (r.body as { field: unknown }).field).toBe("number");
  });

  it("substitutes boolean for type_violation", () => {
    const r = mutateRequest(baseObj, tc({ kind: "type_violation_returns_400", field: "field", original_type: "string", wrong_type: "boolean", expected_status: 400 }));
    expect(typeof (r.body as { field: unknown }).field).toBe("boolean");
  });

  it("substitutes object for type_violation", () => {
    const r = mutateRequest(baseObj, tc({ kind: "type_violation_returns_400", field: "field", original_type: "string", wrong_type: "object", expected_status: 400 }));
    expect((r.body as { field: unknown }).field).toEqual({});
  });

  it("substitutes array for type_violation", () => {
    const r = mutateRequest(baseObj, tc({ kind: "type_violation_returns_400", field: "field", original_type: "string", wrong_type: "array", expected_status: 400 }));
    expect(Array.isArray((r.body as { field: unknown }).field)).toBe(true);
  });

  it("substitutes null for type_violation", () => {
    const r = mutateRequest(baseObj, tc({ kind: "type_violation_returns_400", field: "field", original_type: "string", wrong_type: "null", expected_status: 400 }));
    expect((r.body as { field: unknown }).field).toBeNull();
  });
});

describe("mutateRequest deep-path body manipulations", () => {
  const baseObj = buildBaseRequest(ep({ outer: { inner: "x" } }), ENV);

  it("substitutes value at nested path", () => {
    const r = mutateRequest(baseObj, tc({ kind: "boundary_battery", field: "outer.inner", constraint: "minLength", position: "outside", value: "y", expected_status: 400 }));
    expect((r.body as { outer: { inner: unknown } }).outer.inner).toBe("y");
  });

  it("omits value at nested path", () => {
    const r = mutateRequest(baseObj, tc({ kind: "required_field_omission_returns_400", omitted_field: "outer.inner", expected_status: 400 }));
    expect((r.body as { outer: { inner?: unknown } }).outer.inner).toBeUndefined();
  });

  it("returns base when path is empty", () => {
    const r = mutateRequest(baseObj, tc({ kind: "required_field_omission_returns_400", omitted_field: "", expected_status: 400 }));
    expect(r).toEqual(baseObj);
  });

  it("returns base when body is null", () => {
    const baseNull = buildBaseRequest(ep(null), ENV);
    const r = mutateRequest(baseNull, tc({ kind: "required_field_omission_returns_400", omitted_field: "x", expected_status: 400 }));
    expect(r).toEqual(baseNull);
  });

  it("returns base when nested path traverses a non-object", () => {
    const baseScalar = buildBaseRequest(ep({ x: "scalar" }), ENV);
    const r = mutateRequest(baseScalar, tc({ kind: "required_field_omission_returns_400", omitted_field: "x.deep", expected_status: 400 }));
    expect(r).toEqual(baseScalar);
  });
});

// ---------------------------------------------------------------------------
// putIdempotencyVerdict — all branches
// ---------------------------------------------------------------------------

/**
 * Build a minimal ResponseRecord for testing verdict functions.
 * @param status - HTTP status code.
 * @param body - Response body.
 * @returns A ResponseRecord.
 */
function putRes(status: number, body: unknown): ResponseRecord {
  return { status, headers: { "content-type": "application/json" }, body, time_ms: 1 };
}

describe("putIdempotencyVerdict", () => {
  describe("body_equality mode", () => {
    it("passes when both responses are 2xx AND bodies deep-equal", () => {
      const v = putIdempotencyVerdict(
        putRes(200, { id: 1, name: "Alice" }),
        putRes(200, { id: 1, name: "Alice" }),
        "body_equality",
        true,
      );
      expect(v.verdict).toBe("pass");
    });

    it("passes when body equality holds regardless of object key order", () => {
      const v = putIdempotencyVerdict(
        putRes(200, { a: 1, b: 2 }),
        putRes(200, { b: 2, a: 1 }),
        "body_equality",
        true,
      );
      expect(v.verdict).toBe("pass");
    });

    it("passes for two 204 empty bodies (trivially equal, Q1 runtime lock)", () => {
      const v = putIdempotencyVerdict(
        putRes(204, null),
        putRes(204, null),
        "body_equality",
        true,
      );
      expect(v.verdict).toBe("pass");
    });

    it("fails when second response is non-2xx", () => {
      const v = putIdempotencyVerdict(
        putRes(200, { id: 1 }),
        putRes(500, { error: "oops" }),
        "body_equality",
        true,
      );
      expect(v.verdict).toBe("fail");
      expect(v.reason).toContain("second response status 500");
      expect(v.reason).toContain("first was 200");
    });

    it("fails when bodies differ", () => {
      const v = putIdempotencyVerdict(
        putRes(200, { id: 1, name: "Alice" }),
        putRes(200, { id: 1, name: "Bob" }),
        "body_equality",
        true,
      );
      expect(v.verdict).toBe("fail");
      expect(v.reason).toContain("body diverged");
    });
  });

  describe("db_state mode", () => {
    it("passes when second response is 2xx AND dbVerifyOkSecond is true", () => {
      const v = putIdempotencyVerdict(
        putRes(200, { id: 1 }),
        putRes(200, { id: 1, lastModified: "2026-01-02" }),
        "db_state",
        true,
      );
      expect(v.verdict).toBe("pass");
    });

    it("passes even when bodies differ (timestamp scenario) — db_state is the oracle", () => {
      const v = putIdempotencyVerdict(
        putRes(200, { id: 1, lastModified: "2026-01-01" }),
        putRes(200, { id: 1, lastModified: "2026-01-02" }),
        "db_state",
        true,
      );
      expect(v.verdict).toBe("pass");
    });

    it("fails when second response is non-2xx (status gate fires before db gate)", () => {
      const v = putIdempotencyVerdict(
        putRes(200, { id: 1 }),
        putRes(500, { error: "oops" }),
        "db_state",
        true,
      );
      expect(v.verdict).toBe("fail");
      expect(v.reason).toContain("second response status 500");
    });

    it("fails when dbVerifyOkSecond is false", () => {
      const v = putIdempotencyVerdict(
        putRes(200, { id: 1 }),
        putRes(200, { id: 1 }),
        "db_state",
        false,
      );
      expect(v.verdict).toBe("fail");
      expect(v.reason).toContain("db state diverged");
    });
  });
});
