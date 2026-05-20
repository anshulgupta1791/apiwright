/**
 * Valid `ResolvedEnvironment` fixture for the §6 Auth Strategy Layer corpus.
 *
 * Exports the canonical positive-corpus `ResolvedEnvironment` with one
 * `static_token` entry and two `token_endpoint` entries (one WITH
 * `expires_in_path` for lazy-refresh tests, one WITHOUT for cached-for-run
 * tests). All credential/token literals are prefixed with `fixture-` so CI
 * grep can verify no real secrets exist in this file.
 *
 * All URLs use the `.invalid` TLD (RFC 2606 §2 — guaranteed non-resolvable).
 * Mirrors `tests/fixtures/db/environment.ts` pattern verbatim.
 *
 * Named exports only; no default export.
 */

import type { ResolvedEnvironment } from "../../../src/env/types.js";
import type { PreparedRequest } from "../../../src/auth/index.js";

// ─── Fetched-token constants used across groups C/D/E/F/G ───────────────────

/**
 * First fetched token returned by the fake seam on a cold-start fetch.
 * Groups C, D, E, G assert this value appears in the Authorization header.
 */
export const FETCHED_TOKEN_T1 = "fixture-fetched-token-T1";

/**
 * Second fetched token returned by the fake seam on a refresh fetch.
 * Group F (lazy refresh) asserts this value appears after expiry.
 */
export const FETCHED_TOKEN_T2 = "fixture-fetched-token-T2";

// ─── Marker secret substrings ────────────────────────────────────────────────

/**
 * Canonical set of credential/token strings that MUST NEVER appear in any
 * thrown `AuthStrategyError`'s `.message`, `.code`, `.phase`, `.name`, or
 * JSON serialisation. Group J asserts each error code is "secret-free" by
 * checking all thrown errors against this list.
 *
 * Every entry is a post-resolution, obvious-fake literal (no `${...}`
 * templates). All begin with `fixture-` for CI-grep discoverability.
 */
export const MARKER_SECRET_SUBSTRINGS: readonly string[] = [
  "fixture-username-value",
  "fixture-password-value",
  "fixture-static-token-value",
];

// ─── Sample request ──────────────────────────────────────────────────────────

/**
 * Minimal `PreparedRequest` used by every `apply()` call in groups B–K.
 * URL ends in `.invalid` to guarantee DNS failure if the seam is accidentally
 * bypassed.
 */
export const SAMPLE_REQUEST: PreparedRequest = Object.freeze({
  method: "GET",
  url: "https://api-qa.fixture.invalid/users",
  headers: Object.freeze({} as Readonly<Record<string, string>>),
});

// ─── Valid resolved environment ───────────────────────────────────────────────

/**
 * Synthetic `ResolvedEnvironment` with three auth strategies:
 * - `sso_static`              — `static_token`; registered at construction.
 * - `sso_endpoint_refresh`    — `token_endpoint` WITH `expires_in_path`; drives
 *                               the lazy-refresh code path (group F).
 * - `sso_endpoint_no_refresh` — `token_endpoint` WITHOUT `expires_in_path`;
 *                               cached-for-run path (groups C/D/E/G).
 *
 * Insertion order is intentional: the order matches group A's D19 ordering
 * assertion on the INVALID env fixture. Here it is used only as the positive
 * corpus driving groups B–K.
 */
export const VALID_ENV: ResolvedEnvironment = Object.freeze({
  name: "qa",
  prod: false,
  base_url: "https://api-qa.fixture.invalid",
  default_sla_ms: 1000,
  auth_strategies: Object.freeze({
    sso_static: Object.freeze({
      type: "static_token" as const,
      token: "fixture-static-token-value",
      header: "Authorization",
      header_value: "Bearer ${token}",
    }),
    sso_endpoint_refresh: Object.freeze({
      type: "token_endpoint" as const,
      url: "https://sso.fixture.invalid/oauth/token",
      credentials: Object.freeze({
        username: "fixture-username-value",
        password: "fixture-password-value",
      }),
      token_path: "$.access_token",
      expires_in_path: "$.expires_in",
      refresh_buffer_seconds: 0,
      header: "Authorization",
      header_value: "Bearer ${token}",
    }),
    sso_endpoint_no_refresh: Object.freeze({
      type: "token_endpoint" as const,
      url: "https://sso.fixture.invalid/oauth/token",
      credentials: Object.freeze({
        username: "fixture-username-value",
        password: "fixture-password-value",
      }),
      token_path: "$.access_token",
      header: "Authorization",
      header_value: "Bearer ${token}",
    }),
  }),
});
