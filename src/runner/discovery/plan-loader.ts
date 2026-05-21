/**
 * Reads, JSON-parses, and meta-schema-validates every endpoint JSON file
 * discovered by the walker. Discharges Task #10 obligation #4 (§2 canonical
 * persistence — read side).
 *
 * Aggregates ALL parse + validate failures across the whole set before
 * throwing one RunnerError — the runner refuses to start with even one
 * invalid endpoint, but the user gets the full list of failures in one go.
 */

import { readFile } from "node:fs/promises";

import type { CanonicalEndpoint } from "../../core/canonical-model.js";
import { parseJson } from "../../core/safe-json.js";
import { SchemaValidator } from "../../core/schema-validator.js";
import { RUNNER_ERROR_CODES, RunnerError } from "../errors.js";
import type { EndpointLoadRecord } from "../types.js";

/** Minimal filesystem seam for reading file contents. */
export interface FileReaderSeam {
  /**
   * Returns the UTF-8 contents of `path`.
   * @param path - Absolute or repo-relative file path.
   * @returns The file contents as a UTF-8 string.
   */
  readFile(path: string): Promise<string>;
}

/**
 * Default {@link FileReaderSeam} backed by Node's `fs.promises.readFile`.
 * @returns A {@link FileReaderSeam} that reads from the real filesystem.
 */
export function createDefaultFileReaderSeam(): FileReaderSeam {
  return {
    async readFile(path: string): Promise<string> {
      return readFile(path, "utf8");
    },
  };
}

/**
 * Loads and validates every endpoint JSON path in `paths`. Returns a map of
 * `endpoint.id -> EndpointLoadRecord` sorted by endpoint id.
 * @param paths - Repo-relative or absolute paths to `*.endpoint.json` files.
 * @param validator - Shared {@link SchemaValidator} (the same instance used by
 *   `apiwright validate`).
 * @param seam - File reader seam; defaults to the real-fs implementation.
 * @returns A map of `endpoint.id` → record, ordered by endpoint id.
 * @throws {RunnerError} code `RUNNER_ENDPOINT_PARSE_FAILED` when any file
 *   fails JSON parsing or schema validation; the message aggregates all
 *   offenders (one per line, in path-sorted order).
 */
export async function loadEndpointPlan(
  paths: readonly string[],
  validator: SchemaValidator,
  seam: FileReaderSeam = createDefaultFileReaderSeam(),
): Promise<ReadonlyMap<string, EndpointLoadRecord>> {
  const errors: string[] = [];
  const records: EndpointLoadRecord[] = [];

  for (const path of paths) {
    const record = await loadOne(path, validator, seam, errors);
    if (record !== null) records.push(record);
  }

  if (errors.length > 0) {
    throw new RunnerError({
      code: RUNNER_ERROR_CODES.RUNNER_ENDPOINT_PARSE_FAILED,
      phase: "plan-gen",
      message: `Endpoint validation failed (${errors.length} file(s)):\n${errors.join("\n")}`,
    });
  }

  // Sort by endpoint id (deterministic across runs / machines for sharding).
  records.sort((a, b) => a.endpoint.id.localeCompare(b.endpoint.id));
  const map = new Map<string, EndpointLoadRecord>();
  for (const r of records) map.set(r.endpoint.id, r);
  return map;
}

/**
 * Reads + parses + validates a single endpoint file. On any failure, pushes
 * a one-line message into `errors` and returns `null`.
 * @param path - File path.
 * @param validator - Shared SchemaValidator.
 * @param seam - File reader seam.
 * @param errors - Mutable accumulator for failure messages.
 * @returns The loaded record on success, null on failure.
 */
async function loadOne(
  path: string,
  validator: SchemaValidator,
  seam: FileReaderSeam,
  errors: string[],
): Promise<EndpointLoadRecord | null> {
  let raw: string;
  try {
    raw = await seam.readFile(path);
  } catch (e: unknown) {
    /* istanbul ignore next — defensive: thrown values are conventionally Error;
       String(e) fallback only hits if a non-Error was thrown. */
    const msg = e instanceof Error ? e.message : String(e);
    errors.push(`  - '${path}': read failed: ${msg}`);
    return null;
  }
  const parsed = parseJson(raw);
  if (!parsed.ok) {
    errors.push(`  - '${path}': parse failed: ${parsed.error}`);
    return null;
  }
  const valid = validator.validateEndpoint(parsed.value);
  if (!valid.valid) {
    /* istanbul ignore next — SchemaValidator always returns errors[] on valid:false;
       ?? [] is a TypeScript-strict defensive default. */
    const detail = (valid.errors ?? []).map((m) => `      ${m}`).join("\n");
    errors.push(`  - '${path}': schema validation failed:\n${detail}`);
    return null;
  }
  return { path, endpoint: parsed.value as CanonicalEndpoint };
}
