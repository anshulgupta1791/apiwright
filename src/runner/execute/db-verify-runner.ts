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
    const normalized = await connector.execute(v.query, params);
    const outcome = evaluateDb(normalized, v);
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
    await connector.execute(cleanup.query, encodeParams(resolved.values));
    return { ok: true };
  } catch (e: unknown) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}
