/**
 * Unit tests for SchemaValidator — response_variants meta-schema validation
 * and the new validateBodyAgainstSchema method.
 *
 * Design decisions pinned:
 *   DD-2  Variant keys MUST match /^[1-5]\d{2}$/ (exact decimal-string status).
 *   DD-9  validateEndpoint catches malformed response_variants at load time.
 *   DD-10 schema is REQUIRED inside each variant value (v1.0.2).
 *
 * Covers §6.1 items 1-16 (meta-schema) + §6.2 items 17-23 (validateBodyAgainstSchema).
 *
 * Category: Unit.
 * Expected initial failure: response_variants block absent from ENDPOINT_META_SCHEMA;
 *   validateBodyAgainstSchema not yet defined on SchemaValidator.
 */

import { describe, it, expect, beforeEach } from "vitest";

import { SchemaValidator } from "../../../src/core/schema-validator.js";

// ---------------------------------------------------------------------------
// Minimal valid endpoint base (shared across tests)
// ---------------------------------------------------------------------------

function baseEndpoint(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "users.create",
    name: "Create User",
    method: "POST",
    url: "/api/v1/users",
    request: {},
    response: { expected_status: 201, schema: { type: "object" } },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// §6.1 Meta-schema validation for response_variants
// ---------------------------------------------------------------------------

describe("SchemaValidator.validateEndpoint() — response_variants meta-schema", () => {
  let validator: SchemaValidator;

  beforeEach(() => {
    validator = new SchemaValidator();
  });

  /**
   * Item 1: response_variants with a single valid 400 key → valid.
   */
  it("accepts response_variants with shape { '400': { schema: {} } }", () => {
    const ep = baseEndpoint({
      response_variants: { "400": { schema: {} } },
    });
    const result = validator.validateEndpoint(ep);
    expect(result.valid).toBe(true);
  });

  /**
   * Item 2: response_variants with typed schema in 500 key → valid.
   */
  it("accepts response_variants with shape { '500': { schema: { type: 'object' } } }", () => {
    const ep = baseEndpoint({
      response_variants: {
        "500": { schema: { type: "object", required: ["error"] } },
      },
    });
    const result = validator.validateEndpoint(ep);
    expect(result.valid).toBe(true);
  });

  /**
   * Item 3: response_variants whose key matches expected_status → valid
   * (this is a plan-time warning, NOT a schema error — DD-4).
   */
  it("accepts response_variants key matching expected_status (warning later, not schema error)", () => {
    const ep = baseEndpoint({
      response_variants: {
        "201": { schema: { type: "object" } },
      },
    });
    const result = validator.validateEndpoint(ep);
    expect(result.valid).toBe(true);
  });

  /**
   * Item 4: empty response_variants {} → valid (plan warning later, not schema error).
   */
  it("accepts empty response_variants {} (plan warning emitted later, not invalid)", () => {
    const ep = baseEndpoint({ response_variants: {} });
    const result = validator.validateEndpoint(ep);
    expect(result.valid).toBe(true);
  });

  /**
   * Item 5: response_variants absent → valid (field is optional).
   */
  it("accepts endpoint with no response_variants field (field is optional)", () => {
    const ep = baseEndpoint();
    const result = validator.validateEndpoint(ep);
    expect(result.valid).toBe(true);
  });

  /**
   * Item 6: response_variants: null → invalid.
   */
  it("rejects response_variants: null", () => {
    const ep = baseEndpoint({ response_variants: null });
    const result = validator.validateEndpoint(ep);
    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
  });

  /**
   * Item 7: response_variants: "string" → invalid.
   */
  it("rejects response_variants: 'string'", () => {
    const ep = baseEndpoint({ response_variants: "400" });
    const result = validator.validateEndpoint(ep);
    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
  });

  /**
   * Item 8: response_variants: array → invalid.
   */
  it("rejects response_variants: ['array']", () => {
    const ep = baseEndpoint({ response_variants: [{ schema: {} }] });
    const result = validator.validateEndpoint(ep);
    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
  });

  /**
   * Item 9: key "4xx" does not match ^[1-5]\d{2}$ → invalid.
   */
  it("rejects response_variants key '4xx' (fails ^[1-5]\\d{2}$ pattern)", () => {
    const ep = baseEndpoint({
      response_variants: { "4xx": { schema: {} } },
    });
    const result = validator.validateEndpoint(ep);
    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
  });

  /**
   * Item 10: key "099" → invalid (out of ^[1-5]\d{2}$ range).
   */
  it("rejects response_variants key '099' (fails ^[1-5]\\d{2}$ — leading zero / out of range)", () => {
    const ep = baseEndpoint({
      response_variants: { "099": { schema: {} } },
    });
    const result = validator.validateEndpoint(ep);
    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
  });

  /**
   * Item 11: key "600" → invalid (above 5xx range, fails ^[1-5]\d{2}$).
   */
  it("rejects response_variants key '600' (fails ^[1-5]\\d{2}$ — 6xx not in range)", () => {
    const ep = baseEndpoint({
      response_variants: { "600": { schema: {} } },
    });
    const result = validator.validateEndpoint(ep);
    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
  });

  /**
   * Item 12: variant value missing required schema → invalid.
   */
  it("rejects response_variants['400'] = {} (missing required schema field)", () => {
    const ep = baseEndpoint({
      response_variants: { "400": {} },
    });
    const result = validator.validateEndpoint(ep);
    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
  });

  /**
   * Item 13: variant.schema is null → invalid.
   */
  it("rejects response_variants['400'].schema = null (schema must be an object)", () => {
    const ep = baseEndpoint({
      response_variants: { "400": { schema: null } },
    });
    const result = validator.validateEndpoint(ep);
    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
  });

  /**
   * Item 14: variant has extra property description → invalid (additionalProperties).
   */
  it("rejects response_variants['400'] with unknown property 'description' (additionalProperties)", () => {
    const ep = baseEndpoint({
      response_variants: {
        "400": { schema: { type: "object" }, description: "x" },
      },
    });
    const result = validator.validateEndpoint(ep);
    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
  });

  /**
   * Item 15: multiple valid variant keys → valid.
   */
  it("accepts response_variants with multiple valid keys '400' and '500'", () => {
    const ep = baseEndpoint({
      response_variants: {
        "400": { schema: { type: "object", required: ["error", "message"] } },
        "500": { schema: { type: "object", required: ["error"] } },
      },
    });
    const result = validator.validateEndpoint(ep);
    expect(result.valid).toBe(true);
  });

  /**
   * Item 16: JSON round-trip preserves response_variants byte-identically.
   */
  it("JSON round-trip preserves response_variants", () => {
    const variants = {
      "400": { schema: { type: "object", required: ["error"] } },
      "500": { schema: { type: "object", required: ["code"] } },
    };
    const ep = baseEndpoint({ response_variants: variants });
    const serialized = JSON.stringify(ep);
    const parsed = JSON.parse(serialized) as Record<string, unknown>;
    expect(parsed["response_variants"]).toEqual(variants);
  });

  /**
   * Extra edge: key "abc" → invalid (letters, not digits).
   */
  it("rejects response_variants key 'abc' (non-numeric characters)", () => {
    const ep = baseEndpoint({
      response_variants: { abc: { schema: {} } },
    });
    const result = validator.validateEndpoint(ep);
    expect(result.valid).toBe(false);
  });

  /**
   * Extra edge: key "10" (too short) → invalid.
   */
  it("rejects response_variants key '10' (only two digits, not three)", () => {
    const ep = baseEndpoint({
      response_variants: { "10": { schema: {} } },
    });
    const result = validator.validateEndpoint(ep);
    expect(result.valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §6.2 validateBodyAgainstSchema — new method
// ---------------------------------------------------------------------------

describe("SchemaValidator.validateBodyAgainstSchema()", () => {
  let validator: SchemaValidator;

  beforeEach(() => {
    validator = new SchemaValidator();
  });

  /**
   * Item 17: body matches schema → { valid: true, errors: [] }.
   */
  it("returns { valid: true, errors: [] } when body matches schema", () => {
    const schema = {
      type: "object",
      required: ["error", "message"],
      properties: {
        error: { type: "string" },
        message: { type: "string" },
      },
    };
    const body = { error: "bad_request", message: "Missing field" };
    const result = validator.validateBodyAgainstSchema(schema, body);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  /**
   * Item 18: body missing required field → { valid: false, errors: [...] }.
   */
  it("returns { valid: false, errors: [...] } when body is missing a required field", () => {
    const schema = {
      type: "object",
      required: ["error"],
      properties: { error: { type: "string" } },
    };
    const body = { message: "only message here" };
    const result = validator.validateBodyAgainstSchema(schema, body);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  /**
   * Item 19: body has wrong type → { valid: false, errors: [...] }.
   */
  it("returns { valid: false, errors: [...] } when body has a wrong-type field", () => {
    const schema = {
      type: "object",
      properties: { code: { type: "integer" } },
    };
    const body = { code: "not-a-number" };
    const result = validator.validateBodyAgainstSchema(schema, body);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  /**
   * Item 20: multiple schema violations → all surfaced in errors array.
   */
  it("surfaces multiple AJV errors when body has multiple violations", () => {
    const schema = {
      type: "object",
      required: ["error", "code"],
      properties: {
        error: { type: "string" },
        code: { type: "integer" },
      },
    };
    // Missing required field + wrong type on code
    const body = { code: "not-integer" };
    const result = validator.validateBodyAgainstSchema(schema, body);
    expect(result.valid).toBe(false);
    // Must surface both: missing "error" and wrong type of "code"
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
  });

  /**
   * Item 21: empty schema {} matches anything → { valid: true, errors: [] }.
   */
  it("returns valid=true for any body against an empty schema {}", () => {
    const result = validator.validateBodyAgainstSchema({}, { any: "value", nested: { x: 1 } });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  /**
   * Item 22: undefined body + schema requiring fields → valid=false.
   */
  it("returns valid=false when body is undefined and schema requires fields", () => {
    const schema = {
      type: "object",
      required: ["error"],
      properties: { error: { type: "string" } },
    };
    const result = validator.validateBodyAgainstSchema(schema, undefined);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  /**
   * Item 23: errors array contains AJV-formatted strings with path and message.
   */
  it("formats each error as '<instancePath-or-root> <message>' matching formatAjvErrors pattern", () => {
    const schema = {
      type: "object",
      required: ["error"],
    };
    const body = {};
    const result = validator.validateBodyAgainstSchema(schema, body);
    expect(result.valid).toBe(false);
    // Each error string is non-empty and contains a message word
    for (const err of result.errors) {
      expect(typeof err).toBe("string");
      expect(err.length).toBeGreaterThan(0);
    }
    // At least one error mentions the missing required property
    const joined = result.errors.join(" ");
    expect(joined).toMatch(/error|required/i);
  });

  /**
   * Extra: null body + empty schema → valid.
   */
  it("returns valid=true when body is null and schema is empty {}", () => {
    const result = validator.validateBodyAgainstSchema({}, null);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });
});
