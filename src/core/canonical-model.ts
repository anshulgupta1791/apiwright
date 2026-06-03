/**
 * Internal canonical representation of API endpoints. All importers convert their formats
 * into this shape; all downstream processors consume from this model.
 */

/** Full JSON Schema object type. */
export type JsonSchema = Record<string, unknown>;

/**
 * A single declared response variant for an endpoint.
 *
 * Used by the runner's verdict-enrichment logic to annotate failure reasons
 * when the actual HTTP status matches a declared variant key.
 *
 * The `schema` field is REQUIRED in v1.0.2. A future version may relax this
 * to allow schema-less variants (forward-compat path: "documented variant").
 */
export interface ResponseVariant {
  /**
   * JSON Schema for the variant response body.
   * Required in v1.0.2; validated at load time via ENDPOINT_META_SCHEMA.
   */
  schema: JsonSchema;
}

/**
 * Map of HTTP status code strings (matching `^[1-5]\\d{2}$`) to their
 * declared response variant definitions.
 *
 * Keys MUST be exact three-digit decimal strings (e.g. `"400"`, `"500"`).
 * Wildcard keys (e.g. `"4xx"`) are rejected at load time.
 */
export type ResponseVariantMap = Readonly<Record<string, ResponseVariant>>;

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

  /**
   * Optional reference to another endpoint id this endpoint should be paired
   * with for cross-method semantic checks. v1.0.2 use: HEAD endpoints set
   * `pair_with` to a sibling GET endpoint id to enable the
   * `head_get_parity` generated test (which issues a HEAD + a GET against the
   * paired URL and asserts status/header/empty-body parity per RFC 7231 §4.3.2).
   *
   * Pair semantics for `head_get_parity`:
   *  - `endpoint.method` MUST be `"HEAD"` for the generator to fire.
   *  - `pair_with` MUST be the id of an endpoint with `method === "GET"`.
   *  - The paired endpoint is looked up by id at plan-generation time; an
   *    unresolved reference, a non-GET target, a URL mismatch, or a HEAD
   *    self-reference all drop the case with a warning (never throw).
   *
   * Reserved for future v1.x cross-method generators (e.g. POST + GET happy
   * path, PUT + GET round-trip). The grammar (single endpoint id) is locked
   * for forward compatibility.
   */
  pair_with?: string;

  /**
   * Optional opt-in flag declaring this GET endpoint supports RFC 7232
   * conditional requests (ETag / If-None-Match). When set to `true` on a
   * GET endpoint, the `conditional_get_304` generator emits a regression
   * test that issues GET → captures ETag → GET with If-None-Match →
   * asserts 304 Not Modified per RFC 7232 §4.1.
   *
   * Pair semantics for `conditional_get_304`:
   *  - `endpoint.method` MUST be `"GET"` for the generator to fire.
   *  - The flag is opt-in (false / absent → no case emitted) because
   *    auto-detection would create false positives on endpoints that
   *    happen to emit `ETag` headers without honouring `If-None-Match`.
   *  - Non-GET endpoints with `etag_supported: true` are silently ignored
   *    (forward-compat for a future HEAD extension; no warning).
   *
   * Reserved for future v1.x extensions: `If-Modified-Since` /
   * `Last-Modified` (RFC 7232 §2.2) and HEAD-method ETag support.
   */
  etag_supported?: boolean;

  /**
   * Optional pagination configuration. When declared on a GET endpoint,
   * activates the `pagination_boundary` generator which emits 2-4 single-
   * request probes against the size and page query parameters at their
   * declared boundaries (size=0, size=max, size=max+1, page=-1).
   *
   * See {@link PaginationConfig} for the field shape.
   *
   * Pagination on non-GET endpoints is silently ignored (forward-compat for
   * future paginated-POST search endpoints). No warning is emitted.
   */
  pagination?: PaginationConfig;

  /**
   * Optional CORS preflight configuration. When declared on an OPTIONS
   * endpoint, activates the `cors_preflight` generator which emits a single
   * smoke test verifying the server's preflight response headers.
   *
   * Non-OPTIONS endpoints with `cors` declared are silently ignored (DD-1).
   * See {@link CorsConfig} for the field shape and plan-warning behaviour.
   */
  cors?: CorsConfig;

  /**
   * Optional map of HTTP status code strings to declared response variant
   * schemas. Used by the runner's verdict-enrichment logic to produce richer
   * failure reasons when the actual status mismatches `response.expected_status`
   * but matches a known variant.
   *
   * Key constraint: MUST match `^[1-5]\\d{2}$` (exact three-digit decimal).
   * Wildcard keys (e.g. `"4xx"`) are rejected at load time.
   *
   * DD-4: Variant lookup is SUPPRESSED when `actual === response.expected_status`.
   * DD-5: Enrichment applies ONLY to STATUS_EQ_KINDS (9 kinds).
   * DD-6: Variant match still produces a `fail` verdict; only the
   *   `failure_reason` string changes.
   *
   * Plan-time warnings (DD-12):
   *   - A key equal to `String(response.expected_status)` → "happy-path status" warning.
   *   - An empty map `{}` → "empty" warning.
   */
  response_variants?: ResponseVariantMap;
}

/** Pagination style supported by a list endpoint. */
export type PaginationStyle = "page" | "offset" | "cursor";

/**
 * CORS preflight configuration for OPTIONS endpoints.
 *
 * Activates the `cors_preflight` generator, which emits a single smoke test
 * that issues an OPTIONS preflight request and asserts the response headers
 * satisfy CORS requirements per RFC 6454 / Fetch standard.
 *
 * Activation: `endpoint.method === "OPTIONS"` AND `cors` is declared.
 * Non-OPTIONS endpoints with `cors` declared are silently ignored (DD-1).
 *
 * Required fields when present:
 *  - `allow_origins`: non-empty list; `["*"]` for wildcard.
 *  - `allow_methods`: non-empty list of HTTP method strings.
 *  - `allow_headers`: may be empty (omits `Access-Control-Request-Headers`).
 *
 * Plan warnings for:
 *  - `allow_origins: []` → case dropped, warning emitted.
 *  - `allow_methods: []` → case dropped, warning emitted.
 *  - `allow_headers: []` → valid; no warning.
 */
export interface CorsConfig {
  /** Origins to probe (e.g. `["https://app.example.com"]` or `["*"]`). */
  allow_origins: readonly string[];
  /** HTTP methods to assert the server allows. */
  allow_methods: readonly string[];
  /** Request headers to assert the server allows. Empty = no ACRH probe. */
  allow_headers: readonly string[];
}

/**
 * Optional pagination configuration declaring how a list endpoint paginates
 * its responses. Activates the `pagination_boundary` generator which probes
 * the size/page query parameters at their declared boundaries.
 *
 * Required fields when present:
 *  - `style` is one of "page", "offset", "cursor".
 *  - `size_param` is a non-empty string.
 *  - `default_size > 0` (integer).
 *  - `max_size >= default_size` (integer; enforced in generator).
 *
 * Page-style additionally requires `page_param`; if absent, the
 * page_negative probe is skipped with a plan-time warning.
 *
 * Activation: `endpoint.method === "GET"`. Non-GET endpoints with
 * `pagination` declared are silently ignored (forward-compat for future
 * paginated-POST search endpoints).
 */
export interface PaginationConfig {
  /** Pagination style (drives which probes fire). */
  style: PaginationStyle;
  /** Query parameter carrying the page-size value (e.g. "size", "limit"). */
  size_param: string;
  /** Query parameter carrying the page index (page-style only). */
  page_param?: string;
  /** Default page size (the server's documented default). */
  default_size: number;
  /** Maximum page size the server will accept. */
  max_size: number;
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
