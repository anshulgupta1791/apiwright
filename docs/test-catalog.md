# Test catalog

The **catalog** is the fixed set of test-case types APIWright knows how to
auto-generate from one declaration. This page lists every generator,
what it does, what triggers it, what marker it lives under, and what a
pass/fail looks like.

If you're new, read [concepts.md](./concepts.md) first — the catalog
sits in the middle of the declaration → catalog → plan → run pipeline.

---

## At a glance — every generator

The §3 catalog has 16 case types, grouped by family:

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
