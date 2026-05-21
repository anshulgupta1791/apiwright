/**
 * Section renderer: Markers — which markers this endpoint participates in.
 *
 * Per V1_BUILD_SPEC.md §11: "Markers: which markers this endpoint
 * participates in". The endpoint may declare an explicit subset; absent
 * declaration → "all" (which v1.0 expands to smoke + regression per
 * §3 line 436 — `e2e` is v1.5-reserved).
 */

import type { RenderContext } from "../types.js";

/**
 * Renders the markers section.
 * @param ctx - The render context.
 * @returns Markdown markers section.
 */
export function renderMarkers(ctx: RenderContext): string {
  const declared = ctx.endpoint.markers;
  const lines = ["## Markers", ""];
  if (!declared || declared.length === 0) {
    lines.push("_(no explicit declaration — endpoint participates in `smoke` + `regression`)_");
    return lines.join("\n");
  }
  const sorted = [...declared].sort();
  lines.push(`- Declared: ${  sorted.map((m) => `\`${m}\``).join(", ")}`);
  if (ctx.endpoint.tags && ctx.endpoint.tags.length > 0) {
    const tags = [...ctx.endpoint.tags].sort();
    lines.push(`- Tags: ${  tags.map((t) => `\`${t}\``).join(", ")}`);
  }
  if (ctx.endpoint.prod_safe === true) {
    lines.push("- `prod_safe: true` — runnable in `--env=<prod>` smoke selections.");
  }
  return lines.join("\n");
}
