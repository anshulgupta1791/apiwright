/**
 * Internal row-matching helpers for the §5 expect-mode evaluator.
 * Non-exported-from-package (internal sibling of `expect-evaluator.ts`).
 * Contains the two largest per-mode helpers extracted to keep
 * `expect-evaluator.ts` under the 300-line soft limit.
 * Delegates ALL value comparison to the `src/core` `deepEqual` SSOT (D4/D5).
 */

import { deepEqual } from "../../core/deep-equal.js";

/**
 * D-B: Check whether row R satisfies ALL declared (k, v) entries.
 * Absent declared key on R ⇒ row fails (absent ≠ null, D-B rule).
 * Extra row keys are ignored. Uses `src/core` `deepEqual` SSOT (D4/D5).
 * @param row - The result row to test.
 * @param fields - The declared fields to match against.
 * @returns True iff every declared field is present and deepEqual on the row.
 */
export function rowSatisfiesMatch(
  row: Record<string, unknown>,
  fields: Record<string, unknown>,
): boolean {
  const fieldKeys = Object.keys(fields);
  for (const k of fieldKeys) {
    if (!Object.prototype.hasOwnProperty.call(row, k)) {
      return false;
    }
    if (!deepEqual(row[k], fields[k])) {
      return false;
    }
  }
  return true;
}

/**
 * D-C: Check whether row R is key-set-exact + value-equal vs `fields`.
 * Row's OWN-ENUMERABLE-KEY SET must equal fields key set (same cardinality
 * AND same members). All values deepEqual. Does NOT constrain cardinality.
 * @param row - The result row to test.
 * @param fields - The declared fields for exact comparison.
 * @returns True iff the row's key set exactly equals fields keys and all values deepEqual.
 */
export function rowSatisfiesExact(
  row: Record<string, unknown>,
  fields: Record<string, unknown>,
): boolean {
  const rowKeys = Object.keys(row);
  const fieldKeys = Object.keys(fields);
  if (rowKeys.length !== fieldKeys.length) {
    return false;
  }
  for (const k of fieldKeys) {
    if (!Object.prototype.hasOwnProperty.call(row, k)) {
      return false;
    }
    if (!deepEqual(row[k], fields[k])) {
      return false;
    }
  }
  return true;
}
