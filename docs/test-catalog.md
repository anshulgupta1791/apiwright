# Test catalog

The **catalog** is the fixed set of test-case types APIWright knows how to
auto-generate from one declaration. This page lists every generator,
what it does, what triggers it, what marker it lives under, and what a
pass/fail looks like.

If you're new, read [concepts.md](./concepts.md) first — the catalog
sits in the middle of the declaration → catalog → plan → run pipeline.

---

## At a glance — every generator

The §3 catalog has 20 case types, grouped by family. An additional
`assertion` sentinel is emitted for each entry in the `assertions` array;
together these form the 21 entries in `ALL_SKIPPABLE_KINDS`.

| Family | Case type | Marker | Triggered when |
|---|---|---|---|
| HTTP correctness | `status_code_conformance` | smoke | always |
| HTTP correctness | `content_type_alignment` | smoke | always |
| HTTP correctness | `response_schema_validation` | smoke | `response.schema` declared |
| HTTP correctness | `response_time_sla` | smoke | always |
| Auth boundaries | `auth_happy_path` | smoke | `auth_strategy` declared |
| Auth boundaries | `no_auth_returns_401` | regression | `auth_strategy` declared |
| Auth boundaries | `garbage_token_returns_401` | regression | `auth_strategy` declared |
| HTTP semantics | `method_not_allowed` | regression | always |
| HTTP semantics | `malformed_json_returns_400` | regression | `request.body_example` present |
| Input validation | `required_field_omission_returns_400` | regression | one per `required` field in `body_schema` |
| Input validation | `type_violation_returns_400` | regression | one per typed field in `body_schema` |
| Input validation | `boundary_battery` | regression | per `minimum`/`maximum`/`minLength`/`maxLength`/`enum` constraint |
| Idempotency | `get_idempotency` | regression | method = `GET` |
| Idempotency | `delete_idempotency` | regression | method = `DELETE` |
| Idempotency | `put_idempotency` | regression | method = `PUT` |
| Method-specific | `head_get_parity` | smoke | method = `HEAD` AND `pair_with` declared |
| Caching | `conditional_get_304` | regression | method = `GET` AND `etag_supported: true` declared |
| Pagination | `pagination_boundary` | regression | method = `GET` AND `pagination` block declared |
| CORS | `cors_preflight` | smoke | method = `OPTIONS` AND `cors` block declared |
| DB state | `db_state_matches_expectation` | regression | `db_verify` declared AND method ∈ {POST, PUT, PATCH, DELETE} |
| Declarative | `assertion` | smoke | one per entry in `assertions` array |

A typical POST endpoint with a body schema, 5 required fields, 6 typed
fields, and 3 boundary constraints generates **~20-25 cases** from one
~40-line declaration.

---

## HTTP correctness family (smoke)

These run on every endpoint regardless of shape. Smoke-marked so they
gate on every PR.

### `status_code_conformance`

Sends the declared request and asserts the response status equals
`response.expected_status`.

```json
"response": { "expected_status": 200, ... }
```

**Fails when** the actual status is anything other than the declared
one. Most common cause: API returns 500 / 404 for something the
declaration expected to succeed.

**Enriched failure reasons via `response_variants`:** when the endpoint
declares `response_variants`, a status mismatch is annotated with
additional context. See the
[`response_variants` reference section](#response_variants----enriched-failure-reasons-for-status_eq_kinds)
below.

### `content_type_alignment`

Asserts the response's `Content-Type` header is consistent with what
the response body actually contains (JSON body → `application/json` or
compatible).

**Fails when** the endpoint returns a JSON body labelled `text/plain`,
or HTML/XML where JSON was expected. Catches reverse-proxy mis-config
and content-negotiation bugs.

### `response_schema_validation`

If `response.schema` is declared, validates the response body against
that JSON Schema. Skipped (with a plan warning) when no schema is
declared.

```json
"response": {
  "expected_status": 200,
  "schema": {
    "type": "object",
    "required": ["id", "email"],
    "properties": {
      "id":    { "type": "string", "pattern": "^[0-9a-f-]{36}$" },
      "email": { "type": "string", "format": "email" }
    }
  }
}
```

**Fails when** the response body violates the schema — missing required
fields, wrong types, pattern mismatch, additional properties beyond
the schema.

### `response_time_sla`

Asserts `response.time_ms ≤ sla_ms`. `sla_ms` comes from the endpoint
(`response.sla_ms`) or the environment (`default_sla_ms`).

```json
"response": { "expected_status": 200, "sla_ms": 500 }
```

**Fails when** the response takes longer than the SLA. Catches latency
regressions on hot paths.

---

## Auth boundary family (smoke + regression)

These fire only when the endpoint declares `auth_strategy: <name>`. If
omitted, none of the auth cases run.

### `auth_happy_path` (smoke)

Sends the request with the configured auth (e.g. valid Bearer token)
and asserts a successful response. This is the "auth works" case.

### `no_auth_returns_401` (regression)

Sends the same request WITHOUT the auth header and asserts the response
status is 401. The "you can't bypass auth" case.

**Fails when** the endpoint returns 200 / 403 / anything-but-401 without
auth — a real security gap.

### `garbage_token_returns_401` (regression)

Sends the request with a malformed / known-bad token and asserts 401.
The "you can't bypass auth with junk" case.

**Fails when** the endpoint accepts a malformed token, returns a 500
on parse failure, or returns 403 (which is "auth recognised but
forbidden" — different category).

---

## HTTP semantics family (regression)

REST contract conformance.

### `method_not_allowed`

Sends a method other than the declared one (e.g. PUT to a POST-only
endpoint) and asserts the response status is 405.

**Real-world caveat:** many APIs return 404 instead of 405 for
unsupported methods. APIWright currently asserts strict 405; see
[troubleshooting.md](./troubleshooting.md) for how to relax this.

### `malformed_json_returns_400`

Fires when `request.body_example` is present. Sends `{"unterminated:`
as the body and asserts 400. The "you handle malformed input
gracefully" case.

**Fails when** the endpoint returns 500 on malformed JSON (caller
can't distinguish "your fault" from "their fault") or accepts the
garbage and returns 200.

---

## Input validation family (regression)

One case per constrained field — the part of the catalog where the
"16 cases" number explodes for endpoints with rich body schemas.

### `required_field_omission_returns_400`

For each field listed in `body_schema.required`, sends a body where
exactly that field is missing (all other required fields present) and
asserts 400.

5 required fields → 5 generated cases, each omitting one field. This
catches the common bug where the API silently defaults a missing field
instead of rejecting the request.

### `type_violation_returns_400`

For each typed field in `body_schema.properties`, sends a body where
that field has the wrong type and asserts 400.

- string field → sent as `-1` (number)
- integer field → sent as `"wrong-type-substitute"` (string)
- boolean field → sent as `"wrong-type-substitute"` (string)

6 typed fields → 6 generated cases, each violating one field's type.

### `boundary_battery`

For each constraint, sends inside-the-boundary, outside-the-boundary,
and (where meaningful) at-the-boundary values:

- `minimum: 10` → cases at `10` (inside) and `9` (outside, should reject)
- `maximum: 100` → `100` (inside), `101` (outside)
- `minLength: 3` → `"aaa"` (inside), `"aa"` (outside)
- `maxLength: 8` → `"aaaaaaaa"` (inside), `"aaaaaaaaa"` (outside)
- `enum: ["alpha", "beta"]` → `"alpha"` (inside), `"__apiwright_not_in_enum__"` (outside sentinel)

The outside-the-boundary cases assert the endpoint rejects with 400;
inside cases assert it accepts.

---

## Idempotency family (regression)

### `get_idempotency`

Fires when `method` is `GET`. Calls the endpoint twice and asserts
both responses are identical (status + body). The REST GET idempotency
contract.

**Fails when** the response varies between calls — common for endpoints
that return server time, request IDs, or that have non-idempotent
side effects on read (a real bug if the spec says GET).

### `delete_idempotency`

Fires when `method` is `DELETE`. Calls DELETE twice; the second call
should return the same shape (typically 404 for "already gone" or 204
for "still gone"). Idempotency means "applying the operation twice has
the same effect as once."

### `put_idempotency`

Fires when `method` is `PUT` (RFC 7231 §4.3.4). Sends two identical
PUT requests and asserts the resource state is unchanged after both.

The compare mode is chosen automatically at plan time:

- **`body_equality`** (default) — the second PUT's response body must
  deep-equal the first PUT's response body (canonical JSON; key order
  does not matter). Used when no `db_verify` is declared.
- **`db_state`** (auto-selected) — the `db_verify` block is re-run
  after the second PUT and every declared step must pass. Used when
  `db_verify` has at least one entry. Preferred for PUT endpoints that
  return 204 or that include server-generated fields like timestamps.

Users do NOT set the compare mode manually; the generator picks it.

**Plan-time warnings** you may see:

```
Endpoint '<id>': put_idempotency — response is 204 No Content;
body_equality compare will be trivially satisfied.
Add db_verify[] to assert resource state.

Endpoint '<id>': put_idempotency — no request.body_example declared;
the runner will PUT an empty body which may not exercise true idempotency.
```

**Known limitation — timestamp-bearing response bodies:** if the PUT
response includes a server-generated field (e.g. `lastModified`,
`updatedAt`), `body_equality` will fail even though the resource IS
idempotent. Fix: add `db_verify` (auto-selects `db_state` mode) OR
opt out with `skip_cases: ["put_idempotency"]` and add a hand-rolled
assertion instead.

**Known limitation — read-after-write timing with `db_state`:** in
`db_state` mode the runner reads the DB immediately after the second
PUT. If the system under test defers write commits (async flushes,
eventual consistency), the read may not yet reflect the second PUT's
effect. Ensure the SUT has flushed before `db_verify` executes, or
accept the timing risk. This caveat was identified during the security
audit for v1.0.2.

Opt out: `skip_cases: ["put_idempotency"]` at the endpoint, or
`case_generation.skip_globally: ["put_idempotency"]` in config.

See the full worked example in
[docs/cookbook/put-idempotency.md](./cookbook/put-idempotency.md).

### `head_get_parity`

Fires when `method` is `HEAD` AND the endpoint declares `pair_with:
"<get-endpoint-id>"` (RFC 7231 §4.3.2). Sends both HEAD and GET to the
same URL and asserts:

1. Status codes are identical.
2. The HEAD response body is empty (`null`, `undefined`, or `""`).
3. Response headers are identical except for the ignored set (see below).

Marker = `smoke`. This is an opt-in generator: HEAD endpoints that do not
declare `pair_with` receive no case.

**Declaring it:**

```json
{
  "id": "users.head",
  "method": "HEAD",
  "url": "${env.api_base}/users/123",
  "pair_with": "users.get"
}
```

The paired GET endpoint (here `users.get`) must:
- Exist by that `id`.
- Have method `GET`.
- Have an identical `url` value (template string included — not resolved).

If any check fails at plan time, the case is dropped with a warning and
the rest of the plan is unaffected.

**Plan-time resolution warnings:**

```
Endpoint 'users.head': pair_with target 'users.get' not found;
head_get_parity case dropped.

Endpoint 'users.head': pair_with target 'users.get' has method POST,
expected GET; head_get_parity case dropped.

Endpoint 'users.head': pair_with target 'users.get' URL
'${env.api_base}/users/456' does not match HEAD URL
'${env.api_base}/users/123'; head_get_parity case dropped.
```

**Ignored headers (`IGNORED_PARITY_HEADERS`):**

The following headers are excluded from the header-equality check because
servers commonly return different values for them on HEAD vs GET responses,
or because they are hop-by-hop headers that carry connection-level metadata
rather than resource metadata:

| Header | Reason ignored |
|---|---|
| `content-length` | May differ by design (HEAD response has no body). |
| `transfer-encoding` | Hop-by-hop; may be absent on HEAD. |
| `date` | Timestamp; nearly always differs between two requests. |
| `set-cookie` | Session management; legitimately may differ. |
| `etag` | Some middleware violates RFC consistency on this header. Pragmatically ignored to reduce noise. See note below. |
| `connection` | Hop-by-hop. |
| `keep-alive` | Hop-by-hop. |
| `x-request-id` | Per-request identifier; always differs. |
| `x-trace-id` | Per-request identifier; always differs. |

All other headers — including `vary`, `content-type`, and `cache-control`
— are compared and MUST match. If your HEAD endpoint returns a different
`vary` or `content-type` than its paired GET, that is a real RFC violation
and the case will fail.

**Note on `etag`:** RFC 7232 requires that an ETag returned on a HEAD
response be identical to the ETag that would be returned on the
corresponding GET. However, certain middleware and reverse-proxy layers
violate this in practice. APIWright ignores `etag` in the parity check to
avoid widespread false failures; if you want strict `etag` checking, opt
out of `head_get_parity` and write a hand-rolled assertion instead.

**Known limitation — auth strategy:** apiwright applies the HEAD
endpoint's `auth_strategy` to BOTH the HEAD and the paired GET request.
If the GET endpoint declares a different `auth_strategy`, that difference
is NOT honoured by the parity test. Users with divergent auth between
HEAD and GET should opt out:

```json
{
  "id": "users.head",
  "method": "HEAD",
  "url": "${env.api_base}/users/123",
  "pair_with": "users.get",
  "skip_cases": ["head_get_parity"]
}
```

Opt out: `skip_cases: ["head_get_parity"]` at the endpoint, or
`case_generation.skip_globally: ["head_get_parity"]` in config.

See the full worked example in
[docs/cookbook/head-get-parity.md](./cookbook/head-get-parity.md).

---

## Caching family (regression)

### `conditional_get_304`

Fires when `method` is `GET` AND the endpoint declares
`etag_supported: true` (RFC 7232 compliance). This is an opt-in generator:
GET endpoints without `etag_supported: true` receive no case.

The generator issues two GET requests in sequence:

1. The first GET is sent normally. The runner captures the `ETag` response
   header from this response.
2. The second GET is sent with `If-None-Match: <etag-from-first>` added to
   the request headers. The runner asserts:
   - The response status is `304 Not Modified`.
   - The `ETag` header is present on the 304 response.
   - The 304 `ETag` matches the ETag from the first response exactly.
   - The 304 response body is empty.

Marker = `regression`.

**Declaring it:**

```json
{
  "id": "users.get",
  "method": "GET",
  "url": "${env.api_base}/users/123",
  "etag_supported": true,
  "response": {
    "expected_status": 200
  }
}
```

**Failure reasons — exact messages:**

| Failure message | Meaning |
|---|---|
| `conditional_get_304: first response missing ETag header (etag_supported: true)` | The first GET returned no `ETag` header. The server is not sending ETags even though `etag_supported: true` is declared. |
| `conditional_get_304: expected 304 Not Modified on second request, got <N>` | The second GET (with `If-None-Match`) did not return 304. The server either ignores `If-None-Match` or always returns the full response. |
| `conditional_get_304: 304 response missing ETag header` | The 304 response did not echo the ETag back. RFC 7232 §4.1 requires the ETag on the 304. |
| `conditional_get_304: 304 ETag '<got>' does not match first response ETag '<expected>'` | The server returned a different ETag on the 304 than on the first GET. The resource may have changed between the two requests, or the server has an ETag-generation bug. |
| `conditional_get_304: 304 response body is not empty` | The 304 response included a body. RFC 7230 §3.3 prohibits a message body on 304 responses. |

**Known limitation — weak ETags (`W/"..."`):** The generator accepts and
echoes weak ETags verbatim in the `If-None-Match` header. If the resource
changes between the first and second GET (for example, under concurrent
writes), the server may return a fresh 200 instead of 304, and the
`expected 304` failure will trigger. This is not a bug in APIWright — it
reflects real resource mutation. To suppress flakes caused by this pattern,
opt out of `conditional_get_304` for endpoints under active write load
during the test run. See [docs/limitations.md](./limitations.md) for the
full caveat.

Opt out: `skip_cases: ["conditional_get_304"]` at the endpoint, or
`case_generation.skip_globally: ["conditional_get_304"]` in config.

See the full worked example in
[docs/cookbook/etag-conditional-get.md](./cookbook/etag-conditional-get.md).

---

## Pagination family (regression)

### `pagination_boundary`

Fires when `method` is `GET` AND the endpoint declares a `pagination` block
(opt-in). The generator probes the declared pagination parameters at their
boundaries — zero-size, maximum-size, over-maximum-size, and (where
applicable) negative-page — and asserts the server rejects or accepts
accordingly.

Marker = `regression`.

**Declaring it:**

```json
{
  "id": "users.list",
  "method": "GET",
  "url": "${env.api_base}/users",
  "pagination": {
    "style": "page",
    "size_param": "size",
    "page_param": "page",
    "default_size": 20,
    "max_size": 100
  },
  "response": {
    "expected_status": 200
  }
}
```

**`pagination` block fields:**

| Field | Required | Description |
|---|---|---|
| `style` | Yes | One of `"page"`, `"offset"`, or `"cursor"`. |
| `size_param` | Yes | Query-parameter name that controls page size (e.g. `"size"`, `"limit"`). |
| `page_param` | Conditional | Query-parameter name for the page number. Required for `page` style; ignored for `offset` and `cursor`. |
| `default_size` | Yes | The API's default page size. Used to define the baseline. |
| `max_size` | Yes | The API's maximum accepted page size. Must be ≥ `default_size`. |

**Probes emitted per style:**

| Probe | `page` | `offset` | `cursor` | Assertion |
|---|---|---|---|---|
| `size_zero` | Yes | Yes | Yes | Sends `size_param=0`; expects 400. |
| `size_max` | Yes | Yes | Yes | Sends `size_param=<max_size>`; expects the declared `expected_status`. |
| `size_max_plus_one` | Yes | Yes | No | Sends `size_param=<max_size + 1>`; expects 400. |
| `page_negative` | Yes | No | No | Sends `page_param=-1`; expects 400. |

Cursor-style pagination expresses position as an opaque token, not a
numeric offset, so probing negative-page and over-maximum-size do not
apply.

**Plan-time warnings:**

```
Endpoint '<id>': pagination_boundary — style 'page' declared without page_param; page_negative probe omitted.
```

Emitted when `style` is `page` but `page_param` is absent. The three
remaining probes still generate; only `page_negative` is dropped. Fix: add
`"page_param": "<param-name>"` to the `pagination` block.

```
Endpoint '<id>': pagination_boundary — max_size (<N>) is less than default_size (<M>); all probes omitted.
```

Emitted when `max_size` is less than `default_size`. The declaration is
internally inconsistent — no probes can be generated safely. All
`pagination_boundary` probes for that endpoint are dropped. Fix: correct
the `max_size` value to be ≥ `default_size`.

Both warnings are emitted at `WARN` level and do not change the exit code.
The rest of the plan is unaffected.

**Skipping individual probes:**

Use `"pagination_boundary:<probe>"` to skip a single probe while keeping
the others. The probe name must match exactly:

```json
"skip_cases": ["pagination_boundary:size_zero"]
```

Use bare `"pagination_boundary"` to skip all probes for that endpoint:

```json
"skip_cases": ["pagination_boundary"]
```

Opt out globally with `case_generation.skip_globally: ["pagination_boundary"]`
in `apiwright.config.json`.

See the full worked example in
[docs/cookbook/pagination-boundary.md](./cookbook/pagination-boundary.md).

**Known limitations:**

Only three pagination styles are supported: `page`, `offset`, and `cursor`.
Cursor-style pagination does not probe `size_max_plus_one` or `page_negative`
because cursor tokens are opaque and do not have numeric overflow semantics.
See [docs/limitations.md](./limitations.md) for the full scope boundary.

---

## CORS family (smoke)

### `cors_preflight`

Fires when `method` is `OPTIONS` AND the endpoint declares a `cors` block
(opt-in). Sends an OPTIONS preflight request and asserts the server responds
with the correct CORS headers. Non-OPTIONS endpoints that declare a `cors`
block are silently ignored — the case is never emitted for them.

Marker = `smoke`.

**Declaring it:**

```json
{
  "id": "users.preflight",
  "method": "OPTIONS",
  "url": "${env.api_base}/users",
  "cors": {
    "allow_origins": ["https://app.example.com"],
    "allow_methods": ["GET", "POST"],
    "allow_headers": ["Content-Type", "Authorization"]
  }
}
```

The generator sends:

- `Origin: <first-allow-origin>` — the first value in `allow_origins`.
- `Access-Control-Request-Method: <first-allow-method>` — the first value in
  `allow_methods`.
- `Access-Control-Request-Headers: <allow_headers joined by comma>` — omitted
  when `allow_headers` is empty or absent.

The runner then asserts:

1. The response status is `200` or `204`.
2. `Access-Control-Allow-Origin` is present.
3. `Access-Control-Allow-Origin` matches the sent origin (see wildcard rules
   below).
4. `Access-Control-Allow-Methods` is present.
5. `Access-Control-Allow-Methods` contains every method in `allow_methods`
   (case-insensitive set superset — the server may return additional methods).
6. `Access-Control-Allow-Headers` is present (unless `allow_headers` is empty).
7. `Access-Control-Allow-Headers` contains every header in `allow_headers`
   (case-insensitive set superset).

**Wildcard origin semantics:**

When `allow_origins` is `["*"]`, the runner sends `Origin: *` and accepts
either `*` OR the echoed origin value in `Access-Control-Allow-Origin`.
This accommodates servers that reflect the request origin instead of returning
a literal `*`.

When `allow_origins` has more than one value (e.g.
`["https://app.example.com", "https://admin.example.com"]`), the server MUST
echo the sent origin exactly — a `*` response is not accepted because
credentialed cross-origin requests require an explicit origin echo, not a
wildcard.

**Methods and headers comparison:**

Both `Access-Control-Allow-Methods` and `Access-Control-Allow-Headers` are
compared as **case-insensitive set supersets**. The server is allowed to
return more methods or headers than were requested; the assertion passes as
long as every declared value is present. Comparison is case-folded (e.g.
`content-type` matches `Content-Type`).

**Failure reasons — exact messages:**

| Failure message | Meaning |
|---|---|
| `cors_preflight: expected status 200 or 204, got <N>` | Server did not return an accepted preflight status. |
| `cors_preflight: response missing Access-Control-Allow-Origin header` | Server returned no ACAO header. |
| `cors_preflight: Access-Control-Allow-Origin '<got>' doesn't match expected '<expected>'` | ACAO value did not match the sent origin (or `*` for wildcard origins). |
| `cors_preflight: response missing Access-Control-Allow-Methods header` | Server returned no ACAM header. |
| `cors_preflight: Access-Control-Allow-Methods missing required: <missing>` | ACAM did not cover all declared `allow_methods`. |
| `cors_preflight: response missing Access-Control-Allow-Headers header` | Server returned no ACAH header (only when `allow_headers` is non-empty). |
| `cors_preflight: Access-Control-Allow-Headers missing required: <missing>` | ACAH did not cover all declared `allow_headers`. |

**Plan-time warnings:**

```
Endpoint '<id>': cors_preflight — empty allow_origins; case dropped.
```

Emitted when `cors.allow_origins` is missing or an empty array. A preflight
with no origin is meaningless — the case is dropped. Fix: add at least one
origin to `allow_origins`.

```
Endpoint '<id>': cors_preflight — empty allow_methods; case dropped.
```

Emitted when `cors.allow_methods` is missing or an empty array. Fix: add at
least one method.

Both warnings are emitted at `WARN` level and do not change the exit code.

Opt out: `skip_cases: ["cors_preflight"]` at the endpoint, or
`case_generation.skip_globally: ["cors_preflight"]` in config.

See the full worked example in
[docs/cookbook/cors-preflight.md](./cookbook/cors-preflight.md).

---

## DB state family (regression)

### `db_state_matches_expectation`

Fires when:
- `db_verify` block is declared on the endpoint, AND
- method ∈ {POST, PUT, PATCH, DELETE} (write methods only).

After the request lands, runs each db_verify query against the
configured database and asserts the result matches the expected
`expect` mode (`exists` / `not_exists` / `match` / `exact`).

```json
"db_verify": [
  {
    "connection": "primary_postgres",
    "query": "SELECT email FROM users WHERE id = '${response.body.id}'",
    "expect": "match",
    "fields": { "email": "${request.body.email}" }
  }
]
```

**KNOWN LIMITATION:** the gating case is only generated for write
methods. For GET endpoints with `db_verify`, the query still executes
and records `pass: false` in the report, but the run does NOT fail.
See [db-verify.md](./db-verify.md) and [limitations.md](./limitations.md).

---

## Declarative family (smoke)

### `assertion`

One case per entry in the `assertions` array. Each entry is evaluated
post-response (and post-db_verify, if present) against the typed
target/operator/operand grammar.

```json
"assertions": [
  "response.body.id is_uuid_v4",
  "response.body.created_at is_recent_timestamp",
  "response.body.email equals request.body.email",
  "db.primary_postgres.user_check.count_equals 1"
]
```

5 assertions → 5 generated cases. Each runs independently and produces
its own pass/fail line in the report. See [assertions.md](./assertions.md)
for the full operator vocabulary and grammar.

---

## `response_variants` — enriched failure reasons for STATUS_EQ_KINDS

`response_variants` is an optional field on `*.endpoint.json`. It does
NOT add a new generator or a new skip token. Its only effect is to
improve the `failure_reason` text in reports when a STATUS_EQ_KINDS
case receives a status that differs from `expected_status`.

**Declaration:**

```json
{
  "id": "users.create",
  "method": "POST",
  "url": "${env.api_base}/users",
  "response": { "expected_status": 201, "schema": { ... } },
  "response_variants": {
    "400": { "schema": { "type": "object", "required": ["error", "message"] } },
    "500": { "schema": { "type": "object", "required": ["error"] } }
  }
}
```

**Variant keys** must be exact three-digit decimal strings matching
`^[1-5]\d{2}$`. Wildcard keys (e.g. `"4xx"`) are rejected at load
time.

**Lookup rules:**

- Variant lookup is **suppressed** when `actual === expected`. The happy
  path uses `response.schema`, not `response_variants`.
- Lookup applies only to the nine **STATUS_EQ_KINDS**:
  `status_code_conformance`, `no_auth_returns_401`,
  `garbage_token_returns_401`, `method_not_allowed`,
  `malformed_json_returns_400`, `required_field_omission_returns_400`,
  `type_violation_returns_400`, `boundary_battery`, `pagination_boundary`.
- Multi-property verdict kinds (`put_idempotency`, `head_get_parity`,
  `conditional_get_304`, `cors_preflight`) are unaffected.

**Failure reason matrix:**

| Condition | `failure_reason` |
|---|---|
| No variant declared for actual status | `expected status <E>, got <A>` |
| Variant declared, body matches schema | `expected status <E>, got <A> (response body matched declared variant schema for <A>)` |
| Variant declared, body fails schema | `expected status <E>, got <A> (response body did not match declared variant schema for <A>: <ajv-error-detail>)` |
| Variant declared, no schema field | `expected status <E>, got <A> (status <A> is a documented variant)` |

**Plan-time warnings:**

```
Endpoint '<id>': response_variants['<X>'] is the happy-path status;
this variant is never consulted by the runner. Remove or change the key.
```

Emitted when a variant key equals `response.expected_status`. That
key can never be reached because variant lookup is suppressed on the
happy path.

```
Endpoint '<id>': response_variants is empty;
remove the key or add at least one variant.
```

Emitted when `response_variants` is present but has no keys.

Both warnings are emitted at `WARN` level and do not change the exit
code.

See the worked example in
[docs/cookbook/response-variants.md](./cookbook/response-variants.md).

---

## How many cases does an endpoint generate?

Depends entirely on declared features:

| Endpoint shape | Generated cases (smoke + regression) |
|---|---|
| GET, no auth, no body | ~5 (4 universal + 1 idempotency) |
| GET, with auth, no body | ~8 (above + 3 auth) |
| POST, no auth, body schema with 3 required + 4 typed | ~17 (4 universal + 3 required + 4 type + 1 malformed + 1 method) |
| POST, with auth, body schema with 5 required + 6 typed + 3 boundaries | ~25 (above + 3 auth + 8 boundary) |
| Same + 3 assertions + db_verify | ~29 (above + 3 assertions + 1 db_state) |

This is the leverage: **one declaration, dozens of cases**.

---

## Filtering what runs

Two layers of filter pick a subset of the catalog per invocation:

- **Markers** — `--markers smoke` runs only the smoke cases (~30 % of
  the catalog by case count, the fast happy-path layer). `--markers
  regression` runs only the regression cases (~70 %, the slow thorough
  layer). `--markers all` runs everything.
- **CLI filters** — `--tag write`, `--exclude-tag flaky`,
  `--endpoint users.create`, `--path tests/users/` further narrow which
  ENDPOINTS feed the catalog. See [cli.md](./cli.md).

Recommended pipeline pattern: smoke on every PR (fast), regression
nightly (thorough). See [markers-and-lifecycle.md](./markers-and-lifecycle.md).

---

## What APIWright does NOT auto-generate

The catalog covers HTTP-correctness commodity coverage. It does not
generate:

- Multi-step business flows (v1.5).
- App-specific invariants the API doesn't express in JSON Schema
  (declare those as `assertions`).
- Race conditions / concurrency / eventual-consistency probes.
- Performance / load (use k6 / Gatling).

See [limitations.md](./limitations.md) for the full scope boundary.
