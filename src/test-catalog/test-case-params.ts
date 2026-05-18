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

/** params.kind = "assertion". */
export interface AssertionParams {
  /** Discriminant. */
  kind: "assertion";
  /** Verbatim assertion string — NOT parsed/evaluated by Task #6. */
  assertion: string;
}
