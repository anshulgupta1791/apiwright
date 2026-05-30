/**
 * Secret resolution: replace ${secret.NAME} references with values from
 * process.env (no prefix), fail fast on any missing/empty reference with an
 * aggregated, value-free error, and record resolved values in an in-memory
 * registry for downstream log redaction. See §8.
 */

import { mapTree, walkStrings } from "./tree-walk.js";

/** Matches a ${secret.NAME} token; NAME is [A-Za-z0-9_]+. Global. */
const SECRET_TOKEN_RE = /\$\{secret\.([A-Za-z0-9_]+)\}/g;

/**
 * In-memory registry of resolved secret values. Downstream reporters/runner
 * consume {@link values} to redact secrets from logs and reports. This module
 * never serializes the registry.
 *
 * Redaction contract: each stored entry is the exact resolved secret string.
 * The downstream redactor is expected to perform literal substring replacement
 * of every stored value with `[REDACTED]` before serializing any log/report.
 * Empty values are never stored (empty secrets fail resolution upstream), so
 * the registry contains no zero-length entries; callers should still guard
 * against pathologically short values when redacting.
 */
export class SecretRegistry {
  private readonly store = new Set<string>();

  /**
   * Records a resolved secret value.
   * @param value - The resolved secret string to remember for redaction.
   */
  add(value: string): void {
    this.store.add(value);
  }

  /**
   * Returns the set of all recorded secret values.
   * @returns A read-only view of the recorded values.
   */
  values(): ReadonlySet<string> {
    return this.store;
  }

  /**
   * The number of distinct recorded secret values.
   * @returns The registry size.
   */
  get size(): number {
    return this.store.size;
  }
}

/** Outcome of resolving all ${secret.*} references in a config tree. */
export interface SecretResolutionResult {
  /** True when every reference resolved to a non-empty value. */
  ok: boolean;
  /** The config with secrets substituted; present only when ok. */
  data?: Record<string, unknown>;
  /** Aggregated, value-free error message; present only when not ok. */
  error?: string;
  /** Names of references that could not be resolved (no values). */
  missing?: string[];
}

/**
 * Collects every distinct ${secret.NAME} name referenced in a single string.
 * @param str - A string leaf possibly containing secret tokens.
 * @param into - Accumulator set of referenced names.
 */
function collectNames(str: string, into: Set<string>): void {
  for (const match of str.matchAll(SECRET_TOKEN_RE)) {
    // The capture group [A-Za-z0-9_]+ is mandatory, so match[1] is always the
    // matched name. String() is branch-free and satisfies the type checker
    // (noUncheckedIndexedAccess widens match[1], but it is never undefined
    // when the regex matches).
    into.add(String(match[1]));
  }
}

/**
 * Substitutes ${secret.NAME} tokens in a single string using a resolved map.
 * Single pass: resolved values are never re-scanned for tokens.
 * @param input - The string possibly containing secret tokens.
 * @param resolved - Map of secret name to resolved value.
 * @returns The substituted string.
 */
function substitute(input: string, resolved: Map<string, string>): string {
  // substitute() runs only after resolveSecrets has confirmed every
  // referenced name is present in `resolved`, so get() always returns a
  // string here. String() is branch-free; an unresolved name cannot occur.
  return input.replace(SECRET_TOKEN_RE, (_whole, name: string) =>
    String(resolved.get(name)),
  );
}

/**
 * Resolves every ${secret.NAME} reference in the config tree from the given
 * environment (defaults to process.env), mapping NAME directly to env[NAME]
 * with no prefix. Empty-string values are treated as missing. All missing
 * references are aggregated into one error; the input is never mutated and no
 * partial substitution occurs on failure. Secret values never appear in the
 * error.
 * @param config - The parsed config object.
 * @param registry - Registry to record resolved values into.
 * @param env - Environment variable source; defaults to process.env.
 * @returns A discriminated resolution result.
 */
export function resolveSecrets(
  config: Record<string, unknown>,
  registry: SecretRegistry,
  env: NodeJS.ProcessEnv = process.env,
): SecretResolutionResult {
  const referenced = new Set<string>();
  walkStrings(config, (str) => collectNames(str, referenced));

  const resolved = new Map<string, string>();
  const missing: string[] = [];
  for (const name of referenced) {
    const raw = env[name];
    if (raw === undefined || raw === "") {
      missing.push(name);
    } else {
      resolved.set(name, raw);
    }
  }

  if (missing.length > 0) {
    const sorted = missing.sort();
    const names = sorted.join(", ");
    return {
      ok: false,
      missing: sorted,
      error:
        `Unresolved secret(s): ${names}. Set the corresponding ` +
        `environment variable(s) before running.`,
    };
  }

  for (const value of resolved.values()) {
    registry.add(value);
  }

  return {
    ok: true,
    missing: [],
    data: mapTree(config, (str) => substitute(str, resolved)) as Record<
      string,
      unknown
    >,
  };
}
