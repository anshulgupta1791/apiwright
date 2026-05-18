import { describe, expect, it } from "vitest";

import { OpenApiSecurityMapper } from "../../../../src/importers/openapi/security-mapper.js";
import type {
  FlattenedOperation,
  LoadedSpec,
} from "../../../../src/importers/openapi/types.js";

/**
 * Unit tests for OpenApiSecurityMapper.
 *
 * Pure class: exercised with literal FlattenedOperation + LoadedSpec. Covers
 * the CLOSED ALLOWLIST: 3.x http/bearer→user_token, http/basic→basic_auth,
 * apiKey→api_key; 2.0 basic→basic_auth, apiKey→api_key; unmapped (OAuth2,
 * OIDC, mutualTLS, http/digest, multiple combined, alternative requirements,
 * unresolvable scheme); no security (undefined); explicit empty security;
 * authStrategy omitted (not empty string); default-seam wiring; never throws.
 */

/** Minimal 3.x LoadedSpec builder. */
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

/** Minimal 2.0 LoadedSpec builder. */
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

/** Minimal FlattenedOperation builder with optional security. */
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

describe("OpenApiSecurityMapper", () => {
  describe("constructor — default-seam wiring", () => {
    it("constructs with no options and exposes a map method", () => {
      const mapper = new OpenApiSecurityMapper();
      expect(typeof mapper.map).toBe("function");
    });
  });

  describe("map() — MAPPED: 3.x http/bearer → user_token", () => {
    it("maps 3.x http/bearer scheme to 'user_token'", () => {
      const spec = makeSpec3x({
        bearerAuth: { type: "http", scheme: "bearer" },
      });
      const op = makeOp([{ schemeNames: ["bearerAuth"] }]);
      const mapper = new OpenApiSecurityMapper();
      const { authStrategy, warnings } = mapper.map(op, spec);
      expect(authStrategy).toBe("user_token");
      expect(warnings).toHaveLength(0);
    });
  });

  describe("map() — MAPPED: 3.x http/basic → basic_auth", () => {
    it("maps 3.x http/basic scheme to 'basic_auth'", () => {
      const spec = makeSpec3x({
        basicAuth: { type: "http", scheme: "basic" },
      });
      const op = makeOp([{ schemeNames: ["basicAuth"] }]);
      const mapper = new OpenApiSecurityMapper();
      const { authStrategy, warnings } = mapper.map(op, spec);
      expect(authStrategy).toBe("basic_auth");
      expect(warnings).toHaveLength(0);
    });
  });

  describe("map() — MAPPED: 3.x apiKey → api_key", () => {
    it("maps 3.x apiKey scheme in header to 'api_key'", () => {
      const spec = makeSpec3x({
        apiKeyHeader: { type: "apiKey", in: "header", name: "X-API-Key" },
      });
      const op = makeOp([{ schemeNames: ["apiKeyHeader"] }]);
      const mapper = new OpenApiSecurityMapper();
      const { authStrategy } = mapper.map(op, spec);
      expect(authStrategy).toBe("api_key");
    });

    it("maps 3.x apiKey scheme in query to 'api_key'", () => {
      const spec = makeSpec3x({
        apiKeyQuery: { type: "apiKey", in: "query", name: "api_key" },
      });
      const op = makeOp([{ schemeNames: ["apiKeyQuery"] }]);
      const mapper = new OpenApiSecurityMapper();
      const { authStrategy } = mapper.map(op, spec);
      expect(authStrategy).toBe("api_key");
    });

    it("maps 3.x apiKey scheme in cookie to 'api_key'", () => {
      const spec = makeSpec3x({
        apiKeyCookie: { type: "apiKey", in: "cookie", name: "session" },
      });
      const op = makeOp([{ schemeNames: ["apiKeyCookie"] }]);
      const mapper = new OpenApiSecurityMapper();
      const { authStrategy } = mapper.map(op, spec);
      expect(authStrategy).toBe("api_key");
    });
  });

  describe("map() — MAPPED: 2.0 basic → basic_auth", () => {
    it("maps 2.0 type:basic scheme to 'basic_auth'", () => {
      const spec = makeSpec2x({ basicAuth: { type: "basic" } });
      const op = makeOp([{ schemeNames: ["basicAuth"] }]);
      const mapper = new OpenApiSecurityMapper();
      const { authStrategy, warnings } = mapper.map(op, spec);
      expect(authStrategy).toBe("basic_auth");
      expect(warnings).toHaveLength(0);
    });
  });

  describe("map() — MAPPED: 2.0 apiKey → api_key", () => {
    it("maps 2.0 type:apiKey scheme to 'api_key'", () => {
      const spec = makeSpec2x({
        apiKeyAuth: { type: "apiKey", in: "header", name: "X-API-Key" },
      });
      const op = makeOp([{ schemeNames: ["apiKeyAuth"] }]);
      const mapper = new OpenApiSecurityMapper();
      const { authStrategy } = mapper.map(op, spec);
      expect(authStrategy).toBe("api_key");
    });
  });

  describe("map() — UNMAPPED: OAuth2, OIDC, mutualTLS", () => {
    it("leaves authStrategy unset and emits a warning for 3.x oauth2 scheme", () => {
      const spec = makeSpec3x({
        oauth2: {
          type: "oauth2",
          flows: { clientCredentials: { tokenUrl: "https://example.com/token", scopes: {} } },
        },
      });
      const op = makeOp([{ schemeNames: ["oauth2"] }]);
      const mapper = new OpenApiSecurityMapper();
      const { authStrategy, warnings } = mapper.map(op, spec);
      expect(authStrategy).toBeUndefined();
      expect(warnings.length).toBeGreaterThan(0);
    });

    it("leaves authStrategy unset for 3.x openIdConnect scheme", () => {
      const spec = makeSpec3x({
        oidcScheme: { type: "openIdConnect", openIdConnectUrl: "https://example.com/.well-known/openid" },
      });
      const op = makeOp([{ schemeNames: ["oidcScheme"] }]);
      const mapper = new OpenApiSecurityMapper();
      const { authStrategy } = mapper.map(op, spec);
      expect(authStrategy).toBeUndefined();
    });

    it("leaves authStrategy unset for 3.x mutualTLS scheme", () => {
      const spec = makeSpec3x({
        mtlsScheme: { type: "mutualTLS" },
      });
      const op = makeOp([{ schemeNames: ["mtlsScheme"] }]);
      const mapper = new OpenApiSecurityMapper();
      const { authStrategy } = mapper.map(op, spec);
      expect(authStrategy).toBeUndefined();
    });

    it("leaves authStrategy unset for http/digest scheme", () => {
      const spec = makeSpec3x({
        digestAuth: { type: "http", scheme: "digest" },
      });
      const op = makeOp([{ schemeNames: ["digestAuth"] }]);
      const mapper = new OpenApiSecurityMapper();
      const { authStrategy } = mapper.map(op, spec);
      expect(authStrategy).toBeUndefined();
    });

    it("warning for unmapped scheme names the operation path and method", () => {
      const spec = makeSpec3x({
        oauth2: { type: "oauth2", flows: {} },
      });
      const op = makeOp([{ schemeNames: ["oauth2"] }]);
      const mapper = new OpenApiSecurityMapper();
      const { warnings } = mapper.map(op, spec);
      expect(warnings.some((w) => w.includes("/users") || w.includes("GET"))).toBe(true);
    });

    it("warning for unmapped scheme names the scheme itself", () => {
      const spec = makeSpec3x({
        oauth2: { type: "oauth2", flows: {} },
      });
      const op = makeOp([{ schemeNames: ["oauth2"] }]);
      const mapper = new OpenApiSecurityMapper();
      const { warnings } = mapper.map(op, spec);
      expect(warnings.some((w) => w.includes("oauth2"))).toBe(true);
    });
  });

  describe("map() — UNMAPPED: multiple combined schemes", () => {
    it("leaves authStrategy unset and emits a warning when requirement combines multiple scheme names", () => {
      const spec = makeSpec3x({
        bearerAuth: { type: "http", scheme: "bearer" },
        apiKey: { type: "apiKey", in: "header", name: "X-Api-Key" },
      });
      // One requirement with two AND-ed scheme names
      const op = makeOp([{ schemeNames: ["bearerAuth", "apiKey"] }]);
      const mapper = new OpenApiSecurityMapper();
      const { authStrategy, warnings } = mapper.map(op, spec);
      expect(authStrategy).toBeUndefined();
      expect(
        warnings.some((w) => w.toLowerCase().includes("multiple security schemes")),
      ).toBe(true);
    });
  });

  describe("map() — alternative requirements (OR-list length > 1)", () => {
    it("maps the first requirement when there are alternative security requirements", () => {
      const spec = makeSpec3x({
        bearerAuth: { type: "http", scheme: "bearer" },
        apiKey: { type: "apiKey", in: "header", name: "X-Api-Key" },
      });
      // Two alternative requirements (OR-list)
      const op = makeOp([
        { schemeNames: ["bearerAuth"] },
        { schemeNames: ["apiKey"] },
      ]);
      const mapper = new OpenApiSecurityMapper();
      const { authStrategy, warnings } = mapper.map(op, spec);
      // First is mapped; alternatives warning emitted
      expect(authStrategy).toBe("user_token");
      expect(
        warnings.some((w) => w.toLowerCase().includes("alternative")),
      ).toBe(true);
    });
  });

  describe("map() — unresolvable scheme name", () => {
    it("leaves authStrategy unset when the scheme name is not in securitySchemes", () => {
      const spec = makeSpec3x({}); // No schemes defined
      const op = makeOp([{ schemeNames: ["nonExistentScheme"] }]);
      const mapper = new OpenApiSecurityMapper();
      const { authStrategy, warnings } = mapper.map(op, spec);
      expect(authStrategy).toBeUndefined();
      expect(warnings.length).toBeGreaterThan(0);
    });
  });

  describe("map() — no security requirement", () => {
    it("returns authStrategy undefined and no warnings when op.security is undefined", () => {
      const spec = makeSpec3x({ bearerAuth: { type: "http", scheme: "bearer" } });
      const op = makeOp(undefined);
      const mapper = new OpenApiSecurityMapper();
      const { authStrategy, warnings } = mapper.map(op, spec);
      expect(authStrategy).toBeUndefined();
      expect(warnings).toHaveLength(0);
    });
  });

  describe("map() — explicit empty security: []", () => {
    it("returns authStrategy undefined and no warnings when op.security is explicitly empty []", () => {
      const spec = makeSpec3x({ bearerAuth: { type: "http", scheme: "bearer" } });
      const op = makeOp([]);
      const mapper = new OpenApiSecurityMapper();
      const { authStrategy, warnings } = mapper.map(op, spec);
      expect(authStrategy).toBeUndefined();
      expect(warnings).toHaveLength(0);
    });
  });

  describe("map() — empty schemeNames in security requirement ({})", () => {
    it("returns no authStrategy and no warning when first requirement has empty schemeNames", () => {
      // security: [{}] — the object has zero keys → schemeNames.length === 0
      const spec = makeSpec3x({ bearerAuth: { type: "http", scheme: "bearer" } });
      const op = makeOp([{ schemeNames: [] }]);
      const mapper = new OpenApiSecurityMapper();
      const { authStrategy, warnings } = mapper.map(op, spec);
      expect(authStrategy).toBeUndefined();
      expect(warnings).toHaveLength(0);
    });
  });

  describe("map() — UNMAPPED: 2.0 oauth2 scheme", () => {
    it("leaves authStrategy unset and emits a warning for 2.0 oauth2 scheme — unmapped branch", () => {
      const spec = makeSpec2x({
        oauth2: {
          type: "oauth2",
          flow: "implicit",
          authorizationUrl: "https://example.com/auth",
          scopes: {},
        },
      });
      const op = makeOp([{ schemeNames: ["oauth2"] }]);
      const mapper = new OpenApiSecurityMapper();
      const { authStrategy, warnings } = mapper.map(op, spec);
      expect(authStrategy).toBeUndefined();
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings.some((w) => w.includes("oauth2"))).toBe(true);
    });
  });

  describe("map() — authStrategy field contract", () => {
    it("authStrategy is strictly undefined (not empty string) when no mapping applies", () => {
      const spec = makeSpec3x({ oauth2: { type: "oauth2", flows: {} } });
      const op = makeOp([{ schemeNames: ["oauth2"] }]);
      const mapper = new OpenApiSecurityMapper();
      const { authStrategy } = mapper.map(op, spec);
      // Must be undefined, never ""
      expect(authStrategy).toBeUndefined();
      expect(authStrategy).not.toBe("");
    });

    it("returns {authStrategy?, warnings} shape and never throws", () => {
      const spec = makeSpec3x();
      const op = makeOp(undefined);
      const mapper = new OpenApiSecurityMapper();
      expect(() => mapper.map(op, spec)).not.toThrow();
      const result = mapper.map(op, spec);
      expect("warnings" in result).toBe(true);
      expect(Array.isArray(result.warnings)).toBe(true);
    });
  });
});
