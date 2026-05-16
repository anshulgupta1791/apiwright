/**
 * Shared, namespace-agnostic tree-walking utilities for the env module.
 * Both the secret resolver and the template resolver walk the same kind of
 * parsed-YAML tree (string/number/boolean/null/array/plain-object). Extracting
 * the recursion here keeps the two resolvers DRY (pipeline invariant) and
 * isolates the traversal logic for focused testing.
 */

/**
 * Recursively visits every string leaf in a parsed-config tree, invoking the
 * visitor for each. Object keys are not visited (values only). Non-string
 * leaves are ignored.
 * @param value - The current node (any tree node).
 * @param visit - Callback invoked with each string leaf encountered.
 */
export function walkStrings(
  value: unknown,
  visit: (str: string) => void,
): void {
  if (typeof value === "string") {
    visit(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      walkStrings(item, visit);
    }
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) {
      walkStrings(v, visit);
    }
  }
}

/**
 * Recursively rebuilds a parsed-config tree, replacing each string leaf with
 * the result of `mapString`. Arrays and plain objects are reconstructed
 * (input is never mutated); non-string leaves pass through unchanged. The
 * mapper may return any value, enabling typed substitution (e.g. a string
 * token replaced by a number).
 * @param value - The current node.
 * @param mapString - Maps a string leaf to its replacement value.
 * @returns A new node with string leaves mapped.
 */
export function mapTree(
  value: unknown,
  mapString: (str: string) => unknown,
): unknown {
  if (typeof value === "string") {
    return mapString(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => mapTree(item, mapString));
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      // defineProperty (not out[k]=) so a literal "__proto__" key in the
      // config becomes an own property instead of mutating the prototype.
      Object.defineProperty(out, k, {
        value: mapTree(v, mapString),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    return out;
  }
  return value;
}
