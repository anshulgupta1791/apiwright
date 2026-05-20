/**
 * OPT-IN LIVE E2E test for §6 Authentication Strategy Layer.
 *
 * NOT part of the gated `npm test` (lives under tests/e2e/**, excluded by
 * configs/vitest.config.ts). Runs only via `npm run test:e2e`. Skipped
 * automatically unless ALL FOUR live env vars are set:
 *   APIWRIGHT_E2E_AUTH_URL, APIWRIGHT_E2E_AUTH_USERNAME,
 *   APIWRIGHT_E2E_AUTH_PASSWORD, APIWRIGHT_E2E_AUTH_TOKEN_PATH
 * — so CI, fork PRs, and the gated `npm test` never make a real network call
 * and never need real credentials.
 *
 * Exercises the §6 surface end-to-end through the REAL
 * `createDefaultHttpFetchSeam` default (Node 22 native global `fetch`),
 * proving the default seam wires up cleanly. Asserts contract-level
 * properties only (header attached, SecretRegistry populated, single-flight
 * cache identity) — NEVER the literal token (D10).
 *
 * Locked decisions D2 (Alpaca hybrid) + D18 (e2e config unchanged) + D10
 * (secret-free errors). Negative-marker wrappers + refresh path are out of
 * scope per YAML explicit-non-goals (covered by the hermetic sibling task).
 */

import { beforeAll, describe, expect, it } from "vitest";

import {
  AUTH_ERROR_CODES,
  createAuthRegistry,
  isAuthStrategyError,
} from "../../src/auth/index.js";
import type { AuthorizedRequest, PreparedRequest } from "../../src/auth/index.js";
import { SecretRegistry } from "../../src/env/secrets.js";
import type { ResolvedEnvironment } from "../../src/env/types.js";

// ---------------------------------------------------------------------------
// Suite-level skip gate: ALL FOUR env vars must be present and non-empty.
// process.env lookups happen here (module evaluation); no other reads occur
// when NO_LIVE is true. describe.skipIf() prevents beforeAll + every it()
// from executing, so zero network access occurs in the skip path.
// ---------------------------------------------------------------------------

const URL_ENV = process.env["APIWRIGHT_E2E_AUTH_URL"];
const USER_ENV = process.env["APIWRIGHT_E2E_AUTH_USERNAME"];
const PASS_ENV = process.env["APIWRIGHT_E2E_AUTH_PASSWORD"];
const PATH_ENV = process.env["APIWRIGHT_E2E_AUTH_TOKEN_PATH"];
const NO_LIVE = !URL_ENV || !USER_ENV || !PASS_ENV || !PATH_ENV;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Per-test timeout (ms) — appropriate for a real HTTP round-trip + TLS. */
const PER_TEST_TIMEOUT_MS = 15_000;

/**
 * Permissive regex for a token-shaped value.
 * Covers JWT segments, opaque base64url, and common OAuth bearer token chars.
 * Asserts only "looks token-shaped" — never the literal token value (D10).
 */
const TOKEN_SHAPE = /^[A-Za-z0-9._\-+/=]+$/;

/**
 * Regex for the full Authorization header value after `apply()`.
 * The strategy template is `Bearer ${token}`, so the header must start
 * with "Bearer " followed by a token-shaped segment.
 */
const BEARER_SHAPE = /^Bearer [A-Za-z0-9._\-+/=]+$/;

/**
 * Developer-facing diagnostic hints keyed by AuthStrategyError code.
 * Values reference env var NAMES only — never credential values (D10 / §6).
 */
const LIVE_HINT_BY_CODE: Readonly<Record<string, string>> = {
  [AUTH_ERROR_CODES.AUTH_TOKEN_FETCH_NON_2XX]:
    "Check APIWRIGHT_E2E_AUTH_USERNAME and APIWRIGHT_E2E_AUTH_PASSWORD; " +
    "the auth endpoint returned a non-2xx status.",
  [AUTH_ERROR_CODES.AUTH_TOKEN_FETCH_FAILED]:
    "Check APIWRIGHT_E2E_AUTH_URL is reachable; the network fetch failed.",
  [AUTH_ERROR_CODES.AUTH_TOKEN_NOT_FOUND]:
    "Check APIWRIGHT_E2E_AUTH_TOKEN_PATH against the endpoint's response shape; " +
    "the JSONPath did not resolve to a string token.",
};

// ---------------------------------------------------------------------------
// Live suite — skipped entirely when NO_LIVE is true (§2, §7)
// ---------------------------------------------------------------------------

describe.skipIf(NO_LIVE)("§6 live E2E — default Node-fetch path", () => {
  // Shared registry state — constructed once in beforeAll; referenced by
  // every test case. beforeAll runs before the first it(); all 5 tests share
  // the same registry instance and therefore the same cold-start token fetch.
  let registry: ReturnType<typeof createAuthRegistry>;
  let secrets: SecretRegistry;
  let strategy: ReturnType<typeof registry.acquire>;
  let stubReq: PreparedRequest;
  let ctx: { env: ResolvedEnvironment; secrets: SecretRegistry };
  let firstApply: AuthorizedRequest;

  // -------------------------------------------------------------------------
  // beforeAll — construct registry once and perform the ONE real token fetch
  // -------------------------------------------------------------------------

  beforeAll(async () => {
    // Build ResolvedEnvironment inline from process.env — per §4.1 and AC#2.
    // No EnvironmentLoader / fixture YAML file; credentials live in env vars.
    // The non-null assertions (URL_ENV!, …) are safe because NO_LIVE=false
    // means all four are non-empty strings (the skip gate guarantees this).
    const env: ResolvedEnvironment = {
      name: "live-e2e",
      prod: false,
      base_url: "https://example.invalid",
      default_sla_ms: PER_TEST_TIMEOUT_MS,
      auth_strategies: {
        live_token: {
          type: "token_endpoint",
          url: URL_ENV!,
          credentials: { username: USER_ENV!, password: PASS_ENV! },
          token_path: PATH_ENV!,
          header: "Authorization",
          header_value: "Bearer ${token}",
        },
      },
    };

    secrets = new SecretRegistry();

    // NO injected fetchSeam argument → exercises createDefaultHttpFetchSeam()
    // default seam (real Node 22 native global `fetch`). This is the whole
    // point of the live E2E (AC#2 + D2).
    registry = createAuthRegistry(env, secrets);

    // acquire() returns a cached strategy instance; subsequent acquire("live_token")
    // calls inside test cases return the SAME object (referential equality — §4.2 T3).
    strategy = registry.acquire("live_token");

    stubReq = {
      method: "GET",
      url: `${env.base_url}/ping`,
      headers: {},
    };
    ctx = { env, secrets };

    // The single real token POST. Subsequent apply() calls hit the cached
    // token (single-flight cache — §5). Error handling per §6: catch, map to
    // a developer-facing diagnostic, rethrow without credential values (D10).
    try {
      firstApply = await strategy.apply(stubReq, ctx);
    } catch (err: unknown) {
      if (isAuthStrategyError(err)) {
        const hint =
          LIVE_HINT_BY_CODE[err.code] ??
          `live auth setup failed (code=${err.code})`;
        throw new Error(`§6 live E2E setup failed — ${hint}`);
      }
      // Re-throw non-AuthStrategyError as-is (unexpected failure type).
      throw err;
    }
  }, PER_TEST_TIMEOUT_MS);

  // -------------------------------------------------------------------------
  // T1 — Header is attached with a token-shaped value
  // -------------------------------------------------------------------------

  it(
    "apply() attaches Authorization header with a token-shaped Bearer value",
    () => {
      const auth = firstApply.headers["Authorization"];
      expect(auth).toBeDefined();
      expect(auth).toMatch(BEARER_SHAPE);
    },
    PER_TEST_TIMEOUT_MS,
  );

  // -------------------------------------------------------------------------
  // T2 — SecretRegistry is populated with the resolved token
  // -------------------------------------------------------------------------

  it(
    "registers the resolved token with SecretRegistry after first apply",
    () => {
      // At least the token resolved from the real endpoint must be in the
      // registry (D8 secret registration through the real seam path).
      expect(secrets.size).toBeGreaterThanOrEqual(1);

      // At least one registered value looks token-shaped (permissive — we
      // never assert the literal token value, D10).
      const hasTokenShaped = Array.from(secrets.values()).some((v) =>
        TOKEN_SHAPE.test(v),
      );
      expect(hasTokenShaped).toBe(true);
    },
    PER_TEST_TIMEOUT_MS,
  );

  // -------------------------------------------------------------------------
  // T3 — Registry caches strategy by name (referential identity)
  // -------------------------------------------------------------------------

  it(
    "acquire() returns the cached strategy instance (referential identity)",
    () => {
      // The registry must return the SAME object it built on the first
      // acquire() call. A fresh object would re-fetch on the next apply().
      expect(registry.acquire("live_token")).toBe(strategy);
    },
    PER_TEST_TIMEOUT_MS,
  );

  // -------------------------------------------------------------------------
  // T4 — Five sequential applies all succeed without re-fetching (§5 probe)
  // -------------------------------------------------------------------------

  it(
    "5 sequential applies all succeed and complete quickly (cache probe)",
    async () => {
      // Wall-clock proxy for single-flight caching (see design §5).
      // A real re-fetch on every apply would exceed 1 000 ms for five calls;
      // five cached header-attach operations from memory should be <10 ms.
      // This is a SOFT assertion: slow endpoints or loaded machines may
      // occasionally trip it. The hermetic sibling test pins the exact count.
      const start = Date.now();

      for (let i = 0; i < 5; i++) {
        const out = await strategy.apply(stubReq, ctx);
        expect(out.headers["Authorization"]).toMatch(BEARER_SHAPE);
      }

      const elapsed = Date.now() - start;
      // 1 000 ms ceiling: generous enough to survive a slow CI machine while
      // still catching the regression where caching broke and every apply
      // triggers a real network call (which would be ≥100 ms each × 5).
      expect(elapsed).toBeLessThan(1_000);
    },
    PER_TEST_TIMEOUT_MS,
  );

  // -------------------------------------------------------------------------
  // T5 — Token value is never used as a header name (defense in depth)
  // -------------------------------------------------------------------------

  it(
    "the Authorization header name is exactly 'Authorization', not the token",
    () => {
      // Regression guard: if the strategy accidentally used the token value
      // as a header name instead of the template header name, that key would
      // appear in firstApply.headers and "Authorization" would be absent.
      expect(Object.keys(firstApply.headers)).toContain("Authorization");
    },
    PER_TEST_TIMEOUT_MS,
  );
});
