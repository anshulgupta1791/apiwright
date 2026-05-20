/**
 * Pure mapping from a `mongodb` driver result to the canonical
 * {@link NormalizedResult}. Single responsibility: the single total formula
 * `rowCount = documents.length > 0 ? documents.length : (affected ?? 0)`
 * plus the LOCKED D4 no-coercion invariant.
 *
 * Kept in its own file so it is independently unit-testable and the
 * connector stays lean. D4 invariant: ZERO per-document/per-field coercion
 * of any kind — ObjectId, Date, Decimal128, Binary, all verbatim.
 */

import type { NormalizedResult } from "../../core/normalized-result.js";
import type { MongoCommandResult } from "../drivers/mongodb-seam.js";

/**
 * Maps a `mongodb` command result to the canonical {@link NormalizedResult}.
 *
 * Single total rowCount formula:
 * ```
 * rowCount = documents.length > 0 ? documents.length : (affected ?? 0)
 * ```
 * - Read arm (documents present): rows = documents verbatim; rowCount = documents.length.
 * - Write/admin arm (documents empty, affected present): rows = []; rowCount = affected.
 * - Empty result / no affected: rows = []; rowCount = 0.
 *
 * LOCKED D4: ZERO per-document/per-field coercion. ObjectId, Date,
 * Decimal128, Binary, null — all verbatim.
 * @param m - The `mongodb`-shaped command result from the seam.
 * @returns The canonical normalized result.
 */
export function mapMongoResult(m: MongoCommandResult): NormalizedResult {
  /* istanbul ignore next — provably unreachable: MongoCommandResult.documents is typed
     as MongoDocument[] (required, always an array); this guard exists only as a runtime
     defensive check against untyped/malformed driver responses from the mongodb package. */
  const rows: Record<string, unknown>[] = Array.isArray(m.documents) ? [...m.documents] : [];
  const rowCount: number = rows.length > 0 ? rows.length : (m.affected ?? 0);
  return {
    rows,
    rowCount,
    raw: m,
  };
}
