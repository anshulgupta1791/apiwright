/**
 * Public type vocabulary for the §10 Reporting layer (Task #11).
 *
 * Reuses {@link RunResult} from the §9 runner verbatim — reporting is a pure
 * consumer of the run-time data, it does not redefine the shapes. Per-format
 * options (HTML title, JUnit suite-name prefix, etc.) live alongside.
 *
 * Coverage exclusion: this file matches the src/(asterisk)(asterisk)/types.ts
 * glob in configs/vitest.config.ts; it carries no runtime statements.
 */

import type {
  AttemptResult,
  EndpointResult,
  RequestRecord,
  ResponseRecord,
  RunResult,
} from "../runner/index.js";

export type { AttemptResult, EndpointResult, RequestRecord, ResponseRecord, RunResult };

/** Which subset of formats to emit for a single run. Mirrors ReportConfig. */
export interface ReportTargets {
  /** Emit the HTML technical report. */
  readonly html: boolean;
  /** Emit the JSON sidecar. */
  readonly json: boolean;
  /** Emit the JUnit XML report. */
  readonly junit_xml: boolean;
}

/** Output of one rendering pass — emitted file paths grouped by format. */
export interface ReportArtifacts {
  /** Absolute path to the JSON sidecar (omitted if json:false). */
  readonly json?: string;
  /** Absolute path to the HTML report (omitted if html:false). */
  readonly html?: string;
  /** Absolute path to the JUnit XML (omitted if junit_xml:false). */
  readonly junit_xml?: string;
}

/** Configuration for the {@link RunReporter}. */
export interface RunReporterConfig {
  /** Output directory for all emitted files. */
  readonly reportsDir: string;
  /** Which formats to emit. */
  readonly targets: ReportTargets;
  /** Optional custom basename (no extension) for the run reports. */
  readonly basename?: string;
}
