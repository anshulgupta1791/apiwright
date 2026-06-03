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
 *
 * File exceeds the 300-line soft limit: `maybeRunSecondRequest` and its
 * per-kind dispatch arms (`get_idempotency`, `delete_idempotency`,
 * `put_idempotency`, `head_get_parity`) are intentionally co-located here
 * because all four share the same first-response gate, auth re-application,
 * signal forwarding, and shared URL-resolution pipeline; splitting them would
 * scatter a single two-request orchestration concern across multiple files
 * without reducing the coupling. The `head_get_parity` arm (PR #3, v1.0.2)
 * additionally uses the `resolveTemplates` + `joinUrl` pipeline already present
 * in `buildBaseRequest`, making co-location the natural choice.
 */

import { AssertionEngine } from "../../assertions/index.js";
import type {
  AssertionResult,
  EvaluationContext,
} from "../../assertions/index.js";
import type { CanonicalEndpoint } from "../../core/canonical-model.js";
import { SchemaValidator } from "../../core/index.js";
import type { NormalizedResult } from "../../core/normalized-result.js";
import type { ResolvedEnvironment } from "../../env/index.js";
import { resolveTemplates } from "../../env/template-resolver.js";
import type {
  HeadGetParityParams,
  PutIdempotencyParams,
  TestCase,
} from "../../test-catalog/index.js";
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
  deleteIdempotencyVerdict,
  getIdempotencyVerdict,
  headGetParityVerdict,
  joinUrl,
  mutateRequest,
  putIdempotencyVerdict,
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
 * @param signal - Optional abort signal forwarded to every HTTP request.
 *   The §9 pool's per-endpoint timeout watchdog fires this signal when
 *   the wall-clock budget is exceeded; in-flight HTTP work unwinds via
 *   the AbortSignal contract, the executor's per-attempt catch records
 *   a fail-attempt, and the pool slot is released.
 * @returns One {@link EndpointResult} aggregating across all cases.
 */
export async function executeEndpoint(
  endpoint: CanonicalEndpoint,
  cases: readonly PlannedTestCase[],
  deps: ExecutorDeps,
  signal?: AbortSignal,
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
      (attempt) => runOneAttempt(endpoint, planned.case, deps, attempt, signal),
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
 * @param signal - Optional abort signal forwarded to the HTTP client.
 * @returns The attempt trace.
 */
async function runOneAttempt(
  endpoint: CanonicalEndpoint,
  testCase: TestCase,
  deps: ExecutorDeps,
  attempt: number,
  signal?: AbortSignal,
): Promise<AttemptResult> {
  const started_at = Date.now();
  try {
    const baseRequest = buildBaseRequest(endpoint, deps.env);
    const mutated = mutateRequest(baseRequest, testCase);
    const authed = await applyAuthForCase(mutated, testCase, endpoint, deps);
    const response = await deps.httpClient.send(authed, signal);

    const dbResult = await runDbVerifications(
      endpoint,
      deps.connRegistry,
      deps.env,
      authed.body,
      response.body,
    );
    const dbVerifyOk = dbResult.steps.every((s) => s.pass);

    const assertions = runAssertions(
      testCase,
      authed,
      response,
      dbResult.dbContext,
      deps,
    );
    const assertionOk = assertions.every((a) => a.pass);

    const firstResponseVerdict = computeVerdict(
      testCase,
      endpoint,
      response,
      assertionOk,
      dbVerifyOk,
      deps.env.default_sla_ms ?? DEFAULT_INFINITE_SLA_MS,
      deps.schemaValidator,
    );

    // Issue #50 — get_idempotency / delete_idempotency are TWO-request
    // cases. The first-response gate (`firstResponseVerdict`) determines
    // whether the runner attempts the SECOND request: if the first didn't
    // succeed (e.g. 5xx), there's no meaningful comparison and we keep the
    // single-response failure verdict. If the first succeeded, the runner
    // re-applies auth (in case the strategy refreshed the token), issues
    // the second request, and computes the comparison verdict.
    const twoRequest = await maybeRunSecondRequest(
      testCase,
      endpoint,
      deps,
      mutated,
      response,
      firstResponseVerdict,
      signal,
    );
    const verdict = twoRequest?.verdict ?? firstResponseVerdict;
    const secondRequest = twoRequest?.request;
    const secondResponse = twoRequest?.response;

    return {
      case_id: testCase.id,
      kind: testCase.type,
      attempt,
      verdict: verdict.verdict,
      started_at,
      ended_at: Date.now(),
      request: authed,
      response,
      assertions,
      db_verify: dbResult.steps.map((s) => s.record),
      ...(secondRequest ? { second_request: secondRequest } : {}),
      ...(secondResponse ? { second_response: secondResponse } : {}),
      ...(verdict.reason ? { failure_reason: verdict.reason } : {}),
    };
  } catch (e: unknown) {
    return {
      case_id: testCase.id,
      kind: testCase.type,
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

/** Result of `maybeRunSecondRequest`. */
interface SecondRequestResult {
  /** The second request that was sent (re-authed per `applyAuthForCase`). */
  readonly request: RequestRecord;
  /** The second response captured from the wire. */
  readonly response: ResponseRecord;
  /** The verdict computed from comparing first vs second response. */
  readonly verdict: {
    readonly verdict: "pass" | "fail";
    readonly reason?: string;
  };
}

/**
 * Issues the SECOND request for the two-request idempotency cases (issue
 * #50, put_idempotency) and computes the comparison verdict. Returns
 * `undefined` for every other case kind (single-request path stays unchanged).
 *
 * Gate: if the FIRST response already failed the single-response gate
 * (non-2xx), there is no meaningful "compare two responses" — keep the
 * single-response failure verdict; do not waste a second request.
 *
 * Auth: re-applies the strategy. For `token_endpoint` the cached token is
 * reused (D5 single-flight); for `static_token` the header is re-injected
 * verbatim. Same auth-mode logic as the first send (so e.g. a
 * `garbage_token_returns_401` case would re-mangle the token consistently).
 *
 * put_idempotency db_state mode: runs `runDbVerifications` a SECOND time
 * using the SECOND response body after the second PUT, then passes the
 * aggregated boolean to `putIdempotencyVerdict`. For body_equality mode the
 * second `runDbVerifications` is intentionally skipped (design decision #10).
 * @param testCase - The current TestCase (idempotency cases trigger; others bypass).
 * @param endpoint - The endpoint definition.
 * @param deps - The executor deps.
 * @param mutated - The mutated (post-mutator, pre-auth) request from the first send.
 * @param firstResponse - The captured first response.
 * @param firstVerdict - Verdict from the single-response gate (verdict + reason).
 * @param firstVerdict.verdict - "pass" or "fail" outcome of the first send.
 * @param firstVerdict.reason - Optional human-readable explanation for fail.
 * @param signal - Abort signal forwarded to the HTTP client.
 * @returns The second-request result, or `undefined` for non-idempotency
 *   cases or when the first-gate failed.
 */
async function maybeRunSecondRequest(
  testCase: TestCase,
  endpoint: CanonicalEndpoint,
  deps: ExecutorDeps,
  mutated: RequestRecord,
  firstResponse: ResponseRecord,
  firstVerdict: { readonly verdict: "pass" | "fail"; readonly reason?: string },
  signal?: AbortSignal,
): Promise<SecondRequestResult | undefined> {
  const kind = testCase.params.kind;
  if (
    kind !== "get_idempotency" &&
    kind !== "delete_idempotency" &&
    kind !== "put_idempotency" &&
    kind !== "head_get_parity"
  ) {
    return undefined;
  }
  // First-response gate: if the first response was non-2xx, there's no
  // meaningful comparison — keep the gate verdict, don't issue a second.
  if (firstVerdict.verdict === "fail") return undefined;

  // head_get_parity: synthesize the GET request, then re-auth and send.
  if (kind === "head_get_parity") {
    return maybeRunHeadGetParity(testCase, endpoint, deps, mutated, firstResponse, signal);
  }

  const secondAuthed = await applyAuthForCase(
    mutated,
    testCase,
    endpoint,
    deps,
  );
  const secondResponse = await deps.httpClient.send(secondAuthed, signal);

  if (kind === "get_idempotency") {
    return {
      request: secondAuthed,
      response: secondResponse,
      verdict: getIdempotencyVerdict(firstResponse, secondResponse),
    };
  }

  if (kind === "delete_idempotency") {
    // params is narrowed by the discriminant check above (kind === "delete_idempotency"
    // implies params has second_delete_status), but TS's narrowing doesn't reach here;
    // the type guard below restores it without an unnecessary outer cast.
    return {
      request: secondAuthed,
      response: secondResponse,
      verdict: deleteIdempotencyVerdict(
        secondResponse,
        deleteSecondStatus(testCase),
      ),
    };
  }

  // kind === "put_idempotency"
  const compare = putCompare(testCase);
  let dbVerifyOkSecond = true;
  if (compare === "db_state") {
    const dbResultSecond = await runDbVerifications(
      endpoint,
      deps.connRegistry,
      deps.env,
      secondAuthed.body,
      secondResponse.body,
    );
    dbVerifyOkSecond = dbResultSecond.steps.every((s) => s.pass);
  }
  return {
    request: secondAuthed,
    response: secondResponse,
    verdict: putIdempotencyVerdict(
      firstResponse,
      secondResponse,
      compare,
      dbVerifyOkSecond,
    ),
  };
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
  const finalStrategy: AuthStrategy =
    mode === "garbage"
      ? wrapForMarker(
          strategy,
          "garbage_token_returns_401",
          rawSpec as WrapSpec,
        )
      : strategy;
  const authed = await finalStrategy.apply(
    {
      method: request.method,
      url: request.url,
      headers: request.headers,
      body: request.body,
    },
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
  dbContext: Readonly<
    Record<string, Readonly<Record<string, NormalizedResult>>>
  >,
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
 * Executes the second request (GET) for a `head_get_parity` case. Called
 * only when the first response (HEAD) passed the 2xx gate.
 *
 * Synthesizes a GET request from the HEAD's pre-auth headers + the
 * `params.paired_get_url` template (resolved via `resolveTemplates` + `joinUrl`
 * for `${env.*}` substitution, identical to `buildBaseRequest`). Auth is then
 * re-applied using the HEAD endpoint's `auth_strategy` (design decision DD-2).
 *
 * Defensive guard: if `paired_get_url` is the empty string (should not occur
 * after plan resolution, but protects against hand-edited plan files), fails
 * with the documented `failure_reason` without issuing the GET request.
 * @param testCase - The head_get_parity TestCase.
 * @param endpoint - The HEAD endpoint definition.
 * @param deps - Executor deps.
 * @param mutated - The mutated (post-mutator, pre-auth) HEAD request.
 * @param firstResponse - The captured HEAD response.
 * @param signal - Optional abort signal.
 * @returns The second-request result.
 */
async function maybeRunHeadGetParity(
  testCase: TestCase,
  endpoint: CanonicalEndpoint,
  deps: ExecutorDeps,
  mutated: RequestRecord,
  firstResponse: ResponseRecord,
  signal?: AbortSignal,
): Promise<SecondRequestResult> {
  const rawUrl = pairedGetUrl(testCase);

  // Defensive guard per design decision Q8 (paired_get_url empty means the
  // plan resolver did not run — hand-edited plan file or future loader gap).
  /* istanbul ignore next — provably-unreachable defensive guard: the plan
     resolver (TestPlanGenerator.#resolvePairs) guarantees paired_get_url is
     never the empty string on any case that reaches the runner. This branch
     exists solely to guard against hand-edited plan files that bypass the
     resolver, making the failure mode explicit rather than a silent no-op. */
  if (rawUrl === "") {
    return {
      request: mutated,
      response: firstResponse,
      verdict: {
        verdict: "fail",
        reason: "head_get_parity: paired_get_url is empty (plan-resolver did not run)",
      },
    };
  }

  // Resolve ${env.*} templates in the paired GET URL using the same pipeline
  // used by buildBaseRequest for the HEAD's own URL.
  const tree: Record<string, unknown> = { url: rawUrl };
  const r = resolveTemplates(tree, deps.env);
  /* istanbul ignore next — defensive: plan-resolver validates pair_with before
     emitting; unresolvable env refs are caught at load time by validate (PR #72).
     This branch guards against hand-edited plans with missing env refs. */
  const urlField = r.ok && r.data ? r.data["url"] : undefined;
  const resolvedUrlStr = typeof urlField === "string" ? urlField : rawUrl;
  const finalUrl = joinUrl(deps.env.base_url, resolvedUrlStr);

  const swapped: RequestRecord = {
    method: "GET",
    url: finalUrl,
    headers: { ...mutated.headers },
    // GET requests carry no body; the mutated HEAD request's body (if any)
    // is intentionally dropped — a GET body is invalid per RFC 7231 §4.3.1.
  };
  const secondAuthed = await applyAuthForCase(swapped, testCase, endpoint, deps);
  const secondResponse = await deps.httpClient.send(secondAuthed, signal);
  return {
    request: secondAuthed,
    response: secondResponse,
    verdict: headGetParityVerdict(firstResponse, secondResponse),
  };
}


/**
 * Reads `second_delete_status` from a `delete_idempotency` TestCase's
 * params. Caller MUST have already discriminated on `params.kind`; this
 * helper exists purely to satisfy TS narrowing inside the conditional in
 * `maybeRunSecondRequest` without an outer cast at the call site.
 * @param testCase - The delete_idempotency TestCase.
 * @returns The declared (or defaulted) second-DELETE expected status.
 */
function deleteSecondStatus(testCase: TestCase): number {
  const params = testCase.params;
  if (params.kind === "delete_idempotency") return params.second_delete_status;
  /* istanbul ignore next — caller-guaranteed: discriminated above. */
  return 0;
}

/**
 * Narrows `put_idempotency` params.compare without an outer cast. Caller
 * MUST have already discriminated on `params.kind === "put_idempotency"`.
 * @param testCase - The put_idempotency TestCase.
 * @returns The declared compare mode.
 */
function putCompare(testCase: TestCase): PutIdempotencyParams["compare"] {
  const params = testCase.params;
  if (params.kind === "put_idempotency") return params.compare;
  /* istanbul ignore next — caller-guaranteed: discriminated above. */
  return "body_equality";
}

/**
 * Narrows `head_get_parity` params.paired_get_url without an outer cast.
 * Caller MUST have already discriminated on `params.kind === "head_get_parity"`.
 * @param testCase - The head_get_parity TestCase.
 * @returns The raw (pre-resolved) paired GET URL, or "" when not present.
 */
function pairedGetUrl(testCase: TestCase): HeadGetParityParams["paired_get_url"] {
  const params = testCase.params;
  if (params.kind === "head_get_parity") return params.paired_get_url;
  /* istanbul ignore next — caller-guaranteed: discriminated above. */
  return "";
}
