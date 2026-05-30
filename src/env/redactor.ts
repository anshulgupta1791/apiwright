/**
 * Log/report secret redaction. Replaces every value recorded in a
 * {@link SecretRegistry} with `[REDACTED]` before serialization so resolved
 * secrets never reach logs or reports. See §8.
 *
 * Values are replaced longest-first so a secret that is a substring of another
 * recorded secret cannot corrupt the longer one's match. Pure; never throws.
 * The application of this redactor to every log/report output is wired by the
 * runner/reporting layer (Task #10 §10); this module is the standalone,
 * unit-testable redaction primitive the spec mandates for v1.0.
 */

import type { SecretRegistry } from "./secrets.js";

/** The fixed token written in place of any recorded secret value. */
export const REDACTION_PLACEHOLDER = "[REDACTED]";

/**
 * Redacts every recorded secret value from `text`.
 * @param text - The serialized log/report text to scrub.
 * @param registry - The registry of resolved secret values to remove.
 * @returns `text` with every recorded secret value replaced by `[REDACTED]`.
 */
export function redactSecrets(text: string, registry: SecretRegistry): string {
  const values = [...registry.values()].sort((a, b) => b.length - a.length);
  let out = text;
  for (const secret of values) {
    if (secret.length === 0) continue;
    out = out.replaceAll(secret, REDACTION_PLACEHOLDER);
  }
  return out;
}
