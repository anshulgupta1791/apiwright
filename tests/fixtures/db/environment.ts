/**
 * Synthetic `ResolvedEnvironment` fixture for the §5 DB pipeline corpus.
 *
 * One `databases` entry per engine, each with DELIBERATELY DISTINCTIVE fake
 * credentials (no real secrets). The distinctiveness lets the secret-safety
 * sweep assert these strings NEVER appear in any `DbConnectorError.message`,
 * `DbVerifyOutcome`, or serialized `DisposeAllOutcome`.
 *
 * Also exports `UNKNOWN_CONN` — a connection name not present in `databases`
 * used to exercise the unknown-name rejection path.
 *
 * Named exports only; no default export.
 */

import type { ResolvedEnvironment } from "../../../src/env/index.js";

/**
 * Synthetic resolved environment with one database entry per engine.
 * Credentials are deliberately fake and distinctive for secret-safety assertions.
 */
export const DB_ENV: ResolvedEnvironment = Object.freeze({
  name: "db-fixture",
  prod: false,
  base_url: "http://localhost",
  // Custom ${env.*} value the corpus references via ${env.tenant}
  tenant: "acme",
  databases: Object.freeze({
    pg_main: Object.freeze({
      type: "postgres",
      host: "fake-pg-host",
      port: 5432,
      database: "fake_pg_db",
      user: "fake_pg_user",
      password: "fake_pg_SECRET_pw",
    }),
    mysql_main: Object.freeze({
      type: "mysql",
      host: "fake-mysql-host",
      port: 3306,
      database: "fake_mysql_db",
      user: "fake_mysql_user",
      password: "fake_mysql_SECRET_pw",
    }),
    mongo_main: Object.freeze({
      type: "mongodb",
      uri: "mongodb://fake_mongo_user:fake_mongo_SECRET_pw@fake-mongo-host/fake_mongo_db",
    }),
    neo4j_main: Object.freeze({
      type: "neo4j",
      uri: "bolt://fake-neo4j-host",
      user: "fake_neo4j_user",
      password: "fake_neo4j_SECRET_pw",
    }),
  }),
});

/**
 * A connection name NOT present in `DB_ENV.databases`.
 * Used to assert that `registry.acquire(UNKNOWN_CONN)` rejects with a
 * `DbConnectorError` and that the rejection is not cached.
 */
export const UNKNOWN_CONN = "no_such_db_connection";

/**
 * The set of distinctive fake credential substrings that MUST NEVER appear
 * in any error message, outcome, or serialized output (secret-safety sweep).
 */
export const FAKE_CRED_SUBSTRINGS: readonly string[] = [
  "fake_pg_SECRET_pw",
  "fake_mysql_SECRET_pw",
  "fake_mongo_SECRET_pw",
  "fake_neo4j_SECRET_pw",
  "fake_mongo_user",
  "fake_pg_user",
  "fake_mysql_user",
  "fake_neo4j_user",
];
