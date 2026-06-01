/**
 * Pure field-extraction helpers for the Postman flattener.
 *
 * Each function pulls one field group (headers, body, query, auth,
 * pre-request script, saved responses) out of a raw v2.1 Postman request
 * or item and returns the corresponding Flattened* shape. No I/O, no
 * shared state — split out of flattener.ts to keep each file focused and
 * under the 300-line soft limit.
 *
 * Types come from the in-house `v2-schema.ts` (the `postman-collection`
 * SDK was dropped in Lens 0 audit blocker B13 to eliminate vulnerable
 * lodash + uuid transitive deps).
 */

import type {
  FlattenedAuth,
  FlattenedBody,
  FlattenedHeader,
  FlattenedQueryParam,
  FlattenedResponse,
} from "../types.js";

import type {
  PostmanV21Item,
  PostmanV21Request,
  PostmanV21Url,
} from "./v2-schema.js";

/**
 * Extracts headers from a Postman request.
 * @param request - The raw v2.1 request (may be undefined).
 * @returns Array of flattened headers.
 */
export function extractHeaders(
  request: PostmanV21Request | undefined,
): FlattenedHeader[] {
  const headers: FlattenedHeader[] = [];
  if (!request?.header) return headers;
  for (const h of request.header) {
    const key = String(h.key);
    const value = String(h.value);
    headers.push({ key, value, disabled: h.disabled === true });
  }
  return headers;
}

/**
 * Extracts the request body from a Postman request.
 * @param request - The raw v2.1 request (may be undefined).
 * @returns A FlattenedBody or undefined when no body is present.
 */
export function extractBody(
  request: PostmanV21Request | undefined,
): FlattenedBody | undefined {
  const body = request?.body;
  if (!body) return undefined;
  const mode = body.mode ?? "raw";
  // `raw` only exists on the raw-mode discriminant; other modes carry
  // formdata / urlencoded / file / graphql payloads we don't currently
  // surface to FlattenedBody. Fall back to "" for any non-raw shape so
  // the downstream converter still gets a usable record.
  const raw =
    "raw" in body && typeof body.raw === "string" ? body.raw : "";
  return { mode, raw };
}

/**
 * Extracts query parameters from a Postman request URL.
 *
 * The query parameters can be carried either by the structured `url.query`
 * array (typical for Postman exports) or implicitly in the `url.raw`
 * string; we only consume the structured array (matching prior behavior).
 * @param request - The raw v2.1 request (may be undefined).
 * @returns Array of flattened query parameters.
 */
export function extractQuery(
  request: PostmanV21Request | undefined,
): FlattenedQueryParam[] {
  const query: FlattenedQueryParam[] = [];
  const url: PostmanV21Url | undefined = request?.url;
  if (!url || typeof url === "string") return query;
  if (!url.query) return query;
  for (const param of url.query) {
    const key = String(param.key ?? "");
    const value = String(param.value ?? "");
    query.push({ key, value, disabled: param.disabled === true });
  }
  return query;
}

/**
 * Extracts the auth block from a Postman request.
 * @param request - The raw v2.1 request (may be undefined).
 * @returns A FlattenedAuth or undefined when no auth is present.
 */
export function extractAuth(
  request: PostmanV21Request | undefined,
): FlattenedAuth | undefined {
  const auth = request?.auth;
  if (!auth) return undefined;
  const authType = auth.type;
  /* istanbul ignore next — schema requires type when auth is present;
     defensive guard for malformed inputs. */
  if (!authType) return undefined;
  return { type: authType };
}

/**
 * Extracts the pre-request script text from an item's events.
 * @param item - The raw v2.1 item to check for scripts.
 * @returns Joined script lines, or "" when absent.
 */
export function extractPreRequestScript(item: PostmanV21Item): string {
  if (!item.event) return "";
  const scriptLines: string[] = [];
  for (const event of item.event) {
    if (event.listen === "prerequest" && event.script) {
      collectExecLines(event.script.exec, scriptLines);
    }
  }
  return scriptLines.join("\n");
}

/**
 * Appends script lines from a Postman event's `exec` field (which is
 * either a string or string[]). Filters non-string elements defensively.
 * Extracted from {@link extractPreRequestScript} to keep cyclomatic
 * and depth complexity within the configured limits.
 * @param exec - The exec field from event.script (string | string[] | undefined).
 * @param accumulator - Mutable list to push lines into.
 */
function collectExecLines(
  exec: string | readonly string[] | undefined,
  accumulator: string[],
): void {
  if (typeof exec === "string") {
    accumulator.push(exec);
    return;
  }
  if (!Array.isArray(exec)) return;
  for (const line of exec) {
    if (typeof line === "string") accumulator.push(line);
  }
}

/**
 * Extracts saved/example responses from an item.
 * @param item - The raw v2.1 item to extract responses from.
 * @returns Array of flattened responses.
 */
export function extractResponses(item: PostmanV21Item): FlattenedResponse[] {
  const responses: FlattenedResponse[] = [];
  if (!item.response) return responses;
  for (const resp of item.response) {
    const code = typeof resp.code === "number" ? resp.code : 0;
    const body = typeof resp.body === "string" ? resp.body : "";
    responses.push({ code, body });
  }
  return responses;
}
