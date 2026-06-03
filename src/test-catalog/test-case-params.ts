/**
 * Discriminated, JSON-serializable `TestCaseParams` payloads — one variant per
 * generated test concern. Split out of `types.ts` to keep each type file
 * within the 300-line soft limit; re-exported from `types.ts` so existing
 * `../types.js` imports are unaffected.
 *
 * Pure type declarations — no runtime logic.
 */

import type {
  CanonicalDbVerification,
  HttpMethod,
  JsonSchema,
} from "../core/canonical-model.js";

/** Discriminated, JSON-serializable params payload — one variant per concern. */
export type TestCaseParams =
  | StatusCodeParams
  | ContentTypeParams
  | ResponseTimeParams
  | ResponseSchemaParams
  | AuthHappyPathParams
  | AuthStripParams
  | GarbageTokenParams
  | MethodNotAllowedParams
  | MalformedJsonParams
  | RequiredFieldOmissionParams
  | TypeViolationParams
  | BoundaryParams
  | GetIdempotencyParams
  | DeleteIdempotencyParams
  | PutIdempotencyParams
  | HeadGetParityParams
  | DbStateParams
  | AssertionParams;

/** params.kind = "status_code_conformance". */
export interface StatusCodeParams {
  /** Discriminant. */
  kind: "status_code_conformance";
  /** Expected HTTP status code from the endpoint declaration. */
  expected_status: number;
}

/** params.kind = "content_type_alignment". */
export interface ContentTypeParams {
  /** Discriminant. */
  kind: "content_type_alignment";
}

/** params.kind = "response_time_sla". */
export interface ResponseTimeParams {
  /** Discriminant. */
  kind: "response_time_sla";
  /** Declared SLA; omitted entirely when delegated to the env default. */
  sla_ms?: number;
  /** True means runner resolves env default_sla_ms (generator never reads env). */
  sla_delegated: boolean;
}

/** params.kind = "response_schema_validation". */
export interface ResponseSchemaParams {
  /** Discriminant. */
  kind: "response_schema_validation";
  /** JSON Schema to validate the response body against. */
  schema: JsonSchema;
}

/** params.kind = "auth_happy_path". */
export interface AuthHappyPathParams {
  /** Discriminant. */
  kind: "auth_happy_path";
  /** Auth strategy name, or null when the endpoint is unauthenticated. */
  auth_strategy: string | null;
  /** True means no auth applied (endpoint declared no auth_strategy). */
  unauthenticated: boolean;
}

/** params.kind = "no_auth_returns_401". */
export interface AuthStripParams {
  /** Discriminant. */
  kind: "no_auth_returns_401";
  /** Auth strategy name from the endpoint declaration. */
  auth_strategy: string;
  /** Always 401. */
  expected_status: number;
}

/** params.kind = "garbage_token_returns_401". */
export interface GarbageTokenParams {
  /** Discriminant. */
  kind: "garbage_token_returns_401";
  /** Auth strategy name from the endpoint declaration. */
  auth_strategy: string;
  /** Deterministic malformed token literal the runner substitutes. */
  garbage_token: string;
  /** Always 401. */
  expected_status: number;
}

/** params.kind = "method_not_allowed". */
export interface MethodNotAllowedParams {
  /** Discriminant. */
  kind: "method_not_allowed";
  /** Substitute method, deterministically chosen, never the declared method. */
  substitute_method: HttpMethod;
  /** Always 405. */
  expected_status: number;
}

/** params.kind = "malformed_json_returns_400". */
export interface MalformedJsonParams {
  /** Discriminant. */
  kind: "malformed_json_returns_400";
  /** Deterministic invalid-JSON literal the runner sends as the body. */
  malformed_body: string;
  /** Always 400. */
  expected_status: number;
}

/** params.kind = "required_field_omission_returns_400". */
export interface RequiredFieldOmissionParams {
  /** Discriminant. */
  kind: "required_field_omission_returns_400";
  /** Dot-notation path of the single field omitted for this case. */
  omitted_field: string;
  /** Always 400. */
  expected_status: number;
}

/** params.kind = "type_violation_returns_400". */
export interface TypeViolationParams {
  /** Discriminant. */
  kind: "type_violation_returns_400";
  /** Dot-notation field path. */
  field: string;
  /** Declared JSON type of the field. */
  original_type: string;
  /** Wrong-type substitute the runner injects (deterministic per original). */
  wrong_type: string;
  /** Always 400. */
  expected_status: number;
}

/** params.kind = "boundary_battery". */
export interface BoundaryParams {
  /** Discriminant. */
  kind: "boundary_battery";
  /** Dot-notation field path. */
  field: string;
  /** Which constraint this case probes. */
  constraint: "minimum" | "maximum" | "minLength" | "maxLength" | "enum";
  /** Whether the value is inside (valid) or outside (invalid) the constraint. */
  position: "inside" | "outside";
  /** The concrete boundary value (JSON-serializable). */
  value: unknown;
  /** Endpoint success status for inside; 400 for outside. */
  expected_status: number;
}

/** params.kind = "get_idempotency". */
export interface GetIdempotencyParams {
  /** Discriminant. */
  kind: "get_idempotency";
  /** Runner issues two identical GETs and compares bodies for deep equality. */
  compare: "body_equality";
}

/** params.kind = "delete_idempotency". */
export interface DeleteIdempotencyParams {
  /** Discriminant. */
  kind: "delete_idempotency";
  /** Expected status of the SECOND delete (204 or 404; default 404). */
  second_delete_status: number;
}

/** params.kind = "db_state_matches_expectation". */
export interface DbStateParams {
  /** Discriminant. */
  kind: "db_state_matches_expectation";
  /** Reference to a database connection defined in the environment config. */
  connection: string;
  /** SQL/query to run (may include templating; never executed by Task #6). */
  query: string;
  /** How to verify the result. */
  expect: CanonicalDbVerification["expect"];
  /** Expected field values for 'match' or 'exact' modes. */
  fields?: Record<string, unknown>;
  /** Optional query reference identifier. */
  query_id?: string;
}

/**
 * params.kind = "put_idempotency".
 *
 * Runner issues two identical PUTs, then compares per `compare`:
 *   - "body_equality"  → deep-equal of two response bodies (canonical JSON);
 *   - "db_state"       → re-run endpoint.db_verify after the second PUT and
 *                        require every step to pass (same gating as
 *                        db_state_matches_expectation).
 *
 * The generator chooses `compare` based on `endpoint.db_verify.length`:
 *   length > 0 → "db_state"; length === 0 OR field absent → "body_equality".
 *   The presence-vs-count distinction is locked: `db_verify: []` selects
 *   body_equality (design decision B).
 */
export interface PutIdempotencyParams {
  /** Discriminant. */
  kind: "put_idempotency";
  /** How to compare the two PUTs. */
  compare: "body_equality" | "db_state";
}

/**
 * params.kind = "head_get_parity".
 *
 * Runner issues a HEAD then a GET against the paired URL and asserts:
 *   (a) status codes are identical (RFC 7231 §4.3.2);
 *   (b) response headers are identical modulo IGNORED_PARITY_HEADERS;
 *   (c) HEAD response body is empty (null | undefined | "").
 *
 * Auth context: HEAD endpoint's auth_strategy is applied to BOTH requests.
 * The paired GET endpoint's auth_strategy is never consulted.
 *
 * `paired_get_url` is the RAW (pre-template-substitution) URL copied verbatim
 * from the paired GET endpoint's `url` field. The runner applies
 * `resolveTemplates` + `joinUrl` at request-build time — identical to how
 * the HEAD's own URL is resolved.
 *
 * Invariant after plan resolution: `paired_get_url` is NEVER the empty string.
 * The resolver drops any case it cannot populate. A non-empty string is the
 * runner's signal that resolution succeeded.
 */
export interface HeadGetParityParams {
  /** Discriminant. */
  kind: "head_get_parity";
  /** Id of the paired GET endpoint (resolved at plan generation). */
  paired_get_endpoint_id: string;
  /**
   * Raw (pre-template-substitution) URL copied verbatim from the paired GET
   * endpoint's `url` field. The runner applies `${env.*}` resolution and
   * `joinUrl(env.base_url, ...)` to this string at request-build time.
   *
   * Invariant after plan resolution: NEVER the empty string. The
   * plan-resolver drops any case it cannot populate. A non-empty string is
   * the runner's signal that resolution succeeded.
   */
  paired_get_url: string;
}

/** params.kind = "assertion". */
export interface AssertionParams {
  /** Discriminant. */
  kind: "assertion";
  /** Verbatim assertion string — NOT parsed/evaluated by Task #6. */
  assertion: string;
}
