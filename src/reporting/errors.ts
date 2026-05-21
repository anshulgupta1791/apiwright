/**
 * Error taxonomy for the §10 Reporting layer (Task #11).
 *
 * Mirrors the Task #10 RunnerError + Task #8 DbConnectorError pattern:
 * one Error subclass + one frozen codes table + one type-guard.
 */

/** The reporting phase the failure occurred in. */
export type ReportPhase = "render" | "write";

/** Every reporting error code, in alphabetical order. */
export type ReportErrorCode =
  | "REPORT_HTML_RENDER_FAILED"
  | "REPORT_JSON_WRITE_FAILED"
  | "REPORT_JUNIT_RENDER_FAILED"
  | "REPORT_WRITE_FAILED";

/** Frozen const map; key === value. */
export const REPORT_ERROR_CODES: { readonly [K in ReportErrorCode]: K } =
  Object.freeze({
    REPORT_HTML_RENDER_FAILED: "REPORT_HTML_RENDER_FAILED",
    REPORT_JSON_WRITE_FAILED: "REPORT_JSON_WRITE_FAILED",
    REPORT_JUNIT_RENDER_FAILED: "REPORT_JUNIT_RENDER_FAILED",
    REPORT_WRITE_FAILED: "REPORT_WRITE_FAILED",
  } as const);

/** Constructor input for ReportError. */
export interface ReportErrorInit {
  /** One of {@link REPORT_ERROR_CODES}. */
  readonly code: ReportErrorCode;
  /** The phase the failure occurred in. */
  readonly phase: ReportPhase;
  /** Pre-sanitized human-readable message. */
  readonly message: string;
  /** Optional underlying cause. */
  readonly cause?: unknown;
}

/** The single error class for the §10 reporting layer. */
export class ReportError extends Error {
  /** The classification code. */
  readonly code: ReportErrorCode;
  /** The phase the failure occurred in. */
  readonly phase: ReportPhase;

  /**
   * Constructs a redaction-safe reporting error.
   * @param init - The classified, pre-sanitized failure description.
   */
  constructor(init: ReportErrorInit) {
    super(init.message, { cause: init.cause });
    this.name = new.target.name;
    this.code = init.code;
    this.phase = init.phase;
  }
}

/**
 * Type guard: narrows an unknown caught value to {@link ReportError}.
 * @param value - The caught value.
 * @returns True iff `value instanceof ReportError`.
 */
export function isReportError(value: unknown): value is ReportError {
  return value instanceof ReportError;
}
