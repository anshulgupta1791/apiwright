# Response variants — enriched failure reasons

APIs routinely return status codes other than the happy-path status in
normal operation — a `400` for validation errors, a `409` for
conflicts, a `500` with a structured error body. Without
`response_variants`, APIWright's failure reason for a status mismatch
is `expected status 201, got 400`. With `response_variants` you get the
same failing verdict PLUS confirmation that the error body had (or
lacked) the expected shape.

---

## What you'll have when you're done

A `POST /users` endpoint declaration with `400` and `500` variants
declared. You'll see all four failure-reason forms, the two plan-time
warnings and how to resolve them, and the exact scope of what
`response_variants` covers.

---

## What you need first

- APIWright installed and at least one environment YAML in place. See
  [quickstart](./quickstart.md) if this is your first endpoint.
- An endpoint that can return non-happy-path statuses (most POST/PUT
  endpoints qualify).

---

## How it works

`response_variants` is a map on the endpoint declaration. Keys are
three-digit HTTP status strings; values are objects with an optional
`schema` field. When a STATUS_EQ_KINDS test case receives a status that
differs from `response.expected_status`, the runner looks up the actual
status in this map and annotates the `failure_reason` accordingly. The
verdict is always **fail** — variants do not change the outcome, only
the diagnostic detail.

---

## Step 1 — declare the variants

`tests/users/create.endpoint.json`:

```json
{
  "id": "users.create",
  "name": "POST /users",
  "method": "POST",
  "url": "${env.api_base}/users",
  "request": {
    "body_schema": {
      "type": "object",
      "required": ["email", "name"],
      "properties": {
        "email": { "type": "string", "format": "email" },
        "name":  { "type": "string", "minLength": 1 }
      }
    },
    "body_example": {
      "email": "alice@example.com",
      "name": "Alice"
    }
  },
  "response": {
    "expected_status": 201,
    "schema": {
      "type": "object",
      "required": ["id", "email"],
      "properties": {
        "id":    { "type": "string" },
        "email": { "type": "string" }
      }
    }
  },
  "response_variants": {
    "400": {
      "schema": {
        "type": "object",
        "required": ["error", "message"],
        "properties": {
          "error":   { "type": "string" },
          "message": { "type": "string" }
        }
      }
    },
    "500": {
      "schema": {
        "type": "object",
        "required": ["error"],
        "properties": {
          "error": { "type": "string" }
        }
      }
    }
  }
}
```

---

## Step 2 — understand the four failure-reason forms

### Form 1 — no variant declared for the actual status

The server returns `422` and there is no `"422"` key in
`response_variants`.

```
failure_reason: expected status 201, got 422
```

Plain message, unchanged from pre-variant behaviour.

### Form 2 — variant declared, body matches the variant schema

The server returns `400` with `{ "error": "VALIDATION_FAILED", "message": "email is required" }`.
The body validates against the `"400"` schema.

```
failure_reason: expected status 201, got 400
  (response body matched declared variant schema for 400)
```

The body was correct for a 400 response. The verdict is still **fail**
because the expected status was 201 — but you now know the API is
behaving consistently for the error case.

### Form 3 — variant declared, body fails the variant schema

The server returns `400` with `{ "code": 400 }` — missing the required
`error` and `message` fields.

```
failure_reason: expected status 201, got 400
  (response body did not match declared variant schema for 400:
   data must have required property 'error'; data must have required property 'message')
```

Both the status and the error body are wrong. The AJV error detail
pinpoints the problem.

### Form 4 — variant declared without a schema field

A forward-compat case: you want to document that `503` is a possible
response but you have not yet defined its schema.

```json
"response_variants": {
  "503": {}
}
```

The server returns `503`.

```
failure_reason: expected status 201, got 503
  (status 503 is a documented variant)
```

Useful for progressive documentation: record the known variants first,
add schemas later.

---

## Step 3 — understand what `response_variants` does NOT cover

Variant lookup applies only to the nine **STATUS_EQ_KINDS**. Other
generated case kinds compute their own verdict logic:

| Unaffected kind | Why |
|---|---|
| `put_idempotency` | Compares two PUT response bodies or re-runs `db_verify`; status is not the sole verdict criterion. |
| `head_get_parity` | Compares HEAD vs GET status + headers + body. |
| `conditional_get_304` | Asserts 304 + ETag + empty body across two GETs. |
| `cors_preflight` | Asserts CORS response headers, not just status. |
| `response_schema_validation` | Validates the body when the status IS correct (happy path). |
| `auth_happy_path` | Validates the full happy-path response. |
| `response_time_sla` | Asserts response time; status is not its verdict criterion. |
| `db_state_matches_expectation` | Post-request DB state check. |
| `assertion` (declarative) | Evaluates your explicit `assertions` entries. |

The happy path itself is also unaffected: when `actual === expected`,
variant lookup is suppressed entirely. `response.schema` validates the
happy-path body; `response_variants` never runs on it.

---

## Step 4 — plan-time warnings

### Warning 1 — variant key equals the happy-path status

```
Endpoint 'users.create': response_variants['201'] is the happy-path status;
this variant is never consulted by the runner. Remove or change the key.
```

A variant keyed `"201"` is declared but `response.expected_status` is
also `201`. Variant lookup is suppressed when actual equals expected,
so this key can never be reached. Fix: remove the `"201"` entry from
`response_variants`.

### Warning 2 — empty `response_variants`

```
Endpoint 'users.create': response_variants is empty;
remove the key or add at least one variant.
```

`response_variants` is present in the declaration but has no keys. Fix:
remove the field or add at least one variant.

Both warnings are emitted at `WARN` level and do not change the exit
code.

---

## Step 5 — run

```bash
apiwright run --env qa --markers regression
```

If the server returns `400` on a generated case (e.g.
`required_field_omission_returns_400` for a field the API actually
validates), the `failure_reason` in the report and HTML output will
include the variant annotation. On a correctly behaving server all
smoke cases pass and `failure_reason` entries only appear in the
expected negative cases.

---

## Known limitations

**Variants are informational.** Declaring a `response_variants` entry
for a status that IS expected from a generated negative case (e.g.
`"400"` for `required_field_omission_returns_400`) produces the Form 2
or Form 3 enrichment on the failure reason — but the case verdict
remains fail. `response_variants` cannot make a failed case pass; it
can only improve the diagnostic text.

**One schema per status code.** There is no way to declare multiple
possible body shapes for the same status code. If your API returns
different `400` bodies for different error paths, pick the common
fields (or the strictest schema) and accept that some body shapes will
trigger Form 3 enrichment.

**STATUS_EQ_KINDS only.** See Step 3 above for the full list of kinds
that are NOT enriched.

See [docs/limitations.md](../limitations.md) for the full scope
boundary.

---

## Where to go next

- **[Test catalog](../test-catalog.md)** — the `response_variants`
  reference section with the full failure-reason matrix and
  plan-time warning text.
- **[Limitations](../limitations.md)** — `response_variants` scope
  and STATUS_EQ_KINDS boundary.
- **[Compatibility](../compatibility.md)** — `response_variants` is
  additive; no migration needed from v1.0.x.
- **[Assertions](../assertions.md)** — for asserting specific fields
  in an error body beyond what schema validation covers.
