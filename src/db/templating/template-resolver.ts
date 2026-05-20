/**
 * RESOLUTION (execution-time, context injected). Pure, deterministic, total,
 * NEVER throws. Resolves each extracted {@link Ref} to a value: `${env.*}`
 * via the `src/env` lookup against `context.env`; `${request.body.*}` /
 * `${response.body.*}` via the **shared `src/core` bounded path-walk** over
 * `context.requestBody` / `context.responseBody` (segments produced by the
 * §4 `classifyPath` rule). A found explicit `null` resolves to `null`
 * (the core walk's found/not-found contract guarantees this); a missing /
 * OOB / wrong-type / over-depth path is an aggregated `UNRESOLVED_REF`
 * rejection (NEVER an empty string, NEVER a throw).
 */

import { classifyPath } from "../../assertions/target-path-db.js";
import { walkPath } from "../../core/path-walk.js";

import type { BoundValue, Ref, RefRejection, ResolutionContext, ResolveResult } from "./types.js";

/**
 * Resolve an `env` namespace ref against `context.env`.
 * Uses the shared `src/core` `walkPath` SSOT with `classifyPath` segments.
 * Explicit null leaf ⇒ found, value null. Non-object mid-path ⇒ not found.
 * @param ref - The Ref to resolve.
 * @param env - The resolved environment map.
 * @returns BoundValue on success, RefRejection on UNRESOLVED_REF.
 */
function resolveEnvRef(
  ref: Ref,
  env: Readonly<Record<string, unknown>>,
): BoundValue | RefRejection {
  const segments = classifyPath(ref.path.split("."));
  const result = walkPath(env, segments);
  if (result.found) {
    return { index: ref.index, value: result.value };
  }
  return {
    code: "UNRESOLVED_REF",
    ref: ref.raw,
    path: ref.path,
    message: `Unresolved env ref ${ref.raw}: path '${ref.path}' not found in context.env`,
  };
}

/**
 * Resolve a `request.body` or `response.body` namespace ref against the
 * respective context body using the shared `src/core` bounded path-walk.
 * Segments are produced by the §4 `classifyPath` rule.
 * @param ref - The Ref to resolve.
 * @param body - The context body value (may be undefined).
 * @returns BoundValue on success, RefRejection on UNRESOLVED_REF.
 */
function resolveBodyRef(
  ref: Ref,
  body: unknown,
): BoundValue | RefRejection {
  if (body === undefined) {
    return {
      code: "UNRESOLVED_REF",
      ref: ref.raw,
      path: ref.path,
      message:
        `Unresolved ref ${ref.raw}: context body for namespace '${ref.namespace}' is absent`,
    };
  }
  const segments = classifyPath(ref.path.split("."));
  const result = walkPath(body, segments);
  if (result.found) {
    return { index: ref.index, value: result.value };
  }
  return {
    code: "UNRESOLVED_REF",
    ref: ref.raw,
    path: ref.path,
    message:
      `Unresolved ref ${ref.raw}: path '${ref.path}' not found in ${ref.namespace} context`,
  };
}

/**
 * Type guard: is this a BoundValue (has `value` key but not `code`)?
 * @param x - The candidate to test.
 * @returns True iff `x` is a BoundValue.
 */
function isBoundValue(x: BoundValue | RefRejection): x is BoundValue {
  return "value" in x;
}

/**
 * RESOLUTION (execution-time, context injected). Pure, deterministic, total,
 * NEVER throws. Resolves each extracted {@link Ref} to a value: `${env.*}`
 * via the `src/env` lookup against `context.env`; `${request.body.*}` /
 * `${response.body.*}` via the **shared `src/core` bounded path-walk** over
 * `context.requestBody` / `context.responseBody` (segments produced by the
 * §4 `classifyPath` rule). A found explicit `null` resolves to `null`
 * (the core walk's found/not-found contract guarantees this); a missing /
 * OOB / wrong-type / over-depth path is an aggregated `UNRESOLVED_REF`
 * rejection (NEVER an empty string, NEVER a throw — the core walk is itself
 * no-throw).
 * @param refs - The extracted, de-duplicated, index-ordered refs.
 * @param context - The runtime resolution context (Task #10 supplies it).
 * @returns ResolveResult: `ok` with index-ordered BoundValues, or
 *   aggregated UNRESOLVED_REF rejections.
 */
export function resolveRefs(
  refs: readonly Ref[],
  context: ResolutionContext,
): ResolveResult {
  if (refs.length === 0) {
    return { ok: true, values: [] };
  }

  const values: BoundValue[] = [];
  const rejections: RefRejection[] = [];

  // Defensive: handle malformed context (null env, etc.)
  const env =
    context.env !== null && typeof context.env === "object"
      ? context.env
      : {};

  for (const ref of refs) {
    let outcome: BoundValue | RefRejection;
    if (ref.namespace === "env") {
      outcome = resolveEnvRef(ref, env);
    } else if (ref.namespace === "request.body") {
      outcome = resolveBodyRef(ref, context.requestBody);
    } else {
      // response.body
      outcome = resolveBodyRef(ref, context.responseBody);
    }

    if (isBoundValue(outcome)) {
      values.push(outcome);
    } else {
      rejections.push(outcome);
    }
  }

  if (rejections.length > 0) {
    return { ok: false, rejections };
  }
  return { ok: true, values };
}
