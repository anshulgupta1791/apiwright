import { createRequire } from "node:module";

import type { EnvValidationResult } from "./types.js";

// AJV / ajv-formats / ajv-errors are CommonJS modules without clean ESM
// type exports. Use `createRequire` (the portable Node 22+ pattern) so
// the module loads under Node 26's strict ESM scope, not just Node 22's
// permissive shim.
// eslint-disable-next-line @typescript-eslint/no-require-imports, no-restricted-syntax
const requireCjs = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports, no-restricted-syntax
const Ajv = requireCjs("ajv") as {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  new (options: Record<string, unknown>): any;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports, no-restricted-syntax
const addFormats = requireCjs("ajv-formats") as (ajv: unknown) => void;
// ajv-errors activates the `errorMessage` keyword used in ENVIRONMENT_SCHEMA;
// without it AJV silently ignores those field-named messages.
// eslint-disable-next-line @typescript-eslint/no-require-imports, no-restricted-syntax
const ajvErrors = requireCjs("ajv-errors") as (ajv: unknown) => void;

/** Local JSON Schema alias (avoids env→core module coupling). */
type JsonSchema = Record<string, unknown>;

type AjvError = { instancePath?: string; message?: string };

interface AjvValidator {
  (data: unknown): boolean;
  errors?: AjvError[];
}

/**
 * Formats raw AJV validation errors into human-readable "<path> <message>"
 * strings naming the offending field.
 * @param errors - The AJV error array, or undefined when none were produced.
 * @returns Formatted error strings; empty array when there are no errors.
 */
export function formatEnvErrors(errors: AjvError[] | undefined): string[] {
  return (errors ?? []).map((err) => {
    const path = err.instancePath || "root";
    return `${path} ${err.message ?? "is invalid"}`;
  });
}

/**
 * JSON Schema describing the structure of an environment file. Unresolved
 * ${secret.*}/${env.*} strings are plain strings at validate time and are
 * intentionally accepted. Database/auth-strategy entries keep
 * additionalProperties open because secret/template values are not yet
 * resolved when validation runs.
 */
export const ENVIRONMENT_SCHEMA: JsonSchema = {
  type: "object",
  required: ["name", "base_url", "prod"],
  properties: {
    name: {
      type: "string",
      minLength: 1,
      errorMessage: "name must be a non-empty string",
    },
    prod: {
      type: "boolean",
      errorMessage: "prod must be a boolean (true or false)",
    },
    base_url: {
      type: "string",
      minLength: 1,
      errorMessage: "base_url must be a non-empty string",
    },
    default_sla_ms: {
      type: "integer",
      minimum: 0,
      errorMessage: "default_sla_ms must be a non-negative integer",
    },
    databases: {
      type: "object",
      additionalProperties: {
        type: "object",
        required: ["type"],
        properties: {
          type: {
            enum: ["postgres", "mysql", "mongodb", "neo4j"],
            errorMessage:
              "database type must be one of postgres, mysql, mongodb, neo4j",
          },
        },
        additionalProperties: true,
        errorMessage: "each database entry must declare a valid type",
      },
      errorMessage: "databases must be an object of named connections",
    },
    auth_strategies: {
      type: "object",
      additionalProperties: {
        type: "object",
        required: ["type"],
        properties: {
          type: {
            enum: ["static_token", "token_endpoint"],
            errorMessage:
              "auth strategy type must be one of static_token, token_endpoint",
          },
        },
        additionalProperties: true,
        errorMessage: "each auth strategy must declare a valid type",
      },
      errorMessage: "auth_strategies must be an object of named strategies",
    },
  },
  additionalProperties: true,
  errorMessage: "environment must be an object with name, base_url, and prod",
};

/**
 * Validates parsed environment config objects against ENVIRONMENT_SCHEMA.
 * Follows the AJV setup convention of src/core/schema-validator.ts.
 */
export class EnvironmentSchemaValidator {
  private readonly validator: AjvValidator;

  /**
   * Initializes AJV and compiles the environment schema once.
   */
  constructor() {
    const ajv = new Ajv({ strict: false, allErrors: true }) as {
      compile: (schema: JsonSchema) => AjvValidator;
    };
    addFormats(ajv);
    ajvErrors(ajv);
    this.validator = ajv.compile(ENVIRONMENT_SCHEMA);
  }

  /**
   * Validates a parsed environment object. Never throws for user-config
   * problems; returns aggregated, human-readable errors instead.
   * @param env - The parsed environment object to validate.
   * @returns Result with a valid flag and optional error messages.
   */
  validate(env: unknown): EnvValidationResult {
    const valid = this.validator(env);
    if (valid) {
      return { valid: true };
    }
    return {
      valid: false,
      errors: formatEnvErrors(this.validator.errors),
    };
  }
}
