import { describe, it, expect } from "vitest";

import type {
  CanonicalEndpoint,
  CanonicalRequest,
  CanonicalResponse,
  CanonicalDbVerification,
  CanonicalRetryPolicy,
} from "../../../src/core/canonical-model.js";

describe("CanonicalEndpoint Type", () => {
  it("should allow a minimal valid endpoint definition", () => {
    const endpoint: CanonicalEndpoint = {
      id: "users.create",
      name: "Create User",
      method: "POST",
      url: "/api/v1/users",
      request: {
        body_schema: {
          type: "object",
          properties: {
            email: { type: "string" },
            name: { type: "string" },
          },
          required: ["email"],
        },
      },
      response: {
        expected_status: 201,
        schema: {
          type: "object",
          properties: {
            id: { type: "string" },
            email: { type: "string" },
          },
        },
      },
    };

    expect(endpoint.id).toBe("users.create");
    expect(endpoint.method).toBe("POST");
    expect(endpoint.response.expected_status).toBe(201);
  });

  it("should allow endpoints with all optional fields", () => {
    const endpoint: CanonicalEndpoint = {
      id: "users.create",
      name: "Create User",
      method: "POST",
      url: "/api/v1/users",
      auth_strategy: "user_token",
      tags: ["billing", "critical"],
      markers: ["smoke", "regression"],
      prod_safe: true,
      request: {
        headers: { "Content-Type": "application/json" },
        body_schema: { type: "object" },
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
          query: "SELECT * FROM users WHERE email = $1",
          expect: "match",
          fields: { email: "test@example.com" },
          query_id: "verify_user_created",
        },
      ],
      assertions: [
        "response.body.id is_uuid_v4",
        "response.body.email equals request.body.email",
      ],
      cleanup: {
        connection: "primary_postgres",
        query: "DELETE FROM users WHERE email = $1",
      },
      retry: {
        count: 2,
        delay_ms: 1000,
        backoff: "linear",
        strict: false,
      },
      source: {
        type: "postman",
        collection: "users.postman_collection.json",
        endpoint_id: "abc123",
      },
    };

    expect(endpoint.auth_strategy).toBe("user_token");
    expect(endpoint.tags).toContain("billing");
    expect(endpoint.markers).toContain("smoke");
    expect(endpoint.db_verify?.[0].query_id).toBe("verify_user_created");
    expect(endpoint.cleanup?.query).toContain("DELETE");
  });

  it("should allow GET requests without body_schema", () => {
    const endpoint: CanonicalEndpoint = {
      id: "users.list",
      name: "List Users",
      method: "GET",
      url: "/api/v1/users",
      request: {},
      response: {
        expected_status: 200,
        schema: {
          type: "object",
          properties: {
            users: { type: "array" },
          },
        },
      },
    };

    expect(endpoint.request.body_schema).toBeUndefined();
    expect(endpoint.method).toBe("GET");
  });

  it("should allow endpoints without auth_strategy", () => {
    const endpoint: CanonicalEndpoint = {
      id: "health.check",
      name: "Health Check",
      method: "GET",
      url: "/health",
      request: {},
      response: {
        expected_status: 200,
        schema: { type: "object" },
      },
    };

    expect(endpoint.auth_strategy).toBeUndefined();
  });

  it("should allow all HTTP methods", () => {
    const methods = [
      "GET",
      "POST",
      "PUT",
      "PATCH",
      "DELETE",
      "HEAD",
      "OPTIONS",
    ] as const;

    methods.forEach((method) => {
      const endpoint: CanonicalEndpoint = {
        id: `test.${method.toLowerCase()}`,
        name: `Test ${method}`,
        method,
        url: "/test",
        request: {},
        response: {
          expected_status: 200,
          schema: { type: "object" },
        },
      };

      expect(endpoint.method).toBe(method);
    });
  });

  it("should allow all db_verify expect modes", () => {
    const expectModes = ["exists", "not_exists", "match", "exact"] as const;

    expectModes.forEach((mode) => {
      const verification: CanonicalDbVerification = {
        connection: "primary",
        query: "SELECT * FROM users",
        expect: mode,
      };

      expect(verification.expect).toBe(mode);
    });
  });

  it("should allow all retry backoff strategies", () => {
    const strategies = ["none", "linear", "exponential"] as const;

    strategies.forEach((strategy) => {
      const policy: CanonicalRetryPolicy = {
        count: 3,
        delay_ms: 100,
        backoff: strategy,
      };

      expect(policy.backoff).toBe(strategy);
    });
  });

  it("should support template variables in URLs", () => {
    const endpoint: CanonicalEndpoint = {
      id: "users.get",
      name: "Get User",
      method: "GET",
      url: "/api/v1/users/${user_id}",
      request: {},
      response: {
        expected_status: 200,
        schema: { type: "object" },
      },
    };

    expect(endpoint.url).toContain("${user_id}");
  });

  it("should support template variables in queries", () => {
    const endpoint: CanonicalEndpoint = {
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
      db_verify: [
        {
          connection: "primary",
          query: "SELECT * FROM users WHERE email = '${request.body.email}'",
          expect: "match",
        },
      ],
    };

    expect(endpoint.db_verify?.[0].query).toContain("${request.body.email}");
  });

  it("should allow markers array to include all marker types", () => {
    const endpoint: CanonicalEndpoint = {
      id: "test.endpoint",
      name: "Test",
      method: "GET",
      url: "/test",
      request: {},
      response: { expected_status: 200, schema: { type: "object" } },
      markers: ["smoke", "regression", "e2e"],
    };

    expect(endpoint.markers).toContain("smoke");
    expect(endpoint.markers).toContain("regression");
    expect(endpoint.markers).toContain("e2e");
  });
});

describe("CanonicalRequest Type", () => {
  it("should allow empty request object", () => {
    const request: CanonicalRequest = {};
    expect(request).toEqual({});
  });

  it("should allow request with all properties", () => {
    const request: CanonicalRequest = {
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer token",
      },
      body_schema: {
        type: "object",
        properties: { name: { type: "string" } },
      },
      body_example: { name: "John" },
      query_params: {
        limit: { type: "integer" },
        offset: { type: "integer" },
      },
    };

    expect(request.headers).toBeDefined();
    expect(request.body_schema).toBeDefined();
    expect(request.body_example).toBeDefined();
    expect(request.query_params).toBeDefined();
  });
});

describe("CanonicalResponse Type", () => {
  it("should require expected_status and schema", () => {
    const response: CanonicalResponse = {
      expected_status: 200,
      schema: { type: "object" },
    };

    expect(response.expected_status).toBe(200);
    expect(response.schema).toBeDefined();
  });

  it("should allow optional headers and sla_ms", () => {
    const response: CanonicalResponse = {
      expected_status: 201,
      schema: { type: "object" },
      headers: { "Content-Type": "application/json" },
      sla_ms: 1000,
    };

    expect(response.headers).toBeDefined();
    expect(response.sla_ms).toBe(1000);
  });

  it("should support status codes from 100 to 599", () => {
    const validCodes = [
      100, 200, 201, 204, 301, 400, 401, 403, 404, 500, 502, 599,
    ];

    validCodes.forEach((code) => {
      const response: CanonicalResponse = {
        expected_status: code,
        schema: { type: "object" },
      };
      expect(response.expected_status).toBe(code);
    });
  });
});
