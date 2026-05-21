/**
 * Recursive filesystem walker for the §9 Test Runner discovery phase
 * (V1_BUILD_SPEC.md §9 lines 607–608). Walks the configured tests directory
 * to any depth and yields paths to `*.endpoint.json` files.
 *
 * `*.flow.json` files are intentionally skipped — they are reserved for v1.5
 * E2E flows (`CanonicalFlow` exists as a v1.5-reserved type in
 * `src/core/canonical-model.ts`; no runner generates or executes them in v1.0).
 * All other files are silently ignored so QAs can keep notes, fixtures,
 * schemas, and READMEs alongside their tests without confusing the loader.
 *
 * Filesystem access is mediated by a small interface so tests can inject a
 * fake without touching the real disk.
 */

import { readdir } from "node:fs/promises";
import { join } from "node:path";

/** Suffix matched against the path basename for endpoint files. */
const ENDPOINT_SUFFIX = ".endpoint.json";
/** Suffix matched against the path basename for v1.5-reserved flow files. */
const FLOW_SUFFIX = ".flow.json";
/** Maximum recursion depth — defensive cap to prevent runaway symlinks. */
export const MAX_WALK_DEPTH = 32;

/**
 * Minimal filesystem seam consumed by {@link discoverEndpointFiles}. Tests
 * inject a fake implementation backed by an in-memory tree.
 */
export interface DirReaderSeam {
  /**
   * Returns the entries inside `dir` — each entry carries its base name and
   * whether it is a subdirectory.
   * @param dir - Absolute or repo-relative directory path.
   * @returns Promise resolving to the entries inside `dir`.
   */
  readdir(dir: string): Promise<readonly DirEntry[]>;
}

/** One filesystem entry (file or directory). */
export interface DirEntry {
  /** The base name (last path segment). */
  readonly name: string;
  /** True iff the entry is a subdirectory. */
  readonly isDirectory: boolean;
}

/**
 * The default DirReaderSeam backed by Node's `fs.promises.readdir`.
 * @returns A {@link DirReaderSeam} that reads from the real filesystem.
 */
export function createDefaultDirReaderSeam(): DirReaderSeam {
  return {
    async readdir(dir: string): Promise<readonly DirEntry[]> {
      const entries = await readdir(dir, { withFileTypes: true });
      return entries.map((e) => ({ name: e.name, isDirectory: e.isDirectory() }));
    },
  };
}

/**
 * Recursively walks `rootDir` and returns paths to every `*.endpoint.json`.
 *
 * Walks in deterministic alphabetical order at each directory level (so the
 * resulting plan is stable across runs and across machines — required for
 * shard correctness per §9 line 640).
 *
 * `*.flow.json` files are skipped silently. All other non-matching files are
 * also skipped silently. Walk depth is capped at {@link MAX_WALK_DEPTH} to
 * defend against symlink cycles.
 * @param rootDir - The repo-relative or absolute root to walk.
 * @param seam - Filesystem seam; defaults to the real-fs implementation.
 * @returns Sorted list of repo-paths to endpoint JSON files.
 */
export async function discoverEndpointFiles(
  rootDir: string,
  seam: DirReaderSeam = createDefaultDirReaderSeam(),
): Promise<readonly string[]> {
  const results: string[] = [];
  await walkInternal(rootDir, seam, results, 0);
  return results.sort();
}

/**
 * Internal recursive walker. Mutates `results` so callers don't need to merge.
 * @param dir - Current directory being walked.
 * @param seam - Filesystem seam.
 * @param results - Accumulator for matching paths.
 * @param depth - Current recursion depth (0 at root).
 */
async function walkInternal(
  dir: string,
  seam: DirReaderSeam,
  results: string[],
  depth: number,
): Promise<void> {
  if (depth > MAX_WALK_DEPTH) return;
  const entries = await seam.readdir(dir);
  const sorted = [...entries].sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of sorted) {
    const path = join(dir, entry.name);
    if (entry.isDirectory) {
      await walkInternal(path, seam, results, depth + 1);
    } else if (entry.name.endsWith(ENDPOINT_SUFFIX)) {
      results.push(path);
    }
    // entry.name.endsWith(FLOW_SUFFIX) — silently skipped (v1.5 reserved).
    // Any other file — silently skipped (notes, fixtures, READMEs).
  }
}

/**
 * Re-exported for downstream consumers and tests that want to know which
 * suffix the discovery layer treats as the v1.5-reserved flow file.
 */
export const RESERVED_FLOW_SUFFIX = FLOW_SUFFIX;
