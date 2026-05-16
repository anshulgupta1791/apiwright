/**
 * Template resolution: replace ${env.PATH} references with values read from
 * the parsed environment object. Namespace isolation is structural — this
 * module has no access to secrets or process.env, so ${env.*} can never read
 * a secret. Missing paths fail fast with one aggregated error. Other
 * namespaces (${secret.*}, ${response.*}, ${request.*}, ${db.*}, ${token})
 * are left intact. See V1_BUILD_SPEC.md §7.
 */

import { mapTree, walkStrings } from "./tree-walk.js";

/** Matches a ${env.PATH} token (PATH = dot-separated [A-Za-z0-9_]+). Global. */
const ENV_TOKEN_RE = /\$\{env\.([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*)\}/g;

/** Matches a string that is exactly one ${env.PATH} token and nothing else. */
const WHOLE_ENV_TOKEN_RE = /^\$\{env\.([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*)\}$/;

/** Outcome of resolving all ${env.*} references in a config tree. */
export interface TemplateResolutionResult {
  /** True when every ${env.*} reference resolved. */
  ok: boolean;
  /** The config with ${env.*} substituted; present only when ok. */
  data?: Record<string, unknown>;
  /** Aggregated, path-only error message; present only when not ok. */
  error?: string;
  /** Full dotted paths that could not be resolved. */
  missing?: string[];
}

/** Result of walking a dotted path through the environment object. */
interface PathLookup {
  /** True when the full path resolved to a value (including null). */
  found: boolean;
  /** The resolved value; meaningful only when found. */
  value: unknown;
}

/**
 * Walks a dotted path (e.g. "db.host") through the environment object.
 * A path is "found" only if every segment exists; a segment hitting a
 * non-object before the path ends is not found. A resolved null/undefined
 * leaf counts as found (null) so explicit null env values are usable.
 * @param envObject - The environment object to traverse.
 * @param dottedPath - The PATH portion of an ${env.PATH} token.
 * @returns A PathLookup describing whether and to what the path resolved.
 */
function lookupPath(
  envObject: Record<string, unknown>,
  dottedPath: string,
): PathLookup {
  const segments = dottedPath.split(".");
  let current: unknown = envObject;
  for (const segment of segments) {
    if (current === null || typeof current !== "object") {
      return { found: false, value: undefined };
    }
    const container = current as Record<string, unknown>;
    if (!Object.prototype.hasOwnProperty.call(container, segment)) {
      return { found: false, value: undefined };
    }
    current = container[segment];
  }
  return { found: true, value: current };
}

/**
 * Collects every distinct ${env.PATH} path referenced in a single string.
 * @param str - A string leaf possibly containing env tokens.
 * @param into - Accumulator set of referenced dotted paths.
 */
function collectPaths(str: string, into: Set<string>): void {
  for (const match of str.matchAll(ENV_TOKEN_RE)) {
    into.add(String(match[1]));
  }
}

/**
 * Converts a resolved value to its string form for embedded interpolation.
 * Env values come from parsed YAML (string/number/boolean/null), so the only
 * object-like value possible is an array; it is JSON-stringified rather than
 * yielding "[object Object]".
 * @param value - The resolved value.
 * @returns The string representation.
 */
function stringify(value: unknown): string {
  if (value === null || value === undefined) {
    return "null";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  // Only arrays/objects remain (YAML-parsed); JSON-stringify rather than
  // yielding "[object Object]".
  return JSON.stringify(value);
}

/**
 * Resolves a single string node. When the whole string is exactly one token,
 * the typed value is preserved; otherwise tokens are interpolated as text.
 * @param input - The string node.
 * @param resolved - Map of dotted path to resolved value.
 * @returns The resolved node (typed value or interpolated string).
 */
function resolveString(input: string, resolved: Map<string, unknown>): unknown {
  const whole = WHOLE_ENV_TOKEN_RE.exec(input);
  if (whole !== null) {
    return resolved.get(String(whole[1]));
  }
  return input.replace(ENV_TOKEN_RE, (_m, path: string) =>
    stringify(resolved.get(path)),
  );
}

/**
 * Resolves every ${env.PATH} reference in the config tree against the given
 * environment object. Only the env object is consulted (no secret access).
 * All unresolved paths are aggregated into one error; the input is never
 * mutated and no partial substitution occurs on failure.
 * @param config - The config tree to resolve.
 * @param envObject - The environment object ${env.*} resolves against.
 * @returns A discriminated resolution result.
 */
export function resolveTemplates(
  config: Record<string, unknown>,
  envObject: Record<string, unknown>,
): TemplateResolutionResult {
  const referenced = new Set<string>();
  walkStrings(config, (str) => collectPaths(str, referenced));

  const resolved = new Map<string, unknown>();
  const missing: string[] = [];
  for (const path of referenced) {
    const lookup = lookupPath(envObject, path);
    if (lookup.found) {
      resolved.set(path, lookup.value);
    } else {
      missing.push(`env.${path}`);
    }
  }

  if (missing.length > 0) {
    const sorted = missing.sort();
    const paths = sorted.join(", ");
    return {
      ok: false,
      missing: sorted,
      error:
        `Unresolved environment reference(s): ${paths}. ` +
        `Check the environment file.`,
    };
  }

  return {
    ok: true,
    missing: [],
    data: mapTree(config, (str) => resolveString(str, resolved)) as Record<
      string,
      unknown
    >,
  };
}
