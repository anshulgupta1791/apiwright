/**
 * Unit tests for statusEqWithVariantEnrichment and lookupVariantSchema.
 *
 * Covers §6.3 items 24-36 (statusEqWithVariantEnrichment) and
 * §6.4 items 37-44 (lookupVariantSchema).
 *
 * Design decisions pinned:
 *   DD-3  Exact decimal-string match only — no class wildcards.
 *   DD-4  Variant lookup SUPPRESSED when actual === expected.
 *   DD-6  Verdict precedence: pass when match; fail-with-enriched-reason on mismatch.
 *   DD-10 Forward-compat: variant with no schema field → "documented variant" reason.
 *
 * Exact failure-reason templates from §7.1 (implementation MUST use these verbatim):
 *   "expected status <E>, got <A>"
 *   "expected status <E>, got <A> (response body matched declared variant schema for <A>)"
 *   "expected status <E>, got <A> (response body did not match declared variant schema for <A>: <detail>)"
 *   "expected status <E>, got <A> (status <A> is a documented variant)"
 *
 * Category: Unit.
 * Expected initial failure: src/runner/execute/variant-enrichment.ts does not exist yet;
 *   statusEqWithVariantEnrichment and lookupVariantSchema are not exported.
 */

import { describe, it, expect } from "vitest";

import {
  statusEqWithVariantEnrichment,
  lookupVariantSchema,
} from "../../../../src/runner/execute/variant-enrichment.js";
import { SchemaValidator } from "../../../../src/core/schema-validator.js";
import type { ResponseVariantMap } from "../../../../src/core/canonical-model.js";

// ---------------------------------------------------------------------------
// Shared instances
// ---------------------------------------------------------------------------

const validator = new SchemaValidator();

// ---------------------------------------------------------------------------
// §6.3 — statusEqWithVariantEnrichment
// ---------------------------------------------------------------------------

describe("statusEqWithVariantEnrichment()", () => {

  /**
   * Item 24: actual === expected, no variants → pass (DD-4).
   */
  it("returns pass when actual equals expected with no variants declared", () => {
    const result = statusEqWithVariantEnrichment(201, 201, { id: "abc" }, undefined, validator);
    expect(result.verdict).toBe("pass");
    expect(result.reason).toBeUndefined();
  });

  /**
   * Item 25: actual === expected, variants present (even with matching key) → pass (DD-4 suppression).
   */
  it("returns pass when actual equals expected even if variants map contains that status key (DD-4)", () => {
    const variants: ResponseVariantMap = {
      "201": { schema: { type: "object" } },
    };
    const result = statusEqWithVariantEnrichment(201, 201, { id: "x" }, variants, validator);
    expect(result.verdict).toBe("pass");
    expect(result.reason).toBeUndefined();
  });

  /**
   * Item 26: actual !== expected, variants absent → fail with plain template.
   */
  it("returns fail with 'expected status E, got A' when variants is absent", () => {
    const result = statusEqWithVariantEnrichment(400, 201, { error: "x" }, undefined, validator);
    expect(result.verdict).toBe("fail");
    expect(result.reason).toBe("expected status 201, got 400");
  });

  /**
   * Item 27: actual !== expected, variants undefined → fail with plain template.
   */
  it("returns fail with plain template when variants is explicitly undefined", () => {
    const result = statusEqWithVariantEnrichment(500, 201, null, undefined, validator);
    expect(result.verdict).toBe("fail");
    expect(result.reason).toBe("expected status 201, got 500");
  });

  /**
   * Item 28: actual !== expected, variants present but no key matching actual → fail (plain).
   */
  it("returns fail with plain template when actual status has no matching variant key", () => {
    const variants: ResponseVariantMap = {
      "400": { schema: { type: "object", required: ["error"] } },
    };
    const result = statusEqWithVariantEnrichment(503, 201, { error: "boom" }, variants, validator);
    expect(result.verdict).toBe("fail");
    expect(result.reason).toBe("expected status 201, got 503");
  });

  /**
   * Item 29: actual !== expected, variant declared, body matches schema →
   * fail with "matched declared variant schema" reason (DD-6 path 2a).
   */
  it("returns fail with enriched 'matched' reason when body satisfies the variant schema", () => {
    const variants: ResponseVariantMap = {
      "400": {
        schema: {
          type: "object",
          required: ["error", "message"],
          properties: {
            error: { type: "string" },
            message: { type: "string" },
          },
        },
      },
    };
    const body = { error: "bad_request", message: "Missing field" };
    const result = statusEqWithVariantEnrichment(400, 201, body, variants, validator);
    expect(result.verdict).toBe("fail");
    expect(result.reason).toBe(
      "expected status 201, got 400 (response body matched declared variant schema for 400)",
    );
  });

  /**
   * Item 30: actual !== expected, variant declared, body does NOT match schema →
   * fail with "did not match" reason + AJV detail (DD-6 path 2b).
   */
  it("returns fail with 'did not match' reason + AJV detail when body fails the variant schema", () => {
    const variants: ResponseVariantMap = {
      "400": {
        schema: {
          type: "object",
          required: ["error"],
          properties: { error: { type: "string" } },
        },
      },
    };
    // Body missing required 'error' field
    const body = { message: "something" };
    const result = statusEqWithVariantEnrichment(400, 201, body, variants, validator);
    expect(result.verdict).toBe("fail");
    expect(result.reason).toMatch(
      /^expected status 201, got 400 \(response body did not match declared variant schema for 400:/,
    );
    // AJV detail tail must be present
    expect(result.reason).toMatch(/error|required/i);
  });

  /**
   * Item 31: variant declared but schema absent (DD-10 forward compat) →
   * fail with "documented variant" reason.
   */
  it("returns fail with 'documented variant' reason when variant has no schema field (DD-10 forward-compat)", () => {
    // Cast to bypass TypeScript — DD-10 forward-compat path
    const variants = {
      "400": {},
    } as unknown as ResponseVariantMap;
    const result = statusEqWithVariantEnrichment(400, 201, { anything: true }, variants, validator);
    expect(result.verdict).toBe("fail");
    expect(result.reason).toBe(
      "expected status 201, got 400 (status 400 is a documented variant)",
    );
  });

  /**
   * Item 32: actual === expected === 500 with variants["500"] declared →
   * variant SUPPRESSED → pass (DD-4 symmetry test).
   */
  it("returns pass when actual 500 equals expected 500 even with variants['500'] declared (DD-4 symmetry)", () => {
    const variants: ResponseVariantMap = {
      "500": { schema: { type: "object" } },
    };
    const result = statusEqWithVariantEnrichment(500, 500, { error: "internal" }, variants, validator);
    expect(result.verdict).toBe("pass");
  });

  /**
   * Item 33: body undefined + schema is empty {} (matches anything) → variant matched (valid=true).
   */
  it("returns enriched 'matched' reason when body is undefined and variant schema is empty {} (matches anything)", () => {
    const variants: ResponseVariantMap = {
      "500": { schema: {} },
    };
    const result = statusEqWithVariantEnrichment(500, 201, undefined, variants, validator);
    expect(result.verdict).toBe("fail");
    expect(result.reason).toBe(
      "expected status 201, got 500 (response body matched declared variant schema for 500)",
    );
  });

  /**
   * Item 34: body undefined + schema requires fields → enrichment as mismatched (valid=false).
   */
  it("returns enriched 'did not match' reason when body is undefined and schema requires fields", () => {
    const variants: ResponseVariantMap = {
      "500": {
        schema: {
          type: "object",
          required: ["error"],
          properties: { error: { type: "string" } },
        },
      },
    };
    const result = statusEqWithVariantEnrichment(500, 201, undefined, variants, validator);
    expect(result.verdict).toBe("fail");
    expect(result.reason).toMatch(
      /^expected status 201, got 500 \(response body did not match declared variant schema for 500:/,
    );
  });

  /**
   * Item 35: actual === 0 (hypothetical defensive) + expected 200 →
   * fail with "expected status 200, got 0" (DD-3 string conversion safe).
   */
  it("returns fail with correct reason when actual is 0 (edge — string conversion safe)", () => {
    const result = statusEqWithVariantEnrichment(0, 200, null, undefined, validator);
    expect(result.verdict).toBe("fail");
    expect(result.reason).toBe("expected status 200, got 0");
  });

  /**
   * Item 36: actual === 1000 (out-of-range) + variants["1000"] declared →
   * lookup happens (DD-3 string-match doesn't restrict range); if body matches → enriched reason.
   */
  it("performs lookup for out-of-range status 1000 when variants['1000'] is declared (DD-3 forward-compat)", () => {
    const variants = {
      "1000": { schema: {} },
    } as unknown as ResponseVariantMap;
    const result = statusEqWithVariantEnrichment(1000, 200, { data: 1 }, variants, validator);
    expect(result.verdict).toBe("fail");
    // The lookup succeeds and the empty schema matches anything → enriched reason
    expect(result.reason).toBe(
      "expected status 200, got 1000 (response body matched declared variant schema for 1000)",
    );
  });

  /**
   * Extra: variant declared for "400", actual is 400, body matches but expected was 400 (no mismatch) → pass.
   * Confirms DD-4 suppression even when the variant key matches expected_status.
   */
  it("returns pass when actual equals expected_status (400) even if variants['400'] is declared (DD-4)", () => {
    const variants: ResponseVariantMap = {
      "400": { schema: { type: "object", required: ["error"] } },
    };
    const body = { error: "x" };
    const result = statusEqWithVariantEnrichment(400, 400, body, variants, validator);
    expect(result.verdict).toBe("pass");
  });

  /**
   * Failure-reason exact-template check: AJV detail is joined by "; ".
   */
  it("joins multiple AJV error strings with '; ' in the failure_reason tail", () => {
    const variants: ResponseVariantMap = {
      "400": {
        schema: {
          type: "object",
          required: ["error", "code"],
          properties: {
            error: { type: "string" },
            code: { type: "integer" },
          },
        },
      },
    };
    // Missing both required fields → AJV emits multiple errors
    const result = statusEqWithVariantEnrichment(400, 201, {}, variants, validator);
    expect(result.verdict).toBe("fail");
    expect(result.reason).toMatch(
      /^expected status 201, got 400 \(response body did not match declared variant schema for 400:/,
    );
  });
});

// ---------------------------------------------------------------------------
// §6.4 — lookupVariantSchema
// ---------------------------------------------------------------------------

describe("lookupVariantSchema()", () => {

  /**
   * Item 37: variants undefined → returns undefined.
   */
  it("returns undefined when variants is undefined", () => {
    expect(lookupVariantSchema(undefined, 400)).toBeUndefined();
  });

  /**
   * Item 38: variants {} → returns undefined.
   */
  it("returns undefined when variants is an empty record", () => {
    expect(lookupVariantSchema({} as ResponseVariantMap, 400)).toBeUndefined();
  });

  /**
   * Item 39: variants { "400": variant }, status 400 → returns the variant.
   */
  it("returns the variant when status 400 matches key '400'", () => {
    const variant = { schema: { type: "object" } };
    const variants: ResponseVariantMap = { "400": variant };
    expect(lookupVariantSchema(variants, 400)).toBe(variant);
  });

  /**
   * Item 40: variants { "400": variant }, status 401 → returns undefined.
   */
  it("returns undefined when status 401 is not in variants { '400': ... }", () => {
    const variants: ResponseVariantMap = { "400": { schema: {} } };
    expect(lookupVariantSchema(variants, 401)).toBeUndefined();
  });

  /**
   * Item 41: variants { "500": ..., "503": ... }, status 500 → returns 500 variant.
   */
  it("returns the 500 variant when variants has '500' and '503' keys and status is 500", () => {
    const variant500 = { schema: { type: "object", required: ["error"] } };
    const variant503 = { schema: { type: "object" } };
    const variants: ResponseVariantMap = { "500": variant500, "503": variant503 };
    expect(lookupVariantSchema(variants, 500)).toBe(variant500);
  });

  /**
   * Item 42: variants with non-decimal-string key "5xx" + status 500 → returns undefined (DD-3).
   */
  it("returns undefined for status 500 when variants key is '5xx' (DD-3: exact match only)", () => {
    const variants = { "5xx": { schema: {} } } as unknown as ResponseVariantMap;
    expect(lookupVariantSchema(variants, 500)).toBeUndefined();
  });

  /**
   * Item 43 (defensive): variants is null cast at boundary → returns undefined.
   * The validate step (DD-9) prevents this at runtime; this tests the defensive guard.
   */
  it("returns undefined when variants is null (defensive guard — DD-9)", () => {
    const badVariants = null as unknown as ResponseVariantMap;
    expect(lookupVariantSchema(badVariants, 400)).toBeUndefined();
  });

  /**
   * Item 44 (defensive): variants is an array cast at boundary → returns undefined.
   */
  it("returns undefined when variants is an array (defensive guard — DD-9)", () => {
    const badVariants = [{ schema: {} }] as unknown as ResponseVariantMap;
    expect(lookupVariantSchema(badVariants, 400)).toBeUndefined();
  });

  /**
   * Extra: String coercion — number 400 is converted to "400" for lookup (DD-2).
   */
  it("coerces numeric status to string key for lookup — 400 → '400'", () => {
    const variant = { schema: { type: "object" } };
    const variants: ResponseVariantMap = { "400": variant };
    expect(lookupVariantSchema(variants, 400)).toBe(variant);
  });
});
