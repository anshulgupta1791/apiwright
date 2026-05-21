/**
 * Discharges Task #10 obligations #3 + #13: routes every log + report
 * value through the §8 secret redactor (Task #2, PR #10) so credentials
 * and auth tokens never appear in serialized output.
 *
 * `redactValue` recursively walks any JSON-serializable value, replacing
 * substrings in every string leaf with `[REDACTED]` when they match a
 * registered secret. Non-string values pass through unchanged.
 */

import type { SecretRegistry } from "../../env/index.js";
import { redactSecrets } from "../../env/index.js";

/** Bounded recursion depth for `redactValue` to defend against cycles. */
export const REDACT_MAX_DEPTH = 64;

/**
 * Recursively redacts every string leaf in `value` against `registry`.
 * Returns a NEW value of the same shape; never mutates the input.
 * @param value - Any JSON-serializable value (string, number, boolean,
 *   null, array, plain object). Cycles are clipped at
 *   {@link REDACT_MAX_DEPTH}.
 * @param registry - The run-scoped {@link SecretRegistry}.
 * @returns A redacted copy of `value`.
 */
export function redactValue(value: unknown, registry: SecretRegistry): unknown {
  return walk(value, registry, 0);
}

/**
 * Internal recursive walker. Strings are redacted; arrays + plain objects
 * are recursed into (new collections returned); other primitives pass
 * through.
 * @param value - The current node.
 * @param registry - The {@link SecretRegistry}.
 * @param depth - Current recursion depth.
 * @returns Redacted node.
 */
function walk(value: unknown, registry: SecretRegistry, depth: number): unknown {
  if (depth > REDACT_MAX_DEPTH) return value;
  if (typeof value === "string") return redactSecrets(value, registry);
  if (Array.isArray(value)) return value.map((v) => walk(v, registry, depth + 1));
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value)) {
      out[k] = walk((value as Record<string, unknown>)[k], registry, depth + 1);
    }
    return out;
  }
  return value;
}
