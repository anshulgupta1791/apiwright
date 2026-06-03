/**
 * Core exported types/unions for the test-catalog module: the generated-type
 * union, the serializable TestCase/TestPlan model, the schema-inventory
 * shapes, and the generator seam.
 *
 * The discriminated `TestCaseParams` payloads live in `./test-case-params.ts`
 * (kept separate for the 300-line soft limit) and are re-exported here so
 * `../types.js` remains the single import surface. Pure type declarations —
 * no runtime logic. This file is coverage-excluded (src/&lowast;&lowast;/types.ts).
 */

import type {
  CanonicalEndpoint,
  TestMarker,
} from "../core/canonical-model.js";

import type { MarkerClassifier } from "./marker-classifier.js";
import type { ProdSafetyClassifier } from "./prod-safety-classifier.js";
import type { SchemaWalker } from "./schema-walker.js";
import type { TestCaseIdFactory } from "./test-case-id.js";
import type { TestCaseParams } from "./test-case-params.js";

export type { CanonicalEndpoint };
export type * from "./test-case-params.js";

/**
 * The 20 auto-generated test types from §3, grouped by family.
 * (The discriminated `"assertion"` sentinel is a TestCase type but NOT a
 * §3-generated kind — it's emitted by the assertion-binder for user-declared
 * assertions. ALL_SKIPPABLE_KINDS therefore has 21 entries: 20 + sentinel.)
 *  Universal (5): status_code_conformance, content_type_alignment,
 *    response_time_sla, response_schema_validation, auth_happy_path
 *  Auth-negative (3): no_auth_returns_401, garbage_token_returns_401,
 *    method_not_allowed
 *  Body-negative (4): malformed_json_returns_400,
 *    required_field_omission_returns_400, type_violation_returns_400,
 *    boundary_battery
 *  Method-specific (6): get_idempotency, delete_idempotency, put_idempotency,
 *    head_get_parity, conditional_get_304, cors_preflight
 *  List-endpoint (1): pagination_boundary
 *  DB-state (1): db_state_matches_expectation
 *  No type outside §3 is added.
 */
export type GeneratedTestType =
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
  | "put_idempotency"
  | "head_get_parity"
  | "conditional_get_304"
  | "pagination_boundary"
  | "db_state_matches_expectation"
  | "cors_preflight";

/** Run-selection marker (superset of TestMarker with the `all` shorthand). */
export type MarkerSelector = TestMarker | "all";

/** One generated test case; fully JSON-serializable. */
export interface TestCase {
  /** Stable id via makeTestCaseId; matches ^[a-z0-9._-]+$. */
  id: string;
  /** Owning CanonicalEndpoint.id (or the synthetic id for invalid endpoints). */
  endpoint_id: string;
  /** Which §3 type (or "assertion" sentinel for bound assertions). */
  type: GeneratedTestType | "assertion";
  /** Marker for this type (smoke|regression|e2e). */
  marker: TestMarker;
  /** Human-readable case title. */
  title: string;
  /** Prod-safety classification (runner enforces; Task #6 only tags). */
  prod_safe: boolean;
  /** Discriminated, runner-executable parameters. */
  params: TestCaseParams;
}

/** The complete generated plan; JSON round-trips unchanged. */
export interface TestPlan {
  /** All generated test cases. */
  cases: TestCase[];
  /** Count of valid endpoints expanded into cases. */
  endpoints_planned: number;
  /** Count of invalid endpoints skipped (each contributed one warning). */
  endpoints_skipped: number;
  /** Aggregated warnings from validation and generation. */
  warnings: string[];
}

/** Inventory entry: one field discovered by the SchemaWalker. */
export interface FieldDescriptor {
  /** Dot-notation path (e.g. "address.zip", "items[]"). */
  path: string;
  /** Declared JSON Schema `type` of the field, or "unknown". */
  jsonType: string;
  /** Whether the field is in its parent object's `required[]`. */
  required: boolean;
  /** Extracted numeric/length/enum constraints (present keys only). */
  constraints: FieldConstraints;
}

/** Constraint values extracted for a field (absent means not declared). */
export interface FieldConstraints {
  /** Minimum numeric value constraint. */
  minimum?: number;
  /** Maximum numeric value constraint. */
  maximum?: number;
  /** Minimum string length constraint. */
  minLength?: number;
  /** Maximum string length constraint. */
  maxLength?: number;
  /** Enum constraint values. */
  enum?: unknown[];
}

/** Result of SchemaWalker.walk — inventory plus depth-guard warnings. */
export interface SchemaInventory {
  /** Flat, ordered list of field descriptors. */
  fields: FieldDescriptor[];
  /** Any depth-guard warnings generated during the walk. */
  warnings: string[];
}

/** Uniform return of every per-concern generator. */
export interface GeneratorResult {
  /** Generated test cases. */
  cases: TestCase[];
  /** Any warnings produced during generation. */
  warnings: string[];
}

/** Shared context passed to every generator (injected collaborators). */
export interface GenerationContext {
  /** ID factory for generating stable case IDs. */
  ids: TestCaseIdFactory;
  /** Marker classifier for determining case markers. */
  markers: MarkerClassifier;
  /** Prod-safety classifier for determining prod_safe flags. */
  prodSafety: ProdSafetyClassifier;
  /** Schema walker for field inventory extraction. */
  walker: SchemaWalker;
}

/** Pluggable generator contract (OOP seam — one class per family). */
export interface TestCaseGenerator {
  /**
   * Expands one endpoint into zero or more cases for this generator's family.
   *
   * Pure and total: never throws, never performs I/O.
   * @param endpoint - The validated canonical endpoint.
   * @param ctx - Shared injected collaborators.
   * @returns Cases plus any warnings for this endpoint.
   */
  generate(endpoint: CanonicalEndpoint, ctx: GenerationContext): GeneratorResult;
}
