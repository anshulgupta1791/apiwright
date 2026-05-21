/**
 * Checkpoint F — db_verify against hosted real databases.
 *
 * Each subsection self-skips when its credential is absent. With all
 * three credentials present, this proves APIWright's mongodb / neo4j /
 * mysql connectors work against real hosted infrastructure (not a Docker
 * mock) — the gold-standard credibility test for the DB connector layer.
 */

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createReportsDir,
  haveSecrets,
  removeReportsDir,
  runCli,
  sandboxPath,
} from "./in-house-validation/test-helpers.js";

const MONGO_PRESENT = haveSecrets("APIWRIGHT_E2E_MONGO_URI", "APIWRIGHT_E2E_MONGO_DATA_URL", "APIWRIGHT_E2E_MONGO_DATA_KEY");
const NEO4J_PRESENT = haveSecrets(
  "APIWRIGHT_E2E_NEO4J_URI",
  "APIWRIGHT_E2E_NEO4J_HTTP_URL",
  "APIWRIGHT_E2E_NEO4J_USER",
  "APIWRIGHT_E2E_NEO4J_PASSWORD",
  "APIWRIGHT_E2E_NEO4J_BASIC",
);
const MYSQL_PRESENT = haveSecrets("APIWRIGHT_E2E_MYSQL_URI", "APIWRIGHT_E2E_MYSQL_BASIC");

describe.skipIf(!MONGO_PRESENT)("Checkpoint F — MongoDB Atlas", () => {
  let reportsDir: string;

  beforeAll(async () => { reportsDir = await createReportsDir(); });
  afterAll(async () => { await removeReportsDir(reportsDir); });

  it("inserts document via Atlas Data API + verifies via Mongo driver", async () => {
    await runCli("run", [
      "--config", sandboxPath("apiwright.config.json"),
      "--env=mongo-atlas",
      "--endpoint=mongo.document_insert",
      "--markers=regression",
      "--reports-dir", reportsDir,
    ]);
    const json = (await readdir(reportsDir)).find((e) => e.endsWith(".json"));
    const parsed = JSON.parse(
      await readFile(join(reportsDir, json as string), "utf8"),
    ) as { endpoints: { status: string }[] };
    expect(parsed.endpoints[0]?.status).toBe("pass");
  });
});

describe.skipIf(!NEO4J_PRESENT)("Checkpoint F — Neo4j AuraDB", () => {
  it("creates node via Query API + verifies via bolt driver", async () => {
    const localReports = await createReportsDir();
    try {
      await runCli("run", [
        "--config", sandboxPath("apiwright.config.json"),
        "--env=neo4j-aura",
        "--endpoint=neo4j.node_create",
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

describe.skipIf(!MYSQL_PRESENT)("Checkpoint F — PlanetScale MySQL", () => {
  it("inserts row via query API + verifies via MySQL driver", async () => {
    const localReports = await createReportsDir();
    try {
      await runCli("run", [
        "--config", sandboxPath("apiwright.config.json"),
        "--env=planetscale",
        "--endpoint=mysql.row_insert",
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

describe("Checkpoint F — credentials present check", () => {
  it("reports which hosted-DB credentials are available", () => {
    if (!MONGO_PRESENT) {
      // eslint-disable-next-line no-console
      console.log("  ↪ skipped Mongo assertions; set APIWRIGHT_E2E_MONGO_URI + DATA_URL + DATA_KEY");
    }
    if (!NEO4J_PRESENT) {
      // eslint-disable-next-line no-console
      console.log("  ↪ skipped Neo4j assertions; set APIWRIGHT_E2E_NEO4J_* (5 vars)");
    }
    if (!MYSQL_PRESENT) {
      // eslint-disable-next-line no-console
      console.log("  ↪ skipped MySQL assertions; set APIWRIGHT_E2E_MYSQL_URI + BASIC");
    }
    expect(true).toBe(true);
  });
});
