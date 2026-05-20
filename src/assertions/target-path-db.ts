/**
 * DB-branch parsing helpers for the TargetPathParser. Handles the
 * `db.<connection>.<query_id>.<trailing>` path structure. Extracted from
 * target-path-parser.ts to keep that file within the 300-line soft limit.
 */

import type { TargetParseError, TargetParseResult } from "./target-path-types.js";
import type { PathSegment, TargetRef } from "./types.js";

/** Segment index at which the `db` trailing path begins (after root+conn+qid). */
const DB_TRAILING_PATH_START = 3;

/** Single anchored char-class test for all-digits (backtracking-incapable). */
const ALL_DIGITS_RE = /^[0-9]+$/;

/**
 * Classify trailing path segments into PathSegment array.
 * All-digits segments become `index` nodes; all others become `key` nodes.
 * @param segs - Trailing segments after the root prefix.
 * @returns Ordered array of PathSegment values.
 */
export function classifyPath(segs: string[]): readonly PathSegment[] {
  const result: PathSegment[] = [];
  for (const seg of segs) {
    if (seg === "") continue; // already reported as EMPTY_SEGMENT
    if (ALL_DIGITS_RE.test(seg)) {
      result.push({ kind: "index", index: Number(seg) });
    } else {
      result.push({ kind: "key", key: seg });
    }
  }
  return result;
}

/**
 * Handle the `db.<connection>.<query_id>[.<trailing>]` structure.
 * @param segs - Dot-split segments.
 * @param offsets - Per-segment start offsets.
 * @param errors - Accumulated errors (mutated).
 * @returns A TargetParseResult.
 */
export function captureDb(
  segs: string[],
  offsets: number[],
  errors: TargetParseError[],
): TargetParseResult {
  if (segs.length === 1) {
    errors.push({
      code: "DB_PATH_INCOMPLETE",
      segmentIndex: 1,
      offset: offsets[offsets.length - 1] ?? 0,
      message: "'db' target requires '.<connection>.<query_id>'; both missing",
    });
    return { ok: false, errors };
  }

  if (segs.length === 2) return captureDbMissingQueryId(segs, offsets, errors);

  return captureDbFull(segs, offsets, errors);
}

/**
 * Handle `db.<x>` where the query_id is absent.
 * @param segs - Dot-split segments.
 * @param offsets - Per-segment start offsets.
 * @param errors - Accumulated errors (mutated).
 * @returns An ok:false TargetParseResult.
 */
function captureDbMissingQueryId(
  segs: string[],
  offsets: number[],
  errors: TargetParseError[],
): TargetParseResult {
  const seg1 = segs[1];
  if (seg1 === "") {
    errors.push({
      code: "DB_PATH_INCOMPLETE",
      segmentIndex: 1,
      offset: offsets[1] ?? 0,
      message: "'db' target has empty connection and missing query_id",
    });
  } else {
    errors.push({
      code: "DB_PATH_INCOMPLETE",
      segmentIndex: 2,
      offset: (offsets[1] ?? 0) + (seg1?.length ?? 0) + 1,
      message: `'db' target missing query_id (expected 'db.<connection>.<query_id>')`,
    });
  }
  return { ok: false, errors };
}

/**
 * Handle `db.<connection>.<query_id>[.<trailing>]` (segs.length >= 3).
 * @param segs - Dot-split segments.
 * @param offsets - Per-segment start offsets.
 * @param errors - Accumulated errors (mutated).
 * @returns A TargetParseResult.
 */
function captureDbFull(
  segs: string[],
  offsets: number[],
  errors: TargetParseError[],
): TargetParseResult {
  const seg1 = segs[1];
  const seg2 = segs[2];

  if (seg1 === "") {
    errors.push({
      code: "DB_PATH_INCOMPLETE",
      segmentIndex: 1,
      /* istanbul ignore next — noUncheckedIndexedAccess: captureDbFull is only called
         when segs.length >= 3 (guaranteed by the caller), so offsets[1] is always defined;
         the ?? 0 fallback is a TypeScript strictness requirement, not a runtime path. */
      offset: offsets[1] ?? 0,
      message: "'db' target has empty connection name",
    });
  }
  if (seg2 === "") {
    errors.push({
      code: "DB_PATH_INCOMPLETE",
      segmentIndex: 2,
      /* istanbul ignore next — noUncheckedIndexedAccess: captureDbFull is only called
         when segs.length >= 3 (guaranteed by the caller), so offsets[2] is always defined;
         the ?? 0 fallback is a TypeScript strictness requirement, not a runtime path. */
      offset: offsets[2] ?? 0,
      message: "'db' target has empty query_id",
    });
  }
  if (seg1 === "" || seg2 === "") return { ok: false, errors };
  if (errors.length > 0) return { ok: false, errors };

  // seg1 and seg2 are guaranteed non-empty strings here;
  /* istanbul ignore next — noUncheckedIndexedAccess: seg1 is segs[1] which is defined
     (segs.length >= 3) and non-empty (checked above); ?? "" is unreachable at runtime. */
  const connection = seg1 ?? "";
  /* istanbul ignore next — noUncheckedIndexedAccess: seg2 is segs[2] which is defined
     (segs.length >= 3) and non-empty (checked above); ?? "" is unreachable at runtime. */
  const queryId = seg2 ?? "";
  const path = classifyPath(segs.slice(DB_TRAILING_PATH_START));
  return { ok: true, ref: { root: "db", connection, queryId, path } as TargetRef };
}
