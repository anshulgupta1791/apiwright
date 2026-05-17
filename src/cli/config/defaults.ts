/**
 * Default configuration values for APIWright.
 *
 * Provides the canonical frozen defaults object and a deep-clone helper
 * so callers always receive fresh, mutable config objects without aliasing
 * the frozen constant.
 */

import type { ApiwrightConfig } from "./types.js";

/**
 * Canonical default configuration matching the spec example
 * (V1_BUILD_SPEC.md §12, apiwright.config.json example). Frozen so it
 * can never be mutated.
 * Always use {@link cloneDefaults} to obtain a mutable copy.
 */
export const DEFAULT_CONFIG: Readonly<ApiwrightConfig> = Object.freeze({
  tests_dir: "./tests",
  environments_dir: "./environments",
  reports_dir: "./reports",
  default_env: "qa",
  default_markers: ["smoke"],
  log_level: "warn",
  workers: 8,
  retry: Object.freeze({
    count: 2,
    delay_ms: 1000,
    backoff: "linear",
    strict: false,
  }),
  report: Object.freeze({
    html: true,
    json: true,
    junit_xml: true,
    output_dir: "./reports",
  }),
} as ApiwrightConfig);

/**
 * Returns a deep clone of {@link DEFAULT_CONFIG}.
 *
 * Uses structuredClone to ensure no sub-objects are shared with the constant
 * or with previously returned clones. Callers may freely mutate the result.
 * @returns A fresh, fully mutable copy of the default configuration.
 */
export function cloneDefaults(): ApiwrightConfig {
  return structuredClone(DEFAULT_CONFIG);
}
