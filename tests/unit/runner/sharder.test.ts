import { describe, it, expect } from "vitest";

import { isRunnerError } from "../../../src/runner/index.js";
import { shardCases, type ShardSpec } from "../../../src/runner/filter/sharder.js";
import type { PlannedTestCase } from "../../../src/runner/types.js";
import type { TestCase } from "../../../src/test-catalog/index.js";

/**
 * Builds a minimal PlannedTestCase for sharder tests.
 * @param id - Endpoint id.
 * @returns A PlannedTestCase.
 */
function makeCase(id: string): PlannedTestCase {
  return {
    endpoint_id: id,
    case: {
      id: `${id}.case`,
      endpoint_id: id,
      type: "status_code_conformance",
      marker: "smoke",
      title: id,
      prod_safe: true,
      params: { kind: "status_code_conformance", expected_status: 200 },
    },
  };
}

describe("shardCases", () => {
  const cases = [makeCase("e"), makeCase("a"), makeCase("c"), makeCase("b"), makeCase("d")];

  it("null shard returns all cases sorted by endpoint_id", () => {
    const result = shardCases(cases, null);
    expect(result.map((c) => c.endpoint_id)).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("partitions [a,b,c,d,e] into 3 shards covering all without overlap", () => {
    const s1 = shardCases(cases, { index: 1, total: 3 });
    const s2 = shardCases(cases, { index: 2, total: 3 });
    const s3 = shardCases(cases, { index: 3, total: 3 });
    const union = [...s1, ...s2, ...s3].map((c) => c.endpoint_id);
    expect(union.sort()).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("rejects non-integer indices", () => {
    expect(() => shardCases(cases, { index: 1.5, total: 3 })).toThrow();
    try {
      shardCases(cases, { index: 1.5, total: 3 });
    } catch (e: unknown) {
      expect(isRunnerError(e)).toBe(true);
    }
  });

  it("rejects total < 1", () => {
    expect(() => shardCases(cases, { index: 1, total: 0 })).toThrow();
    try {
      shardCases(cases, { index: 1, total: 0 });
    } catch (e: unknown) {
      expect(isRunnerError(e)).toBe(true);
    }
  });

  it("rejects out-of-range index", () => {
    expect(() => shardCases(cases, { index: 4, total: 3 })).toThrow();
    expect(() => shardCases(cases, { index: 0, total: 3 })).toThrow();
  });

  it("preserves deterministic order across multiple invocations", () => {
    const r1 = shardCases(cases, { index: 2, total: 3 });
    const r2 = shardCases(cases, { index: 2, total: 3 });
    expect(r1.map((c) => c.endpoint_id)).toEqual(r2.map((c) => c.endpoint_id));
  });

  it("groups by endpoint_id then case.id deterministically", () => {
    const c1 = makeCase("z");
    const c2 = { ...makeCase("z"), case: { ...makeCase("z").case, id: "z.b" } };
    const c3 = { ...makeCase("z"), case: { ...makeCase("z").case, id: "z.a" } };
    const result = shardCases([c1, c2, c3], null);
    expect(result[0]?.case.id).toBe("z.a");
  });
});
