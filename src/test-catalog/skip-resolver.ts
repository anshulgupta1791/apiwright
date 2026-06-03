/**
 * SkipResolver — evaluates `skip_cases` token lists against generated TestCases
 * to determine whether a case should be omitted from the plan.
 *
 * Design decisions honoured:
 *   DD-1  Malformed tokens warn but never throw.
 *   DD-4  `matchSkip` returns the winning token string; `shouldSkip` is `matchSkip !== null`.
 *   DD-5  `(kind, field)` is sufficient as case identity; ordinals are NOT used.
 *   DD-6  `extractFieldFromCase` is a private helper inside this file.
 *   DD-7  `ALL_SKIPPABLE_KINDS` is a `ReadonlySet<SkippableKind>` with exactly 16 entries.
 *   DD-8  "matched zero cases" warning per token that parsed + kind known but caused zero skips.
 *   DD-9  Kind matching is case-SENSITIVE, trim-NONE.
 */

import type { TestCase } from "./types.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * All kinds that can appear in a `skip_cases` or `skip_globally` token list.
 * Exactly 15 §3 generated kinds plus the `"assertion"` sentinel = 16 total.
 */
export type SkippableKind =
  | "status_code_conformance"
  | "content_type_alignment"
  | "response_time_sla"
  | "response_schema_validation"
  | "auth_happy_path"
  | "no_auth_returns_401"
  | "garbage_token_returns_401"
  | "method_not_allowed"
  | "malformed_json_returns_400"
  | "required_field_omission_returns_400"
  | "type_violation_returns_400"
  | "boundary_battery"
  | "get_idempotency"
  | "delete_idempotency"
  | "db_state_matches_expectation"
  | "assertion";

/**
 * The complete set of skippable kinds — 15 §3 generated types plus the
 * `"assertion"` sentinel. Exported as a frozen `ReadonlySet` so consumers
 * can check membership without depending on the union type narrowing.
 *
 * Invariant: `ALL_SKIPPABLE_KINDS.size === 16`.
 */
export const ALL_SKIPPABLE_KINDS: ReadonlySet<SkippableKind> = new Set<SkippableKind>([
  "status_code_conformance",
  "content_type_alignment",
  "response_time_sla",
  "response_schema_validation",
  "auth_happy_path",
  "no_auth_returns_401",
  "garbage_token_returns_401",
  "method_not_allowed",
  "malformed_json_returns_400",
  "required_field_omission_returns_400",
  "type_violation_returns_400",
  "boundary_battery",
  "get_idempotency",
  "delete_idempotency",
  "db_state_matches_expectation",
  "assertion",
]);

/**
 * Result returned by `SkipResolver.validateSkipTokens`.
 *
 * - `recognized`: tokens that parsed successfully AND whose kind is in `allKnownKinds`.
 * - `unrecognized`: tokens that parsed successfully but whose kind is not in `allKnownKinds`.
 * - `warnings`: human-readable messages for malformed tokens and unrecognized kinds.
 *
 * Ordering within `recognized` and `unrecognized` mirrors the input token order.
 */
export interface SkipValidationResult {
  /** Tokens with a valid, recognized kind (preserves input order). */
  readonly recognized: readonly string[];
  /** Tokens with a valid but unrecognized kind (preserves input order). */
  readonly unrecognized: readonly string[];
  /** Warning strings for malformed and unrecognized-kind tokens. */
  readonly warnings: readonly string[];
}

// ---------------------------------------------------------------------------
// Internal parse result
// ---------------------------------------------------------------------------

/** Internal: a successfully-parsed token. */
interface ParsedToken {
  readonly ok: true;
  readonly kind: string;
  readonly field: string | undefined;
}

/** Internal: a malformed token with the reason it was rejected. */
interface MalformedToken {
  readonly ok: false;
  readonly reason: "empty" | "leading_colon" | "trailing_colon" | "multiple_colons";
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Parses a single skip token into either a `ParsedToken` or a `MalformedToken`.
 * Grammar: `kind` or `kind:field`. Single colon only; neither side may be empty.
 * @param token - The raw string from `skip_cases` or `skip_globally`.
 * @returns A discriminated parse result.
 */
function parseSkipToken(token: string): ParsedToken | MalformedToken {
  if (token.trim() === "") {
    return { ok: false, reason: "empty" };
  }

  const colons = (token.match(/:/g) ?? []).length;

  if (colons > 1) {
    return { ok: false, reason: "multiple_colons" };
  }

  if (colons === 0) {
    return { ok: true, kind: token, field: undefined };
  }

  // Exactly one colon
  if (token.startsWith(":")) {
    return { ok: false, reason: "leading_colon" };
  }
  if (token.endsWith(":")) {
    return { ok: false, reason: "trailing_colon" };
  }

  const colonIdx = token.indexOf(":");
  return { ok: true, kind: token.slice(0, colonIdx), field: token.slice(colonIdx + 1) };
}

/**
 * Extracts the field value from a TestCase for the three kinds that carry
 * a field qualifier. Returns `undefined` for all other kinds.
 *
 * Field carriers (per design DD-6):
 * `required_field_omission_returns_400` → `params.omitted_field`,
 * `type_violation_returns_400` → `params.field`,
 * `boundary_battery` → `params.field`.
 * @param tc - The TestCase to inspect.
 * @returns The field value if the kind is a field-carrier; `undefined` otherwise.
 */
function extractFieldFromCase(tc: TestCase): string | undefined {
  if (tc.params.kind === "required_field_omission_returns_400") {
    return tc.params.omitted_field;
  }
  if (tc.params.kind === "type_violation_returns_400" || tc.params.kind === "boundary_battery") {
    return tc.params.field;
  }
  // EXTEND THIS FUNCTION when adding a new field-carrying kind to TestCaseParams.
  // `kind:field` skip tokens for the new kind will SILENTLY no-match-as-field
  // (i.e. behave like a bare-kind skip) until this function knows the field
  // discriminant. See PR #2-#7 (v1.0.2) which add multiple new generators.
  return undefined;
}

// ---------------------------------------------------------------------------
// SkipResolver
// ---------------------------------------------------------------------------

/**
 * Evaluates `skip_cases` token lists against generated TestCases to determine
 * which cases the plan generator should omit.
 *
 * Stateless: construct once and reuse across many `shouldSkip`/`matchSkip` calls.
 * All methods are pure and total — they never throw and never mutate their inputs.
 *
 * Token grammar: `kind` or `kind:field` (single colon, neither side empty).
 * Malformed tokens warn but never throw (DD-1). Kind matching is case-sensitive (DD-9).
 */
export class SkipResolver {
  /**
   * Returns `true` if the test case should be skipped given the endpoint-level
   * and global skip token lists. Implemented as `matchSkip(...) !== null`.
   * @param tc - The generated TestCase.
   * @param endpointSkips - Endpoint-level `skip_cases` tokens (may be empty).
   * @param globalSkips - Config-level `skip_globally` tokens (may be empty).
   * @returns `true` when any token in either list matches the case.
   */
  shouldSkip(
    tc: TestCase,
    endpointSkips: readonly string[],
    globalSkips: readonly string[],
  ): boolean {
    return this.matchSkip(tc, endpointSkips, globalSkips) !== null;
  }

  /**
   * Returns the first token that matches the test case, or `null` if no token
   * in either list matches.
   *
   * The endpoint skip list is scanned first (in order), then the global list.
   * Within each list, the first matching token wins.
   * @param tc - The generated TestCase.
   * @param endpointSkips - Endpoint-level `skip_cases` tokens (may be empty).
   * @param globalSkips - Config-level `skip_globally` tokens (may be empty).
   * @returns The first matching token string, or `null`.
   */
  matchSkip(
    tc: TestCase,
    endpointSkips: readonly string[],
    globalSkips: readonly string[],
  ): string | null {
    for (const token of endpointSkips) {
      if (this.#matchesToken(tc, token)) return token;
    }
    for (const token of globalSkips) {
      if (this.#matchesToken(tc, token)) return token;
    }
    return null;
  }

  /**
   * Validates a list of skip tokens against the set of recognized kinds.
   *
   * For each token: malformed → warning with reason; unrecognized kind →
   * warning with `unknown skip kind` text; valid → added to `recognized`.
   * Field values in `kind:field` tokens are NOT validated — only the kind.
   * @param tokens - The raw token strings to validate.
   * @param allKnownKinds - The set of kinds considered recognized for this scope.
   * @param scopeLabel - Human-readable label included verbatim in warnings.
   * @returns A `SkipValidationResult` with recognized/unrecognized arrays + warnings.
   */
  validateSkipTokens(
    tokens: readonly string[],
    allKnownKinds: ReadonlySet<string>,
    scopeLabel: string,
  ): SkipValidationResult {
    const recognized: string[] = [];
    const unrecognized: string[] = [];
    const warnings: string[] = [];

    for (const token of tokens) {
      const parsed = parseSkipToken(token);
      if (!parsed.ok) {
        warnings.push(
          `${scopeLabel}: malformed skip token '${token}' (${parsed.reason}); ignored.`,
        );
        unrecognized.push(token);
        continue;
      }

      if (!allKnownKinds.has(parsed.kind)) {
        warnings.push(
          `${scopeLabel}: unknown skip kind '${parsed.kind}' in token '${token}'; ignored.`,
        );
        unrecognized.push(token);
        continue;
      }

      recognized.push(token);
    }

    return { recognized, unrecognized, warnings };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Tests whether a single token matches a test case.
   * Malformed tokens always return `false` (DD-1).
   * @param tc - The TestCase to match against.
   * @param token - A single raw skip token.
   * @returns `true` when the token matches the case's kind (and field, if present).
   */
  #matchesToken(tc: TestCase, token: string): boolean {
    const parsed = parseSkipToken(token);
    if (!parsed.ok) return false;

    if (parsed.kind !== tc.params.kind) return false;

    if (parsed.field !== undefined) {
      return extractFieldFromCase(tc) === parsed.field;
    }

    return true;
  }
}
