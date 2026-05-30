/**
 * Canonical TypeScript types for parsed APIWright environment files.
 *
 * These describe the structure of an `environments/<name>.yaml` document
 * (see §7). Every other env sub-task (yaml-reader, secrets,
 * template-resolver, loader) consumes these types. This file is type-only and
 * is excluded from coverage by the Vitest config.
 */

/** Supported database engine types in an environment file. */
export type DatabaseType = "postgres" | "mysql" | "mongodb" | "neo4j";

/** Supported auth strategy types in an environment file. */
export type AuthStrategyType = "static_token" | "token_endpoint";

/**
 * A single database connection configuration within an environment.
 * Engine-specific extra keys are tolerated; discrete fields or a `uri` may be
 * used depending on the engine.
 */
export interface DatabaseConfig {
  /** Database engine type. */
  type: DatabaseType;
  /** Hostname for discrete-field connections (postgres/mysql). */
  host?: string;
  /** Port for discrete-field connections. */
  port?: number;
  /** Database/schema name. */
  database?: string;
  /** Connection username (often a ${secret.*} reference). */
  user?: string;
  /** Connection password (often a ${secret.*} reference). */
  password?: string;
  /** Connection URI for engines that prefer it (mongodb/neo4j). */
  uri?: string;
  /** Engine-specific extra options, validated loosely. */
  [key: string]: unknown;
}

/**
 * A single auth strategy configuration within an environment. Fields used
 * depend on `type`: `static_token` uses `token`; `token_endpoint` uses
 * `url`/`credentials`/`token_path`/`header`/`header_value`.
 */
export interface AuthStrategyConfig {
  /** Auth strategy type. */
  type: AuthStrategyType;
  /** Static bearer token (static_token strategy). */
  token?: string;
  /** Token endpoint URL (token_endpoint strategy). */
  url?: string;
  /** Credentials posted to the token endpoint. */
  credentials?: Record<string, string>;
  /** JSONPath to the token in the token-endpoint response. */
  token_path?: string;
  /** Header name to attach the resolved token to. */
  header?: string;
  /** Header value template (may contain ${token}). */
  header_value?: string;
  /** Strategy-specific extra options, validated loosely. */
  [key: string]: unknown;
}

/**
 * A fully parsed environment definition. Custom top-level keys are allowed so
 * QAs can declare arbitrary ${env.*} values (run_id, tenant, etc.).
 */
export interface ResolvedEnvironment {
  /** Environment name (e.g. "qa"). */
  name: string;
  /** Whether this environment is production (gates destructive runs). */
  prod: boolean;
  /** Base URL all relative endpoint paths resolve against. */
  base_url: string;
  /** Default per-endpoint SLA in milliseconds. */
  default_sla_ms?: number;
  /** Named database connections. */
  databases?: Record<string, DatabaseConfig>;
  /** Named auth strategies. */
  auth_strategies?: Record<string, AuthStrategyConfig>;
  /** Custom environment values referenced via ${env.*}. */
  [key: string]: unknown;
}

/** Result of validating an environment object against the schema. */
export interface EnvValidationResult {
  /** True when the object satisfies the environment schema. */
  valid: boolean;
  /** Human-readable error messages; present only when invalid. */
  errors?: string[];
}
