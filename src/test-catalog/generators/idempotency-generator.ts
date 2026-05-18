/**
 * Idempotency generator — emits get_idempotency or delete_idempotency cases.
 *
 * GET endpoints get one get_idempotency case (compare body equality across two
 * identical requests). DELETE endpoints get one delete_idempotency case with a
 * derived second-delete expected status.
 *
 * Decomposition assumption #2: when a DELETE endpoint's expected_status is
 * neither 204 nor 404, the second-DELETE expectation defaults to 404. This is
 * documented here per the acceptance criterion.
 */

import type { CanonicalEndpoint } from "../../core/canonical-model.js";
import type {
  DeleteIdempotencyParams,
  GenerationContext,
  GeneratorResult,
  TestCase,
  TestCaseGenerator,
} from "../types.js";

/** HTTP 204 No Content status — valid second-DELETE expected status. */
const STATUS_NO_CONTENT = 204;

/** HTTP 404 Not Found status — valid second-DELETE expected status and default. */
const STATUS_NOT_FOUND = 404;

/** Status codes that are acceptable DELETE idempotency expectations. */
const VALID_SECOND_DELETE_STATUSES = new Set<number>([STATUS_NO_CONTENT, STATUS_NOT_FOUND]);

/** Default second-DELETE expected status when declaration is neither 204 nor 404. */
const DEFAULT_SECOND_DELETE_STATUS = STATUS_NOT_FOUND;

/**
 * Generates idempotency regression test cases for GET and DELETE endpoints.
 *
 * GET → 1 get_idempotency case (runner issues two GETs, compares body equality).
 * DELETE → 1 delete_idempotency case (second_delete_status = 204 or 404 per
 *   declaration; non-204/404 expected_status → default 404).
 * Other methods → 0 cases.
 */
export class IdempotencyGenerator implements TestCaseGenerator {
  /**
   * Expands one endpoint into idempotency cases (0 or 1).
   *
   * DELETE second_delete_status assumption: the expected_status from the
   * endpoint declaration is used iff it is exactly 204 or 404; any other
   * status (e.g. 200, 201, 500) defaults to 404. This follows decomposition
   * assumption #2 in the design document.
   * @param endpoint - The validated canonical endpoint.
   * @param ctx - Shared injected collaborators.
   * @returns 0 or 1 regression cases plus an empty warnings array.
   */
  generate(endpoint: CanonicalEndpoint, ctx: GenerationContext): GeneratorResult {
    const { ids, markers, prodSafety } = ctx;

    if (endpoint.method === "GET") {
      const marker = markers.markerFor("get_idempotency");
      const prodSafe = prodSafety.classifyProdSafe({ marker, method: endpoint.method });
      const tc: TestCase = {
        id: ids.make(endpoint.id, "get_idempotency", 0),
        endpoint_id: endpoint.id,
        type: "get_idempotency",
        marker,
        title: `GET idempotency for ${endpoint.name}`,
        prod_safe: prodSafe,
        params: { kind: "get_idempotency", compare: "body_equality" },
      };
      return { cases: [tc], warnings: [] };
    }

    if (endpoint.method === "DELETE") {
      const marker = markers.markerFor("delete_idempotency");
      const prodSafe = prodSafety.classifyProdSafe({ marker, method: endpoint.method });
      const rawStatus = endpoint.response.expected_status;
      const secondDeleteStatus = VALID_SECOND_DELETE_STATUSES.has(rawStatus)
        ? rawStatus
        : DEFAULT_SECOND_DELETE_STATUS;

      const params: DeleteIdempotencyParams = {
        kind: "delete_idempotency",
        second_delete_status: secondDeleteStatus,
      };
      const tc: TestCase = {
        id: ids.make(endpoint.id, "delete_idempotency", 0),
        endpoint_id: endpoint.id,
        type: "delete_idempotency",
        marker,
        title: `DELETE idempotency for ${endpoint.name}`,
        prod_safe: prodSafe,
        params,
      };
      return { cases: [tc], warnings: [] };
    }

    return { cases: [], warnings: [] };
  }
}
