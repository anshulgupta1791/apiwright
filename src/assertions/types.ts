/**
 * Module-wide operator taxonomy, the stable `FailureCode` vocabulary, the
 * per-operator-group `GroupOutcome` fragment, the per-assertion
 * `AssertionResult`, the no-throw aggregated parser `Result`, the batch
 * parse/validate result, and the `EvaluationContext`. Anchors the
 * `src/assertions` module the way `src/test-catalog/types.ts` anchors that
 * one. The AST node shapes live in `./ast.ts` (300-line soft limit) and are
 * re-exported here so `../assertions/index.js` is the single import surface.
 *
 * Pure type declarations plus one trivial frozen const record
 * (`FAILURE_CODES`).
 */

import type { NormalizedResult } from "../core/normalized-result.js";

import type { AssertionAst } from "./ast.js";

export type * from "./ast.js";

/**
 * Exactly the 20 assertion operators from §4 / locked
 * decision #1. NO operator outside this list exists in v1.0 (the registry
 * task validates against this union). A string-literal union, not a TS
 * `enum`, matching the repo idiom (`GeneratedTestType`, `HttpMethod`):
 * structural, zero runtime cost, narrows in `switch`.
 */
export type OperatorName =
  // comparison
  | "equals"
  | "not_equals"
  | "greater_than"
  | "less_than"
  | "in_range"
  // pattern
  | "matches"
  | "contains"
  | "starts_with"
  | "ends_with"
  // existence
  | "exists"
  | "not_exists"
  | "is_null"
  | "is_not_null"
  // type/format
  | "is_uuid_v4"
  | "is_iso_timestamp"
  | "is_recent_timestamp"
  | "is_email"
  | "is_url"
  // aggregate
  | "count_equals"
  | "count_greater_than";

/** The 5 operator families from §4. Used to route to a group implementation. */
export type OperatorGroup =
  | "comparison"
  | "pattern"
  | "existence"
  | "format"
  | "aggregate";

/**
 * Stable, machine-readable failure classification for a failed assertion.
 * String-literal union (repo idiom — never a numeric enum;
 * `no-magic-numbers`). Extensible ONLY by editing this union in code; NEVER
 * configurable (§4: vocabulary fixed, extensible in code not config). The 7
 * members below are the locked v1.0 set; downstream tasks map each failure to
 * exactly one of these.
 */
export type FailureCode =
  /** Target path did not resolve in the evaluation context. */
  | "TARGET_NOT_FOUND"
  /** Resolved value had the wrong runtime type for the operator. */
  | "TYPE_MISMATCH"
  /** `matches` regex did not match the resolved string. */
  | "REGEX_NO_MATCH"
  /** A comparison operator's predicate evaluated false. */
  | "COMPARISON_FAILED"
  /** A type/format operator (is_uuid_v4, is_email, …) rejected the value. */
  | "FORMAT_INVALID"
  /** An aggregate (count_*) operator's predicate evaluated false. */
  | "AGGREGATE_MISMATCH"
  /** Arithmetic evaluation failed (non-numeric operand, divide-by-zero). */
  | "ARITHMETIC_ERROR";

/**
 * Value-side surrogate for {@link FailureCode} so emitting code can reference
 * `FAILURE_CODES.TARGET_NOT_FOUND` instead of bare string literals (avoids
 * magic strings, gives one edit point). Frozen; keys === values === the
 * union. This is the ONLY runtime export in the module and the one thing a
 * unit test exercises (key/value identity + `Object.freeze`).
 */
export const FAILURE_CODES: { readonly [K in FailureCode]: K } = Object.freeze(
  {
    TARGET_NOT_FOUND: "TARGET_NOT_FOUND",
    TYPE_MISMATCH: "TYPE_MISMATCH",
    REGEX_NO_MATCH: "REGEX_NO_MATCH",
    COMPARISON_FAILED: "COMPARISON_FAILED",
    FORMAT_INVALID: "FORMAT_INVALID",
    AGGREGATE_MISMATCH: "AGGREGATE_MISMATCH",
    ARITHMETIC_ERROR: "ARITHMETIC_ERROR",
  } as const,
);

/**
 * The pure return shape EVERY operator-group evaluator (the five Layer-C
 * groups: comparison, pattern, existence, format, aggregate) produces. It is
 * the evaluation-outcome FRAGMENT — it deliberately omits the assertion
 * identity (the verbatim assertion string and the rendered target/operator
 * strings). `evaluator-core` (Layer D) later WRAPS a `GroupOutcome` into the
 * full {@link AssertionResult} by adding exactly `assertion` + `target` +
 * `operator` verbatim; a group evaluator never sees or sets those three.
 *
 * Invariants (consumers may rely on these without re-checking):
 * - Fully JSON-serializable. Every field is a JSON primitive, `boolean`, or
 *   `unknown` (a caller-supplied JSON value / normalized description). NEVER a
 *   live `RegExp`, `Date`, `Map`, or function — an operator reporting a regex
 *   puts its `source` string in `expected`, never the compiled matcher.
 * - `failureCode` and `reason` are present IFF `pass` is `false`. A passing
 *   outcome (`pass:true`) carries NEITHER (both omitted, not `undefined`-
 *   valued); a failing outcome (`pass:false`) carries BOTH.
 * - `expected`/`actual` are `unknown` because they may be any resolved JSON
 *   value or normalized description; serializers JSON-stringify them as-is.
 *
 * Lives here in `types.ts` (Layer A) — NOT in `evaluator-core` (Layer D
 * imports the group evaluators, so a `GroupOutcome` there would be circular)
 * and NOT in `target-resolver` (a resolver owning an evaluation-outcome type
 * is the wrong responsibility). It belongs with the other result types this
 * module already owns. Layer-C group evaluators import it from the Layer-A
 * `types.ts` barrel (`@/assertions`), never from `target-resolver`.
 */
export interface GroupOutcome {
  /** True iff the operator's predicate held. */
  readonly pass: boolean;
  /** What the assertion expected (JSON value); shape depends on operator. */
  readonly expected: unknown;
  /** What was actually resolved (JSON value). */
  readonly actual: unknown;
  /** Present IFF `pass` is false: the stable failure classification. */
  readonly failureCode?: FailureCode;
  /** Present IFF `pass` is false: a human-readable explanation. */
  readonly reason?: string;
}

/**
 * The outcome of evaluating one assertion against one execution. Fully
 * JSON-serializable (feeds §10 Reporting unchanged).
 *
 * Defined as `GroupOutcome & { assertion; target; operator }` so the two
 * shapes CANNOT drift: `AssertionResult` is, by construction, exactly a
 * {@link GroupOutcome} (the group evaluator's fragment) with the three
 * identity strings `evaluator-core` adds on top. Any field added to
 * `GroupOutcome` automatically flows here; the only delta is — and is
 * compiler-guaranteed to be — `assertion`/`target`/`operator`. On `pass:true`,
 * `failureCode`/`reason` are omitted (inherited from the `GroupOutcome`
 * invariant).
 */
export type AssertionResult = GroupOutcome & {
  /** Verbatim original assertion string (the AssertionAst.raw value). */
  readonly assertion: string;
  /** Human-readable rendering of the resolved target path. */
  readonly target: string;
  /** The operator that ran. */
  readonly operator: OperatorName;
};

/**
 * No-throw result of parsing ONE assertion string. House discriminated-result
 * idiom (cf. `parseJson` in `src/core/safe-json.ts`). Failure aggregates ALL
 * syntax errors for that one string into `errors` (mirrors the env-loader
 * "all missing secrets in one message" precedent — the parser does not stop
 * at the first error). Shape only; the parser task produces it.
 */
export type AssertionParseResult =
  | { readonly ok: true; readonly ast: AssertionAst }
  | { readonly ok: false; readonly errors: readonly string[] };

/** One assertion's outcome within a batch parse (see {@link BatchParseResult}). */
export interface AssertionParseEntry {
  /** The verbatim input string this entry corresponds to. */
  readonly assertion: string;
  /** This string's individual parse result. */
  readonly result: AssertionParseResult;
}

/**
 * Aggregate result of parsing an endpoint's whole `assertions: string[]`
 * block. `valid` is true iff every entry parsed. `errors` flattens every
 * failing entry's messages (each prefixed with its source string by the
 * batch task) so startup can report all problems at once (§4: invalid syntax
 * fails at startup, not runtime). Defined here; WIRING IS DEFERRED to Task
 * #10 — no batch logic is implemented by this task.
 */
export interface BatchParseResult {
  /** Per-string outcomes, in input order. */
  readonly entries: readonly AssertionParseEntry[];
  /** True iff every entry's result is `ok:true`. */
  readonly valid: boolean;
  /** Flattened, aggregated error messages across all failing entries. */
  readonly errors: readonly string[];
}

/**
 * Parsed components of the request URL, supplying `request.url.*` targets.
 * `path` is the URL path; `query` maps query-param names to their string
 * value(s) (repeated params → array). All values are strings (URL text is
 * untyped); the type-coercion task lifts them for numeric operators.
 */
export interface RequestUrlContext {
  /** Full request URL as sent. */
  readonly full: string;
  /** URL path component (e.g. `/users/42`). */
  readonly path: string;
  /** Decoded query parameters; repeated keys collapse to `string[]`. */
  readonly query: Readonly<Record<string, string | readonly string[]>>;
}

/** The `request` half of the evaluation context. */
export interface RequestContext {
  /** Sent request headers (case handling is the resolver's concern). */
  readonly headers: Readonly<Record<string, unknown>>;
  /** Sent request body (parsed JSON when applicable; else raw). */
  readonly body: unknown;
  /** Parsed URL parts for `request.url.*` targets. */
  readonly url: RequestUrlContext;
}

/** The `response` half of the evaluation context. */
export interface ResponseContext {
  /** Observed HTTP status code. */
  readonly status: number;
  /** Response headers. */
  readonly headers: Readonly<Record<string, unknown>>;
  /** Response body (parsed JSON when applicable; else raw). */
  readonly body: unknown;
  /** Observed response time in milliseconds. */
  readonly time_ms: number;
}

/**
 * Everything an assertion may resolve a target against, assembled by the
 * runner before evaluation. `db` is keyed connection → queryId →
 * {@link NormalizedResult} (the canonical shape from `src/core`, imported
 * here — not redefined). `now` is an injectable clock for
 * `is_recent_timestamp`; when omitted the evaluator task defaults to
 * `Date.now()` AT THE CALL SITE (the type leaves it optional so tests inject
 * a fixed instant for determinism — the default is NOT baked into the type).
 */
export interface EvaluationContext {
  /** Request side of the exchange. */
  readonly request: RequestContext;
  /** Response side of the exchange. */
  readonly response: ResponseContext;
  /** DB verification results: connection → queryId → normalized rows. */
  readonly db: Readonly<
    Record<string, Readonly<Record<string, NormalizedResult>>>
  >;
  /** Injectable epoch-ms clock for `is_recent_timestamp`; default Date.now(). */
  readonly now?: number;
}
