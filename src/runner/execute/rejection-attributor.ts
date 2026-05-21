/**
 * Process-level unhandled-rejection attributor for the §9 runner.
 *
 * The crash-safe executor wrapper (`crash-safe-executor.ts`) catches every
 * value the executor throws on its main promise chain. A handful of
 * pathological code paths — most notably, callbacks that schedule
 * rejections off the main `await` chain — emit `unhandledRejection` on
 * the process instead of bubbling to that wrapper.
 *
 * This module:
 *   1. Wraps each endpoint's safe-execute call in an
 *      {@link AsyncLocalStorage} context tagged with the endpoint id.
 *   2. Installs a single `process.on("unhandledRejection", ...)` listener
 *      at run start; removes it at run end. No global state leaks across
 *      runs (verified by `tests/unit/runner/execute/rejection-attributor.test.ts`).
 *   3. When the listener fires AND an endpoint context is active, the
 *      rejection is recorded and routed to the supplied `onAttribute`
 *      callback so the runner can replace that endpoint's result with a
 *      crash result. The original (unattributed) rejection is also
 *      reported through `onUnattributed` so genuinely orphan rejections
 *      do not vanish silently.
 *
 * Design constraints:
 *   - Idempotent: `install` is a no-op if already installed on the same
 *     process; the returned uninstaller calls off exactly once.
 *   - Co-existence: other listeners on `unhandledRejection` are preserved;
 *     this module only adds one and removes only its own listener.
 *   - Zero floor time: cost is one Map lookup per rejection event (rare).
 */

import { AsyncLocalStorage } from "node:async_hooks";

/** Function called when a rejection is attributed to an endpoint. */
export type AttributeFn = (endpointId: string, reason: unknown) => void;

/** Function called when a rejection happens with no active endpoint context. */
export type UnattributedFn = (reason: unknown) => void;

/** Returned by {@link installRejectionAttributor} to dispose the handler. */
export type UninstallFn = () => void;

/** Configuration for {@link installRejectionAttributor}. */
export interface RejectionAttributorOptions {
  /** Called when a rejection occurs inside an endpoint context. */
  readonly onAttribute: AttributeFn;
  /** Called when a rejection occurs with no active endpoint context. */
  readonly onUnattributed: UnattributedFn;
}

/** Module-local storage; one shared instance keeps cross-module attribution cheap. */
const ENDPOINT_CONTEXT = new AsyncLocalStorage<string>();

/**
 * Runs `fn` inside an {@link AsyncLocalStorage} context tagged with
 * `endpointId`. Used by the runner to wrap each `executeEndpointSafely`
 * call so any unhandled rejection emitted during that call is attributed
 * back to this endpoint.
 * @param endpointId - The endpoint id owning this context.
 * @param fn - The async function to execute under the context.
 * @returns Whatever `fn` returns.
 */
export function runInEndpointContext<T>(
  endpointId: string,
  fn: () => Promise<T>,
): Promise<T> {
  return ENDPOINT_CONTEXT.run(endpointId, fn);
}

/**
 * Returns the currently-active endpoint id, or `undefined` outside any
 * runner context. Exported for testing; the attributor uses this
 * internally on every rejection.
 * @returns The current endpoint id, or undefined.
 */
export function currentEndpointId(): string | undefined {
  return ENDPOINT_CONTEXT.getStore();
}

/**
 * Installs a process-level `unhandledRejection` listener that routes each
 * rejection to the supplied callbacks. Returns an uninstaller that must
 * be called at run end (recommended via `try { ... } finally { off(); }`).
 *
 * The uninstaller removes exactly the listener this call added; other
 * `unhandledRejection` listeners installed by the host application are
 * preserved.
 * @param opts - Attribution callbacks.
 * @returns An uninstaller. Call exactly once at run end.
 */
export function installRejectionAttributor(
  opts: RejectionAttributorOptions,
): UninstallFn {
  const listener = (reason: unknown): void => {
    const endpointId = ENDPOINT_CONTEXT.getStore();
    if (endpointId !== undefined) {
      opts.onAttribute(endpointId, reason);
      return;
    }
    opts.onUnattributed(reason);
  };
  process.on("unhandledRejection", listener);
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    process.off("unhandledRejection", listener);
  };
}
