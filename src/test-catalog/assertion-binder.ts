/**
 * Assertion binder — binds declarative assertion strings as TestCase entries.
 *
 * Per §4 / Architecture Overview: does NOT parse, interpret, evaluate, or
 * syntactically reject assertion strings (deferred to the Declarative Assertions
 * Engine task). Carries each string verbatim in a TestCase with type="assertion".
 *
 * Representation: bound assertions are TestCase entries with type="assertion"
 * and params.kind="assertion". This keeps a single homogeneous cases[] collection
 * so the runner iterates one list and the marker filter applies uniformly.
 * Assertions are regression-marked per §4.
 */

import type { CanonicalEndpoint } from "../core/canonical-model.js";

import type {
  GenerationContext,
  GeneratorResult,
  TestCase,
  TestCaseGenerator,
} from "./types.js";

/** Max length for a title derived from the assertion string. */
const MAX_TITLE_LEN = 80;

/**
 * Binds declarative assertion strings as TestCase entries (type="assertion").
 *
 * Each string is carried byte-for-byte in params.assertion. No parsing or
 * interpretation is performed. Absent or empty assertions → zero entries.
 */
export class AssertionBinder implements TestCaseGenerator {
  /**
   * Expands one endpoint's assertion strings into TestCase entries (0 or more).
   * @param endpoint - The validated canonical endpoint.
   * @param ctx - Shared injected collaborators.
   * @returns Assertion-bound TestCase entries plus an empty warnings array.
   */
  generate(endpoint: CanonicalEndpoint, ctx: GenerationContext): GeneratorResult {
    const assertions = endpoint.assertions;
    if (!assertions || assertions.length === 0) {
      return { cases: [], warnings: [] };
    }

    const { ids, markers, prodSafety } = ctx;
    const marker = markers.markerFor("assertion");
    const prodSafe = prodSafety.classifyProdSafe({ marker, method: endpoint.method });

    const cases: TestCase[] = assertions.map((assertionStr, i) => {
      const truncated = assertionStr.length > MAX_TITLE_LEN
        ? `${assertionStr.slice(0, MAX_TITLE_LEN)}…`
        : assertionStr;
      return {
        id: ids.make(endpoint.id, "assertion", i),
        endpoint_id: endpoint.id,
        type: "assertion" as const,
        marker,
        title: `Assertion: ${truncated}`,
        prod_safe: prodSafe,
        params: { kind: "assertion" as const, assertion: assertionStr },
      };
    });

    return { cases, warnings: [] };
  }
}
