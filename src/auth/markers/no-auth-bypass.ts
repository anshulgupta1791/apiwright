/**
 * Negative-auth marker wrapper implementing the `no_auth_returns_401` §3 attack
 * vector (D9). Returns the input `PreparedRequest` UNCHANGED — no auth header is
 * attached, no inner strategy is invoked.
 *
 * INTERNAL: not re-exported from the public barrel (`src/auth/index.ts`). The
 * barrel sibling (`auth-public-api-barrel`, D13) exports only `wrapForMarker`,
 * `NEGATIVE_AUTH_MARKERS`, and `NegativeAuthMarker`.
 *
 * Design notes:
 * - The inner strategy is held in `#inner` for symmetry with
 *   {@link GarbageTokenMangle} and future debug visibility, but is NEVER called.
 * - Reference equality (`output === input`) is the intentional contract (D11):
 *   `AuthorizedRequest = PreparedRequest` alias is type-lawful; Layer A's
 *   `Readonly<Record<>>` blocks downstream mutation at compile time.
 * - No state beyond `#inner`; no cleanup needed; `close()` is intentionally absent.
 * @module
 */

import type {
  AuthStrategy,
  AuthorizedRequest,
  PreparedRequest,
  RunContext,
} from "../types.js";

/**
 * Negative-auth marker wrapper: returns the input request UNCHANGED.
 *
 * Generates the `no_auth_returns_401` §3 attack vector — no auth header is
 * attached, forcing the SUT to respond 401. Does NOT call the wrapped
 * strategy's `apply()`; the inner reference is held only for symmetry with
 * {@link GarbageTokenMangle} and future debug visibility.
 *
 * Implements {@link AuthStrategy} so it is a drop-in replacement in the
 * strategy dispatch chain (D9, D13).
 */
export class NoAuthBypass implements AuthStrategy {
  /**
   * Wrapped strategy — held but NEVER invoked.
   *
   * Present for constructor-signature symmetry with {@link GarbageTokenMangle}
   * (both take inner as first arg). An unused private field is intentional;
   * see class-level TSDoc for rationale.
   */
  readonly #inner: AuthStrategy;

  /**
   * Wraps `inner` in a pass-through that never attaches auth.
   * @param inner - The underlying strategy; stored but never called.
   */
  constructor(inner: AuthStrategy) {
    this.#inner = inner;
  }

  /**
   * Returns `request` UNCHANGED (reference equality — no clone, no header
   * attachment, no inner invocation). The D12 alias (`AuthorizedRequest =
   * PreparedRequest`) makes the return type lawful.
   *
   * `#inner` is deliberately NOT called; the `void` expression silences
   * potential static analysis warnings about a held-but-uncalled reference,
   * without resorting to lint-disable comments.
   * @param request - The prepared (unauth'd) outgoing request to return as-is.
   * @param _context - Run context; ignored (NoAuthBypass is fully stateless).
   * @returns A promise that always resolves to `request` (the same reference).
   */
  apply(
    request: PreparedRequest,
    _context: RunContext,
  ): Promise<AuthorizedRequest> {
    // D9 — #inner is intentionally not invoked; void prevents lint noise.
    void this.#inner;
    return Promise.resolve(request);
  }
}
