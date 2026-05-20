/**
 * Binds a neutral query for the `mysql2` driver. Pure, deterministic, total,
 * NEVER throws. Rewrites every sentinel SITE to a `?` token and returns one
 * value per occurrence in left-to-right textual order.
 *
 * D3 proof: `sql` is built by replacing each sentinel with the literal `"?"`
 * — a constant, value-independent string. Values travel exclusively in the
 * `values` array (one entry per `?`, in left-to-right order).
 *
 * LOCKED mysql2 rule: `?` has NO reuse semantics. A ref used at K sites
 * contributes its resolved value K times in `values`, in textual order.
 * `values.length === occurrences.length` (NOT `refs.length`).
 */

import {
  buildValueMap,
  checkContract,
  replaceSentinels,
  requireStringQuery,
} from "./binder-shared.js";
import type { MySqlBoundQuery, BindResult } from "./engine-binding-types.js";
import type { NeutralQuery, BoundValue } from "./types.js";

/** The mysql2 positional placeholder token. */
const MYSQL_PLACEHOLDER = "?";

/**
 * Binds a neutral query for the `mysql2` driver.
 *
 * Every occurrence emits one `?`; `values` has exactly `occurrences.length`
 * entries in left-to-right textual order. A ref used at K sites has its
 * value repeated K times.
 * @param neutral - The upstream {@link NeutralQuery} (string-shaped for
 *   mysql2).
 * @param values - The upstream ordered {@link BoundValue}s (one per distinct
 *   ref, index-aligned to `neutral.refs`).
 * @returns `ok:true` with a {@link MySqlBoundQuery}, or a defensive
 *   `DB_PARAM_NOT_BINDABLE` error on a contract violation.
 */
export function bindMySql(
  neutral: NeutralQuery,
  values: readonly BoundValue[],
): BindResult {
  // Guard: must be a string query for mysql2
  const stringGuard = requireStringQuery(neutral);
  if (stringGuard !== null) {
    if (neutral.refs.length > 0 || values.length > 0) {
      return stringGuard;
    }
    /* istanbul ignore next — provably unreachable: the mysql binder is always called
       with a string neutralQuery (SQL text); a non-string + zero-refs scenario would
       require a caller to construct NeutralQuery manually outside the extractRefs pipeline. */
    return {
      ok: true,
      query: {
        engine: "mysql",
        bound: { sql: JSON.stringify(neutral.neutralQuery), values: [] } satisfies MySqlBoundQuery,
      },
    };
  }

  const contractError = checkContract(neutral, values);
  if (contractError !== null) return contractError;

  const query = neutral.neutralQuery as string;
  const { occurrences } = neutral;
  const valueMap = buildValueMap(values);

  // Values collected in occurrence order (left-to-right textual order).
  const orderedValues: unknown[] = [];

  // Rewrite each sentinel to `?`; collect values in occurrence order.
  // The replacement string is the constant "?" — never the value (D3 proof).
  const sql = replaceSentinels(query, (_capturedRefIndexStr, siteIndex) => {
    const occ = occurrences[siteIndex];
    // occ is guaranteed by checkContract (every refIndex resolves)
    const value = occ !== undefined ? valueMap.get(occ.refIndex) : undefined;
    orderedValues.push(value);
    return MYSQL_PLACEHOLDER;
  });

  const bound: MySqlBoundQuery = {
    sql,
    values: orderedValues,
  };

  return { ok: true, query: { engine: "mysql", bound } };
}
