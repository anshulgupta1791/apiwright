/**
 * JUnit XML renderer — produces the standard JUnit XML report consumed by
 * Jenkins / GitHub Actions / GitLab CI / Azure DevOps test integrations.
 *
 * §10 lines 693-697:
 *  - Each endpoint = one <testsuite>.
 *  - Each auto-generated test + declarative assertion = one <testcase>.
 *  - Flaky (passed after retry) = `passed` with a <system-out> note
 *    indicating retry count; CI does not break.
 *
 * The renderer escapes every dynamic value to safe XML (no untrusted
 * substring is ever embedded raw). Secrets are redacted by the caller
 * before the RunResult reaches the renderer.
 */

import type { AttemptResult, EndpointResult, RunResult } from "./types.js";

/**
 * Renders a {@link RunResult} as a JUnit XML string. Pure — no I/O.
 * @param result - The aggregated RunResult.
 * @returns The XML document as a string.
 */
export function renderJUnitXml(result: RunResult): string {
  const totalTests = result.endpoints.reduce((sum, e) => sum + caseCount(e), 0);
  const failures = result.endpoints.reduce((sum, e) => sum + (e.status === "fail" ? 1 : 0), 0);
  const time = (result.summary.duration_ms / MS_PER_S).toFixed(SEC_DECIMALS);

  const suiteHeader =
    `<testsuites name="apiwright" tests="${totalTests}"` +
    ` failures="${failures}" time="${time}">`;
  const suites = result.endpoints.map(renderSuite).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n${suiteHeader}\n${suites}\n</testsuites>\n`;
}

/** Milliseconds per second. */
const MS_PER_S = 1000;
/** Decimal places used for JUnit time attributes. */
const SEC_DECIMALS = 3;

/**
 * Counts the test cases under one endpoint result. For v1.0 each endpoint
 * surfaces one testcase per attempt (every retry preserved per §10 line 677).
 * @param e - The EndpointResult.
 * @returns Number of testcase elements to emit.
 */
function caseCount(e: EndpointResult): number {
  return Math.max(1, e.attempts.length);
}

/**
 * Renders one endpoint's results as a `<testsuite>`. One `<testcase>` per
 * attempt; flaky-pass surfaces a `<system-out>` note per spec line 696.
 * @param e - The EndpointResult.
 * @returns The XML fragment.
 */
function renderSuite(e: EndpointResult): string {
  const suiteName = esc(e.endpoint_id);
  const suiteTime = (totalAttemptMs(e) / MS_PER_S).toFixed(SEC_DECIMALS);
  const failuresInSuite = e.status === "fail" ? 1 : 0;
  const header =
    `  <testsuite name="${suiteName}" tests="${caseCount(e)}" failures="${failuresInSuite}"` +
    ` time="${suiteTime}">`;
  const cases = e.attempts.map((a, i) => renderCase(e, a, i + 1)).join("\n");
  return `${header}\n${cases}\n  </testsuite>`;
}

/**
 * Renders one attempt as a `<testcase>`. Failure attempts emit a
 * `<failure>` element with the captured `failure_reason`; the last attempt
 * for a flaky endpoint includes a `<system-out>` retry-count note.
 * @param e - The owning EndpointResult.
 * @param attempt - One AttemptResult.
 * @param ordinal - 1-based ordinal within the suite.
 * @returns The XML fragment.
 */
function renderCase(e: EndpointResult, attempt: AttemptResult, ordinal: number): string {
  // Issue #63: surface the §3 catalog kind in JUnit's `classname` (CI
  // tooling like Allure, GitHub's check-run summary, and Jenkins all
  // group testcases by classname). Name carries `case_id/attempt-N`
  // so the user can see which generated case (e.g. `get_idempotency.0`)
  // failed AND which retry attempt.
  const name = esc(`${attempt.case_id}/attempt-${ordinal}`);
  const classname = esc(`${e.endpoint_id}.${attempt.kind}`);
  const dur = Math.max(0, attempt.ended_at - attempt.started_at);
  const time = (dur / MS_PER_S).toFixed(SEC_DECIMALS);
  const opening =
    `    <testcase name="${name}" classname="${classname}" time="${time}">`;
  const body: string[] = [];
  if (attempt.verdict === "fail" && e.status === "fail") {
    const reason = esc(attempt.failure_reason ?? "test failed");
    body.push(`      <failure message="${reason}">${reason}</failure>`);
  }
  if (e.status === "flaky" && ordinal === e.attempts.length) {
    const note =
      `Flaky: passed on attempt ${ordinal} after ${ordinal - 1} retry(ies).`;
    body.push(`      <system-out>${note}</system-out>`);
  }
  return body.length === 0
    ? `${opening}</testcase>`
    : `${opening}\n${body.join("\n")}\n    </testcase>`;
}

/**
 * Sums attempt durations on an endpoint.
 * @param e - The EndpointResult.
 * @returns Total attempt wall-clock milliseconds.
 */
function totalAttemptMs(e: EndpointResult): number {
  return e.attempts.reduce((sum, a) => sum + Math.max(0, a.ended_at - a.started_at), 0);
}

/**
 * Minimal XML attribute / text escaper. Replaces the five XML-significant
 * characters with their entity references. NOT a CDATA wrapper — every
 * dynamic value passes through this single helper.
 * @param raw - The unescaped string.
 * @returns A safe XML attribute / text value.
 */
function esc(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
