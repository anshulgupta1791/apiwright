/**
 * Pure mapping from a `neo4j-driver` result to the canonical
 * {@link NormalizedResult}. Single responsibility: the single total formula
 * `rowCount = records.length > 0 ? records.length : (countersTotal ?? 0)`
 * plus the LOCKED D4 no-coercion invariant.
 *
 * Kept in its own file so it is independently unit-testable and the
 * connector stays lean. D4 invariant: ZERO per-record/per-field coercion —
 * Integer, Node, Relationship, temporal types, Point — all verbatim.
 */

import type { NormalizedResult } from "../../core/normalized-result.js";
import type { Neo4jQueryResult } from "../drivers/neo4j-seam.js";

/**
 * Maps a `neo4j-driver` query result to the canonical {@link NormalizedResult}.
 *
 * Single total rowCount formula:
 * ```
 * rowCount = records.length > 0 ? records.length : (countersTotal ?? 0)
 * ```
 * - Read arm (records present): rows = records verbatim; rowCount = records.length.
 * - Write arm (records empty, countersTotal > 0): rows = []; rowCount = countersTotal.
 * - Empty MATCH (records empty, countersTotal = 0): rows = []; rowCount = 0.
 *
 * LOCKED D4: ZERO per-record/per-field coercion. Integer, Node, Relationship,
 * temporal types, Point, null — all verbatim. The seam already calls
 * `record.toObject()` so the connector never interacts with raw Record objects.
 * @param n - The `neo4j`-shaped driver result from the seam.
 * @returns The canonical normalized result.
 */
export function mapNeo4jResult(n: Neo4jQueryResult): NormalizedResult {
  // Defensive: seam contract guarantees an array, but coalesce if not.
  const rows: Record<string, unknown>[] = Array.isArray(n.records) ? [...n.records] : [];
  const rowCount: number = rows.length > 0 ? rows.length : (n.countersTotal ?? 0);
  return {
    rows,
    rowCount,
    raw: n,
  };
}
