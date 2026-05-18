/**
 * Hand-authored multi-endpoint CanonicalEndpoint fixture for Task #6 tests.
 *
 * Covers every generator branch:
 *   1. GET read endpoint — no body, no auth, no db_verify.
 *   2. Authenticated POST with full body schema (required + typed + constrained
 *      fields), db_verify (2 entries), assertions (2 strings), no prod_safe.
 *   3. Authenticated DELETE with db_verify, expected_status=204.
 *   4. Authenticated PUT with prod_safe:true, body schema (no required fields).
 *   5. Unauthenticated public POST with a small body schema.
 *   6. Invalid endpoint — missing `response` field (fails ENDPOINT_META_SCHEMA).
 *
 * NOTE: Built as static object literals (NOT recursively generated) to avoid
 * any stack-depth risk on CI's Node 22. The deliberate invalid endpoint is cast
 * via `as unknown as CanonicalEndpoint` so TypeScript does not reject it.
 */

import type { CanonicalEndpoint } from "../../../src/core/canonical-model.js";

/**
 * Endpoint 1: GET /users — read method, no body, no auth, no db_verify.
 * Exercises: universal smoke (5 cases) + get_idempotency.
 */
export const getUsers: CanonicalEndpoint = {
  id: "users.list",
  name: "List Users",
  method: "GET",
  url: "/api/v1/users",
  request: {},
  response: {
    expected_status: 200,
    schema: { type: "object", properties: { users: { type: "array" } } },
    sla_ms: 500,
  },
};

/**
 * Endpoint 2: POST /users — authenticated, full body schema, db_verify,
 * assertions, no prod_safe flag (undefined → smoke is prod_safe=false).
 *
 * Body schema has:
 *   - required fields: email, name
 *   - typed fields: email (string), name (string), age (integer), active (boolean)
 *   - constrained fields:
 *       email: minLength=5, maxLength=100
 *       name: minLength=1, maxLength=50
 *       age: minimum=18, maximum=120
 *       role: enum=["admin","user","guest"]
 */
export const createUser: CanonicalEndpoint = {
  id: "users.create",
  name: "Create User",
  method: "POST",
  url: "/api/v1/users",
  auth_strategy: "user_token",
  request: {
    headers: { "Content-Type": "application/json" },
    body_schema: {
      type: "object",
      required: ["email", "name"],
      properties: {
        email: {
          type: "string",
          minLength: 5,
          maxLength: 100,
        },
        name: {
          type: "string",
          minLength: 1,
          maxLength: 50,
        },
        age: {
          type: "integer",
          minimum: 18,
          maximum: 120,
        },
        active: {
          type: "boolean",
        },
        role: {
          type: "string",
          enum: ["admin", "user", "guest"],
        },
      },
    },
    body_example: { email: "test@example.com", name: "Test User", age: 25 },
  },
  response: {
    expected_status: 201,
    schema: {
      type: "object",
      properties: {
        id: { type: "string" },
        email: { type: "string" },
        name: { type: "string" },
      },
    },
    sla_ms: 1000,
  },
  db_verify: [
    {
      connection: "primary_postgres",
      query: "SELECT id, email FROM users WHERE email = '${request.body.email}'",
      expect: "match",
      fields: { email: "${request.body.email}" },
      query_id: "user_check",
    },
    {
      connection: "primary_postgres",
      query: "SELECT COUNT(*) FROM users WHERE email = '${request.body.email}'",
      expect: "exists",
    },
  ],
  assertions: [
    "response.body.id is_uuid_v4",
    "response.body.email equals request.body.email",
  ],
};

/**
 * Endpoint 3: DELETE /users/:id — authenticated, db_verify, expected_status=204.
 * Exercises: delete_idempotency with second_delete_status=204.
 */
export const deleteUser: CanonicalEndpoint = {
  id: "users.delete",
  name: "Delete User",
  method: "DELETE",
  url: "/api/v1/users/:id",
  auth_strategy: "user_token",
  request: {},
  response: {
    expected_status: 204,
    schema: {},
  },
  db_verify: [
    {
      connection: "primary_postgres",
      query: "SELECT id FROM users WHERE id = '${request.url.id}'",
      expect: "not_exists",
    },
  ],
};

/**
 * Endpoint 4: PUT /users/:id — authenticated, prod_safe:true, body schema with
 * no required fields (exercises body-negative without required-field omission).
 * Exercises: prod_safe=true for smoke on write method.
 */
export const updateUser: CanonicalEndpoint = {
  id: "users.update",
  name: "Update User",
  method: "PUT",
  url: "/api/v1/users/:id",
  auth_strategy: "user_token",
  prod_safe: true,
  request: {
    body_schema: {
      type: "object",
      properties: {
        name: { type: "string", minLength: 1 },
        age: { type: "integer", minimum: 0 },
      },
    },
  },
  response: {
    expected_status: 200,
    schema: { type: "object" },
  },
};

/**
 * Endpoint 5: POST /events — no auth_strategy (public endpoint), small body.
 * Exercises: universal auth_happy_path with unauthenticated=true; zero auth-negative.
 */
export const createEvent: CanonicalEndpoint = {
  id: "events.create",
  name: "Create Event",
  method: "POST",
  url: "/api/v1/events",
  request: {
    body_schema: {
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string" },
      },
    },
  },
  response: {
    expected_status: 201,
    schema: { type: "object" },
  },
};

/**
 * Endpoint 6: Deliberately invalid — missing required `response` field.
 * Fails ENDPOINT_META_SCHEMA validation. Contributes zero cases; increments
 * endpoints_skipped; generates a warning naming the id.
 */
export const invalidEndpoint = {
  id: "invalid.endpoint",
  name: "Invalid Endpoint",
  method: "GET",
  url: "/api/v1/invalid",
  request: {},
  // response is intentionally absent — invalid per ENDPOINT_META_SCHEMA
} as unknown as CanonicalEndpoint;

/**
 * The full fixture array, in a deterministic order matching §10 requirements.
 * 5 valid endpoints + 1 invalid = 6 total.
 */
export const FIXTURE_ENDPOINTS: CanonicalEndpoint[] = [
  getUsers,
  createUser,
  deleteUser,
  updateUser,
  createEvent,
  invalidEndpoint,
];

/** Count of valid endpoints in the fixture (for assertion arithmetic). */
export const FIXTURE_VALID_COUNT = 5;

/** Count of invalid endpoints in the fixture. */
export const FIXTURE_INVALID_COUNT = 1;

/**
 * Schema field inventory for createUser (endpoint 2), used to compute
 * expected case counts without hard-coding magic numbers.
 */
export const CREATE_USER_SCHEMA_FIELDS = {
  required: ["email", "name"] as string[],
  typed: ["email", "name", "age", "active", "role"] as string[],
  /** Fields with min/max constraints (each yields 2 boundary cases). */
  constrainedFields: [
    { field: "email", constraints: ["minLength", "maxLength"] },
    { field: "name", constraints: ["minLength", "maxLength"] },
    { field: "age", constraints: ["minimum", "maximum"] },
    { field: "role", constraints: ["enum"] },
  ] as Array<{ field: string; constraints: string[] }>,
};
