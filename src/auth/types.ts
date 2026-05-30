/**
 * Zero-dependency type foundation for the §6 Authentication Strategy Layer.
 *
 * Exports the `AuthStrategy` pluggable interface (verbatim from the v1 spec
 * §6 lines 512–517) plus three stub types every sibling Task #9 module consumes:
 * `PreparedRequest`, `AuthorizedRequest`, and `RunContext`.
 *
 * Reuse-not-redefine: `ResolvedEnvironment` and `SecretRegistry` are imported
 * from `src/env` and composed here; neither is redeclared. No modification to
 * `src/env` or `src/core` occurs in this file.
 *
 * Deferred to named sibling tasks: `AuthStrategyError` (`auth-errors-taxonomy`),
 * the public barrel (`auth-public-api-barrel`), and all strategy implementations
 * (`static-token`, `token-endpoint`, negative-marker wrappers, registry).
 *
 * Coverage exclusion: src/auth/types.ts matches the src-asterisk-asterisk/types.ts
 * glob in configs/vitest.config.ts (line 34); this file does not move the needle.
 * Matches the Task #8 `db-connector-interface-and-types` precedent exactly.
 */

import type { SecretRegistry } from "../env/secrets.js";
import type { ResolvedEnvironment } from "../env/types.js";

/**
 * A sent-but-unauth'd outgoing HTTP request passed to an {@link AuthStrategy}.
 *
 * Every field is `readonly` so a strategy's `apply()` cannot mutate its input
 * (D11 structural guarantee). `headers` is additionally `Readonly<Record<…>>`
 * so element-level assignment (`request.headers.Authorization = "…"`) is a
 * TypeScript error at the call site (AC#5).
 *
 * Minimum field set per AC#2: `{ method, url, headers, body? }`. Additional
 * fields (e.g. `timeout_ms`) are deliberately deferred to Task #10 (see design
 * edge-case §a).
 */
export interface PreparedRequest {
  /** HTTP method, uppercase (e.g. "GET", "POST"). */
  readonly method: string;
  /** Fully-resolved absolute request URL (no remaining `${…}` templates). */
  readonly url: string;
  /**
   * Outgoing headers BEFORE the strategy attaches auth. Both the outer record
   * and individual header values are read-only at the type level: assigning
   * `request.headers.Authorization = "Bearer x"` is a TypeScript error.
   */
  readonly headers: Readonly<Record<string, string>>;
  /**
   * Optional outgoing body. `unknown` because v1.0 carries JSON-shaped bodies
   * but the §6 contract is body-agnostic (the strategy never inspects it);
   * downstream callers narrow when they need to.
   */
  readonly body?: unknown;
}

/**
 * The resolution type of {@link AuthStrategy.apply} — a {@link PreparedRequest}
 * after the strategy has attached its auth headers.
 *
 * D12-locked: this is a TYPE ALIAS of `PreparedRequest`, NOT a separate
 * interface. The two are structurally identical; the alias carries documentary
 * intent only (input is unauth'd, output is authorized). Structural identity
 * is preserved: a `PreparedRequest` is assignable to `AuthorizedRequest` and
 * vice-versa, enabling pass-through stubs and pipeline chaining without ceremony.
 *
 * If Task #10 ever adds an auth-only marker (e.g. `readonly __authedBy?: string`),
 * the alias becomes `PreparedRequest & { readonly __authedBy?: string }` in one
 * place, updating all consumers automatically.
 */
export type AuthorizedRequest = PreparedRequest;

/**
 * Minimal run-scoped context a strategy receives at {@link AuthStrategy.apply}
 * time: the resolved environment plus the secret registry.
 *
 * Deliberately minimal placeholder per AC#3. Additional fields (`runId`,
 * `timestamp`, `logger`) are NOT added here — their shape is the runner's
 * call (Task #10). Strategies in v1.0 (`static_token`, `token_endpoint`) do
 * not need them. Task #10 will extend this interface in place under `src/auth`
 * when the runner ships; NOT promoted to `src/core` before then.
 *
 * Reuse-not-redefine: `env` and `secrets` reference already-shipped types from
 * `src/env`; neither type is redeclared here.
 */
export interface RunContext {
  /**
   * The resolved environment (post template + secret resolution). Strategies
   * read `env.auth_strategies[name]` for their configuration. NEVER redefined.
   */
  readonly env: ResolvedEnvironment;
  /**
   * The run-scoped secret registry. Strategies that resolve dynamic secrets
   * (e.g. a `token_endpoint` refresh) MUST register every fetched secret here
   * so the §10 reporter can redact it from logs and reports. NEVER redefined.
   */
  readonly secrets: SecretRegistry;
}

/**
 * Pluggable §6 authentication strategy contract — transcribed verbatim from
 * §6 lines 512–517.
 *
 * A real TypeScript `interface` (not a type alias) per AC#1: implementing
 * classes use `implements AuthStrategy`; literal stubs are assignable without
 * nominal-typing friction. Mirrors the `DbConnector` interface + four engine
 * connector classes OOP idiom from Task #8.
 *
 * D11 non-mutating contract: `apply()` MUST return a NEW {@link AuthorizedRequest}
 * and must NOT mutate `request` or `context`. The structural readonly discipline
 * on `PreparedRequest` enforces this at compile time; the runner (Task #10)
 * adds `Object.freeze` / `structuredClone` defense-in-depth at the orchestration
 * boundary.
 */
export interface AuthStrategy {
  /**
   * Applies this strategy's auth to one outgoing request, producing a NEW
   * authorized request. MUST NOT mutate the input `request` or `context`
   * (D11 non-mutating contract — enforced structurally by every field of
   * {@link PreparedRequest} being `readonly`).
   * @param request - The prepared (unauth'd) outgoing HTTP request.
   * @param context - The run-scoped context (resolved env + secret registry).
   * @returns A promise resolving to a NEW {@link AuthorizedRequest} carrying
   *   the strategy's auth headers attached on top of `request.headers`.
   */
  apply(request: PreparedRequest, context: RunContext): Promise<AuthorizedRequest>;

  /**
   * Optional run-end cleanup hook. Strategies that hold mutable state across
   * a run (e.g. `TokenEndpointStrategy`'s cached token + in-flight fetch
   * Promise) implement this to clear that state when the run ends.
   * Synchronous (no async cleanup in v1.0). The `AuthStrategyRegistry`'s
   * `closeAll()` calls it ONLY when present (`if (s.close) s.close()`).
   *
   * Stateless strategies (`StaticTokenStrategy`, decorator wrappers
   * `NoAuthBypass` / `GarbageTokenMangle`) intentionally do NOT implement
   * this method — TypeScript's optional-method semantics make the omission
   * type-legal. Locked-decision Option X (registry sibling §10): minimal
   * interface widening, type-safe at the call site.
   */
  close?(): void;
}
