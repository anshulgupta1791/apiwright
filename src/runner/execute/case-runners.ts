/**
 * Per-TestCase request builders + verdict computers for the §9 runner.
 *
 * Each generated test-type (§3 catalog) has its own request shape and its
 * own verdict rule. This file groups all 16 dispatch arms in one place so
 * the executor stays small and the per-kind logic is co-located.
 *
 * Discharges obligation #2 (runner assertion execution — kind="assertion")
 * indirectly: the executor passes the assertion string back through the
 * §4 evaluator before calling the verdict computer.
 */

import type { CanonicalEndpoint } from "../../core/canonical-model.js";
import { SchemaValidator } from "../../core/schema-validator.js";
import { resolveTemplates } from "../../env/template-resolver.js";
import type { ResolvedEnvironment } from "../../env/types.js";
import type { TestCase } from "../../test-catalog/index.js";
import type { RequestRecord, ResponseRecord, Verdict } from "../types.js";

/** Header injected for malformed-body cases to declare the content type. */
const APPLICATION_JSON = "application/json";

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

/** A computed verdict + an optional failure reason for the AttemptResult. */
export interface VerdictResult {
  /** Pass / fail decision. */
  readonly verdict: Verdict;
  /** Human-readable failure reason; absent when verdict==="pass". */
  readonly reason?: string;
}

/**
 * Builds the canonical base PreparedRequest from an endpoint (no auth yet).
 * The auth strategy adds headers in a later step.
 * Resolves `${env.X}` template references across the endpoint URL, request
 * headers, and `body_example` before assembling the {@link RequestRecord},
 * so the outgoing request never contains literal `${env.*}` tokens. This
 * closes the bug surfaced by the Library Postman walkthrough: prior code
 * copied `endpoint.url`/headers/body verbatim, leaving `${env.*}` tokens in
 * the actual HTTP request and silently corrupting any templated endpoint.
 * After substitution, {@link joinUrl} composes the final URL — but only
 * prepends `env.base_url` when the resolved URL is RELATIVE. If the resolved
 * URL is already absolute (starts with `http://` or `https://`, typically
 * because the user wrote `${env.base_url}/path` and substitution produced an
 * absolute URL), the prepend is skipped so we don't double the host.
 * @param endpoint - The canonical endpoint definition.
 * @param env - The resolved environment used as the `${env.*}` lookup table
 *   and the source of `base_url` for relative-path composition.
 * @returns The base {@link RequestRecord} ready for kind-specific mutation.
 * @throws {Error} `internal: env template resolution failed ...` if a
 *   `${env.*}` ref in the endpoint's URL/headers/body_example cannot be
 *   resolved. Validate (PR #72) catches this at load time, so the throw is
 *   defensive — it indicates a gap between validate and run.
 */
export function buildBaseRequest(
  endpoint: CanonicalEndpoint,
  env: ResolvedEnvironment,
): RequestRecord {
  const tree: Record<string, unknown> = {
    url: endpoint.url,
    headers: endpoint.request.headers ?? {},
    body: endpoint.request.body_example,
  };
  const r = resolveTemplates(tree, env);
  /* istanbul ignore if — validate (PR #72) rejects unresolved ${env.*} refs
     in endpoint files before run; this branch is defensive only. */
  if (!r.ok || r.data === undefined) {
    throw new Error(
      `internal: env template resolution failed at request-build time: ${
        r.error ?? "unknown"
      }. This indicates a gap between validate and run — please file an issue.`,
    );
  }
  const urlField = r.data["url"];
  const resolvedUrl = typeof urlField === "string" ? urlField : "";
  const resolvedHeaders =
    (r.data["headers"] as Record<string, string> | undefined) ?? {};
  const resolvedBody = r.data["body"];

  const url = joinUrl(env.base_url, resolvedUrl);
  return {
    method: endpoint.method,
    url,
    headers: { ...resolvedHeaders },
    body: resolvedBody,
  };
}

/**
 * Applies kind-specific mutations to a base request. Returns a new
 * RequestRecord; never mutates the input.
 * @param base - The base request from {@link buildBaseRequest}.
 * @param testCase - The TestCase whose `params.kind` drives the mutation.
 * @returns The mutated request ready for the auth + send steps.
 */
export function mutateRequest(
  base: RequestRecord,
  testCase: TestCase,
): RequestRecord {
  const p = testCase.params;
  switch (p.kind) {
    case "method_not_allowed":
      return { ...base, method: p.substitute_method };
    case "malformed_json_returns_400":
      return {
        ...base,
        headers: { ...base.headers, "Content-Type": APPLICATION_JSON },
        body: p.malformed_body,
      };
    case "required_field_omission_returns_400":
      return { ...base, body: omitAtPath(base.body, p.omitted_field) };
    case "type_violation_returns_400":
      return {
        ...base,
        body: substituteWrongType(base.body, p.field, p.wrong_type),
      };
    case "boundary_battery":
      return { ...base, body: substituteAtPath(base.body, p.field, p.value) };
    default:
      return base;
  }
}

/**
 * Returns the auth-application mode the executor should use for this case.
 *
 * The runner's executor reads this discriminant and chooses one of:
 *   "apply"   — apply the named strategy normally.
 *   "skip"    — no auth (no_auth_returns_401 marker).
 *   "garbage" — wrap with `garbage_token_returns_401` marker.
 *   "none"    — endpoint has no auth_strategy and case does not require one.
 * @param testCase - The current TestCase.
 * @param endpoint - The endpoint definition.
 * @returns The auth mode for this case.
 */
export function authModeFor(
  testCase: TestCase,
  endpoint: CanonicalEndpoint,
): "apply" | "skip" | "garbage" | "none" {
  const p = testCase.params;
  if (p.kind === "no_auth_returns_401") return "skip";
  if (p.kind === "garbage_token_returns_401") return "garbage";
  if (!endpoint.auth_strategy) return "none";
  return "apply";
}

/** Kinds whose verdict is `statusEq(response.status, p.expected_status)`. */
const STATUS_EQ_KINDS = new Set<string>([
  "status_code_conformance",
  "no_auth_returns_401",
  "garbage_token_returns_401",
  "method_not_allowed",
  "malformed_json_returns_400",
  "required_field_omission_returns_400",
  "type_violation_returns_400",
  "boundary_battery",
]);

/**
 * Computes the verdict for one attempt. Dispatches on `testCase.params.kind`
 * and folds in db-verify outcomes + assertion outcomes.
 * @param testCase - The TestCase being evaluated.
 * @param _endpoint - Reserved for future per-endpoint context (e.g. retry).
 * @param response - The captured response record.
 * @param assertionOk - True iff every assertion passed (assertion kind only).
 * @param dbVerifyOk - True iff every db_verify passed.
 * @param defaultSlaMs - The environment's default_sla_ms (for SLA cases).
 * @param schemaValidator - Shared SchemaValidator for schema-validation case.
 * @returns The verdict + optional reason.
 */
export function computeVerdict(
  testCase: TestCase,
  _endpoint: CanonicalEndpoint,
  response: ResponseRecord,
  assertionOk: boolean,
  dbVerifyOk: boolean,
  defaultSlaMs: number,
  schemaValidator: SchemaValidator,
): VerdictResult {
  const p = testCase.params;
  if (STATUS_EQ_KINDS.has(p.kind)) {
    return statusEq(
      response.status,
      (p as { expected_status: number }).expected_status,
    );
  }
  return computeNonStatusEqVerdict(
    p,
    response,
    assertionOk,
    dbVerifyOk,
    defaultSlaMs,
    schemaValidator,
  );
}

/**
 * Dispatch for kinds that don't reduce to a simple `statusEq` check.
 * Kept separate to keep `computeVerdict` under the cyclomatic complexity limit.
 * @param p - The TestCase.params discriminated union.
 * @param response - The captured response record.
 * @param assertionOk - True iff every assertion passed.
 * @param dbVerifyOk - True iff every db_verify passed.
 * @param defaultSlaMs - Env default SLA.
 * @param schemaValidator - Shared SchemaValidator.
 * @returns Verdict.
 */
function computeNonStatusEqVerdict(
  p: TestCase["params"],
  response: ResponseRecord,
  assertionOk: boolean,
  dbVerifyOk: boolean,
  defaultSlaMs: number,
  schemaValidator: SchemaValidator,
): VerdictResult {
  switch (p.kind) {
    case "content_type_alignment":
      return contentTypeOk(response);
    case "response_time_sla":
      return slaOk(response, p, defaultSlaMs);
    case "response_schema_validation":
      return schemaOk(response, p.schema, schemaValidator);
    case "auth_happy_path":
      return is2xx(response);
    case "get_idempotency":
    case "delete_idempotency":
    case "put_idempotency":
      // Issue #50 / put_idempotency: the single-response verdict is only the
      // FIRST-RESPONSE GATE (must be 2xx). The real two-response comparison
      // happens in `runOneAttempt` after the second request fires and calls
      // `getIdempotencyVerdict` / `deleteIdempotencyVerdict` /
      // `putIdempotencyVerdict` directly.
      return idempotencyFirstResponseGate(response);
    case "db_state_matches_expectation":
      return passFailWithReason(
        dbVerifyOk,
        "db_verify did not satisfy expect mode",
      );
    case "assertion":
      return passFailWithReason(assertionOk, "declarative assertion failed");
    /* istanbul ignore next — exhaustiveness fallback; STATUS_EQ_KINDS handles
       every remaining arm of TestCaseParams. */
    default:
      return { verdict: "fail", reason: `unknown kind` };
  }
}

/**
 * Returns a pass verdict when `ok` is true, else fail with `reason`.
 * @param ok - Whether the underlying check passed.
 * @param reason - Failure reason embedded when ok is false.
 * @returns Verdict.
 */
function passFailWithReason(ok: boolean, reason: string): VerdictResult {
  if (ok) return { verdict: "pass" };
  return { verdict: "fail", reason };
}

// ===== Verdict helpers =====================================================

/**
 * Pass iff `actual` strictly equals `expected`.
 * @param actual - Observed status.
 * @param expected - Required status.
 * @returns Verdict + reason on mismatch.
 */
function statusEq(actual: number, expected: number): VerdictResult {
  return actual === expected
    ? { verdict: "pass" }
    : { verdict: "fail", reason: `expected status ${expected}, got ${actual}` };
}

/**
 * Pass iff status is in [200, 300).
 * @param response - The response record.
 * @returns Verdict.
 */
function is2xx(response: ResponseRecord): VerdictResult {
  if (isHttp2xx(response.status)) return { verdict: "pass" };
  return { verdict: "fail", reason: `expected 2xx, got ${response.status}` };
}

/** Discriminated union for the two idempotency case kinds. */
/**
 * Pre-second-request verdict for an idempotency case (issue #50): the FIRST
 * response must be 2xx before the runner is willing to issue the SECOND
 * request. If the first request doesn't even succeed, there's no meaningful
 * idempotency comparison to do.
 * @param response - The first response record.
 * @returns Verdict — pass means "go issue the second request".
 */
function idempotencyFirstResponseGate(response: ResponseRecord): VerdictResult {
  return is2xx(response);
}

/**
 * Verdict for `get_idempotency` after both GETs returned.
 *
 * Passes iff the two response bodies are deep-equal AND the second response
 * is also 2xx. Failure modes:
 *   - second response not 2xx → "get_idempotency: second response status N"
 *   - bodies differ           → "get_idempotency: body diverged between attempts"
 * Body comparison uses canonical JSON-stringification (no key-order
 * sensitivity for objects; preserves array order; null-safe). Strings,
 * numbers, booleans, null, arrays, objects all handled.
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
 * The first DELETE must have returned 2xx (the resource was deleted). The
 * SECOND DELETE must return `params.second_delete_status` exactly (default
 * 404 per IdempotencyGenerator decomposition assumption #2). Failure modes:
 *   - first response not 2xx              → handled by `idempotencyFirstResponseGate`
 *   - second response is 2xx with wrong status (still "removed" something)
 *     → "delete_idempotency: second DELETE returned N, expected M"
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
 *   response is 2xx. Mirrors get_idempotency verdict logic verbatim.
 *
 * compare === "db_state":
 *   Passes iff the second response is 2xx AND `dbVerifyOkSecond` is true.
 *   The body comparison is intentionally skipped — the resource state (DB) is
 *   the contract; the response body may legitimately differ (e.g. timestamps).
 *
 * Failure modes:
 *   - second status not 2xx → "put_idempotency: second response status N (first was M)"
 *   - body_equality + bodies differ → "put_idempotency: body diverged between attempts"
 *   - db_state + dbVerifyOkSecond=false → "put_idempotency: db state diverged after
 *     second PUT"
 * @param first - The first response.
 * @param second - The second response.
 * @param compare - "body_equality" or "db_state".
 * @param dbVerifyOkSecond - Result of the SECOND runDbVerifications call;
 *   IGNORED when compare === "body_equality" (caller may pass `true`).
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

/**
 * Deep-equality for two response bodies. Uses canonical JSON ordering so
 * object key-order does not cause spurious "diverged" failures.
 *
 * - Primitives (string / number / boolean / null) compared with `Object.is`.
 * - Arrays compared element-wise (length + order matters).
 * - Objects compared by sorted-key canonical JSON.
 * - Anything unserializable returns `false` (fail-safe).
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
 * Canonical JSON string with sorted object keys (recursive). Used by
 * `deepEqualResponseBody` to compare object bodies without key-order
 * sensitivity. Returns the empty string on any serialization failure
 * (causing `deepEqualResponseBody` to fail-safe to inequality).
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
 * Pass iff Content-Type header present and non-empty.
 * @param response - The response record.
 * @returns Verdict.
 */
function contentTypeOk(response: ResponseRecord): VerdictResult {
  const ct = response.headers["content-type"];
  return ct && ct.length > 0
    ? { verdict: "pass" }
    : { verdict: "fail", reason: "missing Content-Type header" };
}

/** SLA params shape passed to {@link slaOk}. */
interface SlaParams {
  /** Optional declared SLA in ms. */
  readonly sla_ms?: number;
  /** True when the runner should delegate to env default_sla_ms. */
  readonly sla_delegated: boolean;
}

/**
 * Pass iff response.time_ms <= sla_ms (resolved from params + env default).
 * @param response - The response record.
 * @param params - The SLA params (declared SLA or delegated to env).
 * @param defaultSlaMs - Env-level default_sla_ms.
 * @returns Verdict.
 */
function slaOk(
  response: ResponseRecord,
  params: SlaParams,
  defaultSlaMs: number,
): VerdictResult {
  /* istanbul ignore next — Infinity fallback: catalog generator always emits
     sla_ms OR sla_delegated=true; both arms tested above. */
  const effective =
    params.sla_ms ?? (params.sla_delegated ? defaultSlaMs : Infinity);
  return response.time_ms <= effective
    ? { verdict: "pass" }
    : {
        verdict: "fail",
        reason: `SLA ${effective}ms exceeded (got ${response.time_ms}ms)`,
      };
}

/**
 * Pass iff body validates against the declared response schema.
 * @param response - The response record.
 * @param schema - The expected JSON schema.
 * @param validator - Shared SchemaValidator (provides one-shot validate).
 * @returns Verdict.
 */
function schemaOk(
  response: ResponseRecord,
  schema: Record<string, unknown>,
  validator: SchemaValidator,
): VerdictResult {
  const ok = validator.validateRequestBody(schema, response.body);
  if (ok) return { verdict: "pass" };
  return { verdict: "fail", reason: "response body did not match schema" };
}

// ===== Body mutators =======================================================

/** Detects URLs that are already absolute (have an http/https scheme). */
const ABSOLUTE_URL_RE = /^https?:\/\//i;

/**
 * Joins a base URL and a path; trims duplicate slashes between them.
 *
 * If `path` is already an absolute URL (after `${env.*}` substitution it
 * starts with `http://` or `https://`), it is returned unchanged so that
 * the env's `base_url` is NOT prepended on top of an already-complete URL.
 * @param base - Base URL (with or without trailing slash).
 * @param path - Path (relative) or absolute URL.
 * @returns The joined URL (or `path` unchanged when already absolute).
 */
function joinUrl(base: string, path: string): string {
  if (ABSOLUTE_URL_RE.test(path)) {
    return path;
  }
  const b = base.endsWith("/") ? base.slice(0, -1) : base;
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${b}${p}`;
}

/**
 * Returns a new object with the property at `path` removed. Supports
 * dot-notation (e.g., "user.name"). Returns input as-is if path is empty
 * or the object structure does not contain it.
 * @param body - The base body object.
 * @param path - Dot-notation path.
 * @returns A new object with the field omitted.
 */
function omitAtPath(body: unknown, path: string): unknown {
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
 * @param wrongType - JSON type name (string/number/boolean/object/array).
 * @returns A new body with the field substituted.
 */
function substituteWrongType(
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
function substituteAtPath(
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
