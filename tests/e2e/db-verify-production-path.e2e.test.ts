import pg from "pg";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { CanonicalEndpoint } from "../../src/core/canonical-model.js";
import { createRegistry } from "../../src/db/index.js";
import type { ResolvedEnvironment } from "../../src/env/index.js";
import { runDbVerifications, runCleanup } from "../../src/runner/execute/db-verify-runner.js";

/**
 * Production-path db_verify E2E (issue #27 verification).
 *
 * This exercises the EXACT production function `runDbVerifications` (the
 * one `src/runner/execute/endpoint-executor.ts` calls) against a real
 * Postgres — NOT the connector in isolation. It is the authoritative
 * answer to "is the db_verify connector path actually broken, or is the
 * old db-drivers.e2e.test.ts harness just calling execute() wrong?".
 *
 * The production path passes the RAW `${...}` query string + encoded
 * params to `connector.execute()`, which extracts refs and binds
 * internally. The old harness pre-bound via `bindForEngine` and passed
 * the already-bound query, double-binding it. This test proves the
 * production path works end-to-end.
 *
 * Requires APIWRIGHT_E2E_PG_URL (the local Docker Postgres from
 * tests/e2e/in-house-validation/docker/docker-compose.yml). Self-skips
 * when absent.
 */

const PG_URL = process.env["APIWRIGHT_E2E_PG_URL"];
const NO_PG = !PG_URL;
const CONN = "primary_postgres";
const TABLE = "apiwright_e2e_dbverify";

/**
 * Minimal env wiring the connection registry to the Docker Postgres via
 * DISCRETE fields parsed from the connection URL. (Discrete fields are the
 * connector's supported config shape; `url`-string configs are tracked
 * separately in their own issue.)
 */
function pgEnv(): ResolvedEnvironment {
  const u = new URL(PG_URL as string);
  return {
    name: "db-verify-e2e",
    prod: false,
    base_url: "http://localhost",
    databases: {
      [CONN]: {
        type: "postgres",
        host: u.hostname,
        port: Number(u.port || "5432"),
        database: u.pathname.replace(/^\//, ""),
        user: decodeURIComponent(u.username),
        password: decodeURIComponent(u.password),
      },
    },
  };
}

describe.skipIf(NO_PG)("db_verify production path (runDbVerifications) vs real Postgres", () => {
  let seeder: pg.Client;

  beforeAll(async () => {
    seeder = new pg.Client({ connectionString: PG_URL });
    await seeder.connect();
    await seeder.query(`CREATE TABLE IF NOT EXISTS ${TABLE} (id text PRIMARY KEY, kind text)`);
    await seeder.query(`DELETE FROM ${TABLE}`);
    await seeder.query(`INSERT INTO ${TABLE} (id, kind) VALUES ($1, $2)`, [
      "apiwright-e2e-row-1",
      "regression",
    ]);
  }, 30_000);

  afterAll(async () => {
    await seeder.query(`DROP TABLE IF EXISTS ${TABLE}`);
    await seeder.end();
  });

  it("expect:match with ${request.body.*} ref resolves + verifies (production call shape)", async () => {
    const registry = createRegistry(pgEnv());
    try {
      const endpoint = {
        id: "dbverify.match",
        db_verify: [
          {
            connection: CONN,
            query_id: "row_present",
            query: `SELECT id, kind FROM ${TABLE} WHERE id = \${request.body.row_id}`,
            expect: "match",
            // Literal expected values. (Whether `fields` values themselves
            // support `${...}` refs is tracked separately; here we assert the
            // sentinel-ized query + match evaluation against the real row.)
            fields: { id: "apiwright-e2e-row-1", kind: "regression" },
          },
        ],
      } as unknown as CanonicalEndpoint;

      const { steps } = await runDbVerifications(
        endpoint,
        registry,
        {},
        { row_id: "apiwright-e2e-row-1" },
        {},
      );
      expect(steps).toHaveLength(1);
      expect(steps[0]?.record.pass).toBe(true);
    } finally {
      await registry.disposeAll();
    }
  }, 30_000);

  it("expect:exists returns the seeded row through the production path", async () => {
    const registry = createRegistry(pgEnv());
    try {
      const endpoint = {
        id: "dbverify.exists",
        db_verify: [
          {
            connection: CONN,
            query_id: "any_row",
            query: `SELECT id FROM ${TABLE} WHERE kind = \${request.body.kind}`,
            expect: "exists",
          },
        ],
      } as unknown as CanonicalEndpoint;

      const { steps } = await runDbVerifications(
        endpoint,
        registry,
        {},
        { kind: "regression" },
        {},
      );
      expect(steps[0]?.record.pass).toBe(true);
    } finally {
      await registry.disposeAll();
    }
  }, 30_000);

  it("cleanup query runs through the production path (runCleanup)", async () => {
    const registry = createRegistry(pgEnv());
    try {
      // Seed a throwaway row, then let runCleanup delete it.
      await seeder.query(`INSERT INTO ${TABLE} (id, kind) VALUES ('cleanup-target', 'temp')`);
      const endpoint = {
        id: "dbverify.cleanup",
        cleanup: {
          connection: CONN,
          query: `DELETE FROM ${TABLE} WHERE id = \${request.body.doomed}`,
        },
      } as unknown as CanonicalEndpoint;

      await runCleanup(endpoint, registry, {}, { doomed: "cleanup-target" }, {});
      const check = await seeder.query(`SELECT 1 FROM ${TABLE} WHERE id = 'cleanup-target'`);
      expect(check.rowCount).toBe(0);
    } finally {
      await registry.disposeAll();
    }
  }, 30_000);
});
