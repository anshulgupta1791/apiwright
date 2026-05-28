/**
 * Per-endpoint db_verify pipeline runner. Discharges obligations:
 *   #7  — §5 per-endpoint extract → resolve → execute → evaluate.
 *   #8  — §5 verify-then-cleanup ordering.
 *   #9  — §5 db.<conn>.<query_id> surfacing into the §4 evaluation context.
 *   #10 — §5 params ↔ Ref.index encoding (Record<string, unknown> keyed by index).
 *
 * Pure orchestration — uses the shipped §5 primitives only. The runner does
 * extractRefs + resolveRefs to obtain resolved values; the connector
 * re-extracts internally and binds natively, so we pass the verbatim user
 * query + a Record keyed by `Ref.index` (the obligation #10 contract).
 */

import type { CanonicalDbVerification, CanonicalEndpoint } from "../../core/canonical-model.js";
import type { NormalizedResult } from "../../core/normalized-result.js";
import {
  ConnectionPoolRegistry,
  evaluate as evaluateDb,
  extractRefs,
  resolveRefs,
} from "../../db/index.js";
import type { ResolutionContext } from "../../db/index.js";
import type { DbVerifyOutcomeRecord } from "../types.js";

/** Synthesized fallback query_id when a verification omits one. */
const SYNTHESIZED_QUERY_ID_PREFIX = "q";

/** Per-verification result aggregated into the executor's overall outcome. */
export interface DbVerifyStepResult {
  /** The record emitted into the AttemptResult. */
  readonly record: DbVerifyOutcomeRecord;
  /** True iff the evaluate step yielded pass. */
  readonly pass: boolean;
}

/**
 * Executes every db_verify on an endpoint in declaration order. Surfaces
 * each NormalizedResult under `dbContext[connection][query_id]` so the §4
 * evaluator can resolve `db.<conn>.<qid>` paths (obligation #9).
 * @param endpoint - The endpoint definition.
 * @param connRegistry - Opened ConnectionPoolRegistry.
 * @param resolutionEnv - The resolved environment plain-object (for ${env.*}).
 * @param requestBody - Outgoing request body (for ${request.body.*}).
 * @param responseBody - Captured response body (for ${response.body.*}).
 * @returns The list of {@link DbVerifyStepResult}s in declaration order, plus
 *   the dbContext map ready to splice into the §4 EvaluationContext.
 */
export async function runDbVerifications(
  endpoint: CanonicalEndpoint,
  connRegistry: ConnectionPoolRegistry,
  resolutionEnv: Readonly<Record<string, unknown>>,
  requestBody: unknown,
  responseBody: unknown,
): Promise<{
  readonly steps: readonly DbVerifyStepResult[];
  readonly dbContext: Readonly<Record<string, Readonly<Record<string, NormalizedResult>>>>;
}> {
  const verifications = endpoint.db_verify ?? [];
  if (verifications.length === 0) return { steps: [], dbContext: {} };

  const steps: DbVerifyStepResult[] = [];
  const dbContext: Record<string, Record<string, NormalizedResult>> = {};

  for (let i = 0; i < verifications.length; i++) {
    const v = verifications[i];
    /* istanbul ignore next — index always in-bounds; defensive for noUncheckedIndexedAccess. */
    if (v === undefined) continue;
    const qid = v.query_id ?? `${SYNTHESIZED_QUERY_ID_PREFIX}${i}`;
    const step = await runOne(v, qid, connRegistry, resolutionEnv, requestBody, responseBody);
    steps.push(step);
    if (!dbContext[v.connection]) dbContext[v.connection] = {};
    const connBucket = dbContext[v.connection];
    /* istanbul ignore next — connBucket was just initialized above when absent. */
    if (connBucket) connBucket[qid] = step.record.normalized;
  }

  return { steps, dbContext };
}

/**
 * Executes ONE db_verify: extract refs → resolve → connector.execute → evaluate.
 * Captures the result into a {@link DbVerifyStepResult} regardless of pass/fail.
 * @param v - The CanonicalDbVerification.
 * @param qid - The query_id (or synthesized fallback).
 * @param connRegistry - Opened ConnectionPoolRegistry.
 * @param resolutionEnv - Plain env object for ${env.*} resolution.
 * @param requestBody - Outgoing request body.
 * @param responseBody - Captured response body.
 * @returns The {@link DbVerifyStepResult}.
 */
async function runOne(
  v: CanonicalDbVerification,
  qid: string,
  connRegistry: ConnectionPoolRegistry,
  resolutionEnv: Readonly<Record<string, unknown>>,
  requestBody: unknown,
  responseBody: unknown,
): Promise<DbVerifyStepResult> {
  const extracted = extractRefs(v.query);
  if (!extracted.ok) {
    return failRecord(v, qid, `ref extraction failed: ${describeRejections(extracted.rejections)}`);
  }
  const resolved = resolveRefs(extracted.neutral.refs, {
    env: resolutionEnv,
    requestBody,
    responseBody,
  });
  if (!resolved.ok) {
    return failRecord(v, qid, `ref resolution failed: ${describeRejections(resolved.rejections)}`);
  }
  const connector = await connRegistry.acquire(v.connection);
  const params = encodeParams(resolved.values);
  try {
    // Pass the SENTINEL-ized query (refs already replaced by APIWRIGHT_PARAM_n
    // placeholders), NOT the raw `${...}` string. The connectors' `execute()`
    // contract expects sentinels pre-placed upstream; passing the raw query
    // leaked the `$` of `${...}` into the SQL and broke db_verify for every
    // SQL engine end-to-end (issue #27). `extracted.neutral.neutralQuery` is
    // exactly that sentinel form, computed by extractRefs above.
    const sentinelQuery = neutralQueryString(extracted.neutral.neutralQuery, v.query);
    const normalized = await connector.execute(sentinelQuery, params);
    // Resolve `${...}` refs in the expect:match `fields` values before
    // comparison (issue #31): the row-match compares DB values against the
    // declared `fields`, so an unresolved `"${request.body.id}"` would never
    // match a resolved DB value. The dominant form (a whole-value pure ref)
    // is resolved type-preserving here.
    const refContext: ResolutionContext = { env: resolutionEnv, requestBody, responseBody };
    const vForEval =
      v.fields === undefined ? v : { ...v, fields: resolveFieldRefs(v.fields, refContext) };
    const outcome = evaluateDb(normalized, vForEval);
    const passed = outcome.pass;
    return {
      record: passed
        ? { connection: v.connection, query_id: qid, normalized, pass: true }
        : {
            connection: v.connection,
            query_id: qid,
            normalized,
            pass: false,
            reason: outcome.reason,
          },
      pass: passed,
    };
  } catch (e: unknown) {
    const reason = e instanceof Error ? e.message : String(e);
    return failRecord(v, qid, `connector execute failed: ${reason}`);
  }
}

/**
 * Narrows the polymorphic `neutralQuery` (string | object | array — the
 * union arises because `extractRefs` also accepts Mongo command objects)
 * to the string the connectors' `execute(query: string, …)` requires.
 *
 * `CanonicalDbVerification.query` / `cleanup.query` are always strings per
 * the meta-schema, so the sentinel-ized `neutralQuery` is always a string
 * here; `fallback` (the original raw query) is returned only if that
 * invariant is ever violated.
 * @param neutral - The neutralQuery from extractRefs (possibly non-string).
 * @param fallback - The original raw query string (schema-guaranteed string).
 * @returns The sentinel-ized query as a string.
 */
/**
 * Resolves whole-value pure `${...}` refs in an expect:match `fields` map
 * (issue #31). Each field value that is a single `${ref}` is replaced with
 * the resolved, type-preserving value (so a DB integer matches an integer,
 * not the string `"${...}"`). Non-string values, plain strings without a
 * ref, and embedded/interpolated refs pass through unchanged — db_verify
 * `fields` conventionally use a single whole-value ref.
 * @param fields - The declared expect:match fields.
 * @param context - The ref-resolution context (env / request / response).
 * @returns A new fields object with pure refs resolved to their values.
 */
function resolveFieldRefs(
  fields: Readonly<Record<string, unknown>>,
  context: ResolutionContext,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    out[key] = typeof value === "string" ? resolvePureRef(value, context) : value;
  }
  return out;
}

/**
 * Resolves a single whole-value pure `${...}` ref string to its typed
 * value; returns the input unchanged when it is not a whole-value ref or
 * cannot be resolved.
 * @param raw - The field value string.
 * @param context - The ref-resolution context.
 * @returns The resolved value, or `raw` unchanged.
 */
function resolvePureRef(raw: string, context: ResolutionContext): unknown {
  if (!/^\$\{[^}]*\}$/.test(raw.trim())) return raw;
  const ext = extractRefs(raw);
  if (!ext.ok || ext.neutral.refs.length !== 1) return raw;
  const resolved = resolveRefs(ext.neutral.refs, context);
  /* istanbul ignore next — a resolution failure leaves the raw template,
     which then visibly fails the row-match rather than silently passing. */
  if (!resolved.ok || resolved.values.length !== 1) return raw;
  return resolved.values[0]?.value;
}

function neutralQueryString(
  neutral: string | Readonly<Record<string, unknown>> | readonly unknown[],
  fallback: string,
): string {
  /* istanbul ignore next — db_verify/cleanup queries are always strings per the
     meta-schema, so `neutral` is always a string; the fallback guards an
     invariant that cannot occur for these call sites. */
  return typeof neutral === "string" ? neutral : fallback;
}

/**
 * Encodes the index-ordered `BoundValue[]` from `resolveRefs` into the
 * `Record<string, unknown>` shape connectors accept — the obligation #10
 * runner↔connector encoding contract. Index `i` becomes the key `"i"`.
 * @param values - The values array from resolveRefs.
 * @returns The params Record keyed by stringified Ref.index.
 */
function encodeParams(values: readonly { readonly value: unknown }[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    /* istanbul ignore next — index always in-bounds; defensive for noUncheckedIndexedAccess. */
    if (v !== undefined) out[String(i)] = v.value;
  }
  return out;
}

/**
 * Produces a failing DbVerifyStepResult with an empty NormalizedResult and
 * a structured reason. Used for pre-execute failures (extract/resolve).
 * @param v - The verification.
 * @param qid - The query_id.
 * @param reason - Human-readable reason.
 * @returns Failing step result.
 */
function failRecord(
  v: CanonicalDbVerification,
  qid: string,
  reason: string,
): DbVerifyStepResult {
  return {
    record: {
      connection: v.connection,
      query_id: qid,
      normalized: { rows: [], rowCount: 0, raw: {} },
      pass: false,
      reason,
    },
    pass: false,
  };
}

/**
 * Joins rejection messages into one comma-separated string for the reason.
 * @param rejs - The list of rejections.
 * @returns A flat string.
 */
function describeRejections(
  rejs: readonly { readonly code: string; readonly path: string }[],
): string {
  return rejs.map((r) => `${r.code} at '${r.path}'`).join("; ");
}

/**
 * Runs the cleanup query if defined on the endpoint. Runs AFTER all
 * verifications (obligation #8 verify-then-cleanup ordering). Returns the
 * outcome regardless of pass/fail.
 * @param endpoint - The endpoint definition.
 * @param connRegistry - Opened ConnectionPoolRegistry.
 * @param resolutionEnv - Plain env object.
 * @param requestBody - Outgoing request body.
 * @param responseBody - Captured response body.
 * @returns Cleanup outcome, or `undefined` if no cleanup defined.
 */
export async function runCleanup(
  endpoint: CanonicalEndpoint,
  connRegistry: ConnectionPoolRegistry,
  resolutionEnv: Readonly<Record<string, unknown>>,
  requestBody: unknown,
  responseBody: unknown,
): Promise<{ ok: boolean; reason?: string } | undefined> {
  const cleanup = endpoint.cleanup;
  if (!cleanup) return undefined;
  try {
    const extracted = extractRefs(cleanup.query);
    if (!extracted.ok) return { ok: false, reason: "cleanup ref extraction failed" };
    const resolved = resolveRefs(extracted.neutral.refs, {
      env: resolutionEnv,
      requestBody,
      responseBody,
    });
    if (!resolved.ok) return { ok: false, reason: "cleanup ref resolution failed" };
    const connector = await connRegistry.acquire(cleanup.connection);
    // Sentinel-ized query (not raw `${...}`) — see the note in runOne (#27).
    await connector.execute(
      neutralQueryString(extracted.neutral.neutralQuery, cleanup.query),
      encodeParams(resolved.values),
    );
    return { ok: true };
  } catch (e: unknown) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}
