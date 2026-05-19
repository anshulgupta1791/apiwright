/**
 * AST node vocabulary for parsed assertions: the target reference, the
 * operand (RHS) union, and the bounded arithmetic-expression tree. These are
 * pure declarations; the tokenizer/parser tasks construct these shapes and the
 * evaluator consumes them. Split from `./types.ts` for the 300-line soft limit
 * and re-exported there so `../assertions/index.js` is the single surface.
 *
 * Pure type declarations — no runtime logic.
 */

import type { OperatorName } from "./types.js";

/**
 * One step in a dot-notation target path. An assertion path such as
 * `response.body.items.0.id` decomposes (after the root) into ordered
 * segments; a segment is either an object key or a numeric array index. The
 * resolver task uses the discriminant to choose property access vs. array
 * indexing, so `items.0` (index 0) is never confused with a literal `"0"`
 * key. The tokenizer decides the kind: an all-digits segment with no leading
 * zero (other than the literal `0`) is `index`; everything else is `key`.
 */
export type PathSegment =
  | { readonly kind: "key"; readonly key: string }
  | { readonly kind: "index"; readonly index: number };

/**
 * The fixed root namespaces an assertion target may address, per §4 targets.
 * Used as the discriminant of {@link TargetRef}. `db` is modeled separately
 * because it carries connection + queryId before its trailing path.
 */
export type TargetRoot =
  | "request.headers"
  | "request.body"
  | "request.url"
  | "response.status"
  | "response.headers"
  | "response.body"
  | "response.time_ms"
  | "db";

/**
 * A resolved-at-parse-time reference to a value in the
 * {@link EvaluationContext}. Discriminated by `root`. Leaf roots
 * (`response.status`, `response.time_ms`) carry no path. Container roots
 * (`*.headers`, `*.body`, `request.url`) carry an ordered `path` of
 * {@link PathSegment}s (possibly empty — e.g. `response.body` with no
 * sub-path addresses the whole body). The `db` variant additionally carries
 * `connection` and `queryId` naming the verification query whose
 * {@link NormalizedResult} the trailing `path` indexes (e.g.
 * `db.primary_postgres.user_check.rows.0.id`). The `NormalizedResult` shape
 * (from `src/core`) is the indexed type for the `db` path.
 */
export type TargetRef =
  | { readonly root: "request.headers"; readonly path: readonly PathSegment[] }
  | { readonly root: "request.body"; readonly path: readonly PathSegment[] }
  | { readonly root: "request.url"; readonly path: readonly PathSegment[] }
  | { readonly root: "response.status" }
  | {
      readonly root: "response.headers";
      readonly path: readonly PathSegment[];
    }
  | { readonly root: "response.body"; readonly path: readonly PathSegment[] }
  | { readonly root: "response.time_ms" }
  | {
      readonly root: "db";
      /** Connection name (key into `EvaluationContext.db`). */
      readonly connection: string;
      /** Named verification query id (key into the connection map). */
      readonly queryId: string;
      /** Trailing path into the query's `NormalizedResult` (from `src/core`). */
      readonly path: readonly PathSegment[];
    };

/**
 * A scalar literal RHS value. The four primitive JSON value kinds an operand
 * may carry directly (string, number, boolean, null). Objects/arrays are not
 * valid literal operands in v1.0 (§4 vocabulary is scalar/regex/arithmetic).
 */
export type LiteralValue = string | number | boolean | null;

/** Operand discriminant tag set (see each `*Operand` member). */
export type OperandKind =
  | "literal"
  | "target"
  | "regex"
  | "arithmetic"
  | "range";

/** A literal RHS, e.g. `equals 201` or `starts_with "Bearer "`. */
export interface LiteralOperand {
  /** Discriminant. */
  readonly kind: "literal";
  /** The parsed scalar value. */
  readonly value: LiteralValue;
}

/** A target-reference RHS, e.g. `equals request.body.email`. */
export interface TargetOperand {
  /** Discriminant. */
  readonly kind: "target";
  /** The referenced target. */
  readonly ref: TargetRef;
}

/**
 * A compiled-regex RHS for the `matches` operator. The pattern is compiled at
 * parse time (by the regex-compiler task, not here) so invalid patterns fail
 * at startup; `source` and `rawFlags` retain the author's text for the
 * verbatim {@link AssertionResult}. `flags` is the validated subset
 * (⊆ `{ i, m, s, u }`); the literal `compiled` `RegExp` is non-enumerable
 * intent only and is NEVER serialized (see JSON-serializability note).
 */
export interface RegexOperand {
  /** Discriminant. */
  readonly kind: "regex";
  /** Raw pattern body as written between the delimiters. */
  readonly source: string;
  /** Raw flag characters exactly as the author wrote them. */
  readonly rawFlags: string;
  /** Validated flag subset (each char one of i, m, s, u; deduped, sorted). */
  readonly flags: readonly RegexFlag[];
  /** Parse-time-compiled matcher. Constructed by the regex-compiler task. */
  readonly compiled: RegExp;
}

/** Whitelisted regex flag characters (⊆ ECMAScript {i,m,s,u}). */
export type RegexFlag = "i" | "m" | "s" | "u";

/** Binary arithmetic operators permitted in the bounded grammar. */
export type ArithmeticOperator = "+" | "-" | "*" | "/";

/**
 * A leaf in an {@link ArithmeticExpr} tree: a numeric literal or a
 * target reference (resolved to a number at evaluation; non-numeric resolved
 * values raise `ARITHMETIC_ERROR`). No string concat, no functions, no
 * exponent — the grammar is intentionally bounded (§4).
 */
export type ArithmeticOperand =
  | { readonly kind: "number"; readonly value: number }
  | { readonly kind: "target"; readonly ref: TargetRef };

/**
 * A bounded arithmetic-expression tree: either a leaf operand or a binary
 * node combining two sub-expressions with `+ - * /`. Standard precedence and
 * parenthesization are resolved by the parser into this tree's shape (the
 * tree IS the precedence — no operator field ambiguity). Recursive; depth is
 * bounded by the parser task, not the type.
 */
export type ArithmeticExpr =
  | ArithmeticOperand
  | {
      readonly kind: "binary";
      readonly op: ArithmeticOperator;
      readonly left: ArithmeticExpr;
      readonly right: ArithmeticExpr;
    };

/** An arithmetic-expression RHS, e.g. `equals (request.body.subtotal * 1.08)`. */
export interface ArithmeticOperandNode {
  /** Discriminant. */
  readonly kind: "arithmetic";
  /** The bounded expression tree. */
  readonly expr: ArithmeticExpr;
}

/**
 * A numeric range RHS for `in_range`, e.g. `in_range 100..599`. Invariant
 * `lo <= hi` is established by the parser task and documented here; the type
 * cannot enforce it structurally but every constructor MUST guarantee it and
 * the parser emits a syntax error otherwise (so consumers may assume it).
 */
export interface RangeOperand {
  /** Discriminant. */
  readonly kind: "range";
  /** Inclusive lower bound; guaranteed `lo <= hi`. */
  readonly lo: number;
  /** Inclusive upper bound; guaranteed `lo >= ...` i.e. `hi >= lo`. */
  readonly hi: number;
}

/**
 * The RHS of an assertion. Absent entirely for nullary operators (existence
 * and type/format groups take no operand — see {@link AssertionAst.operand}).
 */
export type Operand =
  | LiteralOperand
  | TargetOperand
  | RegexOperand
  | ArithmeticOperandNode
  | RangeOperand;

/**
 * One fully-parsed assertion. `raw` retains the author's verbatim source
 * string (whitespace-trimmed) so it can flow unchanged into
 * {@link AssertionResult} and §10 reporting. `operand` is omitted
 * for nullary operators (existence/format groups); present for all others.
 */
export interface AssertionAst {
  /** Verbatim original assertion string (trimmed), retained for reporting. */
  readonly raw: string;
  /** The resolved target reference. */
  readonly target: TargetRef;
  /** The operator name (one of the 20). */
  readonly operator: OperatorName;
  /** The RHS; absent for nullary (existence/format) operators. */
  readonly operand?: Operand;
}
