import { describe, it, expect, beforeEach } from "vitest";

import {
  TokenEndpointStrategy,
} from "../../../../src/auth/strategies/token-endpoint-strategy.js";
import {
  AUTH_ERROR_CODES,
  AuthStrategyError,
} from "../../../../src/auth/errors.js";
import type {
  HttpFetchSeam,
  HttpFetchInput,
  HttpFetchResult,
} from "../../../../src/auth/http-fetch-seam.js";
import type {
  PreparedRequest,
  RunContext,
} from "../../../../src/auth/types.js";
import type {
  ValidatedTokenEndpointSpec,
} from "../../../../src/auth/config-parser.js";
import type { ParsedJsonPath } from "../../../../src/auth/jsonpath-subset.js";
import { SecretRegistry } from "../../../../src/env/secrets.js";

/**
 * Unit tests for `TokenEndpointStrategy` — Part 2 of 2: D10 error taxonomy.
 *
 * Covers every error path enumerated in the design §7 error table and pinned
 * by AC#5 (secret-free message guarantee):
 *   - Seam-level network failure  → AUTH_TOKEN_FETCH_FAILED, phase "fetch"
 *   - Seam-level non-2xx          → AUTH_TOKEN_FETCH_NON_2XX, phase "fetch"
 *   - tokenPath miss              → AUTH_TOKEN_NOT_FOUND, phase "extract"
 *   - tokenPath value non-string  → AUTH_TOKEN_NOT_STRING, phase "extract"
 *   - expiresInPath miss          → AUTH_EXPIRES_IN_INVALID, phase "extract"
 *   - expires_in NaN              → AUTH_EXPIRES_IN_INVALID, phase "extract"
 *   - expires_in -1               → AUTH_EXPIRES_IN_INVALID, phase "extract"
 *   - expires_in 0                → AUTH_EXPIRES_IN_INVALID, phase "extract"
 *   - expires_in "3600" (string)  → AUTH_EXPIRES_IN_INVALID, phase "extract"
 *   - expires_in null             → AUTH_EXPIRES_IN_INVALID, phase "extract"
 *   - expires_in Infinity         → AUTH_EXPIRES_IN_INVALID, phase "extract"
 *
 * Plus the no-leak assertion (AC#5): every error message must contain NONE of
 * the credential values, token values, or raw response body content.
 *
 * RED PHASE: `src/auth/strategies/token-endpoint-strategy.ts` does not exist.
 * This file fails with ERR_MODULE_NOT_FOUND until the implementation-engineer
 * creates it. That import-failure is the intended red-phase outcome.
 *
 * Split rationale: Part 1 already reaches 296 lines. This file keeps each
 * file within the 300-line soft cap / 500-line hard cap per pipeline invariants.
 */

// ---------------------------------------------------------------------------
// Minimal fake seam (duplicate-free: same class, no shared import from part 1)
// ---------------------------------------------------------------------------

/**
 * Programmed fake for `HttpFetchSeam` used in error-path tests.
 * Queue is FIFO; throws a plain Error if the queue is empty.
 */
type ErrorTestEntry =
  | { kind: "response"; status: number; body: unknown }
  | { kind: "reject"; err: AuthStrategyError };

class ErrorFakeSeam implements HttpFetchSeam {
  private readonly queue: ErrorTestEntry[] = [];
  fetchCount = 0;

  enqueueResponse(status: number, body: unknown): void {
    this.queue.push({ kind: "response", status, body });
  }

  enqueueRejection(err: AuthStrategyError): void {
    this.queue.push({ kind: "reject", err });
  }

  async postJson(input: HttpFetchInput): Promise<HttpFetchResult> {
    this.fetchCount++;
    const next = this.queue.shift();
    if (next === undefined) {
      throw new Error(`ErrorFakeSeam: no response queued for ${input.url}`);
    }
    if (next.kind === "reject") throw next.err;
    return { status: next.status, body: next.body };
  }
}

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

/**
 * Builds a fully-valid base spec. The `expiresInPath` override is used only
 * by tests that need the refresh branch.
 */
function makeSpec(
  overrides: Partial<ValidatedTokenEndpointSpec> = {},
): ValidatedTokenEndpointSpec {
  return {
    kind: "token_endpoint",
    url: "https://sso.fixture.invalid/oauth/token",
    username: "fixture-username-secret",
    password: "fixture-password-secret",
    tokenPath: [{ kind: "key", key: "access_token" }] as ParsedJsonPath,
    expiresInPath: undefined,
    refreshBufferSeconds: 0,
    header: "Authorization",
    headerValue: "Bearer ${token}",
    ...overrides,
  };
}

/** Standard expiresInPath for tests that exercise the refresh branch. */
const EXPIRES_IN_PATH: ParsedJsonPath = [{ kind: "key", key: "expires_in" }];

function makeRequest(): PreparedRequest {
  return {
    method: "GET",
    url: "https://api.fixture.invalid/resource",
    headers: {},
  };
}

function makeContext(): RunContext {
  return {
    env: {
      name: "test",
      prod: false,
      base_url: "https://api.fixture.invalid",
      default_sla_ms: 1000,
      auth_strategies: {},
    },
    secrets: new SecretRegistry(),
  };
}

/** Credentials / token literal substrings that must NEVER appear in error messages (AC#5). */
const SECRET_SUBSTRINGS = [
  "fixture-username-secret",
  "fixture-password-secret",
  "fixture-extracted-token",
] as const;

/**
 * Asserts that `err` is an `AuthStrategyError` and that its message, code,
 * phase, and name fields contain NONE of the secret substrings (AC#5).
 * @param err - The thrown value to inspect.
 * @param expectedCode - The AUTH_ERROR_CODES value the error must carry.
 * @param expectedPhase - The phase string the error must carry.
 */
function assertCleanError(
  err: unknown,
  expectedCode: string,
  expectedPhase: string,
): void {
  expect(err).toBeInstanceOf(AuthStrategyError);
  if (!(err instanceof AuthStrategyError)) return;

  expect(err.code).toBe(expectedCode);
  expect(err.phase).toBe(expectedPhase);

  const serialized = JSON.stringify({
    message: err.message,
    code: err.code,
    phase: err.phase,
    name: err.name,
  });

  for (const sub of SECRET_SUBSTRINGS) {
    expect(serialized).not.toContain(sub);
  }
}

// ---------------------------------------------------------------------------
// describe: D10 error paths — seam-level failures
// ---------------------------------------------------------------------------

/**
 * Tests for errors that originate at the seam level (network + non-2xx).
 * The seam pre-builds and throws `AuthStrategyError`; the strategy must
 * propagate it verbatim (code + phase unchanged).
 */
describe("TokenEndpointStrategy — seam-level errors (D10)", () => {
  let seam: ErrorFakeSeam;

  beforeEach(() => {
    seam = new ErrorFakeSeam();
  });

  it("propagates AUTH_TOKEN_FETCH_FAILED (phase 'fetch') on network failure", async () => {
    const networkErr = new AuthStrategyError({
      code: AUTH_ERROR_CODES.AUTH_TOKEN_FETCH_FAILED,
      phase: "fetch",
      message: "connection refused",
    });
    seam.enqueueRejection(networkErr);
    const strategy = new TokenEndpointStrategy(makeSpec(), new SecretRegistry(), seam);

    await expect(strategy.apply(makeRequest(), makeContext())).rejects.toBe(networkErr);
  });

  it("propagates AUTH_TOKEN_FETCH_NON_2XX (phase 'fetch') on non-2xx response", async () => {
    const nonTwoXxErr = new AuthStrategyError({
      code: AUTH_ERROR_CODES.AUTH_TOKEN_FETCH_NON_2XX,
      phase: "fetch",
      message: "received status 503",
    });
    seam.enqueueRejection(nonTwoXxErr);
    const strategy = new TokenEndpointStrategy(makeSpec(), new SecretRegistry(), seam);

    const thrown = await strategy
      .apply(makeRequest(), makeContext())
      .catch((e: unknown) => e);
    expect(thrown).toBe(nonTwoXxErr);
    expect((thrown as AuthStrategyError).code).toBe(
      AUTH_ERROR_CODES.AUTH_TOKEN_FETCH_NON_2XX,
    );
    expect((thrown as AuthStrategyError).phase).toBe("fetch");
  });

  it("does NOT call secrets.add when the seam rejects (no partial registration)", async () => {
    const networkErr = new AuthStrategyError({
      code: AUTH_ERROR_CODES.AUTH_TOKEN_FETCH_FAILED,
      phase: "fetch",
      message: "timeout",
    });
    seam.enqueueRejection(networkErr);
    const secrets = new SecretRegistry();
    const strategy = new TokenEndpointStrategy(makeSpec(), secrets, seam);

    await strategy.apply(makeRequest(), makeContext()).catch(() => undefined);
    expect(secrets.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// describe: D10 error paths — token extraction failures
// ---------------------------------------------------------------------------

/**
 * Tests for errors produced during the token-extraction phase (§7 extract
 * error table). These fire when the seam returns a 200 but the body does not
 * satisfy the tokenPath or produces a non-string value.
 */
describe("TokenEndpointStrategy — token extraction errors (D10)", () => {
  let seam: ErrorFakeSeam;

  beforeEach(() => {
    seam = new ErrorFakeSeam();
  });

  it("throws AUTH_TOKEN_NOT_FOUND (phase 'extract') when tokenPath misses in the body", async () => {
    seam.enqueueResponse(200, { other_field: "x" });
    const strategy = new TokenEndpointStrategy(makeSpec(), new SecretRegistry(), seam);

    const err = await strategy
      .apply(makeRequest(), makeContext())
      .catch((e: unknown) => e);
    assertCleanError(err, AUTH_ERROR_CODES.AUTH_TOKEN_NOT_FOUND, "extract");
  });

  it("throws AUTH_TOKEN_NOT_FOUND (phase 'extract') on an empty response body {}", async () => {
    seam.enqueueResponse(200, {});
    const strategy = new TokenEndpointStrategy(makeSpec(), new SecretRegistry(), seam);

    const err = await strategy
      .apply(makeRequest(), makeContext())
      .catch((e: unknown) => e);
    assertCleanError(err, AUTH_ERROR_CODES.AUTH_TOKEN_NOT_FOUND, "extract");
  });

  it("throws AUTH_TOKEN_NOT_STRING (phase 'extract') when tokenPath value is a number", async () => {
    seam.enqueueResponse(200, { access_token: 123 });
    const strategy = new TokenEndpointStrategy(makeSpec(), new SecretRegistry(), seam);

    const err = await strategy
      .apply(makeRequest(), makeContext())
      .catch((e: unknown) => e);
    assertCleanError(err, AUTH_ERROR_CODES.AUTH_TOKEN_NOT_STRING, "extract");
  });

  it("throws AUTH_TOKEN_NOT_STRING (phase 'extract') when tokenPath value is boolean", async () => {
    seam.enqueueResponse(200, { access_token: true });
    const strategy = new TokenEndpointStrategy(makeSpec(), new SecretRegistry(), seam);

    const err = await strategy
      .apply(makeRequest(), makeContext())
      .catch((e: unknown) => e);
    assertCleanError(err, AUTH_ERROR_CODES.AUTH_TOKEN_NOT_STRING, "extract");
  });

  it("throws AUTH_TOKEN_NOT_STRING (phase 'extract') when tokenPath value is null", async () => {
    seam.enqueueResponse(200, { access_token: null });
    const strategy = new TokenEndpointStrategy(makeSpec(), new SecretRegistry(), seam);

    const err = await strategy
      .apply(makeRequest(), makeContext())
      .catch((e: unknown) => e);
    assertCleanError(err, AUTH_ERROR_CODES.AUTH_TOKEN_NOT_STRING, "extract");
  });

  it("throws AUTH_TOKEN_NOT_STRING (phase 'extract') when tokenPath value is an object", async () => {
    seam.enqueueResponse(200, { access_token: { nested: "value" } });
    const strategy = new TokenEndpointStrategy(makeSpec(), new SecretRegistry(), seam);

    const err = await strategy
      .apply(makeRequest(), makeContext())
      .catch((e: unknown) => e);
    assertCleanError(err, AUTH_ERROR_CODES.AUTH_TOKEN_NOT_STRING, "extract");
  });

  it("does NOT call secrets.add when token extraction fails", async () => {
    seam.enqueueResponse(200, { other_field: "x" });
    const secrets = new SecretRegistry();
    const strategy = new TokenEndpointStrategy(makeSpec(), secrets, seam);

    await strategy.apply(makeRequest(), makeContext()).catch(() => undefined);
    expect(secrets.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// describe: D10 error paths — expires_in validation failures
// ---------------------------------------------------------------------------

/**
 * Tests for every invalid `expires_in` variant enumerated in design §10 (a-g)
 * and §7 error table. All map to AUTH_EXPIRES_IN_INVALID / phase "extract".
 */
describe("TokenEndpointStrategy — expires_in validation errors (D10, §10 a-g)", () => {
  let seam: ErrorFakeSeam;

  beforeEach(() => {
    seam = new ErrorFakeSeam();
  });

  /** Helper to run a strategy with an expiresInPath and a given expires_in value. */
  const applyWithExpiresIn = async (
    expiresInValue: unknown,
  ): Promise<unknown> => {
    const body: Record<string, unknown> = {
      access_token: "fixture-extracted-token",
    };
    if (expiresInValue !== undefined) {
      body["expires_in"] = expiresInValue;
    }
    seam.enqueueResponse(200, body);
    const strategy = new TokenEndpointStrategy(
      makeSpec({ expiresInPath: EXPIRES_IN_PATH, refreshBufferSeconds: 0 }),
      new SecretRegistry(),
      seam,
    );
    return strategy.apply(makeRequest(), makeContext()).catch((e: unknown) => e);
  };

  it("throws AUTH_EXPIRES_IN_INVALID (§10 a) when expires_in is 0 (not positive)", async () => {
    const err = await applyWithExpiresIn(0);
    assertCleanError(err, AUTH_ERROR_CODES.AUTH_EXPIRES_IN_INVALID, "extract");
  });

  it("throws AUTH_EXPIRES_IN_INVALID (§10 b) when expires_in is -1 (negative finite)", async () => {
    const err = await applyWithExpiresIn(-1);
    assertCleanError(err, AUTH_ERROR_CODES.AUTH_EXPIRES_IN_INVALID, "extract");
  });

  it("throws AUTH_EXPIRES_IN_INVALID (§10 c) when expires_in is the string '3600'", async () => {
    const err = await applyWithExpiresIn("3600");
    assertCleanError(err, AUTH_ERROR_CODES.AUTH_EXPIRES_IN_INVALID, "extract");
  });

  it("throws AUTH_EXPIRES_IN_INVALID (§10 d) when expires_in is null", async () => {
    const err = await applyWithExpiresIn(null);
    assertCleanError(err, AUTH_ERROR_CODES.AUTH_EXPIRES_IN_INVALID, "extract");
  });

  it("throws AUTH_EXPIRES_IN_INVALID (§10 e) when expires_in is NaN", async () => {
    const err = await applyWithExpiresIn(Number.NaN);
    assertCleanError(err, AUTH_ERROR_CODES.AUTH_EXPIRES_IN_INVALID, "extract");
  });

  it("throws AUTH_EXPIRES_IN_INVALID (§10 f) when expires_in is Infinity", async () => {
    const err = await applyWithExpiresIn(Infinity);
    assertCleanError(err, AUTH_ERROR_CODES.AUTH_EXPIRES_IN_INVALID, "extract");
  });

  it("throws AUTH_EXPIRES_IN_INVALID (§10 f) when expires_in is -Infinity", async () => {
    const err = await applyWithExpiresIn(-Infinity);
    assertCleanError(err, AUTH_ERROR_CODES.AUTH_EXPIRES_IN_INVALID, "extract");
  });

  it("throws AUTH_EXPIRES_IN_INVALID (§10 g) when expiresInPath misses in the body", async () => {
    // Body has access_token but no expires_in key
    const body: Record<string, unknown> = { access_token: "fixture-extracted-token" };
    seam.enqueueResponse(200, body);
    const strategy = new TokenEndpointStrategy(
      makeSpec({ expiresInPath: EXPIRES_IN_PATH, refreshBufferSeconds: 0 }),
      new SecretRegistry(),
      seam,
    );
    const err = await strategy
      .apply(makeRequest(), makeContext())
      .catch((e: unknown) => e);
    assertCleanError(err, AUTH_ERROR_CODES.AUTH_EXPIRES_IN_INVALID, "extract");
  });

  it("does NOT call secrets.add when expires_in extraction fails (no partial registration)", async () => {
    const secrets = new SecretRegistry();
    const body: Record<string, unknown> = {
      access_token: "fixture-extracted-token",
      expires_in: -1,
    };
    seam.enqueueResponse(200, body);
    const strategy = new TokenEndpointStrategy(
      makeSpec({ expiresInPath: EXPIRES_IN_PATH }),
      secrets,
      seam,
    );
    await strategy.apply(makeRequest(), makeContext()).catch(() => undefined);
    expect(secrets.size).toBe(0);
  });

  it("accepts expires_in: 1 (positive finite — boundary condition)", async () => {
    seam.enqueueResponse(200, { access_token: "fixture-extracted-token", expires_in: 1 });
    const strategy = new TokenEndpointStrategy(
      makeSpec({ expiresInPath: EXPIRES_IN_PATH, refreshBufferSeconds: 0 }),
      new SecretRegistry(),
      seam,
    );
    // Must NOT throw
    await expect(
      strategy.apply(makeRequest(), makeContext()),
    ).resolves.toBeTruthy();
  });

  it("accepts expires_in: 3600 (typical positive finite value)", async () => {
    seam.enqueueResponse(200, { access_token: "fixture-extracted-token", expires_in: 3600 });
    const strategy = new TokenEndpointStrategy(
      makeSpec({ expiresInPath: EXPIRES_IN_PATH, refreshBufferSeconds: 0 }),
      new SecretRegistry(),
      seam,
    );
    await expect(
      strategy.apply(makeRequest(), makeContext()),
    ).resolves.toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// describe: No-leak guarantee (AC#5) — exhaustive secret-free assertions
// ---------------------------------------------------------------------------

/**
 * For every error path: the thrown error's serializable surface (message,
 * code, phase, name, and JSON.stringify of the whole object) must contain NONE
 * of the credential values or token values defined as secrets (AC#5 + D10).
 *
 * This describe block is the canonical pinning of the no-leak guarantee across
 * all ten error codes.
 */
describe("TokenEndpointStrategy — secret-free error messages (AC#5)", () => {
  let seam: ErrorFakeSeam;

  beforeEach(() => {
    seam = new ErrorFakeSeam();
  });

  it("fetch-failure error does not contain the username or password", async () => {
    const networkErr = new AuthStrategyError({
      code: AUTH_ERROR_CODES.AUTH_TOKEN_FETCH_FAILED,
      phase: "fetch",
      message: "connection refused",
    });
    seam.enqueueRejection(networkErr);
    const strategy = new TokenEndpointStrategy(makeSpec(), new SecretRegistry(), seam);
    const err = await strategy
      .apply(makeRequest(), makeContext())
      .catch((e: unknown) => e);
    assertCleanError(err, AUTH_ERROR_CODES.AUTH_TOKEN_FETCH_FAILED, "fetch");
  });

  it("non-2xx error does not contain the username or password", async () => {
    const non2xxErr = new AuthStrategyError({
      code: AUTH_ERROR_CODES.AUTH_TOKEN_FETCH_NON_2XX,
      phase: "fetch",
      message: "received status 401",
    });
    seam.enqueueRejection(non2xxErr);
    const strategy = new TokenEndpointStrategy(makeSpec(), new SecretRegistry(), seam);
    const err = await strategy
      .apply(makeRequest(), makeContext())
      .catch((e: unknown) => e);
    assertCleanError(err, AUTH_ERROR_CODES.AUTH_TOKEN_FETCH_NON_2XX, "fetch");
  });

  it("AUTH_TOKEN_NOT_FOUND error does not cite the response body", async () => {
    seam.enqueueResponse(200, { secret_internal_key: "fixture-username-secret" });
    const strategy = new TokenEndpointStrategy(makeSpec(), new SecretRegistry(), seam);
    const err = await strategy
      .apply(makeRequest(), makeContext())
      .catch((e: unknown) => e);
    assertCleanError(err, AUTH_ERROR_CODES.AUTH_TOKEN_NOT_FOUND, "extract");
    // Also must not contain the response body content
    expect((err as AuthStrategyError).message).not.toContain("secret_internal_key");
  });

  it("AUTH_TOKEN_NOT_STRING error cites only typeof, not the actual value", async () => {
    seam.enqueueResponse(200, { access_token: 99999 });
    const strategy = new TokenEndpointStrategy(makeSpec(), new SecretRegistry(), seam);
    const err = await strategy
      .apply(makeRequest(), makeContext())
      .catch((e: unknown) => e);
    assertCleanError(err, AUTH_ERROR_CODES.AUTH_TOKEN_NOT_STRING, "extract");
    // '99999' must not appear — only typeof "number" is allowed
    expect((err as AuthStrategyError).message).not.toContain("99999");
  });

  it("AUTH_EXPIRES_IN_INVALID error does not cite the actual bad expires_in value", async () => {
    seam.enqueueResponse(200, {
      access_token: "fixture-extracted-token",
      expires_in: -999,
    });
    const strategy = new TokenEndpointStrategy(
      makeSpec({ expiresInPath: EXPIRES_IN_PATH }),
      new SecretRegistry(),
      seam,
    );
    const err = await strategy
      .apply(makeRequest(), makeContext())
      .catch((e: unknown) => e);
    assertCleanError(err, AUTH_ERROR_CODES.AUTH_EXPIRES_IN_INVALID, "extract");
    expect((err as AuthStrategyError).message).not.toContain("-999");
  });

  it("AUTH_TOKEN_NOT_STRING error does not cite the extracted token string value", async () => {
    // token is technically wrong type (array) — the value itself must not appear in message
    seam.enqueueResponse(200, { access_token: ["fixture-extracted-token"] });
    const strategy = new TokenEndpointStrategy(makeSpec(), new SecretRegistry(), seam);
    const err = await strategy
      .apply(makeRequest(), makeContext())
      .catch((e: unknown) => e);
    assertCleanError(err, AUTH_ERROR_CODES.AUTH_TOKEN_NOT_STRING, "extract");
    expect((err as AuthStrategyError).message).not.toContain(
      "fixture-extracted-token",
    );
  });
});

// ---------------------------------------------------------------------------
// describe: AuthStrategyError shape (structural sanity)
// ---------------------------------------------------------------------------

/**
 * Structural tests confirming AuthStrategyError carries the expected `code`
 * and `phase` fields and is an instance of Error. Tests are free-standing
 * (not dependent on the strategy under test) but placed here to keep all
 * error-taxonomy tests in one file.
 */
describe("AuthStrategyError — structural shape", () => {
  it("is an instance of Error", () => {
    const err = new AuthStrategyError({
      code: AUTH_ERROR_CODES.AUTH_TOKEN_NOT_FOUND,
      phase: "extract",
      message: "token not found",
    });
    expect(err).toBeInstanceOf(Error);
  });

  it("carries the configured code field", () => {
    const err = new AuthStrategyError({
      code: AUTH_ERROR_CODES.AUTH_TOKEN_NOT_FOUND,
      phase: "extract",
      message: "x",
    });
    expect(err.code).toBe(AUTH_ERROR_CODES.AUTH_TOKEN_NOT_FOUND);
  });

  it("carries the configured phase field", () => {
    const err = new AuthStrategyError({
      code: AUTH_ERROR_CODES.AUTH_TOKEN_NOT_FOUND,
      phase: "extract",
      message: "x",
    });
    expect(err.phase).toBe("extract");
  });

  it("carries the configured message", () => {
    const err = new AuthStrategyError({
      code: AUTH_ERROR_CODES.AUTH_TOKEN_NOT_FOUND,
      phase: "extract",
      message: "token not found in body",
    });
    expect(err.message).toBe("token not found in body");
  });
});
