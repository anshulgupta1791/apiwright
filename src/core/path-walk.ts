/**
 * Bounded, null-aware, prototype-safe structural path-walk primitive.
 * Single source of truth for iterative path resolution across `src/assertions`
 * (§4) and `src/core`-consuming template-ref resolution (§5). Pure, stateless,
 * no-throw, non-recursive. Zero runtime dependency, zero import.
 */

/**
 * Maximum number of path segments {@link walkPath} traverses in one call.
 * Paths longer than this yield a not-found result (NEVER a native stack
 * overflow — the walk is iterative). Named constant per `no-magic-numbers`;
 * 256 is generous headroom for any realistic assertion / template ref. This
 * is the SAME value and SAME `length > MAX` branch as the prior
 * `TargetResolver.#walkPath` (preserved exactly for behavior parity).
 */
export const MAX_PATH_WALK_DEPTH = 256;

/**
 * One step in a structural dotted path: an object key OR a numeric array
 * index. Deliberately MINIMAL and structural so any caller's richer segment
 * type (e.g. §4's `PathSegment`) satisfies it WITHOUT `src/core` importing
 * `src/assertions`. Key segments use prototype-safe own-property access;
 * index segments require an in-bounds array index.
 */
export type WalkSegment =
  | { readonly kind: "key"; readonly key: string }
  | { readonly kind: "index"; readonly index: number };

/**
 * Discriminated outcome of {@link walkPath}. GENERIC (intentionally NOT §4's
 * `ResolvedValue`) so both §4 (adapts to `ResolvedValue`) and §5 (adapts to
 * its own template-ref result) layer their domain shapes on top without
 * either depending on the other.
 *
 * - `{ found: true; value }` — path fully resolved. `value` MAY be `null`
 *   (an explicit JSON `null` leaf is a real value — distinct from a missing
 *   path, per locked decision #6).
 * - `{ found: false }` — missing key, OOB index, wrong-type descent,
 *   descent-through-`null`, over-depth, or an absent whole-container root.
 */
export type WalkResult =
  | { readonly found: true; readonly value: unknown }
  | { readonly found: false };

/** Frozen sentinel for a not-found result (shared across all callers). */
const NOT_FOUND: WalkResult = Object.freeze({ found: false });

/**
 * Apply a key segment to `current`. Arrays are not key-addressable.
 * Prototype-pollution safe: only own properties via `hasOwnProperty` +
 * `getOwnPropertyDescriptor`.
 * @param current - Current node value.
 * @param key - The object key to look up.
 * @returns Found result or NOT_FOUND.
 */
function stepKey(current: unknown, key: string): WalkResult {
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
 * Apply an index segment to `current`. Requires an array with an in-bounds
 * non-negative index.
 * @param current - Current node value.
 * @param index - The array index to look up.
 * @returns Found result or NOT_FOUND.
 */
function stepIndex(current: unknown, index: number): WalkResult {
  if (!Array.isArray(current)) return NOT_FOUND;
  if (index < 0 || index >= current.length) return NOT_FOUND;
  return { found: true, value: current[index] as unknown };
}

/**
 * Advance one segment through `current`. Dispatches to {@link stepKey} or
 * {@link stepIndex} by segment kind.
 * @param current - Current node value.
 * @param seg - The segment to apply.
 * @returns Resolution result for this single step.
 */
function stepSegment(current: unknown, seg: WalkSegment): WalkResult {
  if (seg.kind === "key") {
    return stepKey(current, seg.key);
  }
  return stepIndex(current, seg.index);
}

/**
 * Walk `segments` through `root` with an iterative, depth-bounded loop.
 * Pure, deterministic, total — NEVER throws, NEVER recurses, NEVER reads the
 * prototype chain. Returns a not-found result on over-depth, missing key,
 * out-of-bounds index, key-on-array, index-on-non-array, or
 * descent-through-`null`/`undefined`/primitive. An explicit JSON `null`
 * REACHED AS THE FINAL value is found:true,value:null. An absent
 * whole-container root (`undefined`) with no segments is not-found (the
 * `found:true ⇒ value !== undefined` invariant).
 * @param root - The starting value to walk from (any unknown shape).
 * @param segments - Ordered structural segments; `undefined`/empty walks to
 *   `root` itself (subject to the absent-root rule above).
 * @returns A {@link WalkResult}.
 */
export function walkPath(
  root: unknown,
  segments: readonly WalkSegment[] | undefined,
): WalkResult {
  if (segments === undefined || segments.length === 0) {
    // Invariant: `found:true` ⇒ value is never `undefined`.
    // An absent whole-container root (undefined) is NOT_FOUND; an explicit
    // JSON `null` IS a real value and stays found:true.
    if (root === undefined) return NOT_FOUND;
    return { found: true, value: root };
  }
  if (segments.length > MAX_PATH_WALK_DEPTH) return NOT_FOUND;

  let current: unknown = root;
  for (let d = 0; d < segments.length; d++) {
    const seg = segments[d];
    if (seg === undefined) return NOT_FOUND;
    const stepped = stepSegment(current, seg);
    if (!stepped.found) return NOT_FOUND;
    // If not the last segment and we got null, it's a descent-through-null → not-found
    if (stepped.value === null && d < segments.length - 1) return NOT_FOUND;
    current = stepped.value;
  }
  return { found: true, value: current };
}
