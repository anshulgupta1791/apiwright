/**
 * Public barrel for the §11 Markdown Documentation Generator (audit
 * blocker 🚨-4). Consumers (the CLI `apiwright docs generate` command)
 * import EVERYTHING from here, never deep `src/docs/**` paths.
 *
 * Section renderers, the composer, and the schema-to-table helper stay
 * INTERNAL — only the orchestrator class `MarkdownDocsGenerator` plus
 * the error taxonomy are public. Mirrors the §10 Reporting barrel.
 */

export { MarkdownDocsGenerator } from "./generator.js";
export type { MarkdownDocsGeneratorOptions } from "./generator.js";

export {
  DOCS_ERROR_CODES,
  DocsError,
  isDocsError,
} from "./errors.js";
export type {
  DocsErrorCode,
  DocsErrorInit,
  DocsPhase,
} from "./errors.js";

// Re-export the seam types so CLI consumers can `import { DocsGenerator }
// from "src/docs"` without a second import line.
export type { DocsGenerator, DocsOutcome } from "./types.js";
