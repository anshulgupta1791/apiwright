/**
 * Discharges Task #10 obligation #1: invokes the §4 AssertionParser over
 * every endpoint's `assertions[]` array at plan-generation time so invalid
 * syntax fails at startup, not at runtime.
 *
 * The Task #6 AssertionBinder carries strings verbatim into TestCase
 * payloads; this layer parses them ahead of the runner so a malformed
 * assertion aborts the whole run before any HTTP request is sent.
 *
 * Aggregates ALL parse failures across every endpoint × every assertion
 * before throwing one RunnerError — the user gets the full picture in
 * one shot.
 */

import { AssertionParser } from "../../assertions/index.js";
import type { CanonicalEndpoint } from "../../core/canonical-model.js";
import { RUNNER_ERROR_CODES, RunnerError } from "../errors.js";
import type { EndpointLoadRecord } from "../types.js";

/**
 * Pre-parses every assertion string on every endpoint. Throws on the first
 * round when ANY assertion fails to parse — but aggregates ALL failures
 * into the error message before throwing.
 * @param endpoints - The loaded endpoints (post schema-validation).
 * @param parser - Optional injectable parser; defaults to the real one.
 * @throws {RunnerError} code `RUNNER_ASSERTION_PARSE_FAILED` when any
 *   assertion fails to parse; message aggregates every failure.
 */
export function parseAllAssertions(
  endpoints: ReadonlyMap<string, EndpointLoadRecord>,
  parser: AssertionParser = new AssertionParser(),
): void {
  const errors: string[] = [];
  for (const { endpoint } of endpoints.values()) {
    parseEndpointAssertions(endpoint, parser, errors);
  }
  if (errors.length > 0) {
    throw new RunnerError({
      code: RUNNER_ERROR_CODES.RUNNER_ASSERTION_PARSE_FAILED,
      phase: "plan-gen",
      message:
        `Assertion syntax errors (${errors.length}):\n${errors.join("\n")}`,
    });
  }
}

/**
 * Parses every assertion on one endpoint and accumulates failures into
 * `errors`. Pure — never throws directly.
 * @param endpoint - The validated CanonicalEndpoint.
 * @param parser - The shared AssertionParser instance.
 * @param errors - Mutable accumulator for parse failures.
 */
function parseEndpointAssertions(
  endpoint: CanonicalEndpoint,
  parser: AssertionParser,
  errors: string[],
): void {
  const list = endpoint.assertions;
  if (!list || list.length === 0) return;
  for (let i = 0; i < list.length; i++) {
    const raw = list[i];
    /* istanbul ignore next — iteration index is always in-bounds; defensive guard
       for noUncheckedIndexedAccess. */
    if (raw === undefined) continue;
    const result = parser.parse(raw);
    if (!result.ok) {
      for (const e of result.errors) {
        errors.push(`  - '${endpoint.id}' assertion #${i + 1}: ${e}`);
      }
    }
  }
}
