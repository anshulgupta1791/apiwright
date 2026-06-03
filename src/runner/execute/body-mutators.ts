/**
 * Body and URL mutators for per-kind request transformation.
 *
 * Extracted from case-runners.ts (M-6 refactor) to keep that file under the
 * 500-line hard cap. These are pure functions with no side effects.
 *
 * Contains:
 *   - `applyPaginationProbe` — rewrites the URL query string for a pagination probe.
 *   - `omitAtPath` — produces a body copy with a dot-notation field removed.
 *   - `substituteWrongType` — produces a body copy with a field replaced by a
 *     wrong-type value (for `type_violation_returns_400` cases).
 *   - `substituteAtPath` — produces a body copy with any dot-notation field replaced.
 */

import type { PaginationBoundaryParams } from "../../test-catalog/test-case-params.js";

/**
 * Mutates the URL's query string to apply the pagination probe.
 *
 * Uses the WHATWG `URL` constructor so an existing query string is preserved
 * and any pre-existing value for the probed param is overwritten (not
 * appended), per DD-2. The `buildBaseRequest` step always produces an
 * absolute URL via `joinUrl`, so `new URL(url)` never throws here in practice.
 * @param url - The absolute base URL from buildBaseRequest.
 * @param p - The pagination probe params.
 * @returns The mutated URL string (same host/path, updated query string).
 */
export function applyPaginationProbe(url: string, p: PaginationBoundaryParams): string {
  const u = new URL(url);
  switch (p.probe) {
    case "size_zero":
      u.searchParams.set(p.size_param, "0");
      break;
    case "size_max":
      u.searchParams.set(p.size_param, String(p.max_size));
      break;
    case "size_max_plus_one":
      u.searchParams.set(p.size_param, String(p.max_size + 1));
      break;
    case "page_negative":
      // Generator enforces page_param is non-empty before emitting this probe
      // (DD-7). The cast is safe: generator drops page_negative when page_param
      // is absent.
      u.searchParams.set(p.page_param ?? "page", "-1");
      break;
  }
  return u.toString();
}

/**
 * Returns a new object with the property at `path` removed. Supports
 * dot-notation (e.g., "user.name"). Returns input as-is if path is empty
 * or the object structure does not contain it.
 * @param body - The base body object.
 * @param path - Dot-notation path.
 * @returns A new object with the field omitted.
 */
export function omitAtPath(body: unknown, path: string): unknown {
  if (body === null || typeof body !== "object" || path.length === 0)
    return body;
  const segs = path.split(".");
  const clone = structuredClone(body) as Record<string, unknown>;
  let node: Record<string, unknown> = clone;
  for (let i = 0; i < segs.length - 1; i++) {
    const k = segs[i];
    /* istanbul ignore next — split() guarantees each segment at i<length-1 is defined. */
    if (k === undefined) return body;
    const next = node[k];
    if (next === null || typeof next !== "object") return body;
    node = next as Record<string, unknown>;
  }
  const last = segs[segs.length - 1];
  /* istanbul ignore next — split() guarantees segs is non-empty when path.length > 0. */
  if (last !== undefined) delete node[last];
  return clone;
}

/**
 * Returns a new object with `field` set to a wrong-type value. The catalog
 * pre-computes the wrong_type string; the runner picks a representative
 * value of that type.
 * @param body - The base body.
 * @param field - Dot-path of the field to substitute.
 * @param wrongType - JSON type name (string/number/boolean/object/array/null).
 * @returns A new body with the field substituted.
 */
export function substituteWrongType(
  body: unknown,
  field: string,
  wrongType: string,
): unknown {
  return substituteAtPath(body, field, wrongTypeValue(wrongType));
}

/**
 * Picks a deterministic representative value for a wrong-type substitution.
 * @param wrongType - JSON type name.
 * @returns A representative value of that type.
 */
function wrongTypeValue(wrongType: string): unknown {
  switch (wrongType) {
    case "string":
      return "wrong-type-substitute";
    case "number":
      return -1;
    case "boolean":
      return false;
    case "object":
      return {};
    case "array":
      return [];
    case "null":
      return null;
    /* istanbul ignore next — wrong_type values come from the catalog's closed enum. */
    default:
      return null;
  }
}

/**
 * Returns a new object with `path` set to `value`. Supports dot-notation.
 * @param body - The base body.
 * @param path - Dot-notation path.
 * @param value - Replacement value.
 * @returns A new body with the substitution applied.
 */
export function substituteAtPath(
  body: unknown,
  path: string,
  value: unknown,
): unknown {
  /* istanbul ignore next — defensive: catalog always emits non-empty paths on
     non-null object bodies; null/empty fallthrough exercised in omitAtPath tests. */
  if (body === null || typeof body !== "object" || path.length === 0)
    return body;
  const segs = path.split(".");
  const clone = structuredClone(body) as Record<string, unknown>;
  let node: Record<string, unknown> = clone;
  for (let i = 0; i < segs.length - 1; i++) {
    const k = segs[i];
    /* istanbul ignore next — split() guarantees each segment at i<length-1 is defined. */
    if (k === undefined) return body;
    const next = node[k];
    /* istanbul ignore next — defensive: catalog-generated paths target leaf scalars,
       traversal through nested objects is verified separately. */
    if (next === null || typeof next !== "object") return body;
    node = next as Record<string, unknown>;
  }
  const last = segs[segs.length - 1];
  /* istanbul ignore next — split() guarantees segs is non-empty when path.length > 0. */
  if (last !== undefined) node[last] = value;
  return clone;
}
