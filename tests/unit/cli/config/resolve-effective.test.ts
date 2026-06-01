import { describe, it, expect } from "vitest";

import {
  resolveEffectiveSettings,
  parseMarkers,
} from "../../../../src/cli/config/resolve-effective.js";
import type { ApiwrightConfig } from "../../../../src/cli/config/types.js";
import type { CliFlags } from "../../../../src/cli/config/types.js";

/**
 * Unit tests for resolveEffectiveSettings() and parseMarkers().
 *
 * Covers every flag override rule, the --markers all expansion, error
 * aggregation for multiple bad flags, the pure (no-mutation) guarantee, and
 * every edge case documented in the design §3.3.
 */

/** Canonical full config matching spec example */
const BASE_CONFIG: ApiwrightConfig = {
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

describe("parseMarkers()", () => {
  describe("valid inputs", () => {
    it("parses 'smoke' as ['smoke']", () => {
      const result = parseMarkers("smoke");
      expect(result).toEqual({ ok: true, markers: ["smoke"] });
    });

    it("parses 'regression' as ['regression']", () => {
      const result = parseMarkers("regression");
      expect(result).toEqual({ ok: true, markers: ["regression"] });
    });

    it("parses 'e2e' as ['e2e']", () => {
      const result = parseMarkers("e2e");
      expect(result).toEqual({ ok: true, markers: ["e2e"] });
    });

    it("parses 'smoke,regression' as both markers", () => {
      const result = parseMarkers("smoke,regression");
      expect(result).toEqual({ ok: true, markers: ["smoke", "regression"] });
    });

    it("parses 'smoke,regression,e2e' as all three markers", () => {
      const result = parseMarkers("smoke,regression,e2e");
      expect(result).toEqual({
        ok: true,
        markers: ["smoke", "regression", "e2e"],
      });
    });

    it("expands 'all' to ['smoke','regression','e2e']", () => {
      const result = parseMarkers("all");
      expect(result).toEqual({
        ok: true,
        markers: ["smoke", "regression", "e2e"],
      });
    });

    it("trims whitespace around tokens", () => {
      const result = parseMarkers(" smoke , regression ");
      expect(result).toEqual({ ok: true, markers: ["smoke", "regression"] });
    });

    it("de-duplicates repeated markers (smoke,smoke → [smoke])", () => {
      const result = parseMarkers("smoke,smoke");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.markers).toEqual(["smoke"]);
      }
    });

    it("preserves order of first occurrence when de-duplicating", () => {
      const result = parseMarkers("regression,smoke,regression");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.markers[0]).toBe("regression");
        expect(result.markers[1]).toBe("smoke");
      }
    });
  });

  describe("invalid inputs", () => {
    it("returns ok=false for an unknown marker token", () => {
      const result = parseMarkers("smoke,invalid");
      expect(result.ok).toBe(false);
    });

    it("returns ok=false with an error message for unknown token", () => {
      const result = parseMarkers("invalid");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("invalid");
      }
    });

    it("returns ok=false for an empty string", () => {
      const result = parseMarkers("");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.toLowerCase()).toContain("empty");
      }
    });

    it("returns ok=false for empty token from 'smoke,,regression' (double comma)", () => {
      const result = parseMarkers("smoke,,regression");
      expect(result.ok).toBe(false);
    });

    it("is case-sensitive (Smoke with capital S is invalid)", () => {
      const result = parseMarkers("Smoke");
      expect(result.ok).toBe(false);
    });

    it("rejects 'ALL' (must be lowercase 'all')", () => {
      const result = parseMarkers("ALL");
      expect(result.ok).toBe(false);
    });
  });
});

describe("resolveEffectiveSettings()", () => {
  describe("env override", () => {
    it("uses config default_env when --env is absent", () => {
      const result = resolveEffectiveSettings(BASE_CONFIG, {});
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.settings.env).toBe("qa");
      }
    });

    it("uses --env flag value when supplied", () => {
      const result = resolveEffectiveSettings(BASE_CONFIG, { env: "prod" });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.settings.env).toBe("prod");
      }
    });

    it("applies --env even when it equals the config value (no-op, no error)", () => {
      const result = resolveEffectiveSettings(BASE_CONFIG, { env: "qa" });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.settings.env).toBe("qa");
      }
    });
  });

  describe("markers override", () => {
    it("uses config default_markers when --markers is absent", () => {
      const result = resolveEffectiveSettings(BASE_CONFIG, {});
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.settings.markers).toEqual(["smoke"]);
      }
    });

    it("uses --markers value when supplied (smoke,regression)", () => {
      const result = resolveEffectiveSettings(BASE_CONFIG, {
        markers: "smoke,regression",
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.settings.markers).toEqual(["smoke", "regression"]);
      }
    });

    it("expands --markers=all to [smoke,regression,e2e]", () => {
      const result = resolveEffectiveSettings(BASE_CONFIG, { markers: "all" });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.settings.markers).toEqual(["smoke", "regression", "e2e"]);
      }
    });

    it("returns ok=false when --markers contains an invalid token", () => {
      const result = resolveEffectiveSettings(BASE_CONFIG, {
        markers: "smoke,invalid",
      });
      expect(result.ok).toBe(false);
    });

    it("returns ok=false with error message when --markers is empty string", () => {
      const result = resolveEffectiveSettings(BASE_CONFIG, { markers: "" });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.length).toBeGreaterThan(0);
      }
    });
  });

  describe("logLevel override", () => {
    it("uses config log_level when --log is absent", () => {
      const result = resolveEffectiveSettings(BASE_CONFIG, {});
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.settings.logLevel).toBe("warn");
      }
    });

    it("uses --log value when supplied (debug)", () => {
      const result = resolveEffectiveSettings(BASE_CONFIG, { log: "debug" });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.settings.logLevel).toBe("debug");
      }
    });

    it("applies --log=warn even when config is already warn (no-op, no error)", () => {
      const result = resolveEffectiveSettings(BASE_CONFIG, { log: "warn" });
      expect(result.ok).toBe(true);
    });

    it("returns ok=false when --log is not a valid log level", () => {
      const result = resolveEffectiveSettings(BASE_CONFIG, { log: "verbose" });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.join(" ")).toContain("--log");
      }
    });

    it("returns ok=false with a message naming all accepted values when --log is invalid", () => {
      const result = resolveEffectiveSettings(BASE_CONFIG, { log: "trace" });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        const msg = result.errors.join(" ");
        expect(msg).toContain("error");
        expect(msg).toContain("warn");
        expect(msg).toContain("info");
        expect(msg).toContain("debug");
      }
    });

    it("includes the bad value in the error message", () => {
      const result = resolveEffectiveSettings(BASE_CONFIG, { log: "WARN" });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.join(" ")).toContain("WARN");
      }
    });
  });

  describe("workers override", () => {
    it("uses config workers when --workers is absent", () => {
      const result = resolveEffectiveSettings(BASE_CONFIG, {});
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.settings.workers).toBe(8);
      }
    });

    it("uses --workers value when supplied (16)", () => {
      const result = resolveEffectiveSettings(BASE_CONFIG, { workers: "16" });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.settings.workers).toBe(16);
      }
    });

    it("returns ok=false when --workers=0 (not a positive integer)", () => {
      const result = resolveEffectiveSettings(BASE_CONFIG, { workers: "0" });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.join(" ")).toContain("workers");
      }
    });

    it("returns ok=false when --workers=-1", () => {
      const result = resolveEffectiveSettings(BASE_CONFIG, { workers: "-1" });
      expect(result.ok).toBe(false);
    });

    it("returns ok=false when --workers=8.5 (float)", () => {
      const result = resolveEffectiveSettings(BASE_CONFIG, { workers: "8.5" });
      expect(result.ok).toBe(false);
    });

    it("returns ok=false when --workers='abc'", () => {
      const result = resolveEffectiveSettings(BASE_CONFIG, { workers: "abc" });
      expect(result.ok).toBe(false);
    });
  });

  describe("retry policy resolution (issue fix — was: only count reached the executor)", () => {
    // v1.0 known-issue fix: previously `settings.retries: number` was the
    // only field that reached the executor (as cliRetryOverride), so
    // (a) config delay_ms / backoff were silently dropped (no-effect flag),
    // and (b) the config count always beat per-endpoint overrides because
    // it was forwarded as cliRetryOverride. The fix splits into two fields:
    // settings.globalRetryPolicy (full Partial from config) +
    // settings.cliRetryOverride (only set when --retries N is passed).

    it("issue fix: globalRetryPolicy carries ALL four config retry fields", () => {
      const result = resolveEffectiveSettings(BASE_CONFIG, {});
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.settings.globalRetryPolicy).toEqual({
          count: BASE_CONFIG.retry.count,
          delay_ms: BASE_CONFIG.retry.delay_ms,
          backoff: BASE_CONFIG.retry.backoff,
          strict: BASE_CONFIG.retry.strict,
        });
      }
    });

    it("issue fix: globalRetryPolicy.delay_ms reflects config.retry.delay_ms", () => {
      const cfg = { ...BASE_CONFIG, retry: { ...BASE_CONFIG.retry, delay_ms: 250 } };
      const result = resolveEffectiveSettings(cfg, {});
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.settings.globalRetryPolicy.delay_ms).toBe(250);
      }
    });

    it("issue fix: globalRetryPolicy.backoff reflects config.retry.backoff", () => {
      const cfg = { ...BASE_CONFIG, retry: { ...BASE_CONFIG.retry, backoff: "exponential" as const } };
      const result = resolveEffectiveSettings(cfg, {});
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.settings.globalRetryPolicy.backoff).toBe("exponential");
      }
    });

    it("issue fix: cliRetryOverride is undefined when --retries is absent (so per-endpoint can win)", () => {
      const result = resolveEffectiveSettings(BASE_CONFIG, {});
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.settings.cliRetryOverride).toBeUndefined();
      }
    });

    it("uses --retries value when supplied (0) — populates cliRetryOverride", () => {
      const result = resolveEffectiveSettings(BASE_CONFIG, { retries: "0" });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.settings.cliRetryOverride).toBe(0);
      }
    });

    it("uses --retries=5 (maximum valid value)", () => {
      const result = resolveEffectiveSettings(BASE_CONFIG, { retries: "5" });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.settings.cliRetryOverride).toBe(5);
      }
    });

    it("--retries override does NOT affect globalRetryPolicy (kept independent)", () => {
      const result = resolveEffectiveSettings(BASE_CONFIG, { retries: "5" });
      expect(result.ok).toBe(true);
      if (result.ok) {
        // CLI override populated...
        expect(result.settings.cliRetryOverride).toBe(5);
        // ...but globalRetryPolicy still carries the config count.
        expect(result.settings.globalRetryPolicy.count).toBe(BASE_CONFIG.retry.count);
      }
    });

    it("returns ok=false when --retries=6 (above maximum)", () => {
      const result = resolveEffectiveSettings(BASE_CONFIG, { retries: "6" });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.join(" ")).toContain("retries");
      }
    });

    it("returns ok=false when --retries=-1", () => {
      const result = resolveEffectiveSettings(BASE_CONFIG, { retries: "-1" });
      expect(result.ok).toBe(false);
    });

    it("returns ok=false when --retries='two'", () => {
      const result = resolveEffectiveSettings(BASE_CONFIG, { retries: "two" });
      expect(result.ok).toBe(false);
    });
  });

  describe("allowNonSmokeInProd", () => {
    it("is false when flag is absent", () => {
      const result = resolveEffectiveSettings(BASE_CONFIG, {});
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.settings.allowNonSmokeInProd).toBe(false);
      }
    });

    it("is true when --allow-non-smoke-in-prod flag is passed", () => {
      const result = resolveEffectiveSettings(BASE_CONFIG, {
        allowNonSmokeInProd: true,
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.settings.allowNonSmokeInProd).toBe(true);
      }
    });

    it("is false when allowNonSmokeInProd=false in flags", () => {
      const result = resolveEffectiveSettings(BASE_CONFIG, {
        allowNonSmokeInProd: false,
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.settings.allowNonSmokeInProd).toBe(false);
      }
    });
  });

  describe("config passthrough", () => {
    it("includes the original config reference in settings.config", () => {
      const result = resolveEffectiveSettings(BASE_CONFIG, {});
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.settings.config).toBe(BASE_CONFIG);
      }
    });
  });

  describe("error aggregation", () => {
    it("returns all flag errors together when multiple flags are invalid", () => {
      const result = resolveEffectiveSettings(BASE_CONFIG, {
        log: "bad",
        workers: "0",
        retries: "99",
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.length).toBeGreaterThanOrEqual(2);
      }
    });

    it("aggregates markers error and workers error together", () => {
      const result = resolveEffectiveSettings(BASE_CONFIG, {
        markers: "invalid",
        workers: "-5",
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.length).toBeGreaterThanOrEqual(2);
      }
    });
  });

  describe("purity (no mutation)", () => {
    it("does not mutate the input config", () => {
      const configCopy = JSON.parse(
        JSON.stringify(BASE_CONFIG),
      ) as ApiwrightConfig;
      resolveEffectiveSettings(BASE_CONFIG, { env: "staging", log: "error" });
      expect(BASE_CONFIG).toEqual(configCopy);
    });

    it("does not mutate the input flags object", () => {
      const flags: CliFlags = { env: "prod", log: "debug" };
      const flagsCopy = { ...flags };
      resolveEffectiveSettings(BASE_CONFIG, flags);
      expect(flags).toEqual(flagsCopy);
    });

    it("returns a new settings object (not reusing any existing reference)", () => {
      const result1 = resolveEffectiveSettings(BASE_CONFIG, { env: "qa" });
      const result2 = resolveEffectiveSettings(BASE_CONFIG, { env: "prod" });
      expect(result1.ok).toBe(true);
      expect(result2.ok).toBe(true);
      if (result1.ok && result2.ok) {
        expect(result1.settings).not.toBe(result2.settings);
        expect(result1.settings.env).toBe("qa");
        expect(result2.settings.env).toBe("prod");
      }
    });
  });

  describe("all flags absent — uses all config defaults", () => {
    it("resolves fully from config defaults when no flags are provided", () => {
      const result = resolveEffectiveSettings(BASE_CONFIG, {});
      expect(result.ok).toBe(true);
      if (result.ok) {
        const s = result.settings;
        expect(s.env).toBe("qa");
        expect(s.markers).toEqual(["smoke"]);
        expect(s.logLevel).toBe("warn");
        expect(s.workers).toBe(8);
        // v1.0 fix: full retry policy from config (was: scalar `retries`)
        expect(s.globalRetryPolicy.count).toBe(2);
        expect(s.cliRetryOverride).toBeUndefined();
        expect(s.allowNonSmokeInProd).toBe(false);
        expect(s.config).toBe(BASE_CONFIG);
      }
    });
  });

  describe("§9 filter flags (--path / --tag / --endpoint / --exclude-tag) — issue #30", () => {
    it("omits all filter fields when no filter flags are passed", () => {
      const result = resolveEffectiveSettings(BASE_CONFIG, {});
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.settings.path).toBeUndefined();
        expect(result.settings.tag).toBeUndefined();
        expect(result.settings.endpoint).toBeUndefined();
        expect(result.settings.excludeTags).toBeUndefined();
      }
    });

    it("passes --path / --tag / --endpoint through to settings", () => {
      const result = resolveEffectiveSettings(BASE_CONFIG, {
        path: "tests/user-service/",
        tag: "billing",
        endpoint: "users.create",
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.settings.path).toBe("tests/user-service/");
        expect(result.settings.tag).toBe("billing");
        expect(result.settings.endpoint).toBe("users.create");
      }
    });

    it("splits --exclude-tag CSV into a trimmed, non-empty array", () => {
      const result = resolveEffectiveSettings(BASE_CONFIG, { excludeTag: "slow, destructive ,," });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.settings.excludeTags).toEqual(["slow", "destructive"]);
      }
    });

    it("treats whitespace-only filter flags as absent", () => {
      const result = resolveEffectiveSettings(BASE_CONFIG, {
        path: "   ",
        tag: "",
        endpoint: "  ",
        excludeTag: " , ",
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.settings.path).toBeUndefined();
        expect(result.settings.tag).toBeUndefined();
        expect(result.settings.endpoint).toBeUndefined();
        expect(result.settings.excludeTags).toBeUndefined();
      }
    });
  });

  describe("§9 --shard N/M (issue #75)", () => {
    it("parses '1/4' as {index: 1, total: 4}", () => {
      const result = resolveEffectiveSettings(BASE_CONFIG, { shard: "1/4" });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.settings.shard).toEqual({ index: 1, total: 4 });
      }
    });

    it("parses '4/4' (last shard) correctly", () => {
      const result = resolveEffectiveSettings(BASE_CONFIG, { shard: "4/4" });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.settings.shard).toEqual({ index: 4, total: 4 });
      }
    });

    it("absent shard → settings.shard is undefined (no sharding)", () => {
      const result = resolveEffectiveSettings(BASE_CONFIG, {});
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.settings.shard).toBeUndefined();
      }
    });

    it("rejects malformed shard '5/4' (index > total)", () => {
      const result = resolveEffectiveSettings(BASE_CONFIG, { shard: "5/4" });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.some((e) => /1 <= N <= M/.test(e))).toBe(true);
      }
    });

    it("rejects non-numeric shard 'not-a-shard'", () => {
      const result = resolveEffectiveSettings(BASE_CONFIG, {
        shard: "not-a-shard",
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.some((e) => /N\/M/.test(e))).toBe(true);
      }
    });

    it("rejects '0/4' (1-based, so 0 is invalid)", () => {
      const result = resolveEffectiveSettings(BASE_CONFIG, { shard: "0/4" });
      expect(result.ok).toBe(false);
    });

    it("rejects '1/0' (total must be >= 1)", () => {
      const result = resolveEffectiveSettings(BASE_CONFIG, { shard: "1/0" });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.some((e) => /M must be >= 1/.test(e))).toBe(true);
      }
    });
  });
});
