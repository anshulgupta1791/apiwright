/**
 * Public type vocabulary for the §9 Test Runner (Task #10).
 *
 * Defines the data shapes produced by a single run: per-attempt traces,
 * per-endpoint outcomes, per-assertion results, and the aggregated RunResult.
 *
 * Coverage exclusion: this file matches the src/(asterisk)(asterisk)/types.ts
 * glob in configs/vitest.config.ts; it carries no runtime statements.
 *
 * Mirrors the Task 8 db-connector-types + Task 9 auth-types pattern: pure
 * type declarations, reuse-not-redefine other layers' shapes.
 */

import type { AssertionResult } from "../assertions/index.js";
import type { NormalizedResult } from "../core/index.js";
import type { TestCase } from "../test-catalog/index.js";

/** Single-attempt verdict; what counts as "passed" vs "failed". */
export type Verdict = "pass" | "fail";

/** Outcome category surfaced after retries are exhausted (§9 line 661). */
export type FinalStatus = "pass" | "fail" | "flaky";

/** Captured outgoing request facts (post-auth). */
export interface RequestRecord {
  /** HTTP method, uppercase. */
  readonly method: string;
  /** Fully-resolved absolute URL (no remaining ${} placeholders). */
  readonly url: string;
  /** Outgoing headers — credentials redacted by the redactor before display. */
  readonly headers: Readonly<Record<string, string>>;
  /** Outgoing body (JSON-serializable; unknown for shape-agnostic transit). */
  readonly body?: unknown;
}

/** Captured response facts. */
export interface ResponseRecord {
  /** HTTP status code (100-599). */
  readonly status: number;
  /** Response headers, lowercased keys. */
  readonly headers: Readonly<Record<string, string>>;
  /** Parsed JSON body OR raw string when non-JSON. */
  readonly body: unknown;
  /** Wall-clock duration from request send to response received (ms). */
  readonly time_ms: number;
}

/** Per-db-verify outcome surfaced into the AttemptResult. */
export interface DbVerifyOutcomeRecord {
  /** The CanonicalDbVerification connection name. */
  readonly connection: string;
  /** The query_id (or synthesized fallback when absent). */
  readonly query_id: string;
  /** The §5 NormalizedResult captured pre-evaluate (for §4 db.* access). */
  readonly normalized: NormalizedResult;
  /** Pass/fail per the expect mode. */
  readonly pass: boolean;
  /** Failure reason when pass=false; absent when pass=true. */
  readonly reason?: string;
}

/** A single attempt's full trace. */
export interface AttemptResult {
  /** 1-based attempt number; first attempt is 1. */
  readonly attempt: number;
  /** Verdict for this single attempt. */
  readonly verdict: Verdict;
  /** Wall-clock start time (Unix ms). */
  readonly started_at: number;
  /** Wall-clock end time (Unix ms). */
  readonly ended_at: number;
  /** Captured outgoing request (absent if attempt failed before send). */
  readonly request?: RequestRecord;
  /** Captured response (absent if attempt failed before receive). */
  readonly response?: ResponseRecord;
  /** §4 assertion outcomes (auto-generated + declarative), in order. */
  readonly assertions: readonly AssertionResult[];
  /** §5 db-verify outcomes (in declaration order). */
  readonly db_verify: readonly DbVerifyOutcomeRecord[];
  /** Structured failure reason when verdict="fail"; absent for pass. */
  readonly failure_reason?: string;
}

/** Per-endpoint result across all attempts. */
export interface EndpointResult {
  /** Endpoint id (matches CanonicalEndpoint.id). */
  readonly endpoint_id: string;
  /** Final status after all attempts (pass / fail / flaky). */
  readonly status: FinalStatus;
  /** Ordered attempt traces; length ≥ 1. */
  readonly attempts: readonly AttemptResult[];
  /** True iff `status === "flaky"` (passed on a non-first attempt). */
  readonly flaky: boolean;
  /** Cleanup query outcome (absent if endpoint has no cleanup). */
  readonly cleanup?: { readonly ok: boolean; readonly reason?: string };
}

/** Aggregated run statistics surfaced into the RunResult summary. */
export interface RunSummary {
  /** Endpoints planned (post-filter, post-shard). */
  readonly endpoints_planned: number;
  /** Endpoints that yielded status=pass. */
  readonly passed: number;
  /** Endpoints that yielded status=fail. */
  readonly failed: number;
  /** Endpoints that yielded status=flaky. */
  readonly flaky: number;
  /** Run wall-clock duration (ms). */
  readonly duration_ms: number;
}

/** The full result of one `apiwright run` invocation. */
export interface RunResult {
  /** ISO timestamp the run started. */
  readonly started_at: string;
  /** ISO timestamp the run ended. */
  readonly ended_at: string;
  /** Resolved environment name (e.g. "qa", "prod"). */
  readonly env: string;
  /** Effective filter snapshot. */
  readonly filters: RunFilters;
  /** Effective shard `{ index, total }` or `null` if no sharding. */
  readonly shard: { readonly index: number; readonly total: number } | null;
  /** Worker count actually used. */
  readonly workers: number;
  /** Per-endpoint result trees (deterministic alphabetical order by id). */
  readonly endpoints: readonly EndpointResult[];
  /** Aggregated summary. */
  readonly summary: RunSummary;
  /**
   * Plan-generation warnings surfaced to the user (e.g. a bodyless endpoint
   * whose `response_schema_validation` was skipped for lack of a schema).
   * Absent when the plan produced no warnings.
   */
  readonly warnings?: readonly string[];
}

/** Filter set applied at run time (spec §9 lines 628–635). */
export interface RunFilters {
  /** `["smoke"] | ["smoke","regression"] | ["all"]` — undefined = `["smoke"]`. */
  readonly markers?: readonly string[];
  /** Directory subtree filter (e.g. "tests/user-service/"). */
  readonly path?: string;
  /** Endpoint tag filter (orthogonal to directory). */
  readonly tag?: string;
  /** Single-endpoint id filter (e.g. "users.create"). */
  readonly endpoint?: string;
  /** Tags to exclude (one or more). */
  readonly excludeTags?: readonly string[];
}

/** A single executable test case bound to its endpoint. */
export interface PlannedTestCase {
  /** The originating CanonicalEndpoint id. */
  readonly endpoint_id: string;
  /** The TestCase from §3 catalog (auto-generated or assertion-bound). */
  readonly case: TestCase;
}

/** The full set of planned cases for a run (post-discovery, pre-filter). */
export interface TestPlanReport {
  /** All planned cases in catalog-generation order. */
  readonly cases: readonly PlannedTestCase[];
  /** All loaded endpoints (used by the executor). */
  readonly endpoints: ReadonlyMap<string, EndpointLoadRecord>;
  /** Aggregated plan-generation warnings (forwarded to the RunResult). */
  readonly warnings: readonly string[];
}

/** One loaded endpoint + the path it came from. */
export interface EndpointLoadRecord {
  /** Repo-relative path to the .endpoint.json. */
  readonly path: string;
  /** The validated CanonicalEndpoint. */
  readonly endpoint: import("../core/index.js").CanonicalEndpoint;
}
