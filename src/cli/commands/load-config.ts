/**
 * Shared config-load helper. The import and docs commands both need a
 * fully-resolved config and fail identically when it is invalid; this keeps
 * that logic in one place (DRY) rather than duplicated per command.
 */

import { ConfigLoader } from "../config/loader.js";
import type { ApiwrightConfig } from "../config/types.js";
import { ConfigError } from "../errors.js";

/**
 * Loads and returns the resolved config, throwing on failure.
 * @param loader - The config loader seam.
 * @returns The fully-merged config.
 * @throws ConfigError when the config file is invalid or missing required fields.
 */
export function loadConfigOrThrow(loader: ConfigLoader): ApiwrightConfig {
  const result = loader.load();
  if (!result.valid || !result.config) {
    throw new ConfigError((result.errors ?? ["config load failed"]).join("; "));
  }
  return result.config;
}
