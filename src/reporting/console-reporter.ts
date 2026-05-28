/**
 * Console reporter — surfaces run events to the configured `Logger` at the
 * appropriate level (V1_BUILD_SPEC.md §10 lines 682-691).
 *
 * Level semantics (locked from spec):
 *  - `error` — only test failures (after retries exhausted); no retry-pass
 *    notices; no per-test progress; final summary only.
 *  - `warn` (default) — failures + one-line flaky notices; no progress.
 *  - `info` — above + per-test progress + retry-attempt summaries.
 *  - `debug` — above + full request/response bodies + DB results +
 *    assertion evaluation traces.
 *
 * The reporter consumes a {@link RunResult} (post-run) and emits one or
 * more log lines per endpoint as appropriate for the level. The {@link Logger}
 * itself filters by level; this layer composes the messages.
 *
 * **Security (§8 line 596 + audit blocker 🚨-2):** EVERY string emitted via
 * `logger.{error,warn,info,debug}(...)` passes through {@link redactSecrets}
 * against the run-scoped {@link SecretRegistry} so resolved tokens, header
 * credentials, and other registered secrets become `[REDACTED]` BEFORE they
 * reach stdout. The redaction happens at the emission boundary inside this
 * module — callers cannot accidentally bypass it.
 */

import type { Logger } from "../cli/logging/logger.js";
import type { SecretRegistry } from "../env/index.js";
import { redactSecrets } from "../env/index.js";

import type { AttemptResult, EndpointResult, RunResult } from "./types.js";

/**
 * Emits the per-run console output for `result` via `logger`. Honors the
 * level filtering already configured on the {@link Logger}. EVERY emitted
 * string is redacted against `secrets` before reaching the logger.
 * @param result - The completed RunResult.
 * @param logger - The configured Logger.
 * @param secrets - The run-scoped SecretRegistry; every emitted string is
 *   piped through `redactSecrets(text, secrets)` to mask registered values.
 */
export function reportRunToConsole(
  result: RunResult,
  logger: Logger,
  secrets: SecretRegistry,
): void {
  const safe = wrapLogger(logger, secrets);
  for (const ep of result.endpoints) reportEndpoint(ep, safe);
  reportWarnings(result, safe);
  reportSummary(result, safe);
}

/**
 * Emits plan-generation warnings at `warn` level — visible at the default
 * log level (`warn`) and above, hidden only when the user opts into
 * `error`-only output. Each line is redacted by the wrapped logger.
 * @param result - The RunResult carrying any plan warnings.
 * @param logger - The redaction-wrapped Logger.
 */
function reportWarnings(result: RunResult, logger: Logger): void {
  for (const w of result.warnings ?? []) logger.warn(w);
}

/**
 * Wraps a {@link Logger} so every emitted string is redacted against
 * `secrets` first. The redaction boundary is sealed inside this module;
 * the returned wrapper is the only logger consumed by the rest of the
 * file.
 * @param logger - The underlying Logger to wrap.
 * @param secrets - The SecretRegistry to redact against.
 * @returns A new Logger that pipes every message through `redactSecrets`.
 */
function wrapLogger(logger: Logger, secrets: SecretRegistry): Logger {
  return {
    level: logger.level,
    error(message: string): void {
      logger.error(redactSecrets(message, secrets));
    },
    warn(message: string): void {
      logger.warn(redactSecrets(message, secrets));
    },
    info(message: string): void {
      logger.info(redactSecrets(message, secrets));
    },
    debug(message: string): void {
      logger.debug(redactSecrets(message, secrets));
    },
  };
}

/**
 * Emits per-endpoint lines per the level rules. Failures are always emitted
 * at `error`; flaky notices at `warn`; per-attempt progress at `info`; full
 * traces at `debug`.
 * @param ep - The EndpointResult.
 * @param logger - The redaction-wrapped Logger.
 */
function reportEndpoint(ep: EndpointResult, logger: Logger): void {
  if (ep.status === "fail") {
    const lastFail = ep.attempts.find((a) => a.verdict === "fail");
    /* istanbul ignore next — endpoints with status=fail always have at least one
       failed attempt with a failure_reason (executor invariant). */
    const reason = lastFail?.failure_reason ?? "no detail";
    logger.error(`FAIL ${ep.endpoint_id} — ${reason}`);
  } else if (ep.status === "flaky") {
    const passOrdinal = ep.attempts.findIndex((a) => a.verdict === "pass") + 1;
    const retryCount = passOrdinal - 1;
    logger.warn(
      `${ep.endpoint_id} passed on attempt ${passOrdinal} after ${retryCount} retry(ies)`,
    );
  }
  // info: per-attempt progress one-liners
  for (const [i, a] of ep.attempts.entries()) {
    logger.info(`${ep.endpoint_id} attempt ${i + 1}: ${a.verdict}${
      a.failure_reason ? ` — ${a.failure_reason}` : ""}`);
  }
  // debug: full request/response/assertion/db dump
  for (const [i, a] of ep.attempts.entries()) reportAttemptDebug(ep.endpoint_id, i + 1, a, logger);
}

/**
 * Emits the full attempt trace at debug level only. Headers and bodies
 * (which may contain secrets) are JSON-stringified and passed through the
 * wrapped logger — the wrapper redacts every emitted string.
 * @param endpointId - The endpoint id.
 * @param ordinal - 1-based attempt number.
 * @param a - The AttemptResult.
 * @param logger - The redaction-wrapped Logger.
 */
function reportAttemptDebug(
  endpointId: string,
  ordinal: number,
  a: AttemptResult,
  logger: Logger,
): void {
  if (a.request) {
    const headersJson = JSON.stringify(a.request.headers);
    logger.debug(
      `${endpointId} attempt ${ordinal} request: ${a.request.method} ${a.request.url} ` +
      `headers=${headersJson}`,
    );
    if (a.request.body !== undefined) {
      logger.debug(`${endpointId} request body: ${JSON.stringify(a.request.body)}`);
    }
  }
  if (a.response) {
    logger.debug(
      `${endpointId} attempt ${ordinal} response: ${a.response.status} (${a.response.time_ms} ms)`,
    );
    logger.debug(`${endpointId} response body: ${JSON.stringify(a.response.body)}`);
  }
  for (const ar of a.assertions) {
    logger.debug(
      `${endpointId} assertion '${ar.assertion}': ${ar.pass ? "pass" : "fail"}`,
    );
  }
  for (const d of a.db_verify) {
    const verdict = d.pass ? "pass" : "fail";
    logger.debug(
      `${endpointId} db.${d.connection}.${d.query_id}: rows=${d.normalized.rowCount} ${verdict}`,
    );
  }
}

/**
 * Emits the run summary block (always shown at every level, in line with
 * the spec's "final summary only" promise for `error` level).
 * @param result - The RunResult.
 * @param logger - The redaction-wrapped Logger.
 */
function reportSummary(result: RunResult, logger: Logger): void {
  const s = result.summary;
  const flakyList = result.endpoints.filter((e) => e.flaky).map((e) => e.endpoint_id);
  logger.error(
    `Run summary: planned=${s.endpoints_planned} passed=${s.passed} failed=${s.failed}` +
    ` flaky=${s.flaky} duration_ms=${s.duration_ms}`,
  );
  if (flakyList.length > 0) {
    logger.warn(`Flaky tests: ${flakyList.join(", ")}`);
  }
}
