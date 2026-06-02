# Verifying DB side effects with `db_verify`

When an endpoint writes to a database, "the API returned 201" is
half the story. The other half is "the row actually landed, with
the right columns." This recipe wires `db_verify` against a real
PostgreSQL database so you can assert both halves from one
declaration.

By the end you'll have a write endpoint that's verified end-to-end:
request → response → row in the database → cleanup.

---

## What you need first

- APIWright installed.
- A PostgreSQL database you can reach from where APIWright runs.
  Local docker-compose is easiest:

  ```yaml
  # docker-compose.yml
  services:
    postgres:
      image: postgres:16
      environment:
        POSTGRES_DB: app
        POSTGRES_USER: app
        POSTGRES_PASSWORD: app
      ports: ["5432:5432"]
  ```

  ```bash
  docker compose up -d postgres
  ```

- An API that writes to that DB. For this recipe we'll use a tiny
  fictional `users` API; substitute your own endpoint where shown.

The walkthrough uses Postgres; the same pattern works for **MySQL**,
**MongoDB**, **Neo4j** — see the per-driver notes at the end. Drivers
ship with APIWright (`pg`, `mysql2`, `mongodb`, `neo4j-driver`).

---

## Step 1 — Declare the database connection

In your environment YAML, add a top-level `databases:` block:

```yaml
# environments/qa.yaml
name: qa
prod: false
base_url: https://qa-api.example.com
default_sla_ms: 5000

databases:
  primary_postgres:
    type: postgres
    host: ${secret.QA_PG_HOST}        # e.g. "localhost" or a compose service name
    port: 5432
    database: app
    user: ${secret.QA_PG_USER}
    password: ${secret.QA_PG_PASSWORD}
```

The connection name (`primary_postgres`) is arbitrary — endpoints
reference it by name. You can declare multiple connections (read
replica + writer, primary + secondary regions, etc.).

Export the env vars before running:

```bash
export QA_PG_HOST=localhost
export QA_PG_USER=app
export QA_PG_PASSWORD=app
```

For local docker-compose, hardcoding the values directly in the YAML
is fine — `${secret.*}` is the recommended pattern only for real
deployment targets where credentials are managed by a secret store.

---

## Step 2 — Endpoint with `db_verify`

`tests/users/create.endpoint.json`:

```json
{
  "id": "users.create",
  "name": "POST /users — create + verify in DB",
  "method": "POST",
  "url": "/api/v1/users",
  "tags": ["users", "write"],
  "markers": ["regression"],
  "prod_safe": false,
  "request": {
    "headers": { "Content-Type": "application/json" },
    "body_schema": {
      "type": "object",
      "required": ["email", "name"],
      "properties": {
        "email": { "type": "string", "format": "email" },
        "name":  { "type": "string", "minLength": 1, "maxLength": 200 }
      }
    },
    "body_example": {
      "email": "qa-bot+${request.unique}@example.com",
      "name":  "QA Bot"
    }
  },
  "response": {
    "expected_status": 201,
    "schema": {
      "type": "object",
      "required": ["id", "email", "name"],
      "properties": {
        "id":    { "type": "string", "pattern": "^[a-f0-9-]{36}$" },
        "email": { "type": "string" },
        "name":  { "type": "string" }
      }
    }
  },
  "db_verify": [
    {
      "connection": "primary_postgres",
      "query_id":   "user_persisted",
      "query":      "SELECT email, name FROM users WHERE id = '${response.body.id}'",
      "expect":     "match",
      "fields": {
        "email": "${request.body.email}",
        "name":  "${request.body.name}"
      }
    }
  ],
  "assertions": [
    "response.body.id is_uuid_v4",
    "response.body.email equals request.body.email",
    "response.body.name  equals request.body.name",
    "db.primary_postgres.user_persisted.email equals request.body.email"
  ],
  "cleanup": {
    "connection": "primary_postgres",
    "query":      "DELETE FROM users WHERE id = '${response.body.id}'"
  }
}
```

What each piece does:

- **`request.body_example`** — the baseline body the catalog mutates
  for boundary / type-violation / required-omission cases. Note the
  `${request.unique}` token that ensures each run uses a fresh email
  (avoids unique-constraint violations across reruns).
- **`db_verify`** — one entry (you can declare multiple).
  - `connection`: matches a key in the env's `databases:` block.
  - `query_id`: a short name; the assertion engine can reach the
    query result via `db.<connection>.<query_id>.<column>`.
  - `query`: SQL with `${response.body.*}` and `${request.body.*}`
    template references.
  - `expect: match`: the returned row's columns must equal the values
    in `fields`. Subset match — extra columns are fine.
- **`assertions`** — the fourth one cross-references the
  `db_verify` query result, asserting that the email in the DB
  equals the email in the request. This catches the "API claims it
  saved the data but actually saved something different" bug class.
- **`cleanup`** — runs after the test regardless of pass/fail. Best-
  effort tidy.

---

## Step 3 — Run

```bash
apiwright run --env qa --markers regression
```

What you'll see for this single endpoint under regression:

```
INFO: users.create attempt 1: pass    (status_code_conformance)
INFO: users.create attempt 1: pass    (content_type_alignment)
INFO: users.create attempt 1: pass    (response_schema_validation)
INFO: users.create attempt 1: pass    (response_time_sla)
INFO: users.create attempt 1: pass    (assertion: response.body.id is_uuid_v4)
INFO: users.create attempt 1: pass    (assertion: response.body.email equals request.body.email)
INFO: users.create attempt 1: pass    (assertion: response.body.name equals request.body.name)
INFO: users.create attempt 1: pass    (assertion: db.primary_postgres.user_persisted.email equals request.body.email)
INFO: users.create attempt 1: pass    (no_auth_returns_401)      ← if auth_strategy declared
INFO: users.create attempt 1: pass    (garbage_token_returns_401) ← if auth_strategy declared
INFO: users.create attempt 1: pass    (method_not_allowed)
INFO: users.create attempt 1: pass    (malformed_json_returns_400)
INFO: users.create attempt 1: pass    (required_field_omission_returns_400 × 2)
INFO: users.create attempt 1: pass    (type_violation_returns_400 × 2)
INFO: users.create attempt 1: pass    (boundary_battery × 2)
INFO: users.create attempt 1: pass    (db_state_matches_expectation)
INFO: Run summary: planned=1 passed=1 failed=0 ...
```

The **`db_state_matches_expectation` case** is the one that fires
the `db_verify` block. For a write method (POST here), if the query
result doesn't match the expected `fields`, this case fails with
`failure_reason: "db_verify did not satisfy expect mode"`.

---

## Step 4 — Inspect the DB outcome in the report

The JSON report captures the actual DB query result per attempt:

```bash
jq '.endpoints[] | select(.endpoint_id == "users.create")
    | .attempts[].db_verify[]' reports/run-*.json
```

You'll see per-attempt records like:

```json
{
  "connection": "primary_postgres",
  "query_id":   "user_persisted",
  "pass":       true,
  "normalized": {
    "rowCount": 1,
    "rows": [{ "email": "qa-bot+abc@example.com", "name": "QA Bot" }]
  }
}
```

The full returned row is preserved (useful for debugging when
`expect: match` fails — you can see exactly which columns differed).

---

## The four `expect` modes

| Mode | Passes when | Use for |
|---|---|---|
| `exists` | query returns ≥ 1 row | "the row landed" (cheapest assertion) |
| `not_exists` | query returns 0 rows | DELETE verification — "the row is gone" |
| `match` | ≥ 1 row's columns equal `fields` (subset) | most-used; "the row has these specific column values" |
| `exact` | result set equals exactly `fields` (full set equality) | rare; "these are the EXACT rows that should exist" |

---

## **Known limitation — read methods don't gate**

The gating `db_state_matches_expectation` case is **only generated
for write methods** (POST/PUT/PATCH/DELETE).

If you put a `db_verify` block on a GET endpoint:

- The query DOES execute.
- The outcome IS recorded in `attempts[].db_verify[]` with the real
  `pass:` value.
- BUT no gating case is generated.
- So the run reports green even when `db_verify.pass: false`.

**Workaround for GET endpoints**: use the assertion engine to gate
on the DB query result, which DOES fail the run:

```json
"db_verify": [
  {
    "connection": "primary_postgres",
    "query_id":   "lookup",
    "query":      "SELECT count(*) AS n FROM users WHERE org_id = '${response.body.org_id}'",
    "expect":     "exists"
  }
],
"assertions": [
  "db.primary_postgres.lookup.n greater_than 0"
]
```

The `assertion` case DOES gate — it's part of the gating catalog.
See [db-verify.md](../db-verify.md) and
[limitations.md](../limitations.md) for the full story.

---

## Per-driver query notes

### PostgreSQL

Standard SQL. Connection pool managed by the bundled `pg` driver.

```sql
SELECT email FROM users WHERE id = '${response.body.id}'
```

### MySQL

Standard SQL. Backtick-quote identifiers if needed.

```sql
SELECT email FROM `users` WHERE id = '${response.body.id}'
```

### MongoDB

A subset of MongoDB shell syntax: `<collection>.find({...})`,
`<collection>.findOne({...})`, `<collection>.countDocuments({...})`.

```js
users.findOne({ email: "${request.body.email}" })
```

Connection via URI:

```yaml
databases:
  primary_mongo:
    type: mongodb
    uri: ${secret.QA_MONGO_URI}        # mongodb://user:pass@host/db
    database: app
```

### Neo4j

Cypher. Result rows are objects keyed by the RETURN aliases.

```cypher
MATCH (u:User { id: "${response.body.id}" }) RETURN u.email AS email
```

---

## Cleanup strategy

The `cleanup` block on each declaration is best-effort tidy, not a
guarantee of test isolation. For real isolation across many tests:

| Strategy | Use when |
|---|---|
| **Unique IDs per run** (timestamp / UUID suffix in body_example) | Best default — cases never collide, cleanup is optional |
| **Per-test cleanup blocks** | Cheap to add; covers the common case |
| **Per-suite teardown** (truncate tables between runs) | Heavy; for very large suites where uniqueness is impractical |
| **Fresh DB per run** (docker-compose tears down between CI jobs) | Cleanest; CI-only because of cost |

For most cases unique-ID-per-run is enough; for heavier suites
that mutate shared state, a docker-compose-per-CI-job pattern works
well alongside it.

---

## Where to go next

- **[Testing an authenticated API](./authenticated-api.md)** — add
  auth to this endpoint and watch the auth-boundary cases generate
  alongside the db_state case.
- **[CRUD API](./crud-api.md)** — apply `db_verify` to every write
  in the CRUD recipe.
- **[Setting up CI](./setting-up-ci.md)** — wire the DB into CI via
  docker-compose service linking.

Reference:

- **[db-verify.md](../db-verify.md)** — full `db_verify` reference
  including all four `expect` modes, per-driver query syntax, and
  the read-method footgun in detail.
- **[environment-config.md](../environment-config.md)** — the
  `databases:` env block schema.
- **[assertions.md](../assertions.md)** — the
  `db.<connection>.<query_id>.<column>` target path.
