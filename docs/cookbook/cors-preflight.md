# CORS preflight testing

Browsers send an OPTIONS preflight before every cross-origin request that
uses a non-simple method or header. If the server's preflight response is
wrong — missing `Access-Control-Allow-Origin`, wrong methods listed,
headers not covered — the browser blocks the real request and the user
sees a CORS error with no HTTP status code in the network tab. APIWright
auto-generates a `cors_preflight` case for any OPTIONS endpoint that
declares a `cors` block.

---

## What you'll have when you're done

An OPTIONS endpoint declaration that produces one `cors_preflight` smoke
case. You'll see both origin configurations (wildcard and multi-list),
how methods and headers are compared, the two plan-time warnings and how
to resolve them, and how to opt out.

---

## What you need first

- An OPTIONS endpoint in your API (or a server that handles preflight
  requests at a resource URL).
- APIWright installed and at least one environment YAML in place. See
  [quickstart](./quickstart.md) if this is your first endpoint.

---

## How it works

The generator reads the `cors` block and sends one OPTIONS request. The
request carries `Origin`, `Access-Control-Request-Method`, and (when
`allow_headers` is non-empty) `Access-Control-Request-Headers`. It then
checks the response status and three CORS response headers.

Marker = `smoke`.

---

## Step 1 — declare the OPTIONS endpoint

### Specific origins (multi-list)

`tests/users/preflight.endpoint.json`:

```json
{
  "id": "users.preflight",
  "name": "OPTIONS /users",
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

```
OPTIONS /users HTTP/1.1
Origin: https://app.example.com
Access-Control-Request-Method: GET
Access-Control-Request-Headers: Content-Type, Authorization
```

Assertions made:

| Check | Pass condition |
|---|---|
| Status | `200` or `204` |
| `Access-Control-Allow-Origin` present | Header exists |
| `Access-Control-Allow-Origin` value | Echoes `https://app.example.com` exactly |
| `Access-Control-Allow-Methods` present | Header exists |
| `Access-Control-Allow-Methods` superset | Contains `GET` and `POST` (case-insensitive) |
| `Access-Control-Allow-Headers` present | Header exists |
| `Access-Control-Allow-Headers` superset | Contains `Content-Type` and `Authorization` (case-insensitive) |

With a correctly configured server you will see:

```
INFO: users.preflight attempt 1: pass    (cors_preflight)
```

### Wildcard origin

When your API accepts requests from any origin:

```json
{
  "id": "public.api.preflight",
  "name": "OPTIONS /public/data",
  "method": "OPTIONS",
  "url": "${env.api_base}/public/data",
  "cors": {
    "allow_origins": ["*"],
    "allow_methods": ["GET"],
    "allow_headers": []
  }
}
```

The generator sends `Origin: *`. It accepts either `*` or the echoed
origin in `Access-Control-Allow-Origin`. Because `allow_headers` is
empty, no `Access-Control-Request-Headers` is sent and no
`Access-Control-Allow-Headers` check is performed.

---

## Step 2 — run the smoke suite

```bash
apiwright run --env qa --markers smoke
```

The case is smoke-marked, so it runs alongside every other smoke check
on every PR.

---

## Step 3 — understand the plan-time warnings

### Warning 1 — empty `allow_origins`

```
Endpoint 'users.preflight': cors_preflight — empty allow_origins; case dropped.
```

The `cors.allow_origins` array is missing or empty. A preflight without a
declared origin cannot assert the ACAO response header. Fix: add at least
one value to `allow_origins`.

### Warning 2 — empty `allow_methods`

```
Endpoint 'users.preflight': cors_preflight — empty allow_methods; case dropped.
```

The `cors.allow_methods` array is missing or empty. Fix: add at least one
HTTP method.

Both warnings are emitted at `WARN` level and do not change the exit code.
The rest of the plan continues.

---

## Step 4 — understand wildcard vs multi-origin rules

**Wildcard (`["*"]`):** the generator sends `Origin: *` and accepts either
`*` or the echoed request origin in `Access-Control-Allow-Origin`. Many
servers reflect the request origin (and set `Vary: Origin`) rather than
returning a literal `*`, especially when `credentials: true` is needed.
Both responses pass.

**Multi-list (`["https://a.example.com", "https://b.example.com"]`):** the
generator sends the first origin in the list. The server MUST echo that
origin exactly in `Access-Control-Allow-Origin`. A `*` response is not
accepted. This is because credentialed cross-origin requests require an
explicit origin echo, not a wildcard, and multi-origin lists imply the
server is doing origin-specific decisions.

---

## Step 5 — opt out

To suppress the case for a single endpoint:

```json
{
  "id": "users.preflight",
  "method": "OPTIONS",
  "url": "${env.api_base}/users",
  "cors": {
    "allow_origins": ["https://app.example.com"],
    "allow_methods": ["GET", "POST"],
    "allow_headers": ["Content-Type"]
  },
  "skip_cases": ["cors_preflight"]
}
```

To suppress across every endpoint in the run:

```json
{
  "case_generation": {
    "skip_globally": ["cors_preflight"]
  }
}
```

See [docs/skip-cases.md](../skip-cases.md) for the full opt-out reference.

---

## Known limitations

**One preflight per endpoint.** The generator sends one OPTIONS request
using the first `allow_origins` value. It does not cycle through the full
origin list. If you need to verify multiple origins are accepted, declare
a separate OPTIONS endpoint for each origin you want to exercise, or add
hand-rolled `assertions` entries.

**Non-OPTIONS endpoints are ignored.** If a `cors` block appears on a
GET, POST, or any non-OPTIONS endpoint, no `cors_preflight` case is
emitted. This is intentional — a non-OPTIONS endpoint does not handle
preflight requests. Move the `cors` block to a dedicated OPTIONS
endpoint.

**No `Access-Control-Max-Age` assertion.** The `cors_preflight` case does
not assert the preflight cache duration. If you need to verify
`Access-Control-Max-Age`, add a hand-rolled entry to `assertions`:

```json
"assertions": [
  "response.headers[\"Access-Control-Max-Age\"] equals \"86400\""
]
```

See [docs/limitations.md](../limitations.md) for the full scope boundary.

---

## Where to go next

- **[Test catalog](../test-catalog.md)** — the `cors_preflight` entry with
  the full failure-reason table and plan-time warning reference.
- **[Skip cases](../skip-cases.md)** — full opt-out reference.
- **[Limitations](../limitations.md)** — wildcard semantics and
  set-comparison caveats.
- **[Assertions](../assertions.md)** — for asserting additional CORS
  headers (e.g. `Access-Control-Max-Age`, `Vary`) beyond what the
  generator covers.
