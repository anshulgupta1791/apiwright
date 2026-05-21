/**
 * Injectable HTTP client seam for the §9 runner.
 *
 * Default implementation wraps Node 22's global `fetch`. Pattern mirrors
 * Task #9's `HttpFetchSeam` (the auth `token_endpoint` HTTP boundary):
 * one method, returns `{ status, headers, body, time_ms }`, never throws —
 * network failures resolve to a structured RunnerError-wrapped rejection.
 */

import { parseJson } from "../../core/safe-json.js";
import { RUNNER_ERROR_CODES, RunnerError } from "../errors.js";
import type { RequestRecord, ResponseRecord } from "../types.js";

/** Test seam — tests inject a fake implementation instead of real fetch. */
export interface HttpClientSeam {
  /**
   * Sends one authorized request and returns the captured response trace.
   * @param request - The fully-authorized request record.
   * @returns The captured {@link ResponseRecord} with timing.
   * @throws {RunnerError} code `RUNNER_HTTP_FAILED` on network failure or
   *   when the response cannot be read.
   */
  send(request: RequestRecord): Promise<ResponseRecord>;
}

/**
 * Builds the default HTTP client backed by `globalThis.fetch`.
 *
 * Lazy-fetch contract: `globalThis.fetch` is dereferenced ONLY inside
 * `send` so importing this module never touches the global, and so a test
 * stubbing `globalThis.fetch` after import still works.
 * @returns The default {@link HttpClientSeam} that calls `globalThis.fetch`.
 */
export function createDefaultHttpClient(): HttpClientSeam {
  return {
    async send(request: RequestRecord): Promise<ResponseRecord> {
      const started = nowMs();
      let res: Response;
      try {
        const init: RequestInit = {
          method: request.method,
          headers: { ...request.headers },
        };
        const body = serializeBody(request.body);
        if (body !== undefined) init.body = body;
        res = await globalThis.fetch(request.url, init);
      } catch (cause: unknown) {
        throw new RunnerError({
          code: RUNNER_ERROR_CODES.RUNNER_HTTP_FAILED,
          phase: "execute",
          message: `HTTP request failed (network error).`,
          cause,
        });
      }
      const time_ms = nowMs() - started;
      const headers = headersToObject(res.headers);
      const body = await readBody(res);
      return { status: res.status, headers, body, time_ms };
    },
  };
}

/**
 * Serializes the outgoing request body. JSON-encodes objects; passes through
 * strings; omits for null / undefined.
 * @param body - The outgoing body (any JSON-serializable value, or string).
 * @returns A string / undefined suitable for `fetch.body`.
 */
function serializeBody(body: unknown): string | undefined {
  if (body === undefined || body === null) return undefined;
  if (typeof body === "string") return body;
  return JSON.stringify(body);
}

/**
 * Converts a `Headers` instance to a plain object, lowercasing keys for
 * deterministic comparison. Browser fetch behaviour around case is wonky;
 * normalizing on read lets downstream consumers do strict equality.
 * @param headers - The `Headers` instance from `fetch`.
 * @returns Plain object with lower-cased header keys.
 */
function headersToObject(headers: Headers): Readonly<Record<string, string>> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

/**
 * Reads the response body, preferring `response.json()` for valid JSON
 * payloads (the §4 evaluator wants structured access). Falls back to the
 * raw text when the body is non-JSON.
 * @param res - The fetch Response.
 * @returns The parsed JSON value, or the raw text as a string fallback.
 */
async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (text.length === 0) return null;
  const result = parseJson(text);
  return result.ok ? result.value : text;
}

/**
 * Wall-clock now in milliseconds. Inline so tests can stub `Date.now`
 * deterministically without going through this module.
 * @returns Epoch milliseconds.
 */
function nowMs(): number {
  return Date.now();
}
