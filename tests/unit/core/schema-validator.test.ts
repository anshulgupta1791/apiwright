import { describe, it, expect, beforeEach } from "vitest";

import type { CanonicalEndpoint } from "../../../src/core/canonical-model.js";
import {
  SchemaValidator,
  formatAjvErrors,
} from "../../../src/core/schema-validator.js";

describe("SchemaValidator.validateEndpoint()", () => {
  let validator: SchemaValidator;

  beforeEach(() => {
    validator = new SchemaValidator();
  });

  it("should accept a valid minimal endpoint", () => {
    const endpoint = {
      id: "users.create",
      name: "Create User",
      method: "POST",
      url: "/api/v1/users",
      request: {
        body_schema: { type: "object" },
      },
      response: {
        expected_status: 201,
        schema: { type: "object" },
      },
    };

    const result = validator.validateEndpoint(endpoint);
    expect(result.valid).toBe(true);
    expect(result.errors).toBeUndefined();
  });

  it("should accept a valid endpoint with all fields", () => {
    const endpoint: CanonicalEndpoint = {
      id: "users.create",
      name: "Create User",
      method: "POST",
      url: "/api/v1/users",
      auth_strategy: "user_token",
      tags: ["billing"],
      markers: ["smoke", "regression"],
      prod_safe: true,
      request: {
        headers: { "Content-Type": "application/json" },
        body_schema: {
          type: "object",
          properties: { email: { type: "string" } },
        },
        body_example: { email: "test@example.com" },
        query_params: { filter: { type: "string" } },
      },
      response: {
        expected_status: 201,
        schema: { type: "object" },
        headers: { "Content-Type": "application/json" },
        sla_ms: 500,
      },
      db_verify: [
        {
          connection: "primary_postgres",
          query: "SELECT * FROM users",
          expect: "match",
          fields: { email: "test@example.com" },
          query_id: "verify_user",
        },
      ],
      assertions: ["response.body.id is_uuid_v4"],
      cleanup: {
        connection: "primary_postgres",
        query: "DELETE FROM users",
      },
      retry: {
        count: 2,
        delay_ms: 1000,
        backoff: "linear",
        strict: false,
      },
      source: {
        type: "postman",
        collection: "users.json",
        endpoint_id: "abc123",
      },
    };

    const result = validator.validateEndpoint(endpoint);
    expect(result.valid).toBe(true);
  });

  it("should reject endpoint missing required 'id'", () => {
    const endpoint = {
      name: "Create User",
      method: "POST",
      url: "/api/v1/users",
      request: {},
      response: { expected_status: 201, schema: {} },
    };

    const result = validator.validateEndpoint(endpoint);
    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors?.some((e) => e.includes("id"))).toBe(true);
  });

  it("should reject endpoint missing required 'method'", () => {
    const endpoint = {
      id: "test.endpoint",
      name: "Test",
      url: "/test",
      request: {},
      response: { expected_status: 200, schema: {} },
    };

    const result = validator.validateEndpoint(endpoint);
    expect(result.valid).toBe(false);
    expect(result.errors?.some((e) => e.includes("method"))).toBe(true);
  });

  it("should reject endpoint missing required 'response'", () => {
    const endpoint = {
      id: "test.endpoint",
      name: "Test",
      method: "GET",
      url: "/test",
      request: {},
    };

    const result = validator.validateEndpoint(endpoint);
    expect(result.valid).toBe(false);
    expect(result.errors?.some((e) => e.includes("response"))).toBe(true);
  });

  it("should reject endpoint with invalid HTTP method", () => {
    const endpoint = {
      id: "test.endpoint",
      name: "Test",
      method: "INVALID",
      url: "/test",
      request: {},
      response: { expected_status: 200, schema: {} },
    };

    const result = validator.validateEndpoint(endpoint);
    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
  });

  it("should reject endpoint with invalid id format", () => {
    const endpoint = {
      id: "INVALID@#$",
      name: "Test",
      method: "GET",
      url: "/test",
      request: {},
      response: { expected_status: 200, schema: {} },
    };

    const result = validator.validateEndpoint(endpoint);
    expect(result.valid).toBe(false);
  });

  it("should reject endpoint with invalid status code", () => {
    const endpoint = {
      id: "test.endpoint",
      name: "Test",
      method: "GET",
      url: "/test",
      request: {},
      response: { expected_status: 999, schema: {} },
    };

    const result = validator.validateEndpoint(endpoint);
    expect(result.valid).toBe(false);
  });

  it("should reject db_verify with invalid expect mode", () => {
    const endpoint = {
      id: "test.endpoint",
      name: "Test",
      method: "POST",
      url: "/test",
      request: {},
      response: { expected_status: 201, schema: {} },
      db_verify: [
        {
          connection: "primary",
          query: "SELECT * FROM users",
          expect: "invalid_mode",
        },
      ],
    };

    const result = validator.validateEndpoint(endpoint);
    expect(result.valid).toBe(false);
  });

  it("should reject invalid marker", () => {
    const endpoint = {
      id: "test.endpoint",
      name: "Test",
      method: "GET",
      url: "/test",
      request: {},
      response: { expected_status: 200, schema: {} },
      markers: ["smoke", "invalid_marker"],
    };

    const result = validator.validateEndpoint(endpoint);
    expect(result.valid).toBe(false);
  });

  it("should reject invalid backoff strategy in retry", () => {
    const endpoint = {
      id: "test.endpoint",
      name: "Test",
      method: "GET",
      url: "/test",
      request: {},
      response: { expected_status: 200, schema: {} },
      retry: {
        count: 2,
        delay_ms: 100,
        backoff: "invalid",
      },
    };

    const result = validator.validateEndpoint(endpoint);
    expect(result.valid).toBe(false);
  });

  it("should provide clear error messages", () => {
    const endpoint = {
      id: "",
      name: "Test",
      method: "GET",
      url: "/test",
      request: {},
      response: { expected_status: 200, schema: {} },
    };

    const result = validator.validateEndpoint(endpoint);
    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors?.[0]).toMatch(/id|minLength/i);
  });
});

describe("SchemaValidator.validateRequestBody()", () => {
  let validator: SchemaValidator;

  beforeEach(() => {
    validator = new SchemaValidator();
  });

  it("should accept valid request body against schema", () => {
    const schema = {
      type: "object",
      properties: {
        email: { type: "string" },
        name: { type: "string" },
      },
      required: ["email"],
    };

    const body = {
      email: "test@example.com",
      name: "John",
    };

    const result = validator.validateRequestBody(schema, body);
    expect(result).toBe(true);
  });

  it("should reject request body missing required field", () => {
    const schema = {
      type: "object",
      properties: {
        email: { type: "string" },
      },
      required: ["email"],
    };

    const body = { name: "John" };

    const result = validator.validateRequestBody(schema, body);
    expect(result).toBe(false);
  });

  it("should reject request body with wrong type", () => {
    const schema = {
      type: "object",
      properties: {
        age: { type: "integer" },
      },
    };

    const body = { age: "not a number" };

    const result = validator.validateRequestBody(schema, body);
    expect(result).toBe(false);
  });

  it("should accept request body with additional properties allowed by schema", () => {
    const schema = {
      type: "object",
      properties: {
        name: { type: "string" },
      },
    };

    const body = {
      name: "John",
      extra: "field",
    };

    const result = validator.validateRequestBody(schema, body);
    expect(result).toBe(true);
  });
});

describe("SchemaValidator.validateResponseBody()", () => {
  let validator: SchemaValidator;

  beforeEach(() => {
    validator = new SchemaValidator();
  });

  it("should accept valid response body against schema", () => {
    const schema = {
      type: "object",
      properties: {
        id: { type: "string" },
        email: { type: "string" },
      },
      required: ["id", "email"],
    };

    const body = {
      id: "123",
      email: "test@example.com",
    };

    const result = validator.validateResponseBody(schema, body);
    expect(result).toBe(true);
  });

  it("should reject response body missing required field", () => {
    const schema = {
      type: "object",
      properties: {
        id: { type: "string" },
      },
      required: ["id"],
    };

    const body = { email: "test@example.com" };

    const result = validator.validateResponseBody(schema, body);
    expect(result).toBe(false);
  });

  it("should handle complex nested schemas", () => {
    const schema = {
      type: "object",
      properties: {
        user: {
          type: "object",
          properties: {
            name: { type: "string" },
            email: { type: "string" },
          },
          required: ["name"],
        },
      },
      required: ["user"],
    };

    const validBody = {
      user: {
        name: "John",
        email: "john@example.com",
      },
    };

    const invalidBody = {
      user: {
        email: "john@example.com",
      },
    };

    expect(validator.validateResponseBody(schema, validBody)).toBe(true);
    expect(validator.validateResponseBody(schema, invalidBody)).toBe(false);
  });
});

describe("formatAjvErrors()", () => {
  it("returns an empty array when errors is undefined", () => {
    expect(formatAjvErrors(undefined)).toEqual([]);
  });

  it("returns an empty array when errors is an empty array", () => {
    expect(formatAjvErrors([])).toEqual([]);
  });

  it("formats an error with an instance path", () => {
    expect(
      formatAjvErrors([
        {
          instancePath: "/response/expected_status",
          message: "must be >= 100",
        },
      ]),
    ).toEqual(["/response/expected_status must be >= 100"]);
  });

  it("uses 'root' when instancePath is empty or missing", () => {
    expect(
      formatAjvErrors([
        { instancePath: "", message: "must have required property 'id'" },
        { message: "must be object" },
      ]),
    ).toEqual(["root must have required property 'id'", "root must be object"]);
  });
});
