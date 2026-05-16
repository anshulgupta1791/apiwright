/**
 * APIWright config loader.
 *
 * Locates, reads, parses, validates, and merges apiwright.config.json with
 * defaults. Never throws on user-config errors — all failures are returned
 * as structured `ConfigLoadResult` values. Missing file → defaults, valid:true.
 */

import { join } from "node:path";

import { parseJson } from "../../core/safe-json.js";
import { NodeFileSystem } from "../fs-seam.js";
import type { FileSystem } from "../fs-seam.js";

import { cloneDefaults } from "./defaults.js";
import { ApiwrightConfigSchemaValidator } from "./schema.js";
import type { ApiwrightConfig } from "./types.js";

/** BOM (byte-order-mark) character to strip from file content before parsing. */
const BOM = "﻿";

/** Filename used when no explicit configPath is given. */
const CONFIG_FILENAME = "apiwright.config.json";

/**
 * Discriminated result of {@link ConfigLoader.load}.
 * Mirrors the EnvironmentLoadResult shape in src/env/loader.ts.
 */
export interface ConfigLoadResult {
  /** True when config loaded and validated successfully. */
  valid: boolean;
  /**
   * Fully-defaulted config; present when valid. Defaults even on a
   * missing file (missing file is NOT an error).
   */
  config?: ApiwrightConfig;
  /** Parse / schema errors; present only when invalid. */
  errors?: string[];
}

/** Options accepted by {@link ConfigLoader}. */
export interface ConfigLoaderOptions {
  /** Repo root to resolve apiwright.config.json against. Default cwd. */
  rootDir?: string;
  /** Explicit config path (CLI --config) overriding rootDir lookup. */
  configPath?: string;
  /** Filesystem seam. Default new NodeFileSystem(). */
  fs?: FileSystem;
  /** Schema validator seam. Default new ApiwrightConfigSchemaValidator(). */
  validator?: ApiwrightConfigSchemaValidator;
}

/**
 * Loads and merges apiwright.config.json with canonical defaults.
 *
 * Algorithm:
 * 1. Resolve path (configPath overrides rootDir/apiwright.config.json).
 * 2. fileExists false → return defaults, valid:true.
 * 3. readFile ENOENT → treat as missing → defaults. EACCES/EISDIR → error.
 * 4. JSON.parse failure → error.
 * 5. validator.validate failure → error.
 * 6. Deep-merge parsed over defaults → return valid config.
 */
export class ConfigLoader {
  readonly #rootDir: string;
  readonly #configPath: string | undefined;
  readonly #fs: FileSystem;
  readonly #validator: ApiwrightConfigSchemaValidator;

  /**
   * Creates a ConfigLoader with the given options.
   * @param options - Loader options (rootDir, configPath, fs seam, validator).
   */
  constructor(options: ConfigLoaderOptions = {}) {
    this.#rootDir = options.rootDir ?? process.cwd();
    this.#configPath = options.configPath;
    this.#fs = options.fs ?? new NodeFileSystem();
    this.#validator = options.validator ?? new ApiwrightConfigSchemaValidator();
  }

  /**
   * Locates, parses, validates, and defaults the config. Never throws on
   * user-config error. Missing file → defaults, valid=true.
   * @returns A discriminated load result.
   */
  load(): ConfigLoadResult {
    const filePath = this.#configPath ?? join(this.#rootDir, CONFIG_FILENAME);

    if (!this.#fs.fileExists(filePath)) {
      return { valid: true, config: cloneDefaults() };
    }

    const rawResult = this.#readRaw(filePath);
    if (rawResult.error !== null) {
      return rawResult.error;
    }

    return this.#parseAndValidate(rawResult.content);
  }

  /**
   * Reads the raw file content, handling ENOENT as missing (→ defaults) and
   * other errors as failures.
   * @param filePath - Absolute path to the config file.
   * @returns Object with either the raw content or an error result.
   */
  #readRaw(
    filePath: string,
  ): { content: string; error: null } | { error: ConfigLoadResult } {
    try {
      const raw = this.#fs.readFile(filePath);
      const content = raw.startsWith(BOM) ? raw.slice(1) : raw;
      return { content, error: null };
    } catch (err: unknown) {
      const fsErr = err as { code?: string };
      if (fsErr.code === "ENOENT") {
        return { error: { valid: true, config: cloneDefaults() } };
      }
      return {
        error: {
          valid: false,
          /* istanbul ignore next — fsErr.code is always set by Node.js fs errors */
          errors: [`cannot read ${filePath}: ${fsErr.code ?? "UNKNOWN"}`],
        },
      };
    }
  }

  /**
   * Parses the config content and validates it against the schema.
   * @param content - The raw file content (BOM already stripped).
   * @returns A ConfigLoadResult.
   */
  #parseAndValidate(content: string): ConfigLoadResult {
    const parsed = parseJson(content);
    if (!parsed.ok) {
      return {
        valid: false,
        errors: [`${CONFIG_FILENAME} is not valid JSON: ${parsed.error}`],
      };
    }

    const schemaResult = this.#validator.validate(parsed.value);
    if (!schemaResult.valid) {
      return { valid: false, errors: schemaResult.errors ?? [] };
    }

    const config = this.#mergeWithDefaults(
      parsed.value as Record<string, unknown>,
    );
    return { valid: true, config };
  }

  /**
   * Merges the validated partial config over defaults, handling the two-level
   * structure of retry and report. Scalars and arrays replace; objects merge
   * key-by-key.
   * @param parsed - The schema-valid parsed config (may be partial).
   * @returns A fully-populated ApiwrightConfig.
   */
  #mergeWithDefaults(parsed: Record<string, unknown>): ApiwrightConfig {
    const defaults = cloneDefaults();
    const merged: ApiwrightConfig = { ...defaults };

    for (const key of Object.keys(parsed) as Array<keyof ApiwrightConfig>) {
      const value = parsed[key as string];
      if (key === "retry" && isPlainObject(value)) {
        merged.retry = {
          ...defaults.retry,
          ...(value as Partial<ApiwrightConfig["retry"]>),
        };
      } else if (key === "report" && isPlainObject(value)) {
        merged.report = {
          ...defaults.report,
          ...(value as Partial<ApiwrightConfig["report"]>),
        };
      } else {
        // scalars, arrays: replace
        (merged as unknown as Record<string, unknown>)[key] = value;
      }
    }

    return merged;
  }
}

/**
 * Type guard: a plain (non-array, non-null) object.
 * @param value - The value to test.
 * @returns True when value is a non-null, non-array plain object.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
