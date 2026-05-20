/**
 * Run-scoped AuthStrategyRegistry: name-keyed, single-instance-per-name
 * dispatch over the two v1.0 strategy kinds (static_token, token_endpoint).
 *
 * Mirrors Task 8's ConnectionPoolRegistry pattern from src/db/pool/connection-registry.ts:
 * same exhaustive dispatch with a never-default, same aggregated no-throw closeAll, same
 * per-entry result shape, same insertion-order close ordering.
 *
 * Locked decisions honored here:
 * D5  — run-scoped; SINGLE-FLIGHT is INSIDE TokenEndpointStrategy, NOT here.
 * D13 — strategies are INTERNAL; acquire() is the sole public access path; NO register().
 * D19 — fail-fast aggregating config validation at construction; ZERO network at construct.
 */

import type { SecretRegistry } from "../env/secrets.js";
import type { AuthStrategyConfig } from "../env/types.js";

import { parseAuthStrategyConfig, type ValidatedStrategySpec } from "./config-parser.js";
import {
  AUTH_ERROR_CODES,
  type AuthErrorCode,
  AuthStrategyError,
  isAuthStrategyError,
} from "./errors.js";
import { createDefaultHttpFetchSeam, type HttpFetchSeam } from "./http-fetch-seam.js";
import { StaticTokenStrategy } from "./strategies/static-token-strategy.js";
import { TokenEndpointStrategy } from "./strategies/token-endpoint-strategy.js";
import type { AuthStrategy } from "./types.js";

// ---------------------------------------------------------------------------
// Public outcome interfaces (shape parity with Task 8's DisposeAllOutcome)
// ---------------------------------------------------------------------------

/**
 * A single strategy's close outcome inside {@link CloseAllOutcome}.
 */
export interface StrategyCloseResult {
  /** The strategy name (the auth_strategies map key). */
  readonly name: string;
  /**
   * True iff the strategy's close() returned without throwing (also true
   * when the strategy has no close() method).
   */
  readonly ok: boolean;
  /** Close failure, present iff ok === false. NEVER a raw error. */
  readonly error?: AuthStrategyError;
}

/**
 * Aggregated, no-throw outcome of {@link AuthStrategyRegistry.closeAll}.
 * Shape parity with Task 8's DisposeAllOutcome so Task 10 can log both
 * registries with one idiom.
 */
export interface CloseAllOutcome {
  /** True iff every attempted close succeeded (true when none attempted). */
  readonly ok: boolean;
  /** One entry per cached strategy, in acquisition (insertion) order. */
  readonly results: readonly StrategyCloseResult[];
}

// ---------------------------------------------------------------------------
// Named constant for aggregated-error header (no magic strings)
// ---------------------------------------------------------------------------

/** Header literal for the aggregated config-validation error message (design §8). */
const AGGREGATED_ERROR_HEADER = "Invalid auth_strategies configuration:";

// ---------------------------------------------------------------------------
// Registry class
// ---------------------------------------------------------------------------

/**
 * Run-scoped, per-strategy-NAME auth strategy registry.
 *
 * Given the resolved auth_strategies map (from ResolvedEnvironment), acquire()
 * lazily constructs and caches exactly ONE AuthStrategy per NAME. Later acquires
 * of the same name return the SAME instance (D5 — single-flight is INSIDE
 * TokenEndpointStrategy, not here; JS single-thread prevents cache races).
 *
 * Construction aggregates ALL config validation failures into ONE throw (D19).
 * ZERO network I/O at construction: strategies are constructed lazily in acquire().
 *
 * Mirrors Task 8's ConnectionPoolRegistry pattern from src/db/pool/connection-registry.ts.
 * DEFERRED to Task 10: wiring this registry into a live run.
 */
export class AuthStrategyRegistry {
  /** Validated specs map; frozen at construction (D19). */
  readonly #specs: ReadonlyMap<string, ValidatedStrategySpec>;
  /** DI'd secret registry; forwarded to strategy constructors. */
  readonly #secrets: SecretRegistry;
  /** DI'd or default HTTP fetch seam; forwarded ONLY to TokenEndpointStrategy. */
  readonly #fetchSeam: HttpFetchSeam;
  /**
   * Lazily-populated strategy cache. Map preserves insertion order for
   * deterministic close ordering in closeAll().
   */
  readonly #cache: Map<string, AuthStrategy>;

  /**
   * Constructs a new registry backed by the given auth strategies config.
   *
   * Validates EVERY entry in authStrategies (D19: no short-circuit). If ANY
   * entry is invalid, a single AuthStrategyError is thrown listing all offenders
   * in env-iteration order. ZERO network I/O occurs here.
   * @param authStrategies - The resolved auth_strategies map. Pass {} for an
   *   empty registry (every acquire throws AUTH_STRATEGY_UNKNOWN). Validated in
   *   full — all errors aggregated before throwing.
   * @param secrets - The run-scoped secret registry. Forwarded to strategy
   *   constructors at acquire() time; never called by the registry itself.
   * @param deps - Optional dependency injection bag.
   * @param deps.fetchSeam - Optional HTTP fetch seam replacing the default
   *   (useful in tests — counting fakes, etc). When absent, the registry
   *   wires the real default fetch seam from createDefaultHttpFetchSeam().
   * @throws {AuthStrategyError} code AUTH_CONFIG_INVALID when one or more
   *   entries fail validation; message lists all offenders in insertion order.
   */
  constructor(
    authStrategies: Readonly<Record<string, AuthStrategyConfig>>,
    secrets: SecretRegistry,
    deps?: { readonly fetchSeam?: HttpFetchSeam },
  ) {
    const specs = new Map<string, ValidatedStrategySpec>();
    const errorMessages: string[] = [];
    const errorCodes: AuthErrorCode[] = [];

    // D19: validate EVERY entry; aggregate failures; no short-circuit.
    // Object.entries iterates own enumerable string keys in insertion order (ES2015+).
    for (const [name, raw] of Object.entries(authStrategies)) {
      const result = parseAuthStrategyConfig(name, raw);
      if (isAuthStrategyError(result)) {
        errorMessages.push(`  - '${name}': ${result.message}`);
        errorCodes.push(result.code);
      } else {
        specs.set(name, result);
      }
    }

    if (errorMessages.length > 0) {
      // When a single strategy fails, propagate its granular code so callers
      // can distinguish AUTH_HEADER_TEMPLATE_INVALID etc. from generic config
      // errors. When multiple fail, aggregate as AUTH_CONFIG_INVALID.
      const code = errorMessages.length === 1
        ? (errorCodes[0] ?? AUTH_ERROR_CODES.AUTH_CONFIG_INVALID)
        : AUTH_ERROR_CODES.AUTH_CONFIG_INVALID;
      throw new AuthStrategyError({
        code,
        phase: "config",
        message: `${AGGREGATED_ERROR_HEADER}\n${errorMessages.join("\n")}`,
      });
    }

    this.#specs = specs;
    this.#secrets = secrets;
    this.#fetchSeam = deps?.fetchSeam ?? createDefaultHttpFetchSeam();
    this.#cache = new Map();

    // D8: register every static_token's token with SecretRegistry at
    // registry-construction time so the reporter can redact it from logs
    // before any acquire(). token_endpoint strategies register their token
    // at fetch-time (their token is not known until the endpoint responds).
    // Strategies themselves remain lazy-constructed in acquire() so an
    // unused registry has an empty closeAll() result set.
    for (const spec of specs.values()) {
      if (spec.kind === "static_token") {
        secrets.add(spec.token);
      }
    }
  }

  /**
   * Returns the named strategy, constructing it on first access (D5).
   *
   * Cache hit: same instance returned on every subsequent call (D5 — one
   * instance per name per run; JS single-thread means no race between
   * cache.get and cache.set).
   *
   * Unknown name: throws AuthStrategyError code AUTH_STRATEGY_UNKNOWN with the
   * missing name and sorted list of known names (design §9).
   * @param name - A key of the auth_strategies map supplied to the constructor.
   * @returns The AuthStrategy for name; never undefined.
   * @throws {AuthStrategyError} code AUTH_STRATEGY_UNKNOWN, phase "config"
   *   when name is not in the configured strategies.
   */
  acquire(name: string): AuthStrategy {
    // (1) Cache hit — same instance per name (D5).
    const cached = this.#cache.get(name);
    if (cached !== undefined) return cached;

    // (2) Unknown name — structured error; known names sorted alphabetically (§9).
    const spec = this.#specs.get(name);
    if (spec === undefined) {
      const knownNames = [...this.#specs.keys()].sort();
      throw new AuthStrategyError({
        code: AUTH_ERROR_CODES.AUTH_STRATEGY_UNKNOWN,
        phase: "config",
        message:
          `Unknown auth strategy '${name}'.` +
          ` Known: [${knownNames.map((n) => `'${n}'`).join(", ")}]`,
      });
    }

    // (3) Kind dispatch — construct, cache, return.
    const strategy = this.#instantiate(spec);
    this.#cache.set(name, strategy);
    return strategy;
  }

  /**
   * Dispatches the validated spec to the correct concrete strategy constructor.
   * Exhaustive over the two-arm ValidatedStrategySpec discriminated union;
   * the never-default mirrors Task 8's engine-dispatch pattern.
   * @param spec - The validated spec for one auth strategy entry.
   * @returns A freshly-constructed AuthStrategy for the spec's kind.
   */
  #instantiate(spec: ValidatedStrategySpec): AuthStrategy {
    switch (spec.kind) {
      case "static_token":
        return new StaticTokenStrategy(spec, this.#secrets);
      case "token_endpoint":
        return new TokenEndpointStrategy(spec, this.#secrets, this.#fetchSeam);
      /* istanbul ignore next — provably unreachable: ValidatedStrategySpec is a
         closed 2-arm discriminated union; env schema validation upstream rejects
         any non-union kind before this switch is reached. */
      default: {
        const _exhaustive: never = spec;
        return _exhaustive;
      }
    }
  }

  /**
   * Best-effort close of EVERY strategy that was acquired during this run.
   * NEVER throws and NEVER stops early — a failing close() is recorded and
   * remaining strategies still close. Clears the cache. Idempotent: a second
   * call with no intervening acquire returns { ok: true, results: [] }.
   *
   * Strategies without a close() method yield { ok: true } (Option X, design §10).
   * Non-AuthStrategyError throws are wrapped as AUTH_CONFIG_INVALID (design §11 l).
   * @returns The aggregated {@link CloseAllOutcome}.
   */
  closeAll(): CloseAllOutcome {
    // Capture + clear BEFORE iteration (re-entrant calls see empty cache).
    const cached = [...this.#cache.entries()];
    this.#cache.clear();

    if (cached.length === 0) return { ok: true, results: [] };

    const results: StrategyCloseResult[] = cached.map(([name, strategy]) => {
      // Option X: close is OPTIONAL on AuthStrategy (design §10).
      if (strategy.close === undefined) return { name, ok: true };
      try {
        strategy.close();
        return { name, ok: true };
      } catch (err: unknown) {
        if (isAuthStrategyError(err)) return { name, ok: false, error: err };
        return {
          name,
          ok: false,
          error: new AuthStrategyError({
            code: AUTH_ERROR_CODES.AUTH_CONFIG_INVALID,
            phase: "config",
            message: `Failed to close auth strategy '${name}'.`,
            cause: err,
          }),
        };
      }
    });

    return { ok: results.every((r) => r.ok), results };
  }
}
