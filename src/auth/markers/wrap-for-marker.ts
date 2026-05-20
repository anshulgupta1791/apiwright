/**
 * Public dispatcher: maps a §3 negative-auth marker name to the appropriate
 * wrapper, or returns the strategy unchanged for any other marker (identity
 * branch, D9).
 *
 * PUBLIC exports (barrel re-exported by `auth-public-api-barrel`, D13):
 * - {@link wrapForMarker} — dispatcher function
 * - {@link NEGATIVE_AUTH_MARKERS} — closed set of v1.0 negative-auth markers
 * - {@link NegativeAuthMarker} — TypeScript type alias of the tuple's elements
 *
 * INTERNAL classes ({@link NoAuthBypass}, {@link GarbageTokenMangle}) are
 * imported here only as implementation details of the dispatch arms and are
 * NOT re-exported from this file.
 *
 * Design note (D9): adding a new marker is a CODE change — extend
 * {@link NEGATIVE_AUTH_MARKERS}, add an `if`-branch, add a wrapper file.
 * No config-driven extension mechanism is provided.
 * @module
 */

import type { ValidatedStrategySpec } from "../config-parser.js";
import type { AuthStrategy } from "../types.js";

import { GarbageTokenMangle } from "./garbage-token-mangle.js";
import { NoAuthBypass } from "./no-auth-bypass.js";

/**
 * The closed v1.0 §3 negative-auth marker set, expressed as a `readonly` tuple
 * so that `NegativeAuthMarker` can be derived via indexed-access typing.
 *
 * Order is significant: both entries match the order in the §3 spec table and
 * the order in which the dispatcher checks them (the `wrapForMarker` if-chain).
 *
 * Frozen at runtime to prevent accidental mutation. Adding a marker requires a
 * code change here (extend the array + add a dispatch arm).
 */
export const NEGATIVE_AUTH_MARKERS = Object.freeze([
  "no_auth_returns_401",
  "garbage_token_returns_401",
] as const);

/**
 * String-literal type union of every entry in {@link NEGATIVE_AUTH_MARKERS}.
 *
 * Derived via indexed-access typing so the type and the runtime array stay in
 * sync from a single declaration (D9 single source of truth).
 *
 * Example:
 * ```typescript
 * const m: NegativeAuthMarker = "no_auth_returns_401"; // OK
 * const bad: NegativeAuthMarker = "bogus"; // TS error
 * ```
 */
export type NegativeAuthMarker = (typeof NEGATIVE_AUTH_MARKERS)[number];

/**
 * Dispatches a §3 negative-auth marker name to its wrapper, or returns
 * `strategy` unchanged for any other marker name (D9 identity branch).
 *
 * Dispatch is PURE: no `strategy.apply()` is called at dispatch time. The
 * returned wrapper only calls `apply()` when the caller invokes it.
 *
 * Two calling conventions are supported:
 * - **Spec-aware** (`spec` provided): `GarbageTokenMangle` uses the spec's
 *   `header` and `headerValue` fields to re-render the configured header with
 *   `${token}` → `"garbage_token_value"`. Preferred when `ValidatedStrategySpec`
 *   is available (e.g. inside the registry or internal callers).
 * - **Specless** (`spec` omitted): `GarbageTokenMangle` enters specless mode —
 *   after calling `inner.apply()`, it scans every header in the result for
 *   registered secret values (from `context.secrets.values()`) and replaces them
 *   with `"garbage_token_value"`. Used by the public barrel consumer who cannot
 *   access the internal `ValidatedStrategySpec` type.
 *
 * Identity semantics for unknown markers (including empty strings and
 * close-but-not-exact variants) are intentional — D9 says any marker outside
 * the closed set is ignored, not rejected.
 * @param strategy - Underlying strategy to wrap (or pass through unchanged).
 * @param markerName - §3 marker name; any string is accepted (unknown → identity).
 * @param spec - Optional validated spec for `strategy`; used ONLY to read
 *   `spec.header` and `spec.headerValue` for the `garbage_token_returns_401`
 *   arm. When absent, `GarbageTokenMangle` operates in specless mode.
 *   Both `ValidatedStaticTokenSpec` and `ValidatedTokenEndpointSpec` arms
 *   expose these fields.
 * @returns A {@link NoAuthBypass} for `"no_auth_returns_401"`, a
 *   {@link GarbageTokenMangle} for `"garbage_token_returns_401"`, or `strategy`
 *   unchanged (object identity preserved) for any other marker.
 */
export function wrapForMarker(
  strategy: AuthStrategy,
  markerName: string,
  spec?: ValidatedStrategySpec,
): AuthStrategy {
  if (markerName === "no_auth_returns_401") {
    return new NoAuthBypass(strategy);
  }
  if (markerName === "garbage_token_returns_401") {
    if (spec !== undefined) {
      return new GarbageTokenMangle(strategy, spec.header, spec.headerValue);
    }
    return new GarbageTokenMangle(strategy);
  }
  return strategy;
}
