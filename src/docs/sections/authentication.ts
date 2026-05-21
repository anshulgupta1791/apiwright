/**
 * Section renderer: Authentication — strategy name + what it requires.
 *
 * Per V1_BUILD_SPEC.md §11: "Authentication: strategy name and what it
 * requires". The endpoint declares only a strategy NAME (resolved from
 * env YAML at run time); the docs renderer therefore states the name and
 * notes the env-side configuration lookup. When `auth_strategy` is
 * absent the renderer says so (anonymous endpoint).
 */

import type { RenderContext } from "../types.js";

/**
 * Renders the authentication section.
 * @param ctx - The render context.
 * @returns Markdown auth section.
 */
export function renderAuthentication(ctx: RenderContext): string {
  const name = ctx.endpoint.auth_strategy;
  const lines = ["## Authentication", ""];
  if (!name) {
    lines.push("_Anonymous — no `auth_strategy` declared on this endpoint._");
    return lines.join("\n");
  }
  lines.push(
    `- **Strategy name:** \`${name}\``,
    "- **Requirements:** see the matching entry under `auth_strategies:` in your",
    "  environment YAML (e.g. `environments/qa.yaml`). The framework resolves the",
    "  configured `static_token` or `token_endpoint` block at run start.",
  );
  return lines.join("\n");
}
