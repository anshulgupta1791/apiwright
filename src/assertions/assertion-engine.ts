/**
 * Layer-D facade: the single public entry-point of the `src/assertions` module
 * for callers that need parsing + evaluation without knowing the internal
 * collaboration graph.
 *
 * `AssertionEngine` composes one {@link AssertionParser} and one
 * {@link AssertionEvaluator} and exposes three pure, NEVER-throws methods:
 *
 * - `parseAll(strings)` — batch-parse an array of raw strings into a
 *   {@link BatchParseResult}; continues past individual failures (collect, not
 *   stop).
 * - `evaluateAll(asts, context)` — batch-evaluate an array of parsed ASTs
 *   against one {@link EvaluationContext}; returns results in input order.
 * - `parseAndEvaluate(strings, context)` — convenience composition of the two;
 *   evaluates only the parseable subset, returns both halves.
 *
 * Stateless after construction. Deterministic given deterministic collaborators.
 * Does NOT import from `test-catalog` or `cli`.
 */

import { AssertionEvaluator } from "./evaluator.js";
import type { AssertionEvaluatorDeps } from "./evaluator.js";
import { AssertionParser } from "./parser.js";
import type { AssertionParserDeps } from "./parser.js";
import type {
  AssertionAst,
  AssertionParseEntry,
  AssertionResult,
  BatchParseResult,
  EvaluationContext,
} from "./types.js";

/**
 * Injectable collaborators for {@link AssertionEngine}. Both fields are
 * optional; the engine constructs real defaults when absent.
 */
export interface AssertionEngineDeps {
  /**
   * Override the parser (duck-typed: any object with a `parse(raw:string)`
   * returning `AssertionParseResult`).
   */
  readonly parser?: Pick<AssertionParser, "parse">;
  /**
   * Override the evaluator (duck-typed: any object with an
   * `evaluate(ast, ctx)` returning `AssertionResult`).
   */
  readonly evaluator?: Pick<AssertionEvaluator, "evaluate">;
  /** Extra deps forwarded to the real `AssertionParser` when no parser stub. */
  readonly parserDeps?: AssertionParserDeps;
  /** Extra deps forwarded to the real `AssertionEvaluator` when no evaluator stub. */
  readonly evaluatorDeps?: AssertionEvaluatorDeps;
}

/**
 * The top-level assertion engine facade. Composes parsing and evaluation into
 * a convenient, NEVER-throws, batch-friendly API. One instance is safe to share
 * across the entire test run (stateless, pure after construction).
 */
export class AssertionEngine {
  readonly #parser: Pick<AssertionParser, "parse">;
  readonly #evaluator: Pick<AssertionEvaluator, "evaluate">;

  /**
   * Construct the engine with optional dependency overrides.
   * @param deps - Optional injectable collaborators. Omit for real defaults.
   */
  constructor(deps?: AssertionEngineDeps) {
    this.#parser = deps?.parser ?? new AssertionParser(deps?.parserDeps);
    this.#evaluator = deps?.evaluator ?? new AssertionEvaluator(deps?.evaluatorDeps);
  }

  /**
   * Batch-parse an array of raw assertion strings. NEVER throws. Continues
   * past individual failures so all errors are aggregated in one pass.
   * @param strings - Raw assertion strings from the test catalog.
   * @returns A {@link BatchParseResult} with per-string outcomes + flattened errors.
   */
  parseAll(strings: readonly string[]): BatchParseResult {
    const entries: AssertionParseEntry[] = [];
    const errors: string[] = [];

    for (const raw of strings) {
      const result = this.#parser.parse(raw);
      entries.push({ assertion: raw, result });
      if (!result.ok) {
        for (const msg of result.errors) {
          errors.push(msg);
        }
      }
    }

    const valid = entries.every((e) => e.result.ok);
    return { entries, valid, errors };
  }

  /**
   * Batch-evaluate an array of already-parsed ASTs against a single context.
   * NEVER throws. Results are in the same order as `asts`.
   * @param asts - Parsed assertion ASTs (from `parseAll` or `parse`).
   * @param context - The hermetic evaluation context.
   * @returns `AssertionResult[]` in input order; length equals `asts.length`.
   */
  evaluateAll(asts: readonly AssertionAst[], context: EvaluationContext): AssertionResult[] {
    return asts.map((ast) => this.#evaluator.evaluate(ast, context));
  }

  /**
   * Convenience composition: parse `strings`, then evaluate the parseable
   * subset against `context`. Returns both the parse batch and the results.
   *
   * Evaluation runs only for entries where `result.ok === true`; invalid
   * strings contribute to `parse.errors` but produce no `AssertionResult`.
   * Results are in the original relative order of the ok:true entries.
   * @param strings - Raw assertion strings from the test catalog.
   * @param context - The hermetic evaluation context.
   * @returns `{ parse: BatchParseResult; results: AssertionResult[] }`.
   */
  parseAndEvaluate(
    strings: readonly string[],
    context: EvaluationContext,
  ): { readonly parse: BatchParseResult; readonly results: AssertionResult[] } {
    const parse = this.parseAll(strings);
    const asts = parse.entries
      .filter((e): e is AssertionParseEntry & { result: { ok: true; ast: AssertionAst } } =>
        e.result.ok,
      )
      .map((e) => e.result.ast);
    const results = this.evaluateAll(asts, context);
    return { parse, results };
  }
}
