/**
 * Layer-C arithmetic evaluator: folds a parsed `ArithmeticExpr` tree into a
 * single finite JS number. Pure, deterministic, total, NEVER throws.
 *
 * Error precedence (left-to-right): the left sub-tree is evaluated first; if it
 * fails, the right sub-tree is NOT evaluated (short-circuit). This gives
 * deterministic left-wins ordering for `(a/0) + missing` type scenarios.
 */

import { TargetResolver } from "./target-resolver.js";
import type { ResolvedValue } from "./target-resolver.js";
import type { ArithmeticExpr, EvaluationContext } from "./types.js";

/**
 * Maximum number of AST nodes the evaluator will visit in a single call.
 * A pathologically large tree returns `ok:false ARITHMETIC_ERROR` before it
 * can exhaust stack or time. Named constant per the `no-magic-numbers` rule.
 */
export const MAX_ARITH_EVAL_NODES = 4096;

/**
 * The discriminated outcome of evaluating one arithmetic expression.
 * - `ok:true` — evaluation succeeded; `value` is finite.
 * - `ok:false` — one of three failure modes (see `failureCode`).
 */
export type ArithmeticOutcome =
  | { readonly ok: true; readonly value: number }
  | {
      readonly ok: false;
      readonly failureCode: "ARITHMETIC_ERROR" | "TARGET_NOT_FOUND" | "TYPE_MISMATCH";
      readonly reason: string;
    };

/** Internal mutable work counter passed by reference through the walk. */
interface NodeCounter {
  /** Remaining node budget; decremented on each visit. */
  remaining: number;
}

/**
 * Evaluates parsed arithmetic expression trees to finite numbers. Stateless;
 * accepts an optional `TargetResolver` injection for the test seam.
 */
export class ArithmeticEvaluator {
  readonly #resolver: TargetResolver;

  /**
   * Constructs the evaluator. Pass an explicit `TargetResolver` for injection
   * testing; the default constructs a fresh one (standard seam).
   * @param resolver - Optional `TargetResolver` for the LHS/RHS target leaves.
   */
  constructor(resolver?: TargetResolver) {
    this.#resolver = resolver ?? new TargetResolver();
  }

  /**
   * Evaluate `expr` against `context` to a finite number. NEVER throws.
   * @param expr - The Layer-A arithmetic expression tree.
   * @param context - The hermetic evaluation context.
   * @returns `ArithmeticOutcome` — either a finite number or a failure.
   */
  evaluate(expr: ArithmeticExpr, context: EvaluationContext): ArithmeticOutcome {
    const counter: NodeCounter = { remaining: MAX_ARITH_EVAL_NODES };
    return this.#evalNode(expr, context, counter);
  }

  /**
   * Recursively (iteratively via call stack — bounded by `counter`) evaluate
   * one node of the expression tree.
   * @param expr - Current expression node.
   * @param context - The hermetic context.
   * @param counter - Mutable node budget.
   * @returns The outcome for this sub-tree.
   */
  #evalNode(
    expr: ArithmeticExpr,
    context: EvaluationContext,
    counter: NodeCounter,
  ): ArithmeticOutcome {
    counter.remaining -= 1;
    if (counter.remaining < 0) {
      return {
        ok: false,
        failureCode: "ARITHMETIC_ERROR",
        reason: `Arithmetic expression exceeded ${MAX_ARITH_EVAL_NODES} node limit`,
      };
    }

    if (expr.kind === "number") {
      return this.#evalNumber(expr.value);
    }
    if (expr.kind === "target") {
      return this.#evalTarget(expr.ref, context);
    }
    return this.#evalBinary(expr, context, counter);
  }

  /**
   * Evaluate a numeric literal leaf. The parser already guarantees finiteness
   * but we check defensively (defence-in-depth).
   * @param value - The literal numeric value.
   * @returns The outcome for this leaf.
   */
  #evalNumber(value: number): ArithmeticOutcome {
    if (!Number.isFinite(value)) {
      return {
        ok: false,
        failureCode: "ARITHMETIC_ERROR",
        reason: `Non-finite number literal in arithmetic expression: ${value}`,
      };
    }
    return { ok: true, value };
  }

  /**
   * Evaluate a target leaf by resolving it through `TargetResolver`.
   * `found:false` → `TARGET_NOT_FOUND`; non-finite-number → `TYPE_MISMATCH`.
   * @param ref - The target reference to resolve.
   * @param context - The hermetic context.
   * @returns The numeric outcome for this leaf.
   */
  #evalTarget(
    ref: ArithmeticExpr & { kind: "target" },
    context: EvaluationContext,
  ): ArithmeticOutcome;
  #evalTarget(
    ref: { root: string } & Record<string, unknown>,
    context: EvaluationContext,
  ): ArithmeticOutcome;
  #evalTarget(ref: unknown, context: EvaluationContext): ArithmeticOutcome {
    const resolved: ResolvedValue = this.#resolver.resolve(
      ref as Parameters<TargetResolver["resolve"]>[0],
      context,
    );
    if (!resolved.found) {
      return {
        ok: false,
        failureCode: "TARGET_NOT_FOUND",
        reason: `Arithmetic target not found in evaluation context`,
      };
    }
    const v = resolved.value;
    if (typeof v !== "number" || !Number.isFinite(v)) {
      return {
        ok: false,
        failureCode: "TYPE_MISMATCH",
        reason: `Arithmetic operand resolved to non-number type '${typeof v}': ${String(v)}`,
      };
    }
    return { ok: true, value: v };
  }

  /**
   * Evaluate a binary operation node. Evaluates left then right (short-circuit
   * on left failure). Guards division by zero and post-op non-finite results.
   * @param expr - The binary expression node.
   * @param context - The hermetic context.
   * @param counter - Mutable node budget.
   * @returns The numeric outcome for the binary sub-tree.
   */
  #evalBinary(
    expr: ArithmeticExpr & { kind: "binary" },
    context: EvaluationContext,
    counter: NodeCounter,
  ): ArithmeticOutcome {
    const left = this.#evalNode(expr.left, context, counter);
    if (!left.ok) return left;

    const right = this.#evalNode(expr.right, context, counter);
    if (!right.ok) return right;

    return this.#applyOp(expr.op, left.value, right.value);
  }

  /**
   * Apply a binary arithmetic operator to two finite operands. Returns an
   * ARITHMETIC_ERROR for division by zero and non-finite results.
   * @param op - The operator character.
   * @param l - Left operand (finite).
   * @param r - Right operand (finite).
   * @returns The numeric outcome.
   */
  #applyOp(op: "+" | "-" | "*" | "/", l: number, r: number): ArithmeticOutcome {
    if (op === "/" && r === 0) {
      return {
        ok: false,
        failureCode: "ARITHMETIC_ERROR",
        reason: `Division by zero in arithmetic expression`,
      };
    }

    let result: number;
    if (op === "+") result = l + r;
    else if (op === "-") result = l - r;
    else if (op === "*") result = l * r;
    else result = l / r;

    if (!Number.isFinite(result)) {
      return {
        ok: false,
        failureCode: "ARITHMETIC_ERROR",
        reason: `Arithmetic expression produced non-finite result: ${result}`,
      };
    }
    return { ok: true, value: result };
  }
}
