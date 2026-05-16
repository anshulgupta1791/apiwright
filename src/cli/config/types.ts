/**
 * Configuration types for APIWright CLI.
 *
 * Defines all config shapes, flag types, and the EffectiveSettings produced
 * by merging CLI flags over a loaded config for one invocation.
 */

/** Console verbosity levels (V1_BUILD_SPEC.md §10, lines 648–657). */
export type LogLevel = "error" | "warn" | "info" | "debug";

/**
 * Test markers (V1_BUILD_SPEC.md §3). `all` is a CLI shorthand only,
 * never stored in config (config uses the concrete three).
 */
export type Marker = "smoke" | "regression" | "e2e";

/** Retry policy block of apiwright.config.json (V1_BUILD_SPEC.md §9). */
export interface RetryConfig {
  /** Initial attempt plus up to N retries. Range 0–5. Default 2. */
  count: number;
  /** Delay between attempts in ms. Non-negative. Default 1000. */
  delay_ms: number;
  /** Backoff strategy between retries. Default "linear". */
  backoff: "none" | "linear" | "exponential";
  /** Strict mode treats any first-attempt failure as fail. Default false. */
  strict: boolean;
}

/** Report output block of apiwright.config.json (V1_BUILD_SPEC.md §10). */
export interface ReportConfig {
  /** Emit the HTML technical report. Default true. */
  html: boolean;
  /** Emit the JSON sidecar. Default true. */
  json: boolean;
  /** Emit JUnit XML for CI. Default true. */
  junit_xml: boolean;
  /** Directory reports are written to. Default "./reports". */
  output_dir: string;
}

/**
 * Fully-resolved apiwright.config.json. After {@link ConfigLoader.load}
 * every field is present (defaults filled); no optionals. Consumed by the
 * loader, command handlers, and the run/import/docs seams.
 */
export interface ApiwrightConfig {
  /** Endpoint test directory. Default "./tests". */
  tests_dir: string;
  /** Environment YAML directory. Default "./environments". */
  environments_dir: string;
  /** Reports directory. Default "./reports". */
  reports_dir: string;
  /** Default environment name when --env is absent. Default "qa". */
  default_env: string;
  /** Default markers when --markers is absent. Default ["smoke"]. */
  default_markers: Marker[];
  /** Default console log level when --log is absent. Default "warn". */
  log_level: LogLevel;
  /** Default Playwright worker count. Positive integer. Default 8. */
  workers: number;
  /** Retry policy. */
  retry: RetryConfig;
  /** Report output policy. */
  report: ReportConfig;
}

/** Partial config as it may appear on disk (every key optional). */
export type PartialApiwrightConfig = {
  [K in keyof ApiwrightConfig]?: K extends "retry"
    ? Partial<RetryConfig>
    : K extends "report"
      ? Partial<ReportConfig>
      : ApiwrightConfig[K];
};

/**
 * The per-run settings produced by merging CLI flags over a loaded config
 * (subtask 3). Distinct from {@link ApiwrightConfig}: this is the
 * single-invocation view consumed by command handlers and the TestRunner
 * seam. The on-disk config is never mutated to produce this.
 */
export interface EffectiveSettings {
  /** Resolved environment name (CLI --env or config default_env). */
  env: string;
  /** Resolved, validated, de-`all`-expanded markers. */
  markers: Marker[];
  /** Resolved console log level. */
  logLevel: LogLevel;
  /** Resolved worker count (CLI --workers or config workers). */
  workers: number;
  /** Resolved retry count (CLI --retries or config retry.count). */
  retries: number;
  /** Whether --allow-non-smoke-in-prod was passed (prod-safety input). */
  allowNonSmokeInProd: boolean;
  /** The full underlying config (immutable; for paths, report policy). */
  config: Readonly<ApiwrightConfig>;
}

/** Raw CLI flag values for one invocation (only supplied flags present). */
export interface CliFlags {
  /** --env=<name>. */
  env?: string;
  /** --markers=<csv|all>. */
  markers?: string;
  /** --log=<level>. */
  log?: string;
  /** --workers=<n> (string from commander; parsed by resolver). */
  workers?: string;
  /** --retries=<n>. */
  retries?: string;
  /** --allow-non-smoke-in-prod boolean flag. */
  allowNonSmokeInProd?: boolean;
  /** --config=<path> override for config file location. */
  config?: string;
}
