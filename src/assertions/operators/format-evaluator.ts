/**
 * Layer-C format-operator evaluator: implements `is_uuid_v4`, `is_email`,
 * `is_url`, `is_iso_timestamp`, and `is_recent_timestamp`. Pure, deterministic,
 * total, NEVER throws (assuming `AjvFormatCheck` doesn't throw on `isValid`).
 */

import type { ResolvedValue } from "../target-resolver.js";
import type { EvaluationContext, GroupOutcome } from "../types.js";

import { AjvFormatCheck } from "./ajv-format-check.js";

/**
 * The five format operators this evaluator handles.
 * String-literal union (repo idiom, no enum).
 */
export type FormatOperator =
  | "is_uuid_v4"
  | "is_iso_timestamp"
  | "is_recent_timestamp"
  | "is_email"
  | "is_url";

/**
 * Symmetric time window (ms) for `is_recent_timestamp`. A timestamp is
 * "recent" if `|ts - now| <= RECENT_WINDOW_MS`. Named constant per the
 * `no-magic-numbers` rule.
 */
export const RECENT_WINDOW_MS = 300000; // 5 minutes

/** Maximum length before truncating string actuals in reports. */
const MAX_ACTUAL_LENGTH = 300;

/** UUID v4 regex: 8-4-4-4-12, version nibble=4, variant nibble in [89ab]. */
const UUID_V4_RE = /^(?:urn:uuid:)?[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Version nibble regex: extracts the 5th block's first char. */
const UUID_VERSION_RE = /^(?:urn:uuid:)?[0-9a-f]{8}-[0-9a-f]{4}-([0-9a-f])[0-9a-f]{3}-/i;

/** Variant nibble regex: extracts the 4th group's first char. */
const UUID_VARIANT_RE = /^(?:urn:uuid:)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-([0-9a-f])/i;

/**
 * Build a safe, bounded string descriptor for `actual` fields.
 * @param value - The value to describe (any type).
 * @returns A bounded string representation safe for use in assertion results.
 */
function safeActual(value: unknown): string {
  if (value === null || value === undefined) return String(value);
  if (typeof value !== "string") return `<${typeof value}>`;
  return value.length > MAX_ACTUAL_LENGTH
    ? `${value.slice(0, MAX_ACTUAL_LENGTH)}…`
    : value;
}

/**
 * Build a passing GroupOutcome.
 * @param expected - The expected format descriptor.
 * @param actual - The bounded string of the actual value.
 * @returns A passing GroupOutcome.
 */
function passOk(expected: unknown, actual: unknown): GroupOutcome {
  return { pass: true, expected, actual };
}

/**
 * Build a failing GroupOutcome.
 * @param expected - The expected format descriptor.
 * @param actual - The bounded string of the actual value.
 * @param failureCode - The machine-readable failure code.
 * @param reason - The human-readable failure reason.
 * @returns A failing GroupOutcome.
 */
function failWith(
  expected: unknown,
  actual: unknown,
  failureCode: NonNullable<GroupOutcome["failureCode"]>,
  reason: string,
): GroupOutcome {
  return { pass: false, expected, actual, failureCode, reason };
}

/**
 * Evaluates format assertions (`is_uuid_v4`, `is_email`, `is_url`,
 * `is_iso_timestamp`, `is_recent_timestamp`). Accepts an optional
 * `AjvFormatCheck` injection for testing. NEVER throws.
 */
export class FormatEvaluator {
  readonly #ajv: AjvFormatCheck;

  /**
   * Constructs the evaluator with an optional `AjvFormatCheck` seam.
   * @param ajv - Optional injected format checker; defaults to a new one.
   */
  constructor(ajv?: AjvFormatCheck) {
    this.#ajv = ajv ?? new AjvFormatCheck();
  }

  /**
   * Evaluate one format assertion.
   * @param op - The format operator.
   * @param lhs - The resolved LHS value.
   * @param context - The evaluation context (supplies `now` for recency).
   * @returns A {@link GroupOutcome}.
   */
  evaluate(op: FormatOperator, lhs: ResolvedValue, context: EvaluationContext): GroupOutcome {
    if (!lhs.found) {
      return failWith(
        op,
        "<missing>",
        "TARGET_NOT_FOUND",
        `Target not found for '${op}'`,
      );
    }
    const value = lhs.value;
    if (typeof value !== "string") {
      return failWith(
        op,
        safeActual(value),
        "TYPE_MISMATCH",
        `'${op}' requires a string, got '${typeof value}'`,
      );
    }

    if (op === "is_uuid_v4") return this.#checkUuidV4(value);
    if (op === "is_email") return this.#checkEmail(value);
    if (op === "is_url") return this.#checkUrl(value);
    if (op === "is_iso_timestamp") return this.#checkIsoTimestamp(value);
    return this.#checkRecentTimestamp(value, context.now ?? Date.now());
  }

  /**
   * Validate UUID v4: shape (via regex), version nibble = '4', variant
   * nibble in [89abAB].
   * @param value - The string to validate.
   * @returns GroupOutcome.
   */
  #checkUuidV4(value: string): GroupOutcome {
    if (!this.#ajv.isValid("uuid", value)) {
      return failWith(value, safeActual(value), "FORMAT_INVALID", "Not a valid UUID format");
    }
    if (!UUID_V4_RE.test(value)) {
      // Check version nibble first
      const versionMatch = UUID_VERSION_RE.exec(value);
      const vNibble = versionMatch ? versionMatch[1] : "";
      if (vNibble !== "4") {
        return failWith(
          "UUID v4 (version nibble=4)",
          safeActual(value),
          "FORMAT_INVALID",
          `UUID version nibble is '${vNibble}', expected '4' for v4`,
        );
      }
      // Check variant nibble
      const variantMatch = UUID_VARIANT_RE.exec(value);
      const varNibble = (variantMatch?.[1] ?? "").toLowerCase();
      return failWith(
        "UUID v4 (variant nibble 8/9/a/b)",
        safeActual(value),
        "FORMAT_INVALID",
        `UUID variant nibble '${varNibble}' is not in [8,9,a,b]`,
      );
    }
    return passOk("UUID v4", safeActual(value));
  }

  /**
   * Validate email using Ajv full mode.
   * @param value - The string to validate.
   * @returns GroupOutcome.
   */
  #checkEmail(value: string): GroupOutcome {
    if (!this.#ajv.isValid("email", value)) {
      return failWith(
        "valid email",
        safeActual(value),
        "FORMAT_INVALID",
        `Not a valid email: ${safeActual(value)}`,
      );
    }
    return passOk("valid email", safeActual(value));
  }

  /**
   * Validate URI (scheme required) using Ajv full mode.
   * @param value - The string to validate.
   * @returns GroupOutcome.
   */
  #checkUrl(value: string): GroupOutcome {
    if (!this.#ajv.isValid("uri", value)) {
      return failWith(
        "valid URI",
        safeActual(value),
        "FORMAT_INVALID",
        `Not a valid URI: ${safeActual(value)}`,
      );
    }
    return passOk("valid URI", safeActual(value));
  }

  /**
   * Validate ISO 8601 / RFC 3339 date-time with required timezone.
   * @param value - The string to validate.
   * @returns GroupOutcome.
   */
  #checkIsoTimestamp(value: string): GroupOutcome {
    if (!this.#ajv.isValid("date-time", value)) {
      return failWith(
        "ISO 8601 date-time with timezone",
        safeActual(value),
        "FORMAT_INVALID",
        `Not a valid ISO 8601 date-time: ${safeActual(value)}`,
      );
    }
    return passOk("ISO 8601 date-time", safeActual(value));
  }

  /**
   * Validate that the ISO 8601 timestamp is within ±`RECENT_WINDOW_MS` of `now`.
   * @param value - The string to validate.
   * @param now - The reference epoch milliseconds.
   * @returns GroupOutcome.
   */
  #checkRecentTimestamp(value: string, now: number): GroupOutcome {
    if (!this.#ajv.isValid("date-time", value)) {
      return failWith(
        "recent ISO 8601 timestamp",
        safeActual(value),
        "FORMAT_INVALID",
        `Not a valid ISO 8601 date-time: ${safeActual(value)}`,
      );
    }
    const parsed = Date.parse(value);
    const delta = Math.abs(parsed - now);
    if (delta > RECENT_WINDOW_MS) {
      return failWith(
        `within ${RECENT_WINDOW_MS}ms of now`,
        safeActual(value),
        "FORMAT_INVALID",
        `Timestamp is ${delta}ms from now (max ${RECENT_WINDOW_MS}ms)`,
      );
    }
    return passOk(`within ${RECENT_WINDOW_MS}ms of now`, safeActual(value));
  }
}
