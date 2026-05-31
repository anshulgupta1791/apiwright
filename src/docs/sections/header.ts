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
 * Issue #77: escape HTML-significant chars in user-supplied text that
 * lands in Markdown headings or other contexts a downstream renderer
 * (Hugo, MkDocs, GitHub) might interpret as raw HTML. Without this,
 * an endpoint name like `<script>alert(1)</script>` becomes an XSS
 * vector once the MD is rendered to HTML.
 * @param text - User-supplied text.
 * @returns Same text with `<`, `>`, `&` replaced by HTML entities.
 */
function escapeMd(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Renders the header section.
 * @param ctx - The render context.
 * @returns Markdown header section, no trailing blank line.
 */
export function renderHeader(ctx: RenderContext): string {
  const ep = ctx.endpoint;
  return [
    `# ${escapeMd(ep.name)}`,
    "",
    `- **ID:** \`${escapeMd(ep.id)}\``,
    `- **Method:** \`${escapeMd(ep.method)}\``,
    `- **URL:** \`${escapeMd(ep.url)}\``,
    `- **Source file:** \`${escapeMd(ctx.sourcePath)}\``,
    `- **Environments tested:** _(declared sources only; not tracked in v1.0)_`,
  ].join("\n");
}
