/**
 * Per-TestCase request builders + verdict computers for the §9 runner.
 *
 * Each generated test-type (§3 catalog) has its own request shape and its
 * own verdict rule. This file groups all dispatch arms in one place so
 * the executor stays small and the per-kind logic is co-located.
 *
 * M-6 refactor (v1.0.2 PR #6): multi-response verdicts and the new CORS
 * verdict have been extracted to `./verdicts.ts` to keep this file under
 * the 500-line hard cap. All verdicts are re-exported from here for backward
 * compatibility — existing `endpoint-executor.ts` imports are unchanged.
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
import type { CorsPreflightParams } from "../../test-catalog/test-case-params.js";
import type { RequestRecord, ResponseRecord } from "../types.js";

import {
  applyPaginationProbe,
  omitAtPath,
  substituteAtPath,
  substituteWrongType,
} from "./body-mutators.js";
import { statusEqDispatch } from "./variant-enrichment.js";
import { type VerdictResult, corsPreflightVerdict } from "./verdicts.js";

// Re-export all verdicts for backward compatibility (endpoint-executor.ts imports).
export type { VerdictResult } from "./verdicts.js";
export {
  getIdempotencyVerdict,
  deleteIdempotencyVerdict,
  putIdempotencyVerdict,
  headGetParityVerdict,
  conditionalGet304Verdict,
  corsPreflightVerdict,
  isHeadBodyEmpty,
} from "./verdicts.js";

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
 * Applies CORS preflight headers to the base request for a `cors_preflight` case.
 *
 * Preflight headers WIN over any user-supplied values in the base headers (DD-13):
 *   `Origin` = `params.allow_origins[0]`.
 *   `Access-Control-Request-Method` = `params.allow_methods.join(",")`.
 *   `Access-Control-Request-Headers` = `params.allow_headers.join(",")` (omitted when empty).
 *
 * Returns a NEW object — never mutates the input `base`.
 * @param base - The base request from buildBaseRequest.
 * @param p - The CorsPreflightParams from the test case.
 * @returns A new RequestRecord with CORS probe headers overlaid.
 */
function applyCorsPreflightHeaders(
  base: RequestRecord,
  p: CorsPreflightParams,
): RequestRecord {
  const headers = { ...base.headers };
  // Generator guarantees allow_origins is non-empty when a case is emitted.
  headers["Origin"] = p.allow_origins[0] ?? "";
  headers["Access-Control-Request-Method"] = p.allow_methods.join(",");
  if (p.allow_headers.length > 0) {
    headers["Access-Control-Request-Headers"] = p.allow_headers.join(",");
  }
  return { ...base, headers };
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
    case "pagination_boundary":
      return { ...base, url: applyPaginationProbe(base.url, p) };
    case "cors_preflight":
      return applyCorsPreflightHeaders(base, p);
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

/** Kinds whose verdict is dispatched through `statusEqDispatch` (variant-enriched). */
const STATUS_EQ_KINDS = new Set<string>([
  "status_code_conformance",
  "no_auth_returns_401",
  "garbage_token_returns_401",
  "method_not_allowed",
  "malformed_json_returns_400",
  "required_field_omission_returns_400",
  "type_violation_returns_400",
  "boundary_battery",
  "pagination_boundary",
]);

/**
 * Computes the verdict for one attempt. Dispatches on `testCase.params.kind`
 * and folds in db-verify outcomes + assertion outcomes.
 * @param testCase - The TestCase being evaluated.
 * @param endpoint - The canonical endpoint (used for `response_variants` enrichment).
 * @param response - The captured response record.
 * @param assertionOk - True iff every assertion passed (assertion kind only).
 * @param dbVerifyOk - True iff every db_verify passed.
 * @param defaultSlaMs - The environment's default_sla_ms (for SLA cases).
 * @param schemaValidator - Shared SchemaValidator for schema-validation case.
 * @returns The verdict + optional reason.
 */
export function computeVerdict(
  testCase: TestCase,
  endpoint: CanonicalEndpoint,
  response: ResponseRecord,
  assertionOk: boolean,
  dbVerifyOk: boolean,
  defaultSlaMs: number,
  schemaValidator: SchemaValidator,
): VerdictResult {
  const p = testCase.params;
  if (STATUS_EQ_KINDS.has(p.kind)) {
    return statusEqDispatch(
      response.status,
      (p as { expected_status: number }).expected_status,
      response.body,
      endpoint.response_variants,
      schemaValidator,
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
 * Dispatch for kinds that don't reduce to a STATUS_EQ check.
 * Kept separate to keep `computeVerdict` under the cyclomatic complexity limit.
 * @param p - The TestCase.params discriminated union.
 * @param response - The captured response record.
 * @param assertionOk - True iff every assertion passed.
 * @param dbVerifyOk - True iff every db_verify passed.
 * @param defaultSlaMs - Env default SLA.
 * @param schemaValidator - Shared SchemaValidator.
 * @returns Verdict.
 */
export function computeNonStatusEqVerdict(
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
    case "head_get_parity":
      // head_get_parity: the single-response verdict is the FIRST-RESPONSE
      // GATE (HEAD must be 2xx). The real parity comparison happens in
      // `maybeRunSecondRequest` after the GET fires and calls
      // `headGetParityVerdict` directly. Reuses the same gate function as
      // the idempotency kinds (design decision: reuse over reinvention).
      return idempotencyFirstResponseGate(response);
    case "conditional_get_304":
      // conditional_get_304: the single-response verdict is the FIRST-RESPONSE
      // GATE (GET #1 must be 2xx). The real conditional-GET check happens in
      // `maybeRunSecondRequest` after the conditional GET fires and calls
      // `conditionalGet304Verdict` directly. Reuses the same gate function as
      // the idempotency kinds (design decision DD-1: runtime fail, not plan-time).
      return idempotencyFirstResponseGate(response);
    case "cors_preflight":
      // cors_preflight: single-request verdict computed by corsPreflightVerdict
      // directly (DD-11: no second request). The full CORS assertion runs here.
      return corsPreflightVerdict(response, p);
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
 * Pass iff status is in [200, 300).
 * @param response - The response record.
 * @returns Verdict.
 */
function is2xx(response: ResponseRecord): VerdictResult {
  if (isHttp2xx(response.status)) return { verdict: "pass" };
  return { verdict: "fail", reason: `expected 2xx, got ${response.status}` };
}

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

// ===== URL helpers ===========================================================

/** Detects URLs that are already absolute (have an http/https scheme). */
const ABSOLUTE_URL_RE = /^https?:\/\//i;

/**
 * Joins a base URL and a path; trims duplicate slashes between them.
 *
 * If `path` is already an absolute URL (after `${env.*}` substitution it
 * starts with `http://` or `https://`), it is returned unchanged so that
 * the env's `base_url` is NOT prepended on top of an already-complete URL.
 *
 * Exported so that `endpoint-executor.ts` can reuse the same implementation
 * for synthesizing the second request URL in `head_get_parity` cases (DRY).
 * @param base - Base URL (with or without trailing slash).
 * @param path - Path (relative) or absolute URL.
 * @returns The joined URL (or `path` unchanged when already absolute).
 */
export function joinUrl(base: string, path: string): string {
  if (ABSOLUTE_URL_RE.test(path)) {
    return path;
  }
  const b = base.endsWith("/") ? base.slice(0, -1) : base;
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${b}${p}`;
}

