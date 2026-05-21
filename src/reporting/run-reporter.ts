/**
 * Orchestrates all §10 Reporting outputs (HTML + JSON + JUnit XML) per the
 * targets bitmap. Returns the {@link ReportArtifacts} so the CLI can print
 * file paths and CI integrations can locate them.
 *
 * Console output is intentionally NOT included here — that path runs
 * synchronously against the active {@link Logger} via
 * {@link reportRunToConsole}. This orchestrator is for file artifacts only.
 */

import { join } from "node:path";

import type { SecretRegistry } from "../env/index.js";
import { redactValue } from "../runner/execute/redactor-pipe.js";

import { REPORT_ERROR_CODES, ReportError } from "./errors.js";
import { renderHtmlReport } from "./html-renderer.js";
import {
  type ReportWriterSeam,
  createDefaultReportWriter,
  emitJsonSidecar,
} from "./json-emitter.js";
import { renderJUnitXml } from "./junit-xml-renderer.js";
import type {
  ReportArtifacts,
  RunReporterConfig,
  RunResult,
} from "./types.js";

/** Default filename prefix when caller omits a basename. */
const DEFAULT_BASENAME_PREFIX = "run-";

/**
 * Emits the configured set of reporting artifacts for one run.
 * @param result - The completed RunResult.
 * @param config - Reporter configuration (dir + targets + optional basename).
 * @param secrets - SecretRegistry for value-level redaction.
 * @param seam - Optional filesystem seam (tests inject a fake).
 * @returns The {@link ReportArtifacts} listing every emitted file path.
 * @throws {ReportError} on any render/write failure (one error per format).
 */
export async function emitRunReport(
  result: RunResult,
  config: RunReporterConfig,
  secrets: SecretRegistry,
  seam: ReportWriterSeam = createDefaultReportWriter(),
): Promise<ReportArtifacts> {
  const basename = config.basename ?? `${DEFAULT_BASENAME_PREFIX}${Date.now()}`;
  const out: { json?: string; html?: string; junit_xml?: string } = {};
  await seam.mkdir(config.reportsDir);

  if (config.targets.json) {
    out.json = await emitJsonSidecar(result, config.reportsDir, basename, secrets, seam);
  }
  if (config.targets.html) {
    out.html = await emitHtml(result, config.reportsDir, basename, secrets, seam);
  }
  if (config.targets.junit_xml) {
    out.junit_xml = await emitJUnitXml(result, config.reportsDir, basename, secrets, seam);
  }
  return out;
}

/**
 * Renders + writes the HTML report.
 * @param result - The RunResult.
 * @param reportsDir - Target directory.
 * @param basename - File basename.
 * @param secrets - SecretRegistry.
 * @param seam - Filesystem seam.
 * @returns The file path written.
 * @throws {ReportError} code REPORT_HTML_RENDER_FAILED on any failure.
 */
async function emitHtml(
  result: RunResult,
  reportsDir: string,
  basename: string,
  secrets: SecretRegistry,
  seam: ReportWriterSeam,
): Promise<string> {
  const redacted = redactValue(result, secrets) as RunResult;
  const path = join(reportsDir, `${basename}.html`);
  try {
    const html = renderHtmlReport(redacted);
    await seam.writeFile(path, html);
    return path;
  } catch (cause: unknown) {
    throw new ReportError({
      code: REPORT_ERROR_CODES.REPORT_HTML_RENDER_FAILED,
      phase: "render",
      message: `Failed to render or write HTML report at '${path}'.`,
      cause,
    });
  }
}

/**
 * Renders + writes the JUnit XML report.
 * @param result - The RunResult.
 * @param reportsDir - Target directory.
 * @param basename - File basename.
 * @param secrets - SecretRegistry.
 * @param seam - Filesystem seam.
 * @returns The file path written.
 * @throws {ReportError} code REPORT_JUNIT_RENDER_FAILED on any failure.
 */
async function emitJUnitXml(
  result: RunResult,
  reportsDir: string,
  basename: string,
  secrets: SecretRegistry,
  seam: ReportWriterSeam,
): Promise<string> {
  const redacted = redactValue(result, secrets) as RunResult;
  const path = join(reportsDir, `${basename}.xml`);
  try {
    const xml = renderJUnitXml(redacted);
    await seam.writeFile(path, xml);
    return path;
  } catch (cause: unknown) {
    throw new ReportError({
      code: REPORT_ERROR_CODES.REPORT_JUNIT_RENDER_FAILED,
      phase: "render",
      message: `Failed to render or write JUnit XML at '${path}'.`,
      cause,
    });
  }
}
