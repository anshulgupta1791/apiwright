/**
 * Error and result types for the TargetPathParser. Extracted to break the
 * circular dependency between target-path-parser.ts and target-path-db.ts
 * while keeping target-path-parser.ts within the 300-line soft limit.
 * All types are re-exported from target-path-parser.ts for an unchanged
 * public API.
 */

import type { TargetRef } from "./types.js";

/**
 * Maximum accepted target-lexeme length, in UTF-16 code units.
 * 1024 is generous headroom yet far below any pathological-input concern.
 */
export const MAX_TARGET_LENGTH = 1024;

/**
 * One structural fault found while parsing a target lexeme.
 */
export interface TargetParseError {
  /** Stable machine code for the fault. */
  readonly code: TargetParseErrorCode;
  /** 0-based offending segment index, or `-1` if not segment-scoped. */
  readonly segmentIndex: number;
  /** 0-based char offset of the segment on the lexeme, or `0`. */
  readonly offset: number;
  /** Human-readable, context-bearing explanation. */
  readonly message: string;
}

/**
 * Stable target-path fault vocabulary (string-literal union — repo idiom;
 * never a numeric enum).
 */
export type TargetParseErrorCode =
  | "EMPTY_TARGET"
  | "TARGET_TOO_LONG"
  | "EMPTY_SEGMENT"
  | "UNKNOWN_ROOT"
  | "UNEXPECTED_SUBPATH"
  | "DB_PATH_INCOMPLETE";

/**
 * No-throw result of parsing ONE target lexeme. Failure side AGGREGATES every
 * fault found in the single pass.
 */
export type TargetParseResult =
  | { readonly ok: true; readonly ref: TargetRef }
  | { readonly ok: false; readonly errors: readonly TargetParseError[] };
