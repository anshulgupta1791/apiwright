/**
 * Binds a neutral query for the `pg` driver. Pure, deterministic, total,
 * NEVER throws. Rewrites every sentinel SITE to a positional `$N` token and
 * returns the resolved values in `$`-index order.
 *
 * D3 proof: `text` is built by replacing each sentinel with the literal
 * `"$" + (refIndex + 1)` — a string derived from the INTEGER ref index only,
 * never from a resolved value. Values travel exclusively in the `values` array.
 *
 * Scheme: one `$n` per DISTINCT ref (pg supports same-`$n` reuse). A ref
 * reused K times emits `$n` at every site; `values` has exactly `refs.length`
 * entries (NOT `occurrences.length`).
 */

import {
  buildValueMap,
  checkContract,
  replaceSentinels,
  requireStringQuery,
} from "./binder-shared.js";
import type { PgBoundQuery, BindResult } from "./engine-binding-types.js";
import type { NeutralQuery, BoundValue } from "./types.js";

/**
 * Binds a neutral query for the `pg` driver.
 *
 * One `$n` placeholder per DISTINCT ref reused at all occurrence sites; the
 * `values` array has exactly `refs.length` entries in ref-index order.
 * @param neutral - The upstream {@link NeutralQuery} (string-shaped for pg).
 * @param values - The upstream ordered {@link BoundValue}s (one per distinct
 *   ref, index-aligned to `neutral.refs`).
 * @returns `ok:true` with a {@link PgBoundQuery}, or a defensive
 *   `DB_PARAM_NOT_BINDABLE` error on a contract violation.
 */
export function bindPg(
  neutral: NeutralQuery,
  values: readonly BoundValue[],
): BindResult {
  // Guard: must be a string query for pg
  const stringGuard = requireStringQuery(neutral);
  if (stringGuard !== null) {
    // Non-string neutral: return the guard error if there are refs/values to bind.
    if (neutral.refs.length > 0 || values.length > 0) {
      return stringGuard;
    }
    /* istanbul ignore next — provably unreachable: the pg binder is always called with
       a string neutralQuery (SQL text); zero refs + non-string neutral would require
       manually constructing NeutralQuery outside the extractRefs pipeline. */
    return {
      ok: true,
      query: {
        engine: "postgres",
        bound: { text: JSON.stringify(neutral.neutralQuery), values: [] } satisfies PgBoundQuery,
      },
    };
  }

  const contractError = checkContract(neutral, values);
  if (contractError !== null) return contractError;

  const query = neutral.neutralQuery as string;
  const valueMap = buildValueMap(values);

  // Rewrite each sentinel site to $<refIndex+1> (1-based pg positional param).
  // The placeholder is a pure function of the INTEGER refIndex — never the value.
  const text = replaceSentinels(query, (capturedRefIndexStr) => {
    const refIndex = parseInt(capturedRefIndexStr, 10);
    return `$${refIndex + 1}`;
  });

  // Build values in ref-index order (refs are de-duped and index-ordered).
  // values.length === refs.length by the contract check above.
  const orderedValues: unknown[] = neutral.refs.map((ref) =>
    valueMap.get(ref.index),
  );

  const bound: PgBoundQuery = {
    text,
    values: orderedValues,
  };

  return { ok: true, query: { engine: "postgres", bound } };
}
