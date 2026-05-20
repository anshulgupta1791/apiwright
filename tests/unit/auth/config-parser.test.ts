/**
 * Unit tests for `src/auth/config-parser.ts` — the per-entry auth strategy
 * config parser / validator.
 *
 * Encodes every behavior promised by the design (§6 Layer B):
 * - ValidatedStaticTokenSpec and ValidatedTokenEndpointSpec output shapes
 * - All validation rules per arm (§6.1 / §6.2)
 * - Unknown / missing `type` discriminant (§6.3)
 * - D14: `credentials` exactly `{username, password}`
 * - D15: `grant_type` / `pkce` / extra credentials key → v1.5 deferral
 * - D16: `header_value` placeholder rules — only `${token}` honored
 * - D7: header / header_value defaults
 * - D6: `refresh_buffer_seconds` non-negative default 30
 * - Purity / determinism
 * - Message-leak prevention (no credential context in error messages)
 * - Fuzz: parser never throws on any shaped input
 *
 * RED PHASE: `src/auth/config-parser.ts` does not exist yet. Every import
 * will fail with MODULE_NOT_FOUND. Run `npm test tests/unit/auth/config-parser`
 * to confirm all tests are listed as failing due to import error.
 *
 * Skip categories: no integration tests (pure function, no I/O, no network,
 * no DB). No fixtures required. No MSW.
 *
 * Coverage obligation: 100% branch coverage of `src/auth/config-parser.ts`
 * once the implementation lands (design §10). The test surface below covers
 * every branch enumerated in the design (§8 / §10).
 * @module
 */

import { describe, it, expect } from "vitest";

import {
  parseAuthStrategyConfig,
  ValidatedStaticTokenSpec,   // eslint-disable-line @typescript-eslint/no-unused-vars
  ValidatedTokenEndpointSpec, // eslint-disable-line @typescript-eslint/no-unused-vars
  ValidatedStrategySpec,      // eslint-disable-line @typescript-eslint/no-unused-vars
} from "../../../src/auth/config-parser.js";

// Layer A siblings — imported for type-narrowing and assertion helpers.
// These modules also do not exist yet; the import fail is expected.
import {
  AUTH_ERROR_CODES,
  AuthStrategyError,
  isAuthStrategyError,
} from "../../../src/auth/errors.js";

import type { AuthStrategyConfig } from "../../../src/env/types.js";
import type { ParsedJsonPath } from "../../../src/auth/jsonpath-subset.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Builds a minimal valid `static_token` raw config with overrides applied.
 * The base satisfies all required fields; callers spread in extra keys to
 * exercise specific validation branches.
 * @param overrides - Partial raw config merged on top of the base.
 * @returns A raw `AuthStrategyConfig` shaped object for passing to the parser.
 */
function staticTokenBase(
  overrides: Record<string, unknown> = {},
): AuthStrategyConfig {
  return { type: "static_token", token: "abc123", ...overrides };
}

/**
 * Builds a minimal valid `token_endpoint` raw config with overrides applied.
 * @param overrides - Partial raw config merged on top of the base.
 * @returns A raw `AuthStrategyConfig` shaped object.
 */
function tokenEndpointBase(
  overrides: Record<string, unknown> = {},
): AuthStrategyConfig {
  return {
    type: "token_endpoint",
    url: "https://auth.example.com/token",
    credentials: { username: "u", password: "p" },
    token_path: "$.access_token",
    ...overrides,
  };
}

/**
 * Asserts that the result is an `AuthStrategyError` with specific properties.
 * @param result - The value returned by `parseAuthStrategyConfig`.
 * @param code - The expected `AuthErrorCode`.
 * @param messageFragments - Substrings that MUST appear in `e.message`.
 * @returns The narrowed `AuthStrategyError` for further assertions.
 */
function assertError(
  result: ValidatedStrategySpec | AuthStrategyError,
  code: string,
  messageFragments: readonly string[] = [],
): AuthStrategyError {
  expect(isAuthStrategyError(result)).toBe(true);
  const e = result as AuthStrategyError;
  expect(e.code).toBe(code);
  expect(e.phase).toBe("config");
  for (const fragment of messageFragments) {
    expect(e.message).toContain(fragment);
  }
  return e;
}

/**
 * Asserts that an error message does not contain any of the given forbidden
 * substrings (leak-prevention contract).
 * @param message - The error message under test.
 * @param forbidden - Substrings that must NOT appear.
 */
function assertNoLeak(message: string, forbidden: readonly string[]): void {
  for (const s of forbidden) {
    expect(message).not.toContain(s);
  }
}

// ---------------------------------------------------------------------------
// §1: Export surface — structural type checks
// ---------------------------------------------------------------------------

describe("parseAuthStrategyConfig — exported symbol availability", () => {
  it("exports parseAuthStrategyConfig as a function", () => {
    expect(typeof parseAuthStrategyConfig).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// §2: Positive — static_token arm (AC#2, §10.1)
// ---------------------------------------------------------------------------

describe("parseAuthStrategyConfig — static_token happy paths", () => {
  it("returns ValidatedStaticTokenSpec with defaults when only type+token supplied", () => {
    const result = parseAuthStrategyConfig("my_strategy", staticTokenBase());
    expect(isAuthStrategyError(result)).toBe(false);
    const spec = result as ValidatedStaticTokenSpec;
    expect(spec.kind).toBe("static_token");
    expect(spec.name).toBe("my_strategy");
    expect(spec.token).toBe("abc123");
    expect(spec.header).toBe("Authorization");
    expect(spec.headerValue).toBe("Bearer ${token}");
  });

  it("preserves custom header when provided", () => {
    const result = parseAuthStrategyConfig(
      "custom_header",
      staticTokenBase({ header: "X-Auth" }),
    );
    expect(isAuthStrategyError(result)).toBe(false);
    const spec = result as ValidatedStaticTokenSpec;
    expect(spec.header).toBe("X-Auth");
    expect(spec.headerValue).toBe("Bearer ${token}");
  });

  it("preserves custom header_value when provided", () => {
    const result = parseAuthStrategyConfig(
      "custom_hv",
      staticTokenBase({ header_value: "Token ${token}" }),
    );
    expect(isAuthStrategyError(result)).toBe(false);
    const spec = result as ValidatedStaticTokenSpec;
    expect(spec.header).toBe("Authorization");
    expect(spec.headerValue).toBe("Token ${token}");
  });

  it("accepts header_value with no placeholder (attached verbatim per D16 edge case)", () => {
    const result = parseAuthStrategyConfig(
      "no_placeholder",
      staticTokenBase({ header_value: "Basic Zm9v" }),
    );
    expect(isAuthStrategyError(result)).toBe(false);
    const spec = result as ValidatedStaticTokenSpec;
    expect(spec.headerValue).toBe("Basic Zm9v");
  });

  it("accepts header_value with multiple ${token} placeholders", () => {
    const result = parseAuthStrategyConfig(
      "multi_token",
      staticTokenBase({ header_value: "Bearer ${token}, ID ${token}" }),
    );
    expect(isAuthStrategyError(result)).toBe(false);
    const spec = result as ValidatedStaticTokenSpec;
    expect(spec.headerValue).toBe("Bearer ${token}, ID ${token}");
  });

  it("spec fields are all readonly (kind, name, token, header, headerValue present)", () => {
    const result = parseAuthStrategyConfig("ro_check", staticTokenBase());
    expect(isAuthStrategyError(result)).toBe(false);
    const spec = result as ValidatedStaticTokenSpec;
    // All five fields defined by the interface must be present
    expect(Object.prototype.hasOwnProperty.call(spec, "kind")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(spec, "name")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(spec, "token")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(spec, "header")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(spec, "headerValue")).toBe(true);
  });

  it("treats null header as absent and applies the default", () => {
    const result = parseAuthStrategyConfig(
      "null_header",
      staticTokenBase({ header: null }),
    );
    expect(isAuthStrategyError(result)).toBe(false);
    const spec = result as ValidatedStaticTokenSpec;
    expect(spec.header).toBe("Authorization");
  });

  it("treats null header_value as absent and applies the default", () => {
    const result = parseAuthStrategyConfig(
      "null_hv",
      staticTokenBase({ header_value: null }),
    );
    expect(isAuthStrategyError(result)).toBe(false);
    const spec = result as ValidatedStaticTokenSpec;
    expect(spec.headerValue).toBe("Bearer ${token}");
  });
});

// ---------------------------------------------------------------------------
// §3: Positive — token_endpoint arm (AC#3, §10.2)
// ---------------------------------------------------------------------------

describe("parseAuthStrategyConfig — token_endpoint happy paths", () => {
  it("returns ValidatedTokenEndpointSpec with all required fields populated", () => {
    const result = parseAuthStrategyConfig("te_full", tokenEndpointBase());
    expect(isAuthStrategyError(result)).toBe(false);
    const spec = result as ValidatedTokenEndpointSpec;
    expect(spec.kind).toBe("token_endpoint");
    expect(spec.name).toBe("te_full");
    expect(spec.url).toBe("https://auth.example.com/token");
    expect(spec.username).toBe("u");
    expect(spec.password).toBe("p");
    expect(spec.header).toBe("Authorization");
    expect(spec.headerValue).toBe("Bearer ${token}");
    expect(spec.refreshBufferSeconds).toBe(30);
    expect(spec.expiresInPath).toBeUndefined();
  });

  it("populates tokenPath as a ParsedJsonPath (array of segments) for $.access_token", () => {
    const result = parseAuthStrategyConfig("te_path", tokenEndpointBase());
    expect(isAuthStrategyError(result)).toBe(false);
    const spec = result as ValidatedTokenEndpointSpec;
    // $.access_token → [{kind:"key", key:"access_token"}]
    expect(Array.isArray(spec.tokenPath)).toBe(true);
    expect((spec.tokenPath).length).toBe(1);
    const segment = (spec.tokenPath)[0];
    expect(segment).toBeDefined();
    if (segment !== undefined) {
      expect(segment.kind).toBe("key");
      if (segment.kind === "key") {
        expect(segment.key).toBe("access_token");
      }
    }
  });

  it("populates expiresInPath when expires_in_path is provided", () => {
    const result = parseAuthStrategyConfig(
      "te_expires",
      tokenEndpointBase({ expires_in_path: "$.expires_in" }),
    );
    expect(isAuthStrategyError(result)).toBe(false);
    const spec = result as ValidatedTokenEndpointSpec;
    expect(spec.expiresInPath).toBeDefined();
    expect(Array.isArray(spec.expiresInPath)).toBe(true);
  });

  it("applies refresh_buffer_seconds: 60 when supplied", () => {
    const result = parseAuthStrategyConfig(
      "te_buf60",
      tokenEndpointBase({ refresh_buffer_seconds: 60 }),
    );
    expect(isAuthStrategyError(result)).toBe(false);
    const spec = result as ValidatedTokenEndpointSpec;
    expect(spec.refreshBufferSeconds).toBe(60);
  });

  it("accepts refresh_buffer_seconds: 0 (boundary; >= 0 is valid per §9(h))", () => {
    const result = parseAuthStrategyConfig(
      "te_buf0",
      tokenEndpointBase({ refresh_buffer_seconds: 0 }),
    );
    expect(isAuthStrategyError(result)).toBe(false);
    const spec = result as ValidatedTokenEndpointSpec;
    expect(spec.refreshBufferSeconds).toBe(0);
  });

  it("accepts credentials with password before username (key order irrelevant)", () => {
    const result = parseAuthStrategyConfig(
      "te_reverse_creds",
      tokenEndpointBase({ credentials: { password: "p", username: "u" } }),
    );
    expect(isAuthStrategyError(result)).toBe(false);
    const spec = result as ValidatedTokenEndpointSpec;
    expect(spec.username).toBe("u");
    expect(spec.password).toBe("p");
  });

  it("applies header default Authorization when header is absent", () => {
    const result = parseAuthStrategyConfig("te_hdr_default", tokenEndpointBase());
    expect(isAuthStrategyError(result)).toBe(false);
    expect((result as ValidatedTokenEndpointSpec).header).toBe("Authorization");
  });

  it("applies header_value default 'Bearer ${token}' when header_value is absent", () => {
    const result = parseAuthStrategyConfig("te_hv_default", tokenEndpointBase());
    expect(isAuthStrategyError(result)).toBe(false);
    expect((result as ValidatedTokenEndpointSpec).headerValue).toBe("Bearer ${token}");
  });

  it("applies refresh_buffer_seconds default 30 when field is absent", () => {
    const result = parseAuthStrategyConfig("te_rbs_default", tokenEndpointBase());
    expect(isAuthStrategyError(result)).toBe(false);
    expect((result as ValidatedTokenEndpointSpec).refreshBufferSeconds).toBe(30);
  });

  it("treats null expires_in_path as absent (coerceOptional)", () => {
    const result = parseAuthStrategyConfig(
      "te_null_eip",
      tokenEndpointBase({ expires_in_path: null }),
    );
    expect(isAuthStrategyError(result)).toBe(false);
    expect((result as ValidatedTokenEndpointSpec).expiresInPath).toBeUndefined();
  });

  it("treats null refresh_buffer_seconds as absent and applies default 30", () => {
    const result = parseAuthStrategyConfig(
      "te_null_rbs",
      tokenEndpointBase({ refresh_buffer_seconds: null }),
    );
    expect(isAuthStrategyError(result)).toBe(false);
    expect((result as ValidatedTokenEndpointSpec).refreshBufferSeconds).toBe(30);
  });

  it("spec fields present: kind name url username password tokenPath header headerValue refreshBufferSeconds", () => {
    const result = parseAuthStrategyConfig("te_fields", tokenEndpointBase());
    expect(isAuthStrategyError(result)).toBe(false);
    const spec = result as ValidatedTokenEndpointSpec;
    const required = [
      "kind", "name", "url", "username", "password",
      "tokenPath", "header", "headerValue", "refreshBufferSeconds",
    ] as const;
    for (const field of required) {
      expect(Object.prototype.hasOwnProperty.call(spec, field)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// §4: Negative — static_token arm (AC#2 / AC#4 / AC#5, §10.3)
// ---------------------------------------------------------------------------

describe("parseAuthStrategyConfig — static_token rejection paths", () => {
  it("rejects when token field is absent", () => {
    const raw = { type: "static_token" } as unknown as AuthStrategyConfig;
    const result = parseAuthStrategyConfig("s_no_token", raw);
    assertError(result, AUTH_ERROR_CODES.AUTH_CONFIG_INVALID, ["s_no_token", "token"]);
  });

  it("rejects when token is an empty string", () => {
    const result = parseAuthStrategyConfig("s_empty_token", staticTokenBase({ token: "" }));
    assertError(result, AUTH_ERROR_CODES.AUTH_CONFIG_INVALID, ["s_empty_token"]);
  });

  it("rejects when token has leading whitespace", () => {
    const result = parseAuthStrategyConfig(
      "s_ws_token",
      staticTokenBase({ token: " abc" }),
    );
    assertError(result, AUTH_ERROR_CODES.AUTH_CONFIG_INVALID, ["s_ws_token"]);
  });

  it("rejects when token has trailing whitespace", () => {
    const result = parseAuthStrategyConfig(
      "s_trailing_ws",
      staticTokenBase({ token: "abc " }),
    );
    assertError(result, AUTH_ERROR_CODES.AUTH_CONFIG_INVALID, ["s_trailing_ws"]);
  });

  it("rejects when url is present on a static_token entry", () => {
    const result = parseAuthStrategyConfig(
      "s_has_url",
      staticTokenBase({ url: "https://example.com" }),
    );
    assertError(result, AUTH_ERROR_CODES.AUTH_CONFIG_INVALID, ["s_has_url", "url"]);
  });

  it("rejects when credentials is present on a static_token entry", () => {
    const result = parseAuthStrategyConfig(
      "s_has_creds",
      staticTokenBase({ credentials: { username: "u", password: "p" } }),
    );
    assertError(result, AUTH_ERROR_CODES.AUTH_CONFIG_INVALID, ["s_has_creds", "credentials"]);
  });

  it("rejects when token_path is present on a static_token entry", () => {
    const result = parseAuthStrategyConfig(
      "s_has_tp",
      staticTokenBase({ token_path: "$.access_token" }),
    );
    assertError(result, AUTH_ERROR_CODES.AUTH_CONFIG_INVALID, ["s_has_tp", "token_path"]);
  });

  it("rejects when expires_in_path is present on a static_token entry", () => {
    const result = parseAuthStrategyConfig(
      "s_has_eip",
      staticTokenBase({ expires_in_path: "$.expires_in" }),
    );
    assertError(result, AUTH_ERROR_CODES.AUTH_CONFIG_INVALID, ["s_has_eip"]);
  });

  it("rejects when refresh_buffer_seconds is present on a static_token entry", () => {
    const result = parseAuthStrategyConfig(
      "s_has_rbs",
      staticTokenBase({ refresh_buffer_seconds: 60 }),
    );
    assertError(result, AUTH_ERROR_CODES.AUTH_CONFIG_INVALID, ["s_has_rbs"]);
  });

  it("rejects grant_type on static_token entry with v1.5 deferral message (D15)", () => {
    const result = parseAuthStrategyConfig(
      "s_grant",
      staticTokenBase({ grant_type: "refresh_token" }),
    );
    const e = assertError(result, AUTH_ERROR_CODES.AUTH_CONFIG_INVALID, [
      "s_grant",
      "grant_type",
      "v1.5",
    ]);
    expect(e.message).toContain("not supported");
  });

  it("rejects pkce on static_token entry with v1.5 deferral message (D15)", () => {
    const result = parseAuthStrategyConfig(
      "s_pkce",
      staticTokenBase({ pkce: {} }),
    );
    const e = assertError(result, AUTH_ERROR_CODES.AUTH_CONFIG_INVALID, [
      "s_pkce",
      "pkce",
      "v1.5",
    ]);
    expect(e.message).toContain("not supported");
  });

  it("rejects when header_value is an empty string (§9(i))", () => {
    const result = parseAuthStrategyConfig(
      "s_empty_hv",
      staticTokenBase({ header_value: "" }),
    );
    assertError(result, AUTH_ERROR_CODES.AUTH_CONFIG_INVALID, ["s_empty_hv"]);
  });

  it("rejects when header is an empty string", () => {
    const result = parseAuthStrategyConfig(
      "s_empty_header",
      staticTokenBase({ header: "" }),
    );
    assertError(result, AUTH_ERROR_CODES.AUTH_CONFIG_INVALID, ["s_empty_header"]);
  });

  it("rejects when header has leading whitespace", () => {
    const result = parseAuthStrategyConfig(
      "s_ws_header",
      staticTokenBase({ header: " Authorization" }),
    );
    assertError(result, AUTH_ERROR_CODES.AUTH_CONFIG_INVALID, ["s_ws_header"]);
  });

  it("rejects header_value with ${secret.X} placeholder and uses AUTH_HEADER_TEMPLATE_INVALID", () => {
    const result = parseAuthStrategyConfig(
      "s_secret_ph",
      staticTokenBase({ header_value: "Bearer ${secret.X}" }),
    );
    assertError(result, AUTH_ERROR_CODES.AUTH_HEADER_TEMPLATE_INVALID, [
      "s_secret_ph",
      "secret.X",
    ]);
  });

  it("rejects header_value with ${env.X} placeholder", () => {
    const result = parseAuthStrategyConfig(
      "s_env_ph",
      staticTokenBase({ header_value: "Bearer ${env.X}" }),
    );
    assertError(result, AUTH_ERROR_CODES.AUTH_HEADER_TEMPLATE_INVALID, [
      "s_env_ph",
      "env.X",
    ]);
  });

  it("rejects header_value with ${request.foo} placeholder", () => {
    const result = parseAuthStrategyConfig(
      "s_req_ph",
      staticTokenBase({ header_value: "Bearer ${request.foo}" }),
    );
    assertError(result, AUTH_ERROR_CODES.AUTH_HEADER_TEMPLATE_INVALID, [
      "s_req_ph",
      "request.foo",
    ]);
  });

  it("rejects header_value with ${refresh_token} placeholder (non-token inner name)", () => {
    const result = parseAuthStrategyConfig(
      "s_refresh_ph",
      staticTokenBase({ header_value: "Bearer ${refresh_token}" }),
    );
    assertError(result, AUTH_ERROR_CODES.AUTH_HEADER_TEMPLATE_INVALID, [
      "s_refresh_ph",
    ]);
  });

  it("rejects header_value with ${ token } placeholder (whitespace differs from ${token})", () => {
    const result = parseAuthStrategyConfig(
      "s_ws_ph",
      staticTokenBase({ header_value: "Bearer ${ token }" }),
    );
    assertError(result, AUTH_ERROR_CODES.AUTH_HEADER_TEMPLATE_INVALID, [
      "s_ws_ph",
    ]);
  });

  it("rejects header value with unsupported placeholder but message NEVER includes surrounding header_value context", () => {
    const result = parseAuthStrategyConfig(
      "s_leak_check",
      staticTokenBase({ header_value: "Bearer ${secret_LEAK_xyz}" }),
    );
    const e = assertError(result, AUTH_ERROR_CODES.AUTH_HEADER_TEMPLATE_INVALID, [
      "s_leak_check",
      "secret_LEAK_xyz",
    ]);
    // The message must name the placeholder inner text but NEVER the surrounding context
    assertNoLeak(e.message, [
      "Bearer Bearer",  // the outer "Bearer " must not be echoed as context
    ]);
    // The message must name the inner placeholder, not the surrounding value
    expect(e.message).not.toMatch(/Bearer .{8,}/);
  });
});

// ---------------------------------------------------------------------------
// §5: Negative — token_endpoint arm (AC#3 / AC#4, §10.4)
// ---------------------------------------------------------------------------

describe("parseAuthStrategyConfig — token_endpoint rejection paths", () => {
  it("rejects when url is missing", () => {
    const raw = {
      type: "token_endpoint",
      credentials: { username: "u", password: "p" },
      token_path: "$.access_token",
    } as unknown as AuthStrategyConfig;
    const result = parseAuthStrategyConfig("te_no_url", raw);
    assertError(result, AUTH_ERROR_CODES.AUTH_CONFIG_INVALID, ["te_no_url", "url"]);
  });

  it("rejects when url is an empty string", () => {
    const result = parseAuthStrategyConfig("te_empty_url", tokenEndpointBase({ url: "" }));
    assertError(result, AUTH_ERROR_CODES.AUTH_CONFIG_INVALID, ["te_empty_url"]);
  });

  it("rejects when url has leading whitespace", () => {
    const result = parseAuthStrategyConfig(
      "te_ws_url",
      tokenEndpointBase({ url: " https://auth.example.com/token" }),
    );
    assertError(result, AUTH_ERROR_CODES.AUTH_CONFIG_INVALID, ["te_ws_url"]);
  });

  it("rejects when credentials is missing", () => {
    const raw = {
      type: "token_endpoint",
      url: "https://auth.example.com/token",
      token_path: "$.access_token",
    } as unknown as AuthStrategyConfig;
    const result = parseAuthStrategyConfig("te_no_creds", raw);
    assertError(result, AUTH_ERROR_CODES.AUTH_CONFIG_INVALID, ["te_no_creds"]);
  });

  it("rejects when credentials is an empty object (missing username+password)", () => {
    const result = parseAuthStrategyConfig(
      "te_empty_creds",
      tokenEndpointBase({ credentials: {} }),
    );
    const e = assertError(result, AUTH_ERROR_CODES.AUTH_CONFIG_INVALID, ["te_empty_creds"]);
    expect(e.message.toLowerCase()).toMatch(/username|password/);
  });

  it("rejects when credentials has username but no password", () => {
    const result = parseAuthStrategyConfig(
      "te_no_pass",
      tokenEndpointBase({ credentials: { username: "u" } }),
    );
    assertError(result, AUTH_ERROR_CODES.AUTH_CONFIG_INVALID, ["te_no_pass"]);
  });

  it("rejects when credentials has password but no username", () => {
    const result = parseAuthStrategyConfig(
      "te_no_user",
      tokenEndpointBase({ credentials: { password: "p" } }),
    );
    assertError(result, AUTH_ERROR_CODES.AUTH_CONFIG_INVALID, ["te_no_user"]);
  });

  it("rejects when credentials has an extra key (D14 — names the offending key, v1.5 deferral)", () => {
    const result = parseAuthStrategyConfig(
      "te_extra_key",
      tokenEndpointBase({
        credentials: { username: "u", password: "p", client_id: "x" },
      }),
    );
    const e = assertError(result, AUTH_ERROR_CODES.AUTH_CONFIG_INVALID, [
      "te_extra_key",
      "client_id",
      "v1.5",
    ]);
    expect(e.message).toContain("not supported");
  });

  it("rejects when credentials.username is an empty string", () => {
    const result = parseAuthStrategyConfig(
      "te_empty_user",
      tokenEndpointBase({ credentials: { username: "", password: "p" } }),
    );
    assertError(result, AUTH_ERROR_CODES.AUTH_CONFIG_INVALID, ["te_empty_user"]);
  });

  it("rejects when credentials.password is an empty string", () => {
    const result = parseAuthStrategyConfig(
      "te_empty_pass",
      tokenEndpointBase({ credentials: { username: "u", password: "" } }),
    );
    assertError(result, AUTH_ERROR_CODES.AUTH_CONFIG_INVALID, ["te_empty_pass"]);
  });

  it("rejects when credentials is an array (§9(g))", () => {
    const result = parseAuthStrategyConfig(
      "te_arr_creds",
      tokenEndpointBase({ credentials: ["u", "p"] }),
    );
    assertError(result, AUTH_ERROR_CODES.AUTH_CONFIG_INVALID, ["te_arr_creds"]);
  });

  it("rejects when token_path is missing", () => {
    const raw = {
      type: "token_endpoint",
      url: "https://auth.example.com/token",
      credentials: { username: "u", password: "p" },
    } as unknown as AuthStrategyConfig;
    const result = parseAuthStrategyConfig("te_no_tp", raw);
    assertError(result, AUTH_ERROR_CODES.AUTH_CONFIG_INVALID, ["te_no_tp"]);
  });

  it("rejects when token_path is an empty string", () => {
    const result = parseAuthStrategyConfig(
      "te_empty_tp",
      tokenEndpointBase({ token_path: "" }),
    );
    assertError(result, AUTH_ERROR_CODES.AUTH_CONFIG_INVALID, ["te_empty_tp"]);
  });

  it("rejects when token_path uses recursive descent (bubbles from parseJsonPath)", () => {
    const result = parseAuthStrategyConfig(
      "te_rec_tp",
      tokenEndpointBase({ token_path: "$..token" }),
    );
    assertError(result, AUTH_ERROR_CODES.AUTH_CONFIG_INVALID, ["te_rec_tp"]);
  });

  it("rejects when expires_in_path uses wildcard (bubbles from parseJsonPath)", () => {
    const result = parseAuthStrategyConfig(
      "te_wild_eip",
      tokenEndpointBase({ expires_in_path: "$.foo[*]" }),
    );
    assertError(result, AUTH_ERROR_CODES.AUTH_CONFIG_INVALID, ["te_wild_eip"]);
  });

  it("rejects refresh_buffer_seconds: -1 (negative)", () => {
    const result = parseAuthStrategyConfig(
      "te_neg_rbs",
      tokenEndpointBase({ refresh_buffer_seconds: -1 }),
    );
    assertError(result, AUTH_ERROR_CODES.AUTH_CONFIG_INVALID, ["te_neg_rbs"]);
  });

  it("rejects refresh_buffer_seconds: NaN", () => {
    const result = parseAuthStrategyConfig(
      "te_nan_rbs",
      tokenEndpointBase({ refresh_buffer_seconds: Number.NaN }),
    );
    assertError(result, AUTH_ERROR_CODES.AUTH_CONFIG_INVALID, ["te_nan_rbs"]);
  });

  it("rejects refresh_buffer_seconds: Infinity", () => {
    const result = parseAuthStrategyConfig(
      "te_inf_rbs",
      tokenEndpointBase({ refresh_buffer_seconds: Infinity }),
    );
    assertError(result, AUTH_ERROR_CODES.AUTH_CONFIG_INVALID, ["te_inf_rbs"]);
  });

  it("rejects refresh_buffer_seconds: '30' (string, not a number)", () => {
    const result = parseAuthStrategyConfig(
      "te_str_rbs",
      tokenEndpointBase({ refresh_buffer_seconds: "30" }),
    );
    assertError(result, AUTH_ERROR_CODES.AUTH_CONFIG_INVALID, ["te_str_rbs"]);
  });

  it("rejects grant_type on token_endpoint entry with v1.5 deferral message (D15)", () => {
    const result = parseAuthStrategyConfig(
      "te_grant",
      tokenEndpointBase({ grant_type: "client_credentials" }),
    );
    const e = assertError(result, AUTH_ERROR_CODES.AUTH_CONFIG_INVALID, [
      "te_grant",
      "grant_type",
      "v1.5",
    ]);
    expect(e.message).toContain("not supported");
  });

  it("rejects pkce on token_endpoint entry with v1.5 deferral message (D15)", () => {
    const result = parseAuthStrategyConfig(
      "te_pkce",
      tokenEndpointBase({ pkce: { challenge: "abc" } }),
    );
    const e = assertError(result, AUTH_ERROR_CODES.AUTH_CONFIG_INVALID, [
      "te_pkce",
      "pkce",
      "v1.5",
    ]);
    expect(e.message).toContain("not supported");
  });

  it("rejects when token is present on a token_endpoint entry", () => {
    const result = parseAuthStrategyConfig(
      "te_has_token",
      tokenEndpointBase({ token: "x" }),
    );
    assertError(result, AUTH_ERROR_CODES.AUTH_CONFIG_INVALID, ["te_has_token", "token"]);
  });

  it("rejects header_value with ${refresh_token} on token_endpoint", () => {
    const result = parseAuthStrategyConfig(
      "te_bad_ph",
      tokenEndpointBase({ header_value: "Bearer ${refresh_token}" }),
    );
    assertError(result, AUTH_ERROR_CODES.AUTH_HEADER_TEMPLATE_INVALID, ["te_bad_ph"]);
  });
});

// ---------------------------------------------------------------------------
// §6: Negative — type discriminant (AC#6, §10.5)
// ---------------------------------------------------------------------------

describe("parseAuthStrategyConfig — unknown / missing type discriminant", () => {
  it("returns AUTH_CONFIG_INVALID with 'missing required field type' for undefined type", () => {
    const raw = { type: undefined } as unknown as AuthStrategyConfig;
    const e = assertError(
      parseAuthStrategyConfig("d_undef", raw),
      AUTH_ERROR_CODES.AUTH_CONFIG_INVALID,
      ["d_undef"],
    );
    expect(e.message).toContain("type");
    expect(e.message.toLowerCase()).toContain("missing");
  });

  it("returns AUTH_CONFIG_INVALID with v1.5 deferral for oauth_user_flow type", () => {
    const raw = { type: "oauth_user_flow" } as unknown as AuthStrategyConfig;
    const e = assertError(
      parseAuthStrategyConfig("d_ouf", raw),
      AUTH_ERROR_CODES.AUTH_CONFIG_INVALID,
      ["d_ouf", "v1.5"],
    );
    expect(e.message).toContain("oauth_user_flow");
  });

  it("returns AUTH_CONFIG_INVALID with v1.5 deferral for session_cookie type", () => {
    const raw = { type: "session_cookie" } as unknown as AuthStrategyConfig;
    const e = assertError(
      parseAuthStrategyConfig("d_sc", raw),
      AUTH_ERROR_CODES.AUTH_CONFIG_INVALID,
      ["d_sc", "v1.5"],
    );
    expect(e.message).toContain("session_cookie");
  });

  it("returns AUTH_CONFIG_INVALID with v1.5 deferral for hmac_sigv4 type", () => {
    const raw = { type: "hmac_sigv4" } as unknown as AuthStrategyConfig;
    const e = assertError(
      parseAuthStrategyConfig("d_hmac", raw),
      AUTH_ERROR_CODES.AUTH_CONFIG_INVALID,
      ["d_hmac", "v1.5"],
    );
    expect(e.message).toContain("hmac_sigv4");
  });

  it("distinguishes missing type message from unknown type message", () => {
    const missingRaw = { type: undefined } as unknown as AuthStrategyConfig;
    const unknownRaw = { type: "oauth_user_flow" } as unknown as AuthStrategyConfig;
    const missingErr = parseAuthStrategyConfig("n_missing", missingRaw) as AuthStrategyError;
    const unknownErr = parseAuthStrategyConfig("n_unknown", unknownRaw) as AuthStrategyError;
    expect(isAuthStrategyError(missingErr)).toBe(true);
    expect(isAuthStrategyError(unknownErr)).toBe(true);
    // The messages must be different (distinct human-readable messages per §6.3)
    expect(missingErr.message).not.toBe(unknownErr.message);
    expect(missingErr.message.toLowerCase()).toContain("missing");
  });
});

// ---------------------------------------------------------------------------
// §7: Defaults pinned (AC#2 / AC#3 / D7 / D6, §10.6)
// ---------------------------------------------------------------------------

describe("parseAuthStrategyConfig — defaults applied", () => {
  it("static_token: absent header → 'Authorization'", () => {
    const spec = parseAuthStrategyConfig("df_st_h", staticTokenBase()) as ValidatedStaticTokenSpec;
    expect(spec.header).toBe("Authorization");
  });

  it("static_token: absent header_value → \"Bearer ${token}\"", () => {
    const spec = parseAuthStrategyConfig(
      "df_st_hv",
      staticTokenBase(),
    ) as ValidatedStaticTokenSpec;
    expect(spec.headerValue).toBe("Bearer ${token}");
  });

  it("token_endpoint: absent header → 'Authorization'", () => {
    const spec = parseAuthStrategyConfig(
      "df_te_h",
      tokenEndpointBase(),
    ) as ValidatedTokenEndpointSpec;
    expect(spec.header).toBe("Authorization");
  });

  it("token_endpoint: absent header_value → \"Bearer ${token}\"", () => {
    const spec = parseAuthStrategyConfig(
      "df_te_hv",
      tokenEndpointBase(),
    ) as ValidatedTokenEndpointSpec;
    expect(spec.headerValue).toBe("Bearer ${token}");
  });

  it("token_endpoint: absent refresh_buffer_seconds → 30", () => {
    const spec = parseAuthStrategyConfig(
      "df_te_rbs",
      tokenEndpointBase(),
    ) as ValidatedTokenEndpointSpec;
    expect(spec.refreshBufferSeconds).toBe(30);
  });

  it("static_token: null header_value → default applied (coerceOptional)", () => {
    const spec = parseAuthStrategyConfig(
      "df_null_hv",
      staticTokenBase({ header_value: null }),
    ) as ValidatedStaticTokenSpec;
    expect(spec.headerValue).toBe("Bearer ${token}");
  });

  it("token_endpoint: null refresh_buffer_seconds → default 30 (coerceOptional)", () => {
    const spec = parseAuthStrategyConfig(
      "df_null_rbs",
      tokenEndpointBase({ refresh_buffer_seconds: null }),
    ) as ValidatedTokenEndpointSpec;
    expect(spec.refreshBufferSeconds).toBe(30);
  });

  it("token_endpoint: null expires_in_path → undefined (coerceOptional)", () => {
    const spec = parseAuthStrategyConfig(
      "df_null_eip",
      tokenEndpointBase({ expires_in_path: null }),
    ) as ValidatedTokenEndpointSpec;
    expect(spec.expiresInPath).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// §8: Purity, determinism, and message leak prevention (AC#6 / AC#5, §10.7)
// ---------------------------------------------------------------------------

describe("parseAuthStrategyConfig — purity and determinism", () => {
  it("returns JSON-stringify-identical output for two calls with the same valid input", () => {
    const raw = staticTokenBase();
    const r1 = parseAuthStrategyConfig("pur_st", raw);
    const r2 = parseAuthStrategyConfig("pur_st", raw);
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
  });

  it("returns JSON-stringify-identical output for two calls with the same token_endpoint input", () => {
    const raw = tokenEndpointBase();
    const r1 = parseAuthStrategyConfig("pur_te", raw);
    const r2 = parseAuthStrategyConfig("pur_te", raw);
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
  });

  it("error on two calls with the same invalid input has identical code, phase, message", () => {
    const raw = staticTokenBase({ token: "" });
    const e1 = parseAuthStrategyConfig("pur_err", raw) as AuthStrategyError;
    const e2 = parseAuthStrategyConfig("pur_err", raw) as AuthStrategyError;
    expect(isAuthStrategyError(e1)).toBe(true);
    expect(isAuthStrategyError(e2)).toBe(true);
    expect(e1.code).toBe(e2.code);
    expect(e1.phase).toBe(e2.phase);
    expect(e1.message).toBe(e2.message);
  });

  it("D16 rejection message contains the offending placeholder name but not surrounding header_value", () => {
    const result = parseAuthStrategyConfig(
      "leak_test",
      staticTokenBase({ header_value: "Bearer ${secret_LEAK_xyz}" }),
    );
    const e = result as AuthStrategyError;
    expect(isAuthStrategyError(e)).toBe(true);
    // Inner placeholder name must appear
    expect(e.message).toContain("secret_LEAK_xyz");
    // The outer "Bearer " followed by lots of content must NOT appear
    expect(e.message).not.toMatch(/Bearer .{8,}/);
    assertNoLeak(e.message, ["${secret.", "${env."]);
  });

  it("error message for missing token does not contain credential-shaped strings", () => {
    const raw = { type: "static_token" } as unknown as AuthStrategyConfig;
    const result = parseAuthStrategyConfig("msg_clean", raw);
    const e = result as AuthStrategyError;
    expect(isAuthStrategyError(e)).toBe(true);
    assertNoLeak(e.message, ["password", "${secret.", "${env."]);
  });

  it("error message for invalid token_endpoint credentials does not echo password values", () => {
    const result = parseAuthStrategyConfig(
      "te_pw_leak",
      tokenEndpointBase({ credentials: { username: "u", password: "" } }),
    );
    const e = result as AuthStrategyError;
    expect(isAuthStrategyError(e)).toBe(true);
    // The error message must not contain the literal empty password or similar values
    assertNoLeak(e.message, ["${secret.", "${env."]);
  });

  it("parser never throws on a valid static_token input", () => {
    expect(() =>
      parseAuthStrategyConfig("nt_st", staticTokenBase()),
    ).not.toThrow();
  });

  it("parser never throws on a valid token_endpoint input", () => {
    expect(() =>
      parseAuthStrategyConfig("nt_te", tokenEndpointBase()),
    ).not.toThrow();
  });

  it("parser never throws on a completely empty object", () => {
    const raw = {} as unknown as AuthStrategyConfig;
    expect(() => parseAuthStrategyConfig("nt_empty", raw)).not.toThrow();
  });

  it("parser never throws when type is undefined", () => {
    const raw = { type: undefined } as unknown as AuthStrategyConfig;
    expect(() => parseAuthStrategyConfig("nt_undef", raw)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// §9: Fuzz — no throw guarantee on random-shaped inputs (AC#6, §10.7)
// ---------------------------------------------------------------------------

describe("parseAuthStrategyConfig — fuzz: never throws on any shaped input", () => {
  /** Generates a deterministic pseudo-random integer in [0, max). */
  function pseudoRand(seed: number, max: number): number {
    // xorshift32 — no external dep, deterministic across runs
    let s = seed === 0 ? 1 : seed;
    s ^= s << 13;
    s ^= s >> 17;
    s ^= s << 5;
    return Math.abs(s) % max;
  }

  /**
   * Builds a deterministic fuzz corpus of `AuthStrategyConfig`-shaped inputs.
   * Uses a seeded pseudo-random sequence so test output is reproducible.
   * @param count - Number of inputs to generate.
   * @returns An array of raw config objects.
   */
  function buildFuzzCorpus(count: number): AuthStrategyConfig[] {
    const types = [
      "static_token",
      "token_endpoint",
      "oauth_user_flow",
      "session_cookie",
      "hmac_sigv4",
      "",
      undefined,
      null,
      42,
    ];
    const stringValues = [
      "",
      " ",
      "abc",
      " abc ",
      "$.foo",
      "$..bar",
      "Bearer ${token}",
      "Bearer ${secret.x}",
      "Bearer ${env.x}",
      "${token}",
      "https://example.com/token",
      " https://example.com ",
    ];
    const corpus: AuthStrategyConfig[] = [];
    let seed = 0xdeadbeef;
    for (let i = 0; i < count; i++) {
      seed = (seed ^ (seed << 13)) >>> 0;
      seed = (seed ^ (seed >> 17)) >>> 0;
      seed = (seed ^ (seed << 5)) >>> 0;
      const typeIdx = pseudoRand(seed, types.length);
      const strIdx = pseudoRand(seed ^ 0x1234, stringValues.length);
      const strIdx2 = pseudoRand(seed ^ 0x5678, stringValues.length);
      const item: Record<string, unknown> = {
        type: types[typeIdx],
        token: stringValues[strIdx],
        url: stringValues[strIdx2],
        credentials: pseudoRand(seed ^ 0xabcd, 3) === 0
          ? { username: stringValues[strIdx] ?? "", password: stringValues[strIdx2] ?? "" }
          : pseudoRand(seed ^ 0xef01, 2) === 0
          ? []
          : undefined,
        token_path: stringValues[pseudoRand(seed ^ 0x2345, stringValues.length)],
        expires_in_path: pseudoRand(seed ^ 0x6789, 4) === 0
          ? stringValues[pseudoRand(seed ^ 0xabcd, stringValues.length)]
          : undefined,
        refresh_buffer_seconds: pseudoRand(seed ^ 0xcdef, 5) === 0
          ? ([-1, 0, 30, 60, NaN, Infinity, "30"])[pseudoRand(seed ^ 0x0123, 7)]
          : undefined,
        header_value: pseudoRand(seed ^ 0x4567, 3) === 0
          ? stringValues[pseudoRand(seed ^ 0x89ab, stringValues.length)]
          : undefined,
      };
      corpus.push(item as unknown as AuthStrategyConfig);
    }
    return corpus;
  }

  it("does not throw for any of 200 pseudo-random AuthStrategyConfig-shaped inputs", () => {
    const corpus = buildFuzzCorpus(200);
    for (const raw of corpus) {
      expect(() => {
        const result = parseAuthStrategyConfig("fuzz", raw);
        // Each result must be either a ValidatedStrategySpec or an AuthStrategyError
        const isSpec =
          !isAuthStrategyError(result) &&
          typeof result === "object" &&
          result !== null &&
          "kind" in result;
        const isErr = isAuthStrategyError(result);
        expect(isSpec || isErr).toBe(true);
      }).not.toThrow();
    }
  });

  it("returns either ValidatedStrategySpec or AuthStrategyError for known-boundary inputs", () => {
    const boundary: AuthStrategyConfig[] = [
      { type: "static_token", token: "t" },
      { type: "static_token", token: "" },
      { type: "token_endpoint" } as unknown as AuthStrategyConfig,
      { type: "static_token", token: "t", grant_type: "x" } as unknown as AuthStrategyConfig,
      { type: "static_token", token: "t", header_value: "Bearer ${secret.x}" },
    ];
    for (const raw of boundary) {
      const result = parseAuthStrategyConfig("boundary", raw);
      expect(isAuthStrategyError(result) || (result !== null && typeof result === "object")).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// §10: SSOT reuse proof (AC#7, §10.8)
// ---------------------------------------------------------------------------

describe("parseAuthStrategyConfig — SSOT reuse assertions", () => {
  it("AuthStrategyError imported from src/auth/errors.js is used for rejection (not redefined)", () => {
    const raw = { type: undefined } as unknown as AuthStrategyConfig;
    const result = parseAuthStrategyConfig("ssot_err", raw);
    expect(result instanceof AuthStrategyError).toBe(true);
  });

  it("AUTH_ERROR_CODES imported from src/auth/errors.js contains AUTH_CONFIG_INVALID", () => {
    expect(AUTH_ERROR_CODES.AUTH_CONFIG_INVALID).toBe("AUTH_CONFIG_INVALID");
  });

  it("AUTH_ERROR_CODES imported from src/auth/errors.js contains AUTH_HEADER_TEMPLATE_INVALID", () => {
    expect(AUTH_ERROR_CODES.AUTH_HEADER_TEMPLATE_INVALID).toBe("AUTH_HEADER_TEMPLATE_INVALID");
  });

  it("AuthStrategyConfig type originates in src/env/types (not redeclared by config-parser)", () => {
    // The env types module must export AuthStrategyConfig without error.
    // This is a compile-time check; the test asserts the import succeeded.
    const raw: AuthStrategyConfig = { type: "static_token", token: "x" };
    const result = parseAuthStrategyConfig("ssot_env", raw);
    expect(isAuthStrategyError(result) || typeof result === "object").toBe(true);
  });

  it("parseJsonPath is not reimplemented: malformed token_path produces parseJsonPath error code", () => {
    // If parseJsonPath were reimplemented, the error code might differ.
    // Verify that the bubbled error uses AUTH_CONFIG_INVALID from errors.ts.
    const result = parseAuthStrategyConfig(
      "ssot_jp",
      tokenEndpointBase({ token_path: "$..bad" }),
    );
    const e = result as AuthStrategyError;
    expect(isAuthStrategyError(e)).toBe(true);
    expect(e.code).toBe(AUTH_ERROR_CODES.AUTH_CONFIG_INVALID);
    expect(e.phase).toBe("config");
  });
});
