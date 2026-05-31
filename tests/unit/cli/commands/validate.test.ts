import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { ValidateCommand } from "../../../../src/cli/commands/validate.js";
import type { FileSystem } from "../../../../src/cli/fs-seam.js";
import type { Logger } from "../../../../src/cli/logging/logger.js";
import {
  ConfigError,
  ValidationFailedError,
} from "../../../../src/cli/errors.js";
import { SchemaValidator } from "../../../../src/core/schema-validator.js";
import { EnvironmentLoader } from "../../../../src/env/loader.js";

/**
 * Unit tests for ValidateCommand.run().
 *
 * Uses a fake FileSystem seam for isolated unit tests (no disk I/O),
 * and a separate integration-style test group using a real temp directory
 * + real SchemaValidator + real EnvironmentLoader for end-to-end coverage
 * of the validate pipeline.
 *
 * Edge cases: nonexistent dir → ConfigError(USAGE), empty dir → ConfigError(USAGE),
 * only flow/ignored files → ConfigError(USAGE), endpoint JSON parse error,
 * schema violation, mixed pass/fail, env YAML validation, nested subdirs.
 */

// --- Fake/stub helpers ---

/** Creates a fake Logger that captures calls */
function makeFakeLogger(): Logger & {
  calls: { method: string; msg: string }[];
} {
  const calls: { method: string; msg: string }[] = [];
  return {
    level: "info",
    error: vi.fn((msg: string) => calls.push({ method: "error", msg })),
    warn: vi.fn((msg: string) => calls.push({ method: "warn", msg })),
    info: vi.fn((msg: string) => calls.push({ method: "info", msg })),
    debug: vi.fn((msg: string) => calls.push({ method: "debug", msg })),
    calls,
  };
}

/** Creates a fake FileSystem with controllable behavior */
function makeFakeFs(
  opts: {
    dirExists?: boolean;
    walkResult?: string[];
    fileContents?: Record<string, string | Error>;
  } = {},
): FileSystem {
  return {
    fileExists: vi.fn().mockReturnValue(true),
    dirExists: vi.fn().mockReturnValue(opts.dirExists ?? true),
    walk: vi.fn().mockReturnValue(opts.walkResult ?? []),
    readFile: vi.fn((p: string): string => {
      const content = opts.fileContents?.[p];
      if (content instanceof Error) throw content;
      return content ?? "{}";
    }),
  };
}

/** Minimal valid endpoint JSON matching ENDPOINT_META_SCHEMA */
const VALID_ENDPOINT = JSON.stringify({
  id: "users.create",
  name: "Create User",
  method: "POST",
  url: "/api/v1/users",
  request: { body_schema: { type: "object" } },
  response: { expected_status: 201, schema: { type: "object" } },
});

/** Invalid endpoint JSON — missing required 'method' */
const INVALID_ENDPOINT = JSON.stringify({
  id: "users.create",
  name: "Create User",
  url: "/api/v1/users",
  request: {},
  response: { expected_status: 201, schema: {} },
});

/** Minimal valid env YAML content */
const VALID_ENV_YAML = `
name: qa
prod: false
base_url: https://api-qa.example.com
`;

// === Fake FileSystem unit tests ===

describe("ValidateCommand.run() — fake filesystem", () => {
  let logger: ReturnType<typeof makeFakeLogger>;

  beforeEach(() => {
    logger = makeFakeLogger();
  });

  describe("directory checks", () => {
    it("throws ConfigError when the directory does not exist", () => {
      const fs = makeFakeFs({ dirExists: false });
      const cmd = new ValidateCommand({
        fs,
        logger,
        schemaValidator: new SchemaValidator(),
        environmentLoaderFactory: () => new EnvironmentLoader(),
      });
      expect(() => cmd.run("/nonexistent/dir")).toThrow(ConfigError);
    });

    it("throws ConfigError with 'directory not found' when dir absent", () => {
      const fs = makeFakeFs({ dirExists: false });
      const cmd = new ValidateCommand({
        fs,
        logger,
        schemaValidator: new SchemaValidator(),
      });
      let caught: unknown;
      try {
        cmd.run("/missing/dir");
      } catch (e) {
        caught = e;
      }
      expect((caught as ConfigError).message.toLowerCase()).toContain(
        "directory not found",
      );
    });

    it("throws ConfigError when no validatable files found", () => {
      const fs = makeFakeFs({ dirExists: true, walkResult: [] });
      const cmd = new ValidateCommand({
        fs,
        logger,
        schemaValidator: new SchemaValidator(),
      });
      expect(() => cmd.run("/empty/dir")).toThrow(ConfigError);
    });

    it("throws ConfigError with 'no validatable files' when only ignored files present", () => {
      const fs = makeFakeFs({
        dirExists: true,
        walkResult: [
          "/dir/README.md",
          "/dir/test.flow.json",
          "/dir/fixture.json",
        ],
      });
      const cmd = new ValidateCommand({
        fs,
        logger,
        schemaValidator: new SchemaValidator(),
      });
      let caught: unknown;
      try {
        cmd.run("/dir");
      } catch (e) {
        caught = e;
      }
      expect((caught as ConfigError).message.toLowerCase()).toContain(
        "no validatable files",
      );
    });

    it("throws ConfigError for a path that is a file (not a directory)", () => {
      const fs = makeFakeFs({ dirExists: false });
      const cmd = new ValidateCommand({
        fs,
        logger,
        schemaValidator: new SchemaValidator(),
      });
      expect(() => cmd.run("/dir/somefile.json")).toThrow(ConfigError);
    });

    it("issue #57: throws ConfigError when env files present but zero endpoint files", () => {
      const fs = makeFakeFs({
        dirExists: true,
        walkResult: ["/dir/environments/qa.yaml"],
      });
      const cmd = new ValidateCommand({
        fs,
        logger,
        schemaValidator: new SchemaValidator(),
        environmentLoaderFactory: () => new EnvironmentLoader(),
      });
      expect(() => cmd.run("/dir")).toThrow(ConfigError);
    });

    it("issue #57: empty-endpoints error names the missing file type AND counts env files (actionable)", () => {
      const fs = makeFakeFs({
        dirExists: true,
        walkResult: [
          "/dir/environments/qa.yaml",
          "/dir/environments/prod.yaml",
        ],
      });
      const cmd = new ValidateCommand({
        fs,
        logger,
        schemaValidator: new SchemaValidator(),
        environmentLoaderFactory: () => new EnvironmentLoader(),
      });
      let caught: unknown;
      try {
        cmd.run("/dir");
      } catch (e) {
        caught = e;
      }
      const msg = (caught as ConfigError).message;
      // Must name the missing file pattern so user knows what to add
      expect(msg).toContain("*.endpoint.json");
      // Must count env files so user knows the env side WAS found
      expect(msg).toContain("2 environment file(s)");
      // Must hint at the likely cause (glob/tests_dir mistake)
      expect(msg.toLowerCase()).toContain("tests_dir");
    });

    it("issue #65: rejects an endpoint whose assertions array has invalid syntax", () => {
      const badAssertionEndpoint = JSON.stringify({
        id: "bad",
        name: "Bad",
        method: "GET",
        url: "/",
        request: {},
        response: { expected_status: 200 },
        assertions: ["this is not a valid assertion string at all"],
      });
      const fs = makeFakeFs({
        dirExists: true,
        walkResult: ["/dir/bad.endpoint.json"],
        fileContents: { "/dir/bad.endpoint.json": badAssertionEndpoint },
      });
      const cmd = new ValidateCommand({
        fs,
        logger,
        schemaValidator: new SchemaValidator(),
        environmentLoaderFactory: () => new EnvironmentLoader(),
      });
      const summary = cmd.run("/dir");
      expect(summary.failedCount).toBe(1);
      const failed = summary.results.find((r) => !r.passed);
      expect(failed).toBeDefined();
      // The error must name the assertion index AND include the parser's
      // human-readable explanation.
      expect(failed?.errors.some((e) => e.includes("assertion #1"))).toBe(true);
      expect(
        failed?.errors.some((e) =>
          e.toLowerCase().includes("unknown root") ||
          e.toLowerCase().includes("unknown operator"),
        ),
      ).toBe(true);
    });

    it("issue #65: accepts an endpoint whose assertions array parses cleanly", () => {
      const goodAssertionEndpoint = JSON.stringify({
        id: "ok",
        name: "OK",
        method: "GET",
        url: "/",
        request: {},
        response: { expected_status: 200 },
        assertions: [
          "response.status equals 200",
          "response.body.id is_uuid_v4",
        ],
      });
      const fs = makeFakeFs({
        dirExists: true,
        walkResult: ["/dir/ok.endpoint.json"],
        fileContents: { "/dir/ok.endpoint.json": goodAssertionEndpoint },
      });
      const cmd = new ValidateCommand({
        fs,
        logger,
        schemaValidator: new SchemaValidator(),
        environmentLoaderFactory: () => new EnvironmentLoader(),
      });
      const summary = cmd.run("/dir");
      expect(summary.failedCount).toBe(0);
      expect(summary.passedCount).toBe(1);
    });

    it("issue #69: rejects an endpoint referencing an auth_strategy not declared in any env YAML", () => {
      // Inject a fake env loader factory whose `load` returns an env
      // with only "real" declared. The fake fs doesn't drive the real
      // env loader (which reads from disk), so we mock the loader.
      const endpoint = JSON.stringify({
        id: "x",
        name: "X",
        method: "GET",
        url: "/",
        auth_strategy: "bogus_strategy",
        request: {},
        response: { expected_status: 200 },
      });
      const fs = makeFakeFs({
        dirExists: true,
        walkResult: ["/dir/x.endpoint.json", "/dir/qa.yaml"],
        fileContents: { "/dir/x.endpoint.json": endpoint, "/dir/qa.yaml": "" },
      });
      const fakeFactory = vi.fn(() => ({
        load: vi.fn().mockReturnValue({
          valid: true,
          environment: {
            name: "qa",
            base_url: "https://example.com",
            prod: false,
            auth_strategies: {
              real: { type: "static_token", token: "x", header_name: "Authorization" },
            },
          },
          secretRegistry: new Map(),
        }),
      })) as unknown as (rootDir: string) => EnvironmentLoader;

      const cmd = new ValidateCommand({
        fs,
        logger,
        schemaValidator: new SchemaValidator(),
        environmentLoaderFactory: fakeFactory,
      });
      const summary = cmd.run("/dir");
      expect(summary.failedCount).toBe(1);
      const failed = summary.results.find(
        (r) => r.kind === "endpoint" && !r.passed,
      );
      expect(failed?.errors[0]).toMatch(/auth_strategy 'bogus_strategy'/);
      expect(failed?.errors[0]).toContain("real");
    });

    it("issue #69: passes when auth_strategy matches a name declared in any env", () => {
      const endpoint = JSON.stringify({
        id: "x",
        name: "X",
        method: "GET",
        url: "/",
        auth_strategy: "real",
        request: {},
        response: { expected_status: 200 },
      });
      const fs = makeFakeFs({
        dirExists: true,
        walkResult: ["/dir/x.endpoint.json", "/dir/qa.yaml"],
        fileContents: { "/dir/x.endpoint.json": endpoint, "/dir/qa.yaml": "" },
      });
      const fakeFactory = vi.fn(() => ({
        load: vi.fn().mockReturnValue({
          valid: true,
          environment: {
            name: "qa",
            base_url: "https://example.com",
            prod: false,
            auth_strategies: {
              real: { type: "static_token", token: "x", header_name: "Authorization" },
            },
          },
          secretRegistry: new Map(),
        }),
      })) as unknown as (rootDir: string) => EnvironmentLoader;
      const cmd = new ValidateCommand({
        fs,
        logger,
        schemaValidator: new SchemaValidator(),
        environmentLoaderFactory: fakeFactory,
      });
      const summary = cmd.run("/dir");
      expect(summary.failedCount).toBe(0);
    });

    it("issue #69: no auth_strategy declared on endpoint → no cross-check, passes", () => {
      const endpoint = JSON.stringify({
        id: "x",
        name: "X",
        method: "GET",
        url: "/",
        request: {},
        response: { expected_status: 200 },
      });
      const fs = makeFakeFs({
        dirExists: true,
        walkResult: ["/dir/x.endpoint.json", "/dir/qa.yaml"],
        fileContents: { "/dir/x.endpoint.json": endpoint, "/dir/qa.yaml": "" },
      });
      const fakeFactory = vi.fn(() => ({
        load: vi.fn().mockReturnValue({
          valid: true,
          environment: {
            name: "qa",
            base_url: "https://example.com",
            prod: false,
          },
          secretRegistry: new Map(),
        }),
      })) as unknown as (rootDir: string) => EnvironmentLoader;
      const cmd = new ValidateCommand({
        fs,
        logger,
        schemaValidator: new SchemaValidator(),
        environmentLoaderFactory: fakeFactory,
      });
      const summary = cmd.run("/dir");
      expect(summary.failedCount).toBe(0);
    });

    it("issue #71: rejects an endpoint URL referencing an env key not declared in any env YAML", () => {
      const endpoint = JSON.stringify({
        id: "x",
        name: "X",
        method: "GET",
        url: "${env.base_url}/${env.SOMETHING_MISSING}",
        request: {},
        response: { expected_status: 200 },
      });
      const fs = makeFakeFs({
        dirExists: true,
        walkResult: ["/dir/x.endpoint.json", "/dir/qa.yaml"],
        fileContents: { "/dir/x.endpoint.json": endpoint, "/dir/qa.yaml": "" },
      });
      const fakeFactory = vi.fn(() => ({
        load: vi.fn().mockReturnValue({
          valid: true,
          environment: {
            name: "qa",
            base_url: "https://example.com",
            prod: false,
          },
          secretRegistry: new Map(),
        }),
      })) as unknown as (rootDir: string) => EnvironmentLoader;
      const cmd = new ValidateCommand({
        fs,
        logger,
        schemaValidator: new SchemaValidator(),
        environmentLoaderFactory: fakeFactory,
      });
      const summary = cmd.run("/dir");
      expect(summary.failedCount).toBe(1);
      const failed = summary.results.find(
        (r) => r.kind === "endpoint" && !r.passed,
      );
      expect(failed?.errors[0]).toMatch(/\$\{env\.SOMETHING_MISSING\}/);
      // Must list known keys so the user can spot the typo.
      expect(failed?.errors[0]).toContain("base_url");
    });

    it("issue #71: passes when every ${env.X} reference resolves", () => {
      const endpoint = JSON.stringify({
        id: "x",
        name: "X",
        method: "GET",
        url: "${env.base_url}/users",
        request: {
          headers: { "X-Tenant": "${env.tenant_id}" },
        },
        response: { expected_status: 200 },
      });
      const fs = makeFakeFs({
        dirExists: true,
        walkResult: ["/dir/x.endpoint.json", "/dir/qa.yaml"],
        fileContents: { "/dir/x.endpoint.json": endpoint, "/dir/qa.yaml": "" },
      });
      const fakeFactory = vi.fn(() => ({
        load: vi.fn().mockReturnValue({
          valid: true,
          environment: {
            name: "qa",
            base_url: "https://example.com",
            tenant_id: "acme",
            prod: false,
          },
          secretRegistry: new Map(),
        }),
      })) as unknown as (rootDir: string) => EnvironmentLoader;
      const cmd = new ValidateCommand({
        fs,
        logger,
        schemaValidator: new SchemaValidator(),
        environmentLoaderFactory: fakeFactory,
      });
      const summary = cmd.run("/dir");
      expect(summary.failedCount).toBe(0);
    });

    it("issue #71: nested ${env.X.Y} validates the TOP-level key only (v1.0 scope)", () => {
      // url uses ${env.databases.primary.host} — top-level key is
      // "databases" which IS declared. Don't false-positive on nested
      // segments (those are validated at runtime by template-resolver).
      const endpoint = JSON.stringify({
        id: "x",
        name: "X",
        method: "GET",
        url: "${env.databases.primary.host}/path",
        request: {},
        response: { expected_status: 200 },
      });
      const fs = makeFakeFs({
        dirExists: true,
        walkResult: ["/dir/x.endpoint.json", "/dir/qa.yaml"],
        fileContents: { "/dir/x.endpoint.json": endpoint, "/dir/qa.yaml": "" },
      });
      const fakeFactory = vi.fn(() => ({
        load: vi.fn().mockReturnValue({
          valid: true,
          environment: {
            name: "qa",
            databases: { primary: { host: "db.example.com" } },
            prod: false,
          },
          secretRegistry: new Map(),
        }),
      })) as unknown as (rootDir: string) => EnvironmentLoader;
      const cmd = new ValidateCommand({
        fs,
        logger,
        schemaValidator: new SchemaValidator(),
        environmentLoaderFactory: fakeFactory,
      });
      const summary = cmd.run("/dir");
      expect(summary.failedCount).toBe(0);
    });

    it("issue #65: non-string assertion entry (e.g. number) is rejected with type-of context", () => {
      const wrongTypeAssertionEndpoint = JSON.stringify({
        id: "wt",
        name: "WT",
        method: "GET",
        url: "/",
        request: {},
        response: { expected_status: 200 },
        assertions: ["response.status equals 200", 42],
      });
      const fs = makeFakeFs({
        dirExists: true,
        walkResult: ["/dir/wt.endpoint.json"],
        fileContents: { "/dir/wt.endpoint.json": wrongTypeAssertionEndpoint },
      });
      const cmd = new ValidateCommand({
        fs,
        logger,
        schemaValidator: new SchemaValidator(),
        environmentLoaderFactory: () => new EnvironmentLoader(),
      });
      const summary = cmd.run("/dir");
      // Schema validator rejects non-string assertion entries first, so
      // the file fails — either via schema error or via parseAssertions
      // type guard. Either way: it must NOT pass.
      expect(summary.failedCount).toBe(1);
    });

    it("issue #57: empty-endpoints case is distinct from truly-empty (different message)", () => {
      // truly empty
      const emptyFs = makeFakeFs({ dirExists: true, walkResult: [] });
      const emptyCmd = new ValidateCommand({
        fs: emptyFs,
        logger,
        schemaValidator: new SchemaValidator(),
      });
      let emptyMsg: string | undefined;
      try {
        emptyCmd.run("/empty");
      } catch (e) {
        emptyMsg = (e as ConfigError).message;
      }
      expect(emptyMsg).toContain("no validatable files");

      // env files but no endpoints
      const envOnlyFs = makeFakeFs({
        dirExists: true,
        walkResult: ["/dir/environments/qa.yaml"],
      });
      const envOnlyCmd = new ValidateCommand({
        fs: envOnlyFs,
        logger,
        schemaValidator: new SchemaValidator(),
        environmentLoaderFactory: () => new EnvironmentLoader(),
      });
      let envOnlyMsg: string | undefined;
      try {
        envOnlyCmd.run("/dir");
      } catch (e) {
        envOnlyMsg = (e as ConfigError).message;
      }
      expect(envOnlyMsg).toContain("no endpoint files");
      // The two messages must NOT be identical — a user reading the
      // first should not be confused about which scenario they hit.
      expect(envOnlyMsg).not.toBe(emptyMsg);
    });
  });

  describe("endpoint file validation — valid", () => {
    it("returns a summary with passedCount=1, failedCount=0 for one valid endpoint", () => {
      const fs = makeFakeFs({
        walkResult: ["/dir/users.create.endpoint.json"],
        fileContents: { "/dir/users.create.endpoint.json": VALID_ENDPOINT },
      });
      const cmd = new ValidateCommand({
        fs,
        logger,
        schemaValidator: new SchemaValidator(),
      });
      const summary = cmd.run("/dir");
      expect(summary.passedCount).toBe(1);
      expect(summary.failedCount).toBe(0);
    });

    it("marks result as passed for a valid endpoint file", () => {
      const fs = makeFakeFs({
        walkResult: ["/dir/ep.endpoint.json"],
        fileContents: { "/dir/ep.endpoint.json": VALID_ENDPOINT },
      });
      const cmd = new ValidateCommand({
        fs,
        logger,
        schemaValidator: new SchemaValidator(),
      });
      const summary = cmd.run("/dir");
      expect(summary.results[0]?.passed).toBe(true);
      expect(summary.results[0]?.kind).toBe("endpoint");
      expect(summary.results[0]?.errors).toHaveLength(0);
    });

    it("returns correct counts for multiple valid endpoints", () => {
      const fs = makeFakeFs({
        walkResult: [
          "/dir/a.endpoint.json",
          "/dir/b.endpoint.json",
          "/dir/c.endpoint.json",
        ],
        fileContents: {
          "/dir/a.endpoint.json": VALID_ENDPOINT,
          "/dir/b.endpoint.json": VALID_ENDPOINT,
          "/dir/c.endpoint.json": VALID_ENDPOINT,
        },
      });
      const cmd = new ValidateCommand({
        fs,
        logger,
        schemaValidator: new SchemaValidator(),
      });
      const summary = cmd.run("/dir");
      expect(summary.passedCount).toBe(3);
      expect(summary.failedCount).toBe(0);
    });
  });

  describe("endpoint file validation — invalid schema", () => {
    it("returns failedCount=1 for one schema-invalid endpoint", () => {
      const fs = makeFakeFs({
        walkResult: ["/dir/bad.endpoint.json"],
        fileContents: { "/dir/bad.endpoint.json": INVALID_ENDPOINT },
      });
      const cmd = new ValidateCommand({
        fs,
        logger,
        schemaValidator: new SchemaValidator(),
      });
      const summary = cmd.run("/dir");
      expect(summary.failedCount).toBe(1);
      expect(summary.passedCount).toBe(0);
    });

    it("marks the result as failed with schema error messages", () => {
      const fs = makeFakeFs({
        walkResult: ["/dir/bad.endpoint.json"],
        fileContents: { "/dir/bad.endpoint.json": INVALID_ENDPOINT },
      });
      const cmd = new ValidateCommand({
        fs,
        logger,
        schemaValidator: new SchemaValidator(),
      });
      const summary = cmd.run("/dir");
      const result = summary.results[0]!;
      expect(result.passed).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it("does not throw on schema-invalid endpoint (returns failed result)", () => {
      const fs = makeFakeFs({
        walkResult: ["/dir/bad.endpoint.json"],
        fileContents: { "/dir/bad.endpoint.json": INVALID_ENDPOINT },
      });
      const cmd = new ValidateCommand({
        fs,
        logger,
        schemaValidator: new SchemaValidator(),
      });
      expect(() => cmd.run("/dir")).not.toThrow();
    });
  });

  describe("endpoint file validation — malformed JSON", () => {
    it("returns failedCount=1 for a malformed JSON endpoint file", () => {
      const fs = makeFakeFs({
        walkResult: ["/dir/bad.endpoint.json"],
        fileContents: { "/dir/bad.endpoint.json": "{ invalid" },
      });
      const cmd = new ValidateCommand({
        fs,
        logger,
        schemaValidator: new SchemaValidator(),
      });
      const summary = cmd.run("/dir");
      expect(summary.failedCount).toBe(1);
    });

    it("reports the parse error without throwing (not a JSON crash)", () => {
      const fs = makeFakeFs({
        walkResult: ["/dir/bad.endpoint.json"],
        fileContents: { "/dir/bad.endpoint.json": "not json" },
      });
      const cmd = new ValidateCommand({
        fs,
        logger,
        schemaValidator: new SchemaValidator(),
      });
      expect(() => cmd.run("/dir")).not.toThrow();
    });

    it("includes 'not valid JSON' in the error message for parse failure", () => {
      const fs = makeFakeFs({
        walkResult: ["/dir/bad.endpoint.json"],
        fileContents: { "/dir/bad.endpoint.json": "{{{{ broken" },
      });
      const cmd = new ValidateCommand({
        fs,
        logger,
        schemaValidator: new SchemaValidator(),
      });
      const summary = cmd.run("/dir");
      expect(summary.results[0]?.errors.join(" ").toLowerCase()).toContain(
        "not valid json",
      );
    });
  });

  describe("mixed pass/fail", () => {
    it("counts correctly for mixed valid/invalid endpoints", () => {
      const fs = makeFakeFs({
        walkResult: ["/dir/valid.endpoint.json", "/dir/invalid.endpoint.json"],
        fileContents: {
          "/dir/valid.endpoint.json": VALID_ENDPOINT,
          "/dir/invalid.endpoint.json": INVALID_ENDPOINT,
        },
      });
      const cmd = new ValidateCommand({
        fs,
        logger,
        schemaValidator: new SchemaValidator(),
      });
      const summary = cmd.run("/dir");
      expect(summary.passedCount).toBe(1);
      expect(summary.failedCount).toBe(1);
      expect(summary.results).toHaveLength(2);
    });

    it("total results = passedCount + failedCount", () => {
      const fs = makeFakeFs({
        walkResult: [
          "/dir/a.endpoint.json",
          "/dir/b.endpoint.json",
          "/dir/c.endpoint.json",
        ],
        fileContents: {
          "/dir/a.endpoint.json": VALID_ENDPOINT,
          "/dir/b.endpoint.json": "invalid json",
          "/dir/c.endpoint.json": INVALID_ENDPOINT,
        },
      });
      const cmd = new ValidateCommand({
        fs,
        logger,
        schemaValidator: new SchemaValidator(),
      });
      const summary = cmd.run("/dir");
      expect(summary.results.length).toBe(
        summary.passedCount + summary.failedCount,
      );
    });
  });

  describe("environment YAML validation via injected factory", () => {
    it("validates env YAML files and reports pass via factory-injected loader", () => {
      // Issue #57 requires at least one endpoint file; include a valid
      // placeholder so this env-isolation test focuses on env-loader behavior.
      const fs = makeFakeFs({
        walkResult: ["/dir/qa.yaml", "/dir/placeholder.endpoint.json"],
        fileContents: {
          "/dir/qa.yaml": VALID_ENV_YAML,
          "/dir/placeholder.endpoint.json": VALID_ENDPOINT,
        },
      });
      const fakeLoaderFactory = vi.fn((_rootDir: string) => ({
        load: vi.fn().mockReturnValue({
          valid: true,
          environment: {
            name: "qa",
            prod: false,
            base_url: "https://example.com",
          },
          secretRegistry: new Map(),
          errors: undefined,
        }),
      })) as unknown as (rootDir: string) => EnvironmentLoader;

      const cmd = new ValidateCommand({
        fs,
        logger,
        schemaValidator: new SchemaValidator(),
        environmentLoaderFactory: fakeLoaderFactory,
      });
      const summary = cmd.run("/dir");
      // 1 endpoint passed + 1 env passed = 2 passed
      expect(summary.passedCount).toBe(2);
      expect(summary.failedCount).toBe(0);
      const envResult = summary.results.find((r) => r.kind === "environment");
      expect(envResult).toBeDefined();
    });

    it("reports env YAML failure via factory-injected loader", () => {
      const fs = makeFakeFs({
        walkResult: ["/dir/qa.yaml", "/dir/placeholder.endpoint.json"],
        fileContents: {
          "/dir/qa.yaml": VALID_ENV_YAML,
          "/dir/placeholder.endpoint.json": VALID_ENDPOINT,
        },
      });
      const fakeLoaderFactory = vi.fn((_rootDir: string) => ({
        load: vi.fn().mockReturnValue({
          valid: false,
          errors: ["prod must be a boolean"],
          secretRegistry: new Map(),
        }),
      })) as unknown as (rootDir: string) => EnvironmentLoader;

      const cmd = new ValidateCommand({
        fs,
        logger,
        schemaValidator: new SchemaValidator(),
        environmentLoaderFactory: fakeLoaderFactory,
      });
      const summary = cmd.run("/dir");
      expect(summary.failedCount).toBe(1);
      const envResult = summary.results.find((r) => r.kind === "environment");
      expect(envResult?.errors).toContain("prod must be a boolean");
    });

    it("does not throw for env YAML that fails validation", () => {
      const fs = makeFakeFs({
        walkResult: ["/dir/bad.yaml", "/dir/placeholder.endpoint.json"],
        fileContents: {
          "/dir/bad.yaml": "x: y",
          "/dir/placeholder.endpoint.json": VALID_ENDPOINT,
        },
      });
      const fakeLoaderFactory = vi.fn(() => ({
        load: vi.fn().mockReturnValue({
          valid: false,
          errors: ["error"],
          secretRegistry: new Map(),
        }),
      })) as unknown as (rootDir: string) => EnvironmentLoader;

      const cmd = new ValidateCommand({
        fs,
        logger,
        schemaValidator: new SchemaValidator(),
        environmentLoaderFactory: fakeLoaderFactory,
      });
      expect(() => cmd.run("/dir")).not.toThrow();
    });
  });

  describe("ignored files", () => {
    it("ignores .flow.json files and does not count them", () => {
      const fs = makeFakeFs({
        walkResult: ["/dir/valid.endpoint.json", "/dir/flow.flow.json"],
        fileContents: {
          "/dir/valid.endpoint.json": VALID_ENDPOINT,
          "/dir/flow.flow.json": "{}",
        },
      });
      const cmd = new ValidateCommand({
        fs,
        logger,
        schemaValidator: new SchemaValidator(),
      });
      const summary = cmd.run("/dir");
      // flow file should be ignored; only endpoint counted
      expect(summary.results.length).toBe(1);
    });

    it("ignores README.md files", () => {
      const fs = makeFakeFs({
        walkResult: ["/dir/README.md", "/dir/ep.endpoint.json"],
        fileContents: {
          "/dir/README.md": "# docs",
          "/dir/ep.endpoint.json": VALID_ENDPOINT,
        },
      });
      const cmd = new ValidateCommand({
        fs,
        logger,
        schemaValidator: new SchemaValidator(),
      });
      const summary = cmd.run("/dir");
      expect(summary.results.length).toBe(1);
    });
  });

  describe("logger output", () => {
    it("logs a summary line containing counts after validation", () => {
      const fs = makeFakeFs({
        walkResult: ["/dir/ep.endpoint.json"],
        fileContents: { "/dir/ep.endpoint.json": VALID_ENDPOINT },
      });
      const cmd = new ValidateCommand({
        fs,
        logger,
        schemaValidator: new SchemaValidator(),
      });
      cmd.run("/dir");
      const allMessages = logger.calls
        .map((c) => c.msg)
        .join(" ")
        .toLowerCase();
      expect(allMessages).toMatch(/validated|passed|failed/);
    });

    it("logs error lines for failed files", () => {
      const fs = makeFakeFs({
        walkResult: ["/dir/bad.endpoint.json"],
        fileContents: { "/dir/bad.endpoint.json": INVALID_ENDPOINT },
      });
      const cmd = new ValidateCommand({
        fs,
        logger,
        schemaValidator: new SchemaValidator(),
      });
      cmd.run("/dir");
      const errorCalls = logger.calls.filter((c) => c.method === "error");
      expect(errorCalls.length).toBeGreaterThan(0);
    });

    it("logs info lines for passed files", () => {
      const fs = makeFakeFs({
        walkResult: ["/dir/valid.endpoint.json"],
        fileContents: { "/dir/valid.endpoint.json": VALID_ENDPOINT },
      });
      const cmd = new ValidateCommand({
        fs,
        logger,
        schemaValidator: new SchemaValidator(),
      });
      cmd.run("/dir");
      const infoCalls = logger.calls.filter((c) => c.method === "info");
      expect(infoCalls.length).toBeGreaterThan(0);
    });

    it("issue #56: summary line on full-success uses 'OK' suffix and splits endpoint/env counts", () => {
      const fs = makeFakeFs({
        walkResult: ["/dir/valid.endpoint.json"],
        fileContents: { "/dir/valid.endpoint.json": VALID_ENDPOINT },
      });
      const cmd = new ValidateCommand({
        fs,
        logger,
        schemaValidator: new SchemaValidator(),
      });
      cmd.run("/dir");
      const summary = logger.calls
        .filter((c) => c.method === "info")
        .map((c) => c.msg)
        .find((m) => m.includes("Validated"));
      expect(summary).toBeDefined();
      expect(summary).toContain("1 endpoint file(s)");
      expect(summary).toContain("0 environment file(s)");
      expect(summary).toContain("— OK");
      // The old terse format "validated N files: P passed, F failed" is gone.
      expect(summary).not.toContain("passed,");
    });

    it("issue #56: summary line on partial-failure shows passed/failed counts (no 'OK')", () => {
      const fs = makeFakeFs({
        walkResult: ["/dir/ok.endpoint.json", "/dir/bad.endpoint.json"],
        fileContents: {
          "/dir/ok.endpoint.json": VALID_ENDPOINT,
          "/dir/bad.endpoint.json": INVALID_ENDPOINT,
        },
      });
      const cmd = new ValidateCommand({
        fs,
        logger,
        schemaValidator: new SchemaValidator(),
      });
      cmd.run("/dir");
      const summary = logger.calls
        .filter((c) => c.method === "info")
        .map((c) => c.msg)
        .find((m) => m.includes("Validated"));
      expect(summary).toBeDefined();
      expect(summary).toContain("2 endpoint file(s)");
      expect(summary).toContain("1 passed, 1 failed");
      expect(summary).not.toContain("— OK");
    });
  });

  describe("FileValidationResult shape", () => {
    it("result contains the file path", () => {
      const fs = makeFakeFs({
        walkResult: ["/dir/ep.endpoint.json"],
        fileContents: { "/dir/ep.endpoint.json": VALID_ENDPOINT },
      });
      const cmd = new ValidateCommand({
        fs,
        logger,
        schemaValidator: new SchemaValidator(),
      });
      const summary = cmd.run("/dir");
      expect(summary.results[0]?.path).toContain("ep.endpoint.json");
    });

    it("result.kind is 'endpoint' for .endpoint.json files", () => {
      const fs = makeFakeFs({
        walkResult: ["/dir/ep.endpoint.json"],
        fileContents: { "/dir/ep.endpoint.json": VALID_ENDPOINT },
      });
      const cmd = new ValidateCommand({
        fs,
        logger,
        schemaValidator: new SchemaValidator(),
      });
      const summary = cmd.run("/dir");
      expect(summary.results[0]?.kind).toBe("endpoint");
    });

    it("result.errors is empty for a passing file", () => {
      const fs = makeFakeFs({
        walkResult: ["/dir/ep.endpoint.json"],
        fileContents: { "/dir/ep.endpoint.json": VALID_ENDPOINT },
      });
      const cmd = new ValidateCommand({
        fs,
        logger,
        schemaValidator: new SchemaValidator(),
      });
      const summary = cmd.run("/dir");
      expect(summary.results[0]?.errors).toHaveLength(0);
    });
  });
});

// === Integration-style tests with real temp disk + real validators ===

describe("ValidateCommand.run() — real filesystem + real validators (integration)", () => {
  let dir: string;
  let logger: ReturnType<typeof makeFakeLogger>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "apiwright-validate-"));
    logger = makeFakeLogger();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("validates a real valid endpoint JSON file and returns passedCount=1", () => {
    writeFileSync(join(dir, "create.endpoint.json"), VALID_ENDPOINT, "utf8");
    const cmd = new ValidateCommand({ logger });
    const summary = cmd.run(dir);
    expect(summary.passedCount).toBe(1);
    expect(summary.failedCount).toBe(0);
  });

  it("reports a schema-invalid endpoint JSON file with failedCount=1", () => {
    writeFileSync(join(dir, "bad.endpoint.json"), INVALID_ENDPOINT, "utf8");
    const cmd = new ValidateCommand({ logger });
    const summary = cmd.run(dir);
    expect(summary.failedCount).toBe(1);
    expect(summary.results[0]?.errors.length).toBeGreaterThan(0);
  });

  it("reports a malformed JSON endpoint file as failed without throwing", () => {
    writeFileSync(join(dir, "malformed.endpoint.json"), "not json", "utf8");
    const cmd = new ValidateCommand({ logger });
    expect(() => cmd.run(dir)).not.toThrow();
    const summary = cmd.run(dir);
    expect(summary.failedCount).toBe(1);
  });

  it("throws ConfigError for a directory that doesn't exist", () => {
    const cmd = new ValidateCommand({ logger });
    expect(() => cmd.run(join(dir, "does-not-exist"))).toThrow(ConfigError);
  });

  it("throws ConfigError for an empty directory (no validatable files)", () => {
    const cmd = new ValidateCommand({ logger });
    expect(() => cmd.run(dir)).toThrow(ConfigError);
  });

  it("validates endpoint files in nested subdirectories", () => {
    const sub = join(dir, "user-service");
    mkdirSync(sub);
    writeFileSync(join(sub, "create.endpoint.json"), VALID_ENDPOINT, "utf8");
    const cmd = new ValidateCommand({ logger });
    const summary = cmd.run(dir);
    expect(summary.passedCount).toBe(1);
  });

  it("validates a real env YAML file via EnvironmentLoader", () => {
    const envDir = join(dir, "environments");
    mkdirSync(envDir);
    writeFileSync(join(dir, "qa.yaml"), VALID_ENV_YAML, "utf8");
    // Also need at least one validatable file to avoid ConfigError
    const cmd = new ValidateCommand({ logger });
    // With just yaml files: depends on whether they qualify as "environment" files
    // Place an endpoint too so we don't hit "no validatable files"
    writeFileSync(join(dir, "ep.endpoint.json"), VALID_ENDPOINT, "utf8");
    const summary = cmd.run(dir);
    expect(summary.passedCount).toBeGreaterThanOrEqual(1);
  });

  it("validates a committed-form env file (environments/<name>.yaml) and the env result itself passes", () => {
    // Regression for Gap 2: previously #validateEnvFile passed dirname(file)
    // as rootDir, so the loader looked for <dir>/environments/environments/
    // qa.yaml and the env file was always spuriously "not found".
    // Issue #57: include a placeholder endpoint so the empty-endpoints
    // guard doesn't fire (this test isolates env-loader behavior).
    const envDir = join(dir, "environments");
    mkdirSync(envDir);
    writeFileSync(join(envDir, "qa.yaml"), VALID_ENV_YAML, "utf8");
    writeFileSync(join(dir, "placeholder.endpoint.json"), VALID_ENDPOINT, "utf8");
    const cmd = new ValidateCommand({ logger });
    const summary = cmd.run(dir);
    const envResult = summary.results.find((r) => r.kind === "environment");
    expect(envResult).toBeDefined();
    expect(envResult?.passed).toBe(true);
    expect(envResult?.errors).toEqual([]);
    expect(summary.failedCount).toBe(0);
  });

  it("validates a dotfile-form env file (.env.<name>.yaml) and the env result itself passes", () => {
    writeFileSync(join(dir, ".env.qa.yaml"), VALID_ENV_YAML, "utf8");
    writeFileSync(join(dir, "placeholder.endpoint.json"), VALID_ENDPOINT, "utf8");
    const cmd = new ValidateCommand({ logger });
    const summary = cmd.run(dir);
    const envResult = summary.results.find((r) => r.kind === "environment");
    expect(envResult).toBeDefined();
    expect(envResult?.passed).toBe(true);
    expect(summary.failedCount).toBe(0);
  });

  it("mixed valid and invalid produces correct summary counts", () => {
    writeFileSync(join(dir, "valid.endpoint.json"), VALID_ENDPOINT, "utf8");
    writeFileSync(join(dir, "invalid.endpoint.json"), INVALID_ENDPOINT, "utf8");
    const cmd = new ValidateCommand({ logger });
    const summary = cmd.run(dir);
    expect(summary.passedCount).toBe(1);
    expect(summary.failedCount).toBe(1);
  });

  it("summary has validated count = passed + failed", () => {
    writeFileSync(join(dir, "v1.endpoint.json"), VALID_ENDPOINT, "utf8");
    writeFileSync(join(dir, "v2.endpoint.json"), VALID_ENDPOINT, "utf8");
    writeFileSync(join(dir, "bad.endpoint.json"), INVALID_ENDPOINT, "utf8");
    const cmd = new ValidateCommand({ logger });
    const summary = cmd.run(dir);
    expect(summary.results.length).toBe(
      summary.passedCount + summary.failedCount,
    );
  });
});

describe("ValidateCommand — endpoint file-read catch branch", () => {
  it("returns passed=false with 'cannot read' error when readFile throws for an existing path", () => {
    // Inject an fs where fileExists/dirExists say the file is there but
    // readFile throws — exercises the catch branch in #validateEndpointFile.
    const readError = new Error("permission denied");
    const fs = makeFakeFs({
      dirExists: true,
      walkResult: ["/dir/ep.endpoint.json"],
      fileContents: { "/dir/ep.endpoint.json": readError },
    });
    const logger = makeFakeLogger();
    const cmd = new ValidateCommand({
      fs,
      logger,
      schemaValidator: new SchemaValidator(),
    });
    const summary = cmd.run("/dir");
    expect(summary.failedCount).toBe(1);
    expect(summary.passedCount).toBe(0);
    expect(summary.results[0]?.passed).toBe(false);
    expect(summary.results[0]?.errors.join(" ")).toContain("cannot read");
  });

  it("does not throw when readFile throws — converts to failed result", () => {
    const readError = new Error("EACCES");
    const fs = makeFakeFs({
      dirExists: true,
      walkResult: ["/dir/ep.endpoint.json"],
      fileContents: { "/dir/ep.endpoint.json": readError },
    });
    const logger = makeFakeLogger();
    const cmd = new ValidateCommand({
      fs,
      logger,
      schemaValidator: new SchemaValidator(),
    });
    expect(() => cmd.run("/dir")).not.toThrow();
  });

  it("includes the file path in the 'cannot read' error message", () => {
    const readError = new Error("io error");
    const fs = makeFakeFs({
      dirExists: true,
      walkResult: ["/dir/special.endpoint.json"],
      fileContents: { "/dir/special.endpoint.json": readError },
    });
    const logger = makeFakeLogger();
    const cmd = new ValidateCommand({
      fs,
      logger,
      schemaValidator: new SchemaValidator(),
    });
    const summary = cmd.run("/dir");
    expect(summary.results[0]?.errors[0]).toContain(
      "/dir/special.endpoint.json",
    );
  });
});

describe("ValidateCommand — ValidationFailedError mapping", () => {
  it("does NOT throw ValidationFailedError itself (caller maps failedCount>0)", () => {
    const logger = makeFakeLogger();
    const fs = makeFakeFs({
      walkResult: ["/dir/bad.endpoint.json"],
      fileContents: { "/dir/bad.endpoint.json": INVALID_ENDPOINT },
    });
    const cmd = new ValidateCommand({
      fs,
      logger,
      schemaValidator: new SchemaValidator(),
    });
    // The command returns the summary; caller decides to throw ValidationFailedError
    expect(() => cmd.run("/dir")).not.toThrow(ValidationFailedError);
    const summary = cmd.run("/dir");
    expect(summary.failedCount).toBeGreaterThan(0);
  });
});
