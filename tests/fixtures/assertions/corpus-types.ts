/**
 * Fixture-local types and builder helpers for the assertion corpus.
 *
 * Defines the closed `CtxKey` union, expected-parse and expected-eval shapes,
 * and the `CorpusCase` record. Builder helpers `okCase`/`errCase` keep
 * per-group corpus files ≤100 col without boilerplate.
 *
 * These types are NOT exported from `src/`; they are purely test-fixture types.
 * Named exports only (`import/no-default-export`).
 */

import type {
  FailureCode,
  OperatorName,
  OperatorGroup,
} from "../../../src/assertions/index.js";

/** Keys into `ASSERTION_CONTEXTS` — the closed set of synthetic contexts. */
export type CtxKey = "base" | "headers" | "db" | "edge";

/** Expected parse outcome for a corpus entry. */
export type ExpectedParse =
  | { readonly kind: "ok" }
  | {
      readonly kind: "error";
      /**
       * Distinctive substrings expected (case-insensitively) in the aggregated
       * errors for THIS string. "Every fragment appears in at least one error
       * message for this string" — resilient to exact-wording changes.
       */
      readonly errorFragments: readonly string[];
    };

/**
 * Expected evaluation verdict for a parseable entry.
 * Omitted when `parse.kind === "error"` — unparseable strings are never
 * evaluated.
 */
export interface ExpectedEval {
  /** Expected `AssertionResult.pass`. */
  readonly pass: boolean;
  /**
   * Expected `AssertionResult.failureCode`. Present IFF `pass === false`
   * (mirrors the Layer-A GroupOutcome IFF invariant).
   */
  readonly failureCode?: FailureCode;
  /** Exact expected `AssertionResult.target` (`#renderTarget` output). */
  readonly target: string;
  /** Exact expected `AssertionResult.operator`. */
  readonly operator: OperatorName;
  /**
   * Optional gist expected (case-insensitively) in `AssertionResult.reason`
   * when `pass === false`. Substring, not exact string (wording owned by
   * group evaluators).
   */
  readonly reasonIncludes?: string;
}

/** One corpus case — frozen; pure data; no functions/Date/regex literals. */
export interface CorpusCase {
  /** Stable unique id, e.g. "cmp.equals.pass" (test-title key + dedupe). */
  readonly id: string;
  /** Operator group this case belongs to (matrix bucketing + counts). */
  readonly group: OperatorGroup;
  /** The raw assertion string fed to `AssertionEngine.parseAll`. */
  readonly raw: string;
  /** Expected parse outcome. */
  readonly parse: ExpectedParse;
  /** Context key to evaluate a parseable case against. */
  readonly context: CtxKey;
  /** Expected verdict; present IFF `parse.kind === "ok"`. */
  readonly expect?: ExpectedEval;
}

// ---- Builder helpers -------------------------------------------------------

/** Build a parseable corpus case with an expected evaluation verdict. */
export function okCase(
  id: string,
  group: OperatorGroup,
  raw: string,
  context: CtxKey,
  expect: ExpectedEval,
): CorpusCase {
  return Object.freeze({ id, group, raw, parse: { kind: "ok" }, context, expect });
}

/** Build a corpus case expected to fail parsing. */
export function errCase(
  id: string,
  group: OperatorGroup,
  raw: string,
  errorFragments: readonly string[],
): CorpusCase {
  return Object.freeze({
    id,
    group,
    raw,
    parse: { kind: "error", errorFragments },
    context: "base",
  });
}
