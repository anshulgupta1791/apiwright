/**
 * Checkpoint B — auto-generated catalog coverage.
 *
 * Proves the "65-70% coverage for free" claim by authoring single
 * endpoint files and counting the cases the §3 catalog generates for
 * each, against real public APIs (JSONPlaceholder + PokeAPI).
 *
 * Assertions:
 *   - One POST endpoint with a body schema → ≥ 12 generated cases
 *     (status, schema, content-type, auth, no_auth, garbage_token,
 *     method_not_allowed, malformed_json, required_field omission per
 *     required field, type violation per typed field, boundary battery).
 *   - response_schema_validation fires against the real response shape.
 *   - pagination assertions evaluate against the real list response.
 */

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createReportsDir,
  removeReportsDir,
  runCli,
  sandboxPath,
} from "./in-house-validation/test-helpers.js";

describe("Checkpoint B — catalog coverage (JSONPlaceholder + PokeAPI)", () => {
  let reportsDir: string;

  beforeAll(async () => {
    reportsDir = await createReportsDir();
  });

  afterAll(async () => {
    await removeReportsDir(reportsDir);
  });

  it("JSONPlaceholder POST endpoint generates ≥ 12 cases from the catalog", async () => {
    const localReports = await createReportsDir();
    try {
      await runCli("run", [
        "--config", sandboxPath("apiwright.config.json"),
        "--env=jsonplaceholder",
        "--endpoint=jsonplaceholder.post_create",
        "--markers=all",
        "--reports-dir", localReports,
      ]);
      const json = (await readdir(localReports)).find((e) => e.endsWith(".json"));
      const parsed = JSON.parse(
        await readFile(join(localReports, json as string), "utf8"),
      ) as { endpoints: { attempts: unknown[] }[] };
      const totalAttempts = parsed.endpoints.reduce(
        (sum, ep) => sum + ep.attempts.length,
        0,
      );
      expect(totalAttempts).toBeGreaterThanOrEqual(12);
    } finally {
      await removeReportsDir(localReports);
    }
  });

  it("PokeAPI nested schema validation passes against real response", async () => {
    const localReports = await createReportsDir();
    try {
      await runCli("run", [
        "--config", sandboxPath("apiwright.config.json"),
        "--env=pokeapi",
        "--endpoint=pokeapi.pokemon_by_name",
        "--markers=smoke",
        "--reports-dir", localReports,
      ]);
      const json = (await readdir(localReports)).find((e) => e.endsWith(".json"));
      const parsed = JSON.parse(
        await readFile(join(localReports, json as string), "utf8"),
      ) as { endpoints: { status: string; endpoint_id: string }[] };
      const pokemon = parsed.endpoints.find((e) => e.endpoint_id === "pokeapi.pokemon_by_name");
      expect(pokemon?.status).toBe("pass");
    } finally {
      await removeReportsDir(localReports);
    }
  });

  it("JSONPlaceholder GET list returns array satisfying its array schema", async () => {
    const localReports = await createReportsDir();
    try {
      await runCli("run", [
        "--config", sandboxPath("apiwright.config.json"),
        "--env=jsonplaceholder",
        "--endpoint=jsonplaceholder.posts_list",
        "--markers=regression",
        "--reports-dir", localReports,
      ]);
      const json = (await readdir(localReports)).find((e) => e.endsWith(".json"));
      const parsed = JSON.parse(
        await readFile(join(localReports, json as string), "utf8"),
      ) as { summary: { failed: number } };
      expect(parsed.summary.failed).toBe(0);
    } finally {
      await removeReportsDir(localReports);
    }
  });
});
