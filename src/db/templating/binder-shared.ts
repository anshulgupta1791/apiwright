/**
 * DRY shared utilities for the per-engine binders. Contains: the
 * `valueByIndex` Map builder, the defensive contract-check helper that
 * returns a `DB_PARAM_NOT_BINDABLE` error on contract violation, and the
 * occurrence-faithful sentinel RegExp built from the imported upstream
 * `NEUTRAL_PLACEHOLDER_PREFIX` constant. Also exports the shared
 * `String.replace` site-walker used by the pg, mysql, and neo4j binders.
 *
 * No engine-specific logic lives here — only the cross-cutting infrastructure
 * that would otherwise be copy-pasted across three binder modules.
 */

import { DbConnectorError, DB_ERROR_CODES } from "../errors.js";

import type { BindResult } from "./engine-binding-types.js";
import { NEUTRAL_PLACEHOLDER_PREFIX } from "./ref-extractor.js";
import type { NeutralQuery, BoundValue, Ref } from "./types.js";

// ---------------------------------------------------------------------------
// Sentinel RegExp (built from the imported const — one edit point)
// ---------------------------------------------------------------------------

/**
 * Occurrence-faithful global regex that matches one sentinel site.
 * Matches: ` APIWRIGHT_PARAM_<digits> ` (space-bounded).
 * Capture group 1: the decimal ref-index digits.
 * Built once from the imported {@link NEUTRAL_PLACEHOLDER_PREFIX} const;
 * the prefix is never re-typed (single-edit-point rule).
 */
export const SENTINEL_RE: RegExp = new RegExp(
  `${NEUTRAL_PLACEHOLDER_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\d+) `,
  "g",
);

// ---------------------------------------------------------------------------
// valueByIndex Map
// ---------------------------------------------------------------------------

/**
 * Builds a lookup Map from ref-index to resolved value.
 * @param values - Ordered resolved {@link BoundValue}s from the caller.
 * @returns Map keyed by {@link BoundValue.index}.
 */
export function buildValueMap(
  values: readonly BoundValue[],
): Map<number, unknown> {
  return new Map(values.map((bv) => [bv.index, bv.value]));
}

// ---------------------------------------------------------------------------
// Defensive contract check
// ---------------------------------------------------------------------------

/** Engine tag used in defensive errors (engine-agnostic binding layer). */
const BINDER_ENGINE = "postgres" as const; // placeholder; overridden at call sites

/**
 * Checks the binding inputs for contract consistency.
 * Returns a `DB_PARAM_NOT_BINDABLE` {@link BindResult} if any inconsistency
 * is detected; returns `null` when inputs are consistent and binding may
 * proceed.
 *
 * Defensive contract: `values.length === refs.length`, every
 * `occurrence.refIndex` resolves in `refs`, and every `refs[i].index` has a
 * corresponding `BoundValue`. This is impossible given the upstream contract
 * but the check makes every binder provably total (no-throw).
 * @param neutral - The neutral query to validate.
 * @param values - The ordered resolved bound values.
 * @returns `null` if consistent; a failure `BindResult` otherwise.
 */
export function checkContract(
  neutral: NeutralQuery,
  values: readonly BoundValue[],
): BindResult | null {
  const { refs, occurrences } = neutral;

  // values must align 1:1 with refs
  if (values.length !== refs.length) {
    return makeBindError(
      `Binding contract violation: expected ${refs.length} resolved values but ` +
        `received ${values.length}.`,
    );
  }

  // every occurrence must point to a valid ref index
  const refIndexSet = new Set(refs.map((r: Ref) => r.index));
  for (const occ of occurrences) {
    /* istanbul ignore next — provably unreachable: extractRefs assigns refIndex from
       refs.length at the moment of creation, guaranteeing every occurrence.refIndex
       has a corresponding ref entry; a mismatch would require a caller bypassing the
       extractRefs→resolveRefs→bindForEngine pipeline contract. */
    if (!refIndexSet.has(occ.refIndex)) {
      return makeBindError(
        `Binding contract violation: occurrence refIndex ${occ.refIndex} has no ` +
          `corresponding ref.`,
      );
    }
  }

  // every ref.index must have a matching BoundValue
  const valueIndexSet = new Set(values.map((v: BoundValue) => v.index));
  for (const ref of refs) {
    /* istanbul ignore next — provably unreachable: resolveRefs produces one BoundValue
       per Ref (1:1 alignment by index); a mismatch would require a caller constructing
       values and refs with inconsistent indices outside the pipeline. */
    if (!valueIndexSet.has(ref.index)) {
      return makeBindError(
        `Binding contract violation: ref index ${ref.index} has no BoundValue.`,
      );
    }
  }

  return null;
}

/**
 * Creates a `DB_PARAM_NOT_BINDABLE` failure {@link BindResult}.
 * The `engine` field uses a generic placeholder; callers do not need to
 * supply it because this error is produced only for defensive
 * contract-violation cases, not for engine-specific faults.
 * @param message - Secret-free description of the violation.
 * @returns A failure `BindResult`.
 */
export function makeBindError(message: string): BindResult {
  return {
    ok: false,
    error: new DbConnectorError({
      code: DB_ERROR_CODES.DB_PARAM_NOT_BINDABLE,
      phase: "bind",
      // Engine is unknown at the shared-layer; use a stable placeholder.
      // The caller (per-engine binder) does not override this because the
      // error is a pure-contract violation, not an engine failure.
      engine: BINDER_ENGINE,
      message,
    }),
  };
}

// ---------------------------------------------------------------------------
// Shared String.replace site-walker (pg / mysql / neo4j)
// ---------------------------------------------------------------------------

/**
 * Walks a neutral SQL/Cypher string in left-to-right textual order, invoking
 * `replaceOne` for each sentinel site. The replacement string returned by
 * `replaceOne` replaces the full sentinel match (including surrounding spaces).
 *
 * The running `siteIndex` argument passed to `replaceOne` aligns to the
 * `occurrences` array order — critical for pg (same `$n` per distinct ref)
 * and mysql (one `?` per occurrence in order).
 * @param query - The neutral SQL/Cypher string.
 * @param replaceOne - Called once per site. Receives the captured ref-index
 *   string from the sentinel and the running 0-based site counter. Must
 *   return the replacement token string.
 * @returns The rewritten query string.
 */
export function replaceSentinels(
  query: string,
  replaceOne: (capturedRefIndexStr: string, siteIndex: number) => string,
): string {
  let siteIndex = 0;
  // Reset lastIndex before use (global regex is stateful)
  SENTINEL_RE.lastIndex = 0;
  const result = query.replace(SENTINEL_RE, (_match, capturedRefIndex: string) => {
    const token = replaceOne(capturedRefIndex, siteIndex);
    siteIndex += 1;
    return token;
  });
  return result;
}

/**
 * Guards that a neutral query's `neutralQuery` is a string (for
 * SQL/Cypher engines). Returns a failure `BindResult` if it is not.
 * @param neutral - The neutral query.
 * @returns `null` when the query is a string; a failure result otherwise.
 */
export function requireStringQuery(neutral: NeutralQuery): BindResult | null {
  if (typeof neutral.neutralQuery !== "string") {
    return makeBindError(
      "Binding contract violation: expected a string neutralQuery for a " +
        "SQL/Cypher engine but received an object/array.",
    );
  }
  return null;
}
