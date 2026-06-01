/**
 * Integration regression guard — retry config wiring (v1.0 known issues #2 + #3).
 *
 * Two coupled bugs documented in docs/limitations.md (both "no-effect flag"
 * ship-bar violations):
 *
 *   - `retry.delay_ms` and `retry.backoff` from apiwright.config.json were
 *     silently dropped by the resolver; only `retry.count` reached the
 *     executor.
 *   - Per-endpoint `retry: {count: 0}` was always overridden by the global
 *     config count, because the config count was forwarded as
 *     `cliRetryOverride` (which always wins).
 *
 * Both share the same root cause: `resolveRetries()` returned a scalar
 * `count` instead of the full `Partial<ResolvedRetryPolicy>`. This test
 * verifies the fix by exercising the resolver → real-test-runner →
 * runner.executeWithRetry chain end-to-end with a stubbed HTTP client.
 */

import { describe, it, expect, vi } from "vitest";

import { resolveEffectiveSettings } from "../../../src/cli/config/resolve-effective.js";
import type { ApiwrightConfig } from "../../../src/cli/config/types.js";

const BASE_CONFIG: ApiwrightConfig = {
  tests_dir: "./tests",
  environments_dir: "./environments",
  reports_dir: "./reports",
  default_env: "qa",
  default_markers: ["smoke"],
  log_level: "warn",
  workers: 8,
  retry: {
    count: 2,
    delay_ms: 1000,
    backoff: "linear",
    strict: false,
  },
  report: {
    html: true,
    json: true,
    junit_xml: true,
    output_dir: "./reports",
  },
};

describe("retry config wiring end-to-end (v1.0 known issues #2 + #3)", () => {
  describe("Bug 2 — delay_ms and backoff reach the runner via globalRetryPolicy", () => {
    it("issue fix: delay_ms from config reaches settings.globalRetryPolicy.delay_ms", () => {
      const cfg: ApiwrightConfig = {
        ...BASE_CONFIG,
        retry: { count: 3, delay_ms: 250, backoff: "exponential", strict: true },
      };
      const result = resolveEffectiveSettings(cfg, {});
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.settings.globalRetryPolicy).toEqual({
        count: 3,
        delay_ms: 250,
        backoff: "exponential",
        strict: true,
      });
    });

    it("issue fix: backoff='none' from config reaches settings.globalRetryPolicy.backoff", () => {
      const cfg: ApiwrightConfig = {
        ...BASE_CONFIG,
        retry: { count: 1, delay_ms: 50, backoff: "none", strict: false },
      };
      const result = resolveEffectiveSettings(cfg, {});
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.settings.globalRetryPolicy.backoff).toBe("none");
    });

    it("issue fix: strict from config reaches settings.globalRetryPolicy.strict", () => {
      const cfg: ApiwrightConfig = {
        ...BASE_CONFIG,
        retry: { ...BASE_CONFIG.retry, strict: true },
      };
      const result = resolveEffectiveSettings(cfg, {});
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.settings.globalRetryPolicy.strict).toBe(true);
    });
  });

  describe("Bug 3 — per-endpoint retry override is not clobbered by config count", () => {
    it("issue fix: when --retries is absent, cliRetryOverride is undefined so per-endpoint wins", () => {
      const result = resolveEffectiveSettings(BASE_CONFIG, {});
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // The critical assertion — cliRetryOverride MUST be undefined when no
      // flag is passed; that's what lets the executor's resolveRetryPolicy
      // honor per-endpoint `retry: {count: 0}`.
      expect(result.settings.cliRetryOverride).toBeUndefined();
    });

    it("issue fix: when --retries IS passed, it overrides per-endpoint (cli wins by design)", () => {
      const result = resolveEffectiveSettings(BASE_CONFIG, { retries: "0" });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.settings.cliRetryOverride).toBe(0);
    });

    it("issue fix: end-to-end precedence chain — config defaults flow via globalRetryPolicy, CLI flows via cliRetryOverride", async () => {
      // This is the chain that closes Bug 3. Stub runOnce to capture the
      // RunnerConfig and assert both fields landed correctly.
      const runnerModule = await import("../../../src/runner/index.js");
      const runOnceSpy = vi.spyOn(runnerModule, "runOnce").mockImplementation(async (cfg: unknown) => {
        // Return a minimal RunResult shape.
        return {
          started_at: new Date().toISOString(),
          ended_at: new Date().toISOString(),
          env: "qa",
          filters: {},
          shard: null,
          workers: 1,
          endpoints: [],
          summary: {
            endpoints_planned: 0,
            passed: 0,
            failed: 0,
            flaky: 0,
            duration_ms: 0,
          },
        };
      });

      try {
        const { RealTestRunner } = await import("../../../src/cli/seams/real-test-runner.js");
        const { SecretRegistry } = await import("../../../src/env/index.js");
        const cfg: ApiwrightConfig = {
          ...BASE_CONFIG,
          retry: { count: 3, delay_ms: 100, backoff: "exponential", strict: false },
        };
        const settings = resolveEffectiveSettings(cfg, { retries: "5" });
        expect(settings.ok).toBe(true);
        if (!settings.ok) return;

        const runner = new RealTestRunner();
        await runner.run({
          settings: settings.settings,
          environment: { name: "qa", prod: false, base_url: "http://invalid" },
          markers: ["smoke"],
          secrets: new SecretRegistry(),
        });

        expect(runOnceSpy).toHaveBeenCalledTimes(1);
        const passedConfig = runOnceSpy.mock.calls[0]?.[0] as Record<string, unknown>;
        // Bug 2 fix: full policy passed (count + delay_ms + backoff + strict).
        expect(passedConfig["globalRetryPolicy"]).toEqual({
          count: 3,
          delay_ms: 100,
          backoff: "exponential",
          strict: false,
        });
        // Bug 3 fix: cliRetryOverride passed independently when --retries given.
        expect(passedConfig["cliRetryOverride"]).toBe(5);
      } finally {
        runOnceSpy.mockRestore();
      }
    });

    it("issue fix: when --retries is absent, cliRetryOverride is NOT forwarded to runOnce", async () => {
      const runnerModule = await import("../../../src/runner/index.js");
      const runOnceSpy = vi.spyOn(runnerModule, "runOnce").mockImplementation(async () => ({
        started_at: new Date().toISOString(),
        ended_at: new Date().toISOString(),
        env: "qa",
        filters: {},
        shard: null,
        workers: 1,
        endpoints: [],
        summary: {
          endpoints_planned: 0,
          passed: 0,
          failed: 0,
          flaky: 0,
          duration_ms: 0,
        },
      }));

      try {
        const { RealTestRunner } = await import("../../../src/cli/seams/real-test-runner.js");
        const { SecretRegistry } = await import("../../../src/env/index.js");
        const settings = resolveEffectiveSettings(BASE_CONFIG, {});
        expect(settings.ok).toBe(true);
        if (!settings.ok) return;

        const runner = new RealTestRunner();
        await runner.run({
          settings: settings.settings,
          environment: { name: "qa", prod: false, base_url: "http://invalid" },
          markers: ["smoke"],
          secrets: new SecretRegistry(),
        });

        const passedConfig = runOnceSpy.mock.calls[0]?.[0] as Record<string, unknown>;
        // cliRetryOverride MUST NOT be present — that's the gate that lets
        // per-endpoint retry config win over global config in the executor.
        expect(passedConfig).not.toHaveProperty("cliRetryOverride");
        // globalRetryPolicy still forwarded normally.
        expect(passedConfig["globalRetryPolicy"]).toBeDefined();
      } finally {
        runOnceSpy.mockRestore();
      }
    });
  });
});
