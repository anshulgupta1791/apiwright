/**
 * Writes the {@link RunResult} as a JSON sidecar to the configured reports
 * directory. HTML + JUnit XML formats are owned by §10 Reporting (Task #11);
 * this layer ships only the canonical machine-readable JSON.
 *
 * The output passes through the redactor pipe so resolved tokens never
 * appear in the file (discharges obligations #3 + #13 at the emit boundary).
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { SecretRegistry } from "../../env/index.js";
import { RUNNER_ERROR_CODES, RunnerError } from "../errors.js";
import { redactValue } from "../execute/redactor-pipe.js";
import type { RunResult } from "../types.js";

/** Synthesized file name when the caller does not supply one. */
const DEFAULT_FILE_PREFIX = "run-";

/** Filesystem seam consumed by {@link emitRunResult}. */
export interface ReportWriterSeam {
  /**
   * Ensures the directory exists (recursive) before write.
   * @param dir - Directory path.
   */
  mkdir(dir: string): Promise<void>;
  /**
   * Writes the contents to `path` (UTF-8).
   * @param path - File path.
   * @param contents - File contents.
   */
  writeFile(path: string, contents: string): Promise<void>;
}

/**
 * Default {@link ReportWriterSeam} backed by Node's fs.promises.
 * @returns A seam that uses the real filesystem.
 */
export function createDefaultReportWriter(): ReportWriterSeam {
  return {
    async mkdir(dir: string): Promise<void> {
      await mkdir(dir, { recursive: true });
    },
    async writeFile(path: string, contents: string): Promise<void> {
      await writeFile(path, contents, "utf8");
    },
  };
}

/**
 * Writes the redacted RunResult to `{reportsDir}/{filename}` and returns
 * the absolute file path. Creates `reportsDir` recursively if it does not
 * already exist.
 * @param result - The RunResult to write.
 * @param reportsDir - Target directory (typically `./reports`).
 * @param secrets - SecretRegistry used for redaction.
 * @param filename - Optional filename; defaults to `run-<timestamp>.json`.
 * @param seam - Optional filesystem seam (tests inject a fake).
 * @returns The path the file was written to.
 * @throws {RunnerError} code `RUNNER_EMIT_FAILED` on any I/O error.
 */
export async function emitRunResult(
  result: RunResult,
  reportsDir: string,
  secrets: SecretRegistry,
  filename?: string,
  seam: ReportWriterSeam = createDefaultReportWriter(),
): Promise<string> {
  const safeName = filename ?? defaultFilename();
  const path = join(reportsDir, safeName);
  const redacted = redactValue(result, secrets);
  const text = JSON.stringify(redacted, null, 2);
  try {
    await seam.mkdir(reportsDir);
    await seam.writeFile(path, text);
    return path;
  } catch (cause: unknown) {
    throw new RunnerError({
      code: RUNNER_ERROR_CODES.RUNNER_EMIT_FAILED,
      phase: "emit",
      message: `Failed to write run report at '${path}'.`,
      cause,
    });
  }
}

/**
 * Builds the default filename for a run report. Stable + sortable by timestamp.
 * @returns The default filename (e.g., `run-1716123456789.json`).
 */
function defaultFilename(): string {
  return `${DEFAULT_FILE_PREFIX}${Date.now()}.json`;
}
