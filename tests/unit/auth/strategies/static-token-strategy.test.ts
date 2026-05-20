import { describe, it, expect, beforeEach } from "vitest";

import { StaticTokenStrategy } from "../../../../src/auth/strategies/static-token-strategy.js";
import type {
  AuthStrategy,
  PreparedRequest,
  RunContext,
} from "../../../../src/auth/types.js";
import type { ValidatedStaticTokenSpec } from "../../../../src/auth/config-parser.js";

/**
 * Unit tests for StaticTokenStrategy
 * (src/auth/strategies/static-token-strategy.ts).
 *
 * Covers: construction + SecretRegistry.add contract (AC#1/D8); apply() returns
 * a NEW AuthorizedRequest with headers intact on input (AC#2/D11); ${token}
 * placeholder substitution including adversarial tokens with $-special chars
 * (AC#2/AC#3/D7, §7); case-insensitive header collision with "auth wins"
 * semantics (AC#4/§6); determinism and no-throw guarantee (AC#5/D19);
 * add() never called during apply() (D8/§10.7); AuthStrategy conformance
 * (AC#7); fake-registry end-to-end (AC#6).
 *
 * RED PHASE: src/auth/strategies/static-token-strategy.ts does NOT exist yet.
 * Every import will fail until the implementation-engineer creates it.
 *
 * Integration categories skipped: no network, no I/O, no DB — pure hermetic.
 * The barrel-exclusion test (AC#6 "NOT in src/auth/index.ts") lives with the
 * auth-public-api-barrel task per §10.9 of the design.
 */

// ---------------------------------------------------------------------------
// Fake SecretRegistry
// ---------------------------------------------------------------------------

/**
 * Structural fake for SecretRegistry (src/env/secrets.ts).
 * Records every value passed to add() so tests can assert call count and args
 * without coupling to the real implementation.
 */
class FakeSecretRegistry {
  /** All values passed to add() in call order (duplicates preserved). */
  readonly added: string[] = [];

  /** Records the value; mirrors the real SecretRegistry.add() signature. */
  add(value: string): void {
    this.added.push(value);
  }

  /** Returns a snapshot Set of unique recorded values. */
  values(): ReadonlySet<string> {
    return new Set(this.added);
  }

  /** The number of distinct recorded values. */
  get size(): number {
    return new Set(this.added).size;
  }
}

// ---------------------------------------------------------------------------
// Spec & request builders
// ---------------------------------------------------------------------------

/**
 * Builds a minimal ValidatedStaticTokenSpec with sensible defaults.
 * @param overrides - Partial overrides for any spec field.
 * @returns A fully-populated ValidatedStaticTokenSpec.
 */
function makeSpec(
  overrides?: Partial<ValidatedStaticTokenSpec>,
): ValidatedStaticTokenSpec {
  return {
    kind: "static_token",
    token: "TEST_TOKEN_ABC",
    header: "Authorization",
    headerValue: "Bearer ${token}",
    ...overrides,
  };
}

/**
 * Builds a minimal PreparedRequest with the given headers.
 * @param headers - Headers map (default empty).
 * @param overrides - Any other PreparedRequest fields.
 * @returns A PreparedRequest object.
 */
function makeRequest(
  headers: Readonly<Record<string, string>> = {},
  overrides?: Partial<PreparedRequest>,
): PreparedRequest {
  return {
    method: "GET",
    url: "https://api.example.com/data",
    headers,
    body: undefined,
    ...overrides,
  };
}

/**
 * Minimal stub satisfying the RunContext interface.
 * The static_token strategy never reads from context (design §9.l), but
 * apply() must accept it to conform to AuthStrategy.
 */
const STUB_CONTEXT: RunContext = {} as RunContext;

// ---------------------------------------------------------------------------
// 10.1 — Construction & registry interaction (AC#1, AC#6, D8)
// ---------------------------------------------------------------------------

describe("StaticTokenStrategy", () => {
  describe("construction — registry interaction (AC#1, D8)", () => {
    it("calls registry.add exactly once with spec.token on construction", () => {
      const reg = new FakeSecretRegistry();
      const spec = makeSpec({ token: "MY_SECRET_TOKEN" });
      new StaticTokenStrategy(spec, reg);
      expect(reg.added).toHaveLength(1);
      expect(reg.added[0]).toBe("MY_SECRET_TOKEN");
    });

    it("passes spec.token verbatim to registry.add — not modified or hashed", () => {
      const reg = new FakeSecretRegistry();
      const token = "raw-token-value-!@#$%";
      new StaticTokenStrategy(makeSpec({ token }), reg);
      expect(reg.added[0]).toBe(token);
    });

    it("constructing twice with the same registry calls add twice (idempotency is registry's concern)", () => {
      const reg = new FakeSecretRegistry();
      const spec = makeSpec({ token: "SAME_TOKEN" });
      new StaticTokenStrategy(spec, reg);
      new StaticTokenStrategy(spec, reg);
      expect(reg.added).toHaveLength(2);
    });

    it("constructing two instances with different tokens adds each token once", () => {
      const reg = new FakeSecretRegistry();
      new StaticTokenStrategy(makeSpec({ token: "TOKEN_A" }), reg);
      new StaticTokenStrategy(makeSpec({ token: "TOKEN_B" }), reg);
      expect(reg.added).toContain("TOKEN_A");
      expect(reg.added).toContain("TOKEN_B");
      expect(reg.added).toHaveLength(2);
    });
  });

  // ---------------------------------------------------------------------------
  // 10.7 — registry.add NOT called during apply() (D8, AC#1, AC#5)
  // ---------------------------------------------------------------------------

  describe("apply() — registry.add never called during apply (D8, §10.7)", () => {
    it("apply() 10 times does not increase the registry add count", async () => {
      const reg = new FakeSecretRegistry();
      const strategy = new StaticTokenStrategy(makeSpec(), reg);
      const countAfterConstruction = reg.added.length;
      for (let i = 0; i < 10; i++) {
        await strategy.apply(makeRequest(), STUB_CONTEXT);
      }
      expect(reg.added.length).toBe(countAfterConstruction);
    });
  });

  // ---------------------------------------------------------------------------
  // 10.2 — apply() returns NEW object (AC#2, D11)
  // ---------------------------------------------------------------------------

  describe("apply() — returns new object identity (AC#2, D11)", () => {
    let strategy: StaticTokenStrategy;
    let inputRequest: PreparedRequest;

    beforeEach(() => {
      strategy = new StaticTokenStrategy(makeSpec(), new FakeSecretRegistry());
      inputRequest = makeRequest({ "Content-Type": "application/json" });
    });

    it("output is a different object reference than input", async () => {
      const output = await strategy.apply(inputRequest, STUB_CONTEXT);
      expect(output).not.toBe(inputRequest);
    });

    it("output.headers is a different object reference than input.headers", async () => {
      const output = await strategy.apply(inputRequest, STUB_CONTEXT);
      expect(output.headers).not.toBe(inputRequest.headers);
    });

    it("input.headers is structurally unchanged after apply()", async () => {
      const snapshot = { ...inputRequest.headers };
      await strategy.apply(inputRequest, STUB_CONTEXT);
      expect(inputRequest.headers).toEqual(snapshot);
    });

    it("input.method is unchanged after apply()", async () => {
      const originalMethod = inputRequest.method;
      await strategy.apply(inputRequest, STUB_CONTEXT);
      expect(inputRequest.method).toBe(originalMethod);
    });

    it("input.url is unchanged after apply()", async () => {
      const originalUrl = inputRequest.url;
      await strategy.apply(inputRequest, STUB_CONTEXT);
      expect(inputRequest.url).toBe(originalUrl);
    });

    it("output.method equals input.method (spread copy)", async () => {
      const output = await strategy.apply(inputRequest, STUB_CONTEXT);
      expect(output.method).toBe(inputRequest.method);
    });

    it("output.url equals input.url (spread copy)", async () => {
      const output = await strategy.apply(inputRequest, STUB_CONTEXT);
      expect(output.url).toBe(inputRequest.url);
    });
  });

  // ---------------------------------------------------------------------------
  // 10.3 — Header substitution branches (AC#2, AC#3, D7, §7)
  // ---------------------------------------------------------------------------

  describe("apply() — ${token} placeholder substitution (AC#2, AC#3, D7)", () => {
    /** Table-driven substitution tests; see design §7 and §10.3. */
    const substitutionCases: Array<{
      label: string;
      headerValue: string;
      token: string;
      expected: string;
    }> = [
      {
        label: "basic Bearer prefix (§7 case a)",
        headerValue: "Bearer ${token}",
        token: "ABC",
        expected: "Bearer ABC",
      },
      {
        label: "custom prefix with suffix (§7 case b)",
        headerValue: "Token ${token}-id",
        token: "ABC",
        expected: "Token ABC-id",
      },
      {
        label: "two occurrences of ${token} replaced (§7 case c)",
        headerValue: "${token} ${token}",
        token: "ABC",
        expected: "ABC ABC",
      },
      {
        label: "no placeholder — attached as-is, D16 edge case (§7 case d, AC#3)",
        headerValue: "static-no-placeholder",
        token: "ABC",
        expected: "static-no-placeholder",
      },
      {
        label: "placeholder-only header value (§7 case e)",
        headerValue: "${token}",
        token: "ABC",
        expected: "ABC",
      },
      {
        label: "token with $$ chars — function-form prevents $$→$ interpretation (§7 case f)",
        headerValue: "Bearer ${token}",
        token: "ab$$cd",
        expected: "Bearer ab$$cd",
      },
      {
        label: "token with $& chars — function-form prevents match-substitution (§7 case g)",
        headerValue: "Bearer ${token}",
        token: "ab$&cd",
        expected: "Bearer ab$&cd",
      },
      {
        label: "token with backslash literal (§7 case h)",
        headerValue: "Bearer ${token}",
        token: "ab\\cd",
        expected: "Bearer ab\\cd",
      },
      {
        label: "token with $` (backtick-dollar) chars — function-form prevents interpretation",
        headerValue: "Bearer ${token}",
        token: "ab$`cd",
        expected: "Bearer ab$`cd",
      },
      {
        label: "token with $' (dollar-quote) chars — function-form prevents interpretation",
        headerValue: "Bearer ${token}",
        token: "ab$'cd",
        expected: "Bearer ab$'cd",
      },
      {
        label: "malformed ${token (no closing brace) — literal pass-through, not matched",
        headerValue: "Bearer ${token",
        token: "ABC",
        expected: "Bearer ${token",
      },
      {
        label: "empty headerValue (parser-rejected upstream but no runtime throw per D19)",
        headerValue: "",
        token: "ABC",
        expected: "",
      },
    ];

    for (const { label, headerValue, token, expected } of substitutionCases) {
      it(`attaches correct resolved header value: ${label}`, async () => {
        const spec = makeSpec({ token, headerValue, header: "Authorization" });
        const strategy = new StaticTokenStrategy(spec, new FakeSecretRegistry());
        const output = await strategy.apply(makeRequest(), STUB_CONTEXT);
        expect(output.headers["Authorization"]).toBe(expected);
      });
    }
  });

  // ---------------------------------------------------------------------------
  // 10.4 — Case-insensitive collision (AC#4, §6)
  // ---------------------------------------------------------------------------

  describe("apply() — case-insensitive header collision (AC#4, §6)", () => {
    /**
     * Table-driven collision tests.
     * "auth wins" semantics: strategy header replaces ALL case-variants.
     * Output uses spec.header's exact casing (§6 "user-intent preserved").
     */
    const collisionCases: Array<{
      label: string;
      inputHeaders: Record<string, string>;
      specHeader: string;
      expectedOutputHeaders: Record<string, string>;
    }> = [
      {
        label: "lowercase input removed, spec.header casing used (§6 table row 1)",
        inputHeaders: { authorization: "old-token" },
        specHeader: "Authorization",
        expectedOutputHeaders: { Authorization: "Bearer TEST_TOKEN_ABC" },
      },
      {
        label: "same-case identity replacement (§6 table row 2)",
        inputHeaders: { Authorization: "old-token" },
        specHeader: "Authorization",
        expectedOutputHeaders: { Authorization: "Bearer TEST_TOKEN_ABC" },
      },
      {
        label: "ALL-CAPS variant removed, spec.header casing used (§6 table row 3)",
        inputHeaders: { AUTHORIZATION: "old-token" },
        specHeader: "Authorization",
        expectedOutputHeaders: { Authorization: "Bearer TEST_TOKEN_ABC" },
      },
      {
        label: "non-colliding header preserved alongside new auth header",
        inputHeaders: { authorization: "old", "Content-Type": "application/json" },
        specHeader: "Authorization",
        expectedOutputHeaders: {
          "Content-Type": "application/json",
          Authorization: "Bearer TEST_TOKEN_ABC",
        },
      },
      {
        label: "empty input headers — header added with no collision",
        inputHeaders: {},
        specHeader: "Authorization",
        expectedOutputHeaders: { Authorization: "Bearer TEST_TOKEN_ABC" },
      },
      {
        label: "both lowercase and mixed-case authorization dropped (§6 table row 6)",
        inputHeaders: { authorization: "a", Authorization: "b" },
        specHeader: "Authorization",
        expectedOutputHeaders: { Authorization: "Bearer TEST_TOKEN_ABC" },
      },
      {
        label: "unrelated X-Other header preserved when no collision",
        inputHeaders: { "X-Other": "y" },
        specHeader: "X-API-Key",
        expectedOutputHeaders: {
          "X-Other": "y",
          "X-API-Key": "Bearer TEST_TOKEN_ABC",
        },
      },
      {
        label: "custom non-standard header used as spec.header",
        inputHeaders: { "x-custom-auth": "old" },
        specHeader: "X-Custom-Auth",
        expectedOutputHeaders: { "X-Custom-Auth": "Bearer TEST_TOKEN_ABC" },
      },
      {
        label: "multiple unrelated headers all preserved",
        inputHeaders: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-Request-Id": "abc-123",
        },
        specHeader: "Authorization",
        expectedOutputHeaders: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-Request-Id": "abc-123",
          Authorization: "Bearer TEST_TOKEN_ABC",
        },
      },
    ];

    for (const { label, inputHeaders, specHeader, expectedOutputHeaders } of collisionCases) {
      it(label, async () => {
        const spec = makeSpec({
          token: "TEST_TOKEN_ABC",
          header: specHeader,
          headerValue: "Bearer ${token}",
        });
        const strategy = new StaticTokenStrategy(spec, new FakeSecretRegistry());
        const output = await strategy.apply(makeRequest(inputHeaders), STUB_CONTEXT);
        expect(output.headers).toEqual(expectedOutputHeaders);
      });
    }

    it("output does not contain any case-variant of the replaced header key besides spec.header",
      async () => {
        const spec = makeSpec({ header: "Authorization", headerValue: "Bearer ${token}" });
        const strategy = new StaticTokenStrategy(spec, new FakeSecretRegistry());
        const output = await strategy.apply(
          makeRequest({ authorization: "stale", AUTHORIZATION: "also-stale" }),
          STUB_CONTEXT,
        );
        const keys = Object.keys(output.headers).map((k) => k.toLowerCase());
        const authCount = keys.filter((k) => k === "authorization").length;
        expect(authCount).toBe(1);
        expect(output.headers["Authorization"]).toBe("Bearer TEST_TOKEN_ABC");
      });
  });

  // ---------------------------------------------------------------------------
  // 10.5 — Never throws / never rejects (AC#5, D19)
  // ---------------------------------------------------------------------------

  describe("apply() — never throws or rejects (AC#5, D19)", () => {
    it("resolves (does not reject) with a standard PreparedRequest", async () => {
      const strategy = new StaticTokenStrategy(makeSpec(), new FakeSecretRegistry());
      await expect(strategy.apply(makeRequest(), STUB_CONTEXT)).resolves.toBeDefined();
    });

    it("resolves with empty headers map", async () => {
      const strategy = new StaticTokenStrategy(makeSpec(), new FakeSecretRegistry());
      await expect(strategy.apply(makeRequest({}), STUB_CONTEXT)).resolves.toBeDefined();
    });

    it("resolves with a headers map containing 20 entries", async () => {
      const headers: Record<string, string> = {};
      for (let i = 0; i < 20; i++) {
        headers[`X-Header-${i}`] = `value-${i}`;
      }
      const strategy = new StaticTokenStrategy(makeSpec(), new FakeSecretRegistry());
      await expect(strategy.apply(makeRequest(headers), STUB_CONTEXT)).resolves.toBeDefined();
    });

    it("200 adversarial PreparedRequest variations all resolve without rejection", async () => {
      const strategy = new StaticTokenStrategy(
        makeSpec({ token: "ADV_TOKEN", headerValue: "Bearer ${token}" }),
        new FakeSecretRegistry(),
      );

      const adversarialRequests: PreparedRequest[] = [];

      // Variation group A: special characters in header keys
      const specialKeys = [
        "x-empty-value",
        "x-unicode-é",
        "x-tab\tkey",
        "x-newline\nkey",
        "x-colon:key",
        "x-space key",
      ];
      for (const key of specialKeys) {
        adversarialRequests.push(makeRequest({ [key]: "some-value" }));
      }

      // Variation group B: special characters in header values
      const specialValues = [
        "",
        "\x00",
        "a".repeat(8192),
        "${token}",
        "Bearer ${secret.X}",
        "null",
        "undefined",
        "\n\r\t",
        "ab$$cd",
        "ab$&cd",
      ];
      for (const val of specialValues) {
        adversarialRequests.push(makeRequest({ Authorization: val }));
      }

      // Variation group C: many headers
      const manyHeaders: Record<string, string> = {};
      for (let i = 0; i < 50; i++) {
        manyHeaders[`X-Custom-${i}`] = `v${i}`;
      }
      adversarialRequests.push(makeRequest(manyHeaders));

      // Variation group D: body variations
      adversarialRequests.push(makeRequest({}, { body: undefined }));
      adversarialRequests.push(makeRequest({}, { body: "" }));
      adversarialRequests.push(makeRequest({}, { body: '{"key":"value"}' }));
      adversarialRequests.push(makeRequest({}, { body: "a".repeat(65536) }));

      // Variation group E: URL variations
      const urlVariants = [
        "https://api.example.com/path?q=1&r=2",
        "http://localhost:8080",
        "https://a.b.c.d.e.f.g/very/long/path/segment",
        "",
      ];
      for (const url of urlVariants) {
        adversarialRequests.push(makeRequest({}, { url }));
      }

      // Variation group F: method variations
      const methods = ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS", "HEAD"];
      for (const method of methods) {
        adversarialRequests.push(makeRequest({}, { method }));
      }

      // Pad to 200 by repeating the base request
      while (adversarialRequests.length < 200) {
        adversarialRequests.push(makeRequest());
      }

      const results = await Promise.allSettled(
        adversarialRequests.slice(0, 200).map((req) => strategy.apply(req, STUB_CONTEXT)),
      );

      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        expect(
          result?.status,
          `Request variant ${i} should resolve, got rejected`,
        ).toBe("fulfilled");
      }
    });
  });

  // ---------------------------------------------------------------------------
  // 10.6 — Determinism (AC#5)
  // ---------------------------------------------------------------------------

  describe("apply() — determinism (AC#5)", () => {
    it("two apply() calls with identical input produce structurally equal output", async () => {
      const strategy = new StaticTokenStrategy(makeSpec(), new FakeSecretRegistry());
      const req = makeRequest({ "Content-Type": "text/plain" });
      const out1 = await strategy.apply(req, STUB_CONTEXT);
      const out2 = await strategy.apply(req, STUB_CONTEXT);
      expect(JSON.stringify(out1)).toBe(JSON.stringify(out2));
    });

    it("output headers are structurally identical across two apply() calls", async () => {
      const strategy = new StaticTokenStrategy(makeSpec(), new FakeSecretRegistry());
      const req = makeRequest({ Accept: "application/json" });
      const out1 = await strategy.apply(req, STUB_CONTEXT);
      const out2 = await strategy.apply(req, STUB_CONTEXT);
      expect(out1.headers).toEqual(out2.headers);
    });

    it("output does not vary when the same strategy is used on two different requests with same headers",
      async () => {
        const strategy = new StaticTokenStrategy(makeSpec(), new FakeSecretRegistry());
        const req1 = makeRequest({ Accept: "application/json" });
        const req2 = makeRequest({ Accept: "application/json" });
        const out1 = await strategy.apply(req1, STUB_CONTEXT);
        const out2 = await strategy.apply(req2, STUB_CONTEXT);
        expect(out1.headers).toEqual(out2.headers);
      });
  });

  // ---------------------------------------------------------------------------
  // 10.8 — AuthStrategy conformance (AC#7)
  // ---------------------------------------------------------------------------

  describe("AuthStrategy interface conformance (AC#7)", () => {
    it("is assignable to AuthStrategy at construction", () => {
      const reg = new FakeSecretRegistry();
      // This compile-time check is the real assertion; runtime simply
      // confirms the instance is created without throwing.
      const s: AuthStrategy = new StaticTokenStrategy(makeSpec(), reg);
      expect(s).toBeDefined();
    });

    it("apply() returns a promise that resolves to an object", async () => {
      const strategy: AuthStrategy = new StaticTokenStrategy(makeSpec(), new FakeSecretRegistry());
      const result = strategy.apply(makeRequest(), STUB_CONTEXT);
      expect(result).toBeInstanceOf(Promise);
      const output = await result;
      expect(typeof output).toBe("object");
      expect(output).not.toBeNull();
    });

    it("resolved AuthorizedRequest has method, url, and headers properties", async () => {
      const strategy = new StaticTokenStrategy(makeSpec(), new FakeSecretRegistry());
      const output = await strategy.apply(
        makeRequest({}, { method: "POST", url: "https://api.example.com/v1" }),
        STUB_CONTEXT,
      );
      expect(output).toHaveProperty("method", "POST");
      expect(output).toHaveProperty("url", "https://api.example.com/v1");
      expect(output).toHaveProperty("headers");
      expect(typeof output.headers).toBe("object");
    });
  });

  // ---------------------------------------------------------------------------
  // AC#6 — Fake-registry end-to-end: construct → add once → apply → correct header
  // ---------------------------------------------------------------------------

  describe("end-to-end with fake registry (AC#6)", () => {
    it("construct → registry.add called once → apply → new AuthorizedRequest with expected header",
      async () => {
        const reg = new FakeSecretRegistry();
        const spec = makeSpec({
          token: "E2E_TOKEN",
          header: "Authorization",
          headerValue: "Bearer ${token}",
        });
        const strategy = new StaticTokenStrategy(spec, reg);

        // Construction side-effect: add called exactly once
        expect(reg.added).toHaveLength(1);
        expect(reg.added[0]).toBe("E2E_TOKEN");

        // Apply: returns new request with the attached header
        const input = makeRequest({ "Content-Type": "application/json" });
        const output = await strategy.apply(input, STUB_CONTEXT);

        expect(output).not.toBe(input);
        expect(output.headers).not.toBe(input.headers);
        expect(output.headers["Authorization"]).toBe("Bearer E2E_TOKEN");
        expect(output.headers["Content-Type"]).toBe("application/json");

        // Registry unchanged after apply
        expect(reg.added).toHaveLength(1);
      });

    it("custom header + headerValue without ${token} attaches literal value", async () => {
      const reg = new FakeSecretRegistry();
      const spec = makeSpec({
        token: "IGNORED",
        header: "X-API-Key",
        headerValue: "literal-static-value",
      });
      const strategy = new StaticTokenStrategy(spec, reg);
      const output = await strategy.apply(makeRequest(), STUB_CONTEXT);
      expect(output.headers["X-API-Key"]).toBe("literal-static-value");
    });

    it("custom header + headerValue with ${token} in middle attaches interpolated value", async () => {
      const reg = new FakeSecretRegistry();
      const spec = makeSpec({
        token: "MYTOKEN",
        header: "X-Auth-Token",
        headerValue: "token-${token}-suffix",
      });
      const strategy = new StaticTokenStrategy(spec, reg);
      const output = await strategy.apply(makeRequest(), STUB_CONTEXT);
      expect(output.headers["X-Auth-Token"]).toBe("token-MYTOKEN-suffix");
    });
  });

  // ---------------------------------------------------------------------------
  // Multiple-apply idempotency (design §9.f — stateless post-construction)
  // ---------------------------------------------------------------------------

  describe("multiple-apply idempotency", () => {
    it("applying the same strategy twice to equivalent requests yields equivalent headers", async () => {
      const strategy = new StaticTokenStrategy(makeSpec(), new FakeSecretRegistry());
      const req = makeRequest({ Accept: "application/json" });
      const out1 = await strategy.apply(req, STUB_CONTEXT);
      const out2 = await strategy.apply(req, STUB_CONTEXT);
      expect(out1.headers).toEqual(out2.headers);
    });

    it("applying twice to the same request object does not accumulate headers", async () => {
      const strategy = new StaticTokenStrategy(makeSpec(), new FakeSecretRegistry());
      const req = makeRequest({});
      const out1 = await strategy.apply(req, STUB_CONTEXT);
      const out2 = await strategy.apply(req, STUB_CONTEXT);
      const keys1 = Object.keys(out1.headers);
      const keys2 = Object.keys(out2.headers);
      expect(keys1).toHaveLength(keys2.length);
      expect(out1.headers).toEqual(out2.headers);
    });

    it("applying to out1's result produces the same headers (idempotent header replacement)", async () => {
      const strategy = new StaticTokenStrategy(makeSpec(), new FakeSecretRegistry());
      const req = makeRequest({});
      const out1 = await strategy.apply(req, STUB_CONTEXT);
      const out2 = await strategy.apply(out1, STUB_CONTEXT);
      expect(out2.headers["Authorization"]).toBe(out1.headers["Authorization"]);
    });
  });
});
