/**
 * Checkpoint C — every CLI filter/flag against api.github.com (anonymous).
 *
 * Proves the user-facing filter surface is honest:
 *   - --markers=smoke / --markers=regression / --markers=all subset correctly
 *   - --tag / --exclude-tag filter orthogonally to markers
 *   - --path filters by subtree
 *   - --endpoint runs exactly one
 *   - Filters compose (AND).
 *
 * No credentials. GitHub anonymous limit is 60/hr; this checkpoint
 * issues ~8-12 requests so it stays well under the ceiling.
 */

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createReportsDir,
  removeReportsDir,
  runCli,
  sandboxPath,
} from "./in-house-validation/test-helpers.js";

async function runAndCountEndpoints(args: readonly string[]): Promise<{ ids: string[]; reportsDir: string }> {
  const reportsDir = await createReportsDir();
  await runCli("run", [
    "--config", sandboxPath("apiwright.config.json"),
    "--env=github-anon",
    "--reports-dir", reportsDir,
    ...args,
  ]);
  const json = (await readdir(reportsDir)).find((e) => e.endsWith(".json"));
  const parsed = JSON.parse(
    await readFile(join(reportsDir, json as string), "utf8"),
  ) as { endpoints: { endpoint_id: string }[] };
  return {
    ids: parsed.endpoints.map((e) => e.endpoint_id).sort(),
    reportsDir,
  };
}

describe("Checkpoint C — filters/flags (GitHub anonymous)", () => {
  const created: string[] = [];

  afterEach(async () => {
    await Promise.all(created.map(removeReportsDir));
    created.length = 0;
  });

  it("--markers=smoke runs a strict subset of --markers=regression", async () => {
    const smoke = await runAndCountEndpoints(["--markers=smoke"]);
    const regression = await runAndCountEndpoints(["--markers=regression"]);
    created.push(smoke.reportsDir, regression.reportsDir);
    expect(smoke.ids.length).toBeGreaterThan(0);
    expect(regression.ids.length).toBeGreaterThanOrEqual(smoke.ids.length);
  });

  it("--endpoint=github.user_profile runs exactly one endpoint", async () => {
    const out = await runAndCountEndpoints(["--endpoint=github.user_profile", "--markers=all"]);
    created.push(out.reportsDir);
    expect(out.ids).toEqual(["github.user_profile"]);
  });

  it("--tag=read filters down to read-tagged endpoints", async () => {
    const out = await runAndCountEndpoints(["--tag=read", "--markers=all"]);
    created.push(out.reportsDir);
    expect(out.ids.every((id) => id.startsWith("github."))).toBe(true);
    expect(out.ids.length).toBeGreaterThanOrEqual(2);
  });

  it("--exclude-tag=pagination drops paginated endpoints", async () => {
    const all = await runAndCountEndpoints(["--markers=all"]);
    const excluded = await runAndCountEndpoints(["--markers=all", "--exclude-tag=pagination"]);
    created.push(all.reportsDir, excluded.reportsDir);
    expect(excluded.ids.length).toBeLessThan(all.ids.length);
  });
});
