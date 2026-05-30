import { describe, it, expect } from "vitest";

import { applyFilters } from "../../../src/runner/filter/filter.js";
import type {
  EndpointLoadRecord,
  PlannedTestCase,
  RunFilters,
} from "../../../src/runner/types.js";
import type { CanonicalEndpoint } from "../../../src/core/canonical-model.js";
import type { TestCase } from "../../../src/test-catalog/index.js";

/**
 * Builds a minimal CanonicalEndpoint for filter tests.
 * @param id - Endpoint id.
 * @param overrides - Optional field overrides.
 * @returns A CanonicalEndpoint.
 */
function makeEndpoint(id: string, overrides: Partial<CanonicalEndpoint> = {}): CanonicalEndpoint {
  return {
    id,
    name: id,
    method: "GET",
    url: "/x",
    request: {},
    response: { expected_status: 200, schema: {} },
    ...overrides,
  };
}

/**
 * Builds a minimal PlannedTestCase for filter tests.
 * @param endpointId - Endpoint id.
 * @param marker - The marker classification.
 * @returns A PlannedTestCase.
 */
function makeCase(
  endpointId: string,
  marker: "smoke" | "regression" | "e2e" = "smoke",
  prodSafe = true,
): PlannedTestCase {
  return {
    endpoint_id: endpointId,
    case: {
      id: `${endpointId}.case`,
      endpoint_id: endpointId,
      type: "status_code_conformance",
      marker,
      title: endpointId,
      prod_safe: prodSafe,
      params: { kind: "status_code_conformance", expected_status: 200 },
    },
  };
}

describe("applyFilters", () => {
  const records = new Map<string, EndpointLoadRecord>([
    ["a", { path: "tests/u/a.endpoint.json", endpoint: makeEndpoint("a", { tags: ["billing"] }) }],
    ["b", { path: "tests/u/b.endpoint.json", endpoint: makeEndpoint("b", { tags: ["billing", "slow"] }) }],
    ["c", { path: "tests/p/c.endpoint.json", endpoint: makeEndpoint("c", { tags: ["critical"] }) }],
  ]);

  it("returns all cases when no filters set (defaults to markers=smoke)", () => {
    const cases = [makeCase("a"), makeCase("b"), makeCase("c")];
    const r = applyFilters(cases, records, {});
    expect(r.map((c) => c.endpoint_id).sort()).toEqual(["a", "b", "c"]);
  });

  it("filters by marker", () => {
    const cases = [makeCase("a", "smoke"), makeCase("b", "regression"), makeCase("c", "e2e")];
    const r = applyFilters(cases, records, { markers: ["smoke"] });
    expect(r.map((c) => c.endpoint_id)).toEqual(["a"]);
  });

  it("filters by path prefix", () => {
    const cases = [makeCase("a"), makeCase("b"), makeCase("c")];
    const r = applyFilters(cases, records, { markers: ["smoke"], path: "tests/u/" });
    expect(r.map((c) => c.endpoint_id).sort()).toEqual(["a", "b"]);
  });

  it("filters by tag", () => {
    const cases = [makeCase("a"), makeCase("b"), makeCase("c")];
    const r = applyFilters(cases, records, { markers: ["smoke"], tag: "billing" });
    expect(r.map((c) => c.endpoint_id).sort()).toEqual(["a", "b"]);
  });

  it("filters by single endpoint id", () => {
    const cases = [makeCase("a"), makeCase("b"), makeCase("c")];
    const r = applyFilters(cases, records, { markers: ["smoke"], endpoint: "b" });
    expect(r.map((c) => c.endpoint_id)).toEqual(["b"]);
  });

  it("excludes tags", () => {
    const cases = [makeCase("a"), makeCase("b"), makeCase("c")];
    const r = applyFilters(cases, records, { markers: ["smoke"], excludeTags: ["slow"] });
    expect(r.map((c) => c.endpoint_id).sort()).toEqual(["a", "c"]);
  });

  it("AND-combines all dimensions", () => {
    const cases = [makeCase("a"), makeCase("b"), makeCase("c")];
    const r = applyFilters(cases, records, {
      markers: ["smoke"],
      path: "tests/u/",
      tag: "billing",
      excludeTags: ["slow"],
    });
    expect(r.map((c) => c.endpoint_id)).toEqual(["a"]);
  });

  it("drops cases whose endpoint id is not in the record map", () => {
    const cases = [makeCase("a"), makeCase("ghost")];
    const r = applyFilters(cases, records, { markers: ["smoke"] });
    expect(r.map((c) => c.endpoint_id)).toEqual(["a"]);
  });

  it("expands markers=['all'] to smoke + regression (e2e is v1.5-reserved)", () => {
    const cases = [makeCase("a", "smoke"), makeCase("b", "regression"), makeCase("c", "e2e")];
    const r = applyFilters(cases, records, { markers: ["all"] });
    expect(r.map((c) => c.endpoint_id).sort()).toEqual(["a", "b"]);
  });
});

// ===========================================================================
// Audit blocker 🚨-1: prod-safety enforcement (§3 line 433).
// ===========================================================================

describe("applyFilters — prod-safety enforcement (audit blocker 🚨-1)", () => {
  const records = new Map<string, EndpointLoadRecord>([
    ["safe", { path: "tests/x.endpoint.json", endpoint: makeEndpoint("safe") }],
    ["unsafe", { path: "tests/y.endpoint.json", endpoint: makeEndpoint("unsafe") }],
  ]);

  it("non-prod env: prod_safe=false cases run", () => {
    const cases = [makeCase("safe", "smoke", true), makeCase("unsafe", "smoke", false)];
    const r = applyFilters(cases, records, { markers: ["smoke"] }, false);
    expect(r.map((c) => c.endpoint_id).sort()).toEqual(["safe", "unsafe"]);
  });

  it("prod env: prod_safe=false cases are DROPPED", () => {
    const cases = [makeCase("safe", "smoke", true), makeCase("unsafe", "smoke", false)];
    const r = applyFilters(cases, records, { markers: ["smoke"] }, true);
    expect(r.map((c) => c.endpoint_id)).toEqual(["safe"]);
  });

  it("prod env: prod_safe=true cases still run", () => {
    const cases = [makeCase("safe", "smoke", true)];
    const r = applyFilters(cases, records, { markers: ["smoke"] }, true);
    expect(r.map((c) => c.endpoint_id)).toEqual(["safe"]);
  });

  it("prod env: a fully-prod_safe-false catalog yields empty plan", () => {
    const cases = [
      makeCase("unsafe", "smoke", false),
      makeCase("safe", "smoke", false),
    ];
    const r = applyFilters(cases, records, { markers: ["smoke"] }, true);
    expect(r).toEqual([]);
  });

  it("prod env: regression cases are dropped because catalog marks them prod_safe=false", () => {
    // Mirrors what ProdSafetyClassifier produces for write-method regression.
    const cases = [makeCase("safe", "regression", false)];
    const r = applyFilters(cases, records, { markers: ["regression"] }, true);
    expect(r).toEqual([]);
  });

  it("default (4th arg omitted) preserves non-prod behaviour for backwards compat", () => {
    const cases = [makeCase("unsafe", "smoke", false)];
    const r = applyFilters(cases, records, { markers: ["smoke"] });
    expect(r.map((c) => c.endpoint_id)).toEqual(["unsafe"]);
  });

  it("prod env + path/tag/exclude filters still AND-combine correctly", () => {
    const recordsWithTags = new Map<string, EndpointLoadRecord>([
      ["safe", { path: "tests/x.endpoint.json", endpoint: makeEndpoint("safe", { tags: ["billing"] }) }],
      ["unsafe", { path: "tests/y.endpoint.json", endpoint: makeEndpoint("unsafe", { tags: ["billing"] }) }],
    ]);
    const cases = [
      makeCase("safe", "smoke", true),
      makeCase("unsafe", "smoke", false),
    ];
    const r = applyFilters(
      cases,
      recordsWithTags,
      { markers: ["smoke"], tag: "billing" },
      true,
    );
    // Both match the tag, but only the prod_safe=true case survives prod env.
    expect(r.map((c) => c.endpoint_id)).toEqual(["safe"]);
  });
});
