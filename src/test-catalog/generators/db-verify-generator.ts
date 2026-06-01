/**
 * DB-verify generator — emits db_state_matches_expectation regression test cases.
 *
 * Active for ANY method (GET / POST / PUT / PATCH / DELETE / HEAD / OPTIONS)
 * that declares db_verify entries. The cases gate the verdict at runtime —
 * without them, the runner executes db_verify and records `pass: false`
 * in the attempt trace, but no test case ever validates that result, so
 * the run exits green (silent failure).
 *
 * Prior behavior (a v1.0 known issue, now fixed): only write methods
 * generated the gating case. GET endpoints with db_verify silently passed
 * even when the DB row didn't exist. See the run-time `dbVerifyOk` plumbing
 * in `src/runner/execute/case-runners.ts:computeVerdict` — only the
 * `db_state_matches_expectation` kind consults `dbVerifyOk`, so the case
 * MUST be generated wherever db_verify is declared.
 *
 * Unrecognized expect modes emit a warning and skip that entry without
 * throwing.
 */

import type { CanonicalEndpoint, DbExpectMode } from "../../core/canonical-model.js";
import type {
  DbStateParams,
  GenerationContext,
  GeneratorResult,
  TestCase,
  TestCaseGenerator,
} from "../types.js";

/** Valid db_verify expect modes (mirrors canonical-model DbExpectMode). */
const VALID_EXPECT_MODES = new Set<string>(["exists", "not_exists", "match", "exact"]);

/**
 * Generates db_state_matches_expectation regression test cases.
 *
 * For any method with db_verify entries: one case per entry, params copied
 * verbatim (query never executed/parsed). For an endpoint with empty/absent
 * db_verify: zero cases, no warning. Unrecognized expect mode: warn + skip
 * that entry, never throw.
 */
export class DbVerifyGenerator implements TestCaseGenerator {
  /**
   * Expands one endpoint into db-state cases (0 or more).
   * @param endpoint - The validated canonical endpoint.
   * @param ctx - Shared injected collaborators.
   * @returns DB-state regression cases plus any warnings.
   */
  generate(endpoint: CanonicalEndpoint, ctx: GenerationContext): GeneratorResult {
    const { id, method, db_verify: dbVerify } = endpoint;

    if (!dbVerify || dbVerify.length === 0) {
      return { cases: [], warnings: [] };
    }

    const { ids, markers, prodSafety } = ctx;
    const marker = markers.markerFor("db_state_matches_expectation");
    const prodSafe = prodSafety.classifyProdSafe({ marker, method });
    const cases: TestCase[] = [];
    const warnings: string[] = [];

    dbVerify.forEach((entry, i) => {
      if (!VALID_EXPECT_MODES.has(entry.expect)) {
        warnings.push(
          `db_verify[${i}] has unrecognized expect '${entry.expect}'; skipped`,
        );
        return;
      }

      const params = this.#buildParams(entry.expect, entry);
      cases.push({
        id: ids.make(id, "db_state_matches_expectation", i),
        endpoint_id: id,
        type: "db_state_matches_expectation",
        marker,
        title: `DB state verification [${i}] for ${endpoint.name}`,
        prod_safe: prodSafe,
        params,
      });
    });

    return { cases, warnings };
  }

  #buildParams(
    expect: DbExpectMode,
    entry: {
      connection: string;
      query: string;
      fields?: Record<string, unknown>;
      query_id?: string;
    },
  ): DbStateParams {
    const base: DbStateParams = {
      kind: "db_state_matches_expectation",
      connection: entry.connection,
      query: entry.query,
      expect,
    };
    if (entry.fields !== undefined) {
      base.fields = entry.fields;
    }
    if (entry.query_id !== undefined) {
      base.query_id = entry.query_id;
    }
    return base;
  }
}
