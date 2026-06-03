/**
 * Variant-enrichment helpers for STATUS_EQ_KINDS verdict computation.
 *
 * When a test case expects status E but the server returns status A (a mismatch),
 * and the endpoint declares a `response_variants` map with a key `String(A)`, these
 * helpers annotate the failure reason with additional context about whether the
 * response body conforms to the declared variant schema.
 *
 * Design decisions pinned:
 *   DD-2  Lookup uses exact decimal-string match (`String(status)`).
 *   DD-3  No wildcard keys — exact match only.
 *   DD-4  Variant lookup SUPPRESSED when actual === expected (pass case).
 *   DD-5  Enrichment applies ONLY to STATUS_EQ_KINDS (caller's responsibility).
 *   DD-6  Variant match → fail with enriched reason; verdict remains "fail".
 *   DD-10 Forward-compat: variant value with no `schema` → "documented variant" reason.
 */

import type { ResponseVariantMap } from "../../core/canonical-model.js";
import type { SchemaValidator } from "../../core/schema-validator.js";

import type { VerdictResult } from "./verdicts.js";

// ---------------------------------------------------------------------------
// Exported functions
// ---------------------------------------------------------------------------

/**
 * Looks up a variant by exact decimal-string match of `actualStatus` in `variants`.
 *
 * Returns `undefined` when:
 *   - `variants` is absent, null, or not a plain object.
 *   - No key matching `String(actualStatus)` exists in `variants`.
 *
 * NOTE: This function does NOT suppress the lookup when `actualStatus === expectedStatus`.
 * That suppression is the caller's responsibility (DD-4). This function is a pure
 * map lookup with defensive guards.
 * @param variants - The `response_variants` map from the endpoint, or undefined.
 * @param actualStatus - The HTTP status code to look up (converted to string key).
 * @returns The matching {@link ResponseVariant} when found; `undefined` otherwise.
 */
export function lookupVariantSchema(
  variants: ResponseVariantMap | null | undefined,
  actualStatus: number,
): import("../../core/canonical-model.js").ResponseVariant | undefined {
  // Defensive guard: null / array / non-object (DD-9 prevents this at load time)
  if (!variants || typeof variants !== "object" || Array.isArray(variants)) {
    return undefined;
  }
  const key = String(actualStatus);
  const variant = (variants as Record<string, unknown>)[key];
  if (variant === undefined || variant === null || typeof variant !== "object") {
    return undefined;
  }
  return variant as import("../../core/canonical-model.js").ResponseVariant;
}

/**
 * Computes a verdict for a STATUS_EQ kind with optional variant-schema enrichment.
 *
 * Verdict logic:
 *   1. `actual === expected` → pass (DD-4: no variant lookup).
 *   2. `actual !== expected`, no variant declared → fail with plain reason.
 *   3. `actual !== expected`, variant declared, body matches schema → fail with
 *      "matched declared variant schema for <A>" reason.
 *   4. `actual !== expected`, variant declared, body fails schema → fail with
 *      "did not match declared variant schema for <A>: <ajv-error-detail>" reason.
 *   5. `actual !== expected`, variant declared but no `schema` field → fail with
 *      "status <A> is a documented variant" reason (DD-10 forward-compat).
 * @param actualStatus - The HTTP status code returned by the server.
 * @param expectedStatus - The expected HTTP status code from the test case.
 * @param responseBody - The parsed response body (may be undefined or null).
 * @param variants - The endpoint's `response_variants` map (or undefined).
 * @param validator - A {@link SchemaValidator} instance for body validation.
 * @returns A {@link VerdictResult} with the computed verdict and optional reason.
 */
export function statusEqWithVariantEnrichment(
  actualStatus: number,
  expectedStatus: number,
  responseBody: unknown,
  variants: ResponseVariantMap | null | undefined,
  validator: SchemaValidator,
): VerdictResult {
  // DD-4: pass immediately when actual matches expected — no variant lookup.
  if (actualStatus === expectedStatus) {
    return { verdict: "pass" };
  }

  // Status mismatch — look up a declared variant.
  const variant = lookupVariantSchema(variants, actualStatus);

  if (variant === undefined) {
    // No variant declared for this status → plain reason.
    return {
      verdict: "fail",
      reason: `expected status ${expectedStatus}, got ${actualStatus}`,
    };
  }

  // DD-10: variant declared but no schema field → "documented variant" reason.
  // Cast through unknown to handle forward-compat runtime values that bypass TypeScript.
  const variantSchema = (variant as unknown as Record<string, unknown>)["schema"];
  if (variantSchema === undefined || variantSchema === null) {
    return {
      verdict: "fail",
      reason:
        `expected status ${expectedStatus}, got ${actualStatus}` +
        ` (status ${actualStatus} is a documented variant)`,
    };
  }

  // Variant has a schema — validate the response body against it.
  const outcome = validator.validateBodyAgainstSchema(
    variantSchema as Record<string, unknown>,
    responseBody,
  );

  if (outcome.valid) {
    return {
      verdict: "fail",
      reason:
        `expected status ${expectedStatus}, got ${actualStatus}` +
        ` (response body matched declared variant schema for ${actualStatus})`,
    };
  }

  const errorDetail = [...outcome.errors].join("; ");
  return {
    verdict: "fail",
    reason:
      `expected status ${expectedStatus}, got ${actualStatus}` +
      ` (response body did not match declared variant schema for ${actualStatus}: ${errorDetail})`,
  };
}

/**
 * Dispatch function for STATUS_EQ_KINDS: delegates to
 * {@link statusEqWithVariantEnrichment} with the endpoint's `response_variants`.
 *
 * This is the single call-site used by `computeVerdict` in `case-runners.ts` for
 * all nine STATUS_EQ_KINDS. Centralising the dispatch here keeps `case-runners.ts`
 * free of variant-enrichment concerns.
 * @param actualStatus - The HTTP status code returned by the server.
 * @param expectedStatus - The expected status from the test case params.
 * @param responseBody - The parsed response body.
 * @param variants - The endpoint's `response_variants` map (or undefined).
 * @param validator - Shared {@link SchemaValidator} instance.
 * @returns A {@link VerdictResult}.
 */
export function statusEqDispatch(
  actualStatus: number,
  expectedStatus: number,
  responseBody: unknown,
  variants: ResponseVariantMap | null | undefined,
  validator: SchemaValidator,
): VerdictResult {
  return statusEqWithVariantEnrichment(
    actualStatus,
    expectedStatus,
    responseBody,
    variants,
    validator,
  );
}
