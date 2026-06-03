/**
 * Internal canonical representation of API endpoints. All importers convert their formats
 * into this shape; all downstream processors consume from this model.
 */

/** Full JSON Schema object type. */
export type JsonSchema = Record<string, unknown>;

/** HTTP method union type. */
export type HttpMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "HEAD"
  | "OPTIONS";

/** Test marker type. */
export type TestMarker = "smoke" | "regression" | "e2e";

/** Database verification expectation mode. */
export type DbExpectMode = "exists" | "not_exists" | "match" | "exact";

/** Retry backoff strategy. */
export type BackoffStrategy = "none" | "linear" | "exponential";

/** Request specification for an endpoint. */
export interface CanonicalRequest {
  /** Optional HTTP headers (may include templating like ${env.*}). */
  headers?: Record<string, string>;

  /** JSON Schema for the request body. */
  body_schema?: JsonSchema;

  /** Example request payload. */
  body_example?: unknown;

  /** Query string parameters as JSON Schema properties. */
  query_params?: Record<string, JsonSchema>;
}

/** Response specification for an endpoint. */
export interface CanonicalResponse {
  /** Expected HTTP status code (100-599). */
  expected_status: number;

  /**
   * JSON Schema for the expected response body. Optional: bodyless responses
   * (204 No Content, plain-text, status-only checks) declare no schema, in
   * which case `response_schema_validation` is not generated for the endpoint.
   */
  schema?: JsonSchema;

  /** Optional expected response headers. */
  headers?: Record<string, string>;

  /** Optional response time SLA in milliseconds. */
  sla_ms?: number;
}

/** Database verification query specification. */
export interface CanonicalDbVerification {
  /** Reference to a database connection defined in the environment config. */
  connection: string;

  /** SQL/Cypher/query to execute (may include templating). */
  query: string;

  /** How to verify the query result. */
  expect: DbExpectMode;

  /** Expected field values for 'match' or 'exact' expect modes. */
  fields?: Record<string, unknown>;

  /** Optional identifier for referencing query results in assertions. */
  query_id?: string;
}

/** Teardown database query specification. */
export interface CanonicalDbQuery {
  /** Reference to a database connection defined in the environment config. */
  connection: string;

  /** SQL/Cypher/query to execute for cleanup. */
  query: string;
}

/** Retry policy configuration. */
export interface CanonicalRetryPolicy {
  /** Number of retry attempts (0-5). */
  count?: number;

  /** Initial delay before first retry in milliseconds. */
  delay_ms?: number;

  /** Backoff strategy for retry delays. */
  backoff?: BackoffStrategy;

  /** If true, fail on any first-attempt failure regardless of retry success. */
  strict?: boolean;
}

/** Source metadata (where this endpoint came from). */
export interface CanonicalSource {
  /** Source format type. */
  type: "postman" | "openapi" | "native-json";

  /** Source collection filename (for Postman). */
  collection?: string;

  /** Source endpoint/request ID (for Postman). */
  endpoint_id?: string;

  /** Source spec URL (for OpenAPI). */
  spec_url?: string;
}

/** Complete canonical endpoint definition. */
export interface CanonicalEndpoint {
  /** Unique endpoint identifier (e.g., 'users.create'). Must match pattern [a-z0-9._-]+. */
  id: string;

  /** Human-readable endpoint name. */
  name: string;

  /** HTTP method. */
  method: HttpMethod;

  /** Endpoint URL/path (relative, may include templating). */
  url: string;

  /** Reference to auth strategy defined in environment config. */
  auth_strategy?: string;

  /** Cross-cutting labels for grouping endpoints at runtime. */
  tags?: string[];

  /** Test markers that include this endpoint. */
  markers?: TestMarker[];

  /**
   * Optional list of skip tokens that instruct the plan generator to omit
   * specific auto-generated test cases for this endpoint.
   *
   * Token grammar: `kind` or `kind:field` (single colon, neither side empty).
   * Examples: `"type_violation_returns_400"`, `"boundary_battery:price"`.
   *
   * Union semantics: tokens are combined with any `skip_globally` tokens from
   * the config. A case is skipped when ANY token (endpoint-local or global)
   * matches its `(kind, field)` identity.
   *
   * Malformed tokens warn but never throw — generation proceeds normally.
   */
  skip_cases?: readonly string[];

  /** If true, this endpoint is safe to run smoke tests against in production. */
  prod_safe?: boolean;

  /** Request specification. */
  request: CanonicalRequest;

  /** Response specification. */
  response: CanonicalResponse;

  /** Optional database state verification queries. */
  db_verify?: CanonicalDbVerification[];

  /** Optional declarative business-logic assertions (unparsed strings). */
  assertions?: string[];

  /** Optional teardown query to execute after verification. */
  cleanup?: CanonicalDbQuery;

  /** Optional per-endpoint retry policy override. */
  retry?: CanonicalRetryPolicy;

  /** Source metadata (where this endpoint came from). */
  source?: CanonicalSource;
}

/**
 * A single step in a {@link CanonicalFlow}: invokes one endpoint (by id) and
 * optionally captures response values for use by later steps.
 *
 * RESERVED FOR v1.5 — no v1.0 runtime imports, validates, or executes this.
 * Parallels the `e2e` marker being "reserved in v1.0 schema but no e2e tests
 * generated" (§3).
 */
export interface CanonicalFlowStep {
  /** Reference to a {@link CanonicalEndpoint} `id` this step invokes. */
  endpoint_id: string;

  /** Optional human-readable step name. */
  name?: string;

  /**
   * Optional capture map (response value path → variable name) exposing
   * values to later steps' templating, e.g. `{ user_id: "response.body.id" }`.
   */
  capture?: Record<string, string>;

  /** Optional per-step declarative assertions (unparsed strings). */
  assertions?: string[];
}

/**
 * A linear multi-step end-to-end flow: an ordered sequence of endpoint
 * invocations with cross-step variable capture, optional setup/teardown, and
 * assertions evaluated at the end.
 *
 * RESERVED FOR v1.5 — defined here so the canonical type vocabulary is shared
 * across the codebase per §2, but NO v1.0 runtime imports,
 * validates, generates, or executes flows (parallels the `e2e` marker being
 * "reserved in v1.0 schema but no e2e tests generated", §3). The v1.5 model is
 * linear sequence + setup/teardown + variable extraction + assertions-at-end
 * (v1.5 roadmap).
 */
export interface CanonicalFlow {
  /** Unique flow identifier. Same charset as endpoint id (`[a-z0-9._-]+`). */
  id: string;

  /** Human-readable flow name. */
  name: string;

  /** Test markers that include this flow (v1.0: only `e2e` is meaningful). */
  markers?: TestMarker[];

  /** Cross-cutting labels for grouping flows at runtime. */
  tags?: string[];

  /** Optional setup steps run once before the main sequence. */
  setup?: CanonicalFlowStep[];

  /** Ordered main sequence of steps. */
  steps: CanonicalFlowStep[];

  /** Optional teardown steps run once after the main sequence. */
  teardown?: CanonicalFlowStep[];

  /** Source metadata (where this flow came from). */
  source?: CanonicalSource;
}
