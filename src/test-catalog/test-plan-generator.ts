/**
 * TestPlanGenerator orchestrator — validates and expands canonical endpoints
 * into a complete, deterministic TestPlan.
 *
 * All collaborators are injectable; no-arg construction wires real production
 * defaults (never istanbul-ignored — tested by the unit suite as pipeline rule).
 *
 * File exceeds the 300-line soft limit: the four skip-orchestration helpers
 * (`#detectSkipLogic`, `#applySkipsForEndpoint`, `#emitEndpointSkipWarnings`,
 * `#emitGlobalSkipWarnings`) are intentionally co-located with
 * `TestPlanGenerator` because all four are private, share the
 * `GlobalSkipAccumulator` and `allKindsFired` per-run state with the generation
 * loop, and have no identity independent of the orchestration. Extracting them
 * would rename the coupling, not reduce it.
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
import { PutIdempotencyGenerator } from "./generators/put-idempotency-generator.js";
import { UniversalGenerator } from "./generators/universal-generator.js";
import { MarkerClassifier } from "./marker-classifier.js";
import { ProdSafetyClassifier } from "./prod-safety-classifier.js";
import { SchemaWalker } from "./schema-walker.js";
import { ALL_SKIPPABLE_KINDS, SkipResolver } from "./skip-resolver.js";
import { TestCaseIdFactory } from "./test-case-id.js";
import type {
  GenerationContext,
  TestCase,
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
  /**
   * Optional SkipResolver instance for evaluating skip_cases and skip_globally
   * tokens. When absent, a default instance is created automatically.
   */
  skipResolver?: SkipResolver;
  /**
   * Global skip tokens from `config.case_generation.skip_globally`. Applied to
   * every endpoint in the plan. Default: empty (no global skips).
   */
  skipGlobally?: readonly string[];
}

/**
 * Returns the fixed deterministic generator list per the design.
 *
 * Called at construction time so each TestPlanGenerator gets fresh instances.
 * @returns The 8 generators in their fixed deterministic order.
 */
const DEFAULT_GENERATOR_ORDER: () => TestCaseGenerator[] = () => [
  new UniversalGenerator(),
  new AuthNegativeGenerator(),
  new BodyNegativeGenerator(),
  new BoundaryBatteryGenerator(),
  new IdempotencyGenerator(),
  new PutIdempotencyGenerator(),
  new DbVerifyGenerator(),
  new AssertionBinder(),
];

/** Internal accumulator for global skip-token statistics across all endpoints. */
interface GlobalSkipAccumulator {
  /** Per-token total skip count across all endpoints. */
  readonly counts: Map<string, number>;
  /** Per-token set of endpoint ids that contributed at least one skip. */
  readonly endpointHits: Map<string, Set<string>>;
}

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
  readonly #skipResolver: SkipResolver;
  readonly #skipGlobally: readonly string[];

  /**
   * Constructs the orchestrator. All collaborators are injectable; no-arg
   * construction wires the REAL src/core SchemaValidator and real generators
   * (default-seam wiring is unit-tested, never istanbul-ignored).
   * @param options - Optional injected collaborators.
   */
  constructor(options: TestPlanGeneratorOptions = {}) {
    this.#validator = options.validator ?? new SchemaValidator();
    this.#ids = options.ids ?? new TestCaseIdFactory();
    this.#markers = options.markers ?? new MarkerClassifier();
    this.#prodSafety = options.prodSafety ?? new ProdSafetyClassifier();
    this.#walker = options.walker ?? new SchemaWalker();
    this.#generators = options.generators ?? DEFAULT_GENERATOR_ORDER();
    this.#skipResolver = options.skipResolver ?? new SkipResolver();
    this.#skipGlobally = options.skipGlobally ?? [];
  }

  /**
   * Expands a canonical endpoint array into a complete TestPlan. Validates
   * each endpoint via the core SchemaValidator against ENDPOINT_META_SCHEMA;
   * invalid endpoints contribute zero cases, increment endpoints_skipped, and
   * add one warning. NEVER throws on bad input.
   *
   * When `skip_cases` is declared on an endpoint or `skipGlobally` is non-empty,
   * matching cases are omitted. Counted and dead-weight warnings are emitted per DD-8.
   * @param endpoints - Canonical endpoints (untrusted user data).
   * @returns The aggregated, JSON-serializable TestPlan.
   */
  generate(endpoints: CanonicalEndpoint[]): TestPlan {
    const warnings = new Warnings();
    let planned = 0;
    let skipped = 0;
    const cases: TestPlan["cases"] = [];

    const hasSkipLogic = this.#detectSkipLogic(endpoints);
    const globalAccum: GlobalSkipAccumulator = {
      counts: new Map(),
      endpointHits: new Map(),
    };
    const allKindsFired = new Set<string>();

    const ctx: GenerationContext = {
      ids: this.#ids,
      markers: this.#markers,
      prodSafety: this.#prodSafety,
      walker: this.#walker,
    };

    for (let i = 0; i < endpoints.length; i++) {
      const endpoint = endpoints[i];
      if (!endpoint) continue;

      const v = this.#validator.validateEndpoint(endpoint);
      if (!v.valid) {
        skipped++;
        warnings.add(this.#invalidEndpointWarning(endpoint, i, v.errors));
        continue;
      }

      planned++;
      const { endpointCases, genWarnings } = this.#generateRawCases(endpoint, ctx);
      warnings.addAll(genWarnings);

      if (!hasSkipLogic) {
        for (const c of endpointCases) cases.push(c);
        continue;
      }

      for (const c of endpointCases) allKindsFired.add(c.params.kind);
      const filtered = this.#applySkipsForEndpoint(
        endpoint,
        endpointCases,
        globalAccum,
        warnings,
      );
      for (const c of filtered) cases.push(c);
    }

    if (hasSkipLogic) {
      this.#emitGlobalSkipWarnings(globalAccum, allKindsFired, warnings);
    }

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

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Returns `true` when any skip logic is active (endpoint skip_cases or global).
   * @param endpoints - The endpoint array to inspect.
   * @returns Whether any skip configuration is present.
   */
  #detectSkipLogic(endpoints: readonly CanonicalEndpoint[]): boolean {
    if (this.#skipGlobally.length > 0) return true;
    for (const ep of endpoints) {
      if ((ep.skip_cases?.length ?? 0) > 0) return true;
    }
    return false;
  }

  /**
   * Builds the "Endpoint skipped" warning string for an invalid endpoint.
   * @param endpoint - The invalid endpoint object.
   * @param index - Its zero-based position in the input array.
   * @param errors - Validation errors from the schema validator.
   * @returns The warning string.
   */
  #invalidEndpointWarning(
    endpoint: CanonicalEndpoint,
    index: number,
    errors: string[] | undefined,
  ): string {
    const epRecord = endpoint as unknown as Record<string, unknown>;
    const rawId = epRecord["id"];
    const id = typeof rawId === "string" && rawId ? rawId : `index ${index}`;
    return `Endpoint '${id}' skipped: ${(errors ?? []).join("; ")}`;
  }

  /**
   * Runs all generators for one valid endpoint and collects raw cases + warnings.
   * @param endpoint - A validated CanonicalEndpoint.
   * @param ctx - Shared generation context.
   * @returns Raw cases and any generator warnings.
   */
  #generateRawCases(
    endpoint: CanonicalEndpoint,
    ctx: GenerationContext,
  ): { endpointCases: TestCase[]; genWarnings: string[] } {
    const endpointCases: TestCase[] = [];
    const genWarnings: string[] = [];
    for (const gen of this.#generators) {
      try {
        const result = gen.generate(endpoint, ctx);
        for (const c of result.cases) endpointCases.push(c);
        for (const w of result.warnings) genWarnings.push(w);
      } catch (err: unknown) {
        /* istanbul ignore next — generators are documented total; this catch
           is a defensive guard against programmer error in a generator
           (accepted category 3: provably-unreachable defensive guard) */
        const msg = err instanceof Error ? err.message : String(err);
        genWarnings.push(`Unexpected error in generator for endpoint '${endpoint.id}': ${msg}`);
      }
    }
    return { endpointCases, genWarnings };
  }

  /**
   * Applies endpoint-level and global skip tokens to the raw case list.
   * Emits counted-skip warnings and dead-weight warnings per DD-8.
   * @param endpoint - The endpoint whose cases are being filtered.
   * @param endpointCases - All cases generated for this endpoint.
   * @param globalAccum - Accumulator for global-token statistics.
   * @param warnings - Warnings accumulator to append to.
   * @returns The filtered (non-skipped) cases.
   */
  #applySkipsForEndpoint(
    endpoint: CanonicalEndpoint,
    endpointCases: readonly TestCase[],
    globalAccum: GlobalSkipAccumulator,
    warnings: Warnings,
  ): TestCase[] {
    const endpointSkips = extractEndpointSkips(endpoint);
    const kindsFired = new Set(endpointCases.map((c) => c.params.kind));

    if (endpointSkips.length > 0) {
      const validation = this.#skipResolver.validateSkipTokens(
        endpointSkips,
        new Set([...kindsFired, ...ALL_SKIPPABLE_KINDS]),
        `Endpoint '${endpoint.id}'`,
      );
      warnings.addAll(validation.warnings);
    }

    const tokenHits = new Map<string, number>();
    const kept: TestCase[] = [];

    for (const c of endpointCases) {
      const hit = this.#skipResolver.matchSkip(c, endpointSkips, this.#skipGlobally);
      if (hit !== null) {
        tokenHits.set(hit, (tokenHits.get(hit) ?? 0) + 1);
      } else {
        kept.push(c);
      }
    }

    this.#emitEndpointSkipWarnings(endpoint, endpointSkips, tokenHits, globalAccum, warnings);
    return kept;
  }

  /**
   * Emits per-endpoint skip warnings: counted-skip for matched tokens,
   * dead-weight for endpoint tokens that matched zero cases (DD-8).
   * @param endpoint - The endpoint being processed.
   * @param endpointSkips - The endpoint's skip token list.
   * @param tokenHits - Map of token → count of cases matched.
   * @param globalAccum - Accumulator for global-token stats.
   * @param warnings - Warnings accumulator.
   */
  #emitEndpointSkipWarnings(
    endpoint: CanonicalEndpoint,
    endpointSkips: readonly string[],
    tokenHits: ReadonlyMap<string, number>,
    globalAccum: GlobalSkipAccumulator,
    warnings: Warnings,
  ): void {
    for (const [token, count] of tokenHits) {
      if (endpointSkips.includes(token)) {
        warnings.add(
          `Endpoint '${endpoint.id}': skip_cases token '${token}' skipped ${count} case(s).`,
        );
      } else {
        globalAccum.counts.set(token, (globalAccum.counts.get(token) ?? 0) + count);
        const epSet = globalAccum.endpointHits.get(token) ?? new Set<string>();
        epSet.add(endpoint.id);
        globalAccum.endpointHits.set(token, epSet);
      }
    }

    for (const token of endpointSkips) {
      if (!tokenHits.has(token) && this.#isKnownToken(token)) {
        warnings.add(
          `Endpoint '${endpoint.id}': skip_cases token '${token}' matched zero` +
          ` generated cases on this endpoint.`,
        );
      }
    }
  }

  /**
   * Emits global skip warnings once at the end of generate() per DD-3.
   * Emits counted warnings + dead-weight warnings for the skip_globally list.
   * @param globalAccum - Accumulated global skip statistics.
   * @param allKindsFired - Union of all kinds that fired across all endpoints.
   * @param warnings - Warnings accumulator.
   */
  #emitGlobalSkipWarnings(
    globalAccum: GlobalSkipAccumulator,
    allKindsFired: ReadonlySet<string>,
    warnings: Warnings,
  ): void {
    if (this.#skipGlobally.length === 0) return;

    const globalLabel = "config.case_generation";
    const globalValidation = this.#skipResolver.validateSkipTokens(
      this.#skipGlobally,
      new Set([...allKindsFired, ...ALL_SKIPPABLE_KINDS]),
      globalLabel,
    );
    warnings.addAll(globalValidation.warnings);

    for (const [token, totalCount] of globalAccum.counts) {
      const epCount = globalAccum.endpointHits.get(token)?.size ?? 0;
      warnings.add(
        `config.case_generation: skip_globally token '${token}' skipped` +
        ` ${totalCount} case(s) across ${epCount} endpoint(s).`,
      );
    }

    for (const token of this.#skipGlobally) {
      if (!globalAccum.counts.has(token) && this.#isKnownToken(token)) {
        warnings.add(
          `config.case_generation: skip_globally token '${token}' matched zero` +
          ` generated cases across the plan.`,
        );
      }
    }
  }

  /**
   * Returns `true` when a token parses successfully AND its kind is in
   * `ALL_SKIPPABLE_KINDS`. Used to gate dead-weight warnings so malformed
   * or unknown-kind tokens do not receive a second warning.
   * @param token - A raw skip token to check.
   * @returns Whether the token has a valid, recognized kind.
   */
  #isKnownToken(token: string): boolean {
    const result = this.#skipResolver.validateSkipTokens([token], ALL_SKIPPABLE_KINDS, "");
    return result.recognized.length > 0;
  }
}

// ---------------------------------------------------------------------------
// Module-private helpers
// ---------------------------------------------------------------------------

/**
 * Extracts the `skip_cases` array from an endpoint, returning an empty array
 * when the field is absent or not an array. Pure, does not mutate the endpoint.
 * @param endpoint - The endpoint to extract skip tokens from.
 * @returns The skip tokens, or an empty array.
 */
function extractEndpointSkips(endpoint: CanonicalEndpoint): readonly string[] {
  return endpoint.skip_cases ?? [];
}
