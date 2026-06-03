import { createRequire } from "node:module";

import type { JsonSchema } from "./canonical-model.js";

// AJV / ajv-formats / ajv-errors are CommonJS modules without clean ESM
// type exports. Use `createRequire` (the portable Node 22+ pattern that
// works in both Node 22's permissive ESM and Node 26's strict ESM mode)
// instead of a bare `require()` which is undefined under Node 26 ESM.
// Mirrors the pattern used in `src/cli/entry.ts`.
 
const requireCjs = createRequire(import.meta.url);
 
const Ajv = requireCjs("ajv") as {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  new (options: Record<string, unknown>): any;
};
 
const addFormats = requireCjs("ajv-formats") as (ajv: unknown) => void;
// ajv-errors activates the `errorMessage` keyword used throughout the
// meta-schema; without it AJV silently ignores those annotations.
 
const ajvErrors = requireCjs("ajv-errors") as (ajv: unknown) => void;

type AjvError = { instancePath?: string; message?: string };

interface AjvValidator {
  (data: unknown): boolean;
  errors?: AjvError[];
}

/**
 * Formats raw AJV validation errors into human-readable "<path> <message>" strings.
 * @param errors - The AJV error array, or undefined when the validator produced none.
 * @returns Formatted error strings; an empty array when there are no errors.
 */
export function formatAjvErrors(errors: AjvError[] | undefined): string[] {
  return (errors ?? []).map((err) => {
    const path = err.instancePath || "root";
    return `${path} ${err.message}`;
  });
}

/**
 * Validates endpoint definitions and request/response bodies against JSON schemas.
 * Uses AJV for fast, standards-compliant validation.
 */
export class SchemaValidator {
  private readonly ajv: unknown;

  private readonly endpointValidator: AjvValidator;

  /**
   * Initializes the validator with AJV and compiles the endpoint meta-schema.
   */
  constructor() {
    this.ajv = new Ajv({ strict: false, allErrors: true });
    addFormats(this.ajv);
    ajvErrors(this.ajv);
    const ajvInstance = this.ajv as {
      compile: (schema: JsonSchema) => AjvValidator;
    };
    this.endpointValidator = ajvInstance.compile(ENDPOINT_META_SCHEMA);
  }

  /**
   * Validates an endpoint definition against the canonical meta-schema.
   * @param endpoint - The endpoint object to validate.
   * @returns Result object with valid flag and optional error messages.
   */
  validateEndpoint(endpoint: unknown): {
    valid: boolean;
    errors?: string[];
  } {
    const valid = this.endpointValidator(endpoint);
    if (valid) {
      return { valid: true };
    }

    return {
      valid: false,
      errors: formatAjvErrors(this.endpointValidator.errors),
    };
  }

  /**
   * Validates a request body against a JSON schema.
   * @param schema - The JSON schema to validate against.
   * @param body - The request body to validate.
   * @returns True if valid, false otherwise.
   */
  validateRequestBody(schema: JsonSchema, body: unknown): boolean {
    const ajvInstance = this.ajv as {
      compile: (schema: JsonSchema) => AjvValidator;
    };
    const validator = ajvInstance.compile(schema);
    return validator(body);
  }

  /**
   * Validates a response body against a JSON schema.
   * @param schema - The JSON schema to validate against.
   * @param body - The response body to validate.
   * @returns True if valid, false otherwise.
   */
  validateResponseBody(schema: JsonSchema, body: unknown): boolean {
    const ajvInstance = this.ajv as {
      compile: (schema: JsonSchema) => AjvValidator;
    };
    const validator = ajvInstance.compile(schema);
    return validator(body);
  }
}

/**
 * Meta-schema for CanonicalEndpoint. Defines the shape and constraints
 * that all endpoint definitions must satisfy.
 */
export const ENDPOINT_META_SCHEMA: JsonSchema = {
  type: "object",
  required: ["id", "name", "method", "url", "request", "response"],
  properties: {
    id: {
      type: "string",
      pattern: "^[a-z0-9._-]+$",
      errorMessage:
        "id must be lowercase alphanumeric with dots, underscores, or dashes",
    },
    name: {
      type: "string",
      minLength: 1,
      errorMessage: "name must be a non-empty string",
    },
    method: {
      enum: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"],
      errorMessage: "method must be a valid HTTP method",
    },
    url: {
      type: "string",
      minLength: 1,
      errorMessage: "url must be a non-empty string",
    },
    auth_strategy: {
      type: "string",
      errorMessage: "auth_strategy must be a string",
    },
    tags: {
      type: "array",
      items: {
        type: "string",
      },
      errorMessage: "tags must be an array of strings",
    },
    markers: {
      type: "array",
      items: {
        enum: ["smoke", "regression", "e2e"],
      },
      errorMessage: "markers must be an array of valid test markers",
    },
    prod_safe: {
      type: "boolean",
      errorMessage: "prod_safe must be a boolean",
    },
    request: {
      type: "object",
      properties: {
        headers: {
          type: "object",
          errorMessage: "request.headers must be an object",
        },
        body_schema: {
          type: "object",
          errorMessage: "request.body_schema must be an object (JSON Schema)",
        },
        body_example: {
          errorMessage: "request.body_example can be any JSON value",
        },
        query_params: {
          type: "object",
          errorMessage: "request.query_params must be an object",
        },
      },
      errorMessage: { type: "request must be an object" },
    },
    response: {
      type: "object",
      required: ["expected_status"],
      properties: {
        expected_status: {
          type: "integer",
          minimum: 100,
          maximum: 599,
          errorMessage:
            "response.expected_status must be an HTTP status code (100-599)",
        },
        schema: {
          type: "object",
          errorMessage: "response.schema must be an object (JSON Schema)",
        },
        headers: {
          type: "object",
          errorMessage: "response.headers must be an object",
        },
        sla_ms: {
          type: "integer",
          minimum: 0,
          errorMessage: "response.sla_ms must be a non-negative integer",
        },
      },
      errorMessage: {
        type: "response must be an object with expected_status and schema",
        required:
          "response must be an object with expected_status and schema",
      },
    },
    db_verify: {
      type: "array",
      items: {
        type: "object",
        required: ["connection", "query", "expect"],
        properties: {
          connection: {
            type: "string",
            errorMessage: "db_verify[].connection must be a string",
          },
          query: {
            type: "string",
            errorMessage: "db_verify[].query must be a string",
          },
          expect: {
            enum: ["exists", "not_exists", "match", "exact"],
            errorMessage: "db_verify[].expect must be a valid expectation mode",
          },
          fields: {
            type: "object",
            errorMessage: "db_verify[].fields must be an object",
          },
          query_id: {
            type: "string",
            errorMessage: "db_verify[].query_id must be a string",
          },
        },
        errorMessage: {
          type: "db_verify[] must be an object",
          required:
            "db_verify items must have connection, query, and expect",
        },
      },
      errorMessage: { type: "db_verify must be an array" },
    },
    skip_cases: {
      type: "array",
      items: {
        type: "string",
        minLength: 1,
      },
      errorMessage: "skip_cases must be an array of non-empty strings",
    },
    assertions: {
      type: "array",
      items: {
        type: "string",
      },
      errorMessage: "assertions must be an array of strings",
    },
    cleanup: {
      type: "object",
      required: ["connection", "query"],
      properties: {
        connection: {
          type: "string",
          errorMessage: "cleanup.connection must be a string",
        },
        query: {
          type: "string",
          errorMessage: "cleanup.query must be a string",
        },
      },
      errorMessage: {
        type: "cleanup must be an object",
        required: "cleanup must have connection and query",
      },
    },
    retry: {
      type: "object",
      properties: {
        count: {
          type: "integer",
          minimum: 0,
          maximum: 5,
          errorMessage: "retry.count must be 0-5",
        },
        delay_ms: {
          type: "integer",
          minimum: 0,
          errorMessage: "retry.delay_ms must be non-negative",
        },
        backoff: {
          enum: ["none", "linear", "exponential"],
          errorMessage: "retry.backoff must be a valid backoff strategy",
        },
        strict: {
          type: "boolean",
          errorMessage: "retry.strict must be a boolean",
        },
      },
      errorMessage: { type: "retry must be an object" },
    },
    pair_with: {
      type: "string",
      pattern: "^[a-z0-9._-]+$",
      errorMessage:
        "pair_with must be an endpoint id matching [a-z0-9._-]+",
    },
    etag_supported: {
      type: "boolean",
      errorMessage: "etag_supported must be a boolean",
    },
    pagination: {
      type: "object",
      required: ["style", "size_param", "default_size", "max_size"],
      properties: {
        style: {
          enum: ["page", "offset", "cursor"],
          errorMessage: "pagination.style must be one of: page, offset, cursor",
        },
        size_param: {
          type: "string",
          minLength: 1,
          errorMessage: "pagination.size_param must be a non-empty string",
        },
        page_param: {
          type: "string",
          minLength: 1,
          errorMessage: "pagination.page_param must be a non-empty string",
        },
        default_size: {
          type: "integer",
          minimum: 1,
          errorMessage: "pagination.default_size must be an integer >= 1",
        },
        max_size: {
          type: "integer",
          minimum: 1,
          errorMessage: "pagination.max_size must be an integer >= 1",
        },
      },
      additionalProperties: false,
      errorMessage: {
        type: "pagination must be an object",
        required: "pagination must have style, size_param, default_size, max_size",
        additionalProperties: "unknown property in pagination config",
      },
    },
    cors: {
      type: "object",
      required: ["allow_origins", "allow_methods", "allow_headers"],
      properties: {
        allow_origins: {
          type: "array",
          items: { type: "string" },
          errorMessage: "cors.allow_origins must be an array of strings",
        },
        allow_methods: {
          type: "array",
          items: { type: "string" },
          errorMessage: "cors.allow_methods must be an array of strings",
        },
        allow_headers: {
          type: "array",
          items: { type: "string" },
          errorMessage: "cors.allow_headers must be an array of strings",
        },
      },
      additionalProperties: false,
      errorMessage: {
        type: "cors must be an object",
        required: "cors must have allow_origins, allow_methods, and allow_headers",
        additionalProperties: "unknown property in cors config",
      },
    },
    source: {
      type: "object",
      properties: {
        type: {
          enum: ["postman", "openapi", "native-json"],
          errorMessage: "source.type must be a valid source type",
        },
        collection: {
          type: "string",
          errorMessage: "source.collection must be a string",
        },
        endpoint_id: {
          type: "string",
          errorMessage: "source.endpoint_id must be a string",
        },
        spec_url: {
          type: "string",
          errorMessage: "source.spec_url must be a string",
        },
      },
      errorMessage: { type: "source must be an object" },
    },
  },
  additionalProperties: false,
  errorMessage: { additionalProperties: "unknown property in endpoint definition" },
};
