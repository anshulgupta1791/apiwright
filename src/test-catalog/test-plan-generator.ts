/**
 * TestPlanGenerator orchestrator — validates and expands canonical endpoints
 * into a complete, deterministic TestPlan.
 *
 * All collaborators are injectable; no-arg construction wires real production
 * defaults (never istanbul-ignored — tested by the unit suite as pipeline rule).
 */

import type { CanonicalEndpoint, TestMarker } from "../core/canonical-model.js";
import { SchemaValidator } from "../core/schema-validator.js";
import { Warnings } from "../importers/warnings.js";

import { AssertionBinder } from "./assertion-binder.js";
import { AuthNegativeGenerator } from "./generators/auth-negative-generator.js";
import { BodyNegativeGenerator } from "./generators/body-negative-generator.js";
import { BoundaryBatteryGenerator } from "./generators/boundary-battery-generator.js";
import { DbVerifyGenerator } from "./generators/db-verify-generator.js";
import { IdempotencyGenerator } from "./generators/idempotency-generator.js";
import { UniversalGenerator } from "./generators/universal-generator.js";
import { MarkerClassifier } from "./marker-classifier.js";
import { ProdSafetyClassifier } from "./prod-safety-classifier.js";
import { SchemaWalker } from "./schema-walker.js";
import { TestCaseIdFactory } from "./test-case-id.js";
import type {
  GenerationContext,
  TestCaseGenerator,
  TestPlan,
} from "./types.js";

/** Injectable options for TestPlanGenerator. */
export interface TestPlanGeneratorOptions {
  /** Override SchemaValidator (default: new SchemaValidator()). */
  validator?: SchemaValidator;
  /** Override TestCaseIdFactory (default: new TestCaseIdFactory()). */
  ids?: TestCaseIdFactory;
  /** Override MarkerClassifier (default: new MarkerClassifier()). */
  markers?: MarkerClassifier;
  /** Override ProdSafetyClassifier (default: new ProdSafetyClassifier()). */
  prodSafety?: ProdSafetyClassifier;
  /** Override SchemaWalker (default: new SchemaWalker()). */
  walker?: SchemaWalker;
  /** Override generator list (default: the 7 generators in fixed order). */
  generators?: TestCaseGenerator[];
}

/**
 * Returns the fixed deterministic generator list per the design.
 *
 * Called at construction time so each TestPlanGenerator gets fresh instances.
 * @returns The 7 generators in their fixed deterministic order.
 */
const DEFAULT_GENERATOR_ORDER: () => TestCaseGenerator[] = () => [
  new UniversalGenerator(),
  new AuthNegativeGenerator(),
  new BodyNegativeGenerator(),
  new BoundaryBatteryGenerator(),
  new IdempotencyGenerator(),
  new DbVerifyGenerator(),
  new AssertionBinder(),
];

/**
 * Orchestrates validation and generation of a TestPlan from a CanonicalEndpoint array.
 *
 * Validates each endpoint via SchemaValidator; invalid endpoints are skipped
 * (endpoints_skipped++) with a warning, never thrown. Pure + deterministic:
 * identical input ⇒ byte-identical TestPlan.
 */
export class TestPlanGenerator {
  readonly #validator: SchemaValidator;
  readonly #ids: TestCaseIdFactory;
  readonly #markers: MarkerClassifier;
  readonly #prodSafety: ProdSafetyClassifier;
  readonly #walker: SchemaWalker;
  readonly #generators: TestCaseGenerator[];

  /**
   * Constructs the orchestrator. All collaborators are injectable; no-arg
   * construction wires the REAL src/core SchemaValidator and real generators
   * (default-seam wiring is unit-tested, never istanbul-ignored).
   * @param options - Optional injected collaborators.
   */
  constructor(options?: TestPlanGeneratorOptions) {
    this.#validator = options?.validator ?? new SchemaValidator();
    this.#ids = options?.ids ?? new TestCaseIdFactory();
    this.#markers = options?.markers ?? new MarkerClassifier();
    this.#prodSafety = options?.prodSafety ?? new ProdSafetyClassifier();
    this.#walker = options?.walker ?? new SchemaWalker();
    this.#generators = options?.generators ?? DEFAULT_GENERATOR_ORDER();
  }

  /**
   * Expands a canonical endpoint array into a complete TestPlan. Validates
   * each endpoint via the core SchemaValidator against ENDPOINT_META_SCHEMA;
   * invalid endpoints contribute zero cases, increment endpoints_skipped, and
   * add one warning. NEVER throws on bad input.
   * @param endpoints - Canonical endpoints (untrusted user data).
   * @returns The aggregated, JSON-serializable TestPlan.
   */
  generate(endpoints: CanonicalEndpoint[]): TestPlan {
    const warnings = new Warnings();
    let planned = 0;
    let skipped = 0;
    const cases: TestPlan["cases"] = [];

    const ctx: GenerationContext = {
      ids: this.#ids,
      markers: this.#markers,
      prodSafety: this.#prodSafety,
      walker: this.#walker,
    };

    endpoints.forEach((endpoint, i) => {
      const v = this.#validator.validateEndpoint(endpoint);

      if (!v.valid) {
        skipped++;
        const epRecord = endpoint as unknown as Record<string, unknown>;
        const rawId = epRecord["id"];
        const id = typeof rawId === "string" && rawId ? rawId : `index ${i}`;
        const errors = (v.errors ?? []).join("; ");
        warnings.add(`Endpoint '${id}' skipped: ${errors}`);
        return;
      }

      planned++;

      for (const gen of this.#generators) {
        try {
          const result = gen.generate(endpoint, ctx);
          for (const c of result.cases) {
            cases.push(c);
          }
          warnings.addAll(result.warnings);
        } catch (err: unknown) {
          /* istanbul ignore next — generators are documented total; this catch
             is a defensive guard against programmer error in a generator
             (accepted category 3: provably-unreachable defensive guard) */
          const msg = err instanceof Error ? err.message : String(err);
          warnings.add(
            `Unexpected error in generator for endpoint '${endpoint.id}': ${msg}`,
          );
        }
      }
    });

    return {
      cases,
      endpoints_planned: planned,
      endpoints_skipped: skipped,
      warnings: warnings.list(),
    };
  }

  /**
   * Companion: maps endpoint id → declared markers, for MarkerFilter's
   * endpoint-intersection rule (keeps TestPlan shape frozen). Endpoints
   * absent here participate in all selected markers.
   * @param endpoints - The same endpoint array passed to generate.
   * @returns Record of endpoint id → declared markers (or undefined).
   */
  endpointMarkersOf(endpoints: CanonicalEndpoint[]): Record<string, TestMarker[] | undefined> {
    const result: Record<string, TestMarker[] | undefined> = {};
    for (const ep of endpoints) {
      if (typeof ep.id === "string" && ep.id) {
        result[ep.id] = ep.markers;
      }
    }
    return result;
  }
}
