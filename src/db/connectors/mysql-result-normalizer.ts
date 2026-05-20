/**
 * Pure mapping from a `mysql2` driver result to the canonical
 * {@link NormalizedResult}. Single responsibility: the two structural arms
 * (rows-arm SELECT → rows-as-is / ok-arm DML/DDL → affectedRows ?? 0) plus
 * the LOCKED D4 no-coercion invariant.
 *
 * Kept in its own file so it is independently unit-testable and the
 * connector stays lean. D4 invariant: ZERO per-cell coercion of any kind.
 */

import type { NormalizedResult } from "../../core/normalized-result.js";
import type { MysqlQueryResult } from "../drivers/mysql-seam.js";

/**
 * Maps a `mysql2` driver query result to the canonical {@link NormalizedResult}.
 *
 * Mapping rules by arm:
 * - `"rows"` arm (SELECT/SHOW): `rows = my.rows` verbatim (defensive:
 * non-array coalesced to `[]`); `rowCount = rows.length`; `raw = my`.
 * - `"ok"` arm (INSERT/UPDATE/DELETE/DDL): `rows = []`;
 * `rowCount = my.affectedRows ?? 0` (DDL may omit affectedRows); `raw = my`.
 *
 * LOCKED D4: ZERO per-cell type normalization or coercion. Date, Buffer,
 * DECIMAL-as-string, null — all verbatim.
 * @param my - The `mysql2`-shaped driver result from the seam.
 * @returns The canonical normalized result.
 */
export function mapMysqlResult(my: MysqlQueryResult): NormalizedResult {
  if (my.kind === "rows") {
    // Defensive: seam contract guarantees an array, but coalesce if not.
    const rows: Record<string, unknown>[] = Array.isArray(my.rows) ? [...my.rows] : [];
    return {
      rows,
      rowCount: rows.length,
      raw: my,
    };
  }

  // "ok" arm: DML/DDL — no rows
  const rowCount: number = (my as { kind: "ok"; affectedRows?: number }).affectedRows ?? 0;
  return {
    rows: [],
    rowCount,
    raw: my,
  };
}
