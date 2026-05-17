/**
 * OpenApiSpecLoader: loads, validates, and dereferences an OpenAPI 3.x or
 * Swagger 2.0 spec from a file path or http(s) URL.
 *
 * Never throws for bad user input — returns a discriminated SpecLoadResult.
 * All external boundaries (swagger-parser, filesystem) are injected for
 * deterministic unit-testability with no real disk or network.
 */

import { basename } from "node:path";

import { NodeImporterFileSystem } from "../fs-seam.js";
import type { ImporterFileSystem } from "../types.js";

import { BaseUrlResolver } from "./base-url.js";
import { SpecAccess } from "./spec-access.js";
import { DefaultSwaggerParserSeam } from "./swagger-parser-seam.js";
import type { SpecLoadResult, SwaggerParserSeam } from "./types.js";

/** URL prefix pattern for distinguishing URLs from file paths. */
const URL_PATTERN = /^https?:\/\//i;

/** Options for OpenApiSpecLoader. */
export interface OpenApiSpecLoaderOptions {
  /** swagger-parser boundary. Default: new DefaultSwaggerParserSeam(). */
  parser?: SwaggerParserSeam;
  /**
   * FS seam (reused; default new NodeImporterFileSystem()) used only to
   * pre-check a local-file source exists for a precise error message.
   */
  fs?: ImporterFileSystem;
  /** Base-URL resolver. Default: new BaseUrlResolver(). */
  baseUrlResolver?: BaseUrlResolver;
}

/**
 * Loads, validates, and dereferences an OpenAPI 3.x or Swagger 2.0 spec
 * from a file path or http(s) URL.
 *
 * Never throws for bad user input. An unparseable / invalid / unreachable spec
 * produces `SpecLoadResult { ok: false, error: <descriptive message> }`. A
 * spec with circular `$ref` is bundled (internal refs kept as local pointers)
 * and flagged with `circular: true` plus a warning on the success arm.
 * All external I/O goes through injected seams for 100% unit test coverage.
 */
export class OpenApiSpecLoader {
  readonly #parser: SwaggerParserSeam;
  readonly #fs: ImporterFileSystem;
  readonly #baseUrlResolver: BaseUrlResolver;
  readonly #access: SpecAccess;

  /**
   * Constructs the loader with optional injectable seams.
   * @param options - Optional configuration.
   * @param options.parser - Injectable swagger-parser boundary; defaults to
   *   DefaultSwaggerParserSeam (real production wiring).
   * @param options.fs - Injectable FS seam; defaults to NodeImporterFileSystem.
   * @param options.baseUrlResolver - Injectable base-URL resolver; defaults to
   *   new BaseUrlResolver().
   */
  constructor(options?: OpenApiSpecLoaderOptions) {
    this.#parser = options?.parser ?? new DefaultSwaggerParserSeam();
    this.#fs = options?.fs ?? new NodeImporterFileSystem();
    this.#baseUrlResolver = options?.baseUrlResolver ?? new BaseUrlResolver();
    this.#access = new SpecAccess();
  }

  /**
   * Loads, validates, and dereferences a 3.x/2.0 spec from a file path or
   * http(s) URL. Never throws for bad input — returns a discriminated failure.
   * @param source - Absolute file path or http(s) URL to the spec.
   * @returns Discriminated load result: ok:true with LoadedSpec and warnings,
   *   or ok:false with a descriptive error string.
   */
  async load(source: string): Promise<SpecLoadResult> {
    const isUrl = URL_PATTERN.test(source);
    const sourceId = isUrl ? source : basename(source);

    if (!isUrl) {
      const fsCheck = this.#preCheckFile(source);
      if (fsCheck !== null) return { ok: false, error: fsCheck };
    }

    let doc: unknown;
    let circular = false;
    const warnings: string[] = [];

    try {
      doc = await this.#parser.dereference(source);
    } catch {
      // Circular $ref handling — retry with bundle.
      const bundleOutcome = await this.#tryBundle(source, sourceId, warnings);
      if (!bundleOutcome.ok) {
        return { ok: false, error: bundleOutcome.error };
      }
      doc = bundleOutcome.doc;
      circular = true;
    }

    const record = this.#access.asRecord(doc);
    const flavor = this.#access.detectFlavor(record);
    if (flavor === undefined) {
      return {
        ok: false,
        error: `Unrecognized spec: missing 'openapi' or 'swagger' version field`,
      };
    }

    const baseUrl = this.#baseUrlResolver.resolve(record, flavor);

    return {
      ok: true,
      spec: { document: record, flavor, baseUrl, sourceId, circular },
      warnings,
    };
  }

  /**
   * Attempts to bundle the spec when dereference fails (circular $ref fallback).
   * Returns the bundled document on success, an error string on parse failure,
   * or null when an unexpected error occurs.
   * @param source - The spec source path or URL.
   * @param sourceId - The display identifier for the spec.
   * @param warnings - Accumulator for the circular-ref warning.
   * @returns The bundled document, an error string, or null.
   */
  async #tryBundle(
    source: string,
    sourceId: string,
    warnings: string[],
  ): Promise<{ ok: true; doc: unknown } | { ok: false; error: string }> {
    try {
      const bundled = await this.#parser.bundle(source);
      warnings.push(
        `Spec '${sourceId}' contains a circular $ref; bundled instead of fully ` +
          `inlined (review affected schemas)`,
      );
      return { ok: true, doc: bundled };
    } catch (bundleErr) {
      const msg = bundleErr instanceof Error ? bundleErr.message : String(bundleErr);
      return { ok: false, error: `Failed to load OpenAPI/Swagger spec '${source}': ${msg}` };
    }
  }

  /**
   * Pre-checks that a local file path is readable, returning an error string
   * on failure or null on success. Only for non-URL sources.
   * @param path - The file path to check.
   * @returns An error string, or null when the file is accessible.
   */
  #preCheckFile(path: string): string | null {
    try {
      this.#fs.readFile(path);
      return null;
    } catch (err) {
      const errCode = this.#extractCode(err);
      if (errCode === "ENOENT") {
        return `OpenAPI spec file not found: '${path}'`;
      }
      return `Cannot read OpenAPI spec '${path}': ${errCode}`;
    }
  }

  /**
   * Extracts the `code` string from a caught error-like object.
   * Returns "UNKNOWN" when the object has no `code` property.
   * @param err - The caught error value.
   * @returns The code string.
   */
  #extractCode(err: unknown): string {
    if (err !== null && typeof err === "object" && "code" in err) {
      return String((err as Record<string, unknown>)["code"]);
    }
    return "UNKNOWN";
  }
}
