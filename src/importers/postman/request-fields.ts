/**
 * Pure field-extraction helpers for the Postman flattener.
 *
 * Each function pulls one field group (headers, body, query, auth,
 * pre-request script, saved responses) out of a hydrated postman-collection
 * SDK Item/Request and returns the corresponding Flattened* shape. No I/O,
 * no shared state — split out of flattener.ts to keep each file focused and
 * under the 300-line soft limit.
 */

import type { Item } from "postman-collection";

import type {
  FlattenedAuth,
  FlattenedBody,
  FlattenedHeader,
  FlattenedQueryParam,
  FlattenedResponse,
} from "../types.js";

/**
 * Extracts headers from a Postman request.
 * @param request - The SDK request object (may be undefined).
 * @returns Array of flattened headers.
 */
export function extractHeaders(request: Item["request"]): FlattenedHeader[] {
  const headers: FlattenedHeader[] = [];
  /* istanbul ignore next — Postman SDK always provides headers list on requests */
  if (!request?.headers) return headers;
  request.headers.each(
    (header: { key: string; value: string; disabled?: boolean }) => {
      const key = String(header.key);
      const value = String(header.value);
      headers.push({ key, value, disabled: !!header.disabled });
    },
  );
  return headers;
}

/**
 * Extracts the request body from a Postman request.
 * @param request - The SDK request object (may be undefined).
 * @returns A FlattenedBody or undefined when no body is present.
 */
export function extractBody(
  request: Item["request"],
): FlattenedBody | undefined {
  if (!request?.body) return undefined;
  const bodyMode = request.body.mode as string | undefined;
  /* istanbul ignore next — Postman SDK always sets mode when body exists */
  const mode = bodyMode !== undefined ? bodyMode : "raw";
  /* istanbul ignore next — Postman SDK always sets raw when body has raw mode */
  const raw = request.body.raw !== undefined ? String(request.body.raw) : "";
  return { mode, raw };
}

/**
 * Extracts query parameters from a Postman request URL.
 * @param request - The SDK request object (may be undefined).
 * @returns Array of flattened query parameters.
 */
export function extractQuery(
  request: Item["request"],
): FlattenedQueryParam[] {
  const query: FlattenedQueryParam[] = [];
  /* istanbul ignore next — Postman SDK provides url.query on requests that have params */
  if (!request?.url?.query) return query;
  request.url.query.each(
    (param: {
      key: string | null;
      value: string | null;
      disabled?: boolean;
    }) => {
      const key = String(param.key ?? "");
      const value = String(param.value ?? "");
      query.push({ key, value, disabled: !!param.disabled });
    },
  );
  return query;
}

/**
 * Extracts the auth block from a Postman request.
 * @param request - The SDK request object (may be undefined).
 * @returns A FlattenedAuth or undefined when no auth is present.
 */
export function extractAuth(
  request: Item["request"],
): FlattenedAuth | undefined {
  if (!request?.auth) return undefined;
  const authType = request.auth.type as string;
  /* istanbul ignore next — defensive guard; SDK always sets type when auth exists */
  if (!authType) return undefined;
  return { type: authType };
}

/**
 * Extracts the pre-request script text from an item's events.
 * @param item - The SDK Item to check for scripts.
 * @returns Joined script lines, or "" when absent.
 */
export function extractPreRequestScript(item: Item): string {
  const scriptLines: string[] = [];
  /* istanbul ignore next — Postman SDK always provides events list on items */
  if (!item.events) return "";
  item.events.each(
    (event: {
      listen?: string | undefined;
      script?: { exec?: string[] | undefined };
    }) => {
      if (event.listen === "prerequest" && event.script) {
        /* istanbul ignore next — exec array is always present on Postman script objects */
        const lines = event.script.exec ?? [];
        scriptLines.push(...lines);
      }
    },
  );
  return scriptLines.join("\n");
}

/**
 * Extracts saved/example responses from an item.
 * @param item - The SDK Item to extract responses from.
 * @returns Array of flattened responses.
 */
export function extractResponses(item: Item): FlattenedResponse[] {
  const responses: FlattenedResponse[] = [];
  /* istanbul ignore next — Postman SDK always provides responses list on items */
  if (!item.responses) return responses;
  item.responses.each(
    (resp: { code?: number; body?: string | undefined }) => {
      const code = resp.code !== undefined ? resp.code : 0;
      const body = resp.body !== undefined ? resp.body : "";
      responses.push({ code, body });
    },
  );
  return responses;
}
