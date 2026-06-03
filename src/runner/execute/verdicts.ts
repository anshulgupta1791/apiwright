/**
 * Verdict functions extracted from case-runners.ts (M-6 refactor).
 *
 * Contains all multi-response and non-trivial verdict computations that were
 * previously inlined in case-runners.ts, plus new helpers added in v1.0.2:
 *   - `csvSetMissing` — set-superset check over comma-separated value strings.
 *   - `corsPreflightVerdict` — full CORS preflight response assertion.
 *
 * Exported directly from this module AND re-exported from case-runners.ts
 * for backward compatibility (endpoint-executor.ts imports are unchanged).
 */

import type { CorsPreflightParams } from "../../test-catalog/test-case-params.js";
import type { ResponseRecord } from "../types.js";

import { IGNORED_PARITY_HEADERS } from "./parity-headers.js";

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

/**
 * A computed verdict + an optional failure reason for the AttemptResult.
 * Re-exported from case-runners.ts; declared here as the canonical source.
 */
export interface VerdictResult {
  /** Pass / fail decision. */
  readonly verdict: "pass" | "fail";
  /** Human-readable failure reason; absent when verdict==="pass". */
  readonly reason?: string;
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/** Lower bound (inclusive) of the HTTP 2xx success range. */
const HTTP_2XX_LO = 200;
/** Upper bound (exclusive) of the HTTP 2xx success range. */
const HTTP_2XX_HI = 300;

/**
 * Tests whether an HTTP status falls within [200, 300) — the 2xx success range.
 * @param status - HTTP status code.
 * @returns True iff `status` is a 2xx code.
 */
function isHttp2xx(status: number): boolean {
  return status >= HTTP_2XX_LO && status < HTTP_2XX_HI;
}

/**
 * Returns `true` when a response body is "empty" per RFC 7231 §4.3.2 (HEAD)
 * and RFC 7232 §4.1 (304 Not Modified): `null | undefined | ""`.
 * Numeric zero, empty objects, and empty arrays are NOT empty.
 * Used by `headGetParityVerdict` (PR #3) and `conditionalGet304Verdict` (PR #4).
 * @param body - The response body (unknown type).
 * @returns Whether the body counts as empty.
 */
export function isHeadBodyEmpty(body: unknown): boolean {
  return body === null || body === undefined || body === "";
}

/**
 * Deep-equality for two response bodies using canonical JSON ordering
 * (sorted keys) to avoid spurious "diverged" failures on key-order differences.
 * Primitives use `Object.is`; anything unserializable returns `false`.
 * @param a - First body.
 * @param b - Second body.
 * @returns True iff the two are deep-equal in JSON-value semantics.
 */
function deepEqualResponseBody(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (
    a === null ||
    b === null ||
    typeof a !== "object" ||
    typeof b !== "object"
  ) {
    return false;
  }
  return canonicalJson(a) === canonicalJson(b);
}

/**
 * Canonical JSON string with recursively sorted object keys.
 * Returns "" on serialization failure (deepEqualResponseBody fails safe).
 * @param v - Any JSON-serializable value.
 * @returns Canonical JSON string, or "" on failure.
 */
function canonicalJson(v: unknown): string {
  try {
    return JSON.stringify(v, (_k, val: unknown) => {
      if (val === null || typeof val !== "object" || Array.isArray(val))
        return val;
      const obj = val as Record<string, unknown>;
      return Object.keys(obj)
        .sort()
        .reduce<Record<string, unknown>>((acc, k) => {
          acc[k] = obj[k];
          return acc;
        }, {});
    });
  } catch {
    return "";
  }
}

/**
 * Compares headers of two responses ignoring `ignore` set members.
 * Keys are lowercased (defensive per DD-5). Returns `null` when headers agree,
 * or a short diff string for the first diverging key.
 * @param headHeaders - HEAD response headers.
 * @param getHeaders - GET response headers.
 * @param ignore - Lowercase header names to skip.
 * @returns `null` when headers agree, or a diff string for the first divergence.
 */
function compareHeadersIgnoring(
  headHeaders: Readonly<Record<string, string>>,
  getHeaders: Readonly<Record<string, string>>,
  ignore: ReadonlySet<string>,
): string | null {
  const headNorm = Object.fromEntries(
    Object.entries(headHeaders).map(([k, v]) => [k.toLowerCase(), v]),
  );
  const getNorm = Object.fromEntries(
    Object.entries(getHeaders).map(([k, v]) => [k.toLowerCase(), v]),
  );
  const allKeys = new Set([...Object.keys(headNorm), ...Object.keys(getNorm)]);
  for (const key of allKeys) {
    if (ignore.has(key)) continue;
    const headVal = headNorm[key];
    const getVal = getNorm[key];
    if (headVal === undefined) {
      return `${key}: missing on HEAD`;
    }
    if (getVal === undefined) {
      return `${key}: missing on GET`;
    }
    if (headVal !== getVal) {
      return `${key}: HEAD='${headVal}' GET='${getVal}'`;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Idempotency verdicts
// ---------------------------------------------------------------------------

/**
 * Verdict for `get_idempotency` after both GETs returned.
 *
 * Passes iff the two response bodies are deep-equal AND the second response
 * is also 2xx. Failure modes:
 *   - second response not 2xx → "get_idempotency: second response status N"
 *   - bodies differ           → "get_idempotency: body diverged between attempts"
 * @param first - The first response (body already captured).
 * @param second - The second response.
 * @returns Verdict.
 */
export function getIdempotencyVerdict(
  first: ResponseRecord,
  second: ResponseRecord,
): VerdictResult {
  if (!isHttp2xx(second.status)) {
    const reason =
      `get_idempotency: second response status ${second.status}` +
      ` (first was ${first.status})`;
    return { verdict: "fail", reason };
  }
  if (deepEqualResponseBody(first.body, second.body)) {
    return { verdict: "pass" };
  }
  return {
    verdict: "fail",
    reason: "get_idempotency: body diverged between attempts",
  };
}

/**
 * Verdict for `delete_idempotency` after both DELETEs returned.
 *
 * The SECOND DELETE must return `expected` exactly. Failure mode:
 *   - second status !== expected → "delete_idempotency: second DELETE returned N, expected M"
 * @param second - The second response (status is what matters).
 * @param expected - The expected status of the second DELETE.
 * @returns Verdict.
 */
export function deleteIdempotencyVerdict(
  second: ResponseRecord,
  expected: number,
): VerdictResult {
  if (second.status === expected) {
    return { verdict: "pass" };
  }
  return {
    verdict: "fail",
    reason: `delete_idempotency: second DELETE returned ${second.status}, expected ${expected}`,
  };
}

/**
 * Verdict for `put_idempotency` after both PUTs returned.
 *
 * compare === "body_equality":
 *   Passes iff the two response bodies are deep-equal AND the second
 *   response is 2xx.
 *
 * compare === "db_state":
 *   Passes iff the second response is 2xx AND `dbVerifyOkSecond` is true.
 * @param first - The first response.
 * @param second - The second response.
 * @param compare - "body_equality" or "db_state".
 * @param dbVerifyOkSecond - Result of the SECOND runDbVerifications call.
 * @returns Verdict + optional reason.
 */
export function putIdempotencyVerdict(
  first: ResponseRecord,
  second: ResponseRecord,
  compare: "body_equality" | "db_state",
  dbVerifyOkSecond: boolean,
): VerdictResult {
  if (!isHttp2xx(second.status)) {
    const reason =
      `put_idempotency: second response status ${second.status}` +
      ` (first was ${first.status})`;
    return { verdict: "fail", reason };
  }
  if (compare === "body_equality") {
    if (deepEqualResponseBody(first.body, second.body)) {
      return { verdict: "pass" };
    }
    return {
      verdict: "fail",
      reason: "put_idempotency: body diverged between attempts",
    };
  }
  // compare === "db_state"
  if (dbVerifyOkSecond) {
    return { verdict: "pass" };
  }
  return {
    verdict: "fail",
    reason: "put_idempotency: db state diverged after second PUT",
  };
}

// ---------------------------------------------------------------------------
// HEAD/GET parity verdict
// ---------------------------------------------------------------------------

/**
 * Verdict for `head_get_parity` after both HEAD and GET have returned.
 *
 * Three ordered checks (all must pass for a `pass` verdict):
 *   1. Status parity (RFC 7231 §4.3.2): `head.status === get.status`.
 *   2. HEAD body emptiness: body must be `null | undefined | ""`.
 *   3. Header parity modulo {@link IGNORED_PARITY_HEADERS}.
 * @param headResponse - The HEAD response.
 * @param getResponse - The GET response.
 * @returns A {@link VerdictResult} with verdict and optional reason.
 */
export function headGetParityVerdict(
  headResponse: ResponseRecord,
  getResponse: ResponseRecord,
): VerdictResult {
  if (headResponse.status !== getResponse.status) {
    return {
      verdict: "fail",
      reason:
        `head_get_parity: status differs (HEAD ${headResponse.status},` +
        ` GET ${getResponse.status})`,
    };
  }
  if (!isHeadBodyEmpty(headResponse.body)) {
    return {
      verdict: "fail",
      reason: "head_get_parity: HEAD body non-empty",
    };
  }
  const diff = compareHeadersIgnoring(
    headResponse.headers,
    getResponse.headers,
    IGNORED_PARITY_HEADERS,
  );
  if (diff !== null) {
    return {
      verdict: "fail",
      reason: `head_get_parity: header parity violated — ${diff}`,
    };
  }
  return { verdict: "pass" };
}

// ---------------------------------------------------------------------------
// Conditional GET verdict
// ---------------------------------------------------------------------------

/** Status code for 304 Not Modified (RFC 7232). */
const HTTP_304_NOT_MODIFIED = 304;

/**
 * Verdict for `conditional_get_304` after the second (conditional) GET
 * has returned.
 *
 * Three ordered checks (all must pass for a `pass` verdict):
 *   1. Status check (DD-3): second.status === 304.
 *   2. ETag echo check (DD-4): second.headers["etag"] must exist and equal first.
 *   3. Body emptiness check (DD-5): isHeadBodyEmpty(second.body).
 * @param firstResponse - The first GET response (carries captured ETag).
 * @param secondResponse - The conditional GET response (should be 304).
 * @returns Verdict + optional reason.
 */
export function conditionalGet304Verdict(
  firstResponse: ResponseRecord,
  secondResponse: ResponseRecord,
): VerdictResult {
  if (secondResponse.status !== HTTP_304_NOT_MODIFIED) {
    return {
      verdict: "fail",
      reason:
        `conditional_get_304: expected 304 Not Modified on second request,` +
        ` got ${secondResponse.status}`,
    };
  }
  const firstEtag = firstResponse.headers["etag"];
  const secondEtag = secondResponse.headers["etag"];
  if (typeof secondEtag !== "string" || secondEtag.length === 0) {
    return {
      verdict: "fail",
      reason: "conditional_get_304: 304 response missing ETag header",
    };
  }
  if (secondEtag !== firstEtag) {
    return {
      verdict: "fail",
      reason:
        `conditional_get_304: 304 ETag '${secondEtag}'` +
        ` does not match first response ETag '${firstEtag}'`,
    };
  }
  if (!isHeadBodyEmpty(secondResponse.body)) {
    return {
      verdict: "fail",
      reason: "conditional_get_304: 304 response body is not empty",
    };
  }
  return { verdict: "pass" };
}

// ---------------------------------------------------------------------------
// CORS preflight helpers
// ---------------------------------------------------------------------------

/**
 * Computes the set of entries from `expected` that are missing in `actual`
 * (the comma-separated response header value). Both sides are case-folded:
 * "UPPER" for methods (RFC 7231 §4.1); "LOWER" for headers (RFC 7230 §3.2).
 * Splits `actual` on commas, trims whitespace, filters empties, then case-folds.
 * Returns missing entries from `expected` in declaration order.
 * @param actual - The raw comma-separated value from the response header.
 * @param expected - The declared values that must be present.
 * @param caseFold - "UPPER" for methods; "LOWER" for headers.
 * @returns Array of entries from `expected` (original casing) that are absent in `actual`.
 */
function csvSetMissing(
  actual: string,
  expected: readonly string[],
  caseFold: "UPPER" | "LOWER",
): string[] {
  const fold = caseFold === "UPPER"
    ? (s: string) => s.toUpperCase()
    : (s: string) => s.toLowerCase();

  const actualSet = new Set(
    actual
      .split(",")
      .map((s) => fold(s.trim()))
      .filter((s) => s.length > 0),
  );

  const missing: string[] = [];
  for (const entry of expected) {
    if (!actualSet.has(fold(entry))) {
      missing.push(entry);
    }
  }
  return missing;
}

/** HTTP 200 OK status code. */
const HTTP_200_OK = 200;
/** HTTP 204 No Content status code. */
const HTTP_204_NO_CONTENT = 204;

/** Expected CORS preflight status codes (200 or 204 per DD-6). */
const CORS_ALLOWED_STATUSES = new Set([HTTP_200_OK, HTTP_204_NO_CONTENT]);

/**
 * Verdict for `cors_preflight` after the single OPTIONS response returns.
 *
 * Short-circuit ordered checks: status 200/204 (DD-6) → ACAO present (DD-3) →
 * ACAO value matches (DD-3) → ACAM present (DD-4) → ACAM superset (DD-4) →
 * when allow_headers non-empty: ACAH present (DD-5) → ACAH superset (DD-5).
 *
 * Wildcard rule (DD-3): `allow_origins === ["*"]` → accept `"*"` or sent origin.
 * Multi-list rule (DD-3): non-wildcard → response MUST echo `allow_origins[0]`.
 * @param response - The OPTIONS response record.
 * @param params - The `CorsPreflightParams` from the test case.
 * @returns VerdictResult with verdict and optional failure reason.
 */
export function corsPreflightVerdict(
  response: ResponseRecord,
  params: CorsPreflightParams,
): VerdictResult {
  // (1) Status check — must be 200 or 204.
  if (!CORS_ALLOWED_STATUSES.has(response.status)) {
    return {
      verdict: "fail",
      reason: `cors_preflight: expected status 200 or 204, got ${response.status}`,
    };
  }

  // (2) ACAO header presence.
  const acao = response.headers["access-control-allow-origin"];
  if (typeof acao !== "string") {
    return {
      verdict: "fail",
      reason: "cors_preflight: response missing Access-Control-Allow-Origin header",
    };
  }

  // (3) ACAO value match.
  // Sent origin = allow_origins[0] (generator guarantees non-empty).
  const sentOrigin = params.allow_origins[0] ?? "";
  // Wildcard rule (DD-3): ["*"] → acceptable = {"*"}.
  // Multi-list rule (DD-3): others → MUST echo sentOrigin exactly.
  const isWildcardConfig =
    params.allow_origins.length === 1 && params.allow_origins[0] === "*";
  const expectedOrigin = sentOrigin;
  const originAccepted = isWildcardConfig
    ? acao === "*" || acao === sentOrigin
    : acao === expectedOrigin;
  if (!originAccepted) {
    return {
      verdict: "fail",
      reason:
        `cors_preflight: Access-Control-Allow-Origin '${acao}'` +
        ` doesn't match expected '${expectedOrigin}'`,
    };
  }

  // (4) ACAM header presence.
  const acam = response.headers["access-control-allow-methods"];
  if (typeof acam !== "string") {
    return {
      verdict: "fail",
      reason: "cors_preflight: response missing Access-Control-Allow-Methods header",
    };
  }

  // (5) ACAM set superset check (case-fold to UPPER per RFC 7231 §4.1).
  const missingMethods = csvSetMissing(acam, params.allow_methods, "UPPER");
  if (missingMethods.length > 0) {
    return {
      verdict: "fail",
      reason:
        `cors_preflight: Access-Control-Allow-Methods missing required:` +
        ` ${missingMethods.join(",")}`,
    };
  }

  // Skip ACAH checks when allow_headers is empty (DD-5).
  if (params.allow_headers.length === 0) {
    return { verdict: "pass" };
  }

  // (6) ACAH header presence (only when allow_headers non-empty).
  const acah = response.headers["access-control-allow-headers"];
  if (typeof acah !== "string") {
    return {
      verdict: "fail",
      reason: "cors_preflight: response missing Access-Control-Allow-Headers header",
    };
  }

  // (7) ACAH set superset check (case-fold to LOWER per RFC 7230 §3.2).
  const missingHeaders = csvSetMissing(acah, params.allow_headers, "LOWER");
  if (missingHeaders.length > 0) {
    return {
      verdict: "fail",
      reason:
        `cors_preflight: Access-Control-Allow-Headers missing required:` +
        ` ${missingHeaders.join(",")}`,
    };
  }

  return { verdict: "pass" };
}
