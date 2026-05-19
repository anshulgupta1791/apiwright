/**
 * Operand-region parsing helpers for the AssertionParser. Handles dispatch
 * across all `OperandShape` arms and the literal/target/arithmetic
 * classification logic. Extracted from parser.ts per the design doc prescription
 * to keep parser.ts within the 300-line soft limit.
 */

import { ArithmeticExpressionParser } from "./arithmetic-parser.js";
import type { LiteralOperand, Operand, TargetOperand } from "./ast.js";
import type { OperatorMeta } from "./operator-registry.js";
import { RegexOperandCompiler } from "./regex-operand.js";
import { TargetPathParser } from "./target-path-parser.js";
import type { Token } from "./token-types.js";
import type { LiteralValue } from "./types.js";

/**
 * The number of tokens that make up a valid `in_range` operand:
 * `<number> <range_sep> <number>`.
 */
const RANGE_TOKEN_COUNT = 3;

/** Classify the kind of an operand region. */
type OperandRegionKind = "empty" | "arithmetic" | "literal" | "target" | "regex" | "other";

/**
 * Classify a single-token kind into an operand region kind.
 * Handles the inner dispatch for {@link classifyRegion}.
 * @param kind - The token kind.
 * @returns A region-kind discriminant.
 */
function classifySingleToken(kind: Token["kind"]): OperandRegionKind {
  if (kind === "string" || kind === "number" || kind === "boolean" || kind === "null") {
    return "literal";
  }
  if (kind === "target" || kind === "identifier") return "target";
  if (kind === "regex") return "regex";
  return "other";
}

/**
 * Classify the operand region by the first token's kind.
 * Both `target`-kind and `identifier`-kind single tokens are treated as
 * target-refs in operand position (the lexer assigns `identifier` to path
 * tokens after the first token; the target parser handles both).
 * @param tokens - The operand token slice.
 * @returns A region-kind discriminant.
 */
export function classifyRegion(tokens: readonly Token[]): OperandRegionKind {
  if (tokens.length === 0) return "empty";
  const first = tokens.at(0);
  if (!first) return "other";
  if (first.kind === "lparen") return "arithmetic";
  if (tokens.length === 1) return classifySingleToken(first.kind);
  return "other";
}

/**
 * Build the raw text of a token slice for error messages.
 * @param tokens - The tokens to render.
 * @returns Concatenated raw strings separated by spaces.
 */
export function tokensText(tokens: readonly Token[]): string {
  return tokens.map((t) => t.raw).join(" ");
}

/**
 * De-duplicate an array of strings, preserving first-occurrence order.
 * @param arr - The source array.
 * @returns A new array with duplicates removed.
 */
export function deduplicate(arr: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const s of arr) {
    if (!seen.has(s)) { seen.add(s); result.push(s); }
  }
  return result;
}

/**
 * Operand-region parser: stateless collaborator that dispatches across all
 * `OperandShape` arms to produce the correct `Operand` variant. Extracted
 * from AssertionParser to keep file sizes within limits.
 */
export class OperandRegionParser {
  readonly #targetParser: TargetPathParser;
  readonly #arithmeticParser: ArithmeticExpressionParser;
  readonly #regexCompiler: RegexOperandCompiler;

  /**
   * Constructs the operand-region parser with the shared collaborators.
   * @param targetParser - Layer-C target-path parser.
   * @param arithmeticParser - Layer-D arithmetic expression parser.
   * @param regexCompiler - Layer-C regex compiler.
   */
  constructor(
    targetParser: TargetPathParser,
    arithmeticParser: ArithmeticExpressionParser,
    regexCompiler: RegexOperandCompiler,
  ) {
    this.#targetParser = targetParser;
    this.#arithmeticParser = arithmeticParser;
    this.#regexCompiler = regexCompiler;
  }

  /**
   * Dispatch to the correct operand parsing arm based on `meta.operandShape`.
   * @param meta - Operator metadata.
   * @param tokens - The operand token region (excludes eof and operator).
   * @returns The parsed `Operand`, or an error string, or an array of errors.
   */
  parseOperand(
    meta: OperatorMeta,
    tokens: readonly Token[],
  ): Operand | string | string[] {
    const shape = meta.operandShape;

    if (shape === "none") return this.#parseNone(meta, tokens);
    if (shape === "range") return this.#parseRange(tokens);
    if (shape === "regex") return this.#parseRegex(tokens);
    if (shape === "value") return this.#parseValue(meta, tokens);
    if (shape === "numeric") return this.#parseNumeric(tokens);
    return this.#parseComparand(meta, tokens);
  }

  /**
   * `none` shape: operand region must be empty.
   * @param meta - Operator metadata.
   * @param tokens - The operand tokens.
   * @returns `undefined` (no operand) or an error string.
   */
  #parseNone(meta: OperatorMeta, tokens: readonly Token[]): Operand | string {
    if (tokens.length === 0) return undefined as unknown as Operand;
    const text = tokensText(tokens);
    return `Arity error: operator '${meta.name}' takes no operand; unexpected '${text}'`;
  }

  /**
   * `range` shape: exactly `number range_sep number`.
   * @param tokens - The operand tokens.
   * @returns A RangeOperand or an error string.
   */
  #parseRange(tokens: readonly Token[]): Operand | string {
    if (tokens.length === 0) return "Missing operand for 'in_range'";
    if (
      tokens.length !== RANGE_TOKEN_COUNT ||
      tokens.at(0)?.kind !== "number" ||
      tokens.at(1)?.kind !== "range_sep" ||
      tokens.at(2)?.kind !== "number"
    ) {
      return `'in_range' expects two numeric bounds lo..hi; found '${tokensText(tokens)}'`;
    }
    const lo = (tokens.at(0) as { value: number } | undefined)?.value ?? 0;
    const hi = (tokens.at(2) as { value: number } | undefined)?.value ?? 0;
    if (lo > hi) {
      return `'in_range' range invalid: lo ${lo} exceeds hi ${hi}`;
    }
    return { kind: "range", lo, hi };
  }

  /**
   * `regex` shape: one regex or bare-pattern token.
   * @param tokens - The operand tokens.
   * @returns A RegexOperand or errors.
   */
  #parseRegex(tokens: readonly Token[]): Operand | string | string[] {
    if (tokens.length === 0) return "Missing operand for 'matches'";
    if (tokens.length > 1) {
      return `'matches' expects a single regex/pattern operand; found '${tokensText(tokens)}'`;
    }
    const lexeme = tokens.at(0)?.raw ?? "";
    const result = this.#regexCompiler.compile(lexeme);
    if (!result.ok) return [...result.errors];
    return result.operand;
  }

  /**
   * `value` shape: literal or target-ref (no arithmetic).
   * @param meta - Operator metadata.
   * @param tokens - The operand tokens.
   * @returns A LiteralOperand, TargetOperand, or an error string.
   */
  #parseValue(meta: OperatorMeta, tokens: readonly Token[]): Operand | string {
    if (tokens.length === 0) return `Missing operand for '${meta.name}'`;
    if (tokens[0]?.kind === "lparen") {
      return `Arithmetic RHS is not allowed for operator '${meta.name}'`;
    }
    return this.#parseLiteralOrTarget(tokens, meta.name);
  }

  /**
   * `numeric` shape: numeric literal or target-ref (no arithmetic).
   * @param tokens - The operand tokens.
   * @returns A LiteralOperand (number), TargetOperand, or an error string.
   */
  #parseNumeric(tokens: readonly Token[]): Operand | string {
    if (tokens.length === 0) return "Missing operand for aggregate operator";
    if (tokens[0]?.kind === "lparen") {
      return "Arithmetic RHS is not allowed for aggregate operators";
    }
    if (
      tokens.length === 1 &&
      tokens[0]?.kind !== "number" &&
      tokens[0]?.kind !== "target" &&
      tokens[0]?.kind !== "identifier"
    ) {
      return `Aggregate operator expects a numeric operand; found '${tokensText(tokens)}'`;
    }
    return this.#parseLiteralOrTarget(tokens, "count");
  }

  /**
   * `comparand` shape: literal, target-ref, or arithmetic expression.
   * @param meta - Operator metadata.
   * @param tokens - The operand tokens.
   * @returns An Operand or errors.
   */
  #parseComparand(meta: OperatorMeta, tokens: readonly Token[]): Operand | string | string[] {
    if (tokens.length === 0) return `Missing operand for '${meta.name}'`;

    if (tokens[0]?.kind === "lparen") {
      if (!meta.allowsArithmeticRhs) {
        return `Arithmetic RHS is not allowed for operator '${meta.name}'`;
      }
      const arithResult = this.#arithmeticParser.parse(tokens);
      if (!arithResult.ok) return arithResult.errors.map((e) => e.message);
      return { kind: "arithmetic", expr: arithResult.expr };
    }

    return this.#parseLiteralOrTarget(tokens, meta.name);
  }

  /**
   * Parse a single literal or target operand token. Validates that only one
   * token is present and dispatches by kind.
   * @param tokens - The operand tokens.
   * @param opName - The operator name (for error messages).
   * @returns A LiteralOperand, TargetOperand, or error string.
   */
  #parseLiteralOrTarget(tokens: readonly Token[], opName: string): Operand | string {
    const kind = classifyRegion(tokens);

    if (kind === "literal") {
      const tok = tokens.at(0);
      if (!tok) return `Malformed operand for '${opName}': empty literal region`;
      const value = this.#extractLiteralValue(tok);
      const lit: LiteralOperand = { kind: "literal", value };
      return lit;
    }

    if (kind === "target") {
      const tok = tokens.at(0);
      if (!tok) return `Malformed operand for '${opName}': empty target region`;
      return this.#parseTargetRef(tok);
    }

    if (kind === "regex") {
      return `A regex literal is not a valid operand for operator '${opName}'`;
    }

    return `Malformed operand for '${opName}': '${tokensText(tokens)}'`;
  }

  /**
   * Parse a target-ref operand token through `TargetPathParser`.
   * @param tok - The single target token.
   * @returns A TargetOperand or error string.
   */
  #parseTargetRef(tok: Token): Operand | string {
    const result = this.#targetParser.parse(tok.raw);
    if (!result.ok) {
      return result.errors.map((e) => e.message).join("; ");
    }
    const t: TargetOperand = { kind: "target", ref: result.ref };
    return t;
  }

  /**
   * Extract the literal value from a single literal-kind token.
   * @param tok - A string/number/boolean/null token.
   * @returns The decoded literal value.
   */
  #extractLiteralValue(tok: Token): LiteralValue {
    if (tok.kind === "string") return tok.value;
    if (tok.kind === "number") return tok.value;
    if (tok.kind === "boolean") return tok.value;
    return null;
  }
}
