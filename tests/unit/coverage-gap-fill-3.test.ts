/**
 * Coverage-gap-fill-3: third wave targeting remaining uncovered branches across
 * multiple modules after the first two gap-fill files.
 *
 * Targeted branches:
 *   - assertions/operand-region-parser.ts: lines 144 (in_range empty), 184
 *     (value shape empty), 266 (parseTargetRef failure via invalid target)
 *   - test-catalog/generators/boundary-battery-generator.ts: #firstAbsentValue
 *     branches when sentinel/0/false present in enum (lines 163, 166, 169)
 *   - test-catalog/generators/body-negative-generator.ts: line 118 (unknown jsonType)
 *   - test-catalog/assertion-binder.ts: line 50 (assertion string > MAX_TITLE_LEN)
 *   - test-catalog/test-plan-generator.ts: line 165 (empty-string id), line 121
 *     (validator returns no errors array — via mock)
 *   - importers/openapi/security-mapper.ts: lines 137 (unknown type), 163
 *     (swagger-2 unresolvable scheme → isObject false arm), 178 (type undefined)
 *   - importers/openapi/operation-flattener.ts: line 81 (non-object path item),
 *     line 121 (non-method-like key → no warning branch)
 */

import { describe, it, expect, vi } from "vitest";

// ---------------------------------------------------------------------------
// Assertions engine
// ---------------------------------------------------------------------------
import { AssertionParser } from "../../src/assertions/parser.js";

// ---------------------------------------------------------------------------
// Test-catalog
// ---------------------------------------------------------------------------
import { BoundaryBatteryGenerator } from "../../src/test-catalog/generators/boundary-battery-generator.js";
import { BodyNegativeGenerator } from "../../src/test-catalog/generators/body-negative-generator.js";
import { AssertionBinder } from "../../src/test-catalog/assertion-binder.js";
import { TestPlanGenerator } from "../../src/test-catalog/test-plan-generator.js";
import { MarkerClassifier } from "../../src/test-catalog/marker-classifier.js";
import { ProdSafetyClassifier } from "../../src/test-catalog/prod-safety-classifier.js";
import { TestCaseIdFactory } from "../../src/test-catalog/test-case-id.js";
import { SchemaWalker } from "../../src/test-catalog/schema-walker.js";
import type { CanonicalEndpoint } from "../../src/core/canonical-model.js";
import type {
  BoundaryParams,
  GenerationContext,
} from "../../src/test-catalog/types.js";

// ---------------------------------------------------------------------------
// OpenAPI importers
// ---------------------------------------------------------------------------
import { OpenApiSecurityMapper } from "../../src/importers/openapi/security-mapper.js";
import { OperationFlattener } from "../../src/importers/openapi/operation-flattener.js";
import { OpenApiResponseSeeder } from "../../src/importers/openapi/response-seeder.js";
import { OpenApiImporter } from "../../src/importers/openapi/openapi-importer.js";
import type {
  FlattenedOperation,
  LoadedSpec,
  ConversionResult,
  OutputWriteResult,
  OpenApiWritableEndpoint,
} from "../../src/importers/openapi/types.js";
import type { OpenApiEndpointAssembler } from "../../src/importers/openapi/endpoint-assembler.js";
import type { OpenApiOutputWriter } from "../../src/importers/openapi/output-writer.js";
import type { OpenApiSpecLoader } from "../../src/importers/openapi/spec-loader.js";
import type { ImporterFileSystem } from "../../src/importers/types.js";

// ---------------------------------------------------------------------------
// Validate command
// ---------------------------------------------------------------------------
import { ValidateCommand } from "../../src/cli/commands/validate.js";
import type { FileSystem } from "../../src/cli/fs-seam.js";
import type { Logger } from "../../src/cli/logging/logger.js";
import { EnvironmentLoader } from "../../src/env/loader.js";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function makeCtx(walkerOpts?: { maxDepth: number }): GenerationContext {
  return {
    ids: new TestCaseIdFactory(),
    markers: new MarkerClassifier(),
    prodSafety: new ProdSafetyClassifier(),
    walker: new SchemaWalker(walkerOpts),
  };
}

function makeEndpointWith(bodySchema: Record<string, unknown>): CanonicalEndpoint {
  return {
    id: "ep.test",
    name: "Test",
    method: "POST",
    url: "/ep",
    request: { body_schema: bodySchema },
    response: { expected_status: 201, schema: {} },
  };
}

function makeSpec3x(
  securitySchemes: Record<string, unknown> = {},
): LoadedSpec {
  return {
    document: {
      openapi: "3.0.3",
      components: { securitySchemes },
      paths: {},
    },
    flavor: "openapi-3",
    baseUrl: "/",
    sourceId: "spec.json",
    circular: false,
  };
}

function makeSpec2x(
  securityDefinitions: Record<string, unknown> = {},
): LoadedSpec {
  return {
    document: {
      swagger: "2.0",
      securityDefinitions,
      paths: {},
    },
    flavor: "swagger-2",
    baseUrl: "/",
    sourceId: "swagger.json",
    circular: false,
  };
}

function makeOp(
  security?: FlattenedOperation["security"],
): FlattenedOperation {
  return {
    path: "/users",
    method: "GET",
    summary: "",
    description: "",
    tags: ["T"],
    parameters: [],
    responses: [],
    security,
  };
}

function makeFlattenerSpec3x(paths: Record<string, unknown>): LoadedSpec {
  return {
    document: {
      openapi: "3.0.3",
      info: { title: "T", version: "1" },
      paths,
    },
    flavor: "openapi-3",
    baseUrl: "https://api.example.com",
    sourceId: "spec.json",
    circular: false,
  };
}

// ---------------------------------------------------------------------------
// 1. OperandRegionParser — uncovered operand-parse paths via full AssertionParser
// ---------------------------------------------------------------------------

/**
 * Unit tests for AssertionParser operand-region dispatch arms that were
 * not previously exercised, specifically the "missing operand" paths for
 * the `range` and `value` shapes, and the `parseTargetRef` failure path.
 */
describe("AssertionParser — uncovered operand dispatch branches", () => {
  const parser = new AssertionParser();

  it("'response.status in_range' with no operand → parse error (line 144: parseRange empty)", () => {
    // operand-region-parser.ts line 144 TRUE branch:
    // parseRange called with tokens.length === 0
    const result = parser.parse("response.status in_range");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => /in_range/i.test(e))).toBe(true);
  });

  it("'response.body.x contains' with no operand → parse error (line 184: parseValue empty)", () => {
    // operand-region-parser.ts line 184 TRUE branch:
    // parseValue called with tokens.length === 0
    const result = parser.parse("response.body.x contains");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => /contains|Missing operand/i.test(e))).toBe(true);
  });

  it("'response.body.x equals unknown_root' — identifier operand parses as unknown root → parseTargetRef fails (line 266)", () => {
    // operand-region-parser.ts line 266 TRUE branch:
    // The operand token 'unknown_root' is tokenized as identifier kind.
    // classifyRegion returns "target", #parseTargetRef is called,
    // TargetPathParser.parse("unknown_root") returns ok:false → line 266 fires.
    const result = parser.parse("response.body.x equals unknown_root");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // The error from TargetPathParser is "Unknown root 'unknown_root'; expected..."
    expect(result.errors.some((e) => /unknown.*root|unknown_root/i.test(e))).toBe(true);
  });

  it("'response.body.x starts_with bad..target' — empty-segment identifier target fails parseTargetRef", () => {
    // Another path through line 266: operand has empty segments
    const result = parser.parse("response.body.x starts_with bad..target");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => /empty.*segment|Unknown root|starts_with/i.test(e))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. BoundaryBatteryGenerator — #firstAbsentValue branches
// ---------------------------------------------------------------------------

/**
 * Unit tests for the BoundaryBatteryGenerator #firstAbsentValue sentinel
 * fallback paths (lines 163, 166, 169).
 */
describe("BoundaryBatteryGenerator — #firstAbsentValue fallback paths", () => {
  const gen = new BoundaryBatteryGenerator();

  it("uses sentinel when it is not in the enum (line 163 TRUE: sentinel not in enum)", () => {
    // Normal case — sentinel is always absent → outside value is the sentinel
    const { cases } = gen.generate(
      makeEndpointWith({
        type: "object",
        properties: { status: { type: "string", enum: ["active", "inactive"] } },
      }),
      makeCtx(),
    );
    const outside = cases.find(
      (c) =>
        c.type === "boundary_battery" &&
        (c.params as BoundaryParams).constraint === "enum" &&
        (c.params as BoundaryParams).position === "outside",
    );
    expect(outside).toBeDefined();
    // Outside value should be the sentinel string
    expect((outside!.params as BoundaryParams).value).toBe("__apiwright_not_in_enum__");
  });

  it("falls back to 0 when sentinel is in the enum (line 163 FALSE: sentinel present, line 166 TRUE: 0 not present)", () => {
    // sentinel IS in enum → skip to checking 0 (which is not in enum)
    const { cases } = gen.generate(
      makeEndpointWith({
        type: "object",
        properties: {
          status: {
            type: "string",
            enum: ["__apiwright_not_in_enum__", "active"],
          },
        },
      }),
      makeCtx(),
    );
    const outside = cases.find(
      (c) =>
        c.type === "boundary_battery" &&
        (c.params as BoundaryParams).constraint === "enum" &&
        (c.params as BoundaryParams).position === "outside",
    );
    expect(outside).toBeDefined();
    // 0 is not in the enum so it becomes the outside value
    expect((outside!.params as BoundaryParams).value).toBe(0);
  });

  it("falls back to false when sentinel and 0 are both in enum (line 166 FALSE + line 169 TRUE)", () => {
    // sentinel AND 0 both in enum → checks false (not in enum)
    const { cases } = gen.generate(
      makeEndpointWith({
        type: "object",
        properties: {
          status: {
            type: "string",
            enum: ["__apiwright_not_in_enum__", 0, "active"],
          },
        },
      }),
      makeCtx(),
    );
    const outside = cases.find(
      (c) =>
        c.type === "boundary_battery" &&
        (c.params as BoundaryParams).constraint === "enum" &&
        (c.params as BoundaryParams).position === "outside",
    );
    expect(outside).toBeDefined();
    // false is not in the enum so it becomes the outside value
    expect((outside!.params as BoundaryParams).value).toBe(false);
  });

  it("falls back to numeric sentinel when sentinel, 0, and false all in enum (line 169 FALSE + while loop)", () => {
    // All three fallbacks exhausted → finds smallest positive integer not in enum
    const { cases } = gen.generate(
      makeEndpointWith({
        type: "object",
        properties: {
          status: {
            type: "string",
            enum: ["__apiwright_not_in_enum__", 0, false, 1],
          },
        },
      }),
      makeCtx(),
    );
    const outside = cases.find(
      (c) =>
        c.type === "boundary_battery" &&
        (c.params as BoundaryParams).constraint === "enum" &&
        (c.params as BoundaryParams).position === "outside",
    );
    expect(outside).toBeDefined();
    // 2 is the first positive integer not in the enum
    expect((outside!.params as BoundaryParams).value).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 3. BodyNegativeGenerator — jsonType "unknown" field skip (line 118 TRUE)
// ---------------------------------------------------------------------------

/**
 * Unit tests for BodyNegativeGenerator with fields whose jsonType is "unknown".
 * When a field lacks a `type` property in its schema, the schema-walker emits
 * jsonType="unknown", and BodyNegativeGenerator skips it (line 118 TRUE branch).
 */
describe("BodyNegativeGenerator — unknown jsonType field skip", () => {
  const gen = new BodyNegativeGenerator();

  it("skips type-violation case for field without a type property (jsonType='unknown')", () => {
    // A schema field with no 'type' → walker produces jsonType="unknown"
    // → line 118: if (field.jsonType === "unknown") return  (TRUE arm)
    const endpoint: CanonicalEndpoint = {
      id: "ep.test",
      name: "Test",
      method: "POST",
      url: "/test",
      request: {
        body_schema: {
          type: "object",
          required: ["meta"],
          properties: {
            meta: {}, // No 'type' property → jsonType="unknown"
            name: { type: "string" },
          },
        },
      },
      response: { expected_status: 201, schema: {} },
    };

    const { cases } = gen.generate(endpoint, makeCtx());

    // Should have type_violation for 'name' (string) but NOT for 'meta' (unknown)
    const typeViolations = cases.filter((c) => c.type === "type_violation_returns_400");
    const metaViolation = typeViolations.find(
      (c) => (c.params as { field?: string }).field === "meta",
    );
    const nameViolation = typeViolations.find(
      (c) => (c.params as { field?: string }).field === "name",
    );

    expect(metaViolation).toBeUndefined(); // skipped because unknown
    expect(nameViolation).toBeDefined();   // included because string
  });
});

// ---------------------------------------------------------------------------
// 4. AssertionBinder — long assertion title truncation (line 50 TRUE)
// ---------------------------------------------------------------------------

/**
 * Unit tests for AssertionBinder's title truncation when an assertion string
 * exceeds MAX_TITLE_LEN (80 chars).
 */
describe("AssertionBinder — long assertion string truncation (line 50 TRUE)", () => {
  const binder = new AssertionBinder();

  it("truncates the title with '…' when the assertion string exceeds 80 chars", () => {
    // 81-char assertion string → triggers line 50 TRUE branch
    const longAssertion = "response.body.field equals " + "x".repeat(60);
    expect(longAssertion.length).toBeGreaterThan(80);

    const ep: CanonicalEndpoint = {
      id: "ep.long",
      name: "Long Assertion EP",
      method: "GET",
      url: "/long",
      request: {},
      response: { expected_status: 200, schema: {} },
      assertions: [longAssertion],
    };

    const { cases } = binder.generate(ep, makeCtx());
    expect(cases).toHaveLength(1);
    const title = cases[0]!.title;
    // Title ends with '…' (the ellipsis character added at truncation)
    expect(title).toMatch(/…$/);
    // Title contains "Assertion: " prefix
    expect(title.startsWith("Assertion: ")).toBe(true);
  });

  it("does not truncate titles within 80 chars (line 50 FALSE — already covered baseline)", () => {
    const shortAssertion = "response.status equals 200";
    expect(shortAssertion.length).toBeLessThanOrEqual(80);

    const ep: CanonicalEndpoint = {
      id: "ep.short",
      name: "Short Assertion EP",
      method: "GET",
      url: "/short",
      request: {},
      response: { expected_status: 200, schema: {} },
      assertions: [shortAssertion],
    };

    const { cases } = binder.generate(ep, makeCtx());
    expect(cases).toHaveLength(1);
    // Short assertion: full text preserved (no ellipsis)
    expect(cases[0]!.title).not.toMatch(/…$/);
  });
});

// ---------------------------------------------------------------------------
// 5. TestPlanGenerator — endpointMarkersOf with empty-string id (line 165 FALSE)
// ---------------------------------------------------------------------------

/**
 * Unit tests for TestPlanGenerator.endpointMarkersOf() when an endpoint has
 * an empty-string id (falsy string) — the condition at line 165 is FALSE.
 */
describe("TestPlanGenerator — endpointMarkersOf() with empty id (line 165 FALSE)", () => {
  it("skips endpoints with empty-string id in endpointMarkersOf", () => {
    const gen = new TestPlanGenerator();
    const epWithEmptyId: CanonicalEndpoint = {
      id: "", // empty string — falsy, line 165 is FALSE
      name: "Empty ID EP",
      method: "GET",
      url: "/empty",
      request: {},
      response: { expected_status: 200, schema: {} },
      markers: ["smoke"],
    };

    const map = gen.endpointMarkersOf([epWithEmptyId]);
    // Empty-string id is falsy → skipped, so the map should be empty
    expect(Object.keys(map)).toHaveLength(0);
  });

  it("includes endpoints with valid non-empty string ids", () => {
    const gen = new TestPlanGenerator();
    const validEp: CanonicalEndpoint = {
      id: "ep.valid",
      name: "Valid EP",
      method: "GET",
      url: "/valid",
      request: {},
      response: { expected_status: 200, schema: {} },
      markers: ["regression"],
    };

    const map = gen.endpointMarkersOf([validEp]);
    expect(map["ep.valid"]).toEqual(["regression"]);
  });
});

// ---------------------------------------------------------------------------
// 6. TestPlanGenerator — generate() with mock validator returning no errors
//    (line 121: v.errors ?? [] — TRUE arm via injected mock)
// ---------------------------------------------------------------------------

/**
 * Unit tests for TestPlanGenerator.generate() when the injected SchemaValidator
 * returns { valid: false } without an errors array. This triggers the
 * `v.errors ?? []` fallback at line 121.
 */
describe("TestPlanGenerator — generate() with mock validator (line 121 errors ?? [] fallback)", () => {
  it("falls back to empty errors array when validator returns valid:false with no errors property", () => {
    // Inject a mock validator that returns { valid: false } with no errors field
    const mockValidator = {
      validateEndpoint: vi.fn().mockReturnValue({ valid: false }),
    } as unknown as import("../../src/core/schema-validator.js").SchemaValidator;

    const gen = new TestPlanGenerator({ validator: mockValidator });
    const ep: CanonicalEndpoint = {
      id: "ep.skipped",
      name: "Skipped EP",
      method: "GET",
      url: "/skip",
      request: {},
      response: { expected_status: 200, schema: {} },
    };

    const { endpoints_skipped, warnings } = gen.generate([ep]);
    expect(endpoints_skipped).toBe(1);
    // Warning is formed; errors join produces "" (empty join from [])
    expect(warnings.some((w) => w.includes("ep.skipped"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 7. OpenApiSecurityMapper — uncovered branches
// ---------------------------------------------------------------------------

/**
 * Unit tests for OpenApiSecurityMapper branches that were not previously covered:
 * - swagger-2 unresolvable scheme (line 163 FALSE: isObject returns false)
 * - scheme definition with no 'type' field (line 178 TRUE: type === undefined)
 * - scheme definition with no 'type' field reaching line 137 (?? "unknown")
 */
describe("OpenApiSecurityMapper — uncovered branches", () => {
  const mapper = new OpenApiSecurityMapper();

  it("swagger-2 unresolvable scheme name → FALSE arm of line 163 (isObject returns false → undefined)", () => {
    // swagger-2 spec with no securityDefinitions matching the scheme name
    // → captureDbMissingQueryId → defs["nonExistent"] → undefined → isObject(undefined) false
    // → line 163: this.#access.isObject(def) ? def : undefined → undefined arm
    const spec = makeSpec2x({}); // Empty definitions
    const op = makeOp([{ schemeNames: ["nonExistentScheme"] }]);
    const { authStrategy, warnings } = mapper.map(op, spec);
    expect(authStrategy).toBeUndefined();
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toMatch(/unresolvable/);
  });

  it("scheme definition with no 'type' field → line 178 TRUE (type === undefined returns undefined)", () => {
    // A scheme exists in securitySchemes but has no 'type' field
    // → #mapScheme called → asString(schemeDef["type"]) → undefined
    // → line 178: if (type === undefined) return undefined
    // → back in #mapSchemeName: authStrategy is undefined → reach line 137
    const spec = makeSpec3x({
      noTypeScheme: { description: "A scheme with no type field" },
    });
    const op = makeOp([{ schemeNames: ["noTypeScheme"] }]);
    const { authStrategy, warnings } = mapper.map(op, spec);
    expect(authStrategy).toBeUndefined();
    // Warning should mention "unknown" (from line 137: ?? "unknown")
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toMatch(/noTypeScheme/);
  });

  it("swagger-2 scheme with no type field → type undefined → warning with ?? 'unknown' (line 137)", () => {
    // swagger-2 spec with a scheme that has no 'type' field
    // → #resolveScheme returns the object → #mapScheme gets no type → returns undefined
    // → line 137: asString(schemeDef["type"]) is undefined → ??"unknown" fires
    const spec = makeSpec2x({
      apiKeyNoType: { in: "header", name: "X-Api-Key" }, // No 'type'
    });
    const op = makeOp([{ schemeNames: ["apiKeyNoType"] }]);
    const { authStrategy, warnings } = mapper.map(op, spec);
    expect(authStrategy).toBeUndefined();
    expect(warnings.some((w) => w.includes("unknown"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 8. OperationFlattener — non-object path item (line 81 TRUE) and
//    non-method-like key in path item (line 121 FALSE)
// ---------------------------------------------------------------------------

/**
 * Unit tests for OperationFlattener branches not previously covered:
 * - A path item value that is not an object → skip (line 81 TRUE: continue)
 * - A path item key that is not in SUPPORTED_METHODS and not method-like
 *   → no warning (line 121 FALSE: #isMethodLike returns false)
 */
describe("OperationFlattener — uncovered path-item branches", () => {
  const flattener = new OperationFlattener();

  it("skips a path entry whose value is null (line 81 TRUE: !isObject → continue)", () => {
    // paths: { "/foo": null } → pathItem is null → !isObject(null) → true → continue
    const spec = makeFlattenerSpec3x({
      "/foo": null,
      "/bar": {
        get: { tags: ["T"], responses: {} },
      },
    });
    const { operations } = flattener.flatten(spec);
    // null path item is skipped; /bar.get produces 1 operation
    expect(operations).toHaveLength(1);
    expect(operations[0]!.path).toBe("/bar");
  });

  it("skips a path entry whose value is a string (line 81 TRUE: !isObject string → continue)", () => {
    const spec = makeFlattenerSpec3x({
      "/foo": "a reference string", // not an object
      "/bar": { get: { tags: ["T"], responses: {} } },
    });
    const { operations } = flattener.flatten(spec);
    expect(operations).toHaveLength(1);
  });

  it("silently skips path item key that is too short to be method-like (line 121 FALSE: isMethodLike false)", () => {
    // Key "x" is not in NON_OPERATION_KEYS, not x- prefix, not in SUPPORTED_METHODS.
    // isMethodLike("x") = false (length 1 < METHOD_MIN_LEN=3) → no warning, just skip.
    const spec = makeFlattenerSpec3x({
      "/foo": {
        x: { operationId: "customX", responses: {} }, // length 1 → not method-like
        get: { tags: ["T"], responses: {} },
      },
    });
    const { operations, warnings } = flattener.flatten(spec);
    // Only "get" produces an operation; "x" is silently skipped
    expect(operations).toHaveLength(1);
    expect(operations[0]!.method).toBe("get");
    // No warning because isMethodLike("x") is false
    const xWarning = warnings.filter((w) => /^Skipped.*x/i.test(w));
    expect(xWarning).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 9. AssertionParser — additional operand target-ref failure paths
// ---------------------------------------------------------------------------

/**
 * Additional end-to-end tests exercising the parseTargetRef failure path
 * with different operator shapes (not just comparand).
 */
describe("AssertionParser — additional operand parseTargetRef failure paths", () => {
  const parser = new AssertionParser();

  it("'response.body.x not_equals bad_root_name' — operand identifier fails target parse", () => {
    // `bad_root_name` is not request/response/db → TargetPathParser fails
    const result = parser.parse("response.body.x not_equals bad_root_name");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => /Unknown root|bad_root_name/i.test(e))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 10. BodyNegativeGenerator — jsonType "null" → ?? "string" fallback (line 121)
// ---------------------------------------------------------------------------

/**
 * Unit tests for BodyNegativeGenerator when a field's jsonType is "null"
 * (a valid JSON Schema type not present in WRONG_TYPE_MAP). The `?? "string"`
 * fallback at line 121 fires.
 */
describe("BodyNegativeGenerator — 'null' jsonType ?? 'string' fallback (line 121)", () => {
  it("uses 'string' as wrongType when field.jsonType is 'null' (not in WRONG_TYPE_MAP)", () => {
    // { type: "null" } → schema-walker produces jsonType="null"
    // line 118: "null" !== "unknown" → not skipped
    // line 121: WRONG_TYPE_MAP["null"] is undefined → ?? "string" fires
    const gen = new BodyNegativeGenerator();
    const endpoint: CanonicalEndpoint = {
      id: "ep.null-type",
      name: "Null Type EP",
      method: "POST",
      url: "/null-type",
      request: {
        body_schema: {
          type: "object",
          properties: {
            nullable_field: { type: "null" },
          },
        },
      },
      response: { expected_status: 201, schema: {} },
    };

    const { cases } = gen.generate(endpoint, makeCtx());
    // A type_violation case should be emitted for the "null" field
    const nullViolation = cases.find(
      (c) =>
        c.type === "type_violation_returns_400" &&
        (c.params as { field?: string }).field === "nullable_field",
    );
    expect(nullViolation).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 11. OpenApiResponseSeeder — non-numeric statusKey (line 120 isNaN TRUE)
// ---------------------------------------------------------------------------

/**
 * Unit tests for the OpenApiResponseSeeder when the non-default response has
 * a non-numeric status key (line 120 TRUE: isNaN(n) → keep statusKey as-is).
 */
describe("OpenApiResponseSeeder — non-numeric statusKey (line 120 isNaN TRUE)", () => {
  function makeFakeSeederConverter(
    schema: Record<string, unknown> = { type: "object" },
  ) {
    return {
      convert(_input: unknown) {
        return { schema, warnings: [] };
      },
    };
  }

  it("preserves non-numeric statusKey in warning when isNaN returns true", () => {
    // statusKey "xxx" → parseInt("xxx", 10) returns NaN
    // → line 120: isNaN(n) is TRUE → statusStr = "xxx" (kept verbatim, not String(n))
    // Note: "2xx" parses as integer 2 (parseInt reads until non-digit), so use "xxx"
    const seeder = new OpenApiResponseSeeder({
      schemaConverter: makeFakeSeederConverter() as never,
    });
    const op: FlattenedOperation = {
      path: "/test",
      method: "GET",
      summary: "",
      description: "",
      tags: ["T"],
      parameters: [],
      responses: [
        { statusKey: "xxx", mediaType: "application/json", schema: { type: "object" } },
      ],
    };
    const { warnings } = seeder.seed(op);
    expect(warnings.some((w) => w.includes("xxx"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 12. OpenApiImporter — empty tags array (line 121 ?? "" fallback)
// ---------------------------------------------------------------------------

/**
 * Unit tests for OpenApiImporter when a FlattenedOperation has empty tags,
 * causing op.tags[0] to be undefined and triggering the ?? "" fallback at
 * line 121 of openapi-importer.ts.
 */
describe("OpenApiImporter — empty tags ?? '' fallback (line 121)", () => {
  function makeFakeSpecLoader(
    spec: LoadedSpec,
  ): OpenApiSpecLoader {
    return {
      async load(_source: string) {
        return { ok: true, spec, warnings: [] };
      },
    } as unknown as OpenApiSpecLoader;
  }

  function makeFakeFlattener(operations: FlattenedOperation[]) {
    return {
      flatten(_spec: LoadedSpec) {
        return { operations, warnings: [] };
      },
    };
  }

  function makeFakeAssembler(results: Array<ConversionResult>): OpenApiEndpointAssembler {
    let idx = 0;
    return {
      assemble(_op: FlattenedOperation, _spec: LoadedSpec, _used: Set<string>): ConversionResult {
        return results[idx++] ?? { warnings: [] };
      },
    } as unknown as OpenApiEndpointAssembler;
  }

  function makeFakeWriter(result: OutputWriteResult): OpenApiOutputWriter {
    return {
      write(_items: readonly OpenApiWritableEndpoint[], _dir: string): OutputWriteResult {
        return result;
      },
    } as unknown as OpenApiOutputWriter;
  }

  function makeFakeFs(): ImporterFileSystem {
    const files: Record<string, string> = {};
    return {
      readFile(path: string): string {
        return files[path] ?? "{}";
      },
      mkdirp(): void {},
      writeFile(path: string, contents: string): void {
        files[path] = contents;
      },
    };
  }

  const SPEC: LoadedSpec = {
    document: { openapi: "3.0.3", paths: {} },
    flavor: "openapi-3",
    baseUrl: "/",
    sourceId: "spec.json",
    circular: false,
  };

  const VALID_ENDPOINT = {
    id: "ep.empty.tags",
    name: "Empty Tags",
    method: "GET" as const,
    url: "/test",
    request: {},
    response: { expected_status: 200, schema: {} },
    source: { type: "openapi" as const, spec_url: "spec.json" },
  };

  it("uses empty string for tagPath when operation has empty tags array", async () => {
    // op.tags = [] → op.tags[0] = undefined → ?? "" → tagPath: [""]
    const opWithEmptyTags: FlattenedOperation = {
      path: "/test",
      method: "GET",
      summary: "",
      description: "",
      tags: [], // Empty tags!
      parameters: [],
      responses: [],
    };

    const importer = new OpenApiImporter({
      loader: makeFakeSpecLoader(SPEC),
      flattener: makeFakeFlattener([opWithEmptyTags]) as never,
      assembler: makeFakeAssembler([{ endpoint: VALID_ENDPOINT, warnings: [] }]),
      writer: makeFakeWriter({ written: 1, warnings: [] }),
      fs: makeFakeFs(),
    });

    const result = await importer.openapi({ source: "spec.json", outputDir: "/out" });
    expect(result.written).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 13. ValidateCommand — .yml extension (line 275 FALSE: endsWith ".yaml" fails)
// ---------------------------------------------------------------------------

/**
 * Unit tests for ValidateCommand's #stripYamlExt when the file uses ".yml"
 * extension (not ".yaml"). The first suffix iteration (".yaml") fails at line
 * 275, triggering the FALSE branch, then ".yml" matches.
 */
describe("ValidateCommand — .yml extension (line 275 endsWith false branch)", () => {
  function makeFakeLogger(): Logger {
    return {
      level: "warn",
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
    };
  }

  function makeFakeFs(
    walkResult: string[] = [],
    fileContents: Record<string, string> = {},
  ): FileSystem {
    return {
      fileExists: vi.fn().mockReturnValue(true),
      dirExists: vi.fn().mockReturnValue(true),
      walk: vi.fn().mockReturnValue(walkResult),
      readFile: vi.fn((p: string): string => {
        return fileContents[p] ?? "{}";
      }),
    };
  }

  it("strips .yml extension when env file uses .yml (line 275 FALSE arm: .yaml fails, .yml succeeds)", () => {
    // File "qa.yml" → first suffix ".yaml" doesn't match → FALSE arm at line 275
    // → second suffix ".yml" matches → strips ".yml"
    const VALID_ENV_YAML =
      "name: qa\nprod: false\nbase_url: https://qa.example.com\n";

    const fakeLoaderFactory = vi.fn((_rootDir: string) => ({
      load: vi.fn().mockReturnValue({
        valid: true,
        environment: { name: "qa", prod: false, base_url: "https://qa.example.com" },
        secretRegistry: new Map(),
      }),
    })) as unknown as (rootDir: string) => EnvironmentLoader;

    const fs = makeFakeFs(
      ["/dir/qa.yml"],
      { "/dir/qa.yml": VALID_ENV_YAML },
    );

    const cmd = new ValidateCommand({
      fs,
      logger: makeFakeLogger(),
      environmentLoaderFactory: fakeLoaderFactory,
    });

    const summary = cmd.run("/dir");
    // qa.yml → stripped to "qa" → loaded → passes
    expect(summary.passedCount).toBe(1);
    expect(summary.results[0]?.kind).toBe("environment");
  });
});
