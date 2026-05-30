/**
 * Document composer — assembles the 7 §11 sections into one Markdown
 * document. Pure function; deterministic; no I/O.
 *
 * Spec line 716: "Stable, deterministic output: same inputs produce
 * byte-identical Markdown; safe to commit to git and diff in PRs."
 * Every section renderer is pure (no Date, no random), keys are sorted
 * where present, and this composer joins sections with a single blank
 * line in a FIXED order.
 */

import { renderAuthentication } from "./sections/authentication.js";
import { renderDbEffects } from "./sections/db-effects.js";
import { renderHeader } from "./sections/header.js";
import { renderMarkers } from "./sections/markers.js";
import { renderRequest } from "./sections/request.js";
import { renderResponse } from "./sections/response.js";
import { renderTestCoverage } from "./sections/test-coverage.js";
import type { RenderContext } from "./types.js";

/**
 * Composes the full Markdown document for one endpoint.
 *
 * Section order (per §11 bullet order):
 * 1. Header
 * 2. Authentication
 * 3. Request
 * 4. Response
 * 5. Database side effects
 * 6. Test coverage
 * 7. Markers
 *
 * Sections are joined by a single blank line; the file ends with a
 * single trailing newline (POSIX file convention).
 * @param ctx - The render context.
 * @returns The full Markdown document as a string.
 */
export function composeMarkdown(ctx: RenderContext): string {
  const sections = [
    renderHeader(ctx),
    renderAuthentication(ctx),
    renderRequest(ctx),
    renderResponse(ctx),
    renderDbEffects(ctx),
    renderTestCoverage(ctx),
    renderMarkers(ctx),
  ];
  return `${sections.join("\n\n")}\n`;
}
