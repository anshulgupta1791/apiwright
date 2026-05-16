/**
 * Filesystem seam for the CLI module.
 *
 * Provides a `FileSystem` interface and a `NodeFileSystem` implementation
 * using Node's synchronous fs API. Both `ConfigLoader` and `ValidateCommand`
 * depend on this interface, keeping them testable without real disk I/O.
 */

import { statSync, readFileSync, readdirSync } from "node:fs";

/** Tagged error thrown by {@link NodeFileSystem.readFile} on failure. */
export interface FsError extends Error {
  /** Categorized error code for caller branching. */
  code: "ENOENT" | "EACCES" | "EISDIR" | "UNKNOWN";
}

/**
 * Filesystem abstraction for the CLI module.
 *
 * All methods are synchronous (matching the synchronous config / validate
 * pipelines). Tests inject a fake implementation to avoid real disk access.
 */
export interface FileSystem {
  /**
   * Reads a UTF-8 file. Throws a tagged {@link FsError} on failure.
   * @param path - Absolute file path.
   * @returns The file contents as a string.
   */
  readFile(path: string): string;

  /**
   * Returns true if the path exists and is a regular file.
   * @param path - Path to check.
   */
  fileExists(path: string): boolean;

  /**
   * Returns true if the path exists and is a directory.
   * @param path - Path to check.
   */
  dirExists(path: string): boolean;

  /**
   * Recursively lists all regular file paths under `dir`. Directories are
   * not included in the result.
   * @param dir - Root directory to walk.
   * @returns Absolute paths to all regular files found, in discovery order.
   */
  walk(dir: string): string[];
}

/**
 * Production `FileSystem` implementation backed by Node's synchronous `fs`
 * module. Errors from `readFileSync` are caught and re-thrown as tagged
 * {@link FsError} values so callers can branch on the cause.
 */
export class NodeFileSystem implements FileSystem {
  /**
   * Reads a UTF-8 file and returns its contents.
   * @param path - Absolute file path.
   * @returns The file contents as a string.
   * @throws FsError with code ENOENT|EACCES|EISDIR|UNKNOWN on failure.
   */
  readFile(path: string): string {
    try {
      return readFileSync(path, "utf8");
    } catch (err: unknown) {
      const nodeErr = err as { code?: string };
      const code = nodeErr.code;
      /* istanbul ignore next — EACCES and UNKNOWN branches require OS-specific conditions */
      const fsCode: FsError["code"] =
        code === "ENOENT"
          ? "ENOENT"
          : code === "EACCES"
            ? "EACCES"
            : code === "EISDIR"
              ? "EISDIR"
              : "UNKNOWN";
      const tagged = new Error(`readFile failed: ${path}`) as FsError;
      tagged.code = fsCode;
      throw tagged;
    }
  }

  /**
   * Returns true if the path exists and is a regular file.
   * @param path - Path to test.
   * @returns True if the path is a regular file; false otherwise.
   */
  fileExists(path: string): boolean {
    try {
      return statSync(path).isFile();
    } catch {
      return false;
    }
  }

  /**
   * Returns true if the path exists and is a directory.
   * @param path - Path to test.
   * @returns True if the path is a directory; false otherwise.
   */
  dirExists(path: string): boolean {
    try {
      return statSync(path).isDirectory();
    } catch {
      return false;
    }
  }

  /**
   * Recursively walks a directory and returns all regular file paths.
   * @param dir - Root directory to walk.
   * @returns Absolute paths to all regular files in document order.
   */
  walk(dir: string): string[] {
    const results: string[] = [];
    this.#walkRecursive(dir, results);
    return results;
  }

  /**
   * Internal recursive walker.
   * @param current - Current directory being walked.
   * @param acc - Accumulator for file paths.
   */
  #walkRecursive(current: string, acc: string[]): void {
    let entries: {
      name: string;
      isDirectory: () => boolean;
      isFile: () => boolean;
    }[];
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch /* istanbul ignore next — permission errors are OS-specific */ {
      return;
    }
    for (const entry of entries) {
      const fullPath = `${current}/${entry.name}`;
      if (entry.isDirectory()) {
        this.#walkRecursive(fullPath, acc);
      } else if (entry.isFile()) {
        acc.push(fullPath);
      }
      /* istanbul ignore next — symlinks/special files fall through silently */
    }
  }
}
