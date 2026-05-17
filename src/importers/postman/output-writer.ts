/**
 * Postman output writer: serializes CanonicalEndpoint objects to filesystem
 * as <outputDir>/<folder-slugs>/<name>.endpoint.json.
 *
 * Uses deterministic key order for diff-clean re-imports. All disk access
 * goes through the ImporterFileSystem seam (in-memory fake in tests).
 * Name collisions are disambiguated deterministically with rename warnings.
 */

import { join } from "node:path";

import type { CanonicalEndpoint } from "../../core/canonical-model.js";
import { NodeImporterFileSystem } from "../fs-seam.js";
import type { ImporterFileSystem } from "../types.js";

import { PathNamer } from "./path-naming.js";

/**
 * One endpoint plus its Postman folder path, ready to write.
 */
export interface WritableEndpoint {
  /** The validated endpoint. */
  endpoint: CanonicalEndpoint;
  /** Folder-path segments from the source FlattenedRequest. */
  folderPath: string[];
}

/** Result of a write operation. */
export interface OutputWriteResult {
  /** Count of files successfully written. */
  written: number;
  /** Rename/collision warnings. */
  warnings: string[];
}

/** Options for PostmanOutputWriter. */
export interface PostmanOutputWriterOptions {
  /** Write-capable FS seam. Default: new NodeImporterFileSystem(). */
  fs?: ImporterFileSystem;
  /** Shared namer. Default: new PathNamer(). */
  namer?: PathNamer;
}

/**
 * Canonical field order for CanonicalEndpoint serialization.
 * Fields are emitted in this order; unknown keys are sorted lexicographically after.
 */
const CANONICAL_KEY_ORDER: readonly string[] = [
  "id",
  "name",
  "method",
  "url",
  "auth_strategy",
  "tags",
  "markers",
  "prod_safe",
  "request",
  "response",
  "db_verify",
  "assertions",
  "cleanup",
  "retry",
  "source",
];

/**
 * Canonical field order for nested request object.
 */
const REQUEST_KEY_ORDER: readonly string[] = [
  "headers",
  "body_schema",
  "body_example",
  "query_params",
];

/**
 * Canonical field order for nested response object.
 */
const RESPONSE_KEY_ORDER: readonly string[] = [
  "expected_status",
  "schema",
  "headers",
  "sla_ms",
];

/**
 * Canonical field order for nested source object.
 */
const SOURCE_KEY_ORDER: readonly string[] = [
  "type",
  "collection",
  "endpoint_id",
  "spec_url",
];

/**
 * Writes each endpoint as <outputDir>/<folder slugs.../><name>.endpoint.json,
 * creating mirror directories. Collisions are disambiguated deterministically.
 * Never throws on a name collision.
 */
export class PostmanOutputWriter {
  readonly #fs: ImporterFileSystem;
  readonly #namer: PathNamer;

  /**
   * Constructs a PostmanOutputWriter with optional injectable seams.
   * @param options - Optional configuration.
   * @param options.fs - Injectable FS seam; defaults to NodeImporterFileSystem.
   * @param options.namer - Injectable path namer; defaults to PathNamer.
   */
  constructor(options?: PostmanOutputWriterOptions) {
    this.#fs = options?.fs ?? new NodeImporterFileSystem();
    this.#namer = options?.namer ?? new PathNamer();
  }

  /**
   * Writes each endpoint as <outputDir>/<folder slugs.../><name>.endpoint.json,
   * creating mirror directories. Collisions are disambiguated deterministically.
   * Never throws on a name collision.
   * @param items - Endpoints with their folder paths, in document order.
   * @param outputDir - Destination root directory (absolute or relative).
   * @returns Count written plus rename warnings.
   */
  write(
    items: readonly WritableEndpoint[],
    outputDir: string,
  ): OutputWriteResult {
    const warnings: string[] = [];
    let written = 0;
    const usedPaths = new Set<string>();

    for (const item of items) {
      // Build directory path
      const segments = item.folderPath.map((s) => this.#namer.toPathSegment(s));
      const dir =
        segments.length > 0 ? join(outputDir, ...segments) : outputDir;

      // Build stem (file name without extension)
      const stem = this.#namer.toPathSegment(item.endpoint.name);
      const candidatePath = join(dir, `${stem}.endpoint.json`);

      // Resolve name collision
      let finalPath = candidatePath;
      if (usedPaths.has(candidatePath)) {
        const finalStem = this.#namer.dedupe(
          stem,
          new Set(
            [...usedPaths]
              .filter((p) => p.startsWith(dir))
              .map((p) => {
                const fileName = p.slice(dir.length + 1);
                return fileName.replace(".endpoint.json", "");
              }),
          ),
        );
        finalPath = join(dir, `${finalStem}.endpoint.json`);
        warnings.push(
          `Output name collision: '${stem}.endpoint.json' written as '${finalStem}.endpoint.json'`,
        );
      }
      usedPaths.add(finalPath);

      // Create directory and write file
      this.#fs.mkdirp(dir);
      this.#fs.writeFile(finalPath, this.#serialize(item.endpoint));
      written++;
    }

    return { written, warnings };
  }

  /**
   * Serializes a CanonicalEndpoint to stable, pretty JSON with deterministic
   * key order. Two-space indent, trailing newline.
   * @param endpoint - The endpoint to serialize.
   * @returns Formatted JSON string.
   */
  #serialize(endpoint: CanonicalEndpoint): string {
    const ordered = this.#orderObject(
      endpoint as unknown as Record<string, unknown>,
      CANONICAL_KEY_ORDER,
    );

    // Apply nested key ordering to known sub-objects
    if (ordered["request"] && typeof ordered["request"] === "object") {
      ordered["request"] = this.#orderObject(
        ordered["request"] as Record<string, unknown>,
        REQUEST_KEY_ORDER,
      );
    }
    if (ordered["response"] && typeof ordered["response"] === "object") {
      ordered["response"] = this.#orderObject(
        ordered["response"] as Record<string, unknown>,
        RESPONSE_KEY_ORDER,
      );
    }
    if (ordered["source"] && typeof ordered["source"] === "object") {
      ordered["source"] = this.#orderObject(
        ordered["source"] as Record<string, unknown>,
        SOURCE_KEY_ORDER,
      );
    }

    return `${JSON.stringify(ordered, null, 2)}\n`;
  }

  /**
   * Returns a new object with keys in the specified order, with remaining
   * keys sorted lexicographically after the known keys.
   * @param obj - The object to reorder.
   * @param keyOrder - The preferred key order.
   * @returns A new object with keys in the specified order.
   */
  #orderObject(
    obj: Record<string, unknown>,
    keyOrder: readonly string[],
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    // First: known keys in order (only if present)
    for (const key of keyOrder) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        result[key] = obj[key];
      }
    }
    // Then: remaining keys sorted lexicographically
    const knownSet = new Set(keyOrder);
    const remainingKeys = Object.keys(obj)
      .filter((k) => !knownSet.has(k))
      .sort();
    for (const key of remainingKeys) {
      result[key] = obj[key];
    }
    return result;
  }
}
