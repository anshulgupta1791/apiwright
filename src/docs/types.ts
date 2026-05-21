/**
 * Public type vocabulary for the §11 Markdown Documentation Generator
 * (audit blocker 🚨-4). Pure types — coverage-excluded via the
 * `src/(asterisk)(asterisk)/types.ts` glob in configs/vitest.config.ts.
 *
 * Re-uses `DocsOutcome` from `src/cli/seams/docs-generator.ts` so the
 * CLI contract stays single-source-of-truth (the seam was frozen by
 * Task #3 and consumed by Task #11; this module satisfies that frozen
 * shape).
 */

import type { CanonicalEndpoint } from "../core/index.js";

export type { DocsGenerator, DocsOutcome } from "../cli/seams/docs-generator.js";

/**
 * Per-endpoint render context passed to every section renderer. Carries
 * the canonical endpoint plus the file path the endpoint was loaded from
 * (used by the test-coverage section to point at the source).
 */
export interface RenderContext {
  /** The fully-validated canonical endpoint. */
  readonly endpoint: CanonicalEndpoint;
  /** Repo-relative path of the source `.endpoint.json` file. */
  readonly sourcePath: string;
}

/**
 * One loaded endpoint record used during the docs walk. Mirrors the
 * runner's `EndpointLoadRecord` shape but lives here so the docs module
 * does not depend on `src/runner`.
 */
export interface DocsEndpointRecord {
  /** Repo-relative path of the source `.endpoint.json` file. */
  readonly sourcePath: string;
  /** The validated canonical endpoint. */
  readonly endpoint: CanonicalEndpoint;
}
