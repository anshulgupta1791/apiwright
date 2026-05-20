/**
 * Public barrel for the `src/auth` module — the SINGLE documented import
 * entry point for the §6 Authentication Strategy Layer. Consumers (the
 * Task #10 runner; later the §4 auth tie-in) import EVERYTHING from
 * this barrel (the src/auth path), never via a deep src/auth/** path,
 * mirroring src/db/index.ts and src/assertions/index.ts. Re-
 * exports the §6 consumer contract: the strategy registry and the thin
 * env→registry factory, the `AuthStrategy` interface and its shared
 * stub types, the redaction-safe error taxonomy and type guard, the
 * `wrapForMarker` dispatcher and marker vocabulary, and the
 * `HttpFetchSeam` interface (typed for custom injection in tests).
 * The concrete strategy classes (`StaticTokenStrategy`,
 * `TokenEndpointStrategy`), decorator wrappers (`NoAuthBypass`,
 * `GarbageTokenMangle`), parser, JSONPath subset, and default fetch-
 * seam factory are INTERNAL — constructed only via `AuthStrategyRegistry`
 * (D5/D13) or `wrapForMarker` (D9/D13) and intentionally NOT surfaced
 * here. Named exports only (`import/no-default-export`); a pure re-
 * export hub with no logic.
 *
 * DEFERRED — NOT done here (Task #10 / §9 Test Runner): WIRING §6 into
 * a live test run — per-RUN registry open / `closeAll`, per-endpoint
 * `strategy.apply` before send and header merge, wrapping via
 * `wrapForMarker` when a §3 negative-auth marker is present, applying
 * `redactSecrets` to logs and reports. This barrel adds NO behaviour
 * beyond re-export; it modifies nothing under `src/test-catalog/*`,
 * `src/cli/*`, or any runner.
 */

// --- §6 strategy contract + stub types (auth-types-and-interface) ---
export type {
  AuthStrategy,
  AuthorizedRequest,
  PreparedRequest,
  RunContext,
} from "./types.js";

// --- Redaction-safe error taxonomy (auth-errors-taxonomy) ---
export { AUTH_ERROR_CODES, AuthStrategyError, isAuthStrategyError } from "./errors.js";
export type { AuthErrorCode, AuthPhase, AuthStrategyErrorInit } from "./errors.js";

// --- Injectable HTTP POST-JSON seam (auth-http-fetch-seam) ---
// Default seam factory (`createDefaultHttpFetchSeam`) is INTERNAL —
// the registry's `deps?.fetchSeam` default handles instantiation.
export type { HttpFetchInput, HttpFetchResult, HttpFetchSeam } from "./http-fetch-seam.js";

// --- Negative-auth marker dispatcher (auth-negative-marker-wrappers) ---
// Concrete wrapper classes (`NoAuthBypass`, `GarbageTokenMangle`) are
// INTERNAL — constructed only via `wrapForMarker` (D9/D13).
export { NEGATIVE_AUTH_MARKERS, wrapForMarker } from "./markers/wrap-for-marker.js";
export type { NegativeAuthMarker } from "./markers/wrap-for-marker.js";

// --- Run-scoped strategy registry (auth-strategy-registry) ---
// Concrete strategy classes are INTERNAL — `acquire(name)` is the
// sole public construction path (D5/D13).
export { AuthStrategyRegistry } from "./strategy-registry.js";
export type { CloseAllOutcome, StrategyCloseResult } from "./strategy-registry.js";

// --- Thin env -> registry convenience factory (sibling registry task) ---
export { createAuthRegistry } from "./registry-factory.js";
