/**
 * Postman Collection v2.1 schema — TypeScript types matching the
 * documented JSON shape at:
 *   https://schema.getpostman.com/json/collection/v2.1.0/collection.json
 *
 * In-house replacement for the `postman-collection` npm SDK. The SDK was
 * dropped to eliminate its vulnerable transitive deps on lodash<=4.17.23
 * and uuid<11.1.1, neither of which the SDK's runtime behavior actually
 * needed for our usage (Lens 0 audit blocker B13). Our usage was a thin
 * typed wrapper over the JSON: walk items, read request/header/body
 * fields, expose folder variables. The flattener already kept the raw
 * parsed JSON for the variable-walk because the SDK v5 didn't expose
 * folder variables anyway — so swapping in our own JSON-only walk is a
 * straightforward refactor, not a behavioral change.
 *
 * Coverage policy: pure type declarations file; no runtime logic.
 * Excluded from coverage by the standard `**\/types.ts` rule.
 */

// ============================================================================
// URL — either a raw string or a structured object
// ============================================================================

/**
 * Postman v2.1 URL can be either a bare string or a structured object.
 * The flattener normalizes both shapes to a single raw string.
 */
export type PostmanV21Url =
  | string
  | {
      readonly raw?: string;
      readonly protocol?: string;
      readonly host?: string | readonly string[];
      readonly path?: string | readonly (string | { readonly value?: string })[];
      readonly query?: ReadonlyArray<{
        readonly key?: string;
        readonly value?: string;
        readonly disabled?: boolean;
      }>;
      readonly variable?: ReadonlyArray<{
        readonly key?: string;
        readonly value?: string;
      }>;
    };

// ============================================================================
// Headers
// ============================================================================

/** Postman v2.1 header line. */
export interface PostmanV21Header {
  readonly key: string;
  readonly value: string;
  readonly type?: string;
  readonly disabled?: boolean;
  readonly description?: string;
}

// ============================================================================
// Request body — discriminated by `mode`
// ============================================================================

/** Postman v2.1 request body discriminated union by `mode`. */
export type PostmanV21Body =
  | {
      readonly mode: "raw";
      readonly raw?: string;
      readonly options?: Readonly<Record<string, unknown>>;
    }
  | {
      readonly mode: "formdata";
      readonly formdata?: ReadonlyArray<Readonly<Record<string, unknown>>>;
    }
  | {
      readonly mode: "urlencoded";
      readonly urlencoded?: ReadonlyArray<Readonly<Record<string, unknown>>>;
    }
  | {
      readonly mode: "file";
      readonly file?: Readonly<Record<string, unknown>>;
    }
  | {
      readonly mode: "graphql";
      readonly graphql?: Readonly<Record<string, unknown>>;
    }
  | { readonly mode?: undefined };

// ============================================================================
// Auth — header-only mode + token-endpoint config patterns we care about
// ============================================================================

/** One named param under an auth block (e.g. token / username / key). */
export interface PostmanV21AuthParam {
  readonly key: string;
  readonly value?: string;
  readonly type?: string;
}

/** Postman v2.1 auth block — `type` selects which sub-array is meaningful. */
export interface PostmanV21Auth {
  readonly type: string;
  readonly bearer?: ReadonlyArray<PostmanV21AuthParam>;
  readonly basic?: ReadonlyArray<PostmanV21AuthParam>;
  readonly apikey?: ReadonlyArray<PostmanV21AuthParam>;
  readonly digest?: ReadonlyArray<PostmanV21AuthParam>;
  readonly oauth1?: ReadonlyArray<PostmanV21AuthParam>;
  readonly oauth2?: ReadonlyArray<PostmanV21AuthParam>;
  readonly ntlm?: ReadonlyArray<PostmanV21AuthParam>;
  readonly awsv4?: ReadonlyArray<PostmanV21AuthParam>;
  readonly hawk?: ReadonlyArray<PostmanV21AuthParam>;
  readonly noauth?: ReadonlyArray<PostmanV21AuthParam>;
}

// ============================================================================
// Request
// ============================================================================

/** Postman v2.1 request object inside an item. */
export interface PostmanV21Request {
  readonly method?: string;
  readonly url?: PostmanV21Url;
  readonly header?: ReadonlyArray<PostmanV21Header>;
  readonly body?: PostmanV21Body;
  readonly auth?: PostmanV21Auth;
  readonly disabled?: boolean;
  readonly description?: string;
}

// ============================================================================
// Event (pre-request + test scripts)
// ============================================================================

/** Postman v2.1 event (script attached at item, folder, or collection level). */
export interface PostmanV21Event {
  readonly listen: string; // "prerequest" | "test"
  readonly script?: {
    readonly type?: string;
    readonly exec?: string | readonly string[];
    readonly id?: string;
  };
  readonly disabled?: boolean;
}

// ============================================================================
// Saved/example responses
// ============================================================================

/** Postman v2.1 saved/example response attached to an item. */
export interface PostmanV21Response {
  readonly name?: string;
  readonly status?: string;
  readonly code?: number;
  readonly body?: string;
  readonly header?: ReadonlyArray<PostmanV21Header>;
  readonly _postman_previewlanguage?: string;
}

// ============================================================================
// Variable
// ============================================================================

/** Postman v2.1 variable. */
export interface PostmanV21Variable {
  readonly key?: string;
  readonly value?: unknown;
  readonly type?: string;
  readonly disabled?: boolean;
}

// ============================================================================
// Item + ItemGroup (folder)
// ============================================================================

/**
 * Postman v2.1 item — either a REQUEST item (has `request`) or a FOLDER
 * (has `item`). The same object key (`item`) is used for the items array
 * at the collection root + for folder children, so a folder is structurally
 * `{name, item: [...]}`.
 */
export interface PostmanV21Item {
  readonly id?: string;
  readonly name?: string;
  readonly description?: string;
  readonly disabled?: boolean;
  /** Folder children — presence of this array makes the item a folder. */
  readonly item?: ReadonlyArray<PostmanV21Item>;
  readonly request?: PostmanV21Request;
  readonly response?: ReadonlyArray<PostmanV21Response>;
  readonly event?: ReadonlyArray<PostmanV21Event>;
  readonly auth?: PostmanV21Auth;
  readonly variable?: ReadonlyArray<PostmanV21Variable>;
}

/**
 * True iff the item is a folder (has child `item` array).
 * @param item - The Postman v2.1 item to classify.
 * @returns True when the item carries an `item` array (folder semantics).
 */
export function isFolder(item: PostmanV21Item): boolean {
  return Array.isArray(item.item);
}

// ============================================================================
// Collection root
// ============================================================================

/** Postman v2.1 `info` block — schema URL identifies the version. */
export interface PostmanV21Info {
  readonly _postman_id?: string;
  readonly name?: string;
  readonly schema?: string;
  readonly description?: string;
}

/** Postman v2.1 collection root. */
export interface PostmanV21Collection {
  readonly info: PostmanV21Info;
  readonly item: ReadonlyArray<PostmanV21Item>;
  readonly event?: ReadonlyArray<PostmanV21Event>;
  readonly auth?: PostmanV21Auth;
  readonly variable?: ReadonlyArray<PostmanV21Variable>;
}

// ============================================================================
// URL normalization — the one function with real logic in this module
// ============================================================================

/** Structured-url object excluding the bare-string variant. */
type StructuredUrl = Exclude<PostmanV21Url, string>;

/**
 * Joins host segments — Postman stores host as either `"x.y.com"` or
 * `["x", "y", "com"]`. Returns `""` for absent or wrong-type values.
 * @param host - The url.host field from the parsed JSON.
 * @returns The dot-joined host string.
 */
function joinHost(host: StructuredUrl["host"]): string {
  if (Array.isArray(host)) return host.join(".");
  if (typeof host === "string") return host;
  return "";
}

/**
 * Joins path segments — Postman stores path as either `"a/b/c"`,
 * `["a", "b", "c"]`, or `[{value:"a"}, {value:"b"}]`. Returns `""`
 * for absent or wrong-type values.
 * @param path - The url.path field from the parsed JSON.
 * @returns The slash-joined path string.
 */
function joinPath(path: StructuredUrl["path"]): string {
  if (typeof path === "string") return path;
  if (!Array.isArray(path)) return "";
  // `Array.isArray` widens the element type to `any` for `ReadonlyArray<T>`
  // — re-narrow via an explicit cast back to the declared shape.
  type PathSeg = string | { readonly value?: string };
  const segs = path as ReadonlyArray<PathSeg>;
  return segs
    .map((seg) => (typeof seg === "string" ? seg : (seg.value ?? "")))
    .join("/");
}

/**
 * Joins query parameters — Postman stores query as an array of
 * `{key, value, disabled?}`. Disabled params are omitted. Returns ""
 * for absent or empty arrays.
 * @param query - The url.query field from the parsed JSON.
 * @returns The `&`-joined `key=value` string.
 */
function joinQuery(query: StructuredUrl["query"]): string {
  if (!Array.isArray(query)) return "";
  // `Array.isArray` widens to `any[]` — re-narrow to the declared shape.
  type QueryItem = {
    readonly key?: string;
    readonly value?: string;
    readonly disabled?: boolean;
  };
  const items = query as ReadonlyArray<QueryItem>;
  return items
    .filter((q) => q.disabled !== true)
    .map((q) => `${q.key ?? ""}=${q.value ?? ""}`)
    .join("&");
}

/**
 * Normalizes a {@link PostmanV21Url} to a raw string. Matches the
 * `postman-collection` SDK's `.url.toString()` behavior we used to rely on.
 *
 * Algorithm:
 *   - bare string                  → return as-is
 *   - object with `raw`            → return `raw`
 *   - object with `host` + `path`  → reassemble protocol://host/path?query
 *   - otherwise                    → empty string
 * @param url - The url field as it appears in the parsed JSON.
 * @returns The raw URL string (Postman {{var}} tokens preserved).
 */
export function urlToString(url: PostmanV21Url | undefined): string {
  if (url === undefined) return "";
  if (typeof url === "string") return url;
  if (typeof url.raw === "string") return url.raw;

  // Best-effort reassembly when `raw` is absent (rare; older exports).
  const protocol = typeof url.protocol === "string" ? url.protocol : "";
  const host = joinHost(url.host);
  const path = joinPath(url.path);
  const query = joinQuery(url.query);

  let result = "";
  if (protocol) result += `${protocol}://`;
  if (host) result += host;
  if (path) result += path.startsWith("/") ? path : `/${path}`;
  if (query) result += `?${query}`;
  return result;
}
