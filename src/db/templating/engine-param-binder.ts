/**
 * The single exhaustive engine dispatcher for the db-engine-param-binder.
 * Pure, deterministic, total, NEVER throws. Selects the per-engine binder by
 * {@link DbEngine} and wraps its result in the tagged {@link EngineBoundQuery}.
 *
 * The frozen total `Readonly<Record<DbEngine, …>>` registry mirrors the §4
 * `OPERATOR_REGISTRY` idiom: a missing engine is a COMPILE error, and an
 * out-of-vocabulary engine is structurally impossible. There is NO runtime
 * `default`/`never` arm — exhaustiveness is compile-enforced.
 */

import type { DbEngine } from "../types.js";

import type { BindResult } from "./engine-binding-types.js";
import { bindMongo } from "./mongo-binder.js";
import { bindMySql } from "./mysql-binder.js";
import { bindNeo4j } from "./neo4j-binder.js";
import { bindPg } from "./pg-binder.js";
import type { NeutralQuery, BoundValue } from "./types.js";

// ---------------------------------------------------------------------------
// Per-engine binder registry (§4 OPERATOR_REGISTRY idiom)
// ---------------------------------------------------------------------------

/** Per-engine binder function signature. */
type EngineBinderFn = (
  neutral: NeutralQuery,
  values: readonly BoundValue[],
) => BindResult;

/**
 * Frozen total registry mapping each {@link DbEngine} to its per-engine binder
 * function. The `Readonly<Record<DbEngine, EngineBinderFn>>` type guarantees
 * compile-time exhaustiveness (a missing or extra engine key is a TS error).
 * No runtime `default` arm needed or present.
 */
const BINDER_REGISTRY: Readonly<Record<DbEngine, EngineBinderFn>> =
  Object.freeze({
    postgres: bindPg,
    mysql: bindMySql,
    neo4j: bindNeo4j,
    mongodb: bindMongo,
  });

// ---------------------------------------------------------------------------
// bindForEngine — the dispatcher
// ---------------------------------------------------------------------------

/**
 * The single exhaustive engine dispatcher.
 *
 * Selects the per-engine binder by {@link DbEngine} using the frozen total
 * registry, invokes it, and wraps the result in the tagged
 * {@link EngineBoundQuery}. Compile-enforced exhaustiveness — no runtime
 * `default` arm.
 * @param engine - The target {@link DbEngine}.
 * @param neutral - The upstream {@link NeutralQuery}.
 * @param values - The upstream ordered {@link BoundValue}s.
 * @returns A {@link BindResult} whose success arm is the tagged
 *   {@link EngineBoundQuery} for `engine`.
 */
export function bindForEngine(
  engine: DbEngine,
  neutral: NeutralQuery,
  values: readonly BoundValue[],
): BindResult {
  const binder = BINDER_REGISTRY[engine];
  return binder(neutral, values);
}
