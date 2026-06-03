/**
 * Pagination Boundary generator — emits 2-4 single-request `pagination_boundary`
 * probe cases for GET endpoints that declare a `pagination` config.
 *
 * Each probe mutates ONE query parameter on the endpoint URL and asserts the
 * HTTP status matches the expected value for that probe:
 *   - size_zero         → `?<size_param>=0`         → expect 400
 *   - size_max          → `?<size_param>=<max_size>` → expect endpoint.response.expected_status
 *   - size_max_plus_one → `?<size_param>=<max_size+1>` → expect 400
 *   - page_negative     → `?<page_param>=-1`         → expect 400 (page-style only)
 *
 * Activation: `endpoint.method === "GET"` AND `endpoint.pagination !== undefined`.
 * Non-GET endpoints with `pagination` declared are silently ignored (DD-5).
 *
 * Probe set by style (DD-4):
 *   page:   size_zero, size_max, size_max_plus_one, page_negative  → 4 probes
 *   offset: size_zero, size_max, size_max_plus_one                  → 3 probes
 *   cursor: size_zero, size_max                                     → 2 probes
 *
 * Plan-time warnings (DD-7):
 *   (1) style=page + page_param missing/empty → page_negative dropped; 1 warning.
 *   (2) max_size < default_size → ALL probes dropped; 1 warning.
 */

import type { CanonicalEndpoint, PaginationConfig } from "../../core/canonical-model.js";
import type { PaginationBoundaryParams, PaginationProbe } from "../test-case-params.js";
import type {
  GenerationContext,
  GeneratorResult,
  TestCase,
  TestCaseGenerator,
} from "../types.js";

/** Expected status for probes that assert bad-input rejection. */
const BAD_INPUT_STATUS = 400;

/**
 * Generates `pagination_boundary` regression test cases for GET endpoints
 * that declare a `pagination` configuration block.
 *
 * Pure and total: never throws, never performs I/O. One instance per
 * TestPlanGenerator run (stateless between calls).
 */
export class PaginationBoundaryGenerator implements TestCaseGenerator {
  /**
   * Expands one endpoint into 0-4 `pagination_boundary` probe cases.
   *
   * Active iff `endpoint.method === "GET"` AND `endpoint.pagination` is defined.
   * For all other inputs returns `{ cases: [], warnings: [] }` silently (DD-5).
   *
   * Emits plan-time warnings for two conditions (DD-7):
   *   1. style=page + page_param missing → page_negative omitted.
   *   2. max_size < default_size → all probes omitted.
   * @param endpoint - The validated canonical endpoint.
   * @param ctx - Shared injected collaborators.
   * @returns Cases plus any warnings for this endpoint.
   */
  generate(
    endpoint: CanonicalEndpoint,
    ctx: GenerationContext,
  ): GeneratorResult {
    if (endpoint.method !== "GET") {
      return { cases: [], warnings: [] };
    }

    if (endpoint.pagination === undefined) {
      return { cases: [], warnings: [] };
    }

    const pg = endpoint.pagination;

    // DD-7 condition 2: max_size < default_size → all probes omitted + 1 warning.
    if (pg.max_size < pg.default_size) {
      return {
        cases: [],
        warnings: [
          `Endpoint '${endpoint.id}': pagination_boundary — max_size (${pg.max_size})` +
          ` is less than default_size (${pg.default_size}); all probes omitted.`,
        ],
      };
    }

    const { probes, warnings } = this.#buildProbeList(endpoint.id, pg);
    const cases = probes.map((probe, ordinal) =>
      this.#buildCase(endpoint, pg, probe, ordinal, ctx),
    );

    return { cases, warnings };
  }

  /**
   * Builds the probe list for the given pagination style, applying the
   * page_param missing check (DD-7 condition 1).
   * @param endpointId - The endpoint id for warning messages.
   * @param pg - The pagination config.
   * @returns The ordered probe list and any warnings.
   */
  #buildProbeList(
    endpointId: string,
    pg: PaginationConfig,
  ): { probes: PaginationProbe[]; warnings: string[] } {
    const warnings: string[] = [];
    let probes: PaginationProbe[];

    switch (pg.style) {
      case "cursor":
        probes = ["size_zero", "size_max"];
        break;
      case "offset":
        probes = ["size_zero", "size_max", "size_max_plus_one"];
        break;
      case "page": {
        probes = ["size_zero", "size_max", "size_max_plus_one"];
        // DD-7 condition 1: missing or empty page_param → drop page_negative.
        const hasPageParam = typeof pg.page_param === "string" && pg.page_param.length > 0;
        if (hasPageParam) {
          probes = [...probes, "page_negative"];
        } else {
          warnings.push(
            `Endpoint '${endpointId}': pagination_boundary — style 'page' declared` +
            ` without page_param; page_negative probe omitted.`,
          );
        }
        break;
      }
    }

    return { probes, warnings };
  }

  /**
   * Builds a single TestCase for one probe.
   * @param endpoint - The owning endpoint.
   * @param pg - The pagination config.
   * @param probe - The probe discriminator.
   * @param ordinal - Zero-based position within the probe list (for stable id).
   * @param ctx - Shared generation context.
   * @returns The constructed TestCase.
   */
  #buildCase(
    endpoint: CanonicalEndpoint,
    pg: PaginationConfig,
    probe: PaginationProbe,
    ordinal: number,
    ctx: GenerationContext,
  ): TestCase {
    const { ids, markers, prodSafety } = ctx;
    const marker = markers.markerFor("pagination_boundary");
    const prodSafe = prodSafety.classifyProdSafe({
      marker,
      method: endpoint.method,
    });

    const expectedStatus =
      probe === "size_max" ? endpoint.response.expected_status : BAD_INPUT_STATUS;

    const params: PaginationBoundaryParams = {
      kind: "pagination_boundary",
      style: pg.style,
      size_param: pg.size_param,
      ...(pg.page_param !== undefined ? { page_param: pg.page_param } : {}),
      default_size: pg.default_size,
      max_size: pg.max_size,
      probe,
      expected_status: expectedStatus,
    };

    return {
      id: ids.make(endpoint.id, "pagination_boundary", ordinal),
      endpoint_id: endpoint.id,
      type: "pagination_boundary",
      marker,
      title: `Pagination boundary (${probe}) for ${endpoint.name}`,
      prod_safe: prodSafe,
      params,
    };
  }
}
