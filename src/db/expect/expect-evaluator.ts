/**
 * Pure, total, hermetic evaluation of one `CanonicalDbVerification` `expect`
 * mode against one `NormalizedResult`. The sole entry-point is `evaluate`;
 * all internal helpers are non-exported. Implements D-A through D-D semantics,
 * delegates ALL value comparison to the `src/core` `deepEqual` SSOT (D4/D5),
 * and NEVER throws or coerces. Outcome carries no secrets in `reason`.
 *
 * NOTE (DEFERRED — Task #10, NOT here): surfacing `result` under
 * `db.<connection>.<query_id>` for §4 `db.*` assertions and orchestrating
 * verify-then-cleanup per endpoint is the runner's job.
 */

import type { CanonicalDbVerification, DbExpectMode } from "../../core/canonical-model.js";
import type { NormalizedResult } from "../../core/normalized-result.js";

import { rowSatisfiesExact, rowSatisfiesMatch } from "./row-match.js";

/**
 * Stable, machine-readable classification of a §5 expect-mode FAILURE.
 * String-literal union (repo idiom — never a numeric enum; cf.
 * `FailureCode` in `src/assertions/types.ts`, `DbErrorCode` in
 * `src/db/errors.ts`). Extensible ONLY by editing this union in code; NEVER
 * configurable. These are the locked v1.0 §5 verification-failure kinds;
 * §10 reporting and the later §4 `db.*` tie-in branch on this value.
 *
 * `DB_EXPECT_MALFORMED` is the D-D AUTHORING rejection (a malformed
 * verification, NOT a data failure — see Result/error model). The other
 * three are normal data failures (a verification that ran and did not hold).
 */
export type DbExpectFailureCode =
  /** `exists` declared but the result set was empty. */
  | "DB_EXPECT_EXISTS_EMPTY"
  /** `not_exists` declared but the result set was non-empty. */
  | "DB_EXPECT_NOT_EXISTS_NONEMPTY"
  /** `match`/`exact` declared but no row satisfied the declared fields. */
  | "DB_EXPECT_NO_MATCHING_ROW"
  /** `match`/`exact` declared with absent/empty `fields` (authoring error). */
  | "DB_EXPECT_MALFORMED";

/**
 * Value-side surrogate for {@link DbExpectFailureCode} so emitting code
 * references `DB_EXPECT_FAILURE_CODES.DB_EXPECT_NO_MATCHING_ROW` instead of
 * a bare string literal (no magic strings; one edit point — exact
 * `FAILURE_CODES` / `DB_ERROR_CODES` idiom). Frozen; keys === values ===
 * the union. One of the runtime exports a unit test exercises (key/value
 * identity + `Object.freeze`).
 */
export const DB_EXPECT_FAILURE_CODES: {
  readonly [K in DbExpectFailureCode]: K;
} = Object.freeze({
  DB_EXPECT_EXISTS_EMPTY: "DB_EXPECT_EXISTS_EMPTY",
  DB_EXPECT_NOT_EXISTS_NONEMPTY: "DB_EXPECT_NOT_EXISTS_NONEMPTY",
  DB_EXPECT_NO_MATCHING_ROW: "DB_EXPECT_NO_MATCHING_ROW",
  DB_EXPECT_MALFORMED: "DB_EXPECT_MALFORMED",
} as const);

/**
 * The pure structured outcome of evaluating ONE `CanonicalDbVerification`'s
 * `expect` mode against ONE `NormalizedResult`. Fully JSON-serializable.
 * Discriminated on `pass`. Pass:true omits `failureCode` and `reason` (not
 * `undefined`-valued — exact `GroupOutcome` invariant).
 */
export type DbVerifyOutcome =
  | { readonly pass: true }
  | {
      readonly pass: false;
      /** The `DbExpectMode` that was evaluated. */
      readonly mode: DbExpectMode;
      /** Stable machine-readable failure classification. */
      readonly failureCode: DbExpectFailureCode;
      /** Short, secret-free, human-readable explanation. */
      readonly reason: string;
    };

/**
 * Build a pass:false outcome without repeating the shape.
 * @param mode - The expect mode that failed.
 * @param failureCode - Stable failure classification code.
 * @param reason - Short, secret-free human-readable explanation.
 * @returns A pass:false DbVerifyOutcome.
 */
function fail(
  mode: DbExpectMode,
  failureCode: DbExpectFailureCode,
  reason: string,
): DbVerifyOutcome {
  return { pass: false, mode, failureCode, reason };
}

/**
 * D-A: `exists` — pass iff `result.rows.length > 0` (NOT `rowCount`).
 * See D-A decision record for the count-query caveat and DELETE-verification
 * shape (`rows:[], rowCount:3` ⇒ pass:false — correct per spec).
 * @param result - The normalized result to evaluate.
 * @returns Pass or fail outcome.
 */
function evaluateExists(result: NormalizedResult): DbVerifyOutcome {
  if (result.rows.length > 0) {
    return { pass: true };
  }
  return fail(
    "exists",
    DB_EXPECT_FAILURE_CODES.DB_EXPECT_EXISTS_EMPTY,
    "exists: result set is empty (0 rows returned)",
  );
}

/**
 * D-A: `not_exists` — pass iff `result.rows.length === 0` (NOT `rowCount`).
 * The DELETE-verification shape (`rows:[], rowCount:3`) passes correctly.
 * @param result - The normalized result to evaluate.
 * @returns Pass or fail outcome.
 */
function evaluateNotExists(result: NormalizedResult): DbVerifyOutcome {
  if (result.rows.length === 0) {
    return { pass: true };
  }
  return fail(
    "not_exists",
    DB_EXPECT_FAILURE_CODES.DB_EXPECT_NOT_EXISTS_NONEMPTY,
    `not_exists: result set has ${result.rows.length} row(s); expected 0`,
  );
}

/**
 * D-B: `match` — pass iff ∃ at least one row satisfying all declared fields.
 * Requires non-empty, non-absent `fields` (D-D checked by caller).
 * @param result - The normalized result to evaluate.
 * @param fields - The declared fields to match against.
 * @param mode - The current expect mode (for the outcome shape).
 * @returns Pass or fail outcome.
 */
function evaluateMatch(
  result: NormalizedResult,
  fields: Record<string, unknown>,
  mode: DbExpectMode,
): DbVerifyOutcome {
  for (const row of result.rows) {
    if (rowSatisfiesMatch(row, fields)) {
      return { pass: true };
    }
  }
  return fail(
    mode,
    DB_EXPECT_FAILURE_CODES.DB_EXPECT_NO_MATCHING_ROW,
    `${mode}: no row in the result set satisfied the declared fields ` +
      `(${result.rows.length} row(s) checked)`,
  );
}

/**
 * D-C: `exact` — pass iff ∃ row with key-set == fields key-set AND all values
 * deepEqual. Does NOT require result cardinality === 1 (per-row shape check).
 * Requires non-empty, non-absent `fields` (D-D checked by caller).
 * @param result - The normalized result to evaluate.
 * @param fields - The declared fields for exact comparison.
 * @returns Pass or fail outcome.
 */
function evaluateExact(
  result: NormalizedResult,
  fields: Record<string, unknown>,
): DbVerifyOutcome {
  for (const row of result.rows) {
    if (rowSatisfiesExact(row, fields)) {
      return { pass: true };
    }
  }
  return fail(
    "exact",
    DB_EXPECT_FAILURE_CODES.DB_EXPECT_NO_MATCHING_ROW,
    `exact: no row in the result set had exactly the declared key set and values ` +
      `(${result.rows.length} row(s) checked)`,
  );
}

/**
 * Evaluate one verification's `expect` mode against one normalized result.
 *
 * Pure and total: deterministic, no I/O / DB / clock / randomness, and
 * NEVER throws for ANY `(result, verification)` pair (acceptance criterion
 * — every failure mode is a returned {@link DbVerifyOutcome}, including the
 * D-D malformed-declaration case). Reuses the `src/core` `deepEqual` SSOT
 * for ALL value comparison (D4/D5: type-strict, ZERO coercion); reuses the
 * `src/core` `NormalizedResult` and `src/core/canonical-model`
 * `CanonicalDbVerification` / `DbExpectMode` (never redefined).
 *
 * Semantics:
 * - `exists` — pass iff `result.rows.length > 0`.
 * - `not_exists` — pass iff `result.rows.length === 0`.
 * - `match` — pass iff some row R has, for EVERY declared `(k, v)`,
 *   `deepEqual(R[k], v) === true` (extra row keys ignored; absent declared
 *   key ⇒ row fails — missing is NOT treated as `null`).
 * - `exact` — pass iff some row R's own-key set equals `fields` keys AND all
 *   values `deepEqual` (no extra row keys, no missing declared keys). Per-row;
 *   does NOT constrain result cardinality (D-C).
 * - `match`/`exact` with absent/empty `fields` ⇒ structured
 *   `DB_EXPECT_MALFORMED` rejection (D-D). `exists`/`not_exists` IGNORE
 *   `fields` entirely.
 *
 * NOTE (DEFERRED — Task #10, NOT here): surfacing `result` under
 * `db.<connection>.<query_id>` for §4 `db.*` assertions and orchestrating
 * verify-then-cleanup per endpoint is the runner's job.
 * @param result - The canonical, already-produced normalized result.
 * @param verification - The canonical verification: `expect` mode + optional `fields`.
 * @returns A `DbVerifyOutcome` — never throws.
 */
export function evaluate(
  result: NormalizedResult,
  verification: CanonicalDbVerification,
): DbVerifyOutcome {
  const mode = verification.expect;

  switch (mode) {
    case "exists":
      return evaluateExists(result);

    case "not_exists":
      return evaluateNotExists(result);

    case "match": {
      // D-D: absent or empty fields ⇒ malformed (before row iteration)
      const fields = verification.fields;
      if (fields === undefined || Object.keys(fields).length === 0) {
        return fail(
          mode,
          DB_EXPECT_FAILURE_CODES.DB_EXPECT_MALFORMED,
          "match: absent or empty 'fields' declaration is an authoring error — " +
            "specify at least one field to match",
        );
      }
      return evaluateMatch(result, fields, mode);
    }

    case "exact": {
      // D-D: absent or empty fields ⇒ malformed (before row iteration)
      const fields = verification.fields;
      if (fields === undefined || Object.keys(fields).length === 0) {
        return fail(
          mode,
          DB_EXPECT_FAILURE_CODES.DB_EXPECT_MALFORMED,
          "exact: absent or empty 'fields' declaration is an authoring error — " +
            "specify at least one field for exact matching",
        );
      }
      return evaluateExact(result, fields);
    }

    default: {
      // Exhaustive switch: the default is unreachable under the typed contract.
      // A single test exercises it via deliberate cast. Returns pass:false (no-throw).
      const _exhaustive: never = mode;
      return fail(
        _exhaustive,
        DB_EXPECT_FAILURE_CODES.DB_EXPECT_MALFORMED,
        `Unknown expect mode: ${String(_exhaustive)}`,
      );
    }
  }
}
