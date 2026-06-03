/**
 * Headers excluded from HEAD/GET parity comparison.
 *
 * Each is volatile or implementation-defined to a degree that makes
 * byte-equality between two responses (one HEAD + one GET) unreliable even on
 * RFC-compliant servers:
 *
 *  - "date"              — server clock, advances between two requests.
 *  - "set-cookie"        — session/CSRF tokens, often nonced per request.
 *  - "content-length"    — HEAD MUST omit body; if server sends the GET
 *                          Content-Length on HEAD per RFC 7231 §4.3.2 it MAY also
 *                          legitimately omit it. Comparing here creates false fails.
 *  - "transfer-encoding" — chunked encoding decision is per-response.
 *  - "connection"        — hop-by-hop, varies with proxy chains.
 *  - "keep-alive"        — hop-by-hop, varies.
 *  - "x-request-id"      — common observability header carrying a per-request UUID.
 *  - "x-trace-id"        — common observability header carrying a per-request UUID.
 *  - "etag"              — implementations sometimes change strong/weak prefix
 *                          between HEAD and GET (e.g. weak on HEAD, strong on GET).
 *                          Strictly RFC-compliant servers DO emit identical ETags,
 *                          but the false-positive rate on common middleware
 *                          (Cloudflare, Fastly) is high enough to ignore.
 *
 * Lowercase keys; consumer (parity comparator) lowercases response headers
 * once at comparison time for case-insensitive membership.
 *
 * INTENTIONAL omissions from the ignore-set: content-type, vary, cache-control,
 * expires, last-modified, content-language, content-encoding. These MUST
 * match per RFC 7231 §4.3.2.
 */
export const IGNORED_PARITY_HEADERS: ReadonlySet<string> = new Set([
  "date",
  "set-cookie",
  "content-length",
  "transfer-encoding",
  "connection",
  "keep-alive",
  "x-request-id",
  "x-trace-id",
  "etag",
]);
