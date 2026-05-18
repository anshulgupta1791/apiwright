/**
 * Auth-negative generator — emits the 3 auth-boundary regression test cases.
 *
 * Active only when the endpoint declares an auth_strategy. For unauthenticated
 * endpoints, emits zero cases. Cases cover: stripped auth (401), garbage token
 * (401), and wrong HTTP method (405).
 */

import type { CanonicalEndpoint, HttpMethod } from "../../core/canonical-model.js";
import type {
  GenerationContext,
  GeneratorResult,
  TestCase,
  TestCaseGenerator,
} from "../types.js";

/** Deterministic token literal sent as a garbage auth credential. */
const GARBAGE_TOKEN_LITERAL = "not-a-valid-token";

/** HTTP 401 Unauthorized — expected status for auth-negative cases. */
const HTTP_UNAUTHORIZED = 401;

/** HTTP 405 Method Not Allowed — expected status for method_not_allowed case. */
const HTTP_METHOD_NOT_ALLOWED = 405;

/**
 * Precedence order for substitute method selection. The first element in this
 * list that differs from the endpoint's declared method is chosen.
 */
const SUBSTITUTE_METHOD_PRECEDENCE: readonly HttpMethod[] = [
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "GET",
  "OPTIONS",
  "HEAD",
];

/**
 * Generates the 3 auth-negative regression test cases for authenticated endpoints.
 *
 * For unauthenticated endpoints (no auth_strategy), returns zero cases.
 * For authenticated endpoints, emits: no_auth_returns_401, garbage_token_returns_401,
 * and method_not_allowed with a deterministically chosen substitute method.
 */
export class AuthNegativeGenerator implements TestCaseGenerator {
  /**
   * Expands one endpoint into auth-negative cases (0 or 3).
   * @param endpoint - The validated canonical endpoint.
   * @param ctx - Shared injected collaborators.
   * @returns 0 or 3 regression cases plus an empty warnings array.
   */
  generate(endpoint: CanonicalEndpoint, ctx: GenerationContext): GeneratorResult {
    if (endpoint.auth_strategy === undefined) {
      return { cases: [], warnings: [] };
    }

    const { ids, markers, prodSafety } = ctx;
    const authStrategy = endpoint.auth_strategy;
    const marker = markers.markerFor("no_auth_returns_401");
    const prodSafe = prodSafety.classifyProdSafe({ marker, method: endpoint.method });
    const substituteMethod = this.#pickSubstituteMethod(endpoint.method);

    const cases: TestCase[] = [
      {
        id: ids.make(endpoint.id, "no_auth_returns_401", 0),
        endpoint_id: endpoint.id,
        type: "no_auth_returns_401",
        marker,
        title: `No auth returns 401 for ${endpoint.name}`,
        prod_safe: prodSafe,
        params: {
          kind: "no_auth_returns_401",
          auth_strategy: authStrategy,
          expected_status: HTTP_UNAUTHORIZED,
        },
      },
      {
        id: ids.make(endpoint.id, "garbage_token_returns_401", 0),
        endpoint_id: endpoint.id,
        type: "garbage_token_returns_401",
        marker,
        title: `Garbage token returns 401 for ${endpoint.name}`,
        prod_safe: prodSafe,
        params: {
          kind: "garbage_token_returns_401",
          auth_strategy: authStrategy,
          garbage_token: GARBAGE_TOKEN_LITERAL,
          expected_status: HTTP_UNAUTHORIZED,
        },
      },
      {
        id: ids.make(endpoint.id, "method_not_allowed", 0),
        endpoint_id: endpoint.id,
        type: "method_not_allowed",
        marker,
        title: `Method not allowed for ${endpoint.name}`,
        prod_safe: prodSafe,
        params: {
          kind: "method_not_allowed",
          substitute_method: substituteMethod,
          expected_status: HTTP_METHOD_NOT_ALLOWED,
        },
      },
    ];

    return { cases, warnings: [] };
  }

  /**
   * Picks a substitute method different from the declared method using a fixed
   * precedence list. Deterministic: same input always yields the same output.
   * @param declaredMethod - The endpoint's declared HTTP method.
   * @returns First method from precedence list not equal to declaredMethod.
   */
  #pickSubstituteMethod(declaredMethod: HttpMethod): HttpMethod {
    for (const method of SUBSTITUTE_METHOD_PRECEDENCE) {
      if (method !== declaredMethod) {
        return method;
      }
    }
    /* istanbul ignore next — SUBSTITUTE_METHOD_PRECEDENCE has 7 unique entries;
       at least one will differ from any single declared method */
    return "GET";
  }
}
