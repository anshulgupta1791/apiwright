/**
 * RhsResolver: translates an assertion's RHS `Operand` (from the parsed AST)
 * into a typed `RhsResolution` that the evaluator-core can pass directly to
 * a per-group evaluator. Bridges Layer-A operand shapes to Layer-C evaluation
 * contracts. Pure, deterministic, total, NEVER throws.
 */

import type { ArithmeticEvaluator } from "./arithmetic-evaluator.js";
import type { OperatorMeta } from "./operator-registry.js";
import type { AggregateRhs } from "./operators/aggregate-evaluator.js";
import type { ComparisonRhs } from "./operators/comparison-evaluator.js";
import type { ResolvedPatternRhs } from "./operators/pattern-evaluator.js";
import type { ResolvedValue, TargetResolver } from "./target-resolver.js";
import type {
  AssertionAst,
  EvaluationContext,
  FailureCode,
} from "./types.js";

/**
 * The discriminated resolution of a parsed RHS operand. One arm per operator
 * group. On `kind:"fail"` the evaluator-core short-circuits and wraps the
 * failure into the `AssertionResult` directly.
 */
export type RhsResolution =
  | { readonly kind: "none" }
  | { readonly kind: "comparison"; readonly rhs: ComparisonRhs }
  | { readonly kind: "pattern"; readonly rhs: ResolvedPatternRhs }
  | { readonly kind: "aggregate"; readonly rhs: AggregateRhs }
  | { readonly kind: "fail"; readonly failureCode: FailureCode; readonly reason: string };

/**
 * Translates an AST's `operand` into a typed `RhsResolution`. Delegates
 * target resolution to an injected `TargetResolver` and arithmetic evaluation
 * to an injected `ArithmeticEvaluator`. Pure, deterministic, NEVER throws.
 */
export class RhsResolver {
  readonly #targetResolver: TargetResolver;
  readonly #arithEvaluator: ArithmeticEvaluator;

  /**
   * Construct with injected collaborators (test seams).
   * @param targetResolver - Resolves TargetOperand RHS references.
   * @param arithEvaluator - Evaluates ArithmeticOperandNode RHS trees.
   */
  constructor(targetResolver: TargetResolver, arithEvaluator: ArithmeticEvaluator) {
    this.#targetResolver = targetResolver;
    this.#arithEvaluator = arithEvaluator;
  }

  /**
   * Resolve the RHS of `ast` given `meta.operandShape`. NEVER throws.
   * @param meta - Registry metadata for the operator (provides `operandShape`).
   * @param ast - The parsed assertion AST.
   * @param context - The hermetic evaluation context.
   * @returns A `RhsResolution` — one arm per group, or `kind:"fail"`.
   */
  resolve(meta: OperatorMeta, ast: AssertionAst, context: EvaluationContext): RhsResolution {
    const shape = meta.operandShape;

    if (shape === "none") return { kind: "none" };
    if (shape === "range") return this.#resolveRange(ast);
    if (shape === "regex") return this.#resolveRegex(ast);
    if (shape === "value") return this.#resolveValue(meta, ast, context);
    if (shape === "numeric") return this.#resolveNumeric(ast, context);
    return this.#resolveComparand(ast, context);
  }

  /**
   * Resolve a `range` operand shape (for `in_range`).
   * @param ast - The assertion AST.
   * @returns A comparison RHS with kind:"range".
   */
  #resolveRange(ast: AssertionAst): RhsResolution {
    const op = ast.operand;
    if (!op || op.kind !== "range") {
      return { kind: "fail", failureCode: "TYPE_MISMATCH", reason: "Expected a range operand" };
    }
    const rhs: ComparisonRhs = { kind: "range", lo: op.lo, hi: op.hi };
    return { kind: "comparison", rhs };
  }

  /**
   * Resolve a `regex` operand shape (for `matches`).
   * @param ast - The assertion AST.
   * @returns A pattern RHS with operator:"matches".
   */
  #resolveRegex(ast: AssertionAst): RhsResolution {
    const op = ast.operand;
    if (!op || op.kind !== "regex") {
      return { kind: "fail", failureCode: "TYPE_MISMATCH", reason: "Expected a regex operand" };
    }
    const rhs: ResolvedPatternRhs = { operator: "matches", operand: op };
    return { kind: "pattern", rhs };
  }

  /**
   * Resolve a `value` operand shape (for `contains`, `starts_with`, `ends_with`).
   * @param meta - Operator metadata (provides operator name).
   * @param ast - The assertion AST.
   * @param context - The evaluation context.
   * @returns A pattern RHS or kind:"fail".
   */
  #resolveValue(meta: OperatorMeta, ast: AssertionAst, context: EvaluationContext): RhsResolution {
    const op = ast.operand;
    const opName = meta.name as "contains" | "starts_with" | "ends_with";
    if (!op) {
      return { kind: "fail", failureCode: "TYPE_MISMATCH", reason: "Missing value operand" };
    }

    if (op.kind === "literal") {
      const rhs: ResolvedPatternRhs = { operator: opName, value: op.value };
      return { kind: "pattern", rhs };
    }

    if (op.kind === "target") {
      const resolved: ResolvedValue = this.#targetResolver.resolve(op.ref, context);
      if (!resolved.found) {
        return {
          kind: "fail",
          failureCode: "TARGET_NOT_FOUND",
          reason: "RHS target not found in evaluation context",
        };
      }
      const rhs: ResolvedPatternRhs = { operator: opName, value: resolved.value };
      return { kind: "pattern", rhs };
    }

    return {
      kind: "fail",
      failureCode: "TYPE_MISMATCH",
      reason: "Unexpected operand kind for value shape",
    };
  }

  /**
   * Resolve a `numeric` operand shape (for `count_equals`, `count_greater_than`).
   * @param ast - The assertion AST.
   * @param context - The evaluation context.
   * @returns An aggregate RHS or kind:"fail".
   */
  #resolveNumeric(ast: AssertionAst, context: EvaluationContext): RhsResolution {
    const op = ast.operand;
    if (!op) {
      return { kind: "fail", failureCode: "TYPE_MISMATCH", reason: "Missing numeric operand" };
    }

    if (op.kind === "literal") {
      return { kind: "aggregate", rhs: { count: op.value } };
    }

    if (op.kind === "target") {
      const resolved: ResolvedValue = this.#targetResolver.resolve(op.ref, context);
      if (!resolved.found) {
        return {
          kind: "fail",
          failureCode: "TARGET_NOT_FOUND",
          reason: "RHS target not found in evaluation context",
        };
      }
      return { kind: "aggregate", rhs: { count: resolved.value } };
    }

    return {
      kind: "fail",
      failureCode: "TYPE_MISMATCH",
      reason: "Unexpected operand kind for numeric shape",
    };
  }

  /**
   * Resolve a `comparand` operand shape (for `equals`, `not_equals`,
   * `greater_than`, `less_than`). Accepts literal, target, and arithmetic.
   * @param ast - The assertion AST.
   * @param context - The evaluation context.
   * @returns A comparison RHS or kind:"fail".
   */
  #resolveComparand(ast: AssertionAst, context: EvaluationContext): RhsResolution {
    const op = ast.operand;
    if (!op) {
      return { kind: "fail", failureCode: "TYPE_MISMATCH", reason: "Missing comparand operand" };
    }

    if (op.kind === "literal") {
      const rhs: ComparisonRhs = { kind: "comparand", comparand: op.value };
      return { kind: "comparison", rhs };
    }

    if (op.kind === "target") {
      const resolved: ResolvedValue = this.#targetResolver.resolve(op.ref, context);
      if (!resolved.found) {
        return {
          kind: "fail",
          failureCode: "TARGET_NOT_FOUND",
          reason: "RHS target not found in evaluation context",
        };
      }
      const rhs: ComparisonRhs = { kind: "comparand", comparand: resolved.value };
      return { kind: "comparison", rhs };
    }

    if (op.kind === "arithmetic") {
      const outcome = this.#arithEvaluator.evaluate(op.expr, context);
      if (!outcome.ok) {
        return {
          kind: "fail",
          failureCode: outcome.failureCode,
          reason: outcome.reason,
        };
      }
      const rhs: ComparisonRhs = { kind: "comparand", comparand: outcome.value };
      return { kind: "comparison", rhs };
    }

    return {
      kind: "fail",
      failureCode: "TYPE_MISMATCH",
      reason: "Unexpected operand kind for comparand shape",
    };
  }
}
