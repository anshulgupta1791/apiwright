/**
 * Section renderer: Response — schema, example body, expected status code.
 *
 * Per V1_BUILD_SPEC.md §11: "Response: schema, example response body,
 * expected status code". The expected status is mandatory per the
 * canonical model.
 */

import { renderSchemaTable } from "../schema-table.js";
import type { RenderContext } from "../types.js";

/**
 * Renders the response section.
 * @param ctx - The render context.
 * @returns Markdown response section.
 */
export function renderResponse(ctx: RenderContext): string {
  const res = ctx.endpoint.response;
  const lines = ["## Response", ""];
  lines.push(`- **Expected status:** \`${res.expected_status}\``);
  if (res.sla_ms !== undefined) {
    lines.push(`- **SLA:** ${res.sla_ms} ms`);
  }
  lines.push("");

  if (res.headers && Object.keys(res.headers).length > 0) {
    lines.push("### Expected response headers", "");
    const keys = Object.keys(res.headers).sort();
    lines.push("| Header | Value |");
    lines.push("| --- | --- |");
    for (const k of keys) {
      const v = res.headers[k] ?? "";
      lines.push(`| \`${k}\` | \`${v}\` |`);
    }
    lines.push("");
  }

  lines.push("### Body schema", "");
  lines.push(renderSchemaTable(res.schema));
  return lines.join("\n");
}
