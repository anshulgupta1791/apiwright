# Testing an authenticated API

Two strategies, end-to-end. By the end of this recipe you'll have:

1. **`static_token`** — a fixed bearer token (the simplest case).
2. **`token_endpoint`** — call a token URL first, extract the access
   token, use it as bearer (the OAuth client-credentials shape).

For both, you'll see APIWright's **auth boundary cases**
(`auth_happy_path`, `no_auth_returns_401`,
`garbage_token_returns_401`) auto-generate from the same declaration,
and you'll verify the redaction contract (secrets never appear in
reports).

---

## What you need first

- APIWright installed.
- Completed at least the [Quickstart](./quickstart.md).
- A real API you can authenticate against. Examples that work without
  a paid account:
  - **GitHub** with a [Personal Access Token](https://github.com/settings/tokens) (free).
  - **Stripe** with a [test secret key](https://dashboard.stripe.com/test/apikeys) (free).
  - Any internal API your team owns.

For this walkthrough we'll use **GitHub** as the example — every
reader can get a free PAT in 60 seconds, and we'll target the
read-only `/user` endpoint so we don't mutate anything.

---

## Part 1 — `static_token` (the simple case)

### Step 1.1 — Get a token, set it as an env var

GitHub → Settings → Developer settings → Personal access tokens
(classic) → Generate. Give it `read:user` scope. Copy the token.

In your shell (don't paste the token into any file):

```bash
export GH_PAT=ghp_yourTokenHere
```

### Step 1.2 — Environment with `auth_strategies`

`environments/github.yaml`:

```yaml
name: github
prod: false
base_url: https://api.github.com
default_sla_ms: 5000

auth_strategies:
  github_pat:
    type: static_token
    token: ${secret.GH_PAT}                # resolves from $GH_PAT at run time
    header: Authorization
    header_value: Bearer ${token}          # ${token} is replaced with the resolved value
```

Three things to note:

- `auth_strategies.github_pat` is the name endpoints will reference;
  `github_pat` is arbitrary.
- `token: ${secret.GH_PAT}` resolves from `process.env.GH_PAT` at run
  time. The value is automatically registered for redaction.
- `header_value: Bearer ${token}` templates the token into the header
  value. `${token}` is APIWright's placeholder for the resolved token.

### Step 1.3 — Endpoint with `auth_strategy`

`tests/user-me.endpoint.json`:

```json
{
  "id": "github.user_me",
  "name": "GET /user — authenticated user profile",
  "method": "GET",
  "url": "/user",
  "tags": ["github", "read", "auth"],
  "markers": ["smoke"],
  "auth_strategy": "github_pat",
  "request": {},
  "response": {
    "expected_status": 200,
    "sla_ms": 5000,
    "schema": {
      "type": "object",
      "required": ["login", "id"],
      "properties": {
        "login": { "type": "string", "minLength": 1 },
        "id":    { "type": "integer", "minimum": 1 }
      }
    }
  },
  "assertions": [
    "response.body.login is_not_null",
    "response.body.id    greater_than 0"
  ]
}
```

The `auth_strategy: github_pat` field tells the runner to apply that
strategy to every generated case for this endpoint.

### Step 1.4 — Run

```bash
apiwright run --env github --markers smoke,regression
```

Expected:

```
Run summary: planned=1 passed=1 failed=0 ...
```

Smoke + regression generates **~8 cases** for this single endpoint:

- 4 universal (status / content-type / schema / sla)
- 2 declared assertions
- 1 `auth_happy_path` (smoke) — sends the request WITH the token
- 1 `method_not_allowed` (regression)
- 1 `no_auth_returns_401` (regression) — sends the request WITHOUT
  the Authorization header; asserts 401
- 1 `garbage_token_returns_401` (regression) — sends with a malformed
  token; asserts 401
- 1 `get_idempotency` (regression) — two GETs, identical result

The auth boundary tests are the win — they verify your API correctly
rejects un- and badly-authenticated requests, which is the kind of
security bug that's easy to introduce and hard to manually test for
every endpoint.

### Step 1.5 — Verify redaction

```bash
# Confirm your real token never appears in the report:
grep -q "ghp_" reports/run-*.json && echo "LEAK" || echo "OK"
# OK

# Confirm the placeholder IS present in the Authorization header:
grep -o "Bearer \[REDACTED\]" reports/run-*.json | sort -u
# Bearer [REDACTED]
```

Every `${secret.*}` value is replaced with `[REDACTED]` in every
output artifact (JSON, HTML, JUnit, console). APIWright's redaction
contract is verified by an external meta-test that injects a canary
token and asserts it never appears raw, on every release.

---

## Part 2 — `token_endpoint` (password-grant token flow)

For APIs that issue short-lived tokens via a token endpoint: you POST
`{username, password}` to `/oauth/token`, get back a JSON response with
`access_token` (and usually `expires_in`), then use that as the bearer
for subsequent requests.

**Scope note**: v1.0 ships a *password-grant* flow only — the strategy
POSTs `{username, password}` and extracts the token. OAuth2
`client_credentials`, authorization-code, PKCE, refresh-token, and
custom-grant flows are deferred to v1.5. If your token endpoint expects
`{client_id, client_secret, grant_type: client_credentials}` instead of
`{username, password}`, you'll need to either expose a thin password
adapter in front of it, or fetch the token externally and pass it as a
`static_token` (Part 1).

### Step 2.1 — Environment with `token_endpoint` strategy

```yaml
name: oauth-api
prod: false
base_url: https://your-api.example.com
default_sla_ms: 10000

auth_strategies:
  oauth_client:
    type: token_endpoint
    url: https://auth.example.com/oauth/token   # token endpoint URL
    credentials:                                # exactly {username, password}
      username: ${secret.MY_USERNAME}
      password: ${secret.MY_PASSWORD}
    token_path: $.access_token                  # JSONPath (must start with $.)
    expires_in_path: $.expires_in               # optional — enables lazy refresh
    header: Authorization
    header_value: Bearer ${token}
```

Field reference (the config parser rejects anything else on
`token_endpoint`):

| Field | Required | Notes |
|---|---|---|
| `url` | yes | Token endpoint URL (POST destination). |
| `credentials` | yes | Exactly `{username, password}`. Extra keys rejected. |
| `token_path` | yes | JSONPath into the token response, **prefixed with `$.`** (e.g. `$.access_token`, `$.data.token`). |
| `expires_in_path` | no | JSONPath to a TTL field. When present, the strategy refreshes the token lazily before it expires. |
| `refresh_buffer_seconds` | no | Default 30. Refresh this many seconds before expiry. |
| `header` | no | Default `Authorization`. |
| `header_value` | no | Default `Bearer ${token}`. Only `${token}` is honoured. |

Set the env vars before running:

```bash
export MY_USERNAME=...
export MY_PASSWORD=...
```

### Step 2.2 — Endpoint references the strategy the same way

```json
{
  "id": "myapi.resource_list",
  "method": "GET",
  "url": "/api/v1/resources",
  "auth_strategy": "oauth_client",
  ...
}
```

APIWright handles the token fetch + caching transparently. The token
is fetched once per run and reused across all cases. If the token
expires mid-run (uncommon for short test runs), the runner re-fetches
automatically. The fetched token is registered for redaction so it
NEVER appears raw in any output.

### Step 2.3 — The auth boundary cases work the same

`auth_happy_path` calls with the fetched token. `no_auth_returns_401`
calls without it. `garbage_token_returns_401` calls with a malformed
token. APIWright doesn't care which strategy issued the "good" token —
the boundary tests are identical from the catalog's perspective.

---

## What APIWright does NOT support (yet)

| Pattern | Status | Workaround |
|---|---|---|
| OAuth user flows (authorization_code, browser redirect, PKCE) | v2.0 | Use `static_token` with a pre-fetched access token |
| HMAC / AWS SigV4 request signing | v2.0 | Hand-sign requests outside APIWright; pass through `static_token` |
| Mutual TLS (mTLS client cert) | v2.0 | Run APIWright behind a proxy that applies the client cert |
| API key in query parameter (`?api_key=...`) | v2.0 | Bake into URL template via `${secret.X}`; secrets are redacted in URLs the same way |

See [limitations.md](../limitations.md) for the complete scope
boundary.

---

## Common pitfalls

### "Unknown auth strategy 'X'. Known: []"

The endpoint's `auth_strategy: X` references a strategy name that
isn't defined in the env YAML's `auth_strategies:` block. Either the
name is misspelled or the env's block is missing.

### "Could not resolve ${secret.Y}"

The env YAML references a secret env var that isn't set in
`process.env`. Export it before running.

### `no_auth_returns_401` fails with "expected 401 got 200"

Your endpoint returns 200 even without auth — actual security gap.
Investigate the endpoint's auth middleware.

### `no_auth_returns_401` fails with "expected 401 got 403"

Some APIs return 403 (forbidden) instead of 401 (unauthorized) when
there's no credential. Both are arguably correct; the spec calls out
401 as canonical. Adjust the API or the test as fits your context.

### Token appears raw in the console

Either the env var isn't being read as a secret (check the env YAML
references `${secret.X}` not `${env.X}`) or the secret was set
AFTER APIWright started. Restart APIWright; secrets are captured at
startup.

---

## Where to go next

- **[Verifying DB side effects](./db-side-effects.md)** — when your
  authenticated endpoints write to a database.
- **[CRUD API](./crud-api.md)** — add `auth_strategy` to the CRUD
  recipe's endpoints to get auth coverage on every method.

Reference:

- **[environment-config.md](../environment-config.md)** — the
  complete env YAML schema including `auth_strategies` and
  `databases`.
- **[reports.md](../reports.md)** — the redaction contract in
  detail.
- **[test-catalog.md](../test-catalog.md)** — the auth-boundary case
  family (`auth_happy_path`, `no_auth_returns_401`,
  `garbage_token_returns_401`).
