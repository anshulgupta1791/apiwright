/**
 * JSON sidecar emitter — writes the {@link RunResult} as machine-readable
 * JSON to the configured reports directory. Discharges the V1_BUILD_SPEC.md
 * §10 line 680 contract: "JSON sidecar: same content as machine-readable
 * JSON for downstream tooling."
 *
 * The output passes through {@link redactValue} so resolved tokens and
 * other registered secrets never appear in the file (carries forward the
 * Task #10 obligation #3 + #13 boundary).
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { SecretRegistry } from "../env/index.js";
import { redactValue } from "../runner/execute/redactor-pipe.js";

import { REPORT_ERROR_CODES, ReportError } from "./errors.js";
import type { RunResult } from "./types.js";

/** Filesystem seam consumed by the emitter — tests inject a fake. */
export interface ReportWriterSeam {
  /** Recursively creates `dir` if absent. */
  mkdir(dir: string): Promise<void>;
  /** Writes `contents` (UTF-8) to `path`. */
  writeFile(path: string, contents: string): Promise<void>;
}

/**
 * Builds the default {@link ReportWriterSeam} backed by `node:fs/promises`.
 * @returns The default seam.
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
 * Writes the redacted RunResult to `{reportsDir}/{basename}.json` and
 * returns the path the file was written to.
 * @param result - The RunResult.
 * @param reportsDir - Target directory.
 * @param basename - Filename without extension (`.json` appended).
 * @param secrets - SecretRegistry for value-level redaction.
 * @param seam - Optional filesystem seam.
 * @returns The path the JSON sidecar was written to.
 * @throws {ReportError} code `REPORT_JSON_WRITE_FAILED` on any I/O failure.
 */
export async function emitJsonSidecar(
  result: RunResult,
  reportsDir: string,
  basename: string,
  secrets: SecretRegistry,
  seam: ReportWriterSeam = createDefaultReportWriter(),
): Promise<string> {
  const path = join(reportsDir, `${basename}.json`);
  const redacted = redactValue(result, secrets);
  const text = JSON.stringify(redacted, null, 2);
  try {
    await seam.mkdir(reportsDir);
    await seam.writeFile(path, text);
    return path;
  } catch (cause: unknown) {
    throw new ReportError({
      code: REPORT_ERROR_CODES.REPORT_JSON_WRITE_FAILED,
      phase: "write",
      message: `Failed to write JSON sidecar at '${path}'.`,
      cause,
    });
  }
}
