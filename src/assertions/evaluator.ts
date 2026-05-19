/**
 * Layer-D evaluation-side orchestrator: evaluates ONE parsed `AssertionAst`
 * against ONE `EvaluationContext` to produce ONE fully-populated
 * `AssertionResult`. This is the integration point of all Layer-A/B/C work.
 *
 * Pure, deterministic, total, NEVER throws.
 */

import { ArithmeticEvaluator } from "./arithmetic-evaluator.js";
import { OPERATOR_REGISTRY } from "./operator-registry.js";
import { AggregateEvaluator } from "./operators/aggregate-evaluator.js";
import { ComparisonEvaluator } from "./operators/comparison-evaluator.js";
import { ExistenceEvaluator } from "./operators/existence-evaluator.js";
import { FormatEvaluator } from "./operators/format-evaluator.js";
import { PatternEvaluator } from "./operators/pattern-evaluator.js";
import { RhsResolver } from "./rhs-resolver.js";
import { TargetResolver } from "./target-resolver.js";
import { FAILURE_CODES } from "./types.js";
import type {
  AssertionAst,
  AssertionResult,
  EvaluationContext,
  GroupOutcome,
  OperatorName,
  PathSegment,
  TargetRef,
} from "./types.js";

/**
 * Injectable collaborators for `AssertionEvaluator`. Each field is optional;
 * the evaluator constructs a real default when the field is absent. Use in
 * tests to stub individual operator evaluators.
 */
export interface AssertionEvaluatorDeps {
  /** Override the comparison-operator evaluator. */
  readonly comparison?: Pick<ComparisonEvaluator, "evaluate">;
  /** Override the pattern-operator evaluator. */
  readonly pattern?: Pick<PatternEvaluator, "evaluate">;
  /** Override the existence-operator evaluator. */
  readonly existence?: Pick<ExistenceEvaluator, "evaluate">;
  /** Override the format-operator evaluator. */
  readonly format?: Pick<FormatEvaluator, "evaluate">;
  /** Override the aggregate-operator evaluator. */
  readonly aggregate?: Pick<AggregateEvaluator, "evaluate">;
  /** Override the target resolver. */
  readonly targetResolver?: Pick<TargetResolver, "resolve">;
  /** Override the arithmetic evaluator. */
  readonly arithmetic?: Pick<ArithmeticEvaluator, "evaluate">;
}

/**
 * The Layer-D evaluation orchestrator. Evaluates one `AssertionAst` against
 * one `EvaluationContext` into one `AssertionResult`. Stateless after
 * construction. NEVER throws.
 */
export class AssertionEvaluator {
  readonly #comparison: Pick<ComparisonEvaluator, "evaluate">;
  readonly #pattern: Pick<PatternEvaluator, "evaluate">;
  readonly #existence: Pick<ExistenceEvaluator, "evaluate">;
  readonly #format: Pick<FormatEvaluator, "evaluate">;
  readonly #aggregate: Pick<AggregateEvaluator, "evaluate">;
  readonly #targetResolver: Pick<TargetResolver, "resolve">;
  readonly #rhsResolver: RhsResolver;

  /**
   * Constructs the evaluator with optional dependency overrides.
   * @param deps - Optional injectable collaborators (test seams).
   */
  constructor(deps?: AssertionEvaluatorDeps) {
    const targetResolver = deps?.targetResolver ?? new TargetResolver();
    const arithEvaluator = deps?.arithmetic
      ? { evaluate: deps.arithmetic.evaluate.bind(deps.arithmetic) }
      : new ArithmeticEvaluator(targetResolver as TargetResolver);

    this.#targetResolver = targetResolver;
    this.#comparison = deps?.comparison ?? new ComparisonEvaluator();
    this.#pattern = deps?.pattern ?? new PatternEvaluator();
    this.#existence = deps?.existence ?? new ExistenceEvaluator();
    this.#format = deps?.format ?? new FormatEvaluator();
    this.#aggregate = deps?.aggregate ?? new AggregateEvaluator();
    this.#rhsResolver = new RhsResolver(
      targetResolver as TargetResolver,
      arithEvaluator as ArithmeticEvaluator,
    );
  }

  /**
   * Evaluate `ast` against `context`. NEVER throws. Pure + deterministic.
   * @param ast - The parsed Layer-A assertion AST.
   * @param context - The hermetic evaluation context.
   * @returns A fully-populated `AssertionResult`.
   */
  evaluate(ast: AssertionAst, context: EvaluationContext): AssertionResult {
    const targetStr = this.#renderTarget(ast.target);
    const operator = ast.operator;

    const meta = OPERATOR_REGISTRY[operator];

    if (!meta) {
      return this.#buildResult(ast.raw, targetStr, operator, {
        pass: false,
        expected: undefined,
        actual: undefined,
        failureCode: "TYPE_MISMATCH",
        reason: `Unknown operator '${operator}'`,
      });
    }

    // Step 1: Resolve LHS target
    const lhs = this.#resolveLhs(ast.target, context);

    // Step 2: Resolve RHS
    const rhsResolution = this.#rhsResolver.resolve(meta, ast, context);

    if (rhsResolution.kind === "fail") {
      return this.#buildResult(ast.raw, targetStr, operator, {
        pass: false,
        expected: undefined,
        actual: undefined,
        failureCode: rhsResolution.failureCode,
        reason: rhsResolution.reason,
      });
    }

    // Step 3: Dispatch to group evaluator
    const outcome = this.#dispatch(ast, lhs, rhsResolution, context);

    return this.#buildResult(ast.raw, targetStr, operator, outcome);
  }

  /**
   * Resolve the LHS target. Wraps `context` access in a try/catch to ensure
   * never-throws even if `context` is adversarially null/undefined.
   * @param target - The LHS TargetRef.
   * @param context - The evaluation context.
   * @returns The resolved value.
   */
  #resolveLhs(
    target: TargetRef,
    context: EvaluationContext,
  ): ReturnType<TargetResolver["resolve"]> {
    try {
      return this.#targetResolver.resolve(target, context);
    } catch {
      return { found: false };
    }
  }

  /**
   * Dispatch to the appropriate group evaluator based on the RHS resolution
   * kind + operator group.
   * @param ast - The parsed AST.
   * @param lhs - The resolved LHS.
   * @param resolution - The resolved RHS (already validated kind).
   * @param context - The evaluation context.
   * @returns GroupOutcome.
   */
  #dispatch(
    ast: AssertionAst,
    lhs: ReturnType<TargetResolver["resolve"]>,
    resolution: Exclude<ReturnType<RhsResolver["resolve"]>, { kind: "fail" }>,
    context: EvaluationContext,
  ): GroupOutcome {
    const op = ast.operator;
    const meta = OPERATOR_REGISTRY[op];
    if (!meta) return this.#unreachableGroup(op);

    const group = meta.group;

    if (group === "comparison") {
      if (resolution.kind !== "comparison") return this.#unreachableGroup(op);
      const opName = op as "equals" | "not_equals" | "greater_than" | "less_than" | "in_range";
      return this.#comparison.evaluate(opName, lhs, resolution.rhs);
    }

    if (group === "existence") {
      const opName = op as "exists" | "not_exists" | "is_null" | "is_not_null";
      return this.#existence.evaluate(opName, lhs);
    }

    if (group === "format") {
      const opName =
        op as "is_uuid_v4" | "is_iso_timestamp" | "is_recent_timestamp" | "is_email" | "is_url";
      return this.#format.evaluate(opName, lhs, context);
    }

    if (group === "pattern") {
      if (resolution.kind !== "pattern") return this.#unreachableGroup(op);
      const opName = op as "matches" | "contains" | "starts_with" | "ends_with";
      return this.#pattern.evaluate(opName, lhs, resolution.rhs);
    }

    if (group === "aggregate") {
      if (resolution.kind !== "aggregate") return this.#unreachableGroup(op);
      const opName = op as "count_equals" | "count_greater_than";
      return this.#aggregate.evaluate(opName, lhs, resolution.rhs);
    }

    return this.#unreachableGroup(op);
  }

  /**
   * Fallback for operators that aren't in any known group — returns a FAIL
   * without throwing. Covers the `#unreachableGroup` test path.
   * @param op - The unknown operator string.
   * @returns A failing GroupOutcome.
   */
  #unreachableGroup(op: string): GroupOutcome {
    return {
      pass: false,
      expected: undefined,
      actual: undefined,
      failureCode: FAILURE_CODES.TYPE_MISMATCH,
      reason: `No evaluator for operator '${op}'`,
    };
  }

  /**
   * Render a `TargetRef` into a human-readable dot-notation string.
   * @param ref - The target reference.
   * @returns A string like `response.body.items.0.id` or `db.conn.qid`.
   */
  #renderTarget(ref: TargetRef): string {
    const base = this.#renderTargetBase(ref);
    const path = "path" in ref ? ref.path : undefined;
    if (!path || path.length === 0) return base;
    return `${base}.${path.map((s) => this.#renderSegment(s)).join(".")}`;
  }

  /**
   * Render the root portion of a TargetRef (before any trailing path).
   * @param ref - The target reference.
   * @returns The root string.
   */
  #renderTargetBase(ref: TargetRef): string {
    if (ref.root === "db") {
      return `db.${ref.connection}.${ref.queryId}`;
    }
    return ref.root;
  }

  /**
   * Render one path segment as a string.
   * @param seg - A path segment.
   * @returns The segment string (key name or index number).
   */
  #renderSegment(seg: PathSegment): string {
    return seg.kind === "key" ? seg.key : String(seg.index);
  }

  /**
   * Build a complete `AssertionResult` from an identity trio plus a
   * `GroupOutcome`. On pass the result has no `failureCode` or `reason` keys.
   * @param assertion - The verbatim raw assertion string.
   * @param target - The rendered target string.
   * @param operator - The operator name.
   * @param outcome - The group outcome fragment.
   * @returns A fully-populated, JSON-serializable `AssertionResult`.
   */
  #buildResult(
    assertion: string,
    target: string,
    operator: string,
    outcome: GroupOutcome,
  ): AssertionResult {
    const base = {
      assertion,
      target,
      operator: operator as OperatorName,
      pass: outcome.pass,
      expected: outcome.expected,
      actual: outcome.actual,
    };
    if (outcome.pass) return base;
    return {
      ...base,
      failureCode: outcome.failureCode ?? "TYPE_MISMATCH",
      reason: outcome.reason ?? "Unknown failure",
    };
  }
}
