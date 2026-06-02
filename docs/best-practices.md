# Best practices

Conventions that scale well from 10 endpoints to 1,000. Distilled
from dogfooding against a real API and from common-pattern observation
across adoption.

---

## File and folder organisation

### Mirror your service / API structure

Put each `*.endpoint.json` in a folder reflecting its area of the API:

```
tests/
  users/
    create.endpoint.json
    list.endpoint.json
    get.endpoint.json
    update.endpoint.json
    delete.endpoint.json
  orders/
    create.endpoint.json
    cancel.endpoint.json
    list.endpoint.json
  webhooks/
    receive.endpoint.json
```

Why: `--path tests/users/` becomes a natural per-service CI filter;
discoverability via `ls`/IDE; clean folder-based code review for
service-team-owned PRs.

For larger orgs, an extra layer per service is fine:

```
tests/
  user-service/
    users/...
    auth/...
  order-service/
    orders/...
    payments/...
```

### Naming

| Element | Convention | Example |
|---|---|---|
| File name | `<resource>-<verb>.endpoint.json` | `users-create.endpoint.json` |
| Endpoint `id` | `<service>.<resource>.<verb>` (lowercase, dot-separated) | `"users.create"` |
| Endpoint `name` | Short human description | `"POST /users — create a new user"` |
| Tag | Lowercase noun or noun-phrase | `"write"`, `"user-service"`, `"external"` |
| Env name | Lowercase environment label | `qa`, `staging`, `prod-readonly` |
| Auth strategy name | Snake-case bundle name | `bearer`, `api_key`, `oauth2_client` |

`id`s must be unique across the entire suite — they're how the
filter `--endpoint <id>` and the report identify each endpoint.

### One service per env file (optional)

Most teams use one env YAML per deployment target (`qa.yaml`,
`staging.yaml`, `prod.yaml`). For multi-tenancy or per-service base
URLs, split further:

```
environments/
  qa.yaml             # canonical QA env
  qa-eu.yaml          # QA against the EU region
  qa-canary.yaml      # canary QA against the canary deploy
```

`apiwright run --env qa-eu` selects which YAML loads.

---

## Marker discipline

The marker on a case is set by the catalog generator, not by you.
But the *endpoint's* `markers` field gates the whole endpoint into a
marker subset.

```json
"markers": ["regression"]      // never runs under --markers=smoke
"markers": ["smoke"]           // runs under both smoke and regression
"markers": ["smoke", "regression"]  // same as above (the union)
```

| Pattern | When to use |
|---|---|
| `markers: ["smoke"]` (default) | Every endpoint should be at this level — even minimal testing on every PR catches the worst regressions |
| `markers: ["regression"]` | Truly destructive or slow endpoints you want only nightly |
| `markers: ["e2e"]` | Reserved for v1.5+ multi-step flows; don't use yet |

**Common mistake:** putting all endpoints under `regression` to keep
the smoke pass clean. Result: PRs ship breakage. Better: include
every endpoint in smoke; deal with flakes at the case level via
`--exclude-tag flaky`.

See [markers-and-lifecycle.md](./markers-and-lifecycle.md).

---

## Tagging

Use tags for cross-cutting filters that aren't markers:

```json
"tags": ["write", "user-service", "destructive", "rate-limited", "external"]
```

| Tag | What it lets you do |
|---|---|
| `write` | `--tag write` — run only the writes (when DB is the bottleneck) |
| `external` | `--exclude-tag external` — skip 3rd-party API calls in air-gapped CI |
| `rate-limited` | `--exclude-tag rate-limited` — skip APIs with tight limits in fast feedback loops |
| `flaky` | `--exclude-tag flaky` — work around known flakes while fixing root cause |
| `<service-name>` | `--tag user-service` — service-level subsets |

Keep the tag taxonomy small (< 20 tags) and document what each means
in a project-local CONTRIBUTING note.

---

## Schema discipline

### Be as tight as you can while staying realistic

Loose schemas (`{type: object}`) pass anything and add no value:

```json
"response": {
  "expected_status": 200,
  "schema": { "type": "object" }   // ❌ — catches nothing
}
```

Tight schemas catch drift:

```json
"response": {
  "expected_status": 200,
  "schema": {
    "type": "object",
    "required": ["id", "email", "name"],
    "properties": {
      "id":    { "type": "string", "pattern": "^[a-f0-9-]{36}$" },
      "email": { "type": "string", "format": "email" },
      "name":  { "type": "string", "minLength": 1 }
    }
  }
}
```

**The principle:** every field your downstream consumer relies on
should be in the schema's `required` and `properties`. Anything not
listed is "noise we don't enforce." Anything listed is a contract.

### Use `pattern` for ID formats

UUIDs, ULIDs, custom slugs — pattern them. Catches the bug where the
response shape didn't change but the ID generator did.

### Bound numeric ranges

If a field has a natural range (`age: 0..150`, `discount_percent:
0..100`), declare `minimum`/`maximum`. APIWright then auto-generates
boundary tests:

```json
"discount_percent": { "type": "integer", "minimum": 0, "maximum": 100 }
```

Five generated boundary cases per such field — for free.

### Don't over-specify

If a field is genuinely unbounded, don't invent a bound to "feel
safe." The boundary battery will then send pathological values that
your endpoint correctly accepts but you didn't intend to test.

---

## Assertions

### One assertion per business rule

Keep assertions short and atomic. Each line is one logical claim:

```json
"assertions": [
  "response.body.id is_uuid_v4",
  "response.body.email equals request.body.email",
  "response.body.created_at is_recent_timestamp",
  "db.primary_postgres.row_check.email equals request.body.email"
]
```

Easier to debug, easier to read in the report, easier to maintain
than complex compound checks.

### Use cross-target assertions liberally

`response.body.X equals request.body.X` is a great way to verify
"the API returned what was sent." Cheap to write, catches a real
class of bug.

`response.body.id equals db.<conn>.<qid>.id` verifies "the API and the
database agree on what was created." Pair with a `db_verify` block
with a matching `query_id`.

### Don't assert on noisy fields

Don't assert on `response.body.created_at equals "2026-..."` (it's a
timestamp, it'll change). Do assert on `response.body.created_at
is_recent_timestamp` (which captures the intent — "this should be
freshly created" — without hardcoding a value).

---

## DB verification

### Verify on writes; skip on reads

Per the known limitation (`db_verify` doesn't gate on read methods —
see [db-verify.md](./db-verify.md) and [limitations.md](./limitations.md)),
prefer:

- POST/PUT/PATCH/DELETE endpoints: declare `db_verify` blocks freely.
- GET endpoints: skip `db_verify`; use the `assertions` engine to
  reach into a `db_verify` query result via
  `db.<connection>.<query_id>.<column>` if you need to assert DB state
  after a read.

### Query identifiers worth referencing

Always give `db_verify` queries a meaningful `query_id` — even if you
don't reference it from an assertion today, your future-self will.

```json
"db_verify": [
  {
    "connection": "primary_postgres",
    "query_id": "user_persisted",       // good — clear intent
    "query": "SELECT email FROM users WHERE email = '${request.body.email}'",
    "expect": "exists"
  }
]
```

### Cleanup intentionally, not aspirationally

Cleanup blocks run after every test. If a cleanup is best-effort
("delete the test user if it exists"), say so explicitly. Don't rely
on cleanup for test isolation — use unique per-run identifiers
(timestamp suffix) so cases never collide in the first place.

---

## CI integration

### Smoke on every PR; regression nightly

This is the high-leverage pattern:

```yaml
# .github/workflows/pr.yml
on: pull_request
jobs:
  apiwright:
    steps:
      - run: apiwright run --env qa --markers smoke
```

```yaml
# .github/workflows/nightly.yml
on:
  schedule: [{ cron: '0 2 * * *' }]
jobs:
  apiwright:
    steps:
      - run: apiwright run --env qa --markers smoke,regression
```

PR gate stays fast (smoke is ~30 % of the catalog); nightly catches
the wider bug class.

See [ci-cd.md](./ci-cd.md).

### Pin the Docker image version

```yaml
- run: docker run ... ghcr.io/anshulgupta1791/apiwright:1.0.0 ...
```

Not `:latest`. CI reruns months from now should produce the same
result.

### Always upload reports — even on failure

`if: always()` (GitHub Actions) / `post { always { ... } }`
(Jenkins). The HTML / JUnit / JSON reports are exactly what you need
to debug a failing run; locking them behind "only upload on green"
defeats the purpose.

---

## Secrets

### Use `${secret.*}` for every credential

Never hardcode tokens in YAML or JSON. `${secret.X}` resolves from
`process.env` at run time and is redacted in every output.

### Verify redaction locally before shipping

Pick a canary value, run, grep the report:

```bash
export QA_API_TOKEN="apiwright-canary-XYZ"
apiwright run --env qa --markers smoke
grep -q "apiwright-canary-XYZ" reports/run-*.json && echo "LEAK" || echo "OK"
```

Should print `OK`. We run an equivalent canary-leak check against
every published build.

### Rotate `${secret.X}` env var names per deployment

Don't reuse `API_TOKEN` for both QA and prod — use `QA_API_TOKEN` and
`PROD_API_TOKEN`. Avoids the "wrong env loaded the wrong secret"
foot-gun.

---

## Versioning your test suite

### Treat declarations as code

`*.endpoint.json` files are versioned in the same repo as the
service whose API they describe. PRs touching the API touch the
declarations.

### Or in a sibling repo

For multi-service orgs, a dedicated `<org>/api-tests/` repo with all
declarations is a viable pattern — but requires discipline to keep
declarations in sync with API changes (a CI job that runs the suite
on every API service PR helps).

Either layout works — pick the one that matches how your team
already organises service code.

---

## What NOT to do

- **Don't write integration-test-shaped flows as one declaration.**
  Multi-step is v1.5; in v1.0, write flows in your existing
  integration suite. See [comparisons.md](./comparisons.md).
- **Don't disable failing tests to keep CI green.** Use `--exclude-tag
  broken` with an open issue tracking the fix.
- **Don't catch-all in schemas (`additionalProperties: true`).** It
  passes anything. Be specific about what you allow.
- **Don't put real environment data in fixtures.** Use synthetic
  values + secrets injection.

---

## See also

- [test-catalog.md](./test-catalog.md) — what the catalog generates.
- [markers-and-lifecycle.md](./markers-and-lifecycle.md) — pipeline
  integration.
- [db-verify.md](./db-verify.md) — DB verification patterns.
- [environment-config.md](./environment-config.md) — secrets handling.
