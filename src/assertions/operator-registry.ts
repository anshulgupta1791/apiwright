/**
 * The single, code-only-extensible operator registry for the §4 assertions
 * engine. Maps every one of the 20 {@link OperatorName} literals to an
 * {@link OperatorMeta} descriptor. Pure data + lookup: NO evaluation, parsing,
 * regex compilation, range validation, or coercion lives here (those are the
 * per-group operator / parser / regex-compiler tasks). Both the
 * parser-orchestrator (validates each operator's RHS operand shape) and the
 * evaluator-core (routes an operator to its group evaluator) dispatch through
 * this module. Idiom mirror of `src/test-catalog/marker-classifier.ts`'s
 * frozen total `MARKER_MAP`. Extensible ONLY by editing code (a new operator
 * requires a Layer-A union edit AND a row here; the type system forces both).
 */

import type { OperatorGroup, OperatorName } from "./types.js";

/** Count of supported operators; the registry has exactly this many rows. */
export const OPERATOR_COUNT = 20;

/**
 * The RHS operand-shape contract an operator imposes, validated by the
 * parser-orchestrator AFTER the operand-parser has produced an
 * {@link Operand}. This is a *shape requirement*, NOT evaluation.
 *
 * - `none`     — operator is nullary; the AST MUST omit `operand`.
 * - `value`    — exactly one {@link LiteralOperand} or {@link TargetOperand}.
 * - `comparand`— exactly one {@link LiteralOperand}, {@link TargetOperand},
 *                OR {@link ArithmeticOperandNode}.
 * - `range`    — exactly one {@link RangeOperand} (two numeric bounds).
 * - `regex`    — exactly one {@link RegexOperand} (a regex literal).
 * - `numeric`  — exactly one {@link LiteralOperand} (numeric) or
 *                {@link TargetOperand}.
 */
export type OperandShape =
  | "none"
  | "value"
  | "comparand"
  | "range"
  | "regex"
  | "numeric";

/**
 * Immutable metadata for one assertion operator. Carries ONLY routing/shape
 * facts — never behavior. Consumed by the parser-orchestrator (`operandShape`
 * + `allowsArithmeticRhs` ⇒ RHS legality) and the evaluator-core (`group` ⇒
 * which group evaluator runs). `name` is duplicated into the value for
 * ergonomic table-driven iteration and so a descriptor is self-describing
 * when passed alone.
 */
export interface OperatorMeta {
  /** Canonical operator name; equals this entry's key in the registry. */
  readonly name: OperatorName;
  /** The §4 family; the evaluator-core's routing discriminant. */
  readonly group: OperatorGroup;
  /** Required RHS operand shape; the parser-orchestrator's legality rule. */
  readonly operandShape: OperandShape;
  /**
   * True iff this operator accepts an {@link ArithmeticOperandNode} RHS.
   * Locked: true ONLY for the five comparison operators
   * (`equals`, `not_equals`, `greater_than`, `less_than`, `in_range`);
   * false for every pattern/existence/type-format/aggregate operator.
   */
  readonly allowsArithmeticRhs: boolean;
}

/**
 * The total operator registry: a row for EVERY {@link OperatorName}. The
 * `Readonly<Record<OperatorName, OperatorMeta>>` annotation makes a missing
 * operator a COMPILE error and an out-of-vocabulary key impossible.
 * Frozen at module load via `Object.freeze`.
 */
export const OPERATOR_REGISTRY: Readonly<Record<OperatorName, OperatorMeta>> = Object.freeze({
  equals: {
    name: "equals", group: "comparison", operandShape: "comparand", allowsArithmeticRhs: true,
  },
  not_equals: {
    name: "not_equals", group: "comparison", operandShape: "comparand", allowsArithmeticRhs: true,
  },
  greater_than: {
    name: "greater_than", group: "comparison", operandShape: "comparand", allowsArithmeticRhs: true,
  },
  less_than: {
    name: "less_than", group: "comparison", operandShape: "comparand", allowsArithmeticRhs: true,
  },
  in_range: {
    name: "in_range", group: "comparison", operandShape: "range", allowsArithmeticRhs: true,
  },
  matches: {
    name: "matches", group: "pattern", operandShape: "regex", allowsArithmeticRhs: false,
  },
  contains: {
    name: "contains", group: "pattern", operandShape: "value", allowsArithmeticRhs: false,
  },
  starts_with: {
    name: "starts_with", group: "pattern", operandShape: "value", allowsArithmeticRhs: false,
  },
  ends_with: {
    name: "ends_with", group: "pattern", operandShape: "value", allowsArithmeticRhs: false,
  },
  exists: {
    name: "exists", group: "existence", operandShape: "none", allowsArithmeticRhs: false,
  },
  not_exists: {
    name: "not_exists", group: "existence", operandShape: "none", allowsArithmeticRhs: false,
  },
  is_null: {
    name: "is_null", group: "existence", operandShape: "none", allowsArithmeticRhs: false,
  },
  is_not_null: {
    name: "is_not_null", group: "existence", operandShape: "none", allowsArithmeticRhs: false,
  },
  is_uuid_v4: {
    name: "is_uuid_v4", group: "format", operandShape: "none", allowsArithmeticRhs: false,
  },
  is_iso_timestamp: {
    name: "is_iso_timestamp", group: "format", operandShape: "none", allowsArithmeticRhs: false,
  },
  is_recent_timestamp: {
    name: "is_recent_timestamp", group: "format", operandShape: "none", allowsArithmeticRhs: false,
  },
  is_email: {
    name: "is_email", group: "format", operandShape: "none", allowsArithmeticRhs: false,
  },
  is_url: {
    name: "is_url", group: "format", operandShape: "none", allowsArithmeticRhs: false,
  },
  count_equals: {
    name: "count_equals", group: "aggregate", operandShape: "numeric", allowsArithmeticRhs: false,
  },
  count_greater_than: {
    name: "count_greater_than", group: "aggregate", operandShape: "numeric",
    allowsArithmeticRhs: false,
  },
});

/**
 * No-throw lookup of an operator's metadata. Returns the descriptor for a
 * known name or `undefined` for an unknown one.
 * @param name - Raw operator token as written in the assertion source.
 * @returns The {@link OperatorMeta}, or `undefined` if `name` is unknown.
 */
export function lookupOperator(name: string): OperatorMeta | undefined {
  return Object.prototype.hasOwnProperty.call(OPERATOR_REGISTRY, name)
    ? OPERATOR_REGISTRY[name as OperatorName]
    : undefined;
}

/**
 * Type guard: true iff `name` is one of the 20 supported operators.
 * @param name - Raw operator token to test.
 * @returns True when `name` is a known {@link OperatorName}.
 */
export function isOperatorName(name: string): name is OperatorName {
  return lookupOperator(name) !== undefined;
}

/**
 * All supported operator names, in registry declaration order.
 * @returns A readonly array of every {@link OperatorName}.
 */
export function allOperatorNames(): readonly OperatorName[] {
  return Object.keys(OPERATOR_REGISTRY) as OperatorName[];
}
