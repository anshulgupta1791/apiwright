/**
 * Negative-auth marker wrapper implementing the `garbage_token_returns_401` §3
 * attack vector (D9) via Approach C (gate-locked).
 *
 * Approach C — "call inner then re-render":
 * 1. Calls the wrapped strategy's `apply()` (triggering any side effects —
 *    token-endpoint fetch, `SecretRegistry.add` of the real token, etc.).
 * 2. Mangles the auth header in the result.
 * 3. Returns the resulting `AuthorizedRequest` with ONLY the target header
 *    replaced; all other headers from the inner result pass through unchanged.
 *
 * Two construction modes are supported:
 * - **Spec-aware mode** (`targetHeaderName` + `targetHeaderValueTemplate`
 *   provided): re-renders the configured header by substituting `${token}`
 *   with {@link GARBAGE_TOKEN_VALUE} via the {@link attachAuthHeader} SSOT.
 *   This is the primary mode used when `ValidatedStrategySpec` is available
 *   (e.g. inside the registry or unit tests with a concrete spec).
 * - **Specless mode** (only `inner` provided): after calling `inner.apply()`,
 *   scans the result headers for any value that contains a registered secret
 *   (from `context.secrets.values()`) and replaces those secret substrings
 *   with {@link GARBAGE_TOKEN_VALUE}. Used by the public barrel consumer who
 *   cannot access the internal `ValidatedStrategySpec` type.
 *
 * This honors D9 literal wording ("calls wrapped strategy then replaces").
 * The real token is registered with `SecretRegistry` for redaction (inner
 * side-effect) but is NOT placed on the wire — the SUT receives only the
 * GARBAGE value.
 *
 * INTERNAL: not re-exported from the public barrel (`src/auth/index.ts`).
 * @module
 */

import { attachAuthHeader } from "../strategies/header-attacher.js";
import type {
  AuthStrategy,
  AuthorizedRequest,
  PreparedRequest,
  RunContext,
} from "../types.js";

/**
 * The literal garbage value substituted for `${token}` in the configured
 * header value template. D9-locked: this string is the only value used;
 * it is a named constant rather than a magic string (repo idiom).
 *
 * Exported for test assertions — tests import this const rather than
 * repeating the literal, ensuring a single edit point if the value ever
 * changes (a code-change, not config-change event under D9).
 */
export const GARBAGE_TOKEN_VALUE = "garbage_token_value";

/** Sentinel indicating specless (secrets-scan) mode. */
const SPECLESS = Symbol("SPECLESS");

/**
 * Replaces all occurrences of every registered secret value in `headerValue`
 * with {@link GARBAGE_TOKEN_VALUE}. Used in specless mode where the header
 * template is not available; instead we redact whatever the inner strategy
 * placed in the header by scanning the run-scoped secret registry.
 * @param headerValue - The header value from the inner authorized result.
 * @param secrets - The run-scoped secret values (post-inner-apply side effect).
 * @returns The header value with every registered secret replaced by the garbage.
 */
function replaceSecretsWithGarbage(
  headerValue: string,
  secrets: ReadonlySet<string>,
): string {
  let result = headerValue;
  for (const secret of secrets) {
    if (secret.length > 0) {
      result = result.replaceAll(secret, () => GARBAGE_TOKEN_VALUE);
    }
  }
  return result;
}

/**
 * Negative-auth marker wrapper (Approach C — gate-locked): honors D9 literal
 * wording by CALLING the wrapped strategy's `apply()` and then REPLACING the
 * inner-attached auth header with a garbage value.
 *
 * Supports two modes:
 * - **Spec-aware**: uses the configured header name and value template from
 *   `ValidatedStrategySpec` (three-arg constructor). The target header is
 *   re-rendered via {@link attachAuthHeader} with `${token}` →
 *   {@link GARBAGE_TOKEN_VALUE}. This is the mode used by `wrapForMarker`
 *   when a spec is available.
 * - **Specless**: no header config is provided (single-arg constructor). After
 *   calling `inner.apply()`, scans ALL result headers for registered secret
 *   values (from `context.secrets.values()`) and replaces them in-place with
 *   {@link GARBAGE_TOKEN_VALUE}. This is the mode used by the public barrel
 *   consumer via `wrapForMarker(strategy, "garbage_token_returns_401")`.
 *
 * Implements {@link AuthStrategy} so it is a drop-in replacement in the
 * strategy dispatch chain (D9, D13).
 */
export class GarbageTokenMangle implements AuthStrategy {
  /** The wrapped strategy whose `apply()` is called first. */
  readonly #inner: AuthStrategy;

  /**
   * The HTTP header name at the strategy's configured casing (e.g.
   * `"Authorization"`, `"X-Auth"`). Set to `SPECLESS` sentinel in specless mode.
   */
  readonly #targetHeaderName: string | typeof SPECLESS;

  /**
   * The header value template from the strategy's validated spec (e.g.
   * `"Bearer ${token}"`). Set to `SPECLESS` sentinel in specless mode.
   */
  readonly #targetHeaderValueTemplate: string | typeof SPECLESS;

  /**
   * Spec-aware constructor: wraps `inner` to call it then replace its auth
   * header with a garbage value rendered from the given header name and template.
   * @param inner - The underlying strategy to invoke at apply-time.
   * @param targetHeaderName - Header name to replace (case-insensitive collision).
   * @param targetHeaderValueTemplate - Value template; `${token}` → garbage.
   */
  constructor(
    inner: AuthStrategy,
    targetHeaderName: string,
    targetHeaderValueTemplate: string,
  );

  /**
   * Specless constructor: wraps `inner` to call it then scan ALL result headers
   * for registered secrets and replace them with {@link GARBAGE_TOKEN_VALUE}.
   * Used by the public barrel consumer who does not have access to the internal
   * `ValidatedStrategySpec` type.
   * @param inner - The underlying strategy to invoke at apply-time.
   */
  constructor(inner: AuthStrategy);

  /**
   * Implementation overload — DO NOT CALL DIRECTLY. Use one of the typed
   * overloads above. Stores the inner strategy and optional header config;
   * absent config fields are replaced by the `SPECLESS` sentinel.
   * @param inner - The wrapped strategy to invoke at apply-time.
   * @param targetHeaderName - Optional header name for spec-aware mode.
   * @param targetHeaderValueTemplate - Optional template for spec-aware mode.
   */
  constructor(
    inner: AuthStrategy,
    targetHeaderName?: string,
    targetHeaderValueTemplate?: string,
  ) {
    this.#inner = inner;
    this.#targetHeaderName = targetHeaderName ?? SPECLESS;
    this.#targetHeaderValueTemplate = targetHeaderValueTemplate ?? SPECLESS;
  }

  /**
   * Applies the garbage-token attack vector.
   *
   * **Spec-aware mode** (when `targetHeaderName` + `targetHeaderValueTemplate`
   * were provided at construction):
   * Step 1: calls `inner.apply(request, context)` — any side effects execute.
   * Step 2: calls {@link attachAuthHeader} on the inner result, substituting
   * `${token}` → {@link GARBAGE_TOKEN_VALUE} in the configured template.
   *
   * **Specless mode** (single-arg constructor):
   * Step 1: calls `inner.apply(request, context)` — registers token in secrets.
   * Step 2: for every header in the inner result, replaces any registered secret
   * value substring with {@link GARBAGE_TOKEN_VALUE} using the run-scoped secret
   * registry (which has the real token after step 1).
   * @param request - The prepared (unauth'd) outgoing request.
   * @param context - Run-scoped context forwarded to `inner.apply()`; also
   *   provides the secret registry used in specless mode for token detection.
   * @returns A new `AuthorizedRequest` with auth headers carrying the garbage
   *   value; all non-auth headers from the inner result are preserved.
   * @throws Re-throws any error from `inner.apply()` unchanged (no catch).
   */
  async apply(
    request: PreparedRequest,
    context: RunContext,
  ): Promise<AuthorizedRequest> {
    // D9 literal — "calls wrapped strategy then replaces..."
    // Step 1: invoke inner; side effects (fetch, SecretRegistry.add) run here.
    const innerAuthed = await this.#inner.apply(request, context);

    // Step 2 (spec-aware): re-render the target header with the garbage value
    // using the configured header name and template.
    if (
      this.#targetHeaderName !== SPECLESS &&
      this.#targetHeaderValueTemplate !== SPECLESS
    ) {
      return attachAuthHeader(
        innerAuthed,
        this.#targetHeaderName,
        this.#targetHeaderValueTemplate,
        GARBAGE_TOKEN_VALUE,
      );
    }

    // Step 2 (specless): scan ALL headers in the inner result for registered
    // secret values and replace them with the garbage value. This replaces the
    // real token wherever it appears in any header value (typically the
    // Authorization header attached by the inner strategy).
    const secrets = context.secrets.values();
    const mangledHeaders: Record<string, string> = {};
    for (const [key, value] of Object.entries(innerAuthed.headers)) {
      mangledHeaders[key] = replaceSecretsWithGarbage(value, secrets);
    }
    return { ...innerAuthed, headers: mangledHeaders };
  }
}
