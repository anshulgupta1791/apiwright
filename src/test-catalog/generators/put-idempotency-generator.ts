/**
 * PUT idempotency generator — emits a `put_idempotency` case for PUT endpoints.
 *
 * Issues two identical PUTs and compares the results. The comparison strategy
 * is chosen automatically based on `endpoint.db_verify`:
 *   - `db_verify?.length > 0` → `compare: "db_state"` (re-runs db_verify after
 *     the second PUT and requires every step to pass).
 *   - absent OR `db_verify: []` → `compare: "body_equality"` (deep-equals the
 *     two response bodies; canonical JSON so key-order does not matter).
 *
 * Plan-time warnings are emitted (not thrown) for:
 *   - PUT + expected_status 204 + no db_verify (body_equality will be trivially
 *     satisfied; nudges user to add db_verify).
 *   - PUT + no request.body_example (runner will PUT an empty body; nudges user
 *     to declare a representative body).
 */

import type { CanonicalEndpoint } from "../../core/canonical-model.js";
import type { PutIdempotencyParams } from "../test-case-params.js";
import type {
  GenerationContext,
  GeneratorResult,
  TestCase,
  TestCaseGenerator,
} from "../types.js";

/** HTTP 204 No Content status code — signals a body-less response. */
const STATUS_NO_CONTENT = 204;

/**
 * Generates a `put_idempotency` regression test case for PUT endpoints.
 *
 * Compare-mode routing (locked design decision A/B):
 *   `endpoint.db_verify?.length > 0`  → `compare: "db_state"`.
 *   absent OR `db_verify: []`         → `compare: "body_equality"`.
 *
 * Plan warnings (locked design decisions Q1, Q5):
 *   - `compare: "body_equality"` + `expected_status === 204` →
 *     warns that body_equality will be trivially satisfied; advises db_verify.
 *   - `endpoint.request.body_example === undefined` →
 *     warns that the runner will PUT an empty body.
 *
 * Other methods → zero cases, zero warnings (silent guard).
 * Does NOT inherit from any other generator class; composition only.
 */
export class PutIdempotencyGenerator implements TestCaseGenerator {
  /**
   * Expands one endpoint into a `put_idempotency` case (0 or 1).
   *
   * Active iff `endpoint.method === "PUT"`. For all other methods returns
   * `{ cases: [], warnings: [] }` silently.
   *
   * Compare-mode selection (locked decisions A, B):
   *   `endpoint.db_verify?.length > 0`  → `compare: "db_state"`.
   *   absent OR `length === 0`          → `compare: "body_equality"`.
   *
   * Plan warnings (locked decisions Q1, Q5):
   *   - body_equality + `endpoint.response.expected_status === 204` →
   *     one warning per endpoint mentioning endpoint id and `db_verify`.
   *   - `endpoint.request.body_example === undefined` →
   *     one warning per endpoint mentioning endpoint id and `body_example`.
   * @param endpoint - The validated canonical endpoint.
   * @param ctx - Shared injected collaborators.
   * @returns 0 or 1 regression cases plus any plan warnings.
   */
  generate(
    endpoint: CanonicalEndpoint,
    ctx: GenerationContext,
  ): GeneratorResult {
    if (endpoint.method !== "PUT") {
      return { cases: [], warnings: [] };
    }

    const { ids, markers, prodSafety } = ctx;
    const warnings: string[] = [];

    // Routing rule: db_state iff db_verify has at least one entry.
    const compare: PutIdempotencyParams["compare"] =
      (endpoint.db_verify?.length ?? 0) > 0 ? "db_state" : "body_equality";

    // Q1 warning: 204 + body_equality (no db_verify) → trivially satisfied.
    if (
      compare === "body_equality" &&
      endpoint.response.expected_status === STATUS_NO_CONTENT
    ) {
      warnings.push(
        `Endpoint '${endpoint.id}': put_idempotency — response is 204 No Content; ` +
          `body_equality compare will be trivially satisfied. ` +
          `Add db_verify[] to assert resource state.`,
      );
    }

    // Q5 warning: missing body_example → runner will PUT an empty body.
    if (endpoint.request.body_example === undefined) {
      warnings.push(
        `Endpoint '${endpoint.id}': put_idempotency — no request.body_example declared; ` +
          `the runner will PUT an empty body which may not exercise true idempotency.`,
      );
    }

    const marker = markers.markerFor("put_idempotency");
    const prodSafe = prodSafety.classifyProdSafe({
      marker,
      method: endpoint.method,
    });

    const params: PutIdempotencyParams = { kind: "put_idempotency", compare };
    const tc: TestCase = {
      id: ids.make(endpoint.id, "put_idempotency", 0),
      endpoint_id: endpoint.id,
      type: "put_idempotency",
      marker,
      title: `PUT idempotency for ${endpoint.name}`,
      prod_safe: prodSafe,
      params,
    };

    return { cases: [tc], warnings };
  }
}
