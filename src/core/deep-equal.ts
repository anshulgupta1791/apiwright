/**
 * Pure, total, type-strict, recursive structural deep-equality predicate.
 * Single source of truth for value equality across `src/assertions` (§4) and
 * `src/core`-consuming DB expect-mode (§5). No I/O, no global state, no
 * throwing — bounded by an explicit depth guard so the native call stack is
 * never exhausted on CI Node 22.
 */

/**
 * Maximum recursion depth for {@link deepEqual}. Chosen well above any
 * realistic JSON-derived API payload yet far below the native call-stack
 * limit of CI Node 22 (the smaller of the two runtimes), so the explicit
 * guard always trips BEFORE a native RangeError could. Plain numeric
 * `const` per the repo no-magic-number idiom (see `src/cli/exit-codes.ts`,
 * `src/test-catalog/schema-walker.ts`); deliberately NOT `as const`.
 */
export const DEEP_EQUAL_MAX_DEPTH = 200;

/** Options for {@link deepEqual} (tests override the depth guard). */
export interface DeepEqualOptions {
  /**
   * Override the recursion depth guard. Defaults to
   * {@link DEEP_EQUAL_MAX_DEPTH}. Tests pass a small value to exercise the
   * depth-exceeded branch deterministically without building huge inputs.
   */
  maxDepth?: number;
}

/**
 * Internal value category for the type-category check. Separates `null` and
 * `undefined` from other primitives, and `array` from `object`, so each
 * compound or primitive branch is unambiguous.
 */
type ValueCategory =
  | "null"
  | "undefined"
  | "number"
  | "string"
  | "boolean"
  | "bigint"
  | "symbol"
  | "function"
  | "array"
  | "object";

/**
 * Derives the {@link ValueCategory} for an arbitrary runtime value.
 * @param x - The value to categorize.
 * @returns The category string for `x`.
 */
function categoryOf(x: unknown): ValueCategory {
  if (x === null) return "null";
  if (x === undefined) return "undefined";
  if (Array.isArray(x)) return "array";
  const t = typeof x;
  if (
    t === "number" ||
    t === "string" ||
    t === "boolean" ||
    t === "bigint" ||
    t === "symbol" ||
    t === "function"
  ) {
    return t;
  }
  return "object";
}

/**
 * Returns `true` iff the category is a primitive (not compound).
 * Compound categories (`array`, `object`) require structural recursion.
 * @param cat - The category to test.
 * @returns `true` iff `cat` is a primitive category.
 */
function isPrimitive(cat: ValueCategory): boolean {
  return cat !== "array" && cat !== "object";
}

/**
 * Compares two NaN-checked numbers for the SameValueZero NaN-equals-NaN rule.
 * Returns `true` iff both values are NaN (via the self-inequality idiom).
 * @param x - The left numeric value.
 * @param y - The right numeric value.
 * @returns `true` iff both values are NaN.
 */
function bothNaN(x: number, y: number): boolean {
   
  return x !== x && y !== y;
}

/**
 * Signature for the internal recursive comparison function passed as a
 * parameter to the array and object helper routines, allowing those helpers
 * to recurse without directly naming `equalAtDepth` (avoids a forward
 * reference in the type system and keeps the helpers independently testable).
 */
type EqualFn = (
  a: unknown,
  b: unknown,
  d: number,
  m: number,
  s: WeakMap<object, WeakSet<object>>,
) => boolean;

/**
 * Compares two arrays element-by-element in order, recursing via `recurse`.
 * Short-circuits at the first unequal element.
 * @param arrX - Left array.
 * @param arrY - Right array.
 * @param depth - Current recursion depth.
 * @param maxDepth - Maximum permitted depth.
 * @param seen - Path-scoped cycle-tracking map.
 * @param recurse - The recursive comparison function to delegate to.
 * @returns `true` iff arrays are equal length and all elements are equal.
 */
function compareArrays(
  arrX: unknown[],
  arrY: unknown[],
  depth: number,
  maxDepth: number,
  seen: WeakMap<object, WeakSet<object>>,
  recurse: EqualFn,
): boolean {
  if (arrX.length !== arrY.length) return false;
  for (let i = 0; i < arrX.length; i++) {
    if (!recurse(arrX[i], arrY[i], depth + 1, maxDepth, seen)) return false;
  }
  return true;
}

/**
 * Compares two plain objects by own enumerable string keys (order-independent)
 * and recursively equal values via `recurse`. Short-circuits at the first
 * missing key or unequal value.
 * @param objX - Left object.
 * @param objY - Right object.
 * @param depth - Current recursion depth.
 * @param maxDepth - Maximum permitted depth.
 * @param seen - Path-scoped cycle-tracking map.
 * @param recurse - The recursive comparison function to delegate to.
 * @returns `true` iff the objects have the same own keys and equal values.
 */
function compareObjects(
  objX: object,
  objY: object,
  depth: number,
  maxDepth: number,
  seen: WeakMap<object, WeakSet<object>>,
  recurse: EqualFn,
): boolean {
  const keysX = Object.keys(objX);
  const keysY = Object.keys(objY);
  if (keysX.length !== keysY.length) return false;
  const recX = objX as Record<string, unknown>;
  const recY = objY as Record<string, unknown>;
  for (const k of keysX) {
    if (!Object.prototype.hasOwnProperty.call(objY, k)) return false;
    if (!recurse(recX[k], recY[k], depth + 1, maxDepth, seen)) return false;
  }
  return true;
}

/**
 * Records an in-progress `(objX, objY)` pair in the path-scoped seen map.
 * Returns the `WeakSet` for `objX` so the caller can remove `objY` after
 * the subtree comparison completes (path-scoped, not global-visited).
 * @param seen - Path-scoped cycle-tracking map.
 * @param objX - The left-hand compound value.
 * @param objY - The right-hand compound value.
 * @returns The `WeakSet` associated with `objX` (newly created or existing).
 */
function recordSeen(
  seen: WeakMap<object, WeakSet<object>>,
  objX: object,
  objY: object,
): WeakSet<object> {
  const existing = seen.get(objX);
  if (existing !== undefined) {
    existing.add(objY);
    return existing;
  }
  const ownY = new WeakSet<object>();
  ownY.add(objY);
  seen.set(objX, ownY);
  return ownY;
}

/**
 * Internal recursive helper. Compares `x` and `y` at the given recursion
 * depth, consulting and updating the path-scoped `seen` set to detect cycles.
 * All guard checks (type, depth, cycle) run here; the per-kind comparisons
 * delegate to {@link compareArrays} and {@link compareObjects}.
 * @param x - Left-hand value.
 * @param y - Right-hand value.
 * @param depth - Current recursion depth (0 at the root call).
 * @param maxDepth - Maximum permitted depth before returning `false`.
 * @param seen - Path-scoped set of in-progress `(x, y)` object pairs.
 * @returns `true` iff the values are structurally deep-equal.
 */
function equalAtDepth(
  x: unknown,
  y: unknown,
  depth: number,
  maxDepth: number,
  seen: WeakMap<object, WeakSet<object>>,
): boolean {
  const catX = categoryOf(x);
  const catY = categoryOf(y);
  if (catX !== catY) return false;

  if (isPrimitive(catX)) {
    if (x === y) return true;
    if (catX === "number" && bothNaN(x as number, y as number)) return true;
    return false;
  }

  // Both sides are compound (array or object).
  const objX = x as object;
  const objY = y as object;

  // Depth guard — checked BEFORE descending into a compound (mirrors
  // WALKER_MAX_DEPTH "guard before descent" idiom from SchemaWalker).
  if (depth >= maxDepth) return false;

  // Cycle guard — path-scoped: fires only on back-edges, not shared sub-objects.
  const seenY = seen.get(objX);
  if (seenY !== undefined && seenY.has(objY)) return false;

  const ownY = recordSeen(seen, objX, objY);

  const result =
    catX === "array"
      ? compareArrays(
          x as unknown[],
          y as unknown[],
          depth,
          maxDepth,
          seen,
          equalAtDepth,
        )
      : compareObjects(objX, objY, depth, maxDepth, seen, equalAtDepth);

  // Remove from seen after subtree completes — path-scoped, not global.
  ownY.delete(objY);
  return result;
}

/**
 * Pure, total, type-strict, recursive structural deep-equality predicate.
 *
 * Returns `true` iff `a` and `b` are structurally deep-equal under STRICT
 * type rules with ZERO coercion:
 * - Primitives: equal iff identical JS runtime type AND identical value
 *   (e.g. `201` !== `"201"`, `true` !== `"true"`, `null` equals only
 *   `null`). `NaN` is treated as EQUAL to `NaN` (reflexive); `+0` and `-0`
 *   are treated as EQUAL (matches JSON round-trip semantics).
 * - Arrays: equal iff both are arrays, same `length`, and element-wise
 *   recursively equal IN ORDER (order-sensitive). Holes in sparse arrays
 *   are treated as the value `undefined`.
 * - Plain objects: equal iff both are non-array objects with the same set
 *   of own enumerable string keys (order-INdependent) and recursively-equal
 *   values for every key.
 * - An array is NEVER equal to a non-array object, even with "similar"
 *   content.
 *
 * Recursion is bounded by an EXPLICIT depth guard checked BEFORE each
 * descent. If a cyclic reference is encountered or either input exceeds
 * `maxDepth`, the function returns a definitive `false` — it NEVER throws a
 * RangeError and NEVER relies on native stack overflow. Pure and
 * deterministic: no I/O, Date, or random.
 * @param a - First value (a JSON-derived value or literal operand).
 * @param b - Second value (a JSON-derived value or literal operand).
 * @param options - Optional depth-guard override.
 * @returns `true` iff the values are structurally deep-equal; else `false`.
 */
export function deepEqual(
  a: unknown,
  b: unknown,
  options?: DeepEqualOptions,
): boolean {
  const maxDepth = options?.maxDepth ?? DEEP_EQUAL_MAX_DEPTH;
  const seen = new WeakMap<object, WeakSet<object>>();
  return equalAtDepth(a, b, 0, maxDepth, seen);
}
