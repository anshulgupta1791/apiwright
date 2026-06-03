# Skip cases — opting out of specific generated test types

## What it does

`skip_cases` lets you opt out of specific auto-generated test cases without
losing the rest of the coverage that endpoint would otherwise produce.
You can suppress at the endpoint level (in the `.endpoint.json` file) or
globally across the whole run (in `apiwright.config.json`). Suppressed
cases are removed from the plan before execution and noted in the run report
as skipped-by-configuration, so they remain visible and intentional rather
than silently absent.

---

## When to use it

- You don't want APIWright to send a second `DELETE` to a real record.
  Add `skip_cases: ["delete_idempotency"]` to that endpoint.

- One body field is an internal identifier that shouldn't receive a
  type-violation probe. Add
  `skip_cases: ["type_violation_returns_400:internal_id"]` to that endpoint.

- Your API never enforces idempotency on DELETE, and you don't want
  `delete_idempotency` failures across every DELETE endpoint. Add
  `"delete_idempotency"` to `case_generation.skip_globally` in your
  `apiwright.config.json` rather than adding the same token to every
  endpoint file.

- A `required` field carries an intentional quirk (e.g. the API accepts a
  missing field and defaults it server-side). Skip the specific
  `required_field_omission_returns_400:that_field` instance rather than
  suppressing all required-field checks.

The skip mechanism is an escape hatch, not a routine practice. A suppressed
case is a gap you've accepted. Keep the list short and document why each
entry is there in a comment or commit message.

---

## Token grammar

Every opt-out is a string token. Two forms are accepted:

### Form 1 — `"kind"`

Skips every generated case of that kind for the matching scope (the
endpoint or globally, depending on where the token appears).

```json
"skip_cases": ["delete_idempotency"]
```

In `apiwright.config.json`:

```json
{
  "case_generation": {
    "skip_globally": ["status_code_conformance"]
  }
}
```

### Form 2 — `"kind:field"`

Skips only the generated instance for the named body field. Only three
kinds carry a field component; for all others the `:field` part is
ignored (the token is treated as Form 1 and a warning is emitted).

```json
"skip_cases": [
  "type_violation_returns_400:tags",
  "required_field_omission_returns_400:internal_id"
]
```

`field` must match the exact property name as it appears in
`request.body_schema.properties`.

### Malformed tokens

The parser accepts tokens and emits a warning (without aborting the run)
for any of the following:

| Reason | Example |
|---|---|
| Empty string | `""` |
| Starts with colon (no kind) | `":field"` |
| Ends with colon (no field) | `"kind:"` |
| More than one colon | `"kind:a:b"` |

Malformed tokens are excluded from the plan as if they were absent. The
warning tells you which endpoint and which token triggered the issue so
you can fix the typo.

---

## Per-endpoint vs global

### Per-endpoint — `skip_cases` in `.endpoint.json`

```json
{
  "id": "users.delete",
  "method": "DELETE",
  "url": "/api/v1/users/123",
  "skip_cases": ["delete_idempotency", "type_violation_returns_400:tags"]
}
```

Applies only to the plan generated from that endpoint file. Use this when
a specific endpoint has a known asymmetry (destructive side effects,
intentionally lenient field handling, etc.).

### Global — `case_generation.skip_globally` in `apiwright.config.json`

```json
{
  "case_generation": {
    "skip_globally": ["boundary_battery", "delete_idempotency"]
  }
}
```

Applies to every endpoint in the run. Use this to suppress a kind that
doesn't apply to your API at all (e.g. your API never enforces idempotency
on DELETE) rather than adding the same token to dozens of endpoint files.

### Union rule

Endpoint opt-outs and global opt-outs are combined by UNION. An endpoint's
`skip_cases` list can only add cases to skip beyond what global already
suppresses. There is no way to un-suppress a globally-skipped kind for a
single endpoint.

---

## The 18 skippable kinds

| Kind | Family | `:field` supported? | Notes |
|---|---|---|---|
| `status_code_conformance` | Universal | No | Checks declared `expected_status` matches actual. |
| `content_type_alignment` | Universal | No | Checks `Content-Type` header is consistent with body. |
| `response_schema_validation` | Universal | No | Validates body against `response.schema`. |
| `auth_happy_path` | Universal | No | Happy-path request with configured auth. |
| `response_time_sla` | Universal | No | Checks response time against `sla_ms`. |
| `no_auth_returns_401` | Auth-negative | No | Request sent without auth header; expects 401. |
| `garbage_token_returns_401` | Auth-negative | No | Request sent with malformed token; expects 401. |
| `method_not_allowed` | HTTP-semantics | No | Wrong HTTP method sent; expects 405. |
| `malformed_json_returns_400` | Body-negative | No | Malformed JSON body sent; expects 400. |
| `required_field_omission_returns_400` | Body-negative | Yes — body field name | One case per `required` field in `body_schema`. |
| `type_violation_returns_400` | Body-negative | Yes — body field name | One case per typed field in `body_schema.properties`. |
| `boundary_battery` | Body-negative | Yes — body field name | One or more cases per constrained field (`minimum`, `maximum`, `minLength`, `maxLength`, `enum`). |
| `get_idempotency` | Method-specific | No | Two back-to-back GETs must return identical responses. |
| `delete_idempotency` | Method-specific | No | Second DELETE must return same shape as first. |
| `put_idempotency` | Method-specific | No | Two identical PUTs; compare mode is `body_equality` by default, `db_state` when `db_verify` is declared. See [docs/cookbook/put-idempotency.md](./cookbook/put-idempotency.md). |
| `head_get_parity` | Method-specific | No | Opt-in (`pair_with` required). Sends HEAD + GET to the same URL; asserts identical status + headers (minus ignored set) + empty HEAD body. RFC 7231 §4.3.2. See [docs/cookbook/head-get-parity.md](./cookbook/head-get-parity.md). |
| `db_state_matches_expectation` | DB-state | No | Runs `db_verify` queries after a write; expects declared `expect` mode. |
| `assertion` | Assertion sentinel | No | Skips all declarative `assertions[]` entries for this scope. |

Total: 18. This is the complete set recognised by the skip-cases parser.
The test suite asserts `ALL_SKIPPABLE_KINDS.size === 18`.

---

## Warnings you will see

**Counted skip** — a case was removed from the plan (endpoint-level token):

```
Endpoint 'users.delete': skip_cases token 'delete_idempotency' skipped 1 case(s).
```

Global token variant:

```
config.case_generation: skip_globally token 'delete_idempotency' skipped 3 case(s) across 3 endpoint(s).
```

**Malformed token** — token ignored, run continues:

```
Endpoint 'users.delete': malformed skip token ':tags' (leading_colon); ignored.
```

**Unknown kind** — token ignored, run continues:

```
Endpoint 'users.delete': unknown skip kind 'delete_idempotnecy' in token 'delete_idempotnecy'; ignored.
```

**Zero-match** — the token parsed correctly but matched no generated cases
(usually a typo in the field name):

```
Endpoint 'users.delete': skip_cases token 'type_violation_returns_400:tag' matched zero generated cases on this endpoint.
```

All warning types appear at `WARN` level and do not change the exit code.
Run with `--log warn` (the default) to see them.

---

## Security caveat

Skip tokens are kind/field identifiers — never put credential material
in them.

Token strings appear verbatim in the JSON sidecar, console output, and
(future) HTML report. The secret redactor only masks values registered
via `${secret.NAME}` references in environment YAML. A literal
credential accidentally placed in a skip token (for example,
`"type_violation_returns_400:AKIA-real-aws-key"`) would land in logs and
reports un-redacted.

---

## Compatibility

`skip_cases` is an additive field on `.endpoint.json` and
`case_generation.skip_globally` is an additive section in
`apiwright.config.json`. Endpoint files and configs from v1.0.x that do
not include either field continue to work identically on v1.0.2 and
later — no migration needed.

The set of recognised skippable kinds is part of the v1.x stable
surface. Removing or renaming a kind is a major-version break. New kinds
may be added in MINOR releases; existing skip tokens that name those new
kinds will emit an "unknown kind" warning on older releases (no crash).

See [compatibility.md](./compatibility.md) for the full SemVer policy.
