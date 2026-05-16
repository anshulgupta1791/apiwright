import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import type { FileSystem } from "../../../../src/cli/fs-seam.js";
import type {
  ApiwrightConfigSchemaValidator,
  ConfigValidationResult,
} from "../../../../src/cli/config/schema.js";
import { ConfigLoader } from "../../../../src/cli/config/loader.js";

/**
 * Unit tests for ConfigLoader.load().
 *
 * Uses a fake FileSystem and an optionally fake/real schema validator so no
 * real disk I/O occurs. Covers: missing file → defaults; valid file → merged
 * config; malformed JSON; schema failures; EACCES/EISDIR read errors; BOM
 * prefix; partial files; unknown top-level key; ENOENT race after fileExists.
 */

/** Minimal valid spec-example config as a string */
const SPEC_EXAMPLE_JSON = JSON.stringify({
  tests_dir: "./tests",
  environments_dir: "./environments",
  reports_dir: "./reports",
  default_env: "qa",
  default_markers: ["smoke"],
  log_level: "warn",
  workers: 8,
  retry: { count: 2, delay_ms: 1000, backoff: "linear", strict: false },
  report: { html: true, json: true, junit_xml: true, output_dir: "./reports" },
});

/** Tagged FsError shape matching what NodeFileSystem throws */
function makeFsError(
  code: "ENOENT" | "EACCES" | "EISDIR" | "UNKNOWN",
): Error & { code: string } {
  const err = new Error(`fs error: ${code}`) as Error & { code: string };
  err.code = code;
  return err;
}

/** Creates a fake FileSystem with controllable behavior */
function makeFakeFs(
  opts: {
    fileExists?: boolean;
    dirExists?: boolean;
    readFileResult?: string | (Error & { code: string });
    walkResult?: string[];
  } = {},
): FileSystem {
  return {
    fileExists: vi.fn().mockReturnValue(opts.fileExists ?? false),
    dirExists: vi.fn().mockReturnValue(opts.dirExists ?? true),
    readFile: vi.fn().mockImplementation(() => {
      if (opts.readFileResult instanceof Error) {
        throw opts.readFileResult;
      }
      return opts.readFileResult ?? "{}";
    }),
    walk: vi.fn().mockReturnValue(opts.walkResult ?? []),
  };
}

/** Creates a fake schema validator */
function makeFakeValidator(
  result: ConfigValidationResult,
): ApiwrightConfigSchemaValidator {
  return {
    validate: vi.fn().mockReturnValue(result),
  } as unknown as ApiwrightConfigSchemaValidator;
}

describe("ConfigLoader.load()", () => {
  describe("missing config file", () => {
    it("returns valid=true with default config when file does not exist", () => {
      const fs = makeFakeFs({ fileExists: false });
      const loader = new ConfigLoader({ fs, rootDir: "/project" });
      const result = loader.load();
      expect(result.valid).toBe(true);
      expect(result.config).toBeDefined();
      expect(result.errors).toBeUndefined();
    });

    it("fills all default fields when file is missing", () => {
      const fs = makeFakeFs({ fileExists: false });
      const loader = new ConfigLoader({ fs, rootDir: "/project" });
      const result = loader.load();
      expect(result.config?.default_env).toBe("qa");
      expect(result.config?.default_markers).toEqual(["smoke"]);
      expect(result.config?.log_level).toBe("warn");
      expect(result.config?.workers).toBe(8);
      expect(result.config?.retry.count).toBe(2);
      expect(result.config?.retry.delay_ms).toBe(1000);
      expect(result.config?.retry.backoff).toBe("linear");
      expect(result.config?.retry.strict).toBe(false);
      expect(result.config?.report.html).toBe(true);
      expect(result.config?.report.json).toBe(true);
      expect(result.config?.report.junit_xml).toBe(true);
      expect(result.config?.report.output_dir).toBe("./reports");
    });

    it("does not throw when file is missing (no exception propagates)", () => {
      const fs = makeFakeFs({ fileExists: false });
      const loader = new ConfigLoader({ fs, rootDir: "/project" });
      expect(() => loader.load()).not.toThrow();
    });
  });

  describe("valid config file", () => {
    it("returns valid=true with a fully-populated config", () => {
      const fs = makeFakeFs({
        fileExists: true,
        readFileResult: SPEC_EXAMPLE_JSON,
      });
      const validator = makeFakeValidator({ valid: true });
      const loader = new ConfigLoader({ fs, rootDir: "/project", validator });
      const result = loader.load();
      expect(result.valid).toBe(true);
      expect(result.config).toBeDefined();
      expect(result.errors).toBeUndefined();
    });

    it("fills in missing keys from defaults when only log_level is supplied", () => {
      const fs = makeFakeFs({
        fileExists: true,
        readFileResult: JSON.stringify({ log_level: "debug" }),
      });
      const validator = makeFakeValidator({ valid: true });
      const loader = new ConfigLoader({ fs, rootDir: "/project", validator });
      const result = loader.load();
      expect(result.valid).toBe(true);
      expect(result.config?.log_level).toBe("debug");
      expect(result.config?.default_env).toBe("qa");
      expect(result.config?.workers).toBe(8);
    });

    it("overrides default retry.count with the file value", () => {
      const fs = makeFakeFs({
        fileExists: true,
        readFileResult: JSON.stringify({ retry: { count: 5 } }),
      });
      const validator = makeFakeValidator({ valid: true });
      const loader = new ConfigLoader({ fs, rootDir: "/project", validator });
      const result = loader.load();
      expect(result.valid).toBe(true);
      expect(result.config?.retry.count).toBe(5);
      expect(result.config?.retry.delay_ms).toBe(1000);
    });

    it("returns a typed ApiwrightConfig (config has the expected shape)", () => {
      const fs = makeFakeFs({
        fileExists: true,
        readFileResult: SPEC_EXAMPLE_JSON,
      });
      const validator = makeFakeValidator({ valid: true });
      const loader = new ConfigLoader({ fs, rootDir: "/project", validator });
      const result = loader.load();
      const cfg = result.config!;
      expect(typeof cfg.tests_dir).toBe("string");
      expect(typeof cfg.environments_dir).toBe("string");
      expect(typeof cfg.workers).toBe("number");
      expect(typeof cfg.retry.count).toBe("number");
      expect(typeof cfg.report.html).toBe("boolean");
    });
  });

  describe("malformed JSON", () => {
    it("returns valid=false with a parse error message naming the file", () => {
      const fs = makeFakeFs({
        fileExists: true,
        readFileResult: "{ invalid json",
      });
      const loader = new ConfigLoader({ fs, rootDir: "/project" });
      const result = loader.load();
      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors!.join(" ")).toContain("apiwright.config.json");
    });

    it("does not throw when JSON is malformed (returns structured result)", () => {
      const fs = makeFakeFs({
        fileExists: true,
        readFileResult: "not json at all",
      });
      const loader = new ConfigLoader({ fs, rootDir: "/project" });
      expect(() => loader.load()).not.toThrow();
    });

    it("returns valid=false when file contains only whitespace", () => {
      const fs = makeFakeFs({ fileExists: true, readFileResult: "   " });
      const loader = new ConfigLoader({ fs, rootDir: "/project" });
      const result = loader.load();
      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
    });

    it("returns valid=false when file is empty string", () => {
      const fs = makeFakeFs({ fileExists: true, readFileResult: "" });
      const loader = new ConfigLoader({ fs, rootDir: "/project" });
      const result = loader.load();
      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
    });

    it("strips a BOM prefix before parsing so spec-example JSON parses successfully", () => {
      const withBom = "﻿" + SPEC_EXAMPLE_JSON;
      const fs = makeFakeFs({ fileExists: true, readFileResult: withBom });
      const validator = makeFakeValidator({ valid: true });
      const loader = new ConfigLoader({ fs, rootDir: "/project", validator });
      const result = loader.load();
      expect(result.valid).toBe(true);
    });
  });

  describe("schema validation failure", () => {
    it("returns valid=false with aggregated schema errors when validator rejects", () => {
      const fs = makeFakeFs({
        fileExists: true,
        readFileResult: JSON.stringify({ workers: 0 }),
      });
      const validator = makeFakeValidator({
        valid: false,
        errors: ["/workers must be a positive integer"],
      });
      const loader = new ConfigLoader({ fs, rootDir: "/project", validator });
      const result = loader.load();
      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors!.join(" ")).toContain("workers");
    });

    it("does not throw when schema validation fails", () => {
      const fs = makeFakeFs({
        fileExists: true,
        readFileResult: JSON.stringify({ log_level: "invalid" }),
      });
      const validator = makeFakeValidator({
        valid: false,
        errors: ["/log_level must be one of error, warn, info, debug"],
      });
      const loader = new ConfigLoader({ fs, rootDir: "/project", validator });
      expect(() => loader.load()).not.toThrow();
    });

    it("propagates all schema errors (not just the first)", () => {
      const fs = makeFakeFs({
        fileExists: true,
        readFileResult: JSON.stringify({ workers: 0, log_level: "bad" }),
      });
      const validator = makeFakeValidator({
        valid: false,
        errors: [
          "/workers must be a positive integer",
          "/log_level must be one of ...",
        ],
      });
      const loader = new ConfigLoader({ fs, rootDir: "/project", validator });
      const result = loader.load();
      expect(result.errors!.length).toBeGreaterThanOrEqual(2);
    });

    it("returns valid=false for null config value (non-object)", () => {
      const fs = makeFakeFs({ fileExists: true, readFileResult: "null" });
      const validator = makeFakeValidator({
        valid: false,
        errors: ["root must be object"],
      });
      const loader = new ConfigLoader({ fs, rootDir: "/project", validator });
      const result = loader.load();
      expect(result.valid).toBe(false);
    });

    it("returns valid=false for array JSON value", () => {
      const fs = makeFakeFs({ fileExists: true, readFileResult: "[]" });
      const validator = makeFakeValidator({
        valid: false,
        errors: ["root must be object"],
      });
      const loader = new ConfigLoader({ fs, rootDir: "/project", validator });
      const result = loader.load();
      expect(result.valid).toBe(false);
    });
  });

  describe("filesystem read errors", () => {
    it("returns valid=false with EACCES error (cannot read)", () => {
      const fs = makeFakeFs({
        fileExists: true,
        readFileResult: makeFsError("EACCES"),
      });
      const loader = new ConfigLoader({ fs, rootDir: "/project" });
      const result = loader.load();
      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
      const errorText = result.errors!.join(" ").toLowerCase();
      expect(errorText).toMatch(/cannot read|eacces|access/);
    });

    it("returns valid=false with EISDIR error", () => {
      const fs = makeFakeFs({
        fileExists: true,
        readFileResult: makeFsError("EISDIR"),
      });
      const loader = new ConfigLoader({ fs, rootDir: "/project" });
      const result = loader.load();
      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
    });

    it("treats ENOENT after fileExists=true as a missing file (returns defaults)", () => {
      const fs = makeFakeFs({
        fileExists: true,
        readFileResult: makeFsError("ENOENT"),
      });
      const loader = new ConfigLoader({ fs, rootDir: "/project" });
      const result = loader.load();
      // ENOENT after exists check → race condition → treat as missing → defaults
      expect(result.valid).toBe(true);
      expect(result.config).toBeDefined();
    });

    it("does not throw for EACCES (returns structured result)", () => {
      const fs = makeFakeFs({
        fileExists: true,
        readFileResult: makeFsError("EACCES"),
      });
      const loader = new ConfigLoader({ fs, rootDir: "/project" });
      expect(() => loader.load()).not.toThrow();
    });
  });

  describe("configPath option", () => {
    it("reads from configPath when provided, ignoring rootDir", () => {
      const fs = makeFakeFs({
        fileExists: true,
        readFileResult: JSON.stringify({ log_level: "error" }),
      });
      const validator = makeFakeValidator({ valid: true });
      const loader = new ConfigLoader({
        fs,
        configPath: "/custom/path/config.json",
        validator,
      });
      const result = loader.load();
      expect(result.valid).toBe(true);
      // Verify readFile was called with the custom path
      expect((fs.readFile as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toBe(
        "/custom/path/config.json",
      );
    });

    it("returns defaults when configPath file does not exist", () => {
      const fs = makeFakeFs({ fileExists: false });
      const loader = new ConfigLoader({
        fs,
        configPath: "/custom/path/config.json",
      });
      const result = loader.load();
      expect(result.valid).toBe(true);
      expect(result.config?.default_env).toBe("qa");
    });
  });

  describe("injectable seams", () => {
    it("uses the injected rootDir to resolve the config path", () => {
      const fs = makeFakeFs({ fileExists: true, readFileResult: "{}" });
      const validator = makeFakeValidator({ valid: true });
      const loader = new ConfigLoader({
        fs,
        rootDir: "/custom/root",
        validator,
      });
      loader.load();
      expect(
        (fs.fileExists as ReturnType<typeof vi.fn>).mock.calls[0]?.[0],
      ).toContain("/custom/root");
    });

    it("uses the injected validator's validate method", () => {
      const fs = makeFakeFs({ fileExists: true, readFileResult: "{}" });
      const validator = makeFakeValidator({ valid: true });
      const loader = new ConfigLoader({ fs, rootDir: "/project", validator });
      loader.load();
      expect(
        (validator.validate as ReturnType<typeof vi.fn>).mock.calls.length,
      ).toBe(1);
    });
  });

  describe("default NodeFileSystem seam wiring", () => {
    let tmpDir: string;
    let tmpConfigPath: string;

    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), "apiwright-loader-"));
      tmpConfigPath = join(tmpDir, "apiwright.config.json");
    });

    afterEach(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it("reads a real file when no fs option is given (default NodeFileSystem wired)", () => {
      writeFileSync(
        tmpConfigPath,
        JSON.stringify({ log_level: "debug" }),
        "utf8",
      );
      // No fs injected → default NodeFileSystem is used to read the real file.
      const loader = new ConfigLoader({ configPath: tmpConfigPath });
      const result = loader.load();
      expect(result.valid).toBe(true);
      expect(result.config?.log_level).toBe("debug");
    });

    it("returns defaults when no config file exists and no fs option is given", () => {
      // File does not exist → NodeFileSystem.fileExists returns false → defaults returned.
      const loader = new ConfigLoader({
        configPath: join(tmpDir, "nonexistent.json"),
      });
      const result = loader.load();
      expect(result.valid).toBe(true);
      expect(result.config).toBeDefined();
    });
  });

  describe("default ApiwrightConfigSchemaValidator seam wiring", () => {
    let tmpDir: string;
    let tmpConfigPath: string;

    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), "apiwright-loader-"));
      tmpConfigPath = join(tmpDir, "apiwright.config.json");
    });

    afterEach(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it("validates a valid config file when no validator option is given", () => {
      writeFileSync(
        tmpConfigPath,
        JSON.stringify({ log_level: "warn" }),
        "utf8",
      );
      // No validator injected → default ApiwrightConfigSchemaValidator used.
      const loader = new ConfigLoader({ configPath: tmpConfigPath });
      const result = loader.load();
      expect(result.valid).toBe(true);
      expect(result.config?.log_level).toBe("warn");
    });

    it("returns valid=false for schema-invalid config when no validator option is given", () => {
      writeFileSync(tmpConfigPath, JSON.stringify({ workers: -1 }), "utf8");
      // Default validator should reject workers=-1.
      const loader = new ConfigLoader({ configPath: tmpConfigPath });
      const result = loader.load();
      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
    });
  });

  describe("defaults merged correctly with partial config", () => {
    it("merges partial retry block (only count given) with remaining retry defaults", () => {
      const fs = makeFakeFs({
        fileExists: true,
        readFileResult: JSON.stringify({ retry: { count: 3 } }),
      });
      const validator = makeFakeValidator({ valid: true });
      const loader = new ConfigLoader({ fs, rootDir: "/project", validator });
      const result = loader.load();
      expect(result.config?.retry.count).toBe(3);
      expect(result.config?.retry.delay_ms).toBe(1000);
      expect(result.config?.retry.backoff).toBe("linear");
      expect(result.config?.retry.strict).toBe(false);
    });

    it("merges partial report block (only html=false given) with remaining report defaults", () => {
      const fs = makeFakeFs({
        fileExists: true,
        readFileResult: JSON.stringify({ report: { html: false } }),
      });
      const validator = makeFakeValidator({ valid: true });
      const loader = new ConfigLoader({ fs, rootDir: "/project", validator });
      const result = loader.load();
      expect(result.config?.report.html).toBe(false);
      expect(result.config?.report.json).toBe(true);
      expect(result.config?.report.junit_xml).toBe(true);
      expect(result.config?.report.output_dir).toBe("./reports");
    });
  });
});
