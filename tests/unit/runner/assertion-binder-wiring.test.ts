import { describe, it, expect } from "vitest";

import { AssertionParser } from "../../../src/assertions/index.js";
import type { CanonicalEndpoint } from "../../../src/core/canonical-model.js";
import { parseAllAssertions } from "../../../src/runner/discovery/assertion-binder-wiring.js";
import { isRunnerError } from "../../../src/runner/index.js";
import type { EndpointLoadRecord } from "../../../src/runner/types.js";

/**
 * Builds a CanonicalEndpoint stub with optional assertions.
 * @param id - Endpoint id.
 * @param assertions - Optional assertion strings.
 * @returns A CanonicalEndpoint.
 */
function makeEndpoint(id: string, assertions?: string[]): CanonicalEndpoint {
  return {
    id,
    name: id,
    method: "GET",
    url: "/x",
    request: {},
    response: { expected_status: 200, schema: {} },
    ...(assertions ? { assertions } : {}),
  };
}

describe("parseAllAssertions", () => {
  const parser = new AssertionParser();

  it("does nothing when no endpoint has assertions", () => {
    const endpoints = new Map<string, EndpointLoadRecord>([
      ["a", { path: "x.endpoint.json", endpoint: makeEndpoint("a") }],
    ]);
    expect(() => parseAllAssertions(endpoints, parser)).not.toThrow();
  });

  it("passes for a single valid assertion string", () => {
    const endpoints = new Map<string, EndpointLoadRecord>([
      ["a", { path: "x.endpoint.json", endpoint: makeEndpoint("a", ["response.status equals 200"]) }],
    ]);
    expect(() => parseAllAssertions(endpoints, parser)).not.toThrow();
  });

  it("throws RunnerError aggregating ALL invalid assertions across endpoints", () => {
    const endpoints = new Map<string, EndpointLoadRecord>([
      ["a", { path: "x.endpoint.json", endpoint: makeEndpoint("a", ["completely invalid syntax"]) }],
      ["b", { path: "y.endpoint.json", endpoint: makeEndpoint("b", ["another bad one"]) }],
    ]);
    try {
      parseAllAssertions(endpoints, parser);
      expect.fail("should have thrown");
    } catch (e: unknown) {
      expect(isRunnerError(e)).toBe(true);
      if (isRunnerError(e)) {
        expect(e.code).toBe("RUNNER_ASSERTION_PARSE_FAILED");
        expect(e.message).toContain("a");
        expect(e.message).toContain("b");
      }
    }
  });

  it("default parser is constructed when none provided", () => {
    const endpoints = new Map<string, EndpointLoadRecord>([
      ["a", { path: "x.endpoint.json", endpoint: makeEndpoint("a") }],
    ]);
    expect(() => parseAllAssertions(endpoints)).not.toThrow();
  });
});
