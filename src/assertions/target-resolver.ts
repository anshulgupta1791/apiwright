/**
 * Layer-C resolver: navigates a `TargetRef` through an `EvaluationContext` to
 * produce a discriminated `ResolvedValue`. This is the SOLE owner of the
 * `ResolvedValue` contract; all other Layer-C modules import from here.
 *
 * Pure, deterministic, total, hermetic, and NEVER throws. Iterative depth-
 * bounded walk — NO recursion.
 */

import type { EvaluationContext, PathSegment, TargetRef } from "./types.js";

/**
 * Maximum number of path segments this resolver will traverse in a single
 * call. Paths longer than this return `{ found: false }`. Named constant per
 * the `no-magic-numbers` rule; 256 is generous headroom for any realistic §4
 * assertion.
 */
export const MAX_RESOLVE_DEPTH = 256;

/**
 * The discriminated outcome of resolving a {@link TargetRef} against an
 * {@link EvaluationContext}. Sole owner of this contract; imported by every
 * Layer-C operator evaluator and the arithmetic evaluator.
 *
 * - `{ found: true; value }` — path fully resolved; `value` MAY be `null`
 *   (an explicit JSON null — distinct from a missing path, per locked
 *   decision #6).
 * - `{ found: false }` — path did not resolve.
 */
export type ResolvedValue =
  | { readonly found: true; readonly value: unknown }
  | { readonly found: false };

/** Sentinel used throughout the module for a clean not-found return. */
const NOT_FOUND: ResolvedValue = Object.freeze({ found: false });

/**
 * Pure, stateless resolver that navigates `TargetRef` paths through an
 * `EvaluationContext`. Stateless → a single instance can be shared.
 * One-class-per-file (repo idiom). NEVER throws.
 */
export class TargetResolver {
  /**
   * Resolve `ref` against `context`. NEVER throws. Pure and deterministic.
   * @param ref - The Layer-A target reference to resolve.
   * @param context - The hermetic evaluation context for this assertion run.
   * @returns `{ found:true, value }` or `{ found:false }`.
   */
  resolve(ref: TargetRef, context: EvaluationContext): ResolvedValue {
    const root = ref.root;

    if (root === "response.status") {
      return this.#safeFound(context.response?.status);
    }
    if (root === "response.time_ms") {
      return this.#safeFound(context.response?.time_ms);
    }
    if (root === "response.body") {
      return this.#walkPath(context.response?.body, ref.path);
    }
    if (root === "response.headers") {
      return this.#resolveHeaders(context.response?.headers, ref.path);
    }
    if (root === "request.body") {
      return this.#walkPath(context.request?.body, ref.path);
    }
    if (root === "request.headers") {
      return this.#resolveHeaders(context.request?.headers, ref.path);
    }
    if (root === "request.url") {
      return this.#walkPath(context.request?.url, ref.path);
    }
    if (root === "db") {
      return this.#resolveDb(ref, context);
    }
    return NOT_FOUND;
  }

  /**
   * Wrap an already-known value as a found result. Defensive: if the context
   * field itself is undefined (e.g. `context.response` is null), returns
   * NOT_FOUND.
   * @param value - The value to wrap.
   * @returns `{ found:true, value }` or `{ found:false }` if undefined.
   */
  #safeFound(value: unknown): ResolvedValue {
    if (value === undefined) return NOT_FOUND;
    return { found: true, value };
  }

  /**
   * Walk `path` through `root` using an iterative depth-bounded loop.
   * Returns NOT_FOUND on depth overflow, missing key, OOB index, or bad type.
   * @param root - The starting value to walk from.
   * @param path - Ordered array of path segments.
   * @returns The resolved value or NOT_FOUND.
   */
  #walkPath(root: unknown, path: readonly PathSegment[] | undefined): ResolvedValue {
    if (path === undefined || path.length === 0) {
      // Invariant (per design): `found:true` ⇒ value is never `undefined`.
      // An absent whole-container root (undefined) is NOT_FOUND; an explicit
      // JSON `null` IS a real value and stays found:true.
      if (root === undefined) return NOT_FOUND;
      return { found: true, value: root };
    }
    if (path.length > MAX_RESOLVE_DEPTH) return NOT_FOUND;

    let current: unknown = root;
    for (let d = 0; d < path.length; d++) {
      const seg = path[d];
      if (seg === undefined) return NOT_FOUND;
      const stepped = this.#step(current, seg);
      if (!stepped.found) return NOT_FOUND;
      // If not the last segment and we got null, it's a descent-through-null → not-found
      if (stepped.value === null && d < path.length - 1) return NOT_FOUND;
      current = stepped.value;
    }
    return { found: true, value: current };
  }

  /**
   * Advance one segment through `current`. Returns found/not-found.
   * Key segments use prototype-safe own-property check. Index segments require
   * an array with an in-bounds index.
   * @param current - Current node value.
   * @param seg - The segment to apply.
   * @returns Resolution result for this single step.
   */
  #step(current: unknown, seg: PathSegment): ResolvedValue {
    if (seg.kind === "key") {
      return this.#stepKey(current, seg.key);
    }
    return this.#stepIndex(current, seg.index);
  }

  /**
   * Apply a key segment to `current`.
   * Arrays are not addressable by key (use an index segment instead).
   * @param current - Current node value.
   * @param key - The object key to look up.
   * @returns Found result or NOT_FOUND.
   */
  #stepKey(current: unknown, key: string): ResolvedValue {
    if (current === null || typeof current !== "object") return NOT_FOUND;
    if (Array.isArray(current)) return NOT_FOUND;
    // Prototype-pollution safety: only own properties.
    if (!Object.prototype.hasOwnProperty.call(current, key)) return NOT_FOUND;
    // Use Object.getOwnPropertyDescriptor to safely read, catching __proto__ tricks.
    const desc = Object.getOwnPropertyDescriptor(current, key);
    if (desc === undefined) return NOT_FOUND;
    return { found: true, value: desc.value as unknown };
  }

  /**
   * Apply an index segment to `current`.
   * @param current - Current node value.
   * @param index - The array index to look up.
   * @returns Found result or NOT_FOUND.
   */
  #stepIndex(current: unknown, index: number): ResolvedValue {
    if (!Array.isArray(current)) return NOT_FOUND;
    if (index < 0 || index >= current.length) return NOT_FOUND;
    return { found: true, value: current[index] as unknown };
  }

  /**
   * Resolve a headers ref with case-insensitive first-match lookup. On ties,
   * picks the lexicographically smallest own key.
   * @param headers - The headers object (may be undefined/null).
   * @param path - The path from the TargetRef (first segment is the header name).
   * @returns Found result with the header value, or NOT_FOUND.
   */
  #resolveHeaders(
    headers: unknown,
    path: readonly PathSegment[],
  ): ResolvedValue {
    if (!path || path.length === 0) {
      return { found: true, value: headers };
    }
    const firstSeg = path[0];
    if (!firstSeg || firstSeg.kind !== "key") return NOT_FOUND;
    if (headers === null || typeof headers !== "object") return NOT_FOUND;

    const needle = firstSeg.key.toLowerCase();
    const ownKeys = Object.keys(headers).sort();
    const matchedKey = ownKeys.find((k) => k.toLowerCase() === needle);
    if (matchedKey === undefined) return NOT_FOUND;

    const headerValue: unknown = (headers as Record<string, unknown>)[matchedKey];
    // Walk remaining path into the header value
    return this.#walkPath(headerValue, path.slice(1));
  }

  /**
   * Resolve a `db` root target. Looks up connection → queryId, then walks any
   * trailing path through the NormalizedResult.
   * @param ref - The db-variant TargetRef.
   * @param context - The evaluation context.
   * @returns Found result or NOT_FOUND.
   */
  #resolveDb(ref: TargetRef & { root: "db" }, context: EvaluationContext): ResolvedValue {
    const db = context.db;
    if (db === null || typeof db !== "object") return NOT_FOUND;

    const conn = db[ref.connection];
    if (conn === undefined || conn === null || typeof conn !== "object") return NOT_FOUND;

    const nr: unknown = (conn as Record<string, unknown>)[ref.queryId];
    if (nr === undefined) return NOT_FOUND;

    return this.#walkPath(nr, ref.path);
  }
}
