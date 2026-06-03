# ETag/conditional-GET testing

RFC 7232 defines conditional requests. When a server returns an ETag on a
GET response, a well-behaved client can send `If-None-Match: <etag>` on
the next GET to avoid re-downloading an unchanged resource. The server
should respond 304 Not Modified, echo the ETag, and send no body.
APIWright auto-generates a `conditional_get_304` case for any GET endpoint
that declares `etag_supported: true`.

---

## What you'll have when you're done

A GET endpoint declaration that produces one `conditional_get_304`
regression case. You'll see how the declaration is written, what the five
failure messages mean, and how to opt out when the default behaviour
doesn't fit.

---

## What you need first

- A GET endpoint that sends `ETag` response headers (check with your
  server team or inspect a live response with `curl -I`).
- APIWright installed and at least one environment YAML in place. See
  [quickstart](./quickstart.md) if this is your first endpoint.

---

## How it works

The generator issues two GET requests to the endpoint URL in sequence:

1. **First GET** — sent normally with no conditional headers. The runner
   captures the `ETag` response header. If no ETag is present, the case
   fails immediately with a specific failure message (see below).
2. **Second GET** — sent with `If-None-Match: <etag-from-first>` added.
   The runner then asserts four properties of the response:
   - Status is `304 Not Modified`.
   - The `ETag` header is present on the 304 response.
   - The 304 `ETag` matches the ETag from the first response exactly.
   - The 304 response body is empty.

Marker = `regression`.

---

## Step 1 — declare the endpoint

`tests/users/get.endpoint.json`:

```json
{
  "id": "users.get",
  "name": "GET /users/:id",
  "method": "GET",
  "url": "${env.api_base}/users/123",
  "etag_supported": true,
  "response": {
    "expected_status": 200
  }
}
```

The only new field is `etag_supported: true`. Everything else is a
standard GET declaration.

---

## Step 2 — run the regression suite

```bash
apiwright run --env qa --markers regression
```

When the server honours ETags correctly you will see:

```
INFO: users.get attempt 1: pass    (conditional_get_304)
```

---

## Step 3 — read a failing run

There are five distinct failure messages. Here is what each one means and
how to fix it.

### Failure 1 — `first response missing ETag header (etag_supported: true)`

```
conditional_get_304: first response missing ETag header (etag_supported: true)
```

The first GET returned a 200 with no `ETag` header. The server is not
sending ETags even though you declared `etag_supported: true`.

Fix: confirm the endpoint sends ETags (check with `curl -v`). If it
doesn't yet, remove `etag_supported: true` from the declaration until
the feature is shipped. If ETags are only sent on certain content-types or
auth levels, verify the test environment matches those conditions.

### Failure 2 — `expected 304 Not Modified on second request, got <N>`

```
conditional_get_304: expected 304 Not Modified on second request, got 200
```

The second GET with `If-None-Match` returned the full resource instead of
304. The server either ignores the `If-None-Match` header entirely, or the
resource changed between the two requests.

Fix: check whether the server reads `If-None-Match` — some frameworks need
explicit middleware to enable conditional-request support. If the server is
correct and the resource changes frequently (shared environment, race with
writes), see [Flake risk under concurrent writes](#flake-risk-under-concurrent-writes).

### Failure 3 — `304 response missing ETag header`

```
conditional_get_304: 304 response missing ETag header
```

The server returned 304 but did not echo the ETag back in the response.
RFC 7232 §4.1 requires the `ETag` header on 304 responses (so the client
can update its cache).

Fix: check your server's conditional-request implementation. Most major
frameworks handle this automatically; if yours doesn't, the omission is
a real RFC violation worth fixing.

### Failure 4 — `304 ETag '<got>' does not match first response ETag '<expected>'`

```
conditional_get_304: 304 ETag '"v2"' does not match first response ETag '"v1"'
```

The ETag changed between the first GET and the 304 response. Either the
resource was mutated by a concurrent request between the two GETs, or the
server has a bug that causes ETag rotation on 304 responses.

Fix: rule out the concurrent-mutation scenario first (run against a quiet
test fixture). If the mismatch persists with no concurrent writes, the
server is generating a new ETag on the conditional path, which is
incorrect.

### Failure 5 — `304 response body is not empty`

```
conditional_get_304: 304 response body is not empty
```

The server included a body in the 304 response. RFC 7230 §3.3 prohibits
message bodies on 304 responses. Some servers mistakenly forward the
response body from a cached handler.

Fix: configure your server or reverse proxy to strip the body from 304
responses. This is a real protocol violation.

---

## Opting out

If `conditional_get_304` does not apply to a specific endpoint:

```json
{
  "id": "users.get",
  "etag_supported": true,
  "skip_cases": ["conditional_get_304"]
}
```

To suppress it across every GET endpoint in the run (for example, while
ETag support is being rolled out):

```json
{
  "case_generation": {
    "skip_globally": ["conditional_get_304"]
  }
}
```

See [docs/skip-cases.md](../skip-cases.md) for the full opt-out reference.

---

## Flake risk under concurrent writes

The `conditional_get_304` generator issues two requests in sequence with
no delay. In a shared test environment where other processes are writing
to the same resource, the resource may change between the first and second
GET. If that happens:

- The server returns a fresh ETag on the second 200 instead of 304.
- The `expected 304` failure triggers.

This is not a bug in the server or in APIWright — it accurately reflects
that the resource changed. To avoid these flakes, run `conditional_get_304`
against a stable test fixture rather than a record under active write
load. If no stable fixture is available, opt out and test ETag behaviour
separately.

Weak ETags (`W/"..."`) carry the same risk: the server is permitted to
treat a weak-ETag conditional request as non-matching when the resource has
changed, returning a fresh 200 instead of 304.

See [docs/limitations.md](../limitations.md) for the full caveat.

---

## Known limitations

**Weak ETags.** Weak ETags (`W/"..."`) are echoed verbatim in
`If-None-Match`. The ETag matching check is exact string comparison, so
`W/"abc"` on the first response is expected to match `W/"abc"` on the 304.
If the server strips the `W/` prefix on the conditional response, the ETag
mismatch failure will trigger.

**Single-request window.** The generator does not insert a delay between
the two GETs. Endpoints on resources with sub-second TTLs or that rotate
ETags on every read will produce false failures. Opt out and write a
hand-rolled test with explicit delay if sub-second ETag stability is not
guaranteed.

---

## Where to go next

- **[Test catalog](../test-catalog.md)** — the `conditional_get_304` entry
  with the full failure-reason table.
- **[Skip cases](../skip-cases.md)** — full opt-out reference.
- **[Limitations](../limitations.md)** — weak-ETag and concurrent-write
  caveats in detail.
- **[HEAD/GET parity](./head-get-parity.md)** — the related `head_get_parity`
  generator, which also involves ETag behaviour.
