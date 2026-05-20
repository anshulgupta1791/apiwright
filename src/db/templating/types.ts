/**
 * Type declarations for the DB template-ref extraction and resolution system.
 * Pure type declarations — no runtime logic; coverage-excluded by convention.
 * Produced by `extractRefs` (load-time) and `resolveRefs` (exec-time).
 */

/**
 * The four template namespaces a DB query `${...}` ref may address in v1.0.
 * Closed string-literal union (repo idiom — cf. `DatabaseType`,
 * `OperatorName`): structural, zero runtime cost, narrows in `switch`. Any
 * other namespace (`secret.*`, `db.*`, `token`, …) is, by the
 * `no-silent-passthrough` rule, a rejected ref.
 *
 * - `env`        — load-time resolvable via `src/env` `resolveTemplates`.
 * - `request.body`  — runtime; context supplied by Task #10.
 * - `response.body` — runtime; context supplied by Task #10.
 */
export type TemplateNamespace =
  | "env"
  | "request.body"
  | "response.body";

/**
 * One distinct, classified `${...}` reference extracted from a query.
 * De-duplicated: two textually-identical refs collapse to ONE `Ref`/binding
 * (same `index`), yet EVERY textual occurrence in the neutral query maps to
 * that one binding (occurrence list preserved separately on the result).
 *
 * `path` is the namespace-relative dotted path EXACTLY as authored, retained
 * verbatim for: (a) `${env.*}` → handed to the env resolver's lookup, (b)
 * `request.body.*` / `response.body.*` → segmented with the §4
 * `classifyPath` rule (all-digits-no-leading-zero ⇒ array index) into
 * {@link PathSegment}s at resolution time, then fed to the shared
 * `src/core` bounded path-walk.
 */
export interface Ref {
  /**
   * 0-based ordinal in the neutral query's placeholder sequence — also the
   * index of this ref's value in the resolved `orderedValues` array. Stable
   * for a given query string (left-to-right first-occurrence order).
   */
  readonly index: number;
  /** Which classified namespace this ref draws from. */
  readonly namespace: TemplateNamespace;
  /** Namespace-relative dotted path, verbatim (e.g. `user.id`, `db.host`). */
  readonly path: string;
  /** The verbatim original token incl. delimiters, e.g. `${env.db.host}`. */
  readonly raw: string;
}

/**
 * The engine-neutral extraction output. `neutralQuery` matches the SHAPE of
 * the input: a `string` for SQL/Cypher, a deep-cloned plain object/array for
 * a Mongo command document (string leaves had their `${...}` refs replaced;
 * structure/keys untouched — see Mongo handling). It contains the neutral
 * placeholder sentinel, NEVER a resolved value.
 *
 * `refs` is the de-duplicated, index-ordered binding list; `occurrences`
 * lists every textual placeholder site mapped to its `refs` index so the
 * later engine-binder can emit one native placeholder per site even when the
 * same `${...}` appears twice. `query` is the verbatim input echoed back for
 * the no-interpolation proof test.
 */
export interface NeutralQuery {
  /** The de-templated query (string for SQL/Cypher; object for Mongo). */
  readonly neutralQuery: string | Readonly<Record<string, unknown>> | readonly unknown[];
  /** Distinct classified refs, ordered by first textual occurrence. */
  readonly refs: readonly Ref[];
  /**
   * Every placeholder SITE in document order, each pointing at its `refs`
   * index. Length ≥ `refs.length` (repeats add sites, not refs).
   */
  readonly occurrences: readonly { readonly refIndex: number }[];
  /** The verbatim input query (string) or a marker that it was object-shaped. */
  readonly source: string | { readonly kind: "mongo-document" };
}

/**
 * One resolved binding value, positionally aligned to `NeutralQuery.refs`.
 * `value` MAY be `null` — an explicitly-authored JSON `null` that RESOLVED
 * (distinct from a missing path, per §4/env locked decision #6 — now
 * enforced by the shared `src/core` path-walk's found/not-found contract).
 * Never `undefined` (a found value is never `undefined`; missing ⇒ rejection).
 */
export interface BoundValue {
  /** Aligns to `Ref.index`. */
  readonly index: number;
  /** The resolved JSON value (scalar/array/object/null). */
  readonly value: unknown;
}

/**
 * The runtime resolution context (supplied by Task #10 at execution time).
 * `env` is the already-loaded `ResolvedEnvironment` (`src/env`); `request`
 * /`response` bodies are the parsed exchange bodies. Optional fields model
 * "not available yet": a ref into an absent half is a structured rejection,
 * never a throw.
 */
export interface ResolutionContext {
  /** Resolved environment for `${env.*}` (reuses `src/env` lookup). */
  readonly env: Readonly<Record<string, unknown>>;
  /** Parsed request body for `${request.body.*}` (may be absent). */
  readonly requestBody?: unknown;
  /** Parsed response body for `${response.body.*}` (may be absent). */
  readonly responseBody?: unknown;
}

/** Stable machine code for one unresolved/invalid ref. */
export type RefRejectionCode =
  /** Namespace not in {@link TemplateNamespace} (e.g. `${secret.*}`). */
  | "UNKNOWN_NAMESPACE"
  /** Empty / malformed token (e.g. `${}`, `${env.}`, `${ }`). */
  | "MALFORMED_REF"
  /** Namespace valid but path did not resolve in the context. */
  | "UNRESOLVED_REF";

/** One structured rejection naming the offending ref (no value, no secret). */
export interface RefRejection {
  /** Stable code. */
  readonly code: RefRejectionCode;
  /** The verbatim offending token (`raw`); never a resolved value. */
  readonly ref: string;
  /** Namespace-relative path when parseable, else the raw inner text. */
  readonly path: string;
  /** Human-readable, value-free explanation naming the ref. */
  readonly message: string;
}

/**
 * No-throw discriminated result of EXTRACTION (house idiom — cf.
 * `JsonParseResult`, `AssertionParseResult`). Failure AGGREGATES every
 * malformed/unknown-namespace ref in one pass (mirrors the env-loader
 * "all missing in one message" precedent).
 */
export type ExtractResult =
  | { readonly ok: true; readonly neutral: NeutralQuery }
  | { readonly ok: false; readonly rejections: readonly RefRejection[] };

/**
 * No-throw discriminated result of RESOLUTION. Failure AGGREGATES every
 * unresolved ref. The success side is the positionally-ordered value list
 * the engine-binder consumes; the query text is NOT carried here (it never
 * changed) — the caller already holds `NeutralQuery.neutralQuery`.
 */
export type ResolveResult =
  | { readonly ok: true; readonly values: readonly BoundValue[] }
  | { readonly ok: false; readonly rejections: readonly RefRejection[] };
