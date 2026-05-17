/**
 * JSON Schema validator for apiwright.config.json.
 *
 * Uses AJV (via require()) with errorMessage annotations — the same pattern
 * as src/core/schema-validator.ts and src/env/schema.ts. Partial-tolerant:
 * all fields optional (missing keys are filled by the loader with defaults).
 */

// AJV is a CommonJS module that doesn't export ESM types well; require() is necessary here
// eslint-disable-next-line @typescript-eslint/no-require-imports, no-restricted-syntax
const Ajv = require("ajv") as {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  new (options: Record<string, unknown>): any;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports, no-restricted-syntax
const addFormats = require("ajv-formats") as (ajv: unknown) => void;
// ajv-errors activates the `errorMessage` keyword used in APIWRIGHT_CONFIG_SCHEMA;
// without it AJV silently ignores those field-named messages.
// eslint-disable-next-line @typescript-eslint/no-require-imports, no-restricted-syntax
const ajvErrors = require("ajv-errors") as (ajv: unknown) => void;

/** Raw AJV error shape. */
type AjvError = {
  instancePath?: string;
  message?: string;
};

/** AJV compiled validator function type. */
interface AjvValidator {
  (data: unknown): boolean;
  errors?: AjvError[];
}

/**
 * Discriminated result from {@link ApiwrightConfigSchemaValidator.validate}.
 * Mirrors the `EnvironmentLoadResult` / `validateEndpoint` result shapes in
 * src/core and src/env for consistency.
 */
export interface ConfigValidationResult {
  /** True when the config passed schema validation. */
  valid: boolean;
  /** Aggregated "<path> <message>" strings; present only when invalid. */
  errors?: string[];
}

/**
 * Formats raw AJV validation errors into human-readable "<path> <message>"
 * strings. Uses "root" when instancePath is absent or empty — identical to
 * {@link formatAjvErrors} in src/core/schema-validator.ts. Curated messages,
 * including the unknown-property text, come from the schema's `errorMessage`
 * annotations via ajv-errors.
 * @param errors - The AJV error array, or undefined when none.
 * @returns Formatted error strings; an empty array when there are no errors.
 */
export function formatConfigErrors(
  errors: Array<{ instancePath?: string; message?: string }> | undefined,
): string[] {
  return (errors ?? []).map((err) => {
    const path = err.instancePath || "root";
    return `${path} ${err.message}`;
  });
}

/**
 * JSON Schema for apiwright.config.json.
 *
 * Partial-tolerant: top-level required: [], every property optional.
 * Validates shape and enum/type correctness of whatever is present;
 * completeness is enforced by the loader (which fills defaults).
 * additionalProperties: false at top level and within retry/report.
 */
export const APIWRIGHT_CONFIG_SCHEMA: Record<string, unknown> = {
  type: "object",
  required: [],
  additionalProperties: false,
  errorMessage: "unknown property in apiwright.config.json",
  properties: {
    tests_dir: {
      type: "string",
      minLength: 1,
      errorMessage: "tests_dir must be a non-empty string",
    },
    environments_dir: {
      type: "string",
      minLength: 1,
      errorMessage: "environments_dir must be a non-empty string",
    },
    reports_dir: {
      type: "string",
      minLength: 1,
      errorMessage: "reports_dir must be a non-empty string",
    },
    default_env: {
      type: "string",
      minLength: 1,
      errorMessage: "default_env must be a non-empty string",
    },
    default_markers: {
      type: "array",
      items: {
        enum: ["smoke", "regression", "e2e"],
        errorMessage:
          "default_markers must be an array of smoke, regression, or e2e",
      },
      errorMessage:
        "default_markers must be an array of smoke, regression, or e2e",
    },
    log_level: {
      enum: ["error", "warn", "info", "debug"],
      errorMessage: "log_level must be one of error, warn, info, debug",
    },
    workers: {
      type: "integer",
      minimum: 1,
      errorMessage: "workers must be a positive integer",
    },
    retry: {
      type: "object",
      additionalProperties: false,
      errorMessage: "unknown property in apiwright.config.json",
      properties: {
        count: {
          type: "integer",
          minimum: 0,
          maximum: 5,
          errorMessage: "retry.count must be an integer 0-5",
        },
        delay_ms: {
          type: "integer",
          minimum: 0,
          errorMessage: "retry.delay_ms must be a non-negative integer",
        },
        backoff: {
          enum: ["none", "linear", "exponential"],
          errorMessage:
            "retry.backoff must be one of none, linear, exponential",
        },
        strict: {
          type: "boolean",
          errorMessage: "retry.strict must be a boolean",
        },
      },
    },
    report: {
      type: "object",
      additionalProperties: false,
      errorMessage: "unknown property in apiwright.config.json",
      properties: {
        html: {
          type: "boolean",
          errorMessage: "report.html must be a boolean",
        },
        json: {
          type: "boolean",
          errorMessage: "report.json must be a boolean",
        },
        junit_xml: {
          type: "boolean",
          errorMessage: "report.junit_xml must be a boolean",
        },
        output_dir: {
          type: "string",
          minLength: 1,
          errorMessage: "report.output_dir must be a non-empty string",
        },
      },
    },
  },
};

/**
 * Validates a parsed config object against the APIWright config JSON Schema.
 *
 * Constructed once; the AJV schema is compiled in the constructor. Reuses
 * the AJV-via-require + errorMessage convention from src/core/schema-validator.ts.
 */
export class ApiwrightConfigSchemaValidator {
  readonly #compiledValidator: AjvValidator;

  /**
   * Initializes AJV with strict:false, allErrors:true, and compiles the config
   * schema. Mirrors the SchemaValidator constructor pattern in src/core.
   */
  constructor() {
    const ajv = new Ajv({ strict: false, allErrors: true }) as {
      compile: (s: unknown) => AjvValidator;
    };
    addFormats(ajv);
    ajvErrors(ajv);
    this.#compiledValidator = ajv.compile(APIWRIGHT_CONFIG_SCHEMA);
  }

  /**
   * Validates a parsed config value against the APIWright config schema.
   * @param config - The parsed value to validate (any unknown shape).
   * @returns `{ valid: true }` when valid; `{ valid: false, errors }` otherwise.
   */
  validate(config: unknown): ConfigValidationResult {
    const valid = this.#compiledValidator(config);
    if (valid) {
      return { valid: true };
    }
    return {
      valid: false,
      errors: formatConfigErrors(this.#compiledValidator.errors),
    };
  }
}
