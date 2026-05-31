/**
 * HTML technical report renderer — produces a self-contained HTML file
 * that opens locally in a browser (§10 lines 674-680).
 *
 * Per-endpoint detail: request payload, response body, response time,
 * schema validation result, every test pass/fail, every declarative
 * assertion result, DB query results. All retry attempts captured (no
 * data ever discarded; flaky attempts shown as separate entries).
 *
 * The renderer escapes every dynamic value (no untrusted text is ever
 * embedded raw — defense against XSS even though reports are local).
 * Pure: takes a {@link RunResult}, returns a string. Zero I/O.
 */

import type {
  AttemptResult,
  EndpointResult,
  RequestRecord,
  ResponseRecord,
  RunResult,
} from "./types.js";

/**
 * Renders a {@link RunResult} as a self-contained HTML technical report.
 * @param result - The aggregated RunResult.
 * @returns The HTML document as a string.
 */
export function renderHtmlReport(result: RunResult): string {
  return [
    "<!doctype html>",
    `<html lang="en"><head>`,
    `<meta charset="utf-8" />`,
    `<title>APIWright Report — ${esc(result.env)}</title>`,
    `<style>${BUILTIN_CSS}</style>`,
    `</head><body>`,
    renderHeader(result),
    renderSummary(result),
    renderFlakyList(result),
    `<section class="endpoints">`,
    result.endpoints.map(renderEndpoint).join("\n"),
    `</section>`,
    `</body></html>`,
  ].join("\n");
}

/** Built-in CSS so the report is self-contained (no external assets). */
const BUILTIN_CSS = [
  "body{font-family:-apple-system,Segoe UI,sans-serif;margin:0;padding:1rem;",
  "background:#fafafa;color:#1a1a1a}",
  "h1,h2,h3{margin:0.5rem 0}",
  ".summary{background:#fff;padding:1rem;border-radius:4px;margin-bottom:1rem;",
  "box-shadow:0 1px 2px rgba(0,0,0,0.05)}",
  ".summary span{margin-right:1rem}",
  ".pass{color:#0a7a0a}.fail{color:#b30000}.flaky{color:#c87000}",
  ".endpoint{background:#fff;padding:1rem;margin-bottom:1rem;border-radius:4px;",
  "box-shadow:0 1px 2px rgba(0,0,0,0.05)}",
  ".attempt{border-left:3px solid #ddd;padding:0.5rem;margin:0.5rem 0;background:#fcfcfc}",
  ".attempt.pass{border-color:#0a7a0a}.attempt.fail{border-color:#b30000}",
  "pre{background:#f4f4f4;padding:0.5rem;overflow-x:auto;font-size:0.85em;border-radius:3px}",
  "table{border-collapse:collapse;width:100%;margin:0.25rem 0}",
  "th,td{padding:0.25rem 0.5rem;border:1px solid #ddd;text-align:left}",
  ".flaky-list{background:#fff7e6;padding:0.75rem;border-radius:4px;margin-bottom:1rem}",
].join("");

/**
 * Renders the report header block.
 * @param result - The RunResult.
 * @returns HTML fragment.
 */
function renderHeader(result: RunResult): string {
  return `<header><h1>APIWright Run — ${esc(result.env)}</h1>` +
    `<div>Started: ${esc(result.started_at)} · Ended: ${esc(result.ended_at)}` +
    ` · Workers: ${result.workers}${ 
    result.shard ? ` · Shard: ${result.shard.index}/${result.shard.total}` : "" 
    }</div></header>`;
}

/**
 * Renders the summary counts block.
 * @param result - The RunResult.
 * @returns HTML fragment.
 */
function renderSummary(result: RunResult): string {
  const s = result.summary;
  return `<section class="summary"><h2>Summary</h2>` +
    `<span>Planned: ${s.endpoints_planned}</span>` +
    `<span class="pass">Passed: ${s.passed}</span>` +
    `<span class="fail">Failed: ${s.failed}</span>` +
    `<span class="flaky">Flaky: ${s.flaky}</span>` +
    `<span>Duration: ${s.duration_ms} ms</span>` +
    `</section>`;
}

/**
 * Renders the flaky-tests list (separately surfaced per spec line 679).
 * @param result - The RunResult.
 * @returns HTML fragment (empty when there are no flaky endpoints).
 */
function renderFlakyList(result: RunResult): string {
  const flaky = result.endpoints.filter((e) => e.flaky);
  if (flaky.length === 0) return "";
  const rows = flaky.map((e) => `<li>${esc(e.endpoint_id)}</li>`).join("");
  return `<section class="flaky-list"><h3>Flaky tests (passed after retry)</h3>` +
    `<ul>${rows}</ul></section>`;
}

/**
 * Renders one endpoint section with every attempt.
 * @param e - The EndpointResult.
 * @returns HTML fragment.
 */
function renderEndpoint(e: EndpointResult): string {
  const cls = e.status;
  const cleanupLine = e.cleanup
    ? `<div>Cleanup: ${e.cleanup.ok ? "ok" : `failed (${esc(e.cleanup.reason ?? "")})`}</div>`
    : "";
  return `<section class="endpoint">` +
    `<h2 class="${cls}">${esc(e.endpoint_id)} — ${esc(e.status)}</h2>${ 
    cleanupLine 
    }${e.attempts.map((a, i) => renderAttempt(a, i + 1)).join("\n") 
    }</section>`;
}

/**
 * Renders one attempt with request, response, assertion, and db_verify
 * details. Every attempt's full trace is preserved (spec line 677).
 * @param a - The AttemptResult.
 * @param ordinal - 1-based attempt number.
 * @returns HTML fragment.
 */
function renderAttempt(a: AttemptResult, ordinal: number): string {
  const failureBlock = a.failure_reason
    ? `<div class="fail">Reason: ${esc(a.failure_reason)}</div>`
    : "";
  // Issue #63: surface case_id + kind in the heading so a user reading
  // the HTML report knows WHICH of the 16 generated cases this attempt
  // belongs to. Previously the heading only showed "Attempt N" with no
  // way to distinguish status_code_conformance from get_idempotency.
  return `<div class="attempt ${a.verdict}">` +
    `<h3><code>${esc(a.kind)}</code> — Attempt ${ordinal} — ` +
    `<span class="${a.verdict}">${esc(a.verdict)}</span> ` +
    `(${a.ended_at - a.started_at} ms)</h3>` +
    `<div class="case-id">case: <code>${esc(a.case_id)}</code></div>${
    failureBlock
    }${renderRequest(a.request)
    }${renderResponse(a.response)
    }${renderAssertions(a)
    }${renderDbVerify(a)
    }</div>`;
}

/**
 * Renders the request record block, or "(no request sent)" placeholder.
 * @param req - The RequestRecord (may be absent).
 * @returns HTML fragment.
 */
function renderRequest(req: RequestRecord | undefined): string {
  /* istanbul ignore next — executor always captures a request when an attempt
     reaches the http-client send step (covered in case-runners tests). */
  if (!req) return `<div>Request: (not sent)</div>`;
  const bodyBlock = req.body !== undefined
    ? `Body: <pre>${esc(safeStringify(req.body))}</pre>`
    : "";
  return `<div><strong>Request</strong>: ${esc(req.method)} ${esc(req.url)}<br/>` +
    `Headers: <pre>${esc(JSON.stringify(req.headers, null, 2))}</pre>${bodyBlock}</div>`;
}

/**
 * Renders the response record block.
 * @param res - The ResponseRecord (may be absent).
 * @returns HTML fragment.
 */
function renderResponse(res: ResponseRecord | undefined): string {
  /* istanbul ignore next — defensive: response absence is only possible when
     the http-client throws before any send, which the executor catches. */
  if (!res) return `<div>Response: (none)</div>`;
  return `<div><strong>Response</strong>: status ${res.status} · time ${res.time_ms} ms<br/>` +
    `Headers: <pre>${esc(JSON.stringify(res.headers, null, 2))}</pre>` +
    `Body: <pre>${esc(safeStringify(res.body))}</pre>` +
    `</div>`;
}

/**
 * Renders the assertion results (empty list = nothing to show).
 * @param a - The AttemptResult.
 * @returns HTML fragment.
 */
function renderAssertions(a: AttemptResult): string {
  if (a.assertions.length === 0) return "";
  const rows = a.assertions
    .map((r) => `<tr><td>${esc(r.assertion)}</td><td class="${r.pass ? "pass" : "fail"}">` +
      `${r.pass ? "pass" : "fail"}</td><td>${esc(r.reason ?? "")}</td></tr>`)
    .join("");
  return `<div><strong>Assertions</strong>:` +
    `<table><thead><tr><th>Assertion</th><th>Verdict</th><th>Reason</th></tr></thead>` +
    `<tbody>${rows}</tbody></table></div>`;
}

/**
 * Renders the db_verify outcomes table.
 * @param a - The AttemptResult.
 * @returns HTML fragment.
 */
function renderDbVerify(a: AttemptResult): string {
  if (a.db_verify.length === 0) return "";
  const rows = a.db_verify
    .map((d) => `<tr><td>${esc(d.connection)}.${esc(d.query_id)}</td>` +
      `<td class="${d.pass ? "pass" : "fail"}">${d.pass ? "pass" : "fail"}</td>` +
      `<td>${esc(d.reason ?? "")}</td><td>rows=${d.normalized.rowCount}</td></tr>`)
    .join("");
  return `<div><strong>DB Verify</strong>:` +
    `<table><thead><tr>` +
    `<th>db.conn.qid</th><th>Verdict</th><th>Reason</th><th>Rows</th>` +
    `</tr></thead>` +
    `<tbody>${rows}</tbody></table></div>`;
}

/**
 * JSON.stringify guard that never throws on unserializable values.
 * @param v - The value.
 * @returns JSON string or `[unserializable]` placeholder.
 */
function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    /* istanbul ignore next — JSON.stringify only throws on circular or BigInt;
       the runner pipeline produces neither in practice. */
    return "[unserializable]";
  }
}

/**
 * HTML attribute / text escaper covering the four characters that have
 * special meaning in HTML: `&`, `<`, `>`, `"`. Defends against XSS even
 * though reports are typically opened locally.
 * @param raw - Untrusted string.
 * @returns HTML-safe string.
 */
function esc(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
