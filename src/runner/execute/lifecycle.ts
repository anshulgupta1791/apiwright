/**
 * Run-lifecycle owner — instantiates both §5 + §6 registries at run start,
 * shares them across the run, and closes them exactly once at run end.
 *
 * Discharges Task #10 obligations:
 *   #6  — §5 ConnectionPoolRegistry run-lifecycle.
 *   #11 — §6 AuthStrategyRegistry run-lifecycle.
 *
 * Spec lines 664–666 (lifecycle hooks): "Per-endpoint setup/teardown is
 * supported in v1.0 only at the connection level (DB connections opened,
 * auth tokens fetched once at run start)."
 */

import { AuthStrategyRegistry, createAuthRegistry } from "../../auth/index.js";
import { ConnectionPoolRegistry, createRegistry as createDbRegistry } from "../../db/index.js";
import type { ResolvedEnvironment, SecretRegistry } from "../../env/index.js";

/** Opened registry pair returned by {@link openLifecycle}. */
export interface RunLifecycle {
  /** §5 DB connector registry; lazily acquires connectors. */
  readonly connRegistry: ConnectionPoolRegistry;
  /** §6 Auth strategy registry; eager static-token secret registration. */
  readonly authRegistry: AuthStrategyRegistry;
}

/**
 * Opens both registries off the resolved environment + secret registry.
 * Does not perform any network or DB I/O — connectors connect lazily on
 * first `acquire`; token_endpoint strategies fetch lazily on first apply.
 * @param env - The resolved environment (Task #2 ResolvedEnvironment).
 * @param secrets - The run-scoped SecretRegistry; passed to the auth
 *   registry so static tokens register eagerly (D8).
 * @returns The opened {@link RunLifecycle} carrying both registries.
 */
export function openLifecycle(
  env: ResolvedEnvironment,
  secrets: SecretRegistry,
): RunLifecycle {
  const connRegistry = createDbRegistry(env);
  const authRegistry = createAuthRegistry(env, secrets);
  return { connRegistry, authRegistry };
}

/**
 * Closes both registries. Order: auth first (no I/O), then DB
 * (`disposeAll` disconnects every acquired connector). Idempotent — both
 * close methods are designed to tolerate repeated calls.
 *
 * Never throws — close outcomes are aggregated into the per-registry
 * `CloseAllOutcome` / `DisposeAllOutcome` which the caller may capture.
 * @param lifecycle - The opened lifecycle to tear down.
 * @returns A promise that resolves once both registries are closed.
 */
export async function closeLifecycle(lifecycle: RunLifecycle): Promise<void> {
  lifecycle.authRegistry.closeAll();
  await lifecycle.connRegistry.disposeAll();
}
