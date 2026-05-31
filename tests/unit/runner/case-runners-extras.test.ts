import { describe, it, expect } from "vitest";

import { buildBaseRequest, mutateRequest } from "../../../src/runner/execute/case-runners.js";
import type { CanonicalEndpoint } from "../../../src/core/canonical-model.js";
import type { ResolvedEnvironment } from "../../../src/env/types.js";
import type { TestCase } from "../../../src/test-catalog/index.js";

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
