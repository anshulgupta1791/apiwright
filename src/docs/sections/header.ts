/**
 * Section renderer: endpoint header (name, URL, method, environments).
 *
 * Per §11: "Header: endpoint name, URL, method,
 * environments tested". "Environments tested" is not derivable from the
 * canonical endpoint (the framework doesn't track per-endpoint env
 * coverage), so the renderer emits a "_(declared environments not
 * tracked in v1.0)_" placeholder honouring the spec's "declared sources
 * only — no observation store in v1.0" guidance (line 707).
 */

import type { RenderContext } from "../types.js";

/**
 * Renders the header section.
 * @param ctx - The render context.
 * @returns Markdown header section, no trailing blank line.
 */
export function renderHeader(ctx: RenderContext): string {
  const ep = ctx.endpoint;
  return [
    `# ${ep.name}`,
    "",
    `- **ID:** \`${ep.id}\``,
    `- **Method:** \`${ep.method}\``,
    `- **URL:** \`${ep.url}\``,
    `- **Source file:** \`${ctx.sourcePath}\``,
    `- **Environments tested:** _(declared sources only; not tracked in v1.0)_`,
  ].join("\n");
}
