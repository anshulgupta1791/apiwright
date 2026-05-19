/**
 * Assertion corpus index — the single entry point for all corpus cases.
 *
 * Re-exports the fixture-local types from `corpus-types.ts` and concatenates
 * the per-group + invalid arrays into `ASSERTION_CORPUS`. Also exports small
 * derived helpers (`byGroup`, `validCases`, `invalidCases`,
 * `expectedFailureCodes`) so the integration test can compute counts at runtime
 * rather than using hard-coded magic numbers.
 *
 * Named exports only; no default export.
 */

import type { CorpusCase, OperatorGroup } from "./corpus-types.js";
import type { FailureCode } from "../../../src/assertions/index.js";

import { COMPARISON_CASES } from "./corpus-comparison.js";
import { PATTERN_CASES } from "./corpus-pattern.js";
import { EXISTENCE_CASES } from "./corpus-existence.js";
import { FORMAT_CASES } from "./corpus-format.js";
import { AGGREGATE_CASES } from "./corpus-aggregate.js";
import { INVALID_CASES } from "./corpus-invalid.js";

export type { CtxKey, ExpectedParse, ExpectedEval, CorpusCase } from "./corpus-types.js";

/**
 * The full assertion corpus — all operators, all groups, all edge cases.
 * PASS + FAIL + invalid-syntax in a deterministic, static order.
 * The integration test iterates this as the single source of truth.
 */
export const ASSERTION_CORPUS: readonly CorpusCase[] = [
  ...COMPARISON_CASES,
  ...PATTERN_CASES,
  ...EXISTENCE_CASES,
  ...FORMAT_CASES,
  ...AGGREGATE_CASES,
  ...INVALID_CASES,
];

// ---- Derived helpers (runtime counts — NO magic numbers) -------------------

/** Filter corpus by operator group. */
export function byGroup(group: OperatorGroup): readonly CorpusCase[] {
  return ASSERTION_CORPUS.filter((c) => c.group === group);
}

/** All parseable corpus cases (parse.kind === "ok"). */
export const validCases: readonly CorpusCase[] = ASSERTION_CORPUS.filter(
  (c) => c.parse.kind === "ok",
);

/** All invalid-syntax corpus cases (parse.kind === "error"). */
export const invalidCases: readonly CorpusCase[] = ASSERTION_CORPUS.filter(
  (c) => c.parse.kind === "error",
);

/**
 * The set of `FailureCode`s that at least one parseable corpus case is expected
 * to produce. Used by the integration test to assert all 7 codes appear.
 */
export function expectedFailureCodes(): ReadonlySet<FailureCode> {
  const codes = new Set<FailureCode>();
  for (const c of validCases) {
    if (c.expect?.failureCode !== undefined) {
      codes.add(c.expect.failureCode);
    }
  }
  return codes;
}
