/**
 * Pure mapping from a `pg` driver result to the canonical
 * {@link NormalizedResult}. Single responsibility: the three structural
 * mapping rules (rows as-is / numeric rowCount via `?? rows.length` /
 * raw passthrough) plus the LOCKED D4 no-coercion invariant.
 *
 * Kept in its own file so it is independently unit-testable and the
 * connector stays lean. The D4 invariant is an auditable, single-place
 * property: this function performs ZERO per-cell coercion of any kind.
 */

import type { NormalizedResult } from "../../core/normalized-result.js";
import type { PgQueryResult } from "../drivers/postgres-seam.js";

/**
 * Maps a `pg` driver query result to the canonical {@link NormalizedResult}.
 *
 * Mapping rules:
 * - `rows` → `pg.rows` verbatim (no cell coercion — D4).
 * Defensive: non-array `rows` input coalesced to `[]`.
 * - `rowCount` → `pg.rowCount ?? pg.rows.length` (never `null`; the `??
 * rows.length` fallback handles DDL/utility commands that pg reports no
 * count for, where `rows` is `[]` ⇒ fallback is `0`).
 * - `raw` → the exact `pg` object (identity; opaque driver payload for §4
 * `db.*` escape-hatch assertions).
 *
 * LOCKED D4: performs ZERO per-cell type normalization or coercion. `Date`
 * objects, `bigint` values, numeric-as-string cells (pg `int8`/`numeric`
 * returned as strings), `JSON`-as-string, `null` cells — all verbatim. Type-
 * strict comparison and JSON-comparable column projection are the
 * expect-evaluator/QA's responsibility, NOT here.
 * @param pg - The `pg`-shaped driver result from the seam.
 * @returns The canonical normalized result.
 */
export function mapPgResult(pg: PgQueryResult): NormalizedResult {
  // Defensive: seam contract guarantees an array, but coalesce if not.
  const rows: Record<string, unknown>[] = Array.isArray(pg.rows) ? [...pg.rows] : [];

  // rowCount: use the driver value when it is a number, else fall back to
  // rows.length. This is always a number (never null) in the output.
  const rowCount: number = pg.rowCount ?? rows.length;

  return {
    rows,
    rowCount,
    raw: pg,
  };
}
