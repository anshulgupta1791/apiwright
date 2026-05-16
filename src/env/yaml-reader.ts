import * as nodeFs from "node:fs";

// js-yaml is a CommonJS module; require() shim matches the established
// convention in src/env/schema.ts and src/core/schema-validator.ts.
// eslint-disable-next-line @typescript-eslint/no-require-imports, no-restricted-syntax
const yaml = require("js-yaml") as {
  load: (input: string, opts?: { schema?: unknown }) => unknown;
  JSON_SCHEMA: unknown;
};

/** Successful YAML parse outcome. */
export interface YamlReadSuccess {
  /** Discriminant: parse succeeded. */
  ok: true;
  /** The parsed top-level mapping. */
  data: Record<string, unknown>;
}

/** Categorisation of a YAML read failure. */
export type YamlReadFailureKind =
  | "not_found"
  | "unreadable"
  | "malformed"
  | "empty"
  | "unsafe";

/** Failure outcome with a human-readable, path-aware message. */
export interface YamlReadFailure {
  /** Discriminant: parse failed. */
  ok: false;
  /** Human-readable, path-aware error message. */
  error: string;
  /** Machine-readable failure category. */
  kind: YamlReadFailureKind;
}

/** Discriminated result of reading a YAML environment file. */
export type YamlReadResult = YamlReadSuccess | YamlReadFailure;

/**
 * Extracts a readable message from an unknown thrown value. Exported so the
 * non-Error branch can be unit-tested directly (the fs/yaml IO boundary
 * cannot be reliably mocked under ESM).
 * @param err - The caught value.
 * @returns A string description.
 */
export function describeError(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

/**
 * Builds a failure result.
 * @param kind - The failure category.
 * @param error - The human-readable message.
 * @returns A YamlReadFailure.
 */
function fail(kind: YamlReadFailureKind, error: string): YamlReadFailure {
  return { ok: false, kind, error };
}

/**
 * Reads and safe-parses a single YAML environment file from disk. Uses
 * js-yaml's JSON_SCHEMA so custom/unsafe tags never construct arbitrary
 * types or execute code. Never throws for user-config problems; returns a
 * discriminated result instead.
 * @param filePath - Path to the YAML file (absolute or relative).
 * @returns A success result with the parsed mapping, or a structured failure.
 */
export function readYamlFile(filePath: string): YamlReadResult {
  if (!nodeFs.existsSync(filePath)) {
    return fail("not_found", `Environment file not found: ${filePath}`);
  }

  let raw: string;
  try {
    raw = nodeFs.readFileSync(filePath, "utf8");
  } catch (err: unknown) {
    return fail(
      "unreadable",
      `Could not read environment file ${filePath}: ${describeError(err)}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = yaml.load(raw, { schema: yaml.JSON_SCHEMA });
  } catch (err: unknown) {
    const message = describeError(err);
    const kind: YamlReadFailureKind = /unknown tag|tag/i.test(message)
      ? "unsafe"
      : "malformed";
    return fail(kind, `Invalid YAML in ${filePath}: ${message}`);
  }

  if (parsed === null || parsed === undefined) {
    return fail("empty", `Environment file is empty: ${filePath}`);
  }

  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    return fail(
      "malformed",
      `Invalid YAML in ${filePath}: expected a mapping at the top level`,
    );
  }

  return { ok: true, data: parsed as Record<string, unknown> };
}
