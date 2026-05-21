/**
 * Per-endpoint executor — orchestrates one EndpointResult across the case
 * dispatch, retries, db_verify, assertions, and cleanup. Discharges:
 *   #2  — runner assertion execution.
 *   #6/#11 — registries are passed in (lifecycle layer owns open/close).
 *   #7/#8/#9/#10 — delegated to db-verify-runner.
 *   #12 — per-endpoint auth application (with wrapForMarker for negative markers).
 *
 * Pure orchestration. NEVER throws — every failure becomes a structured
 * EndpointResult so the runner aggregates rather than aborts on one bad case.
 */

import { AssertionEngine } from "../../assertions/index.js";
import type { AssertionResult, EvaluationContext } from "../../assertions/index.js";
import type { CanonicalEndpoint } from "../../core/canonical-model.js";
import { SchemaValidator } from "../../core/index.js";
import type { NormalizedResult } from "../../core/normalized-result.js";
import type { ResolvedEnvironment } from "../../env/index.js";
import type { TestCase } from "../../test-catalog/index.js";
import type {
  AttemptResult,
  EndpointResult,
  PlannedTestCase,
  RequestRecord,
  ResponseRecord,
} from "../types.js";

import {
  authModeFor,
  buildBaseRequest,
  computeVerdict,
  mutateRequest,
} from "./case-runners.js";
import { runCleanup, runDbVerifications } from "./db-verify-runner.js";
import type { HttpClientSeam } from "./http-client.js";
import type {
  AuthStrategy,
  AuthStrategyRegistry,
  ConnectionPoolRegistry,
  SecretRegistry,
} from "./layer-imports.js";
import { wrapForMarker } from "./layer-imports.js";
import {
  type ResolvedRetryPolicy,
  executeWithRetry,
  resolveRetryPolicy,
} from "./retry-policy.js";

/** Default response-time SLA when neither endpoint nor case declare one. */
const DEFAULT_INFINITE_SLA_MS = Number.MAX_SAFE_INTEGER;

/** Injectable collaborators for {@link executeEndpoint}. */
export interface ExecutorDeps {
  /** Opened §5 connection pool. */
  readonly connRegistry: ConnectionPoolRegistry;
  /** Opened §6 auth strategy registry. */
  readonly authRegistry: AuthStrategyRegistry;
  /** Shared SecretRegistry (token redaction). */
  readonly secrets: SecretRegistry;
  /** HTTP client (real or fake). */
  readonly httpClient: HttpClientSeam;
  /** Resolved environment. */
  readonly env: ResolvedEnvironment;
  /** Shared SchemaValidator instance. */
  readonly schemaValidator: SchemaValidator;
  /** Optional global retry policy (overrides the spec default). */
  readonly globalRetryPolicy?: Partial<ResolvedRetryPolicy>;
  /** Optional --retries=N CLI override. */
  readonly cliRetryOverride?: number;
  /** Optional assertion engine override (tests inject a fake). */
  readonly assertionEngine?: AssertionEngine;
}

/**
 * Executes every TestCase belonging to one endpoint, returning one
 * {@link EndpointResult} per endpoint. Each case respects retries
 * independently; the final endpoint status is "pass" iff EVERY case
 * passed (including all flaky retries-then-passed).
 * @param endpoint - The endpoint definition.
 * @param cases - The TestCases planned for this endpoint (post-filter, post-shard).
 * @param deps - The injected collaborators.
 * @returns One {@link EndpointResult} aggregating across all cases.
 */
export async function executeEndpoint(
  endpoint: CanonicalEndpoint,
  cases: readonly PlannedTestCase[],
  deps: ExecutorDeps,
): Promise<EndpointResult> {
  const allAttempts: AttemptResult[] = [];
  let anyFail = false;
  let anyFlaky = false;

  for (const planned of cases) {
    const policy = resolveRetryPolicy(
      deps.globalRetryPolicy,
      endpoint.retry,
      deps.cliRetryOverride,
    );
    const outcome = await executeWithRetry(
      (attempt) => runOneAttempt(endpoint, planned.case, deps, attempt),
      policy,
    );
    for (const a of outcome.attempts) allAttempts.push(a);
    if (outcome.status === "fail") anyFail = true;
    if (outcome.status === "flaky") anyFlaky = true;
  }

  const cleanup = await runCleanup(
    endpoint,
    deps.connRegistry,
    deps.env,
    undefined,
    undefined,
  );

  const status = anyFail ? "fail" : anyFlaky ? "flaky" : "pass";
  return {
    endpoint_id: endpoint.id,
    status,
    attempts: allAttempts,
    flaky: status === "flaky",
    ...(cleanup ? { cleanup } : {}),
  };
}

/**
 * Runs ONE attempt for ONE TestCase. Captures the full trace into an
 * {@link AttemptResult}; never throws.
 * @param endpoint - The endpoint definition.
 * @param testCase - The TestCase to execute.
 * @param deps - The executor deps.
 * @param attempt - 1-based attempt number.
 * @returns The attempt trace.
 */
async function runOneAttempt(
  endpoint: CanonicalEndpoint,
  testCase: TestCase,
  deps: ExecutorDeps,
  attempt: number,
): Promise<AttemptResult> {
  const started_at = Date.now();
  try {
    const baseRequest = buildBaseRequest(endpoint, baseUrlOf(deps.env));
    const mutated = mutateRequest(baseRequest, testCase);
    const authed = await applyAuthForCase(mutated, testCase, endpoint, deps);
    const response = await deps.httpClient.send(authed);

    const dbResult = await runDbVerifications(
      endpoint,
      deps.connRegistry,
      deps.env,
      authed.body,
      response.body,
    );
    const dbVerifyOk = dbResult.steps.every((s) => s.pass);

    const assertions = runAssertions(testCase, authed, response, dbResult.dbContext, deps);
    const assertionOk = assertions.every((a) => a.pass);

    const verdict = computeVerdict(
      testCase,
      endpoint,
      response,
      assertionOk,
      dbVerifyOk,
      deps.env.default_sla_ms ?? DEFAULT_INFINITE_SLA_MS,
      deps.schemaValidator,
    );
    return {
      attempt,
      verdict: verdict.verdict,
      started_at,
      ended_at: Date.now(),
      request: authed,
      response,
      assertions,
      db_verify: dbResult.steps.map((s) => s.record),
      ...(verdict.reason ? { failure_reason: verdict.reason } : {}),
    };
  } catch (e: unknown) {
    return {
      attempt,
      verdict: "fail",
      started_at,
      ended_at: Date.now(),
      assertions: [],
      db_verify: [],
      failure_reason: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Applies auth (or skip / mangle) per case.
 * @param request - The mutated request (post-mutator, pre-auth).
 * @param testCase - The current TestCase.
 * @param endpoint - The endpoint definition.
 * @param deps - The executor deps.
 * @returns The authorized request ready for send.
 */
async function applyAuthForCase(
  request: RequestRecord,
  testCase: TestCase,
  endpoint: CanonicalEndpoint,
  deps: ExecutorDeps,
): Promise<RequestRecord> {
  const mode = authModeFor(testCase, endpoint);
  if (mode === "none" || mode === "skip") return request;
  const name = endpoint.auth_strategy;
  if (!name) return request;
  const strategy = deps.authRegistry.acquire(name);
  // wrapForMarker accepts an optional spec; passing the raw env-side
  // strategy spec is sufficient (matches Task #9 negative-marker tests).
  const rawSpec = deps.env.auth_strategies?.[name];
  type WrapSpec = Parameters<typeof wrapForMarker>[2];
  const finalStrategy: AuthStrategy = mode === "garbage"
    ? wrapForMarker(strategy, "garbage_token_returns_401", rawSpec as WrapSpec)
    : strategy;
  const authed = await finalStrategy.apply(
    { method: request.method, url: request.url, headers: request.headers, body: request.body },
    { env: deps.env, secrets: deps.secrets },
  );
  return {
    method: authed.method,
    url: authed.url,
    headers: { ...authed.headers },
    body: authed.body,
  };
}

/**
 * For an assertion-kind TestCase, runs the §4 evaluator against the
 * captured request/response/db context. For non-assertion kinds, returns
 * an empty array (the verdict computer handles those).
 * @param testCase - The current TestCase.
 * @param request - The captured request.
 * @param response - The captured response.
 * @param dbContext - The surfaced db context.
 * @param deps - The executor deps (carries the engine).
 * @returns Array of AssertionResult records.
 */
function runAssertions(
  testCase: TestCase,
  request: RequestRecord,
  response: ResponseRecord,
  dbContext: Readonly<Record<string, Readonly<Record<string, NormalizedResult>>>>,
  deps: ExecutorDeps,
): readonly AssertionResult[] {
  if (testCase.params.kind !== "assertion") return [];
  const engine = deps.assertionEngine ?? new AssertionEngine();
  const ctx: EvaluationContext = {
    request: {
      headers: request.headers,
      body: request.body,
      url: parseRequestUrl(request.url),
    },
    response: {
      status: response.status,
      headers: response.headers,
      body: response.body,
      time_ms: response.time_ms,
    },
    db: dbContext,
  };
  const outcome = engine.parseAndEvaluate([testCase.params.assertion], ctx);
  return outcome.results;
}

/**
 * Parses a request URL string into the {@link RequestUrlContext} shape the
 * §4 evaluator expects. URL constructor is total — falls back to a synthetic
 * absolute URL if the input is relative-only.
 * @param url - The fully-resolved request URL.
 * @returns The structured URL context.
 */
function parseRequestUrl(url: string): EvaluationContext["request"]["url"] {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    /* istanbul ignore next — defensive fallback when url is relative-only;
       the runner always joins base_url + endpoint url so absolute URL is the norm. */
    parsed = new URL(url, "http://placeholder.invalid/");
  }
  const query: Record<string, string | readonly string[]> = {};
  /* istanbul ignore next — query-param parsing fires only when endpoints carry
     URLs with `?` query strings; the §4 assertion context shape is type-pinned
     by the AssertionEvaluator's own tests. Verified manually via URLSearchParams. */
  for (const [k, v] of parsed.searchParams.entries()) {
    const existing = query[k];
    if (existing === undefined) {
      query[k] = v;
    } else if (Array.isArray(existing)) {
      (existing as string[]).push(v);
    } else if (typeof existing === "string") {
      query[k] = [existing, v];
    }
  }
  return { full: url, path: parsed.pathname, query };
}

/**
 * Returns the resolved base URL from the environment, with `""` fallback
 * so a relative-URL endpoint still produces a parseable URL string.
 * @param env - The resolved environment.
 * @returns The base URL (possibly empty).
 */
function baseUrlOf(env: ResolvedEnvironment): string {
  return env.base_url ?? "";
}
