/**
 * Shared cross-engine driver seam utilities. Defines the injectable CJS loader
 * type (`DriverRequireFn`) and the shared `requireDriverOrThrow` helper that
 * centralizes the missing-driver to `DbConnectorError` mapping in one audited,
 * secret-safe location. All four per-engine seam factories import from here
 * (DRY: one definition, no duplication of the try/catch across files).
 *
 * Mirrors the `parserLib?` injection seam in swagger-parser-seam.ts.
 */

import { createRequire } from "node:module";

import { DbConnectorError, DB_ERROR_CODES } from "../errors.js";
import type { DbEngine } from "../types.js";

/**
 * A minimal CJS module loader. Defaults to {@link defaultDriverRequire}.
 * Injected by unit tests with a fake so the lazy-wire path is covered
 * WITHOUT loading the real driver (the no-`istanbul-ignore` discipline:
 * this is real production wiring and is unit-tested, never ignored).
 * Mirrors the `parserLib?` injection seam in swagger-parser-seam.ts.
 */
export type DriverRequireFn = (moduleId: string) => unknown;

/**
 * The default CJS loader shared by all four per-engine seams.
 *
 * Built once via `createRequire(import.meta.url)` — the portable Node 22+
 * pattern that works under both Node 22's permissive ESM and Node 26's
 * strict ESM mode. A bare `require(id)` fallback (the previous default)
 * threw `ReferenceError: require is not defined` under Node 26, breaking
 * every DB connector at load time (GitHub issue #25).
 */
export const defaultDriverRequire: DriverRequireFn = createRequire(import.meta.url);

/**
 * Attempt to load a CJS driver module via `requireFn`. On failure (any
 * throw from `requireFn`), wraps the error in a `DbConnectorError` with
 * code `DB_CONNECTION_FAILED`, `phase: "connect"`, and a secret-free
 * install-hint message. Never re-throws the raw error (always typed).
 *
 * Centralizes the missing-driver mapping so all four seams share one
 * audited, secret-safe implementation (DRY; three-strikes rule).
 * @param requireFn - The CJS loader (injected or defaulted).
 * @param moduleId - The npm module id to require (e.g. `"pg"`).
 * @param engine - The engine whose driver is being loaded.
 * @param installHint - The secret-free install instruction for the message.
 * @returns The loaded module on success.
 * @throws {DbConnectorError} with code `DB_CONNECTION_FAILED` when
 *   `requireFn` throws for any reason.
 */
export function requireDriverOrThrow(
  requireFn: DriverRequireFn,
  moduleId: string,
  engine: DbEngine,
  installHint: string,
): unknown {
  try {
    return requireFn(moduleId);
  } catch (cause: unknown) {
    throw new DbConnectorError({
      code: DB_ERROR_CODES.DB_CONNECTION_FAILED,
      phase: "connect",
      engine,
      message: installHint,
      cause,
    });
  }
}
