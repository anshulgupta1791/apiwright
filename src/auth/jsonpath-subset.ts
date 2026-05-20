/**
 * Minimal in-house JSONPath subset for token extraction (§6 / D4 / D3).
 *
 * Implements the Task #9 "auth-jsonpath-subset" design: a pure, no-throw,
 * two-function module built on the path-walk SSOT (src/core/path-walk.ts).
 * Zero new production dependency (D3 verbatim). Grammar supports only:
 *
 * - Bare root: "$"
 * - Dot-key segments: "$.foo", "$.access_token", "$.0" (numeric string key)
 * - Bracket-index segments: "$.foo[0]", "$.tokens[42]"
 *
 * All other JSONPath features (filter, recursive descent, wildcards, slices,
 * bracketed string keys) are rejected with AUTH_CONFIG_INVALID errors.
 *
 * Both functions are pure (no I/O, no Date, no random), deterministic, and
 * never throw on any input.
 */

import type { WalkResult, WalkSegment } from "../core/path-walk.js";
import { walkPath } from "../core/path-walk.js";

import { AUTH_ERROR_CODES, AuthStrategyError } from "./errors.js";

/**
 * Maximum byte-length of a JSONPath expression accepted by {@link parseJsonPath}.
 * Expressions exceeding this limit are rejected with AUTH_CONFIG_INVALID.
 * Named constant per no-magic-numbers rule.
 */
export const MAX_JSONPATH_EXPRESSION_LENGTH = 1024;

/**
 * An opaque parsed path: the structurally-validated output of
 * {@link parseJsonPath}. Consumers MUST NOT construct one literally — only
 * the parser guarantees the structural shape that {@link walkPath} requires.
 *
 * Implemented as a plain readonly alias of WalkSegment[] (no runtime class
 * wrapper, zero cost — AC#5 verbatim). TypeScript structural compatibility
 * with walkPath is verified at compile time by sharing WalkSegment from
 * src/core/path-walk.ts.
 *
 * ASCII-only identifiers in v1 (a–z, A–Z, 0–9, _, $). Non-ASCII field names
 * are a non-goal; see design §8(h).
 */
export type ParsedJsonPath = readonly WalkSegment[];

/** Shared prefix for all rejection messages — keeps format DRY (one edit point). */
const REJECT_PREFIX = "JSONPath subset rejected expression ";

/**
 * Whole-expression validator: anchored, no nested quantifiers, no backtracking.
 * Accepts "$" alone OR "$" followed by any number of:
 *   - dot-key segments: "[A-Za-z0-9_$]+" (ASCII identifiers including numeric-only)
 *   - bracket-index segments: "[0]", "[42]" (non-negative decimal integer)
 */
const JSONPATH_FULL = /^\$(?:\.[A-Za-z0-9_$]+|\[(?:0|[1-9][0-9]*)\])*$/;

/**
 * Segment scanner source string: matches one ".key" group OR one "[N]" group.
 * Used with matchAll on the post-"$" tail (Phase 2 of the parser).
 * Stored as a string so each parseJsonPath call can create a fresh RegExp
 * with the "g" flag — avoiding shared mutable lastIndex across concurrent callers.
 */
const JSONPATH_SEGMENT_SOURCE = String.raw`\.([A-Za-z0-9_$]+)|\[(0|[1-9][0-9]*)\]`;

/**
 * Builds a reject error with a consistent message format.
 * @param expr - The offending expression (a CALLER-PROVIDED CONFIG STRING, not a credential).
 * @param reason - The human-readable reason phrase from the §4 rejection table.
 * @returns An AuthStrategyError with code AUTH_CONFIG_INVALID and phase "config".
 */
function buildRejectError(expr: string, reason: string): AuthStrategyError {
  return new AuthStrategyError({
    code: AUTH_ERROR_CODES.AUTH_CONFIG_INVALID,
    phase: "config",
    message: `${REJECT_PREFIX}'${expr}': ${reason}`,
  });
}

/**
 * Classifies bracket-content rejections (negative index, non-integer index).
 * @param expr - The expression to probe.
 * @returns A specific reason string, or undefined if no bracket rejection matches.
 */
function classifyBracketRejection(expr: string): string | undefined {
  if (/\[-/.test(expr)) return "negative index not allowed";
  if (/\[([^\]]*)\]/.test(expr) && !/\[(?:0|[1-9][0-9]*)\]/.test(expr)) {
    return "index must be a non-negative integer";
  }
  return undefined;
}

/**
 * Classifies structural-feature rejections (wildcards, filters, slices, etc.).
 * Split from the main classifier to keep cyclomatic complexity under the limit.
 * @param expr - The expression that starts with "$" but has unsupported features.
 * @returns A specific reason string, or undefined if none of these probes match.
 */
function classifyStructuralRejection(expr: string): string | undefined {
  if (expr.includes("..")) return "recursive descent (`..`) not supported in v1";
  if (expr.includes("*")) return "wildcards (`*`) not supported in v1";
  if (/\[\?/.test(expr)) return "filter expressions (`[?...]`) not supported in v1";
  if (/\[[^\]]*:[^\]]*\]/.test(expr)) return "slice notation (`[a:b]`) not supported in v1";
  if (/\[\s*['"]/.test(expr)) {
    return "bracketed string keys (`[\"...\"]`) not supported in v1; use `.foo`";
  }
  if (/\s/.test(expr)) return "whitespace inside expression not allowed";
  if (expr.endsWith(".")) return "trailing dot is not allowed";
  return classifyBracketRejection(expr);
}

/**
 * Classifies why an expression fails the grammar, in priority order.
 * Returns the most specific reason string, or undefined for the generic fallback.
 *
 * All probes are single-pass character-class regexes or string methods: linear,
 * REDoS-safe. The length check is handled by the caller before this function runs.
 * @param expr - The expression that failed JSONPATH_FULL validation.
 * @returns Specific reason string, or undefined for the generic fallback.
 */
function classifyRejection(expr: string): string | undefined {
  if (expr === "") return "expression must not be empty";
  if (/^\s+$/.test(expr)) return "expression must not be whitespace-only";
  if (!expr.startsWith("$")) return "expression must begin with `$`";
  return classifyStructuralRejection(expr);
}

/**
 * Pure no-throw parser for the v1 JSONPath subset (AC#1, AC#2, AC#4).
 *
 * Phase 1: validates the whole expression against a REDoS-safe anchored regex,
 * with cheap heuristic pre-checks for clearer error messages.
 *
 * Phase 2: scans segments with matchAll on the post-"$" tail, building a
 * WalkSegment[] in O(n) — one forward pass, no backtracking.
 *
 * Grammar accepted (D4 verbatim):
 * - "$" alone — bare root, returns []
 * - "$." followed by identifier segments and/or "[N]" index segments
 * - Identifiers: [A-Za-z0-9_$]+ (ASCII-only, v1 constraint per §8(h))
 * - Indices: non-negative decimal integers only (0, 1, 42, ...)
 * - Dot-numeric keys ("$.0") are accepted as key segments per §8(d)
 * @param expr - Any string input (never throws, never reads I/O).
 * @returns The validated {@link ParsedJsonPath} on success, or an
 *   {@link AuthStrategyError} with code AUTH_CONFIG_INVALID / phase "config"
 *   on every rejection. The error message always cites the offending expression
 *   and never contains a resolved token or credential.
 */
export function parseJsonPath(expr: string): ParsedJsonPath | AuthStrategyError {
  // Phase 1a: length overflow check (before whitespace-only to avoid a large regex run)
  if (expr.length > MAX_JSONPATH_EXPRESSION_LENGTH) {
    return buildRejectError(
      expr,
      `expression exceeds maximum length ${MAX_JSONPATH_EXPRESSION_LENGTH}`,
    );
  }

  // Phase 1b: empty string (cannot appear in message via buildRejectError format)
  if (expr === "") {
    return new AuthStrategyError({
      code: AUTH_ERROR_CODES.AUTH_CONFIG_INVALID,
      phase: "config",
      message: `${REJECT_PREFIX}'': expression must not be empty`,
    });
  }

  // Phase 1c: whitespace-only
  if (/^\s+$/.test(expr)) {
    return buildRejectError(expr, "expression must not be whitespace-only");
  }

  // Phase 1d: bare "$" short-circuit — valid empty path
  if (expr === "$") {
    return [];
  }

  // Phase 1e: full-expression regex validation with classified error messages
  if (!JSONPATH_FULL.test(expr)) {
    const reason =
      classifyRejection(expr) ?? "expression does not match accepted grammar";
    return buildRejectError(expr, reason);
  }

  // Phase 2: scan segments on the post-"$" tail
  const tail = expr.slice(1);
  const segments: WalkSegment[] = [];
  const segmentRegex = new RegExp(JSONPATH_SEGMENT_SOURCE, "g");

  for (const match of tail.matchAll(segmentRegex)) {
    const keyGroup = match[1];
    const indexGroup = match[2];

    if (keyGroup !== undefined) {
      segments.push({ kind: "key", key: keyGroup });
    } else if (indexGroup !== undefined) {
      segments.push({ kind: "index", index: Number(indexGroup) });
    }
  }

  return segments;
}

/**
 * Pure no-throw extractor: walks `root` along a {@link ParsedJsonPath} and
 * returns the result (AC#3, AC#4).
 *
 * Delegates entirely to {@link walkPath} (D4 SSOT reuse — no duplicate walk
 * logic). The null-vs-missing rule is inherited verbatim from walkPath:
 *
 * - Explicit JSON `null` at the leaf: `{ found: true, value: null }`
 * - Missing key / OOB index / wrong-type descent / over-depth: `{ found: false }`
 * - Absent root (`undefined`) with bare `$`: `{ found: false }`
 *
 * The walk is iterative (walkPath enforces MAX_PATH_WALK_DEPTH = 256) so
 * paths with more than 256 segments return `{ found: false }` without stack overflow.
 *
 * The return type annotation is the same structural shape as WalkResult;
 * consumers need not import WalkResult from src/core to read the result.
 * @param root - The value to walk from (any unknown shape, including null).
 * @param path - A {@link ParsedJsonPath} produced by {@link parseJsonPath}.
 * @returns `{ found: true; value: unknown }` on success,
 *   or `{ found: false }` on any miss or depth-exceeded condition.
 */
export function extractByJsonPath(
  root: unknown,
  path: ParsedJsonPath,
): { readonly found: true; readonly value: unknown } | { readonly found: false } {
  return walkPath(root, path) satisfies WalkResult;
}
