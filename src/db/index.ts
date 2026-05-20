/**
 * Public barrel for the `src/db` module — the SINGLE documented import
 * entry point for the §5 Database Connector Layer. Consumers (the Task #10
 * runner; later the §4 `db.*` tie-in) import EVERYTHING from here
 * (`import { … } from "src/db"`), never a deep `src/db/**` path,
 * mirroring `src/assertions/index.ts`. Re-exports the §5 *consumer*
 * contract: the connection registry + a thin env→registry factory, the
 * {@link DbConnector} interface and its shared types/errors, the four
 * expect modes, and the load-time/exec-time query templating API. For
 * consumer convenience (one import line covers a DB verification's whole
 * surface) it also re-exports the canonical {@link NormalizedResult} from
 * `src/core`. The four concrete engine connectors, the driver seams, and
 * the per-engine parameter binders are INTERNAL — constructed only via the
 * registry's default factory and intentionally NOT surfaced here. Named
 * exports only (`import/no-default-export`); a pure re-export hub with no
 * logic.
 *
 * DEFERRED — NOT done here (Task #10 / §9 Test Runner): WIRING §5 into a
 * live test run — per-RUN pool open / `disposeAll`, per-endpoint
 * extract→resolve→`connector.execute`→`evaluate`, verify-then-cleanup, and
 * surfacing each `NormalizedResult` under `db.<conn>.<query_id>` for §4
 * assertions. This barrel adds NO behavior beyond re-export + the thin
 * {@link createRegistry} factory; it modifies nothing under
 * `src/test-catalog/*`, `src/cli/*`, or any runner.
 */

// --- Connection registry (db-connection-pool-registry) ---
export {
  ConnectionPoolRegistry,
  createDefaultConnectorFactory,
} from "./pool/connection-registry.js";
export type {
  ConnectorFactory,
  ConnectionDisposeResult,
  DisposeAllOutcome,
} from "./pool/connection-registry.js";

// --- Thin env -> registry convenience factory (this task) ---
export { createRegistry } from "./registry-factory.js";

// --- Expect-mode evaluator (db-expect-mode-evaluator) ---
export {
  evaluate,
  DB_EXPECT_FAILURE_CODES,
} from "./expect/expect-evaluator.js";
export type {
  DbVerifyOutcome,
  DbExpectFailureCode,
} from "./expect/expect-evaluator.js";

// --- Query templating: load-time extract + exec-time resolve
//     (db-template-ref-extractor-and-param-binder) ---
export { extractRefs } from "./templating/ref-extractor.js";
export { resolveRefs } from "./templating/template-resolver.js";
export type {
  TemplateNamespace,
  Ref,
  NeutralQuery,
  BoundValue,
  ResolutionContext,
  RefRejectionCode,
  RefRejection,
  ExtractResult,
  ResolveResult,
} from "./templating/types.js";

// --- Generic engine param-binder dispatcher + bound shapes
//     (db-engine-param-binder) ---
export { bindForEngine } from "./templating/engine-param-binder.js";
export type {
  PgBoundQuery,
  MySqlBoundQuery,
  Neo4jBoundQuery,
  MongoBoundQuery,
  EngineBoundQuery,
  BindResult,
} from "./templating/engine-binding-types.js";

// --- Connector contract + shared §5 vocabulary
//     (db-connector-interface-and-types) ---
export type {
  DbConnector,
  DbEngine,
  ConnectionConfig,
  QueryParams,
} from "./types.js";

// --- Redaction-safe connector error taxonomy
//     (db-connector-interface-and-types) ---
export { DbConnectorError, isDbConnectorError, DB_ERROR_CODES } from "./errors.js";
export type {
  DbErrorCode,
  DbPhase,
  DbConnectorErrorInit,
} from "./errors.js";

// --- Canonical DB-result shape, re-exported for consumer convenience ---
export type { NormalizedResult } from "../core/index.js";
