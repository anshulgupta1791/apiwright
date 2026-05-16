import { describe, it, expect, vi } from "vitest";

import { loadConfigOrThrow } from "../../../../src/cli/commands/load-config.js";
import { ConfigLoader } from "../../../../src/cli/config/loader.js";
import { ConfigError } from "../../../../src/cli/errors.js";
import type { ApiwrightConfig } from "../../../../src/cli/config/types.js";

/**
 * Unit tests for loadConfigOrThrow().
 *
 * Verifies that a valid config is returned as-is, that a failed load
 * (valid=false with errors) throws ConfigError with the aggregated errors,
 * and that the `?? ["config load failed"]` fallback guard is exercised when
 * the errors array is undefined alongside valid=false.
 */

const VALID_CONFIG: ApiwrightConfig = {
  tests_dir: "./tests",
  environments_dir: "./environments",
  reports_dir: "./reports",
  default_env: "qa",
  default_markers: ["smoke"],
  log_level: "warn",
  workers: 8,
  retry: { count: 2, delay_ms: 1000, backoff: "linear", strict: false },
  report: { html: true, json: true, junit_xml: true, output_dir: "./reports" },
};

function makeFakeLoader(result: {
  valid: boolean;
  config?: ApiwrightConfig;
  errors?: string[];
}): ConfigLoader {
  return {
    load: vi.fn().mockReturnValue(result),
  } as unknown as ConfigLoader;
}

describe("loadConfigOrThrow()", () => {
  describe("valid config", () => {
    it("returns the config when loader returns valid=true with a config", () => {
      const loader = makeFakeLoader({ valid: true, config: VALID_CONFIG });
      const result = loadConfigOrThrow(loader);
      expect(result).toEqual(VALID_CONFIG);
    });

    it("does not throw when config is valid", () => {
      const loader = makeFakeLoader({ valid: true, config: VALID_CONFIG });
      expect(() => loadConfigOrThrow(loader)).not.toThrow();
    });

    it("returns the exact config object (not a copy)", () => {
      const loader = makeFakeLoader({ valid: true, config: VALID_CONFIG });
      const result = loadConfigOrThrow(loader);
      expect(result).toBe(VALID_CONFIG);
    });
  });

  describe("invalid config — throws ConfigError", () => {
    it("throws ConfigError when valid=false with error messages", () => {
      const loader = makeFakeLoader({
        valid: false,
        errors: ["workers must be a positive integer"],
      });
      expect(() => loadConfigOrThrow(loader)).toThrow(ConfigError);
    });

    it("ConfigError message contains the loader errors", () => {
      const loader = makeFakeLoader({
        valid: false,
        errors: ["apiwright.config.json is not valid JSON: unexpected token"],
      });
      let caught: unknown;
      try {
        loadConfigOrThrow(loader);
      } catch (e) {
        caught = e;
      }
      expect((caught as ConfigError).message).toContain(
        "apiwright.config.json is not valid JSON",
      );
    });

    it("joins multiple errors with '; ' in the ConfigError message", () => {
      const loader = makeFakeLoader({
        valid: false,
        errors: ["workers must be > 0", "log_level is invalid"],
      });
      let caught: unknown;
      try {
        loadConfigOrThrow(loader);
      } catch (e) {
        caught = e;
      }
      expect((caught as ConfigError).message).toContain("workers must be > 0");
      expect((caught as ConfigError).message).toContain("log_level is invalid");
    });

    it("throws ConfigError when valid=false with no errors array (hits ?? fallback)", () => {
      // This exercises the `?? ["config load failed"]` defensive branch:
      // valid=false but errors is undefined.
      const loader = makeFakeLoader({ valid: false, errors: undefined });
      let caught: unknown;
      try {
        loadConfigOrThrow(loader);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(ConfigError);
      expect((caught as ConfigError).message).toBe("config load failed");
    });

    it("throws ConfigError when valid=true but config is undefined", () => {
      // Guards the !result.config branch: valid=true but no config object.
      const loader = makeFakeLoader({ valid: true, config: undefined });
      expect(() => loadConfigOrThrow(loader)).toThrow(ConfigError);
    });

    it("ConfigError from the fallback guard uses 'config load failed' text", () => {
      const loader = makeFakeLoader({
        valid: true,
        config: undefined,
        errors: undefined,
      });
      let caught: unknown;
      try {
        loadConfigOrThrow(loader);
      } catch (e) {
        caught = e;
      }
      expect((caught as ConfigError).message).toBe("config load failed");
    });
  });
});
