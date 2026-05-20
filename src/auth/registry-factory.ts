/**
 * Thin convenience factory: builds an {@link AuthStrategyRegistry} from an
 * already-resolved {@link ResolvedEnvironment} by plucking env.auth_strategies
 * (defaulting to {} when absent) and forwarding it (with optional injected
 * deps) to the AuthStrategyRegistry constructor.
 *
 * Performs NO env loading, NO YAML reading, NO template resolution, NO I/O,
 * and NO run lifecycle. All real behavior lives in AuthStrategyRegistry.
 * Mirrors Task 8's src/db/registry-factory.ts pattern.
 *
 * Design refs: auth-strategy-registry.md §7.
 */

import type { SecretRegistry } from "../env/secrets.js";
import type { ResolvedEnvironment } from "../env/types.js";

import type { HttpFetchSeam } from "./http-fetch-seam.js";
import { AuthStrategyRegistry } from "./strategy-registry.js";

/**
 * Builds an {@link AuthStrategyRegistry} from a resolved environment.
 *
 * Plucks env.auth_strategies (defaulting to {} when the environment declares
 * no auth_strategies block) and forwards it with the given secrets and optional
 * deps to the AuthStrategyRegistry constructor.
 *
 * The caller (Task 10) owns the registry lifecycle: open at run start,
 * closeAll() at run end. This factory provides only the construction primitive.
 * @param env - The already-loaded, fully-resolved environment. Only
 *   env.auth_strategies is read; all other fields are ignored.
 * @param secrets - The run-scoped secret registry forwarded to every strategy
 *   constructor at acquire() time.
 * @param deps - Optional dependency injection bag.
 * @param deps.fetchSeam - Optional HTTP fetch seam replacing the default
 *   (useful in tests — counting fakes, etc). When absent, the registry
 *   wires the real default fetch seam from createDefaultHttpFetchSeam().
 * @returns An AuthStrategyRegistry keyed by the environment's auth strategy
 *   names. An environment with no auth_strategies block yields a registry where
 *   every acquire() throws AUTH_STRATEGY_UNKNOWN.
 * @throws {AuthStrategyError} code AUTH_CONFIG_INVALID when any auth_strategies
 *   entry fails validation (propagated from AuthStrategyRegistry constructor).
 */
export function createAuthRegistry(
  env: ResolvedEnvironment,
  secrets: SecretRegistry,
  deps?: { readonly fetchSeam?: HttpFetchSeam },
): AuthStrategyRegistry {
  return new AuthStrategyRegistry(env.auth_strategies ?? {}, secrets, deps);
}
