/**
 * Thin, pure convenience factory: builds a {@link ConnectionPoolRegistry}
 * from an already-resolved {@link ResolvedEnvironment} by plucking
 * `env.databases` and forwarding it (with the optional injected
 * {@link ConnectorFactory}) to the APPROVED `ConnectionPoolRegistry`
 * constructor. It performs NO env loading, NO YAML reading, NO `${...}`
 * resolution, NO I/O, and NO run lifecycle. It introduces NO new connection
 * logic, NO new error code, and NO new behavior beyond this one-line
 * adaptation; all real behavior lives in the APPROVED registry.
 */

import type { ResolvedEnvironment } from "../env/types.js";

import {
  ConnectionPoolRegistry,
  type ConnectorFactory,
} from "./pool/connection-registry.js";

/**
 * Thin, pure convenience factory: builds a {@link ConnectionPoolRegistry}
 * from an already-resolved {@link ResolvedEnvironment}. It does ONE thing —
 * pluck `env.databases` (the resolved `Record<string, DatabaseConfig>`
 * slice, possibly `undefined` when the environment declares no `databases:`
 * block) and forward it (with the optional injected
 * {@link ConnectorFactory}) to the APPROVED `ConnectionPoolRegistry`
 * constructor. It performs NO env loading, NO YAML reading, NO `${...}`
 * resolution, NO I/O, and NO run lifecycle (open/`disposeAll` is the
 * caller's — Task #10's — orchestration). It introduces NO new connection
 * logic, NO new error code, and NO new behavior beyond this one-line
 * adaptation; all real behavior lives in the APPROVED registry.
 *
 * `factory` defaults (inside the registry) to
 * {@link createDefaultConnectorFactory} (real connectors over their own
 * default driver seams); a unit test injects a fake factory of fake
 * connectors so the registry can be constructed and exercised WITHOUT
 * connecting or loading any real driver.
 * @param env - The already-loaded, fully-resolved environment (Task 2/§7
 *   loaded it; templates + secrets already expanded). Only `env.databases`
 *   is read; all other fields are ignored.
 * @param factory - Optional connector factory injection seam (advanced /
 *   test use); omitted ⇒ the registry wires the real default factory.
 * @returns A `ConnectionPoolRegistry` keyed by the environment's database
 *   connection names. An environment with no `databases:` block yields a
 *   registry where every `acquire` fails the unknown-name path (no throw).
 */
export function createRegistry(
  env: ResolvedEnvironment,
  factory?: ConnectorFactory,
): ConnectionPoolRegistry {
  return new ConnectionPoolRegistry(env.databases, factory);
}
