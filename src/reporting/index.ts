/**
 * Public barrel for the §10 Reporting layer (Task #11). Consumes the §9
 * runner's {@link RunResult} and produces three persistent artifact
 * formats — JSON sidecar, HTML technical report, JUnit XML — plus a
 * console reporter that surfaces run events to the active Logger
 * filtered by `--log` level.
 *
 * Single public entry point per Tasks 8/9/10 precedent. Internal renderers
 * are NOT re-exported; CLI consumers use `emitRunReport` for file artifacts
 * and `reportRunToConsole` for the live console stream.
 */

export { emitRunReport } from "./run-reporter.js";
export { reportRunToConsole } from "./console-reporter.js";
export {
  REPORT_ERROR_CODES,
  ReportError,
  isReportError,
} from "./errors.js";
export type {
  ReportErrorCode,
  ReportErrorInit,
  ReportPhase,
} from "./errors.js";
export type {
  ReportArtifacts,
  ReportTargets,
  RunReporterConfig,
  RunResult,
} from "./types.js";

// JSON sidecar emitter is also exposed for callers that only want the
// machine-readable form (e.g. tests, scripts).
export { emitJsonSidecar, createDefaultReportWriter } from "./json-emitter.js";
export type { ReportWriterSeam } from "./json-emitter.js";

// Pure renderers exported so CI integrations can string-render without I/O.
export { renderHtmlReport } from "./html-renderer.js";
export { renderJUnitXml } from "./junit-xml-renderer.js";
