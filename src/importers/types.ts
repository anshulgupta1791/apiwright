/**
 * Internal types for the Postman importer pipeline.
 *
 * This file is coverage-exempt (named types.ts per design). No executable
 * logic lives here — only type declarations and interfaces.
 */

import type { CanonicalEndpoint } from "../core/canonical-model.js";

/** Categorized FS error code, mirroring src/cli/fs-seam.ts conventions. */
export type ImporterFsErrorCode = "ENOENT" | "EACCES" | "EISDIR" | "UNKNOWN";

/** Tagged error thrown by ImporterFileSystem.readFile on failure. */
export interface ImporterFsError extends Error {
  /** Categorized error code for caller branching. */
  code: ImporterFsErrorCode;
}

/**
 * Write-capable filesystem abstraction for the importer pipeline.
 *
 * Distinct from the read-only src/cli FileSystem seam. All importer disk
 * access flows through this so the pipeline is fully testable with an
 * in-memory fake (no real disk; supports the 95% coverage gate).
 */
export interface ImporterFileSystem {
  /**
   * Reads a UTF-8 file. Throws a tagged {@link ImporterFsError} on failure.
   * @param path - Absolute file path.
   * @returns The file contents as a string.
   */
  readFile(path: string): string;

  /**
   * Recursively creates a directory (mkdir -p semantics). Idempotent: an
   * already-existing directory is not an error.
   * @param dir - Absolute directory path.
   */
  mkdirp(dir: string): void;

  /**
   * Writes UTF-8 contents to a file, overwriting if present. The parent
   * directory must already exist (callers call mkdirp first).
   * @param path - Absolute file path.
   * @param contents - UTF-8 file contents.
   */
  writeFile(path: string, contents: string): void;
}

/** One ordered request flattened out of the Postman item tree. */
export interface FlattenedRequest {
  /** Stable id source: Postman item id when present, else "". */
  postmanId: string;
  /** Display name (Postman item name); may be "". */
  name: string;
  /** Ordered folder-path segments from root to parent; [] at root. */
  folderPath: string[];
  /** Raw Postman method string (e.g. "POST"); may be "" or unknown. */
  method: string;
  /** Raw URL string with Postman {{var}} tokens intact. */
  rawUrl: string;
  /** Header lines in document order (templating not yet applied). */
  headers: FlattenedHeader[];
  /** Raw request body, mode-tagged; undefined when no body. */
  body?: FlattenedBody;
  /** Query parameters in document order. */
  query: FlattenedQueryParam[];
  /** Pre-request script text joined by "\n"; "" when absent. */
  preRequestScript: string;
  /** Request-level auth block, or undefined when none. */
  auth?: FlattenedAuth;
  /** Saved/example responses in document order. */
  responses: FlattenedResponse[];
  /** True when the Postman item is disabled. */
  disabled: boolean;
  /** Variables in scope (collection + folder + request), name→raw value. */
  variables: Record<string, string>;
}

/** A single Postman header line. */
export interface FlattenedHeader {
  /** Header name. */
  key: string;
  /** Header value (may contain {{var}} tokens). */
  value: string;
  /** True when the header line is disabled in Postman. */
  disabled: boolean;
}

/** A single Postman query parameter. */
export interface FlattenedQueryParam {
  /** Param name. */
  key: string;
  /** Param value (may contain {{var}} tokens); "" when valueless. */
  value: string;
  /** True when the param is disabled in Postman. */
  disabled: boolean;
}

/** Request body in its Postman raw form. */
export interface FlattenedBody {
  /** Postman body mode. */
  mode: string;
  /** Raw textual body for mode "raw"; "" otherwise. */
  raw: string;
}

/** Normalized request-level auth block. */
export interface FlattenedAuth {
  /** Postman auth type, e.g. "bearer" | "basic" | "apikey" | other. */
  type: string;
}

/** A Postman saved/example response. */
export interface FlattenedResponse {
  /** HTTP status code; 0 when absent/unparseable. */
  code: number;
  /** Raw response body string; "" when absent. */
  body: string;
}

/** Per-request conversion result. Endpoint absent ⇒ request was dropped. */
export interface ConversionResult {
  /** The assembled, schema-valid endpoint, or undefined when dropped. */
  endpoint?: CanonicalEndpoint;
  /** Human-readable warnings accumulated for this request. */
  warnings: string[];
}

/** Discriminated collection-load result. Never represents a thrown error. */
export type CollectionLoadResult =
  | { ok: true; collection: LoadedCollection }
  | { ok: false; error: string };

/** Hydrated, validated v2.1 collection plus derived metadata. */
export interface LoadedCollection {
  /** postman-collection SDK Collection instance (typed via @types). */
  sdk: import("postman-collection").Collection;
  /** Basename of the input file, for source.collection. */
  fileBasename: string;
  /**
   * Raw parsed JSON object from the collection file. Preserved so the
   * flattener can access folder-level variables, which the postman-collection
   * SDK v5 does not expose on the hydrated ItemGroup. This is the already-parsed
   * object (never raw text) — no second JSON.parse occurs.
   */
  rawParsed: Record<string, unknown>;
}
