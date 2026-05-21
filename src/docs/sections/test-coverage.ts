/**
 * Section renderer: Test coverage — auto-generated tests + assertion list.
 *
 * Per V1_BUILD_SPEC.md §11: "Test coverage: which auto-generated tests
 * run for this endpoint, plus the assertion list". The renderer derives
 * which §3 catalog test types apply from the endpoint's declared shape
 * (auth/body/db_verify) following the same rules the §3 catalog generators
 * use. Without actually running the catalog we surface the EXPECTED set
 * — this matches "declared sources only" (spec line 707).
 */

import type { CanonicalEndpoint, HttpMethod } from "../../core/canonical-model.js";
import type { RenderContext } from "../types.js";

/** HTTP methods that do NOT carry a body. */
const NO_BODY_METHODS = new Set<HttpMethod>(["GET", "HEAD", "OPTIONS", "DELETE"]);

/**
 * Renders the test-coverage section.
 * @param ctx - The render context.
 * @returns Markdown test-coverage section.
 */
export function renderTestCoverage(ctx: RenderContext): string {
  const ep = ctx.endpoint;
  const tests = expectedGeneratedTests(ep);
  const lines = ["## Test coverage", "", "### Auto-generated tests (from §3 catalog)", ""];
  if (tests.length === 0) {
    lines.push("_(none — endpoint shape produces no auto-generated tests)_");
  } else {
    for (const t of tests) lines.push(`- \`${t}\``);
  }
  lines.push("");
  lines.push("### Declarative assertions", "");
  const assertions = ep.assertions ?? [];
  if (assertions.length === 0) {
    lines.push("_(none declared)_");
  } else {
    for (const a of assertions) lines.push(`- \`${a}\``);
  }
  return lines.join("\n");
}

/**
 * Returns the §3 generated test types the catalog would emit for this
 * endpoint, based on the endpoint's declared shape (not on a live
 * catalog run). Sorted alphabetically for deterministic output.
 * @param ep - The canonical endpoint.
 * @returns Sorted array of generated-test type names.
 */
function expectedGeneratedTests(ep: CanonicalEndpoint): readonly string[] {
  const tests = new Set<string>();
  // Universal (run for every endpoint).
  tests.add("status_code_conformance");
  tests.add("content_type_alignment");
  tests.add("response_time_sla");
  tests.add("response_schema_validation");
  tests.add("auth_happy_path");
  // Method-specific.
  if (ep.method === "GET") tests.add("get_idempotency");
  if (ep.method === "DELETE") tests.add("delete_idempotency");
  // Auth-negative (only for authenticated endpoints).
  if (ep.auth_strategy) {
    tests.add("no_auth_returns_401");
    tests.add("garbage_token_returns_401");
    tests.add("method_not_allowed");
  }
  // Body-negative (only when body is allowed AND schema declared).
  const hasBody = !NO_BODY_METHODS.has(ep.method) && ep.request.body_schema !== undefined;
  if (hasBody) {
    tests.add("malformed_json_returns_400");
    tests.add("required_field_omission_returns_400");
    tests.add("type_violation_returns_400");
    tests.add("boundary_battery");
  }
  // DB-state (only when db_verify declared).
  if ((ep.db_verify?.length ?? 0) > 0) tests.add("db_state_matches_expectation");
  return [...tests].sort();
}
