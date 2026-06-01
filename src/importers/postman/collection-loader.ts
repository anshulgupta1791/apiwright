/**
 * Postman collection loader: reads, JSON-parses, and shape-checks a
 * Postman v2.1 collection file from disk.
 *
 * Uses parseJson (the single audited JSON parse boundary) and the write-
 * capable ImporterFileSystem seam so no real disk is required in tests.
 * Never throws for bad user input — returns a discriminated result instead.
 *
 * NOTE on the SDK removal (Lens 0 audit blocker B13): an earlier version
 * of this file hydrated the parsed JSON with the `postman-collection` npm
 * SDK to gain typed traversal. That SDK transitively depended on
 * lodash<=4.17.23 (high vuln) and uuid<11.1.1 (moderate vuln), and our
 * `overrides` block didn't propagate to consumers of the published
 * tarball — so every user saw the warnings on `npm install`. The SDK was
 * dropped in favor of an in-house typed walk against the raw JSON (see
 * `v2-schema.ts`). The hydration step is gone; this loader now just
 * validates shape and returns the parsed object.
 */

import { basename } from "node:path";

import { parseJson } from "../../core/safe-json.js";
import { NodeImporterFileSystem } from "../fs-seam.js";
import type {
  CollectionLoadResult,
  ImporterFileSystem,
  ImporterFsError,
} from "../types.js";

import type { PostmanV21Collection } from "./v2-schema.js";

/** Options for PostmanCollectionLoader. */
export interface PostmanCollectionLoaderOptions {
  /** Write-capable FS seam. Default: new NodeImporterFileSystem(). */
  fs?: ImporterFileSystem;
}

/**
 * Reads and validates a Postman v2.1 collection file.
 *
 * Load algorithm (ordered, fail-soft):
 * 1. Read file via FS seam; tagged ImporterFsError → typed failure.
 * 2. Parse JSON via parseJson (never raw JSON.parse); parse failure → typed failure.
 * 3. Shape gate: must contain info.schema with "v2.1.0" substring AND
 *    an `item` array at the root (a v2.1 collection without items is
 *    technically valid JSON but degenerate for our import purposes).
 * 4. Return ok:true with the parsed collection as `LoadedCollection.parsed`.
 */
export class PostmanCollectionLoader {
  readonly #fs: ImporterFileSystem;

  /**
   * Constructs a PostmanCollectionLoader with an optional injectable FS seam.
   * @param options - Optional configuration.
   * @param options.fs - Injectable FS seam; defaults to NodeImporterFileSystem.
   */
  constructor(options?: PostmanCollectionLoaderOptions) {
    this.#fs = options?.fs ?? new NodeImporterFileSystem();
  }

  /**
   * Reads, JSON-parses, and shape-checks a Postman v2.1 collection file.
   * Never throws for bad input — returns a discriminated failure instead.
   * @param file - Path to the collection file.
   * @returns A CollectionLoadResult (ok:true with collection, or ok:false with error).
   */
  load(file: string): CollectionLoadResult {
    // Step 1: Read the file
    let raw: string;
    try {
      raw = this.#fs.readFile(file);
    } catch (err: unknown) {
      const fsErr = err as ImporterFsError;
      return {
        ok: false,
        error: `Cannot read collection file '${file}': ${fsErr.code}`,
      };
    }

    // Step 2: Parse JSON via the single audited boundary
    const parseResult = parseJson(raw);
    if (!parseResult.ok) {
      return {
        ok: false,
        error: `Invalid JSON in '${file}': ${parseResult.error}`,
      };
    }

    // Step 3: Shape gate — must be a v2.1 collection
    const parsed = parseResult.value;
    if (!this.#isV21Collection(parsed)) {
      return {
        ok: false,
        error: `'${file}' is not a recognizable Postman v2.1 collection`,
      };
    }

    // Step 4: Normalize the item array — older exports may omit it.
    // A missing `item` array is a degenerate but technically-valid v2.1
    // collection; we default to [] so the flattener walks zero requests
    // and emits the file-level "no requests imported" outcome rather than
    // failing the load.
    const normalized: PostmanV21Collection = {
      ...parsed,
      item: Array.isArray(parsed.item) ? parsed.item : [],
    };

    return {
      ok: true,
      collection: {
        parsed: normalized,
        fileBasename: basename(file),
      },
    };
  }

  /**
   * Checks whether the parsed value matches the Postman v2.1 collection shape.
   * @param value - The parsed JSON value to check.
   * @returns True when the value is a recognizable v2.1 collection.
   */
  #isV21Collection(value: unknown): value is PostmanV21Collection {
    if (typeof value !== "object" || value === null) {
      return false;
    }
    const obj = value as Record<string, unknown>;
    if (typeof obj["info"] !== "object" || obj["info"] === null) {
      return false;
    }
    const info = obj["info"] as Record<string, unknown>;
    if (typeof info["schema"] !== "string") {
      return false;
    }
    return info["schema"].includes("v2.1.0");
  }
}
