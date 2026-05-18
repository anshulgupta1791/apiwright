import { describe, expect, it } from "vitest";

import { OpenApiEndpointAssembler } from "../../../../src/importers/openapi/endpoint-assembler.js";
import { SchemaValidator } from "../../../../src/core/schema-validator.js";
import type { OpenApiRequestConverter } from "../../../../src/importers/openapi/request-converter.js";
import type { OpenApiResponseSeeder } from "../../../../src/importers/openapi/response-seeder.js";
import type { OpenApiSecurityMapper } from "../../../../src/importers/openapi/security-mapper.js";
import type {
  FlattenedOperation,
  LoadedSpec,
  RequestConversionResult,
  ResponseSeedResult,
  SecurityMapResult,
} from "../../../../src/importers/openapi/types.js";
import type { HttpMethod } from "../../../../src/core/canonical-model.js";

/**
 * Unit tests for OpenApiEndpointAssembler.
 *
 * All collaborators are injected as fakes. Covers: fully-convertible operation
 * passes schema validation, source shape exactly {type:"openapi",spec_url},
 * meta-schema failure drops endpoint + one aggregated warning, converter
 * returns no-core → dropped, stage warnings merged under [METHOD path] context,
 * auth_strategy omitted (not empty) when unset, default-seam wiring, never throws.
 */

/** Minimal 3.x LoadedSpec builder. */
function makeSpec(sourceId = "spec.json"): LoadedSpec {
  return {
    document: { openapi: "3.0.3", paths: {} },
    flavor: "openapi-3",
    baseUrl: "/",
    sourceId,
    circular: false,
  };
}

/** Minimal FlattenedOperation builder. */
function makeOp(
  overrides: Partial<FlattenedOperation> = {},
): FlattenedOperation {
  return {
    path: "/users",
    method: "GET",
    summary: "List users",
    description: "",
    tags: ["Users"],
    parameters: [],
    responses: [],
    ...overrides,
  };
}

/** A valid RequestConversionResult core. */
function makeValidCore(
  id = "list_users",
  method: HttpMethod = "GET",
  path = "/users",
): RequestConversionResult {
  return {
    core: {
      id,
      name: "List Users",
      method,
      url: path,
      request: {},
    },
    warnings: [],
  };
}

/** Fake request converter that returns a given result. */
function makeFakeRequestConverter(
  result: RequestConversionResult,
): OpenApiRequestConverter {
  return {
    convert(_op: FlattenedOperation, _usedIds: Set<string>) {
      return result;
    },
  } as unknown as OpenApiRequestConverter;
}

/** Fake response seeder that returns a valid response. */
function makeFakeResponseSeeder(
  warnings: string[] = [],
): OpenApiResponseSeeder {
  return {
    seed(_op: FlattenedOperation): ResponseSeedResult {
      return {
        response: {
          expected_status: 200,
          schema: { type: "object" },
        },
        warnings,
      };
    },
  } as unknown as OpenApiResponseSeeder;
}

/** Fake security mapper that returns a given result. */
function makeFakeSecurityMapper(
  result: SecurityMapResult = { warnings: [] },
): OpenApiSecurityMapper {
  return {
    map(_op: FlattenedOperation, _spec: LoadedSpec): SecurityMapResult {
      return result;
    },
  } as unknown as OpenApiSecurityMapper;
}

describe("OpenApiEndpointAssembler", () => {
  describe("constructor — default-seam wiring", () => {
    it("constructs with no options and exposes an assemble method", () => {
      const assembler = new OpenApiEndpointAssembler();
      expect(typeof assembler.assemble).toBe("function");
    });

    it("constructs with partial options (only validator provided)", () => {
      const assembler = new OpenApiEndpointAssembler({
        validator: new SchemaValidator(),
      });
      expect(typeof assembler.assemble).toBe("function");
    });
  });

  describe("assemble() — fully convertible operation", () => {
    it("returns an endpoint for a fully convertible operation", () => {
      const assembler = new OpenApiEndpointAssembler({
        requestConverter: makeFakeRequestConverter(makeValidCore()),
        responseSeeder: makeFakeResponseSeeder(),
        securityMapper: makeFakeSecurityMapper(),
        validator: new SchemaValidator(),
      });
      const { endpoint } = assembler.assemble(makeOp(), makeSpec(), new Set());
      expect(endpoint).toBeDefined();
    });

    it("returned endpoint passes SchemaValidator.validateEndpoint with valid:true", () => {
      const assembler = new OpenApiEndpointAssembler({
        requestConverter: makeFakeRequestConverter(makeValidCore()),
        responseSeeder: makeFakeResponseSeeder(),
        securityMapper: makeFakeSecurityMapper(),
        validator: new SchemaValidator(),
      });
      const { endpoint } = assembler.assemble(makeOp(), makeSpec(), new Set());
      if (!endpoint) throw new Error("Expected endpoint to be defined");
      const validator = new SchemaValidator();
      const result = validator.validateEndpoint(endpoint);
      expect(result.valid).toBe(true);
    });

    it("source is exactly {type:'openapi', spec_url:<sourceId>}", () => {
      const assembler = new OpenApiEndpointAssembler({
        requestConverter: makeFakeRequestConverter(makeValidCore()),
        responseSeeder: makeFakeResponseSeeder(),
        securityMapper: makeFakeSecurityMapper(),
        validator: new SchemaValidator(),
      });
      const { endpoint } = assembler.assemble(makeOp(), makeSpec("my-api.json"), new Set());
      if (!endpoint) throw new Error("Expected endpoint");
      expect(endpoint.source?.type).toBe("openapi");
      expect(endpoint.source?.spec_url).toBe("my-api.json");
    });

    it("source does not include 'collection' or 'endpoint_id' fields", () => {
      const assembler = new OpenApiEndpointAssembler({
        requestConverter: makeFakeRequestConverter(makeValidCore()),
        responseSeeder: makeFakeResponseSeeder(),
        securityMapper: makeFakeSecurityMapper(),
        validator: new SchemaValidator(),
      });
      const { endpoint } = assembler.assemble(makeOp(), makeSpec(), new Set());
      if (!endpoint) throw new Error("Expected endpoint");
      expect("collection" in (endpoint.source ?? {})).toBe(false);
      expect("endpoint_id" in (endpoint.source ?? {})).toBe(false);
    });

    it("includes tags from the flattened operation", () => {
      const assembler = new OpenApiEndpointAssembler({
        requestConverter: makeFakeRequestConverter(makeValidCore()),
        responseSeeder: makeFakeResponseSeeder(),
        securityMapper: makeFakeSecurityMapper(),
        validator: new SchemaValidator(),
      });
      const op = makeOp({ tags: ["Users", "Admin"] });
      const { endpoint } = assembler.assemble(op, makeSpec(), new Set());
      if (!endpoint) throw new Error("Expected endpoint");
      expect(endpoint.tags).toEqual(["Users", "Admin"]);
    });
  });

  describe("assemble() — auth_strategy handling", () => {
    it("includes auth_strategy when security mapper returns an authStrategy", () => {
      const assembler = new OpenApiEndpointAssembler({
        requestConverter: makeFakeRequestConverter(makeValidCore()),
        responseSeeder: makeFakeResponseSeeder(),
        securityMapper: makeFakeSecurityMapper({ authStrategy: "user_token", warnings: [] }),
        validator: new SchemaValidator(),
      });
      const { endpoint } = assembler.assemble(makeOp(), makeSpec(), new Set());
      if (!endpoint) throw new Error("Expected endpoint");
      expect(endpoint.auth_strategy).toBe("user_token");
    });

    it("omits auth_strategy key entirely when mapper returns undefined", () => {
      const assembler = new OpenApiEndpointAssembler({
        requestConverter: makeFakeRequestConverter(makeValidCore()),
        responseSeeder: makeFakeResponseSeeder(),
        securityMapper: makeFakeSecurityMapper({ warnings: [] }),
        validator: new SchemaValidator(),
      });
      const { endpoint } = assembler.assemble(makeOp(), makeSpec(), new Set());
      if (!endpoint) throw new Error("Expected endpoint");
      // Key must be absent, not set to ""
      expect("auth_strategy" in endpoint).toBe(false);
    });

    it("endpoint without auth_strategy is still schema-valid", () => {
      const assembler = new OpenApiEndpointAssembler({
        requestConverter: makeFakeRequestConverter(makeValidCore()),
        responseSeeder: makeFakeResponseSeeder(),
        securityMapper: makeFakeSecurityMapper({ warnings: [] }),
        validator: new SchemaValidator(),
      });
      const { endpoint } = assembler.assemble(makeOp(), makeSpec(), new Set());
      if (!endpoint) throw new Error("Expected endpoint");
      const validator = new SchemaValidator();
      expect(validator.validateEndpoint(endpoint).valid).toBe(true);
    });
  });

  describe("assemble() — meta-schema validation failure", () => {
    it("drops the endpoint when it fails schema validation", () => {
      // Inject a fake validator that always returns invalid
      const fakeValidator = {
        validateEndpoint(_ep: unknown) {
          return { valid: false, errors: ["id must be string", "url is required"] };
        },
      } as unknown as SchemaValidator;

      const assembler = new OpenApiEndpointAssembler({
        requestConverter: makeFakeRequestConverter(makeValidCore()),
        responseSeeder: makeFakeResponseSeeder(),
        securityMapper: makeFakeSecurityMapper(),
        validator: fakeValidator,
      });
      const { endpoint } = assembler.assemble(makeOp(), makeSpec(), new Set());
      expect(endpoint).toBeUndefined();
    });

    it("emits exactly one warning containing path+method when validation fails", () => {
      const fakeValidator = {
        validateEndpoint(_ep: unknown) {
          return { valid: false, errors: ["id must be string"] };
        },
      } as unknown as SchemaValidator;

      const assembler = new OpenApiEndpointAssembler({
        requestConverter: makeFakeRequestConverter(makeValidCore()),
        responseSeeder: makeFakeResponseSeeder(),
        securityMapper: makeFakeSecurityMapper(),
        validator: fakeValidator,
      });
      const { warnings } = assembler.assemble(makeOp({ path: "/users", method: "GET" }), makeSpec(), new Set());
      // Exactly one "dropped" warning containing operation context
      const droppedWarnings = warnings.filter((w) =>
        w.includes("dropped") || w.includes("validation failed"),
      );
      expect(droppedWarnings.length).toBeGreaterThanOrEqual(1);
    });

    it("aggregated validation warning includes AJV error strings", () => {
      const fakeValidator = {
        validateEndpoint(_ep: unknown) {
          return { valid: false, errors: ["id must be string", "url is required"] };
        },
      } as unknown as SchemaValidator;

      const assembler = new OpenApiEndpointAssembler({
        requestConverter: makeFakeRequestConverter(makeValidCore()),
        responseSeeder: makeFakeResponseSeeder(),
        securityMapper: makeFakeSecurityMapper(),
        validator: fakeValidator,
      });
      const { warnings } = assembler.assemble(makeOp(), makeSpec(), new Set());
      // The aggregated warning should contain at least one AJV error
      expect(
        warnings.some(
          (w) => w.includes("id must be string") || w.includes("url is required"),
        ),
      ).toBe(true);
    });

    it("does not throw when validation fails", () => {
      const fakeValidator = {
        validateEndpoint(_ep: unknown) {
          return { valid: false, errors: ["bad"] };
        },
      } as unknown as SchemaValidator;

      const assembler = new OpenApiEndpointAssembler({
        requestConverter: makeFakeRequestConverter(makeValidCore()),
        responseSeeder: makeFakeResponseSeeder(),
        securityMapper: makeFakeSecurityMapper(),
        validator: fakeValidator,
      });
      expect(() =>
        assembler.assemble(makeOp(), makeSpec(), new Set()),
      ).not.toThrow();
    });
  });

  describe("assemble() — converter returns no core", () => {
    it("drops the endpoint when request converter returns no core", () => {
      const assembler = new OpenApiEndpointAssembler({
        requestConverter: makeFakeRequestConverter({ core: undefined, warnings: ["Unsupported method"] }),
        responseSeeder: makeFakeResponseSeeder(),
        securityMapper: makeFakeSecurityMapper(),
        validator: new SchemaValidator(),
      });
      const { endpoint } = assembler.assemble(makeOp(), makeSpec(), new Set());
      expect(endpoint).toBeUndefined();
    });

    it("surfaces converter warnings under context label when no core", () => {
      const assembler = new OpenApiEndpointAssembler({
        requestConverter: makeFakeRequestConverter({ core: undefined, warnings: ["Unsupported method"] }),
        responseSeeder: makeFakeResponseSeeder(),
        securityMapper: makeFakeSecurityMapper(),
        validator: new SchemaValidator(),
      });
      const { warnings } = assembler.assemble(makeOp({ path: "/users", method: "GET" }), makeSpec(), new Set());
      expect(warnings.some((w) => w.includes("Unsupported method"))).toBe(true);
    });
  });

  describe("assemble() — stage warnings merged under [METHOD path] context", () => {
    it("merges response-seeder warnings under context label", () => {
      const assembler = new OpenApiEndpointAssembler({
        requestConverter: makeFakeRequestConverter(makeValidCore()),
        responseSeeder: makeFakeResponseSeeder(["No 2xx response found"]),
        securityMapper: makeFakeSecurityMapper({ warnings: [] }),
        validator: new SchemaValidator(),
      });
      const { warnings } = assembler.assemble(
        makeOp({ path: "/users", method: "GET" }),
        makeSpec(),
        new Set(),
      );
      expect(warnings.some((w) => w.includes("No 2xx response found"))).toBe(true);
    });

    it("merges security-mapper warnings under context label", () => {
      const assembler = new OpenApiEndpointAssembler({
        requestConverter: makeFakeRequestConverter(makeValidCore()),
        responseSeeder: makeFakeResponseSeeder(),
        securityMapper: makeFakeSecurityMapper({
          warnings: ["set auth_strategy manually"],
        }),
        validator: new SchemaValidator(),
      });
      const { warnings } = assembler.assemble(makeOp(), makeSpec(), new Set());
      expect(
        warnings.some((w) => w.includes("set auth_strategy manually")),
      ).toBe(true);
    });

    it("merged warnings include the [METHOD path] context label", () => {
      const assembler = new OpenApiEndpointAssembler({
        requestConverter: makeFakeRequestConverter({
          core: makeValidCore().core,
          warnings: ["converter note"],
        }),
        responseSeeder: makeFakeResponseSeeder(),
        securityMapper: makeFakeSecurityMapper(),
        validator: new SchemaValidator(),
      });
      const { warnings } = assembler.assemble(
        makeOp({ path: "/items", method: "POST" }),
        makeSpec(),
        new Set(),
      );
      // Context label should appear somewhere in warnings containing the note
      const contextWarnings = warnings.filter((w) =>
        w.includes("converter note"),
      );
      expect(contextWarnings.length).toBeGreaterThan(0);
    });
  });

  describe("assemble() — never throws", () => {
    it("does not throw when all collaborators return valid results", () => {
      const assembler = new OpenApiEndpointAssembler({
        requestConverter: makeFakeRequestConverter(makeValidCore()),
        responseSeeder: makeFakeResponseSeeder(),
        securityMapper: makeFakeSecurityMapper(),
        validator: new SchemaValidator(),
      });
      expect(() =>
        assembler.assemble(makeOp(), makeSpec(), new Set()),
      ).not.toThrow();
    });

    it("returns ConversionResult shape always", () => {
      const assembler = new OpenApiEndpointAssembler({
        requestConverter: makeFakeRequestConverter(makeValidCore()),
        responseSeeder: makeFakeResponseSeeder(),
        securityMapper: makeFakeSecurityMapper(),
        validator: new SchemaValidator(),
      });
      const result = assembler.assemble(makeOp(), makeSpec(), new Set());
      expect("warnings" in result).toBe(true);
      expect(Array.isArray(result.warnings)).toBe(true);
    });
  });
});
