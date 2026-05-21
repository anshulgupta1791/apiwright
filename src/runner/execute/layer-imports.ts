/**
 * Re-export hub for cross-layer types consumed by the executor. Centralizing
 * here keeps `endpoint-executor.ts` import block compact and makes the
 * cross-layer surface explicit (mirrors the Task 8 db `layer-imports`
 * convention).
 */

export {
  AuthStrategyRegistry,
  wrapForMarker,
} from "../../auth/index.js";

export type {
  AuthStrategy,
  NegativeAuthMarker,
} from "../../auth/index.js";

export { ConnectionPoolRegistry } from "../../db/pool/connection-registry.js";

export { SecretRegistry } from "../../env/index.js";
