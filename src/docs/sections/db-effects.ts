/**
 * Section renderer: Database side effects.
 *
 * Per §11: "Database side effects: tables / collections /
 * nodes referenced in `db_verify`". The renderer surfaces every
 * `CanonicalDbVerification` entry with its connection, query_id, expect
 * mode, and a verbatim query block. A `cleanup` entry (if present) is
 * surfaced too so consumers see the full lifecycle.
 */

import type { CanonicalDbVerification } from "../../core/canonical-model.js";
import type { RenderContext } from "../types.js";

/**
 * Renders the DB side-effects section.
 * @param ctx - The render context.
 * @returns Markdown DB side-effects section.
 */
export function renderDbEffects(ctx: RenderContext): string {
  const verifications = ctx.endpoint.db_verify ?? [];
  const cleanup = ctx.endpoint.cleanup;
  if (verifications.length === 0 && !cleanup) {
    return ["## Database side effects", "", "_(none declared)_"].join("\n");
  }
  const lines = ["## Database side effects", ""];
  for (let i = 0; i < verifications.length; i++) {
    lines.push(...renderVerification(verifications[i], i + 1));
  }
  if (cleanup) {
    lines.push("### Cleanup", "");
    lines.push(`- **Connection:** \`${cleanup.connection}\``);
    lines.push("");
    lines.push("```sql");
    lines.push(cleanup.query);
    lines.push("```");
  }
  return lines.join("\n");
}

/**
 * Renders one verification block.
 * @param v - The verification entry (may be undefined for defensive paths).
 * @param ordinal - 1-based position in the db_verify array.
 * @returns Lines for the verification block.
 */
function renderVerification(
  v: CanonicalDbVerification | undefined,
  ordinal: number,
): readonly string[] {
  /* istanbul ignore next — `for` iteration is in-bounds; defensive guard. */
  if (!v) return [];
  const qid = v.query_id ?? `(q${ordinal})`;
  const lines: string[] = [
    `### Verification #${ordinal} — \`${v.connection}.${qid}\``,
    "",
    `- **Connection:** \`${v.connection}\``,
    `- **Query ID:** \`${qid}\``,
    `- **Expect mode:** \`${v.expect}\``,
  ];
  if (v.fields && Object.keys(v.fields).length > 0) {
    const keys = Object.keys(v.fields).sort();
    lines.push(`- **Expected fields:** ${keys.map((k) => `\`${k}\``).join(", ")}`);
  }
  lines.push("", "```sql", v.query, "```", "");
  return lines;
}
