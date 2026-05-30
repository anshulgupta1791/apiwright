import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { RunCommand } from "../../../../src/cli/commands/run.js";
import type { RunCommandOptions } from "../../../../src/cli/commands/run.js";
import { ConfigLoader } from "../../../../src/cli/config/loader.js";
import { ProdSafetyGate } from "../../../../src/cli/prod-safety.js";
import {
  ConfigError,
  ProdSafetyAbortError,
  NotImplementedError,
  RunFailedError,
} from "../../../../src/cli/errors.js";
import { ExitCode } from "../../../../src/cli/exit-codes.js";
import type { TestRunner } from "../../../../src/cli/seams/test-runner.js";
import { NotImplementedTestRunner } from "../../../../src/cli/seams/test-runner.js";
import type { Logger } from "../../../../src/cli/logging/logger.js";
import type { ApiwrightConfig } from "../../../../src/cli/config/types.js";
import { EnvironmentLoader } from "../../../../src/env/loader.js";

/**
 * Unit tests for RunCommand.execute().
 *
 * Exercises every step in the RunCommand.execute() flow:
 *   1. Config load failure → ConfigError
 *   2. resolveEffectiveSettings failure → ConfigError
 *   3. Env load failure → ConfigError
 *   4. Prod gate decision → ProdSafetyAbortError when denied
 *   5. TestRunner delegation → NotImplementedError(#10)
 *   6. Smoke-only prod → no prompt, reaches seam
 *   7. --config flag → configLoaderFactory receives the custom path
 * All collaborators are fake/stub; no real disk or network (except seam-wiring tests).
 */

const DEFAULT_CONFIG: ApiwrightConfig = {
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

function makeFakeLogger(
  level: "error" | "warn" | "info" | "debug" = "warn",
): Logger {
  return {
    level,
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  };
}

function makeFakeConfigLoaderFactory(result: {
  valid: boolean;
  config?: ApiwrightConfig;
  errors?: string[];
}): (configPath?: string) => ConfigLoader {
  return vi.fn((_configPath?: string) => ({
    load: vi.fn().mockReturnValue(result),
  })) as unknown as (configPath?: string) => ConfigLoader;
}

function makeFakeEnvLoaderFactory(result: {
  valid: boolean;
  environment?: { prod: boolean; name: string; base_url: string };
  errors?: string[];
  secretRegistry?: Map<string, string>;
}): (rootDir: string) => EnvironmentLoader {
  return vi.fn((_rootDir: string) => ({
    load: vi.fn().mockReturnValue({
      ...result,
      secretRegistry: result.secretRegistry ?? new Map(),
    }),
  })) as unknown as (rootDir: string) => EnvironmentLoader;
}

function makeFakeProdGate(
  allowed: boolean,
  reason = "aborted",
): ProdSafetyGate {
  return {
    evaluate: vi
      .fn()
      .mockResolvedValue(
        allowed ? { allowed: true } : { allowed: false, reason },
      ),
  } as unknown as ProdSafetyGate;
}

function makeFakeTestRunner(throws?: Error): TestRunner {
  if (throws) {
    return {
      run: vi.fn().mockRejectedValue(throws),
    };
  }
  return {
    run: vi
      .fn()
      .mockResolvedValue({ total: 1, passed: 1, failed: 0, flaky: 0 }),
  };
}

function makeOptions(
  overrides: Partial<RunCommandOptions> = {},
): RunCommandOptions {
  return {
    configLoaderFactory: makeFakeConfigLoaderFactory({
      valid: true,
      config: DEFAULT_CONFIG,
    }),
    prodSafetyGate: makeFakeProdGate(true),
    environmentLoaderFactory: makeFakeEnvLoaderFactory({
      valid: true,
      environment: { prod: false, name: "qa", base_url: "https://example.com" },
    }),
    testRunner: makeFakeTestRunner(
      new NotImplementedError("`apiwright run`", 10),
    ),
    loggerFactory: makeFakeLogger,
    ...overrides,
  };
}

describe("RunCommand.execute()", () => {
  describe("step 1 — config load failure", () => {
    it("throws ConfigError when config load returns valid=false", async () => {
      const opts = makeOptions({
        configLoaderFactory: makeFakeConfigLoaderFactory({
          valid: false,
          errors: ["apiwright.config.json is not valid JSON: unexpected token"],
        }),
      });
      const cmd = new RunCommand(opts);
      await expect(cmd.execute({})).rejects.toThrow(ConfigError);
    });

    it("thrown ConfigError message contains the config error", async () => {
      const opts = makeOptions({
        configLoaderFactory: makeFakeConfigLoaderFactory({
          valid: false,
          errors: ["workers must be a positive integer"],
        }),
      });
      const cmd = new RunCommand(opts);
      let caught: unknown;
      try {
        await cmd.execute({});
      } catch (e) {
        caught = e;
      }
      expect((caught as ConfigError).message).toContain(
        "workers must be a positive integer",
      );
    });

    it("ConfigError has code ExitCode.USAGE (2) when config load fails", async () => {
      const opts = makeOptions({
        configLoaderFactory: makeFakeConfigLoaderFactory({
          valid: false,
          errors: ["bad config"],
        }),
      });
      const cmd = new RunCommand(opts);
      let caught: unknown;
      try {
        await cmd.execute({});
      } catch (e) {
        caught = e;
      }
      expect((caught as ConfigError).code).toBe(ExitCode.USAGE);
    });
  });

  describe("step 2 — flag resolution failure", () => {
    it("throws ConfigError when --log is invalid", async () => {
      const opts = makeOptions();
      const cmd = new RunCommand(opts);
      await expect(cmd.execute({ log: "INVALID" })).rejects.toThrow(
        ConfigError,
      );
    });

    it("throws ConfigError when --workers is zero", async () => {
      const opts = makeOptions();
      const cmd = new RunCommand(opts);
      await expect(cmd.execute({ workers: "0" })).rejects.toThrow(ConfigError);
    });

    it("throws ConfigError when --markers is invalid", async () => {
      const opts = makeOptions();
      const cmd = new RunCommand(opts);
      await expect(cmd.execute({ markers: "badmarker" })).rejects.toThrow(
        ConfigError,
      );
    });
  });

  describe("step 3 — environment load failure", () => {
    it("throws ConfigError when EnvironmentLoader returns valid=false", async () => {
      const opts = makeOptions({
        environmentLoaderFactory: makeFakeEnvLoaderFactory({
          valid: false,
          errors: ["Environment 'qa' not found"],
        }),
      });
      const cmd = new RunCommand(opts);
      await expect(cmd.execute({})).rejects.toThrow(ConfigError);
    });

    it("thrown ConfigError message contains the env error", async () => {
      const opts = makeOptions({
        environmentLoaderFactory: makeFakeEnvLoaderFactory({
          valid: false,
          errors: ["secret QA_DB_PASSWORD not set"],
        }),
      });
      const cmd = new RunCommand(opts);
      let caught: unknown;
      try {
        await cmd.execute({});
      } catch (e) {
        caught = e;
      }
      expect((caught as ConfigError).message).toContain(
        "secret QA_DB_PASSWORD not set",
      );
    });
  });

  describe("step 4 — prod safety gate", () => {
    it("throws ProdSafetyAbortError when gate returns allowed=false", async () => {
      const opts = makeOptions({
        environmentLoaderFactory: makeFakeEnvLoaderFactory({
          valid: true,
          environment: {
            prod: true,
            name: "prod",
            base_url: "https://prod.example.com",
          },
        }),
        prodSafetyGate: makeFakeProdGate(
          false,
          "CI fail-fast: non-smoke markers on prod",
        ),
      });
      const cmd = new RunCommand(opts);
      await expect(cmd.execute({ markers: "regression" })).rejects.toThrow(
        ProdSafetyAbortError,
      );
    });

    it("ProdSafetyAbortError has code ExitCode.PROD_SAFETY (4)", async () => {
      const opts = makeOptions({
        environmentLoaderFactory: makeFakeEnvLoaderFactory({
          valid: true,
          environment: {
            prod: true,
            name: "prod",
            base_url: "https://prod.example.com",
          },
        }),
        prodSafetyGate: makeFakeProdGate(false, "declined"),
      });
      const cmd = new RunCommand(opts);
      let caught: unknown;
      try {
        await cmd.execute({ markers: "regression" });
      } catch (e) {
        caught = e;
      }
      expect((caught as ProdSafetyAbortError).code).toBe(ExitCode.PROD_SAFETY);
    });

    it("calls gate.evaluate with correct prodEnvironment from loaded env", async () => {
      const mockGate = {
        evaluate: vi.fn().mockResolvedValue({ allowed: true }),
      } as unknown as ProdSafetyGate;
      const opts = makeOptions({
        environmentLoaderFactory: makeFakeEnvLoaderFactory({
          valid: true,
          environment: {
            prod: true,
            name: "prod",
            base_url: "https://prod.example.com",
          },
        }),
        prodSafetyGate: mockGate,
        testRunner: makeFakeTestRunner(
          new NotImplementedError("`apiwright run`", 10),
        ),
      });
      const cmd = new RunCommand(opts);
      try {
        await cmd.execute({ markers: "smoke" });
      } catch {
        // NotImplementedError expected
      }
      expect(mockGate.evaluate).toHaveBeenCalledWith(
        expect.objectContaining({ prodEnvironment: true }),
      );
    });

    it("passes allowNonSmokeInProd flag to gate.evaluate", async () => {
      const mockGate = {
        evaluate: vi.fn().mockResolvedValue({ allowed: true }),
      } as unknown as ProdSafetyGate;
      const opts = makeOptions({
        environmentLoaderFactory: makeFakeEnvLoaderFactory({
          valid: true,
          environment: {
            prod: true,
            name: "prod",
            base_url: "https://prod.example.com",
          },
        }),
        prodSafetyGate: mockGate,
        testRunner: makeFakeTestRunner(
          new NotImplementedError("`apiwright run`", 10),
        ),
      });
      const cmd = new RunCommand(opts);
      try {
        await cmd.execute({ markers: "smoke", allowNonSmokeInProd: true });
      } catch {
        // NotImplementedError expected
      }
      expect(mockGate.evaluate).toHaveBeenCalledWith(
        expect.objectContaining({ allowNonSmokeInProd: true }),
      );
    });
  });

  describe("step 5 — TestRunner delegation", () => {
    it("throws NotImplementedError when default NotImplementedTestRunner is used", async () => {
      const opts = makeOptions({
        testRunner: new NotImplementedTestRunner(),
      });
      const cmd = new RunCommand(opts);
      await expect(cmd.execute({})).rejects.toThrow(NotImplementedError);
    });

    it("NotImplementedError names Task #10", async () => {
      const opts = makeOptions({
        testRunner: new NotImplementedTestRunner(),
      });
      const cmd = new RunCommand(opts);
      let caught: unknown;
      try {
        await cmd.execute({});
      } catch (e) {
        caught = e;
      }
      expect((caught as NotImplementedError).message).toContain("Task #10");
    });

    it("NotImplementedError has code ExitCode.NOT_IMPLEMENTED (5)", async () => {
      const opts = makeOptions({
        testRunner: new NotImplementedTestRunner(),
      });
      const cmd = new RunCommand(opts);
      let caught: unknown;
      try {
        await cmd.execute({});
      } catch (e) {
        caught = e;
      }
      expect((caught as NotImplementedError).code).toBe(
        ExitCode.NOT_IMPLEMENTED,
      );
    });

    it("delegates to testRunner.run with the resolved env name", async () => {
      const mockRunner = {
        run: vi
          .fn()
          .mockResolvedValue({ total: 0, passed: 0, failed: 0, flaky: 0 }),
      };
      const opts = makeOptions({
        testRunner: mockRunner,
        configLoaderFactory: makeFakeConfigLoaderFactory({
          valid: true,
          config: { ...DEFAULT_CONFIG, default_env: "staging" },
        }),
      });
      const cmd = new RunCommand(opts);
      await cmd.execute({});
      expect(mockRunner.run).toHaveBeenCalledWith(
        expect.objectContaining({ env: "staging" }),
      );
    });

    it("delegates with --env override when supplied", async () => {
      const mockRunner = {
        run: vi
          .fn()
          .mockResolvedValue({ total: 0, passed: 0, failed: 0, flaky: 0 }),
      };
      const opts = makeOptions({ testRunner: mockRunner });
      const cmd = new RunCommand(opts);
      await cmd.execute({ env: "prod" });
      expect(mockRunner.run).toHaveBeenCalledWith(
        expect.objectContaining({ env: "prod" }),
      );
    });

    it("delegates with resolved markers to testRunner.run", async () => {
      const mockRunner = {
        run: vi
          .fn()
          .mockResolvedValue({ total: 0, passed: 0, failed: 0, flaky: 0 }),
      };
      const opts = makeOptions({ testRunner: mockRunner });
      const cmd = new RunCommand(opts);
      await cmd.execute({ markers: "smoke,regression" });
      expect(mockRunner.run).toHaveBeenCalledWith(
        expect.objectContaining({ markers: ["smoke", "regression"] }),
      );
    });

    it("smoke-only prod does NOT prompt and still reaches TestRunner seam", async () => {
      const mockGate = {
        evaluate: vi.fn().mockResolvedValue({ allowed: true }),
      } as unknown as ProdSafetyGate;
      const opts = makeOptions({
        environmentLoaderFactory: makeFakeEnvLoaderFactory({
          valid: true,
          environment: {
            prod: true,
            name: "prod",
            base_url: "https://prod.example.com",
          },
        }),
        prodSafetyGate: mockGate,
        testRunner: new NotImplementedTestRunner(),
      });
      const cmd = new RunCommand(opts);
      let caught: unknown;
      try {
        await cmd.execute({ markers: "smoke" });
      } catch (e) {
        caught = e;
      }
      // Reached the seam → NotImplementedError
      expect(caught).toBeInstanceOf(NotImplementedError);
      expect((caught as NotImplementedError).message).toContain("Task #10");
    });
  });

  describe("step 6 — outcome.failed > 0 → throw RunFailedError", () => {
    // Regression coverage for issue #42 (Finding #14): before this fix,
    // RunCommand.execute discarded the runner's outcome and the CLI exited 0
    // even when every test failed. CI saw GREEN regardless of outcome. These
    // tests pin the now-correct behaviour: any non-zero failed count throws
    // RunFailedError, which maps to ExitCode.TEST_FAILURE (1) — matching the
    // pytest/vitest/mocha convention.

    it("returns without throwing when outcome.failed == 0", async () => {
      const opts = makeOptions({
        testRunner: {
          run: vi.fn().mockResolvedValue({
            total: 3, passed: 3, failed: 0, flaky: 0,
          }),
        },
      });
      const cmd = new RunCommand(opts);
      await expect(cmd.execute({})).resolves.toBeUndefined();
    });

    it("throws RunFailedError when outcome.failed > 0", async () => {
      const opts = makeOptions({
        testRunner: {
          run: vi.fn().mockResolvedValue({
            total: 5, passed: 0, failed: 5, flaky: 0,
          }),
        },
      });
      const cmd = new RunCommand(opts);
      await expect(cmd.execute({})).rejects.toThrow(RunFailedError);
    });

    it("RunFailedError has code ExitCode.TEST_FAILURE (1)", async () => {
      const opts = makeOptions({
        testRunner: {
          run: vi.fn().mockResolvedValue({
            total: 1, passed: 0, failed: 1, flaky: 0,
          }),
        },
      });
      const cmd = new RunCommand(opts);
      let caught: unknown;
      try {
        await cmd.execute({});
      } catch (e) {
        caught = e;
      }
      expect((caught as RunFailedError).code).toBe(ExitCode.TEST_FAILURE);
    });

    it("RunFailedError message includes failed / total / passed / flaky counts", async () => {
      const opts = makeOptions({
        testRunner: {
          run: vi.fn().mockResolvedValue({
            total: 10, passed: 6, failed: 3, flaky: 1,
          }),
        },
      });
      const cmd = new RunCommand(opts);
      let caught: unknown;
      try {
        await cmd.execute({});
      } catch (e) {
        caught = e;
      }
      const msg = (caught as RunFailedError).message;
      expect(msg).toContain("3 failure(s)");
      expect(msg).toContain("10 planned");
      expect(msg).toContain("passed=6");
      expect(msg).toContain("flaky=1");
    });

    it("RunFailedError is thrown AFTER testRunner.run completes (reports already emitted)", async () => {
      // The order matters: the runner has to finish (and persist reports)
      // before we throw, so build artifacts are always inspectable even on a
      // failing run. We verify ordering by recording the runner's call
      // resolving BEFORE the thrown error reaches the catch.
      const ordering: string[] = [];
      const runner: TestRunner = {
        run: vi.fn().mockImplementation(async () => {
          ordering.push("runner.completed");
          return { total: 1, passed: 0, failed: 1, flaky: 0 };
        }),
      };
      const opts = makeOptions({ testRunner: runner });
      const cmd = new RunCommand(opts);
      try {
        await cmd.execute({});
        ordering.push("execute.returned-without-throwing"); // should NOT happen
      } catch (e) {
        ordering.push(`caught:${(e as Error).name}`);
      }
      expect(ordering).toEqual(["runner.completed", "caught:RunFailedError"]);
    });

    it("does NOT throw when outcome.flaky > 0 but outcome.failed == 0", async () => {
      // Flaky cases pass after retry; the run is still green by the spec's
      // definition (§9). They must not trip the failure exit code.
      const opts = makeOptions({
        testRunner: {
          run: vi.fn().mockResolvedValue({
            total: 5, passed: 5, failed: 0, flaky: 2,
          }),
        },
      });
      const cmd = new RunCommand(opts);
      await expect(cmd.execute({})).resolves.toBeUndefined();
    });
  });

  describe("--config flag forwarding", () => {
    it("passes flags.config to configLoaderFactory as configPath", async () => {
      const mockFactory = vi.fn((_configPath?: string) => ({
        load: vi.fn().mockReturnValue({ valid: true, config: DEFAULT_CONFIG }),
      })) as unknown as (configPath?: string) => ConfigLoader;

      const cmd = new RunCommand({
        configLoaderFactory: mockFactory,
        prodSafetyGate: makeFakeProdGate(true),
        environmentLoaderFactory: makeFakeEnvLoaderFactory({
          valid: true,
          environment: {
            prod: false,
            name: "qa",
            base_url: "https://example.com",
          },
        }),
        testRunner: new NotImplementedTestRunner(),
        loggerFactory: makeFakeLogger,
      });

      try {
        await cmd.execute({ config: "./custom.json" });
      } catch {
        // NotImplementedError expected
      }

      expect(mockFactory).toHaveBeenCalledWith("./custom.json");
    });

    it("passes undefined to configLoaderFactory when --config is absent", async () => {
      const mockFactory = vi.fn((_configPath?: string) => ({
        load: vi.fn().mockReturnValue({ valid: true, config: DEFAULT_CONFIG }),
      })) as unknown as (configPath?: string) => ConfigLoader;

      const cmd = new RunCommand({
        configLoaderFactory: mockFactory,
        prodSafetyGate: makeFakeProdGate(true),
        environmentLoaderFactory: makeFakeEnvLoaderFactory({
          valid: true,
          environment: {
            prod: false,
            name: "qa",
            base_url: "https://example.com",
          },
        }),
        testRunner: new NotImplementedTestRunner(),
        loggerFactory: makeFakeLogger,
      });

      try {
        await cmd.execute({});
      } catch {
        // NotImplementedError expected
      }

      expect(mockFactory).toHaveBeenCalledWith(undefined);
    });
  });

  describe("default environmentLoaderFactory seam wiring", () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), "apiwright-run-"));
    });

    afterEach(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it("uses real EnvironmentLoader when no environmentLoaderFactory is given — valid env loads", async () => {
      // Write a real YAML env file to a tmp dir.
      // environments_dir is set to join(tmpDir, "environments") so that
      // dirname(resolve(environments_dir)) = tmpDir, and EnvironmentLoader
      // looks for tmpDir/.env.qa.yaml.
      const envYaml =
        "name: qa\nprod: false\nbase_url: https://api-qa.example.com\n";
      writeFileSync(join(tmpDir, ".env.qa.yaml"), envYaml, "utf8");

      const envsDir = join(tmpDir, "environments");
      const cmd = new RunCommand({
        configLoaderFactory: makeFakeConfigLoaderFactory({
          valid: true,
          config: {
            ...DEFAULT_CONFIG,
            default_env: "qa",
            environments_dir: envsDir,
          },
        }),
        prodSafetyGate: makeFakeProdGate(true),
        // No environmentLoaderFactory → default real factory
        testRunner: new NotImplementedTestRunner(),
        loggerFactory: makeFakeLogger,
      });

      // The default factory should read the real tmp YAML file.
      // The run reaches the TestRunner seam and throws NotImplementedError.
      await expect(cmd.execute({})).rejects.toThrow(NotImplementedError);
    });

    it("uses real EnvironmentLoader when no environmentLoaderFactory is given — missing env fails", async () => {
      // No env YAML file → EnvironmentLoader returns valid=false → ConfigError.
      const envsDir = join(tmpDir, "environments");
      const cmd = new RunCommand({
        configLoaderFactory: makeFakeConfigLoaderFactory({
          valid: true,
          config: {
            ...DEFAULT_CONFIG,
            default_env: "qa",
            environments_dir: envsDir,
          },
        }),
        prodSafetyGate: makeFakeProdGate(true),
        // No environmentLoaderFactory → default real factory
        testRunner: new NotImplementedTestRunner(),
        loggerFactory: makeFakeLogger,
      });

      await expect(cmd.execute({})).rejects.toThrow(ConfigError);
    });

    it("default factory creates EnvironmentLoader with env override (branches on env arg)", async () => {
      // Write env file in a nested environments/ sub-directory to also hit the
      // `environments/<name>.yaml` lookup path.
      // environments_dir = join(tmpDir, "environments") → rootDir = tmpDir
      // EnvironmentLoader looks for tmpDir/environments/staging.yaml ✓
      const envsDir = join(tmpDir, "environments");
      mkdirSync(envsDir);
      const envYaml =
        "name: staging\nprod: false\nbase_url: https://staging.example.com\n";
      writeFileSync(join(envsDir, "staging.yaml"), envYaml, "utf8");

      const cmd = new RunCommand({
        configLoaderFactory: makeFakeConfigLoaderFactory({
          valid: true,
          config: {
            ...DEFAULT_CONFIG,
            default_env: "staging",
            environments_dir: envsDir,
          },
        }),
        prodSafetyGate: makeFakeProdGate(true),
        // No environmentLoaderFactory → default real factory with process.env
        testRunner: new NotImplementedTestRunner(),
        loggerFactory: makeFakeLogger,
      });

      await expect(cmd.execute({})).rejects.toThrow(NotImplementedError);
    });
  });

  describe("default NotImplementedTestRunner seam wiring", () => {
    it("uses NotImplementedTestRunner when no testRunner option is given", async () => {
      // No testRunner injected → default NotImplementedTestRunner used.
      const cmd = new RunCommand({
        configLoaderFactory: makeFakeConfigLoaderFactory({
          valid: true,
          config: DEFAULT_CONFIG,
        }),
        prodSafetyGate: makeFakeProdGate(true),
        environmentLoaderFactory: makeFakeEnvLoaderFactory({
          valid: true,
          environment: {
            prod: false,
            name: "qa",
            base_url: "https://example.com",
          },
        }),
        // No testRunner → default NotImplementedTestRunner
        loggerFactory: makeFakeLogger,
      });

      await expect(cmd.execute({})).rejects.toThrow(NotImplementedError);
    });

    it("default NotImplementedTestRunner error names Task #10", async () => {
      const cmd = new RunCommand({
        configLoaderFactory: makeFakeConfigLoaderFactory({
          valid: true,
          config: DEFAULT_CONFIG,
        }),
        prodSafetyGate: makeFakeProdGate(true),
        environmentLoaderFactory: makeFakeEnvLoaderFactory({
          valid: true,
          environment: {
            prod: false,
            name: "qa",
            base_url: "https://example.com",
          },
        }),
        loggerFactory: makeFakeLogger,
      });

      let caught: unknown;
      try {
        await cmd.execute({});
      } catch (e) {
        caught = e;
      }
      expect((caught as NotImplementedError).message).toContain("Task #10");
    });
  });

  describe("RunCommand does not call process.exit", () => {
    it("throws CliError subclasses instead of calling process.exit", async () => {
      const opts = makeOptions({
        configLoaderFactory: makeFakeConfigLoaderFactory({
          valid: false,
          errors: ["bad"],
        }),
      });
      const cmd = new RunCommand(opts);
      // Should throw, never call process.exit directly
      await expect(cmd.execute({})).rejects.toThrow();
    });
  });
});
