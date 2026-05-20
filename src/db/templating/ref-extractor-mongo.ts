/**
 * Mongo-document extraction pass for {@link extractRefs}.
 * Internal sibling of `ref-extractor.ts`; NOT exported from the package.
 *
 * Handles the `object | unknown[]` (Mongo command/filter document) branch of
 * the extraction: a two-pass algorithm that (1) scans all string value-leaves
 * to classify `${...}` refs (populating the shared accumulators), then (2)
 * deep-clones the document with sentinel substitution via the `src/env`
 * `walkStrings`/`mapTree` tree-walk reuse. Object KEYS are intentionally NOT
 * walked (non-bindable-position contract, D3).
 */

import { mapTree, walkStrings } from "../../env/tree-walk.js";

import { GENERIC_REF_RE, classifyInner, sentinel } from "./ref-extractor.js";
import type { ExtractResult, NeutralQuery, Ref, RefRejection } from "./types.js";

/**
 * Scan a string for all `${...}` tokens to classify them (Mongo walk pass 1).
 * Populates refs, rejections, and occurrences without producing a replaced string.
 * @param input - The string to scan.
 * @param existingRaw - De-dup map: raw token → ref index.
 * @param refs - Mutable refs accumulator.
 * @param rejections - Mutable rejections accumulator.
 * @param occurrences - Mutable occurrences accumulator.
 */
function scanStringForRefs(
  input: string,
  existingRaw: Map<string, number>,
  refs: Ref[],
  rejections: RefRejection[],
  occurrences: Array<{ refIndex: number }>,
): void {
  GENERIC_REF_RE.lastIndex = 0;
  for (const match of input.matchAll(GENERIC_REF_RE)) {
    const raw = match[0] ?? "";
    const inner = match[1] ?? "";
    classifyInner(inner, raw, existingRaw, refs, rejections);
    const refIndex = existingRaw.get(raw);
    if (refIndex !== undefined) {
      occurrences.push({ refIndex });
    }
  }
}

/**
 * Extract refs from a Mongo command/filter document (object or array input).
 *
 * Two-pass: first `walkStrings` classifies all `${...}` refs in value-leaves;
 * then `mapTree` rebuilds a deep-clone with sentinel substitution. Object KEYS
 * are NOT walked (identifier position — non-bindable by design, D3). The
 * `__proto__`-safe deep-clone is inherited from `src/env` `mapTree`.
 * @param query - The Mongo command document (plain object or array).
 * @param refs - Mutable refs accumulator (shared with the caller's SQL path).
 * @param rejections - Mutable rejections accumulator.
 * @param occurrences - Mutable occurrences accumulator.
 * @param existingRaw - De-dup map shared with the caller.
 * @returns ExtractResult: `ok` with the NeutralQuery, or aggregated rejections.
 */
export function extractRefsFromMongoDoc(
  query: Record<string, unknown> | unknown[],
  refs: Ref[],
  rejections: RefRejection[],
  occurrences: Array<{ refIndex: number }>,
  existingRaw: Map<string, number>,
): ExtractResult {
  // Pass 1: scan all string leaves to classify refs
  walkStrings(query, (str) => {
    scanStringForRefs(str, existingRaw, refs, rejections, occurrences);
  });

  if (rejections.length > 0) {
    return { ok: false, rejections };
  }

  // Pass 2: deep-clone with sentinel substitution
  const neutralDoc = mapTree(query, (str: string) => {
    return str.replace(GENERIC_REF_RE, (raw: string) => {
      const refIndex = existingRaw.get(raw);
      if (refIndex !== undefined) {
        return sentinel(refIndex);
      }
      return raw;
    });
  });

  const neutral: NeutralQuery = {
    neutralQuery: neutralDoc as Readonly<Record<string, unknown>>,
    refs,
    occurrences,
    source: { kind: "mongo-document" },
  };
  return { ok: true, neutral };
}
