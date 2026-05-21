/**
 * Error taxonomy for the §11 Markdown Documentation Generator.
 *
 * Mirrors the established Task #8/#9/#10/#11 pattern: one Error subclass
 * + one frozen codes table + one isXError type guard. All error messages
 * are pre-sanitized by the caller and contain NO secrets / credentials.
 */

/** Lifecycle phase the failure occurred in. */
export type DocsPhase = "discovery" | "load" | "render" | "write";

/** Every docs-generator error code, in alphabetical order. */
export type DocsErrorCode =
  | "DOCS_ENDPOINT_LOAD_FAILED"
  | "DOCS_RENDER_FAILED"
  | "DOCS_SOURCE_DIR_EMPTY"
  | "DOCS_WRITE_FAILED";

/** Frozen const map: every code → its literal string value. */
export const DOCS_ERROR_CODES: { readonly [K in DocsErrorCode]: K } =
  Object.freeze({
    DOCS_ENDPOINT_LOAD_FAILED: "DOCS_ENDPOINT_LOAD_FAILED",
    DOCS_RENDER_FAILED: "DOCS_RENDER_FAILED",
    DOCS_SOURCE_DIR_EMPTY: "DOCS_SOURCE_DIR_EMPTY",
    DOCS_WRITE_FAILED: "DOCS_WRITE_FAILED",
  } as const);

/** Constructor input for {@link DocsError}. */
export interface DocsErrorInit {
  /** Stable code from {@link DOCS_ERROR_CODES}. */
  readonly code: DocsErrorCode;
  /** Phase the failure occurred in. */
  readonly phase: DocsPhase;
  /** Pre-sanitized, secret-free human-readable message. */
  readonly message: string;
  /** Optional underlying cause (preserves Error.cause chain). */
  readonly cause?: unknown;
}

/**
 * The single error class for the §11 docs generator. Subclass of native
 * Error so `instanceof Error` is true; carries `code` + `phase` for
 * structured downstream handling.
 */
export class DocsError extends Error {
  /** Classification code; one of {@link DOCS_ERROR_CODES}. */
  readonly code: DocsErrorCode;
  /** The lifecycle phase the failure occurred in. */
  readonly phase: DocsPhase;

  /**
   * Builds a secret-free docs error.
   * @param init - Classified, pre-sanitized failure description.
   */
  constructor(init: DocsErrorInit) {
    super(init.message, { cause: init.cause });
    this.name = new.target.name;
    this.code = init.code;
    this.phase = init.phase;
  }
}

/**
 * Type guard: narrows an unknown caught value to {@link DocsError}.
 * @param value - The caught value to test.
 * @returns `true` iff `value instanceof DocsError`.
 */
export function isDocsError(value: unknown): value is DocsError {
  return value instanceof DocsError;
}
