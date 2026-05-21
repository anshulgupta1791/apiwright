/**
 * Incremental JSONL sidecar for the §9 runner.
 *
 * The full JSON sidecar (`run-<ts>.json`) is emitted at the end of a run.
 * If the process dies mid-run (OOM, native crash, SIGKILL), that file is
 * never written and the user loses all in-flight results. To survive
 * those catastrophic failure modes — the ones a single-process design
 * cannot otherwise survive — this emitter appends one JSON-Lines entry
 * per completed endpoint to `run-<ts>.partial.jsonl`.
 *
 * Lifecycle:
 *   1. {@link createPartialEmitter} opens the file (or creates the dir).
 *   2. {@link PartialEmitter.append} writes one redacted EndpointResult
 *      line as soon as that endpoint finishes. The line is flushed
 *      immediately so an abrupt process exit preserves it.
 *   3. {@link PartialEmitter.finalize} (called on graceful run end)
 *      deletes the file — the full JSON sidecar replaces it.
 *   4. On crash, the file remains on disk. Users post-mortem with
 *      `cat run-<ts>.partial.jsonl | jq .` to see what completed before
 *      the crash.
 *
 * Determinism: the JSONL emission order matches endpoint completion
 * order, not input order — this is intentional. The full JSON sidecar
 * still emits in deterministic input order; the partial file is
 * specifically for "what was actually done before the crash" forensics.
 *
 * Secret safety: every appended line is passed through `redactValue`
 * (same redaction the full sidecar uses) so leaked tokens never appear
 * on disk even in the partial-failure path.
 */

import { open, unlink, mkdir } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { dirname } from "node:path";

import type { SecretRegistry } from "../../env/index.js";
import { redactValue } from "../execute/redactor-pipe.js";
import type { EndpointResult } from "../types.js";

/** Public seam — the runner gets back this object after `createPartialEmitter`. */
export interface PartialEmitter {
  /**
   * Appends one JSON line to the partial sidecar. The argument is
   * redacted in place before serialisation.
   * @param result - One completed {@link EndpointResult}.
   */
  append(result: EndpointResult): Promise<void>;
  /**
   * Closes the underlying file handle and deletes the partial file.
   * Idempotent — safe to call from a `finally` block even on error
   * paths.
   */
  finalize(): Promise<void>;
}

/**
 * Opens (and `mkdir -p`'s the parent of) a JSONL sidecar for the run.
 * @param path - Absolute path to the partial JSONL file. Parent directory
 *   is created automatically.
 * @param secrets - The run-scoped SecretRegistry, used to redact every
 *   appended line.
 * @returns A {@link PartialEmitter} that appends lines and cleans up.
 */
export async function createPartialEmitter(
  path: string,
  secrets: SecretRegistry,
): Promise<PartialEmitter> {
  await mkdir(dirname(path), { recursive: true });
  const handle: FileHandle = await open(path, "w");

  let closed = false;

  return {
    async append(result: EndpointResult): Promise<void> {
      if (closed) return;
      const redacted = redactValue(result, secrets) as EndpointResult;
      // JSON-Lines: one minified record per line. Matches the existing
      // JSON sidecar's redact-then-serialise pattern (run-result-emitter.ts).
      const line = `${JSON.stringify(redacted)}\n`;
      await handle.write(line);
      // sync the buffer so an abrupt exit leaves the line on disk.
      await handle.sync();
    },
    async finalize(): Promise<void> {
      if (closed) return;
      closed = true;
      // Close the handle BEFORE unlink so the OS isn't asked to remove
      // an open file. Then drop the partial file — the full JSON sidecar
      // supersedes it on graceful exit.
      await handle.close();
      try {
        await unlink(path);
      } catch (e: unknown) {
        /* istanbul ignore next — only racey concurrent cleanup hits this;
           other unlink errors are surfaced for diagnosis. */
        if (!isFileNotFoundError(e)) throw e;
      }
    },
  };
}

/**
 * Narrows an unknown thrown value to a `ENOENT`-coded error.
 * @param e - The caught value.
 * @returns True iff `e` has `code === "ENOENT"`.
 */
function isFileNotFoundError(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    "code" in e &&
    e.code === "ENOENT"
  );
}
