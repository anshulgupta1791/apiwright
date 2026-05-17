/**
 * Postman collection loader: reads, JSON-parses, shape-checks, and
 * SDK-hydrates a Postman v2.1 collection file from disk.
 *
 * Uses parseJson (the single audited JSON parse boundary) and the write-
 * capable ImporterFileSystem seam so no real disk is required in tests.
 * Never throws for bad user input — returns a discriminated result instead.
 */

import { basename } from "node:path";

import { Collection } from "postman-collection";

import { parseJson } from "../../core/safe-json.js";
import { NodeImporterFileSystem } from "../fs-seam.js";
import type {
  CollectionLoadResult,
  ImporterFileSystem,
  ImporterFsError,
} from "../types.js";

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
 * 3. Shape gate: must contain info.schema with "v2.1.0" substring.
 * 4. Hydrate with postman-collection SDK; SDK throws → typed failure.
 * 5. Return ok:true with LoadedCollection.
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
   * Reads, JSON-parses, shape-checks, and SDK-hydrates a Postman v2.1
   * collection file. Never throws for bad input — returns a discriminated
   * failure instead.
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

    // Step 4: SDK hydration
    try {
      const sdk = new Collection(parsed);
      return {
        ok: true,
        collection: { sdk, fileBasename: basename(file), rawParsed: parsed },
      };
      /* istanbul ignore next — SDK only throws on corrupt collections */
    } catch (err: unknown) {
      /* istanbul ignore next — defensive guard; SDK always throws Error instances */
      const message = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        error: `Failed to hydrate Postman collection '${file}': ${message}`,
      };
    }
  }

  /**
   * Checks whether the parsed value matches the Postman v2.1 collection shape.
   * @param value - The parsed JSON value to check.
   * @returns True when the value is a recognizable v2.1 collection.
   */
  #isV21Collection(value: unknown): value is Record<string, unknown> {
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
