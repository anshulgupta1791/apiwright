# Database state verification (`db_verify`)

`db_verify` runs SQL / Cypher / Mongo queries against your database
**after** the request lands, to confirm the side effect actually
happened. It's the difference between "the API returned 200" and "the
API returned 200 AND the row is in the database."

Supported drivers ship with APIWright — no separate install:

- **PostgreSQL** (`pg`)
- **MySQL** (`mysql2`)
- **MongoDB** (`mongodb`)
- **Neo4j** (`neo4j-driver`)

---

## Quick example — PostgreSQL after a POST

```json
{
  "id": "users.create",
  "method": "POST",
  "url": "/api/v1/users",
  "tags": ["users", "write"],
  "markers": ["regression"],
  "request": {
    "headers": { "Content-Type": "application/json" },
    "body_example": { "email": "qa@example.com", "name": "QA Bot" }
  },
  "response": { "expected_status": 201, "schema": { "type": "object" } },
  "db_verify": [
    {
      "connection": "primary_postgres",
      "query_id": "user_persisted",
      "query": "SELECT email, name FROM users WHERE email = '${request.body.email}'",
      "expect": "match",
      "fields": {
        "email": "${request.body.email}",
        "name": "${request.body.name}"
      }
    }
  ]
}
```

What APIWright does after this endpoint's request lands:

1. Reads `connection: primary_postgres` and looks up the connection in
   the environment YAML's `databases:` block.
2. Resolves `${request.body.email}` → the actual email sent in the
   request.
3. Runs the query against the configured Postgres.
4. Asserts the result satisfies `expect: match` with the resolved
   `fields`.
5. Records the outcome in the run report's `attempts[].db_verify[]`.

If the row is missing, or its columns don't match, the test fails with
`failure_reason: "db_verify did not satisfy expect mode"`.

---

## Where to declare a connection

In your `environments/<env>.yaml` under the top-level `databases:` block:

```yaml
name: qa
prod: false
base_url: https://qa-api.example.com
default_sla_ms: 2000

databases:
  primary_postgres:
    type: postgres
    host: ${secret.QA_PG_HOST}
    port: 5432
    database: app
    user: ${secret.QA_PG_USER}
    password: ${secret.QA_PG_PASSWORD}

  primary_mongo:
    type: mongodb
    uri: ${secret.QA_MONGO_URI}
    database: app

  primary_neo4j:
    type: neo4j
    uri: ${secret.QA_NEO4J_URI}
    user: ${secret.QA_NEO4J_USER}
    password: ${secret.QA_NEO4J_PASSWORD}
    database: app

  primary_mysql:
    type: mysql
    host: ${secret.QA_MYSQL_HOST}
    port: 3306
    database: app
    user: ${secret.QA_MYSQL_USER}
    password: ${secret.QA_MYSQL_PASSWORD}
```

`${secret.X}` resolves from `process.env` and is redacted in every
output artifact.

Connections are pooled and reused across cases in one run — no
per-case overhead.

---

## The `db_verify` block on a declaration

```jsonc
"db_verify": [
  {
    "connection": "primary_postgres",        // must match an env key
    "query_id":   "user_persisted",          // optional, lets assertions reference results
    "query":      "SELECT ... FROM ... WHERE ... = '${request.body.id}'",
    "expect":     "exists" | "not_exists" | "match" | "exact",
    "fields":     { /* required for match/exact, ignored otherwise */ }
  }
]
```

- `connection` (required) — name in the env's `databases:` block.
- `query_id` (optional) — short identifier; lets `assertions` reach the
  query result via `db.<connection>.<query_id>.<column>`.
- `query` (required) — the SQL / Cypher / Mongo expression. Strings
  inside the query are templated; see "templating" below.
- `expect` (required) — one of the four modes (next section).
- `fields` (required for `match` and `exact`) — column → expected value
  map. Values are templated.

You can declare multiple `db_verify` entries on one endpoint (runs in
order, all must pass for the gating case to pass).

---

## The four expect modes

| Mode | Passes when |
|---|---|
| `exists` | the query returns ≥ 1 row |
| `not_exists` | the query returns 0 rows |
| `match` | the query returns ≥ 1 row AND at least one row's columns equal every entry in `fields` (subset match) |
| `exact` | the query returns exactly the rows listed in `fields` (set equality on the projected columns) |

### `exists` — "the row landed"

```json
{
  "connection": "primary_postgres",
  "query": "SELECT id FROM users WHERE id = '${response.body.id}'",
  "expect": "exists"
}
```

### `not_exists` — "the row is gone" (DELETE verification)

```json
{
  "connection": "primary_postgres",
  "query": "SELECT id FROM users WHERE id = '${request.body.id}'",
  "expect": "not_exists"
}
```

### `match` — "the row landed AND has these column values"

```json
{
  "connection": "primary_postgres",
  "query": "SELECT name, email FROM users WHERE id = '${response.body.id}'",
  "expect": "match",
  "fields": {
    "name": "${request.body.name}",
    "email": "${request.body.email}"
  }
}
```

Most-used mode. `match` is a subset check: extra columns in the row
don't fail it, missing/wrong values do.

### `exact` — "the result set is exactly this"

```json
{
  "connection": "primary_postgres",
  "query": "SELECT email FROM users WHERE org_id = '${response.body.org_id}' ORDER BY email",
  "expect": "exact",
  "fields": [
    { "email": "alice@example.com" },
    { "email": "bob@example.com" }
  ]
}
```

Strict equality on the projected rows. Use sparingly — easy to over-
constrain.

---

## Templating in queries and fields

Inside `query` and `fields` strings, you can reference values from the
request and response via the same target path grammar used by
assertions:

| Reference | Resolves to |
|---|---|
| `${request.body.<path>}` | a value from the request body |
| `${request.headers.<name>}` | a value from a request header |
| `${response.body.<path>}` | a value from the response body |
| `${secret.<NAME>}` | a value from `process.env` (redacted in output) |

References are quoted as SQL string literals by default (`'${response.body.id}'`).
For non-string types (integers, JSON columns), APIWright respects the
quoting in your query string — if you write the reference inside
single quotes it's treated as a string literal; if you write it bare,
it's interpolated as a number / JSON.

---

## Cross-referencing query results in assertions

Give the query a `query_id`, then reach the result from an `assertions`
entry via the `db.<connection>.<query_id>.<column>` target path:

```json
{
  "db_verify": [
    {
      "connection": "primary_postgres",
      "query_id": "row_check",
      "query": "SELECT email, status FROM users WHERE id = '${response.body.id}'",
      "expect": "exists"
    }
  ],
  "assertions": [
    "db.primary_postgres.row_check.email equals request.body.email",
    "db.primary_postgres.row_check.status equals \"active\""
  ]
}
```

Especially useful when you want to assert relationships across columns
that aren't a clean `match` (e.g. "the response.body.created_at and the
row.created_at are within 1 second of each other" — write the query,
then assert on `db.<conn>.<qid>.created_at`).

---

## `cleanup` blocks

Same connector machinery, runs AFTER the test regardless of
pass/fail. Use to roll back side effects:

```json
"cleanup": {
  "connection": "primary_postgres",
  "query": "DELETE FROM users WHERE email = '${request.body.email}'"
}
```

Failures in cleanup are surfaced separately from the test outcome
(the test can pass with a cleanup warning). The intent is "best-effort
tidy" — your test isolation strategy still depends on either fresh
fixtures per run or a database wipe between runs for hard guarantees.

---

## **Known limitation — gating on read methods**

`db_verify` gating only fires for **write methods** (POST / PUT /
PATCH / DELETE).

For a GET endpoint with a `db_verify` block:

- The query DOES execute.
- The outcome IS recorded in the report's `attempts[].db_verify[]`
  with `pass: false` (or `true`) reflecting the real result.
- BUT no `db_state_matches_expectation` gating case is generated.
- So the run reports green even when `db_verify.pass: false`.

This is a real defect (see [limitations.md](./limitations.md)). The
workaround:

**Don't rely on `db_verify` for GET endpoints.** If you need to assert
on DB state after a GET, use the assertion engine instead:

```json
"db_verify": [
  {
    "connection": "primary_postgres",
    "query_id": "lookup",
    "query": "SELECT count(*) AS n FROM users WHERE org_id = '${response.body.org_id}'",
    "expect": "exists"
  }
],
"assertions": [
  "db.primary_postgres.lookup.n greater_than 0"
]
```

The assertion-engine path DOES gate the verdict — the `assertion` case
fails when the database query result doesn't satisfy the assertion.

---

## Per-driver query notes

### PostgreSQL

Standard PostgreSQL syntax. Connection pool managed by `pg`.

```sql
SELECT email FROM users WHERE id = '${response.body.id}'
```

### MySQL

Standard MySQL syntax. Backtick-quote identifiers if needed.

```sql
SELECT email FROM `users` WHERE id = '${response.body.id}'
```

### MongoDB

A subset of MongoDB shell syntax: `<collection>.find({...})`,
`<collection>.findOne({...})`, `<collection>.countDocuments({...})`.
The expression is evaluated server-side via the `mongodb` driver.

```js
users.findOne({ email: "${request.body.email}" })
```

### Neo4j

Cypher. Result rows are objects keyed by the RETURN aliases.

```cypher
MATCH (u:User { id: "${response.body.id}" }) RETURN u.email AS email
```

---

## Performance

- Connections are pooled and reused across the entire run.
- Each `db_verify` query is one round-trip; no batching.
- For 500 endpoints × 1 db_verify each → ~500 round-trips, parallelised
  across `workers` (default 4). Typically adds < 5s to a run.

---

## Common errors

**"connection 'primary_postgres' not found"** — the `connection` name
on your declaration doesn't match any key in the environment's
`databases:` block. Check spelling.

**"ECONNREFUSED"** — the database isn't reachable from where APIWright
is running. Check host / port / firewalls. For docker-compose setups,
remember to use the in-network hostname (not `localhost`) when both
APIWright and the database run as services.

**"db_verify did not satisfy expect mode"** — the gating case fired
and the query's result didn't satisfy the `expect`. The report has the
returned rows under `attempts[].db_verify[].normalized.rows` —
inspect to see why.

---

## See also

- [environment-config.md](./environment-config.md) — the `databases:`
  block schema and secret resolution.
- [assertions.md](./assertions.md) — the `db.<connection>.<query_id>.*`
  target path.
- [test-catalog.md](./test-catalog.md) — the `db_state_matches_expectation`
  case in the broader catalog.
