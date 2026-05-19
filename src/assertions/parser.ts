/**
 * Layer-D parse-side orchestrator: composes the Layer-B tokenizer, the
 * operator registry, and the Layer-C/D sub-parsers into a single, pure,
 * no-throw `AssertionParser` that turns ONE raw assertion string into a
 * Layer-A `AssertionParseResult`.
 *
 * All sub-parsers are constructor-injectable (test seams). Default construction
 * wires the real collaborators and is tested directly (never istanbul-ignored).
 *
 * Operand-region dispatch lives in {@link ./operand-region-parser.js} to keep
 * this file within the 300-line soft limit.
 */

import { ArithmeticExpressionParser } from "./arithmetic-parser.js";
import type { Operand } from "./ast.js";
import { deduplicate, OperandRegionParser } from "./operand-region-parser.js";
import type { OperatorMeta } from "./operator-registry.js";
import { lookupOperator as realLookupOperator } from "./operator-registry.js";
import { RegexOperandCompiler } from "./regex-operand.js";
import { TargetPathParser } from "./target-path-parser.js";
import { AssertionTokenizer } from "./tokenizer.js";
import type { Token } from "./tokenizer.js";
import type { AssertionAst, AssertionParseResult, TargetRef } from "./types.js";

/**
 * Injectable collaborators for {@link AssertionParser}. Every field is
 * optional; the constructor wires real defaults when absent.
 */
export interface AssertionParserDeps {
  /** Layer-B lexer; default `new AssertionTokenizer()`. */
  readonly tokenizer?: AssertionTokenizer;
  /** Layer-C target-path parser; default `new TargetPathParser()`. */
  readonly targetParser?: TargetPathParser;
  /** Layer-D arithmetic parser; shares the resolved targetParser by default. */
  readonly arithmeticParser?: ArithmeticExpressionParser;
  /** Layer-C regex compiler; default `new RegexOperandCompiler()`. */
  readonly regexCompiler?: RegexOperandCompiler;
  /** Operator-registry lookup; default the real `lookupOperator`. */
  readonly lookupOperator?: (name: string) => OperatorMeta | undefined;
}

/**
 * Pure, deterministic, no-throw composition entrypoint that turns ONE raw
 * assertion string into a Layer-A {@link AssertionParseResult}. Composes the
 * Layer-B tokenizer, operator registry, Layer-C target-path parser, Layer-D
 * arithmetic parser, and Layer-C regex compiler. Introduces NO new grammar.
 * Identical input ALWAYS yields a byte-identical AST (no I/O, Date, random).
 */
export class AssertionParser {
  readonly #tokenizer: AssertionTokenizer;
  readonly #targetParser: TargetPathParser;
  readonly #operandParser: OperandRegionParser;
  readonly #lookupOperator: (name: string) => OperatorMeta | undefined;

  /**
   * Constructs the parser with optional collaborator seams.
   * @param deps - Optional injectable collaborators. Absent fields use real defaults.
   */
  constructor(deps?: AssertionParserDeps) {
    this.#tokenizer = deps?.tokenizer ?? new AssertionTokenizer();
    const targetParser = deps?.targetParser ?? new TargetPathParser();
    this.#targetParser = targetParser;
    const arithmeticParser = deps?.arithmeticParser
      ?? new ArithmeticExpressionParser(targetParser);
    const regexCompiler = deps?.regexCompiler ?? new RegexOperandCompiler();
    this.#operandParser = new OperandRegionParser(targetParser, arithmeticParser, regexCompiler);
    this.#lookupOperator = deps?.lookupOperator ?? realLookupOperator;
  }

  /**
   * Parse ONE raw assertion string. NEVER throws. Aggregates ALL syntax errors.
   * @param raw - One raw assertion string (untrimmed; any string).
   * @returns An {@link AssertionParseResult}.
   */
  parse(raw: string): AssertionParseResult {
    const trimmed = raw.trim();
    const errors: string[] = [];

    const sig = this.#tokenize(raw, trimmed, errors);
    if (!sig) return { ok: false, errors };

    if (sig.length === 0) {
      errors.push(
        `${trimmed}: structure: Assertion is empty; expected <target> <operator> [<operand>]`,
      );
      return { ok: false, errors };
    }

    // sig.length === 0 was checked above; access is safe.
    const firstRaw = sig.at(0)?.raw ?? "";
    const targetRef = this.#parseTarget(firstRaw, trimmed, errors);

    const opResult = this.#parseOperatorStage(sig, trimmed, errors);
    if (!opResult) return { ok: false, errors: deduplicate(errors) };

    const { meta, operandTokens } = opResult;
    const operand = this.#parseOperandStage(meta, operandTokens, trimmed, errors);

    const allErrors = deduplicate(errors);
    if (allErrors.length > 0) return { ok: false, errors: allErrors };
    if (!targetRef) {
      return { ok: false, errors: [`${trimmed}: structure: Target ref not resolved`] };
    }

    const ast: AssertionAst =
      operand === undefined
        ? { raw: trimmed, target: targetRef, operator: meta.name }
        : { raw: trimmed, target: targetRef, operator: meta.name, operand };

    return { ok: true, ast };
  }

  /**
   * Stage 1: Tokenize the raw string. Pushes lex errors into `errors`.
   * @param raw - The raw assertion string.
   * @param trimmed - The trimmed version for error messages.
   * @param errors - Mutable errors accumulator.
   * @returns The significant token slice (no eof), or `null` if tokenizer failed entirely.
   */
  #tokenize(raw: string, trimmed: string, errors: string[]): readonly Token[] | null {
    const tokResult = this.#tokenizer.tokenize(raw);
    if (!tokResult.ok) {
      for (const e of tokResult.errors) errors.push(`${trimmed}: lex: ${e.message}`);
    }
    const tokens = tokResult.tokens;
    if (tokens.length === 0) return null;
    // Remove trailing eof; sig = significant tokens
    return tokens.slice(0, tokens.length - 1);
  }

  /**
   * Stage 3: Parse the target token. Pushes target errors into `errors`.
   * @param raw - The raw target token text.
   * @param trimmed - The trimmed assertion for error messages.
   * @param errors - Mutable errors accumulator.
   * @returns The resolved `TargetRef` or `null` on failure.
   */
  #parseTarget(raw: string, trimmed: string, errors: string[]): TargetRef | null {
    const targetResult = this.#targetParser.parse(raw);
    if (!targetResult.ok) {
      for (const e of targetResult.errors) errors.push(`${trimmed}: target: ${e.message}`);
      return null;
    }
    return targetResult.ref;
  }

  /**
   * Stage 4: Look up the operator from the token stream.
   * @param sig - All significant tokens.
   * @param trimmed - The trimmed assertion for error messages.
   * @param errors - Mutable errors accumulator.
   * @returns `{ meta, operandTokens }` or `null` (caller should return early).
   */
  #parseOperatorStage(
    sig: readonly Token[],
    trimmed: string,
    errors: string[],
  ): { meta: OperatorMeta; operandTokens: readonly Token[] } | null {
    const firstRaw = sig.at(0)?.raw ?? "";
    if (sig.length < 2) {
      errors.push(`${trimmed}: operator: Missing operator after target '${firstRaw}'`);
      return null;
    }
    const opRaw = sig.at(1)?.raw ?? "";
    const meta = this.#lookupOperator(opRaw);
    if (!meta) {
      errors.push(
        `${trimmed}: operator: Unknown operator '${opRaw}'; ` +
        `expected one of the supported operators`,
      );
      return null;
    }
    return { meta, operandTokens: sig.slice(2) };
  }

  /**
   * Stage 5: Parse the operand region. Pushes operand errors into `errors`.
   * @param meta - Operator metadata.
   * @param operandTokens - The token slice for the operand region.
   * @param trimmed - The trimmed assertion for error messages.
   * @param errors - Mutable errors accumulator.
   * @returns The parsed `Operand` or `undefined` on error.
   */
  #parseOperandStage(
    meta: OperatorMeta,
    operandTokens: readonly Token[],
    trimmed: string,
    errors: string[],
  ): Operand | undefined {
    const opErrors = this.#operandParser.parseOperand(meta, operandTokens);
    if (typeof opErrors === "string" || Array.isArray(opErrors)) {
      const msgs = Array.isArray(opErrors) ? opErrors : [opErrors];
      for (const m of msgs) errors.push(`${trimmed}: operand: ${m}`);
      return undefined;
    }
    return opErrors;
  }
}
