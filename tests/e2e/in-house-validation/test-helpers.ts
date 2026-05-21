/**
 * Shared helpers for the in-house E2E checkpoint suite.
 *
 * Every checkpoint file (`tests/e2e/checkpoint-*.e2e.test.ts`) invokes
 * `apiwright`'s `main(argv)` programmatically because the CLI binary
 * bootstrap is broken in v1.0 (tracked in GitHub issue #24). When that
 * issue is fixed, the checkpoint files can migrate to a `spawn` of the
 * compiled binary with no other changes — `runCli` is the seam.
 *
 * Each checkpoint also self-skips when its required credentials are
 * absent (mirrors the pattern in `tests/e2e/alpaca-paper.e2e.test.ts`)
 * so a no-secrets clone still exercises every credentialless checkpoint.
 */

import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { main } from "../../../src/cli/entry.js";

/** Absolute path to this file's directory (ESM-portable replacement for __dirname). */
const HELPERS_DIR = dirname(fileURLToPath(import.meta.url));

/** Absolute path to the in-house validation sandbox. */
export const SANDBOX_DIR = HELPERS_DIR;

/**
 * Detects whether every named env var is set + non-empty.
 *
 * Used at the top of each checkpoint's `describe.skipIf(...)` so a clone
 * without credentials still produces a green E2E suite — the credentialed
 * checkpoints just skip with a clear "missing X" message.
 * @param names - Env var names to require.
 * @returns True when every name maps to a non-empty value in process.env.
 */
export function haveSecrets(...names: readonly string[]): boolean {
  return names.every((name) => {
    const v = process.env[name];
    return typeof v === "string" && v.length > 0;
  });
}

/**
 * Creates a fresh temp dir for one checkpoint's reports output.
 *
 * Returns the absolute path. The caller is responsible for cleaning it
 * up via {@link removeReportsDir} in their `afterAll`.
 * @returns Absolute path to a unique tmp directory.
 */
export async function createReportsDir(): Promise<string> {
  const dir = join(
    tmpdir(),
    `apiwright-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Recursively removes a directory; tolerates ENOENT.
 * @param dir - Absolute path to remove.
 */
export async function removeReportsDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

/**
 * Invokes the APIWright CLI programmatically with the same argv shape a
 * shell user would type. Returns when `main` resolves.
 *
 * Wires `--config` to the sandbox's apiwright.config.json so the env
 * and tests directory resolve correctly even though Node's cwd is the
 * repo root (Vitest does not chdir per test file).
 * @param subcommand - The CLI subcommand: "run" / "validate" / "docs" / "import".
 * @param args - Additional flags / positional args passed to the subcommand.
 * @param overrideArgv0 - Optional override for argv[0]/[1]; default mimics `node apiwright`.
 */
export async function runCli(
  subcommand: string,
  args: readonly string[] = [],
  overrideArgv0?: readonly [string, string],
): Promise<void> {
  const argv: string[] = [
    ...(overrideArgv0 ?? ["node", "apiwright"]),
    subcommand,
    ...args,
  ];
  await main(argv);
}

/**
 * Resolves an absolute path inside the sandbox.
 * @param parts - Path segments relative to the sandbox root.
 * @returns Absolute path.
 */
export function sandboxPath(...parts: readonly string[]): string {
  return join(SANDBOX_DIR, ...parts);
}
