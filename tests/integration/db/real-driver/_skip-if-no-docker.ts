/**
 * Shared "skip if Docker unavailable" guard for the real-driver integration
 * tests. Honored via env var so CI can opt in explicitly and local-dev
 * environments without Docker can opt out without flagging a failure.
 *
 * Two opt-outs:
 *   - `SKIP_TESTCONTAINERS=true` — user / CI explicitly disables this layer.
 *   - Docker daemon not reachable — `testcontainers` itself throws on first
 *     container start; we detect it cheaply with a runtime probe so the
 *     suite SKIPS (not fails) on a machine without Docker running.
 *
 * The probe runs once per process: `getContainerRuntimeClient()` resolves
 * iff the runtime client can be initialised; otherwise it throws.
 */

import { getContainerRuntimeClient } from "testcontainers";

let dockerAvailable: boolean | undefined;

/** Memoised probe: is Docker reachable from this process? */
export async function isDockerAvailable(): Promise<boolean> {
  if (dockerAvailable !== undefined) return dockerAvailable;
  if (process.env["SKIP_TESTCONTAINERS"] === "true") {
    dockerAvailable = false;
    return false;
  }
  try {
    await getContainerRuntimeClient();
    dockerAvailable = true;
  } catch {
    dockerAvailable = false;
  }
  return dockerAvailable;
}
