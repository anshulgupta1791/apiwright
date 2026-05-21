/**
 * Section renderer: Request — schema rendered as table + example payload.
 *
 * Per V1_BUILD_SPEC.md §11: "Request: schema rendered as readable table,
 * example payload". The schema is rendered via {@link renderSchemaTable}
 * and the example is pretty-printed with deterministic key ordering.
 */

import { renderSchemaTable } from "../schema-table.js";
import type { RenderContext } from "../types.js";

/**
 * Renders the request section.
 * @param ctx - The render context.
 * @returns Markdown request section.
 */
export function renderRequest(ctx: RenderContext): string {
  const req = ctx.endpoint.request;
  const lines = ["## Request", ""];

  if (req.headers && Object.keys(req.headers).length > 0) {
    lines.push("### Headers", "");
    const keys = Object.keys(req.headers).sort();
    lines.push("| Header | Value |");
    lines.push("| --- | --- |");
    for (const k of keys) {
      const v = req.headers[k] ?? "";
      lines.push(`| \`${k}\` | \`${v}\` |`);
    }
    lines.push("");
  }

  lines.push("### Body schema", "");
  lines.push(renderSchemaTable(req.body_schema));
  lines.push("");

  if (req.body_example !== undefined) {
    lines.push("### Example payload", "");
    lines.push("```json");
    lines.push(JSON.stringify(req.body_example, null, 2));
    lines.push("```");
  } else {
    lines.push("### Example payload", "", "_(no example declared)_");
  }

  return lines.join("\n");
}
