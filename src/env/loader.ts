/**
 * Environment loading orchestration. Composes the YAML reader (#2), the
 * template resolver (${env.*}, #4), the secret resolver (${secret.*}, #3),
 * the schema validator (#1), and a connection-name consistency check into a
 * single startup entry point. See V1_BUILD_SPEC.md §7–§8.
 *
 * The loader NEVER throws for user-config problems: every failure (file not
 * found, malformed YAML, unresolved ${env.*}, missing ${secret.*}, schema
 * violation, bad connection name) is returned as a structured result with
 * aggregated, human-readable error messages. Secret values never appear in
 * any error string.
 */

import { join } from "node:path";

import { EnvironmentSchemaValidator } from "./schema.js";
import { SecretRegistry, resolveSecrets } from "./secrets.js";
import { resolveTemplates } from "./template-resolver.js";
import type { ResolvedEnvironment } from "./types.js";
import { readYamlFile, type YamlReadResult } from "./yaml-reader.js";

/** Discriminated outcome of {@link EnvironmentLoader.load}. */
export interface EnvironmentLoadResult {
  /** True when the environment loaded, resolved, and validated cleanly. */
  valid: boolean;
  /** The fully resolved environment; present only when valid. */
  environment?: ResolvedEnvironment;
  /** Aggregated, human-readable error messages; present only when invalid. */
  errors?: string[];
  /**
   * Registry of resolved secret values, always returned (even on failure) so
   * downstream redaction can scrub anything resolved before a later failure.
   */
  secretRegistry: SecretRegistry;
}

/** Signature of the internal YAML reader (the test seam). */
type ReaderFn = (filePath: string) => YamlReadResult;

/** Options controlling where and how the loader reads environment files. */
export interface EnvironmentLoaderOptions {
  /**
   * Directory env files resolve against. Defaults to process.cwd().
   * `load("qa")` tries `<rootDir>/.env.qa.yaml` then
   * `<rootDir>/environments/qa.yaml`.
   */
  rootDir?: string;
  /**
   * Environment-variable source for secret resolution. Defaults to
   * process.env. Injectable for deterministic tests.
   */
  env?: NodeJS.ProcessEnv;
}

/** Internal options shape including the non-public reader seam. */
interface InternalLoaderOptions extends EnvironmentLoaderOptions {
  /** Reader override; defaults to {@link readYamlFile}. Test-only. */
  reader?: ReaderFn;
}

/** Valid database / auth-strategy connection name pattern. */
const CONNECTION_NAME_RE = /^[A-Za-z0-9_]+$/;

/**
 * Valid environment-name pattern. Constrains `name` to a safe identifier so it
 * cannot inject path separators or `..` segments into the resolved file path
 * (path-traversal guard).
 */
const ENV_NAME_RE = /^[A-Za-z0-9_-]+$/;

/**
 * Type guard: a plain (non-array, non-null) object.
 * @param value - The value to test.
 * @returns True when value is a plain object.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Deep-merges `override` over `base`, producing a new tree. Plain objects are
 * merged key-by-key; every other override value (scalar/array/null) replaces
 * the base value wholesale. Inputs are never mutated.
 * @param base - The base value.
 * @param override - The overriding value (wins on conflict).
 * @returns The merged value.
 */
function deepMerge(base: unknown, override: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(override)) {
    return override;
  }
  const out: Record<string, unknown> = { ...base };
  for (const [key, overrideValue] of Object.entries(override)) {
    const merged = Object.prototype.hasOwnProperty.call(base, key)
      ? deepMerge(base[key], overrideValue)
      : overrideValue;
    // defineProperty (not out[key]=) so a literal "__proto__" key in the
    // config becomes an own property instead of mutating the prototype.
    Object.defineProperty(out, key, {
      value: merged,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return out;
}

/**
 * Applies per-environment overrides: when the document carries an
 * `environments` map, deep-merges `environments[name]` over the base and
 * strips the `environments` key so it never leaks into the result or schema.
 * @param data - The parsed base document.
 * @param name - The environment name being loaded.
 * @returns The override-applied document (a new object).
 */
function applyEnvironmentOverrides(
  data: Record<string, unknown>,
  name: string,
): Record<string, unknown> {
  const envs = data["environments"];
  if (!isPlainObject(envs)) {
    return data;
  }
  const { environments: _drop, ...base } = data;
  const override = envs[name];
  if (!isPlainObject(override)) {
    return base;
  }
  return deepMerge(base, override) as Record<string, unknown>;
}

/**
 * Validates one named-connection section, collecting violations.
 * @param section - The databases or auth_strategies object (or undefined).
 * @param label - Human label for error messages.
 * @param errors - Accumulator for violation messages.
 * @returns The set of well-formed keys seen in this section.
 */
function checkSection(
  section: unknown,
  label: string,
  errors: string[],
): Set<string> {
  const seen = new Set<string>();
  if (!isPlainObject(section)) {
    return seen;
  }
  for (const key of Object.keys(section)) {
    if (key.trim().length === 0) {
      errors.push(`${label} connection name must be non-empty`);
      continue;
    }
    if (!CONNECTION_NAME_RE.test(key)) {
      errors.push(
        `${label} connection name "${key}" is invalid ` +
          `(use letters, digits, _)`,
      );
      continue;
    }
    seen.add(key);
  }
  return seen;
}

/**
 * Verifies every db/auth-strategy key is well-formed and that no name is
 * shared across the two sections (ambiguous for ${db.*} resolution).
 * @param env - The schema-valid resolved environment.
 * @returns Aggregated violation messages (empty when consistent).
 */
function checkConnectionNames(env: Record<string, unknown>): string[] {
  const errors: string[] = [];
  const dbNames = checkSection(env["databases"], "databases", errors);
  const authNames = checkSection(
    env["auth_strategies"],
    "auth_strategies",
    errors,
  );
  for (const name of dbNames) {
    if (authNames.has(name)) {
      errors.push(
        `connection name "${name}" is used by both databases and ` +
          `auth_strategies`,
      );
    }
  }
  return errors;
}

/**
 * Orchestrates reading, override-merging, template + secret resolution,
 * schema validation, and connection-name consistency for one environment.
 */
export class EnvironmentLoader {
  private readonly rootDir: string;
  private readonly env: NodeJS.ProcessEnv;
  private readonly reader: ReaderFn;
  private readonly schemaValidator: EnvironmentSchemaValidator;

  /**
   * Creates a loader bound to a root directory and environment-variable source.
   * @param options - Loader options (root dir, env source).
   */
  constructor(options: EnvironmentLoaderOptions = {}) {
    const internal = options as InternalLoaderOptions;
    this.rootDir = internal.rootDir ?? process.cwd();
    this.env = internal.env ?? process.env;
    this.reader = internal.reader ?? readYamlFile;
    this.schemaValidator = new EnvironmentSchemaValidator();
  }

  /**
   * Loads an environment by name. Tries `<rootDir>/.env.<name>.yaml` then
   * `<rootDir>/environments/<name>.yaml`, then deep-merges per-env
   * overrides, resolves ${env.*} then ${secret.*}, schema-validates, and
   * runs the connection-name consistency check. Never throws on user-config
   * errors.
   * @param name - The environment name (e.g. "qa").
   * @returns A discriminated load result.
   */
  load(name: string): EnvironmentLoadResult {
    const secretRegistry = new SecretRegistry();
    if (!ENV_NAME_RE.test(name)) {
      return {
        valid: false,
        errors: [
          `Invalid environment name "${name}": use only letters, ` +
            `digits, hyphen, or underscore.`,
        ],
        secretRegistry,
      };
    }
    try {
      return this.runPipeline(name, secretRegistry);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        valid: false,
        errors: [`unexpected error: ${message}`],
        secretRegistry,
      };
    }
  }

  /**
   * Resolves which env file to use. Tries `.env.<name>.yaml` first; only
   * falls back to `environments/<name>.yaml` when the dotfile is genuinely
   * absent. A dotfile that exists but is malformed/empty/unsafe surfaces its
   * own error rather than being masked by a generic "not found".
   * @param name - The environment name.
   * @param dotPath - The `.env.<name>.yaml` candidate path.
   * @param dirPath - The `environments/<name>.yaml` candidate path.
   * @returns The parsed data, or a single human-readable error.
   */
  private locate(
    name: string,
    dotPath: string,
    dirPath: string,
  ):
    | { ok: true; data: Record<string, unknown> }
    | { ok: false; error: string } {
    const dot = this.reader(dotPath);
    if (dot.ok) {
      return { ok: true, data: dot.data };
    }
    if (dot.kind !== "not_found") {
      return { ok: false, error: dot.error };
    }
    const dir = this.reader(dirPath);
    if (dir.ok) {
      return { ok: true, data: dir.data };
    }
    if (dir.kind !== "not_found") {
      return { ok: false, error: dir.error };
    }
    return {
      ok: false,
      error:
        `Environment "${name}" not found. Tried: ${dotPath} and ` +
        `${dirPath}.`,
    };
  }

  /**
   * The ordered load pipeline. Each stage short-circuits on failure.
   * @param name - The environment name.
   * @param secretRegistry - Registry to populate during secret resolution.
   * @returns The load result.
   */
  private runPipeline(
    name: string,
    secretRegistry: SecretRegistry,
  ): EnvironmentLoadResult {
    const dotPath = join(this.rootDir, `.env.${name}.yaml`);
    const dirPath = join(this.rootDir, "environments", `${name}.yaml`);

    const located = this.locate(name, dotPath, dirPath);
    if (!located.ok) {
      return { valid: false, errors: [located.error], secretRegistry };
    }

    const merged = applyEnvironmentOverrides(located.data, name);

    const resolution = this.resolve(merged, secretRegistry);
    if (!resolution.ok) {
      return { valid: false, errors: resolution.errors, secretRegistry };
    }

    const resolved = resolution.data;
    const schemaResult = this.schemaValidator.validate(resolved);
    if (!schemaResult.valid) {
      return {
        valid: false,
        errors: schemaResult.errors ?? ["schema validation failed"],
        secretRegistry,
      };
    }

    const nameErrors = checkConnectionNames(resolved);
    if (nameErrors.length > 0) {
      return { valid: false, errors: nameErrors, secretRegistry };
    }

    return {
      valid: true,
      environment: resolved as unknown as ResolvedEnvironment,
      secretRegistry,
    };
  }

  /**
   * Runs the template (${env.*}) then secret (${secret.*}) resolution stages,
   * short-circuiting on the first failure.
   * @param merged - The override-merged config document.
   * @param secretRegistry - Registry populated during secret resolution.
   * @returns The fully resolved document, or the failing stage's errors.
   */
  private resolve(
    merged: Record<string, unknown>,
    secretRegistry: SecretRegistry,
  ):
    | { ok: true; data: Record<string, unknown> }
    | { ok: false; errors: string[] } {
    const templated = resolveTemplates(merged, merged);
    if (!templated.ok || templated.data === undefined) {
      return {
        ok: false,
        errors: [templated.error ?? "template resolution failed"],
      };
    }

    const secretResult = resolveSecrets(
      templated.data,
      secretRegistry,
      this.env,
    );
    if (!secretResult.ok || secretResult.data === undefined) {
      return {
        ok: false,
        errors: [secretResult.error ?? "secret resolution failed"],
      };
    }

    return { ok: true, data: secretResult.data };
  }
}
