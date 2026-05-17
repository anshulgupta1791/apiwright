/**
 * Path naming utilities: produces filesystem-safe, charset-constrained slugs
 * for endpoint IDs and file/directory names.
 *
 * Shared by PostmanRequestConverter (endpoint id generation) and
 * PostmanOutputWriter (directory + filename sanitization). Single source of
 * slug logic, DRY enforced structurally.
 */

/** Fallback slug when input yields empty result for endpoint IDs. */
const ID_FALLBACK = "endpoint";

/** Fallback slug when input yields empty result for path segments. */
const PATH_FALLBACK = "unnamed";

/**
 * Produces filesystem-safe, charset-constrained slugs for endpoint IDs
 * and directory/file path segments.
 *
 * Slug rule: NFKD normalize → strip diacritics → lowercase → replace
 * non-[a-z0-9._-] runs with _ → collapse repeated _ → trim leading/trailing
 * separators → fallback when empty.
 */
export class PathNamer {
  /**
   * Slugifies arbitrary text to the endpoint-id charset ^[a-z0-9._-]+$.
   * Lowercase; non-matching runs → "_"; trim leading/trailing separators;
   * empty result → "endpoint".
   * @param text - Source text (e.g. a request name).
   * @returns A slug guaranteed to match ^[a-z0-9._-]+$.
   */
  toIdSlug(text: string): string {
    return this.#slugify(text, ID_FALLBACK);
  }

  /**
   * Slugifies text for a single filesystem path segment (folder or file
   * stem): lowercase, non [a-z0-9._-] → "_", trim, empty → "unnamed".
   * @param text - Source text.
   * @returns A filesystem-safe segment.
   */
  toPathSegment(text: string): string {
    return this.#slugify(text, PATH_FALLBACK);
  }

  /**
   * Returns a unique value for `candidate` given an already-used set,
   * appending "_2", "_3", … until unique, and records the used value.
   * Deterministic for a fixed call order.
   * @param candidate - The proposed slug.
   * @param used - Mutable set of already-allocated slugs.
   * @returns A unique slug; `used` is updated.
   */
  dedupe(candidate: string, used: Set<string>): string {
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }

    let n = 2;
    while (used.has(`${candidate}_${n}`)) {
      n++;
    }
    const result = `${candidate}_${n}`;
    used.add(result);
    return result;
  }

  /**
   * Core slugification: NFKD normalize, strip diacritics, lowercase,
   * replace illegal runs, collapse underscores, trim separators.
   * @param text - Source text.
   * @param fallback - Value to return when result would be empty.
   * @returns A slug matching ^[a-z0-9._-]+$.
   */
  #slugify(text: string, fallback: string): string {
    // NFKD normalize + strip combining characters (diacritics)
    const normalized = text.normalize("NFKD").replace(/[̀-ͯ]/g, ""); // strip combining diacritical marks

    const lowered = normalized.toLowerCase();

    // Replace runs of illegal characters with a single underscore
    const replaced = lowered.replace(/[^a-z0-9._-]+/g, "_");

    // Collapse repeated underscores
    const collapsed = replaced.replace(/_+/g, "_");

    // Trim leading/trailing separators (_, -, .)
    const trimmed = collapsed.replace(/^[_\-.]+|[_\-.]+$/g, "");

    return trimmed === "" ? fallback : trimmed;
  }
}
