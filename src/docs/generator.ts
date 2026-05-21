/**
 * `MarkdownDocsGenerator` — orchestrator class that satisfies the frozen
 * {@link DocsGenerator} interface (`src/cli/seams/docs-generator.ts`).
 *
 * Walks `sourceDir` recursively for `*.endpoint.json` files, validates
 * each against the canonical meta-schema (Task #1 `SchemaValidator`),
 * composes a deterministic Markdown document per endpoint via
 * {@link composeMarkdown}, and writes each as `<endpoint.id>.md` under
 * `outputDir`. Returns `{ written: N }`.
 *
 * Determinism (spec §11 line 716): the walk sorts entries alphabetically;
 * the section order is fixed; every renderer is pure. Two consecutive
 * runs against the same inputs produce byte-identical output and
 * byte-identical file names. Safe to commit to git and diff in PRs.
 */

import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { CanonicalEndpoint } from "../core/canonical-model.js";
import { parseJson, SchemaValidator } from "../core/index.js";

import { composeMarkdown } from "./composer.js";
import { DOCS_ERROR_CODES, DocsError } from "./errors.js";
import type { DocsEndpointRecord, DocsGenerator, DocsOutcome } from "./types.js";

/** Suffix matched against the path basename for endpoint files. */
const ENDPOINT_SUFFIX = ".endpoint.json";
/** Maximum recursion depth (defends against symlink cycles). */
export const MAX_DOCS_WALK_DEPTH = 32;

/** Minimal directory-reader seam (mirrors `src/runner/discovery/walker.ts`). */
export interface DocsDirReaderSeam {
  /**
   * Returns the entries inside `dir` — each entry carries its base name
   * and whether it is a subdirectory.
   * @param dir - Absolute or repo-relative directory path.
   * @returns Entry list.
   */
  readdir(dir: string): Promise<readonly DocsDirEntry[]>;
}

/** One filesystem entry (file or directory) returned by {@link DocsDirReaderSeam}. */
export interface DocsDirEntry {
  /** The base name (last path segment). */
  readonly name: string;
  /** True iff the entry is a subdirectory. */
  readonly isDirectory: boolean;
}

/** Minimal file-reader seam. */
export interface DocsFileReaderSeam {
  /**
   * Returns the UTF-8 contents of `path`.
   * @param path - Absolute or repo-relative file path.
   * @returns The file contents.
   */
  readFile(path: string): Promise<string>;
}

/** Minimal file-writer seam. */
export interface DocsFileWriterSeam {
  /**
   * Ensures `dir` exists (recursive).
   * @param dir - Directory path.
   */
  mkdir(dir: string): Promise<void>;
  /**
   * Writes `contents` as UTF-8 to `path`.
   * @param path - File path.
   * @param contents - File contents.
   */
  writeFile(path: string, contents: string): Promise<void>;
}

/** Constructor options for {@link MarkdownDocsGenerator}. */
export interface MarkdownDocsGeneratorOptions {
  /** Optional dir-reader seam (defaults to `node:fs/promises.readdir`). */
  readonly dirReader?: DocsDirReaderSeam;
  /** Optional file-reader seam (defaults to `node:fs/promises.readFile`). */
  readonly fileReader?: DocsFileReaderSeam;
  /** Optional file-writer seam (defaults to `node:fs/promises.{mkdir,writeFile}`). */
  readonly fileWriter?: DocsFileWriterSeam;
  /** Optional shared `SchemaValidator` (defaults to a fresh instance). */
  readonly schemaValidator?: SchemaValidator;
}

/**
 * The §11 Markdown documentation generator.
 */
export class MarkdownDocsGenerator implements DocsGenerator {
  readonly #dirReader: DocsDirReaderSeam;
  readonly #fileReader: DocsFileReaderSeam;
  readonly #fileWriter: DocsFileWriterSeam;
  readonly #validator: SchemaValidator;

  /**
   * Constructs a {@link MarkdownDocsGenerator} with optional seams.
   * @param opts - Optional injectable collaborators.
   */
  constructor(opts: MarkdownDocsGeneratorOptions = {}) {
    this.#dirReader = opts.dirReader ?? defaultDirReader();
    this.#fileReader = opts.fileReader ?? defaultFileReader();
    this.#fileWriter = opts.fileWriter ?? defaultFileWriter();
    this.#validator = opts.schemaValidator ?? new SchemaValidator();
  }

  /**
   * Generates per-endpoint Markdown documentation.
   * @param input - Generation parameters.
   * @param input.sourceDir - Recursively walked for `*.endpoint.json`.
   * @param input.outputDir - Destination for `<endpoint.id>.md` files.
   * @returns Outcome containing `written` count.
   * @throws {DocsError} `DOCS_SOURCE_DIR_EMPTY` when no endpoint files
   *   are found; `DOCS_ENDPOINT_LOAD_FAILED` when any file fails to
   *   load/validate; `DOCS_WRITE_FAILED` when any write fails;
   *   `DOCS_RENDER_FAILED` if composing produces an empty string
   *   (should never happen — defensive).
   */
  async generate(input: { sourceDir: string; outputDir: string }): Promise<DocsOutcome> {
    const paths = await this.#discover(input.sourceDir);
    if (paths.length === 0) {
      throw new DocsError({
        code: DOCS_ERROR_CODES.DOCS_SOURCE_DIR_EMPTY,
        phase: "discovery",
        message: `No '*.endpoint.json' files found under '${input.sourceDir}'.`,
      });
    }

    const records = await this.#loadAll(paths);

    try {
      await this.#fileWriter.mkdir(input.outputDir);
    } catch (cause: unknown) {
      throw new DocsError({
        code: DOCS_ERROR_CODES.DOCS_WRITE_FAILED,
        phase: "write",
        message: `Failed to create output directory '${input.outputDir}'.`,
        cause,
      });
    }

    let written = 0;
    for (const record of records) {
      const md = composeMarkdown({ endpoint: record.endpoint, sourcePath: record.sourcePath });
      /* istanbul ignore next — composeMarkdown is pure and always returns
         a non-empty string for any valid CanonicalEndpoint. Defensive guard
         to satisfy the DOCS_RENDER_FAILED contract. */
      if (md.length === 0) {
        throw new DocsError({
          code: DOCS_ERROR_CODES.DOCS_RENDER_FAILED,
          phase: "render",
          message: `Composer produced empty output for '${record.endpoint.id}'.`,
        });
      }
      const targetPath = join(input.outputDir, `${record.endpoint.id}.md`);
      try {
        await this.#fileWriter.writeFile(targetPath, md);
        written++;
      } catch (cause: unknown) {
        throw new DocsError({
          code: DOCS_ERROR_CODES.DOCS_WRITE_FAILED,
          phase: "write",
          message: `Failed to write '${targetPath}'.`,
          cause,
        });
      }
    }
    return { written };
  }

  /**
   * Recursively walks `rootDir` returning sorted `.endpoint.json` paths.
   * @param rootDir - Walk root.
   * @returns Sorted endpoint paths.
   */
  async #discover(rootDir: string): Promise<readonly string[]> {
    const out: string[] = [];
    await walkInto(rootDir, out, 0, this.#dirReader);
    return out.sort();
  }

  /**
   * Loads + validates each endpoint path. Aggregates ALL failures before
   * throwing — gives the user the full picture in one shot.
   * @param paths - Endpoint file paths.
   * @returns Loaded records sorted by `endpoint.id`.
   * @throws {DocsError} `DOCS_ENDPOINT_LOAD_FAILED` on any failure.
   */
  async #loadAll(paths: readonly string[]): Promise<readonly DocsEndpointRecord[]> {
    const records: DocsEndpointRecord[] = [];
    const errors: string[] = [];
    for (const path of paths) {
      const r = await this.#loadOne(path, errors);
      if (r) records.push(r);
    }
    if (errors.length > 0) {
      throw new DocsError({
        code: DOCS_ERROR_CODES.DOCS_ENDPOINT_LOAD_FAILED,
        phase: "load",
        message: `Endpoint validation failed (${errors.length} file(s)):\n${errors.join("\n")}`,
      });
    }
    records.sort((a, b) => a.endpoint.id.localeCompare(b.endpoint.id));
    return records;
  }

  /**
   * Loads and validates one endpoint file.
   * @param path - File path.
   * @param errors - Mutable error accumulator.
   * @returns A loaded record on success, null on failure.
   */
  async #loadOne(path: string, errors: string[]): Promise<DocsEndpointRecord | null> {
    let raw: string;
    try {
      raw = await this.#fileReader.readFile(path);
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
    const valid = this.#validator.validateEndpoint(parsed.value);
    if (!valid.valid) {
      /* istanbul ignore next — SchemaValidator always returns errors[] on
         valid:false; ?? [] is a TypeScript-strict defensive default. */
      const detail = (valid.errors ?? []).map((m) => `      ${m}`).join("\n");
      errors.push(`  - '${path}': schema validation failed:\n${detail}`);
      return null;
    }
    return { sourcePath: path, endpoint: parsed.value as CanonicalEndpoint };
  }
}

/**
 * Recursive walker — alphabetical sort at each level for deterministic
 * order. Mutates `out`.
 * @param dir - Current directory.
 * @param out - Accumulator for matching paths.
 * @param depth - Current recursion depth.
 * @param reader - The dir-reader seam.
 */
async function walkInto(
  dir: string,
  out: string[],
  depth: number,
  reader: DocsDirReaderSeam,
): Promise<void> {
  if (depth > MAX_DOCS_WALK_DEPTH) return;
  const entries = await reader.readdir(dir);
  const sorted = [...entries].sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of sorted) {
    const p = join(dir, entry.name);
    if (entry.isDirectory) {
      await walkInto(p, out, depth + 1, reader);
    } else if (entry.name.endsWith(ENDPOINT_SUFFIX)) {
      out.push(p);
    }
  }
}

/**
 * Default dir-reader backed by `node:fs/promises.readdir`.
 * @returns A {@link DocsDirReaderSeam} that reads from the real filesystem.
 */
function defaultDirReader(): DocsDirReaderSeam {
  return {
    async readdir(dir: string) {
      const entries = await readdir(dir, { withFileTypes: true });
      return entries.map((e) => ({ name: e.name, isDirectory: e.isDirectory() }));
    },
  };
}

/**
 * Default file-reader backed by `node:fs/promises.readFile`.
 * @returns A {@link DocsFileReaderSeam} that reads from the real filesystem.
 */
function defaultFileReader(): DocsFileReaderSeam {
  return {
    async readFile(path: string) {
      return readFile(path, "utf8");
    },
  };
}

/**
 * Default file-writer backed by `node:fs/promises.{mkdir,writeFile}`.
 * @returns A {@link DocsFileWriterSeam} that writes to the real filesystem.
 */
function defaultFileWriter(): DocsFileWriterSeam {
  return {
    async mkdir(dir: string) {
      await mkdir(dir, { recursive: true });
    },
    async writeFile(path: string, contents: string) {
      await writeFile(path, contents, "utf8");
    },
  };
}
