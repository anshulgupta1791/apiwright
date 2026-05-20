/**
 * EXTRACTION (load-time, NO context). Pure, deterministic, total, NEVER throws.
 * Scans a SQL/Cypher string or Mongo document, extracts every `${...}` ref,
 * and returns a NeutralQuery with sentinel substitution. NO value is ever
 * spliced — structurally impossible (no context). Identical input ⇒ deep-equal output.
 */

import { extractRefsFromMongoDoc } from "./ref-extractor-mongo.js";
import type { ExtractResult, NeutralQuery, Ref, RefRejection } from "./types.js";

/**
 * Prefix string for the engine-neutral ordered placeholder sentinel.
 * Form: ` APIWRIGHT_PARAM_<refIndex> ` (space-delimited, index-bearing).
 * Never a value; identifies placeholder sites for the engine-binder.
 * Exported so `db-engine-param-binder` shares the one definition.
 */
export const NEUTRAL_PLACEHOLDER_PREFIX = " APIWRIGHT_PARAM_";

/**
 * Captures the inner text of every `${...}` token. Global, non-greedy-free.
 * Exported for sibling module (`ref-extractor-mongo.ts`).
 */
export const GENERIC_REF_RE = /\$\{([^}]*)\}/g;

/** Classifies `env.<path>` inner text. */
const ENV_PATH_RE = /^env\.([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*)$/;

/** Classifies `request.body.<path>` inner text. */
const REQUEST_BODY_RE = /^request\.body\.([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*)$/;

/** Classifies `response.body.<path>` inner text. */
const RESPONSE_BODY_RE = /^response\.body\.([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*)$/;

/**
 * Builds the sentinel string for a given ref index. Exported for the sibling module.
 * @param refIndex - The 0-based index of the ref.
 * @returns Sentinel string for this ref index.
 */
export function sentinel(refIndex: number): string {
  return `${NEUTRAL_PLACEHOLDER_PREFIX}${refIndex} `;
}

/**
 * Attempt to classify a single token as env namespace.
 * @param inner - Raw inner text of the token.
 * @param raw - Full `${...}` token.
 * @param refs - Mutable refs accumulator.
 * @param existingRaw - De-dup map from raw token to ref index.
 * @param rejections - Mutable rejections accumulator.
 * @returns The assigned ref index, or null if not env namespace.
 */
function tryEnvClassify(
  inner: string,
  raw: string,
  refs: Ref[],
  existingRaw: Map<string, number>,
  rejections: RefRejection[],
): number | null | "not-this-ns" {
  const envMatch = ENV_PATH_RE.exec(inner);
  if (envMatch === null) return "not-this-ns";
  const path = envMatch[1] ?? "";
  if (path.length === 0) {
    rejections.push({
      code: "MALFORMED_REF",
      ref: raw,
      path: inner,
      message: `Malformed template ref ${raw}: empty path after env namespace`,
    });
    return null;
  }
  const index = refs.length;
  refs.push({ index, namespace: "env", path, raw });
  existingRaw.set(raw, index);
  return index;
}

/**
 * Attempt to classify a single token as request.body namespace.
 * @param inner - Raw inner text of the token.
 * @param raw - Full `${...}` token.
 * @param refs - Mutable refs accumulator.
 * @param existingRaw - De-dup map from raw token to ref index.
 * @param rejections - Mutable rejections accumulator.
 * @returns The assigned ref index, or null if malformed, or "not-this-ns".
 */
function tryRequestBodyClassify(
  inner: string,
  raw: string,
  refs: Ref[],
  existingRaw: Map<string, number>,
  rejections: RefRejection[],
): number | null | "not-this-ns" {
  const reqMatch = REQUEST_BODY_RE.exec(inner);
  if (reqMatch === null) return "not-this-ns";
  /* istanbul ignore next — REQUEST_BODY_RE capture group 1 is `[A-Za-z0-9_]+`
     (requires ≥1 char); path is provably non-empty when the regex matches, making
     `?? ""` and the `path.length === 0` branch unreachable. */
  const path = reqMatch[1] ?? "";
  if (path.length === 0) {
    rejections.push({
      code: "MALFORMED_REF",
      ref: raw,
      path: inner,
      message: `Malformed template ref ${raw}: empty path after request.body namespace`,
    });
    return null;
  }
  const index = refs.length;
  refs.push({ index, namespace: "request.body", path, raw });
  existingRaw.set(raw, index);
  return index;
}

/**
 * Attempt to classify a single token as response.body namespace.
 * @param inner - Raw inner text of the token.
 * @param raw - Full `${...}` token.
 * @param refs - Mutable refs accumulator.
 * @param existingRaw - De-dup map from raw token to ref index.
 * @param rejections - Mutable rejections accumulator.
 * @returns The assigned ref index, or null if malformed, or "not-this-ns".
 */
function tryResponseBodyClassify(
  inner: string,
  raw: string,
  refs: Ref[],
  existingRaw: Map<string, number>,
  rejections: RefRejection[],
): number | null | "not-this-ns" {
  const respMatch = RESPONSE_BODY_RE.exec(inner);
  if (respMatch === null) return "not-this-ns";
  /* istanbul ignore next — RESPONSE_BODY_RE capture group 1 is `[A-Za-z0-9_]+`
     (requires ≥1 char); path is provably non-empty when the regex matches, making
     `?? ""` and the `path.length === 0` branch unreachable. */
  const path = respMatch[1] ?? "";
  if (path.length === 0) {
    rejections.push({
      code: "MALFORMED_REF",
      ref: raw,
      path: inner,
      message: `Malformed template ref ${raw}: empty path after response.body namespace`,
    });
    return null;
  }
  const index = refs.length;
  refs.push({ index, namespace: "response.body", path, raw });
  existingRaw.set(raw, index);
  return index;
}

/** Known namespace-only or empty-path malformed patterns. */
const MALFORMED_NS_RE =
  /^(env|request\.body|response\.body)(\.)?$/;

/**
 * Classify a single inner text into a Ref or a RefRejection. Exported for sibling module.
 * Returns the existing ref index when the raw token was already seen (de-dup).
 * @param inner - The inner text of the `${...}` token.
 * @param raw - The full `${...}` token string.
 * @param existingRaw - De-dup map: raw token → ref index.
 * @param refs - Mutable array of classified Refs.
 * @param rejections - Mutable array of RefRejections.
 * @returns The ref index (existing or new), or null on rejection.
 */
export function classifyInner(
  inner: string,
  raw: string,
  existingRaw: Map<string, number>,
  refs: Ref[],
  rejections: RefRejection[],
): number | null {
  // De-dup check
  const existing = existingRaw.get(raw);
  if (existing !== undefined) return existing;

  const trimmed = inner.trim();

  // MALFORMED: empty or whitespace-only
  if (trimmed.length === 0) {
    rejections.push({
      code: "MALFORMED_REF",
      ref: raw,
      path: inner,
      message: `Malformed template ref ${raw}: empty or whitespace-only inner text`,
    });
    return null;
  }

  // Try each namespace in order
  const envResult = tryEnvClassify(inner, raw, refs, existingRaw, rejections);
  if (envResult !== "not-this-ns") return envResult;

  const reqResult = tryRequestBodyClassify(inner, raw, refs, existingRaw, rejections);
  if (reqResult !== "not-this-ns") return reqResult;

  const respResult = tryResponseBodyClassify(inner, raw, refs, existingRaw, rejections);
  if (respResult !== "not-this-ns") return respResult;

  // Check for malformed known-prefix (namespace without valid path)
  if (MALFORMED_NS_RE.test(inner)) {
    rejections.push({
      code: "MALFORMED_REF",
      ref: raw,
      path: inner,
      message: `Malformed template ref ${raw}: namespace without a dotted path`,
    });
    return null;
  }

  // UNKNOWN_NAMESPACE: everything else (secret.*, db.*, token, foo.bar, etc.)
  rejections.push({
    code: "UNKNOWN_NAMESPACE",
    ref: raw,
    path: inner,
    message:
      `Unknown namespace in template ref ${raw}: only env.*, request.body.*, ` +
      `and response.body.* are supported in DB queries`,
  });
  return null;
}

/**
 * SQL/Cypher path: process all `${...}` tokens in a string.
 * Builds the sentinel-substituted output, updating refs/rejections/occurrences.
 * @param input - The string to process.
 * @param existingRaw - De-dup map.
 * @param refs - Mutable refs accumulator.
 * @param rejections - Mutable rejections accumulator.
 * @param occurrences - Mutable occurrences accumulator.
 * @returns The sentinel-substituted string.
 */
function processString(
  input: string,
  existingRaw: Map<string, number>,
  refs: Ref[],
  rejections: RefRejection[],
  occurrences: Array<{ refIndex: number }>,
): string {
  return input.replace(GENERIC_REF_RE, (raw: string, inner: string) => {
    const refIndex = classifyInner(inner, raw, existingRaw, refs, rejections);
    if (refIndex !== null) {
      occurrences.push({ refIndex });
      return sentinel(refIndex);
    }
    return raw;
  });
}

/**
 * EXTRACTION (load-time, NO context). Pure, deterministic, total, NEVER throws.
 * Scans a SQL/Cypher string or Mongo document, extracts and classifies every
 * `${...}` ref, returns a NeutralQuery with sentinel substitution. NO value is
 * ever spliced (structurally impossible — no context here). Identical input ⇒
 * deep-equal output.
 * @param query - The raw SQL/Cypher string OR Mongo command document/array.
 * @returns ExtractResult: `ok` with NeutralQuery, or aggregated rejections.
 */
export function extractRefs(
  query: string | Record<string, unknown> | unknown[],
): ExtractResult {
  // Defensive: reject null/number/boolean (total function)
  if (
    query === null ||
    (typeof query !== "string" && typeof query !== "object")
  ) {
    return {
      ok: false,
      rejections: [
        {
          code: "MALFORMED_REF",
          ref: String(query),
          path: String(query),
          message: `Query must be a string, object, or array; got ${typeof query}`,
        },
      ],
    };
  }

  const refs: Ref[] = [];
  const rejections: RefRejection[] = [];
  const occurrences: Array<{ refIndex: number }> = [];
  const existingRaw = new Map<string, number>();

  if (typeof query === "string") {
    // SQL/Cypher path
    const neutralStr = processString(
      query,
      existingRaw,
      refs,
      rejections,
      occurrences,
    );
    if (rejections.length > 0) {
      return { ok: false, rejections };
    }
    const neutral: NeutralQuery = {
      neutralQuery: neutralStr,
      refs,
      occurrences,
      source: query,
    };
    return { ok: true, neutral };
  }

  // Mongo document path: delegate to sibling module
  return extractRefsFromMongoDoc(query, refs, rejections, occurrences, existingRaw);
}
