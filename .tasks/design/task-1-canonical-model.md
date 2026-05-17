# Task 1 Design: Define Canonical Endpoint Model and Types

## Overview

This task establishes the internal TypeScript type definitions and JSON Schema meta-schema that every other component in APIWright depends on. All importers (Postman, OpenAPI, native JSON) convert their input formats into this canonical shape. All downstream processors (test plan generator, assertions engine, runner, reporters) consume from this canonical model.

**Success criteria:**
- TypeScript interfaces defined and exported from `src/core/canonical-model.ts`
- Meta-schema (JSON Schema) validates endpoint definitions
- AJV validator initialized with all required formats
- No implementations of business logic, only type definitions and validation setup

---

## Public API

### Main Type Exports

```typescript
// src/core/canonical-model.ts

export interface CanonicalEndpoint {
  id: string;                              // Unique identifier (e.g., "users.create")
  name: string;                            // Human-readable name
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";
  url: string;                             // Relative path (e.g., "/api/v1/users")
  auth_strategy?: string;                  // Reference to auth strategy in environment
  tags?: string[];                         // Cross-cutting labels (e.g., ["billing", "critical"])
  markers?: ("smoke" | "regression" | "e2e")[];  // Which test markers include this endpoint
  prod_safe?: boolean;                     // Safe to run smoke tests in production?

  request: CanonicalRequest;
  response: CanonicalResponse;
  
  db_verify?: CanonicalDbVerification[];   // Optional: database state checks
  assertions?: string[];                   // Optional: declarative business rules
  cleanup?: CanonicalDbQuery;              // Optional: teardown query
  retry?: CanonicalRetryPolicy;            // Optional: per-endpoint retry override

  source?: {
    type: "postman" | "openapi" | "native-json";
    collection?: string;                   // e.g., "users.postman_collection.json"
    endpoint_id?: string;                  // e.g., Postman request UUID
    spec_url?: string;                     // e.g., OpenAPI spec URL
  };
}

export interface CanonicalRequest {
  headers?: Record<string, string>;        // Optional headers (may include templating)
  body_schema?: JsonSchema;                // JSON Schema for request body
  body_example?: unknown;                  // Example payload
  query_params?: Record<string, JsonSchema>; // Query string parameters
}

export interface CanonicalResponse {
  expected_status: number;                 // e.g., 200, 201, 404
  schema: JsonSchema;                      // Expected response body schema
  headers?: Record<string, string>;        // Optional header expectations
  sla_ms?: number;                         // Optional response time SLA
}

export interface CanonicalDbVerification {
  connection: string;                      // Reference to db config in environment
  query: string;                           // SQL/Cypher/query (may include templating)
  expect: "exists" | "not_exists" | "match" | "exact";
  fields?: Record<string, unknown>;        // Expected field values (for match/exact)
  query_id?: string;                       // Optional: used to reference results in assertions
}

export interface CanonicalDbQuery {
  connection: string;
  query: string;
}

export interface CanonicalRetryPolicy {
  count?: number;                          // Number of retries (0-5)
  delay_ms?: number;                       // Initial delay before retry
  backoff?: "none" | "linear" | "exponential";
  strict?: boolean;                        // Fail on first-attempt failure even if retry passes
}

export type JsonSchema = Record<string, unknown>;  // Full JSON Schema object
```

### Validator Setup

```typescript
// src/core/schema-validator.ts

import Ajv from "ajv";
import addFormats from "ajv-formats";

export class SchemaValidator {
  private ajv: Ajv;
  private endpointSchema: any;  // Compiled schema for CanonicalEndpoint
  
  constructor() {
    this.ajv = new Ajv({ strict: false });
    addFormats(this.ajv);
    this.endpointSchema = this.ajv.compile(ENDPOINT_META_SCHEMA);
  }

  validateEndpoint(endpoint: unknown): { valid: boolean; errors?: string[] } {
    const valid = this.endpointSchema(endpoint);
    return {
      valid,
      errors: valid ? undefined : (this.endpointSchema.errors || []).map(
        (e: any) => `${e.instancePath || "root"} ${e.message}`
      ),
    };
  }

  validateRequestBody(schema: JsonSchema, body: unknown): boolean {
    const validator = this.ajv.compile(schema);
    return validator(body);
  }

  validateResponseBody(schema: JsonSchema, body: unknown): boolean {
    const validator = this.ajv.compile(schema);
    return validator(body);
  }
}

export const ENDPOINT_META_SCHEMA: JsonSchema = {
  type: "object",
  required: ["id", "name", "method", "url", "request", "response"],
  properties: {
    id: { type: "string", pattern: "^[a-z0-9._-]+$" },
    name: { type: "string", minLength: 1 },
    method: { enum: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] },
    url: { type: "string", minLength: 1 },
    auth_strategy: { type: "string" },
    tags: { type: "array", items: { type: "string" } },
    markers: { type: "array", items: { enum: ["smoke", "regression", "e2e"] } },
    prod_safe: { type: "boolean" },
    request: {
      type: "object",
      properties: {
        headers: { type: "object" },
        body_schema: { type: "object" },
        body_example: {},
        query_params: { type: "object" },
      },
    },
    response: {
      type: "object",
      required: ["expected_status", "schema"],
      properties: {
        expected_status: { type: "integer", minimum: 100, maximum: 599 },
        schema: { type: "object" },
        headers: { type: "object" },
        sla_ms: { type: "integer", minimum: 0 },
      },
    },
    db_verify: {
      type: "array",
      items: {
        type: "object",
        required: ["connection", "query", "expect"],
        properties: {
          connection: { type: "string" },
          query: { type: "string" },
          expect: { enum: ["exists", "not_exists", "match", "exact"] },
          fields: { type: "object" },
          query_id: { type: "string" },
        },
      },
    },
    assertions: { type: "array", items: { type: "string" } },
    cleanup: {
      type: "object",
      required: ["connection", "query"],
      properties: {
        connection: { type: "string" },
        query: { type: "string" },
      },
    },
    retry: {
      type: "object",
      properties: {
        count: { type: "integer", minimum: 0, maximum: 5 },
        delay_ms: { type: "integer", minimum: 0 },
        backoff: { enum: ["none", "linear", "exponential"] },
        strict: { type: "boolean" },
      },
    },
    source: {
      type: "object",
      properties: {
        type: { enum: ["postman", "openapi", "native-json"] },
        collection: { type: "string" },
        endpoint_id: { type: "string" },
        spec_url: { type: "string" },
      },
    },
  },
};
```

---

## Internal Structure

### File Organization

```
src/core/
├── canonical-model.ts      # CanonicalEndpoint, CanonicalRequest, etc. (exported)
├── schema-validator.ts     # SchemaValidator class using AJV
└── index.ts               # Re-exports for convenience
```

### Error Handling

**SchemaValidator.validateEndpoint()** returns:
```typescript
{
  valid: true
}
// or
{
  valid: false,
  errors: ["root.request.body_schema type must be object", ...]
}
```

Invalid endpoints fail fast at framework startup with a clear error message listing which files failed validation.

---

## Integration Points

### Consumed By (in Phase 2+)

1. **Importers** (Task #4, #5) — convert Postman/OpenAPI → CanonicalEndpoint[]
2. **Test Plan Generator** (Task #6) — read CanonicalEndpoint, generate test definitions
3. **Assertions Parser** (Task #7) — validate assertion syntax against CanonicalEndpoint schema
4. **Test Runner** (Task #10) — load *.endpoint.json files, validate against meta-schema
5. **All reporters** — display endpoint metadata in reports

### No Dependencies

Task #1 depends on nothing else and can be completed independently.

---

## Edge Cases & Constraints

1. **URL can be template**: `"/api/v1/users/${user_id}"` — not validated here, just stored as string
2. **body_schema is optional**: GET requests typically have no body
3. **auth_strategy is optional**: endpoints without auth don't reference a strategy
4. **Empty markers list is allowed**: endpoint still runs, just not selected by any marker filter
5. **db_verify can be empty array**: write endpoints without DB verification are valid (not recommended but allowed)
6. **assertions must be strings**: parser validates syntax later; here we just store them

---

## Testing Strategy (Preview — implemented in Phase 3)

- Unit tests: SchemaValidator validates a range of valid and invalid endpoint definitions
- Unit tests: Type definitions compile without errors
- Integration tests: Load real .endpoint.json files from examples/, validate each
- Snapshot tests: ENDPOINT_META_SCHEMA structure remains stable across versions

---

## Success Checklist

- [ ] `src/core/canonical-model.ts` exports all 6 interfaces
- [ ] `src/core/schema-validator.ts` implements SchemaValidator with full meta-schema
- [ ] AJV initialized with proper formats (date-time, email, uuid, etc.)
- [ ] TypeScript compiles with no errors (`npm run typecheck`)
- [ ] All types are properly documented with JSDoc comments
- [ ] Meta-schema includes all required and optional fields from spec
- [ ] Validator error messages are clear and actionable

---

## Dependencies & Imports

```typescript
// Imports needed
import Ajv from "ajv";
import addFormats from "ajv-formats";
```

These are already in `package.json` as dependencies.
