# PUT idempotency testing

RFC 7231 §4.3.4 requires that PUT be idempotent: sending the same PUT
twice must leave the resource in the same state as sending it once.
APIWright auto-generates a `put_idempotency` case for every PUT endpoint
— no extra declaration needed.

---

## What you'll have when you're done

A PUT endpoint declaration that produces one `put_idempotency` regression
case. You'll see how the compare mode is chosen, what the plan-time
warnings look like, and how to opt out when the default doesn't fit.

---

## How it works

The generator issues two identical PUTs and asserts the result is
unchanged. The compare mode is chosen automatically at plan time — you
do not set it manually.

| Condition | Compare mode selected |
|---|---|
| No `db_verify` declared (or `db_verify: []`) | `body_equality` — second PUT's response body must deep-equal the first's |
| `db_verify` has at least one entry | `db_state` — `db_verify` block re-runs after the second PUT; every step must pass |

---

## Example 1 — `body_equality` mode (no `db_verify`)

`tests/products/update.endpoint.json`:

```json
{
  "id": "products.update",
  "name": "PUT /products/:id — update product",
  "method": "PUT",
  "url": "/api/v1/products/42",
  "tags": ["products", "write"],
  "markers": ["regression"],
  "prod_safe": false,
  "request": {
    "headers": { "Content-Type": "application/json" },
    "body_schema": {
      "type": "object",
      "required": ["name", "price"],
      "properties": {
        "name":  { "type": "string", "minLength": 1, "maxLength": 200 },
        "price": { "type": "number", "minimum": 0 }
      }
    },
    "body_example": {
      "name":  "Widget Pro",
      "price": 9.99
    }
  },
  "response": {
    "expected_status": 200,
    "schema": {
      "type": "object",
      "required": ["id", "name", "price"],
      "properties": {
        "id":    { "type": "integer" },
        "name":  { "type": "string" },
        "price": { "type": "number" }
      }
    }
  }
}
```

APIWright generates one additional regression case: `put_idempotency`.
The runner sends `body_example` twice and deep-compares the two response
bodies (canonical JSON; key order does not matter).

**Console output during the run:**

```
INFO: products.update attempt 1: pass    (status_code_conformance)
INFO: products.update attempt 1: pass    (response_schema_validation)
INFO: products.update attempt 1: pass    (put_idempotency)
...
```

---

## Example 2 — `db_state` mode (with `db_verify`)

When `db_verify` is declared, the generator automatically switches to
`db_state` mode. The runner re-runs `db_verify` after the second PUT
and asserts every step still passes — regardless of what the response
bodies contain.

```json
{
  "id": "products.update",
  "name": "PUT /products/:id — update product",
  "method": "PUT",
  "url": "/api/v1/products/42",
  "tags": ["products", "write"],
  "markers": ["regression"],
  "prod_safe": false,
  "request": {
    "headers": { "Content-Type": "application/json" },
    "body_example": {
      "name":  "Widget Pro",
      "price": 9.99
    }
  },
  "response": {
    "expected_status": 200
  },
  "db_verify": [
    {
      "connection": "primary_postgres",
      "query_id":   "product_row",
      "query":      "SELECT name, price FROM products WHERE id = 42",
      "expect":     "match",
      "fields": {
        "name":  "Widget Pro",
        "price": 9.99
      }
    }
  ]
}
```

The `db_state` mode is the correct choice when the response includes
server-generated fields (timestamps, ETags, version counters) that
would cause `body_equality` to fail even though the resource IS
idempotent.

---

## Plan-time warnings

APIWright emits plan-time warnings (not errors) for two conditions:

**204 No Content + no `db_verify`:**

```
Endpoint 'products.update': put_idempotency — response is 204 No Content;
body_equality compare will be trivially satisfied.
Add db_verify[] to assert resource state.
```

A 204 response has no body; two empty bodies will always compare equal.
Add `db_verify` to verify the resource state, which auto-selects
`db_state` mode.

**No `body_example`:**

```
Endpoint 'products.update': put_idempotency — no request.body_example declared;
the runner will PUT an empty body which may not exercise true idempotency.
```

Declare `request.body_example` with a representative payload so the
two PUTs carry a meaningful body.

---

## Opting out

If `put_idempotency` does not apply to a specific endpoint:

```json
{
  "id": "products.update",
  "skip_cases": ["put_idempotency"]
}
```

To suppress it across every PUT endpoint in the run:

```json
{
  "case_generation": {
    "skip_globally": ["put_idempotency"]
  }
}
```

See [docs/skip-cases.md](../skip-cases.md) for the full opt-out
reference.

---

## Known limitations

**Timestamp-bearing response bodies.** If the PUT response includes a
server-generated field (`lastModified`, `updatedAt`, an ETag), the two
response bodies will differ and `body_equality` will fail even though
the resource is idempotent. Add `db_verify` to switch to `db_state`
mode, which compares database state rather than response bodies.

**Read-after-write timing in `db_state` mode.** The runner reads the DB
immediately after the second PUT returns. If the system under test
defers write commits (async flush queues, eventual consistency), the DB
read may not yet reflect the second PUT's effect. Ensure the SUT has
flushed all writes before `db_verify` executes, or accept the timing
risk. See [docs/limitations.md](../limitations.md) for details.

**Cleanup hooks still fire.** The `put_idempotency` case sends two
PUTs. If a `cleanup` block is declared, it runs once after both PUTs
complete (not once per PUT). This is by design — cleanup restores the
pre-test state, not the state between the two PUTs.

---

## Where to go next

- **[Verifying DB side effects](./db-side-effects.md)** — declare
  `db_verify` and switch to `db_state` compare mode.
- **[Skip cases](../skip-cases.md)** — full opt-out reference.
- **[Test catalog](../test-catalog.md)** — every auto-generated case type.
- **[Limitations](../limitations.md)** — timestamp-body and timing
  caveats in detail.
