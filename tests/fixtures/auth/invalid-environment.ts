/**
 * Malformed `ResolvedEnvironment` fixture for the §6 Auth Strategy Layer.
 *
 * Same top-level shape as `environment.ts` (same `name`/`prod`/`base_url`/
 * `default_sla_ms`); only the `auth_strategies` block differs. The three
 * malformed entries exercise:
 *
 * - `bad_grant_type`       — D15 violation: `grant_type: "refresh_token"` is
 *                            not accepted in v1.0 (v1.5 deferral).
 * - `bad_extra_credential` — D14 violation: extra key `client_id` in
 *                            `credentials` object.
 * - `bad_token_path`       — JSONPath subset violation: `$..wildcard` uses
 *                            recursive-descent `..` which the §6 subset
 *                            rejects (only `$.a.b.c` dot-paths supported).
 *
 * Insertion order mirrors the order of `MALFORMED_NAMES` below: the D19
 * aggregated-error message must name all three in this order (group A).
 *
 * All credentials are obviously fake (`fixture-*`); no real secrets exist.
 * Named exports only; no default export.
 */

import type { ResolvedEnvironment } from "../../../src/env/types.js";

/**
 * Ordered list of the three malformed strategy names in INVALID_ENV.
 * Group A asserts the aggregated `AUTH_CONFIG_INVALID` error message contains
 * all three, in this insertion order.
 */
export const MALFORMED_NAMES = [
  "bad_grant_type",
  "bad_extra_credential",
  "bad_token_path",
] as const;

/**
 * `ResolvedEnvironment` whose `auth_strategies` block contains three
 * intentionally malformed entries. Passing this to `createAuthRegistry`
 * MUST throw a single `AuthStrategyError` of code `AUTH_CONFIG_INVALID`
 * whose message names all three entries (D19 aggregation contract).
 */
export const INVALID_ENV: ResolvedEnvironment = Object.freeze({
  name: "qa",
  prod: false,
  base_url: "https://api-qa.fixture.invalid",
  default_sla_ms: 1000,
  auth_strategies: Object.freeze({
    bad_grant_type: Object.freeze({
      type: "token_endpoint" as const,
      url: "https://sso.fixture.invalid/oauth/token",
      credentials: Object.freeze({
        username: "fixture-username-value",
        password: "fixture-password-value",
      }),
      // D15: grant_type: "refresh_token" is rejected in v1.0 (v1.5 deferral).
      grant_type: "refresh_token",
      token_path: "$.access_token",
      header: "Authorization",
      header_value: "Bearer ${token}",
    }),
    bad_extra_credential: Object.freeze({
      type: "token_endpoint" as const,
      url: "https://sso.fixture.invalid/oauth/token",
      credentials: Object.freeze({
        username: "fixture-username-value",
        password: "fixture-password-value",
        // D14: extra credential key rejected; only username+password allowed.
        client_id: "fixture-client-id-value",
      }),
      token_path: "$.access_token",
      header: "Authorization",
      header_value: "Bearer ${token}",
    }),
    bad_token_path: Object.freeze({
      type: "token_endpoint" as const,
      url: "https://sso.fixture.invalid/oauth/token",
      credentials: Object.freeze({
        username: "fixture-username-value",
        password: "fixture-password-value",
      }),
      // JSONPath subset violation: `..` recursive descent is not supported.
      token_path: "$..wildcard",
      header: "Authorization",
      header_value: "Bearer ${token}",
    }),
  }),
});
