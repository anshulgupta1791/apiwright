/**
 * Pure, deterministic, no-throw parser turning one raw dotted target lexeme
 * (a Layer-B TargetToken `raw` string) into a Layer-A TargetRef.
 * Single bounded forward pass over segments — no recursion.
 *
 * Types live in {@link ./target-path-types.js} and DB-branch helpers in
 * {@link ./target-path-db.js} to keep this file within the 300-line soft limit.
 * All types are re-exported here for an unchanged public API.
 */

import { captureDb, classifyPath } from "./target-path-db.js";
import type { TargetParseError, TargetParseResult } from "./target-path-types.js";
import { MAX_TARGET_LENGTH } from "./target-path-types.js";
import type { PathSegment, TargetRef } from "./types.js";

export { MAX_TARGET_LENGTH } from "./target-path-types.js";
export type {
  TargetParseError,
  TargetParseErrorCode,
  TargetParseResult,
} from "./target-path-types.js";
export type { PathSegment };

/** Valid second segments for `request.*` targets. */
const REQUEST_SUB = new Set(["headers", "body", "url"]);
/** Leaf (scalar) second segments for `response.*` targets (no trailing path). */
const RESPONSE_LEAF_SUB = new Set(["status", "time_ms"]);
/** Container second segments for `response.*` targets (allow trailing path). */
const RESPONSE_CONTAINER_SUB = new Set(["headers", "body"]);

/**
 * Pure, deterministic, no-throw parser turning ONE raw dotted target lexeme
 * into a Layer-A TargetRef. Identical input ALWAYS yields a deep-equal result.
 * Single bounded forward pass — NO recursion.
 */
export class TargetPathParser {
  /**
   * Parses one raw dotted target lexeme into a typed TargetRef. NEVER throws.
   * @param lexeme - One raw target lexeme exactly as the lexer captured it.
   * @returns A TargetParseResult.
   */
  parse(lexeme: string): TargetParseResult {
    const errors: TargetParseError[] = [];

    if (lexeme.length > MAX_TARGET_LENGTH) {
      return {
        ok: false,
        errors: [{
          code: "TARGET_TOO_LONG",
          segmentIndex: -1,
          offset: 0,
          message:
            `Target lexeme length ${lexeme.length} exceeds maximum ${MAX_TARGET_LENGTH}`,
        }],
      };
    }

    if (lexeme.length === 0 || /^[ \t\r\n]*$/.test(lexeme)) {
      return {
        ok: false,
        errors: [{
          code: "EMPTY_TARGET",
          segmentIndex: -1,
          offset: 0,
          message: "Empty or whitespace-only target lexeme",
        }],
      };
    }

    const { segs, offsets } = this.#segment(lexeme, errors);
    const seg0 = segs[0];

    if (seg0 === "request") return this.#parseRequest(segs, offsets, errors);
    if (seg0 === "response") return this.#parseResponse(segs, offsets, errors);
    if (seg0 === "db") return captureDb(segs, offsets, errors);

    return this.#handleUnknownRoot(seg0, offsets, errors);
  }

  #segment(
    lexeme: string,
    errors: TargetParseError[],
  ): { segs: string[]; offsets: number[] } {
    const segs = lexeme.split(".");
    const offsets: number[] = [];
    let acc = 0;
    for (let k = 0; k < segs.length; k++) {
      offsets.push(acc);
      const seg = segs[k];
      if (seg !== undefined) acc += seg.length + 1;
    }
    for (let k = 0; k < segs.length; k++) {
      if (segs[k] === "") {
        errors.push({
          code: "EMPTY_SEGMENT",
          segmentIndex: k,
          offset: offsets[k] ?? 0,
          message: `Empty path segment at position ${k} (leading, trailing, or doubled '.')`,
        });
      }
    }
    return { segs, offsets };
  }

  #parseRequest(
    segs: string[],
    offsets: number[],
    errors: TargetParseError[],
  ): TargetParseResult {
    const seg1 = segs[1];
    if (seg1 === undefined || seg1 === "") {
      errors.push({
        code: "UNKNOWN_ROOT",
        segmentIndex: 0,
        offset: offsets[0] ?? 0,
        message: "'request' requires one of headers/body/url as second segment",
      });
      return { ok: false, errors };
    }
    if (!REQUEST_SUB.has(seg1)) {
      errors.push({
        code: "UNKNOWN_ROOT",
        segmentIndex: 1,
        offset: offsets[1] ?? 0,
        message:
          `Unknown request sub-namespace '${seg1}'; expected one of: headers, body, url`,
      });
      return { ok: false, errors };
    }
    if (errors.length > 0) return { ok: false, errors };
    const root = `request.${seg1}` as TargetRef["root"];
    const path = classifyPath(segs.slice(2));
    return { ok: true, ref: { root, path } as TargetRef };
  }

  #parseResponse(
    segs: string[],
    offsets: number[],
    errors: TargetParseError[],
  ): TargetParseResult {
    const seg1 = segs[1];
    if (seg1 === undefined || seg1 === "") {
      errors.push({
        code: "UNKNOWN_ROOT",
        segmentIndex: 0,
        offset: offsets[0] ?? 0,
        message: "'response' requires one of status/headers/body/time_ms as second segment",
      });
      return { ok: false, errors };
    }
    if (!RESPONSE_LEAF_SUB.has(seg1) && !RESPONSE_CONTAINER_SUB.has(seg1)) {
      errors.push({
        code: "UNKNOWN_ROOT",
        segmentIndex: 1,
        offset: offsets[1] ?? 0,
        message:
          `Unknown response sub-namespace '${seg1}'; ` +
          `expected one of: status, headers, body, time_ms`,
      });
      return { ok: false, errors };
    }
    if (errors.length > 0) return { ok: false, errors };
    const root = `response.${seg1}` as TargetRef["root"];
    if (RESPONSE_LEAF_SUB.has(seg1)) {
      return this.#parseResponseLeaf(segs, offsets, errors, root, seg1);
    }
    const path = classifyPath(segs.slice(2));
    return { ok: true, ref: { root, path } as TargetRef };
  }

  #parseResponseLeaf(
    segs: string[],
    offsets: number[],
    errors: TargetParseError[],
    root: TargetRef["root"],
    seg1: string,
  ): TargetParseResult {
    if (segs.length > 2) {
      errors.push({
        code: "UNEXPECTED_SUBPATH",
        segmentIndex: 2,
        /* istanbul ignore next — noUncheckedIndexedAccess: this branch is only reached
           when segs.length > 2, so offsets[2] and segs[2] are always defined;
           the ?? fallbacks are TypeScript strictness requirements, not runtime paths. */
        offset: offsets[2] ?? 0,
        message:
          `'response.${seg1}' is a terminal target and takes no sub-path; ` +
          `unexpected '.${segs[2] ?? ""}...'`,
      });
      return { ok: false, errors };
    }
    return { ok: true, ref: { root } as TargetRef };
  }

  #handleUnknownRoot(
    seg0: string | undefined,
    offsets: number[],
    errors: TargetParseError[],
  ): TargetParseResult {
    if (seg0 === undefined || seg0 === "") {
      errors.push({
        code: "UNKNOWN_ROOT",
        segmentIndex: 0,
        /* istanbul ignore next — noUncheckedIndexedAccess: offsets[0] is always defined
           because #segment always pushes acc at index 0 before any segments are processed;
           the ?? 0 fallback is a TypeScript strictness requirement, not a runtime path. */
        offset: offsets[0] ?? 0,
        message:
          "Cannot identify root from empty segment; expected one of: request, response, db",
      });
    } else {
      errors.push({
        code: "UNKNOWN_ROOT",
        segmentIndex: 0,
        /* istanbul ignore next — noUncheckedIndexedAccess: offsets[0] is always defined
           because #segment always pushes acc at index 0 before any segments are processed;
           the ?? 0 fallback is a TypeScript strictness requirement, not a runtime path. */
        offset: offsets[0] ?? 0,
        message: `Unknown root '${seg0}'; expected one of: request, response, db`,
      });
    }
    return { ok: false, errors };
  }
}
