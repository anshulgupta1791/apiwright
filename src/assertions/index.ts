/**
 * Public barrel for the `src/assertions` module. Re-exports the full type
 * vocabulary (AST nodes, operator taxonomy, results, contexts) and the
 * `FAILURE_CODES` const. Exports the engine facade, parser, and evaluator
 * so callers only need a single import surface.
 */

export { FAILURE_CODES } from "./types.js";

// Layer-D facade (top-level API)
export { AssertionEngine } from "./assertion-engine.js";
export type { AssertionEngineDeps } from "./assertion-engine.js";

// Layer-D parse-side
export { AssertionParser } from "./parser.js";
export type { AssertionParserDeps } from "./parser.js";

// Layer-D evaluation-side
export { AssertionEvaluator } from "./evaluator.js";
export type { AssertionEvaluatorDeps } from "./evaluator.js";

// Layer-C: target resolver (sole owner of ResolvedValue)
export { TargetResolver, MAX_RESOLVE_DEPTH } from "./target-resolver.js";
export type { ResolvedValue } from "./target-resolver.js";

// Layer-C: arithmetic evaluator
export { ArithmeticEvaluator } from "./arithmetic-evaluator.js";
export type { ArithmeticOutcome } from "./arithmetic-evaluator.js";

// Layer-B exports: operator registry
export {
  OPERATOR_REGISTRY,
  OPERATOR_COUNT,
  lookupOperator,
  isOperatorName,
  allOperatorNames,
} from "./operator-registry.js";
export type { OperandShape, OperatorMeta } from "./operator-registry.js";

// Layer-B exports: tokenizer
export { AssertionTokenizer, MAX_INPUT_LENGTH, MAX_TOKEN_COUNT } from "./tokenizer.js";
export type {
  TokenKind,
  TokenSpan,
  TargetToken,
  IdentifierToken,
  StringToken,
  NumberToken,
  BooleanToken,
  NullToken,
  RegexToken,
  PunctToken,
  ArithOpToken,
  Token,
  LexError,
  LexErrorCode,
  TokenizeResult,
  TokenizerOptions,
} from "./tokenizer.js";

// Layer-B exports: target-path parser
export { TargetPathParser, MAX_TARGET_LENGTH } from "./target-path-parser.js";
export type {
  TargetParseError,
  TargetParseErrorCode,
  TargetParseResult,
} from "./target-path-parser.js";

// Layer-B exports: regex operand compiler
export { RegexOperandCompiler, MAX_REGEX_TARGET_LENGTH } from "./regex-operand.js";
export type { RegexCompileResult } from "./regex-operand.js";

// Layer-B exports: arithmetic expression parser
export {
  ArithmeticExpressionParser,
  MAX_ARITH_DEPTH,
} from "./arithmetic-parser.js";
export type {
  ArithParseError,
  ArithParseErrorCode,
  ArithParseResult,
  ArithmeticParserOptions,
} from "./arithmetic-parser.js";

export type {
  PathSegment,
  TargetRoot,
  TargetRef,
  LiteralValue,
  OperandKind,
  LiteralOperand,
  TargetOperand,
  RegexOperand,
  RegexFlag,
  ArithmeticOperator,
  ArithmeticOperand,
  ArithmeticExpr,
  ArithmeticOperandNode,
  RangeOperand,
  Operand,
  AssertionAst,
  OperatorName,
  OperatorGroup,
  FailureCode,
  GroupOutcome,
  AssertionResult,
  AssertionParseResult,
  AssertionParseEntry,
  BatchParseResult,
  RequestUrlContext,
  RequestContext,
  ResponseContext,
  EvaluationContext,
} from "./types.js";

// Re-export NormalizedResult from core so fixture files importing from
// src/assertions/index.js can access it without a direct core import.
export type { NormalizedResult } from "../core/normalized-result.js";
