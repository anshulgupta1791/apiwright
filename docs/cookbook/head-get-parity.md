# HEAD/GET parity testing

RFC 7231 §4.3.2 states that the response to a HEAD request must be
identical to what a GET would return for the same resource, except that
the HEAD response must have no body. APIWright auto-generates a
`head_get_parity` case for any HEAD endpoint that declares
`pair_with: "<get-endpoint-id>"`.

---

## What you'll have when you're done

A HEAD endpoint declaration paired with its GET counterpart that produces
one `head_get_parity` smoke case. You'll see how the pairing is declared,
what the three plan-time resolution warnings look like, and how to opt out
when the default behaviour doesn't fit.

---

## What you need first

- A GET endpoint declaration already in your test suite (for example,
  `tests/users/get.endpoint.json` with `"id": "users.get"`).
- A HEAD endpoint to pair it with, or a plan to write one.

---

## How it works

The generator issues one HEAD request and one GET request, both to the
same URL. It then asserts:

1. The HTTP status codes are identical.
2. The HEAD response body is empty (`null`, `undefined`, or `""`).
3. The response headers are identical, except for the ignored set (see
   [docs/test-catalog.md](../test-catalog.md) for the full list).

The case runs under the `smoke` marker — it is a fast, happy-path safety
check on every PR.

---

## Step 1 — declare the GET endpoint

`tests/users/get.endpoint.json`:

```json
{
  "id": "users.get",
  "name": "GET /users/:id",
  "method": "GET",
  "url": "${env.api_base}/users/123",
  "response": {
    "expected_status": 200
  }
}
```

---

## Step 2 — declare the HEAD endpoint with `pair_with`

`tests/users/head.endpoint.json`:

```json
{
  "id": "users.head",
  "name": "HEAD /users/:id",
  "method": "HEAD",
  "url": "${env.api_base}/users/123",
  "pair_with": "users.get",
  "response": {
    "expected_status": 200
  }
}
```

The `pair_with` value must be the exact `id` of the paired GET endpoint.
The `url` template must match the GET endpoint's `url` value exactly
(template string, not the resolved URL).

---

## Step 3 — run the smoke suite

```bash
apiwright run --env qa --markers smoke
```

You will see a line for the `head_get_parity` case in the output:

```
INFO: users.head attempt 1: pass    (head_get_parity)
```

---

## Resolution failure warnings

If the `pair_with` target cannot be resolved at plan time, the case is
dropped and a warning is emitted. The rest of the plan is unaffected.

**Target not found:**

```
Endpoint 'users.head': pair_with target 'users.get' not found;
head_get_parity case dropped.
```

Fix: confirm the `id` in the GET endpoint file matches the value in
`pair_with` exactly.

**Target has wrong method:**

```
Endpoint 'users.head': pair_with target 'users.get' has method POST,
expected GET; head_get_parity case dropped.
```

Fix: `pair_with` must point to a GET endpoint.

**URL mismatch:**

```
Endpoint 'users.head': pair_with target 'users.get' URL
'${env.api_base}/users/456' does not match HEAD URL
'${env.api_base}/users/123'; head_get_parity case dropped.
```

Fix: the `url` field must be identical on both the HEAD and the GET
endpoint. The comparison is against the template string, so
`${env.api_base}/users/123` and `${env.api_base}/users/123` match;
`/users/123` and `${env.api_base}/users/123` do not.

---

## Opting out

If `head_get_parity` does not apply to a specific endpoint (for example,
the HEAD and GET endpoints use different auth strategies — see
[Limitations](#known-limitations)):

```json
{
  "id": "users.head",
  "method": "HEAD",
  "url": "${env.api_base}/users/123",
  "pair_with": "users.get",
  "skip_cases": ["head_get_parity"]
}
```

To suppress it across every HEAD endpoint in the run:

```json
{
  "case_generation": {
    "skip_globally": ["head_get_parity"]
  }
}
```

See [docs/skip-cases.md](../skip-cases.md) for the full opt-out reference.

---

## Known limitations

**Auth strategy not mirrored from the paired GET.** APIWright applies
the HEAD endpoint's `auth_strategy` to both the HEAD and the GET request.
If your GET endpoint declares a different `auth_strategy`, that difference
is not honoured by the parity test. Both requests will use the HEAD
endpoint's auth. If your HEAD and GET require different credentials, opt
out with `skip_cases: ["head_get_parity"]` and write hand-rolled
assertions instead.

**`etag` header excluded.** The parity check ignores the `etag` header.
RFC 7232 §2.1 requires that an ETag be identical on HEAD and GET
responses for the same resource, but certain middleware layers violate
this. If you want to enforce strict `etag` consistency, opt out and add
a hand-rolled comparison. The full ignored-header set is in
[docs/test-catalog.md](../test-catalog.md).

---

## Where to go next

- **[Test catalog](../test-catalog.md)** — the `head_get_parity` entry
  with the full ignored-header table.
- **[Skip cases](../skip-cases.md)** — full opt-out reference.
- **[Limitations](../limitations.md)** — auth-strategy and `etag`
  caveats in detail.
