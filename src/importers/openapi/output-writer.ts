/**
 * OpenApiOutputWriter: writes each assembled endpoint as
 * <outputDir>/<tag slugs...>/<stem>.endpoint.json.
 *
 * WHY THIS IS NOT PostmanOutputWriter:
 * The Postman writer groups by Postman folder path (WritableEndpoint.folderPath)
 * in Postman document order. This writer groups by resolved tag path
 * (OpenApiWritableEndpoint.tagPath) in operation document order, with `source`
 * serialized using type, spec_url ordering (no `collection`/`endpoint_id`).
 * The grouping input and the source field set differ, making a shared write()
 * method require a polymorphic strategy that adds more surface than a small
 * dedicated class.
 *
 * CANONICAL KEY ORDER (cross-reference):
 * The endpoint key order is identical to src/importers/postman/output-writer.ts
 * (CANONICAL_KEY_ORDER, REQUEST_KEY_ORDER, RESPONSE_KEY_ORDER, SOURCE_KEY_ORDER).
 * This re-declaration is a deliberate, bounded duplication of constant data —
 * NOT business logic. A unit test deep-equals these constants with the Postman
 * writer's constants so drift is caught by CI. The TSDoc cross-reference here
 * is the explicit design-mandated audit trail.
 */

import { join } from "node:path";

import type { CanonicalEndpoint } from "../../core/canonical-model.js";
import { NodeImporterFileSystem } from "../fs-seam.js";
import { PathNamer } from "../postman/path-naming.js";
import type { ImporterFileSystem } from "../types.js";

import type { OpenApiWritableEndpoint, OutputWriteResult } from "./types.js";

/**
 * Canonical field order for CanonicalEndpoint serialization.
 * Cross-reference: src/importers/postman/output-writer.ts#CANONICAL_KEY_ORDER.
 * Kept identical so re-import across importers is diff-clean.
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
 * Cross-reference: src/importers/postman/output-writer.ts#REQUEST_KEY_ORDER.
 */
const REQUEST_KEY_ORDER: readonly string[] = [
  "headers",
  "body_schema",
  "body_example",
  "query_params",
];

/**
 * Canonical field order for nested response object.
 * Cross-reference: src/importers/postman/output-writer.ts#RESPONSE_KEY_ORDER.
 */
const RESPONSE_KEY_ORDER: readonly string[] = [
  "expected_status",
  "schema",
  "headers",
  "sla_ms",
];

/**
 * Canonical field order for nested source object.
 * OpenAPI source uses `type, spec_url` ordering (no `collection`/`endpoint_id`).
 * Cross-reference: src/importers/postman/output-writer.ts#SOURCE_KEY_ORDER.
 */
const SOURCE_KEY_ORDER: readonly string[] = [
  "type",
  "collection",
  "endpoint_id",
  "spec_url",
];

/** Fallback stem when endpoint name produces an empty slug. */
const UNNAMED_STEM = "unnamed";

/** Options for OpenApiOutputWriter. */
export interface OpenApiOutputWriterOptions {
  /** Write-capable FS seam. Default: new NodeImporterFileSystem(). */
  fs?: ImporterFileSystem;
  /** Shared namer. Default: new PathNamer(). */
  namer?: PathNamer;
}

/**
 * Writes each endpoint as <outputDir>/<tag slugs.../><stem>.endpoint.json,
 * creating mirror directories. Collisions disambiguated deterministically.
 * Never throws on a name collision.
 *
 * Uses the identical canonical key order as PostmanOutputWriter (cross-reference
 * above) for diff-clean re-import across importers.
 */
export class OpenApiOutputWriter {
  readonly #fs: ImporterFileSystem;
  readonly #namer: PathNamer;

  /**
   * Constructs the writer with optional injectable seams.
   * @param options - Optional configuration.
   * @param options.fs - Injectable FS seam; defaults to NodeImporterFileSystem.
   * @param options.namer - Injectable path namer; defaults to PathNamer.
   */
  constructor(options?: OpenApiOutputWriterOptions) {
    this.#fs = options?.fs ?? new NodeImporterFileSystem();
    this.#namer = options?.namer ?? new PathNamer();
  }

  /**
   * Writes each endpoint as <outputDir>/<tag slugs.../><stem>.endpoint.json,
   * creating mirror directories. Collisions disambiguated deterministically.
   * Never throws on a name collision.
   * @param items - Endpoints with their tag paths, document order.
   * @param outputDir - Destination root directory.
   * @returns Count written plus rename warnings.
   */
  write(
    items: readonly OpenApiWritableEndpoint[],
    outputDir: string,
  ): OutputWriteResult {
    const warnings: string[] = [];
    let written = 0;
    const usedPaths = new Set<string>();

    for (const item of items) {
      const segments = item.tagPath.map((s) => this.#namer.toPathSegment(s));
      const dir = segments.length > 0 ? join(outputDir, ...segments) : outputDir;

      const rawStem = item.endpoint.name
        ? this.#namer.toPathSegment(item.endpoint.name)
        : UNNAMED_STEM;
      const stem = rawStem !== "" ? rawStem : UNNAMED_STEM;

      const candidatePath = join(dir, `${stem}.endpoint.json`);

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
   * Returns a new object with keys in the specified order, remaining
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
    for (const key of keyOrder) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        result[key] = obj[key];
      }
    }
    const knownSet = new Set(keyOrder);
    const remaining = Object.keys(obj)
      .filter((k) => !knownSet.has(k))
      .sort();
    for (const key of remaining) {
      result[key] = obj[key];
    }
    return result;
  }
}
