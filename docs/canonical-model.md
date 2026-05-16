# Canonical Model Reference

The canonical model is the internal representation of all API endpoints. All importers (Postman, OpenAPI, JSON) convert their formats into this shape, and all downstream processors (test generator, runner, reporters) consume from it.

## Overview

The canonical model consists of:

- **CanonicalEndpoint** — Complete endpoint definition
- **CanonicalRequest** — Request shape (headers, body, query params)
- **CanonicalResponse** — Expected response (status, schema, SLA)
- **CanonicalDbVerification** — Database state checks (SQL/Cypher/queries)
- **CanonicalRetryPolicy** — Retry configuration per endpoint
- **CanonicalSource** — Where this endpoint came from (Postman, OpenAPI, etc.)

## Complete Endpoint Definition

### Required Fields

```typescript
interface CanonicalEndpoint {
  // Unique identifier (e.g., "users.create")
  // Pattern: ^[a-z0-9._-]+$
  id: string;

  // Human-readable name
  name: string;

  // HTTP method
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";

  // Endpoint URL (relative, may include templating)
  url: string;

  // Request specification
  request: CanonicalRequest;

  // Response specification
  response: CanonicalResponse;
}
```

### Optional Fields

```typescript
interface CanonicalEndpoint {
  // Auth strategy name (defined in environment)
  auth_strategy?: string;

  // Cross-cutting labels for grouping
  tags?: string[];

  // Which test markers include this endpoint
  markers?: ("smoke" | "regression" | "e2e")[];

  // Safe to run smoke tests in production?
  prod_safe?: boolean;

  // Database state verification queries
  db_verify?: CanonicalDbVerification[];

  // Declarative business logic assertions
  assertions?: string[];

  // Cleanup query to run after verification
  cleanup?: CanonicalDbQuery;

  // Per-endpoint retry policy override
  retry?: CanonicalRetryPolicy;

  // Source metadata
  source?: CanonicalSource;
}
```

## Request Specification

```typescript
interface CanonicalRequest {
  // Optional HTTP headers
  // May include templating: ${env.*}, ${secret.*}
  headers?: Record<string, string>;

  // JSON Schema for request body
  // Omitted for GET/HEAD/DELETE (no body)
  body_schema?: JsonSchema;

  // Example request payload
  body_example?: unknown;

  // Query string parameters as JSON Schema
  query_params?: Record<string, JsonSchema>;
}
```

### Example

```json
{
  "request": {
    "headers": {
      "Content-Type": "application/json"
    },
    "body_schema": {
      "type": "object",
      "properties": {
        "email": { "type": "string", "format": "email" },
        "name": { "type": "string", "minLength": 1 },
        "age": { "type": "integer", "minimum": 18 }
      },
      "required": ["email", "name"]
    },
    "body_example": {
      "email": "user@example.com",
      "name": "John Doe",
      "age": 25
    }
  }
}
```

## Response Specification

```typescript
interface CanonicalResponse {
  // Expected HTTP status code (100-599)
  expected_status: number;

  // JSON Schema for response body
  schema: JsonSchema;

  // Optional expected response headers
  headers?: Record<string, string>;

  // Optional response time SLA in milliseconds
  sla_ms?: number;
}
```

### Example

```json
{
  "response": {
    "expected_status": 201,
    "schema": {
      "type": "object",
      "properties": {
        "id": { "type": "string", "format": "uuid" },
        "email": { "type": "string", "format": "email" },
        "name": { "type": "string" },
        "created_at": { "type": "string", "format": "date-time" }
      },
      "required": ["id", "email", "name", "created_at"]
    },
    "headers": {
      "Content-Type": "application/json"
    },
    "sla_ms": 500
  }
}
```

## Database Verification

### Specification

```typescript
interface CanonicalDbVerification {
  // Database connection name (defined in environment)
  connection: string;

  // Query to execute (SQL, Cypher, or MongoDB query)
  // May include templating: ${request.body.*}, ${response.body.*}
  query: string;

  // How to verify the result
  expect: "exists" | "not_exists" | "match" | "exact";

  // Expected field values (for match/exact modes)
  fields?: Record<string, unknown>;

  // Optional ID for referencing results in assertions
  query_id?: string;
}
```

### Expect Modes

- **`exists`** — Result has at least one row/document/node
- **`not_exists`** — Result is empty (used for DELETE verification)
- **`match`** — Result contains a row where declared fields equal declared values; other fields ignored
- **`exact`** — Result row equals declared fields exactly (no extras, no missing)

### Example

```json
{
  "db_verify": [
    {
      "connection": "primary_postgres",
      "query": "SELECT * FROM users WHERE email = '${request.body.email}'",
      "expect": "match",
      "fields": {
        "email": "${request.body.email}",
        "name": "${request.body.name}"
      },
      "query_id": "verify_user_created"
    },
    {
      "connection": "primary_postgres",
      "query": "SELECT COUNT(*) as count FROM user_events WHERE user_id = (SELECT id FROM users WHERE email = '${request.body.email}')",
      "expect": "exists"
    }
  ]
}
```

## Declarative Assertions

Business logic checks expressed as strings without code:

```json
{
  "assertions": [
    "response.body.id is_uuid_v4",
    "response.body.email equals request.body.email",
    "response.body.created_at is_recent_timestamp",
    "response.status equals 201",
    "response.time_ms less_than 1000",
    "db.primary_postgres.verify_user_created.count_equals 1"
  ]
}
```

### Supported Assertion Vocabulary

See [assertions-reference.md](./assertions-reference.md) for the complete list.

## Retry Policy

### Specification

```typescript
interface CanonicalRetryPolicy {
  // Number of retry attempts (0-5)
  count?: number;

  // Initial delay before first retry (milliseconds)
  delay_ms?: number;

  // Backoff strategy: "none" | "linear" | "exponential"
  backoff?: "none" | "linear" | "exponential";

  // Fail on first-attempt failure even if retry succeeds?
  strict?: boolean;
}
```

### Example

```json
{
  "retry": {
    "count": 3,
    "delay_ms": 500,
    "backoff": "exponential",
    "strict": false
  }
}
```

## Test Markers

Endpoints can be tagged with markers to control which tests run:

- **`smoke`** — Happy-path correctness tests. Safe in production for read methods (GET, HEAD, OPTIONS). Write methods require `prod_safe: true` or explicit allow-flag.
- **`regression`** — Negative tests, boundary testing, idempotency checks, DB verification. Not safe in production.
- **`e2e`** — Multi-step flow tests (v1.5+). Reserved in v1.0 schema.

### Example

```json
{
  "markers": ["smoke", "regression"],
  "prod_safe": false
}
```

For a GET endpoint, it's safe to add `"prod_safe": true`:

```json
{
  "method": "GET",
  "markers": ["smoke", "regression"],
  "prod_safe": true
}
```

## Complete Example

```json
{
  "id": "users.create",
  "name": "Create User",
  "method": "POST",
  "url": "/api/v1/users",
  "auth_strategy": "user_token",
  "tags": ["billing", "critical"],
  "markers": ["smoke", "regression"],
  "prod_safe": false,
  "request": {
    "body_schema": {
      "type": "object",
      "properties": {
        "email": { "type": "string", "format": "email" },
        "name": { "type": "string", "minLength": 1 },
        "age": { "type": "integer", "minimum": 18 }
      },
      "required": ["email", "name"]
    },
    "body_example": {
      "email": "user@example.com",
      "name": "John Doe",
      "age": 25
    }
  },
  "response": {
    "expected_status": 201,
    "schema": {
      "type": "object",
      "properties": {
        "id": { "type": "string", "format": "uuid" },
        "email": { "type": "string", "format": "email" },
        "name": { "type": "string" },
        "created_at": { "type": "string", "format": "date-time" }
      },
      "required": ["id", "email", "name", "created_at"]
    },
    "sla_ms": 500
  },
  "db_verify": [
    {
      "connection": "primary_postgres",
      "query": "SELECT * FROM users WHERE email = '${request.body.email}'",
      "expect": "match",
      "fields": {
        "email": "${request.body.email}",
        "name": "${request.body.name}"
      },
      "query_id": "user_created"
    }
  ],
  "assertions": [
    "response.body.id is_uuid_v4",
    "response.body.email equals request.body.email",
    "response.body.created_at is_recent_timestamp",
    "db.primary_postgres.user_created.count_equals 1"
  ],
  "retry": {
    "count": 2,
    "delay_ms": 1000,
    "backoff": "linear"
  },
  "source": {
    "type": "postman",
    "collection": "users.postman_collection.json",
    "endpoint_id": "abc-123-def"
  }
}
```

## Validation

All endpoints are validated against the canonical meta-schema at framework startup. Invalid definitions fail fast with clear error messages:

```
root.request.body_schema type must be object
root.response.expected_status must be an HTTP status code (100-599)
root.db_verify[0].expect must be a valid expectation mode
```

## File Naming Convention

Endpoints are stored as JSON files matching the pattern `*.endpoint.json`:

```
tests/
├── user-service/
│   ├── users/
│   │   ├── create.endpoint.json
│   │   ├── get.endpoint.json
│   │   ├── update.endpoint.json
│   │   └── delete.endpoint.json
│   └── sessions/
│       └── login.endpoint.json
└── payment-service/
    └── transactions/
        ├── charge.endpoint.json
        └── refund.endpoint.json
```

The directory structure is flexible and purely organizational. Only filenames matching `*.endpoint.json` are loaded.

## Related Documentation

- **[Assertions Reference](./assertions-reference.md)** — Complete vocabulary for business logic assertions
- **[Auth Strategies](./auth-strategies.md)** — How to configure authentication
- **[Database Connectors](./connectors.md)** — Supported databases and connection setup
- **[Authoring Endpoints](./authoring-endpoints.md)** — Practical guide to writing endpoint definitions
