/**
 * Checkpoint G — db_verify against self-hosted real registries.
 *
 * Apicurio Registry (real schema registry, Postgres backend) and MLflow
 * (real model-tracking server, MySQL backend) run under
 * `docker-compose.yml`. Both are production software with documented
 * REST APIs — not mocks.
 *
 * This checkpoint requires Docker on the host. It self-skips when the
 * services aren't reachable (the compose hasn't been brought up). Bring
 * the stack up with:
 *
 *   docker compose -f tests/e2e/in-house-validation/docker/docker-compose.yml up -d --wait
 *
 * Tear it down with:
 *
 *   docker compose -f tests/e2e/in-house-validation/docker/docker-compose.yml down -v
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

/** Probes whether a TCP service answers GET / inside `timeoutMs`. */
async function isReachable(url: string, timeoutMs = 1000): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    return res.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

const APICURIO_REACHABLE = await isReachable("http://localhost:58080/apis/registry/v3/system/info");
const MLFLOW_REACHABLE = await isReachable("http://localhost:55000/health");

describe.skipIf(!APICURIO_REACHABLE)("Checkpoint G — Apicurio (Postgres db_verify)", () => {
  let reportsDir: string;

  beforeAll(async () => { reportsDir = await createReportsDir(); });
  afterAll(async () => { await removeReportsDir(reportsDir); });

  it("creates schema + verifies via Postgres SELECT + cleanup deletes the row", async () => {
    await runCli("run", [
      "--config", sandboxPath("apiwright.config.json"),
      "--env=apicurio",
      "--endpoint=apicurio.schema_create",
      "--markers=regression",
      "--reports-dir", reportsDir,
    ]);
    const json = (await readdir(reportsDir)).find((e) => e.endsWith(".json"));
    const parsed = JSON.parse(
      await readFile(join(reportsDir, json as string), "utf8"),
    ) as { endpoints: { status: string; cleanup?: { ok: boolean } }[] };
    expect(parsed.endpoints[0]?.status).toBe("pass");
    expect(parsed.endpoints[0]?.cleanup?.ok).toBe(true);
  });
});

describe.skipIf(!MLFLOW_REACHABLE)("Checkpoint G — MLflow (MySQL db_verify)", () => {
  it("creates experiment + verifies via MySQL SELECT + cleanup deletes", async () => {
    const localReports = await createReportsDir();
    try {
      await runCli("run", [
        "--config", sandboxPath("apiwright.config.json"),
        "--env=mlflow",
        "--endpoint=mlflow.experiment_create",
        "--markers=regression",
        "--reports-dir", localReports,
      ]);
      const json = (await readdir(localReports)).find((e) => e.endsWith(".json"));
      const parsed = JSON.parse(
        await readFile(join(localReports, json as string), "utf8"),
      ) as { endpoints: { status: string }[] };
      expect(parsed.endpoints[0]?.status).toBe("pass");
    } finally {
      await removeReportsDir(localReports);
    }
  });
});

describe("Checkpoint G — services reachability check", () => {
  it("reports whether the docker compose stack is up", () => {
    if (!APICURIO_REACHABLE) {
      // eslint-disable-next-line no-console
      console.log("  ↪ Apicurio not reachable at localhost:58080 — `docker compose up -d` to bring it up");
    }
    if (!MLFLOW_REACHABLE) {
      // eslint-disable-next-line no-console
      console.log("  ↪ MLflow not reachable at localhost:55000 — `docker compose up -d` to bring it up");
    }
    expect(true).toBe(true);
  });
});
