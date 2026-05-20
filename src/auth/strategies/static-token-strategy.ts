/**
 * The 'static_token' AuthStrategy implementation (Task #9, §6, Layer B).
 *
 * Attaches a configured bearer token to an outgoing request by substituting
 * "${token}" in the 'headerValue' template (D7) and replacing any existing
 * case-variant of the target header (RFC 7230 case-insensitive; "auth wins"
 * AC#4). Registers the token with SecretRegistry at CONSTRUCTION time, never
 * at apply() time (D8). apply() returns a NEW AuthorizedRequest — the input
 * PreparedRequest and its headers are never mutated (D11).
 *
 * INTERNAL: this class is NOT re-exported from 'src/auth/index.ts' (D5/D13).
 * It is reachable only via the deep specifier
 * 'src/auth/strategies/static-token-strategy.js', consumed by the
 * auth-strategy-registry sibling task.
 *
 * apply() cannot fail at runtime (D19): all validation is done at config parse
 * time by config-parser, and the substitution/header logic has no failure modes
 * for well-typed inputs. The method is therefore synchronous internally;
 * Promise.resolve() is used to satisfy the AuthStrategy interface signature
 * without triggering the require-await lint rule.
 */

import { SecretRegistry } from "../../env/secrets.js";
import type { ValidatedStaticTokenSpec } from "../config-parser.js";
import type {
  AuthStrategy,
  AuthorizedRequest,
  PreparedRequest,
  RunContext,
} from "../types.js";

import { attachAuthHeader } from "./header-attacher.js";

/**
 * The 'static_token' authentication strategy.
 *
 * Attaches a fixed bearer token to every outgoing request by:
 * 1. Substituting all occurrences of "${token}" in 'spec.headerValue' with
 *    the literal token string (function-form replacement prevents
 *    dollar-sign interpretation — see design §7).
 * 2. Removing ALL existing case-variants of 'spec.header' from the request
 *    headers (RFC 7230; "auth wins" semantics per AC#4).
 * 3. Adding 'spec.header' with the resolved value, returning a new
 *    AuthorizedRequest (D11 — the input is never mutated).
 *
 * SecretRegistry.add() is called exactly once, in the constructor (D8).
 * apply() never calls it.
 *
 * INTERNAL: not exported from the auth barrel (D5/D13).
 */
export class StaticTokenStrategy implements AuthStrategy {
  readonly #spec: ValidatedStaticTokenSpec;

  /**
   * Constructs a StaticTokenStrategy and registers the token with the
   * SecretRegistry immediately (D8).
   * @param spec - The validated static_token config spec; all fields readonly.
   * @param secrets - The run-scoped secret registry; token added at ctor time
   *   so the reporter can redact it from logs even before any apply() call.
   */
  constructor(spec: ValidatedStaticTokenSpec, secrets: SecretRegistry) {
    this.#spec = spec;
    secrets.add(spec.token);
  }

  /**
   * Applies the static token to the request, returning a NEW AuthorizedRequest.
   *
   * Step 1: Resolve the header value by replacing all "${token}" occurrences
   * with the literal token (function-form replacement, design §7).
   *
   * Step 2: Build a new headers map that excludes any case-variant of
   * 'spec.header' (RFC 7230 case-insensitive — "auth wins", AC#4).
   *
   * Step 3: Return a new top-level object via spread (D11 non-mutation).
   *
   * Cannot fail at runtime (D19): all inputs have been validated by the
   * config-parser. Promise.resolve() is used in place of async/await to
   * satisfy the AuthStrategy interface without triggering require-await.
   * @param request - The prepared (unauth'd) outgoing HTTP request; never mutated.
   * @param _context - The run-scoped context; not read by this strategy (design §9.l).
   * @returns A promise resolving to a new AuthorizedRequest with the auth header attached.
   */
  apply(
    request: PreparedRequest,
    _context: RunContext,
  ): Promise<AuthorizedRequest> {
    // Delegate to the shared header-attach helper (header-attacher.ts).
    // Steps: ${token} substitution (function-form, D7), case-insensitive
    // collision removal (RFC 7230; "auth wins", AC#4), new object (D11).
    const authorized = attachAuthHeader(
      request,
      this.#spec.header,
      this.#spec.headerValue,
      this.#spec.token,
    );
    return Promise.resolve(authorized);
  }
}
