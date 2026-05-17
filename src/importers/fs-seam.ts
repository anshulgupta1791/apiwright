/**
 * Write-capable filesystem seam for the importer pipeline.
 *
 * A separate seam from src/cli/fs-seam.ts because the CLI seam is read-only
 * by contract. This seam adds mkdirp and writeFile to support the output
 * writer stage. All disk access in the importer pipeline goes through this
 * interface so tests can inject an in-memory fake.
 */

import * as nodeFs from "node:fs";

import type {
  ImporterFileSystem,
  ImporterFsError,
  ImporterFsErrorCode,
} from "./types.js";

/**
 * Node.js filesystem implementation of the write-capable importer seam.
 *
 * readFile mirrors src/cli/fs-seam.ts error-code mapping exactly.
 * mkdirp uses recursive:true for idempotent directory creation.
 * writeFile uses synchronous UTF-8 writes.
 */
export class NodeImporterFileSystem implements ImporterFileSystem {
  /**
   * Reads a UTF-8 text file synchronously.
   * @param path - Absolute path to the file to read.
   * @returns File contents as a string.
   * @throws ImporterFsError with code ENOENT | EACCES | EISDIR | UNKNOWN.
   */
  readFile(path: string): string {
    try {
      return nodeFs.readFileSync(path, "utf8");
    } catch (err: unknown) {
      const rawCode =
        err !== null && typeof err === "object" && "code" in err
          ? (err as Record<string, unknown>)["code"]
          : undefined;

      const code: ImporterFsErrorCode =
        rawCode === "ENOENT"
          ? "ENOENT"
          : rawCode === "EISDIR"
            ? "EISDIR"
            : /* istanbul ignore next — OS-specific errno */ rawCode ===
                "EACCES"
              ? "EACCES"
              : /* istanbul ignore next — OS-specific errno */ "UNKNOWN";

      const fsErr = new Error(`readFile failed: ${path}`) as ImporterFsError;
      fsErr.code = code;
      throw fsErr;
    }
  }

  /**
   * Creates a directory and all intermediate directories (mkdir -p semantics).
   * @param dir - Absolute path to the directory to create.
   */
  mkdirp(dir: string): void {
    nodeFs.mkdirSync(dir, { recursive: true });
  }

  /**
   * Writes UTF-8 content to a file, overwriting any existing content.
   * @param path - Absolute path to the file to write.
   * @param contents - UTF-8 content to write.
   */
  writeFile(path: string, contents: string): void {
    nodeFs.writeFileSync(path, contents, "utf8");
  }
}
