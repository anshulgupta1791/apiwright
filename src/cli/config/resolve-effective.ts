/**
 * Flag override resolution — merges CLI flags over a loaded config to produce
 * a single-invocation EffectiveSettings. Pure functions; no I/O, no state.
 */

import type {
  ApiwrightConfig,
  CliFlags,
  EffectiveSettings,
  LogLevel,
  Marker,
} from "./types.js";

/** All valid log levels (used for validation and error messages). */
const LOG_LEVELS: readonly LogLevel[] = [
  "error",
  "warn",
  "info",
  "debug",
] as const;

/** All valid concrete markers. */
const VALID_MARKERS: readonly Marker[] = [
  "smoke",
  "regression",
  "e2e",
] as const;

/** Maximum allowed retry count. */
const MAX_RETRIES = 5;

/**
 * Discriminated result of {@link resolveEffectiveSettings}.
 * ok:true carries the resolved settings; ok:false carries aggregated errors.
 */
export type ResolveResult =
  | { ok: true; settings: EffectiveSettings }
  | { ok: false; errors: string[] };

/**
 * Parses a --markers string. Accepts comma-separated smoke/regression/e2e
 * and the literal "all" (→ ["smoke","regression","e2e"]). Whitespace
 * trimmed; case-sensitive per spec tokens. Unknown token → error.
 * @param raw - The raw --markers flag value.
 * @returns ok:true with parsed markers, or ok:false with an error string.
 */
export function parseMarkers(
  raw: string,
): { ok: true; markers: Marker[] } | { ok: false; error: string } {
  if (raw.trim() === "") {
    return { ok: false, error: "markers must not be empty" };
  }

  if (raw.trim() === "all") {
    return { ok: true, markers: ["smoke", "regression", "e2e"] };
  }

  const tokens = raw.split(",").map((t) => t.trim());

  for (const token of tokens) {
    if (token === "") {
      return {
        ok: false,
        error: "markers must not be empty (empty token in list)",
      };
    }
    if (!(VALID_MARKERS as readonly string[]).includes(token)) {
      return {
        ok: false,
        error: `unknown marker '${token}': must be smoke, regression, or e2e`,
      };
    }
  }

  // De-duplicate preserving order of first occurrence
  const seen = new Set<string>();
  const markers: Marker[] = [];
  for (const token of tokens) {
    if (!seen.has(token)) {
      seen.add(token);
      markers.push(token as Marker);
    }
  }

  return { ok: true, markers };
}

/**
 * Pure: merges supplied CLI flags over a validated config into the
 * per-run EffectiveSettings. Mutates neither input. Only flags that are
 * present (not undefined) override; absent flags keep the config value.
 *
 * All flag-parse failures are collected and returned together so a user
 * with multiple bad flags sees all errors at once.
 * @param config - A fully-loaded and validated config (all fields present).
 * @param flags - CLI flag values for this invocation (only supplied flags).
 * @returns ok:true with resolved settings, or ok:false with aggregated errors.
 */
export function resolveEffectiveSettings(
  config: ApiwrightConfig,
  flags: CliFlags,
): ResolveResult {
  const errors: string[] = [];

  const env = flags.env ?? config.default_env;
  const markers = resolveMarkers(flags, config, errors);
  const logLevel = resolveLogLevel(flags, config, errors);
  const workers = resolveWorkers(flags, config, errors);
  const retries = resolveRetries(flags, config, errors);
  // Issue #75 §9 line 638: --shard N/M sharding spec.
  const shard = resolveShard(flags, errors);

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  // §9 filters: pass through verbatim. Empty/whitespace-only values are
  // treated as absent so a stray `--tag=` doesn't filter everything out.
  const excludeTags = (flags.excludeTag ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  return {
    ok: true,
    settings: {
      env,
      markers,
      logLevel,
      workers,
      retries,
      allowNonSmokeInProd: flags.allowNonSmokeInProd === true,
      ...(nonEmpty(flags.path) ? { path: flags.path } : {}),
      ...(nonEmpty(flags.tag) ? { tag: flags.tag } : {}),
      ...(nonEmpty(flags.endpoint) ? { endpoint: flags.endpoint } : {}),
      ...(excludeTags.length > 0 ? { excludeTags } : {}),
      ...(shard !== undefined ? { shard } : {}),
      config,
    },
  };
}

/**
 * Issue #75: Parses `--shard N/M` into `{index, total}`. Returns
 * `undefined` when the flag is absent (no sharding). Pushes errors
 * (caller aggregates) for malformed input. Validates `1 <= N <= M`
 * and `M >= 1`; both must be positive integers.
 * @param flags - Raw CLI flags.
 * @param errors - Aggregated error accumulator.
 * @returns Parsed shard spec or undefined.
 */
function resolveShard(
  flags: CliFlags,
  errors: string[],
): { readonly index: number; readonly total: number } | undefined {
  if (flags.shard === undefined) return undefined;
  const raw = flags.shard.trim();
  if (raw.length === 0) return undefined;
  const match = /^(\d+)\/(\d+)$/.exec(raw);
  if (match === null) {
    errors.push(
      `--shard must be N/M with positive integers (got '${flags.shard}')`,
    );
    return undefined;
  }
  // RegExp matches guarantee these are present and parseable.
  const index = Number(match[1]);
  const total = Number(match[2]);
  if (total < 1) {
    errors.push(`--shard total M must be >= 1 (got '${flags.shard}')`);
    return undefined;
  }
  if (index < 1 || index > total) {
    errors.push(
      `--shard index N must satisfy 1 <= N <= M (got '${flags.shard}')`,
    );
    return undefined;
  }
  return { index, total };
}

/**
 * True iff `v` is a non-empty, non-whitespace string.
 * @param v - Candidate flag value.
 * @returns Whether the value should be treated as present.
 */
function nonEmpty(v: string | undefined): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/**
 * Resolves the effective markers from flags, falling back to config defaults.
 * Appends any parse errors to the `errors` accumulator.
 * @param flags - CLI flags for this invocation.
 * @param config - Loaded config providing the default markers.
 * @param errors - Mutable error accumulator.
 * @returns The resolved markers array.
 */
function resolveMarkers(
  flags: CliFlags,
  config: ApiwrightConfig,
  errors: string[],
): Marker[] {
  if (flags.markers === undefined) {
    return config.default_markers;
  }
  const result = parseMarkers(flags.markers);
  if (!result.ok) {
    errors.push(result.error);
    return config.default_markers;
  }
  return result.markers;
}

/**
 * Resolves the effective log level from flags, falling back to config default.
 * Appends any parse errors to the `errors` accumulator.
 * @param flags - CLI flags for this invocation.
 * @param config - Loaded config providing the default log level.
 * @param errors - Mutable error accumulator.
 * @returns The resolved log level.
 */
function resolveLogLevel(
  flags: CliFlags,
  config: ApiwrightConfig,
  errors: string[],
): LogLevel {
  if (flags.log === undefined) {
    return config.log_level;
  }
  if ((LOG_LEVELS as readonly string[]).includes(flags.log)) {
    return flags.log as LogLevel;
  }
  errors.push(
    `--log must be one of ${LOG_LEVELS.join(", ")} (got '${flags.log}')`,
  );
  return config.log_level;
}

/**
 * Resolves the effective worker count from flags, falling back to config default.
 * Appends any parse errors to the `errors` accumulator.
 * @param flags - CLI flags for this invocation.
 * @param config - Loaded config providing the default worker count.
 * @param errors - Mutable error accumulator.
 * @returns The resolved worker count.
 */
function resolveWorkers(
  flags: CliFlags,
  config: ApiwrightConfig,
  errors: string[],
): number {
  if (flags.workers === undefined) {
    return config.workers;
  }
  const parsed = parsePositiveInt(flags.workers);
  if (parsed === null) {
    errors.push("workers must be a positive integer");
    return config.workers;
  }
  return parsed;
}

/**
 * Resolves the effective retry count from flags, falling back to config default.
 * Appends any parse errors to the `errors` accumulator.
 * @param flags - CLI flags for this invocation.
 * @param config - Loaded config providing the default retry count.
 * @param errors - Mutable error accumulator.
 * @returns The resolved retry count.
 */
function resolveRetries(
  flags: CliFlags,
  config: ApiwrightConfig,
  errors: string[],
): number {
  if (flags.retries === undefined) {
    return config.retry.count;
  }
  const parsed = parseIntRange(flags.retries, 0, MAX_RETRIES);
  if (parsed === null) {
    errors.push(`retries must be an integer 0-${MAX_RETRIES}`);
    return config.retry.count;
  }
  return parsed;
}

/**
 * Parses a string as a positive integer (>= 1, no decimals).
 * Returns null if parsing fails or value is not a valid positive integer.
 * @param raw - The string to parse.
 * @returns The integer, or null on failure.
 */
function parsePositiveInt(raw: string): number | null {
  if (raw.trim() === "" || raw.includes(".")) return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return null;
  return n;
}

/**
 * Parses a string as an integer within [min, max]. No decimals allowed.
 * Returns null if parsing fails or value is out of range.
 * @param raw - The string to parse.
 * @param min - Minimum allowed value (inclusive).
 * @param max - Maximum allowed value (inclusive).
 * @returns The integer, or null on failure.
 */
function parseIntRange(raw: string, min: number, max: number): number | null {
  /* istanbul ignore next — empty-string branch is a defensive guard; callers filter undefined */
  if (raw.trim() === "" || raw.includes(".")) return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) return null;
  return n;
}
