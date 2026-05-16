/**
 * The single audited JSON-parsing boundary for APIWright. All feature code
 * must call {@link parseJson} instead of `JSON.parse` directly, so untrusted
 * input is parsed in exactly one reviewed place that never throws. The
 * `.semgrep.yml` `raw-json-parse` rule excludes only this file; every other
 * `JSON.parse` is a finding.
 */

/** Discriminated result of {@link parseJson}. */
export type JsonParseResult =
  | { ok: true; value: unknown }
  | { ok: false; error: string };

/**
 * Safely parses a JSON string. Never throws.
 * @param raw - The raw JSON text.
 * @returns `ok:true` with the parsed value, or `ok:false` with a message.
 */
export function parseJson(raw: string): JsonParseResult {
  try {
    return { ok: true, value: JSON.parse(raw) as unknown };
  } catch (err: unknown) {
    /* istanbul ignore next — JSON.parse only throws SyntaxError (an Error) */
    const error = err instanceof Error ? err.message : String(err);
    return { ok: false, error };
  }
}
