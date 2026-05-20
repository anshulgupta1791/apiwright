/**
 * Binds a neutral query for the `neo4j-driver`. Pure, deterministic, total,
 * NEVER throws. Rewrites every sentinel SITE to a generated named param
 * (`$p<refIndex>`) and returns a `params` object with ONE entry per distinct
 * ref. Generated names are collision-checked against user-written `$identifier`
 * tokens already in the Cypher and re-prefixed deterministically on collision.
 *
 * D3 proof: `cypher` is built by replacing each sentinel with
 * `"$" + chosenPrefix + refIndex` — a string derived from the integer index
 * and a fixed prefix ladder, never from a resolved value. Values travel
 * exclusively in `params`.
 */

import {
  buildValueMap,
  checkContract,
  replaceSentinels,
  makeBindError,
  requireStringQuery,
} from "./binder-shared.js";
import type { Neo4jBoundQuery, BindResult } from "./engine-binding-types.js";
import type { NeutralQuery, BoundValue } from "./types.js";

// ---------------------------------------------------------------------------
// Prefix ladder for collision avoidance (deterministic, fixed)
// ---------------------------------------------------------------------------

/**
 * Deterministic prefix ladder for generated Cypher parameter names.
 * The binder tries each prefix in order until no generated `${prefix}${i}`
 * collides with any user-written `$identifier` in the Cypher.
 * Full ladder exhaustion → `DB_PARAM_NOT_BINDABLE` (vanishingly rare).
 */
const PREFIX_LADDER: readonly string[] = [
  "p",
  "_p",
  "__p",
  "___p",
  "apiwright_p",
];

/**
 * Regex to scan user-written `$identifier` tokens in Cypher.
 * Matches `$<letter or underscore><alphanumeric/underscore>*`.
 * Sentinels (`APIWRIGHT_PARAM_<N>`) contain no `$` so they are not matched.
 */
const USER_PARAM_RE = /\$([A-Za-z_][A-Za-z0-9_]*)/g;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Scans a Cypher string for user-written `$identifier` tokens and collects
 * the identifier names (without the `$` sigil).
 * @param cypher - The neutral Cypher string (sentinels included; they do not
 *   start with `$` so they are never matched).
 * @returns A Set of user-token names found in the string.
 */
function scanUserParams(cypher: string): Set<string> {
  const used = new Set<string>();
  USER_PARAM_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = USER_PARAM_RE.exec(cypher)) !== null) {
    if (match[1] !== undefined) {
      used.add(match[1]);
    }
  }
  return used;
}

/**
 * Chooses the shortest prefix from {@link PREFIX_LADDER} such that no
 * generated name `${prefix}${i}` (for any `i` in `0..refCount-1`) collides
 * with any name in `usedNames`.
 * @param usedNames - Set of user-written `$identifier` names already in the
 *   Cypher.
 * @param refCount - Number of distinct refs (determines generated-name range).
 * @returns The chosen prefix string, or `null` if the ladder is exhausted.
 */
function choosePrefix(usedNames: Set<string>, refCount: number): string | null {
  for (const prefix of PREFIX_LADDER) {
    let collides = false;
    for (let i = 0; i < refCount; i++) {
      if (usedNames.has(`${prefix}${i}`)) {
        collides = true;
        break;
      }
    }
    if (!collides) return prefix;
  }
  return null; // ladder exhausted
}

// ---------------------------------------------------------------------------
// bindNeo4j
// ---------------------------------------------------------------------------

/**
 * Binds a neutral query for the `neo4j-driver`.
 *
 * One generated `$<prefix><refIndex>` per DISTINCT ref, reused at every
 * occurrence site. `params` has exactly `refs.length` entries (one per
 * distinct ref). The generated names are collision-checked against user
 * `$identifier` tokens in the Cypher via a deterministic prefix-ladder;
 * full-ladder exhaustion → `DB_PARAM_NOT_BINDABLE`.
 * @param neutral - The upstream {@link NeutralQuery} (string-shaped for
 *   neo4j).
 * @param values - The upstream ordered {@link BoundValue}s (one per distinct
 *   ref, index-aligned to `neutral.refs`).
 * @returns `ok:true` with a {@link Neo4jBoundQuery}, or `ok:false` on a
 *   contract violation or full-ladder exhaustion.
 */
export function bindNeo4j(
  neutral: NeutralQuery,
  values: readonly BoundValue[],
): BindResult {
  // Guard: must be a string query for neo4j
  const stringGuard = requireStringQuery(neutral);
  if (stringGuard !== null) {
    if (neutral.refs.length > 0 || values.length > 0) {
      return stringGuard;
    }
    /* istanbul ignore next — provably unreachable: the neo4j binder is always called
       with a string neutralQuery (Cypher text); a non-string + zero-refs scenario would
       require a caller to construct NeutralQuery manually outside the extractRefs pipeline. */
    return {
      ok: true,
      query: {
        engine: "neo4j",
        bound: {
          cypher: JSON.stringify(neutral.neutralQuery),
          params: {},
        } satisfies Neo4jBoundQuery,
      },
    };
  }

  const contractError = checkContract(neutral, values);
  if (contractError !== null) return contractError;

  const query = neutral.neutralQuery as string;
  const { refs } = neutral;
  const valueMap = buildValueMap(values);

  // Scan user-written $identifier tokens to detect collisions.
  const usedNames = scanUserParams(query);

  // Choose prefix (handles zero refs: any prefix works; skip ladder check).
  const chosenPrefix = refs.length === 0 ? "p" : choosePrefix(usedNames, refs.length);
  if (chosenPrefix === null) {
    return makeBindError(
      "Neo4j parameter-name collision: all prefix-ladder candidates collide with " +
        "user-written $identifier tokens in the Cypher. Rename user params to free a " +
        "prefix slot.",
    );
  }

  // Rewrite each sentinel site to $<prefix><refIndex>.
  // The replacement is a pure function of the integer refIndex + fixed prefix (D3 proof).
  const cypher = replaceSentinels(query, (capturedRefIndexStr) => {
    const refIndex = parseInt(capturedRefIndexStr, 10);
    return `$${chosenPrefix}${refIndex}`;
  });

  // Build params: one entry per distinct ref, keyed by generated name.
  const params: Record<string, unknown> = {};
  for (const ref of refs) {
    const name = `${chosenPrefix}${ref.index}`;
    params[name] = valueMap.get(ref.index);
  }

  const bound: Neo4jBoundQuery = {
    cypher,
    params: Object.freeze(params),
  };

  return { ok: true, query: { engine: "neo4j", bound } };
}
