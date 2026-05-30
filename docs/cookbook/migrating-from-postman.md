# Migrating from a Postman collection

You have an existing Postman v2.1 collection. By the end of this
recipe you'll have:

1. Every Postman request as an APIWright `*.endpoint.json` (bulk
   import, ~one command).
2. The imported files validated, runnable, and gaining commodity
   coverage automatically.
3. A clear list of what to hand-augment (response schemas, db_verify,
   assertions, auth) — and why.

This is the recommended migration path when you're already invested
in Postman.

---

## What you need first

- APIWright installed.
- A `.postman_collection.json` export of your existing collection
  (Postman → Collection → Export → v2.1).
- ~30 minutes (longer for big collections).

---

## Step 1 — Run the importer

```bash
apiwright import postman ./my-collection.postman_collection.json \
  --output ./tests
```

What you get:

```
tests/
├── auth/                           ← one folder per Postman folder
│   ├── login.endpoint.json
│   └── refresh.endpoint.json
├── users/
│   ├── create-user.endpoint.json
│   ├── list-users.endpoint.json
│   └── get-user.endpoint.json
└── orders/
    └── ...
```

One `*.endpoint.json` per Postman request. Folders mirror the
collection's folder hierarchy. Console summary tells you the count
plus any warnings (e.g. requests with auth strategies that need
env-side setup).

---

## Step 2 — What the importer extracts vs. what it doesn't

Per request, the importer fills:

| Field | Source |
|---|---|
| `id` | `<folder>.<request-name>` (lowercase + kebab-cased) |
| `name` | request `name` from Postman |
| `method` | HTTP verb |
| `url` | path component of the URL (host stripped — comes from env's `base_url`) |
| `tags` | derived from folder name |
| `request.headers` | from request `header[]` |
| `request.body_example` | from request `body.raw` (if present and JSON) |
| `auth_strategy` (referenced by name) | from request-level or collection-level `auth` block |

What it does NOT extract (because Postman collections don't carry
this info):

| Missing field | Why | How to add |
|---|---|---|
| `request.body_schema` | Postman has examples, not schemas | Hand-add a JSON Schema |
| `response.schema` | same | Hand-add |
| `db_verify` | Not part of Postman | Hand-add per endpoint that touches a DB |
| `assertions` | Postman tests are JS code, not declarative | Translate the test code into the declarative DSL |
| `markers` | Not part of Postman | Hand-add (default is `["smoke"]`) |
| `prod_safe` | Not part of Postman | Hand-add `false` for destructive endpoints |
| `sla_ms` | Not part of Postman | Hand-add or rely on env's `default_sla_ms` |

The intent: **import gives you breadth fast; augmentation gives you
depth.**

---

## Step 3 — First validation pass

```bash
apiwright validate ./tests
```

You may see errors. Common ones from a fresh import:

| Error | Cause | Fix |
|---|---|---|
| `response must be an object with expected_status and schema` | imported file lacks `response.schema` | add `"schema": {"type": "object"}` minimum |
| `Unknown auth strategy 'X'` | the imported endpoint references an auth strategy not in the env YAML | declare the strategy in `environments/<env>.yaml` (see step 4) |

Don't fix these one by one — first scope the work, then bulk-edit
in your favourite editor or with a one-liner.

---

## Step 4 — Set up the environment + auth

The importer references auth strategies by name but can't conjure
the secrets. You declare the strategy in the env YAML:

```yaml
# environments/qa.yaml
name: qa
prod: false
base_url: https://qa.api.example.com
default_sla_ms: 5000

auth_strategies:
  bearer:                        # the name your imported requests reference
    type: static_token
    token: ${secret.QA_API_TOKEN}
    header: Authorization
    header_value: Bearer ${token}
```

Export the env var:

```bash
export QA_API_TOKEN=...
```

---

## Step 5 — First run (raw imports)

```bash
apiwright run --env qa --markers smoke
```

What you'll see — a mix of:

- ✅ **Imports that work as-is** — typically read endpoints (GETs)
  where the response shape is straightforward.
- ❌ **Imports that fail on schema** — because the imported files
  default to `{type: object}` which catches almost nothing, you'll
  see `response_schema_validation` pass on garbage. To get real
  schema coverage, you need to tighten them (next step).
- ⚠️ **Auth-related fails** — `no_auth_returns_401` and
  `garbage_token_returns_401` cases will surface real auth-boundary
  bugs you may not have known about. These are valuable; investigate.

This honest baseline is the "import gives you breadth" payoff. The
suite runs end-to-end immediately; you now know which endpoints
need attention vs. which work out of the box.

---

## Step 6 — Augment one endpoint at a time

For each endpoint that matters (start with the highest-traffic
ones), open its `.endpoint.json` and add what the importer couldn't
infer:

### Before (raw import)

```json
{
  "id": "users.create-user",
  "name": "Create User",
  "method": "POST",
  "url": "/users",
  "request": {
    "headers": { "Content-Type": "application/json" },
    "body_example": { "email": "test@example.com", "name": "Test" }
  },
  "response": { "expected_status": 200, "schema": { "type": "object" } }
}
```

### After (augmented)

```json
{
  "id": "users.create-user",
  "name": "POST /users — create user",
  "method": "POST",
  "url": "/users",
  "tags": ["users", "write"],
  "markers": ["regression"],
  "prod_safe": false,
  "auth_strategy": "bearer",
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
    "body_example": { "email": "qa-bot@example.com", "name": "QA Bot" }
  },
  "response": {
    "expected_status": 201,
    "sla_ms": 2000,
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
      "query_id":   "user_row",
      "query":      "SELECT email FROM users WHERE id = '${response.body.id}'",
      "expect":     "match",
      "fields":     { "email": "${request.body.email}" }
    }
  ],
  "assertions": [
    "response.body.id is_uuid_v4",
    "response.body.email equals request.body.email",
    "db.primary_postgres.user_row.email equals request.body.email"
  ]
}
```

Each addition unlocks new cases the catalog auto-generates:

| Field added | Cases gained |
|---|---|
| `body_schema.required` × N | N `required_field_omission_returns_400` cases |
| `body_schema.properties.<typed>` × N | N `type_violation_returns_400` cases |
| `minLength`/`maxLength`/`minimum`/`maximum`/`enum` × N | ~2N `boundary_battery` cases |
| `auth_strategy: X` | `auth_happy_path`, `no_auth_returns_401`, `garbage_token_returns_401` |
| `db_verify` (write method) | `db_state_matches_expectation` |
| `assertions[]` entries | One `assertion` case per entry |

Going from 2 cases to 20+ for one endpoint takes ~15-30 minutes of
augmentation. Multiply across endpoints; prioritise the high-traffic
ones first.

---

## Step 7 — Translate Postman tests into declarative assertions

Postman tests are JavaScript:

```js
pm.test("Status is 201", function () {
  pm.response.to.have.status(201);
});

pm.test("Body has user id", function () {
  const j = pm.response.json();
  pm.expect(j.id).to.be.a('string');
  pm.expect(j.email).to.equal(pm.request.body.raw.email);  // simplified
});
```

In APIWright's declarative DSL:

```json
"response": { "expected_status": 201, ... },     // ← `Status is 201` — covered by status_code_conformance
"assertions": [
  "response.body.id is_uuid_v4",                  // ← stronger than "is_a string"
  "response.body.email equals request.body.email" // ← cross-target equality
]
```

Most Postman tests translate cleanly. Things that don't:

- Conditional logic (`if (j.status === 'pending') ...`) — write as
  separate endpoints or move to a hand-rolled integration test.
- Multi-request flows (set var in test 1, use in test 2) — v1.0
  doesn't support; deferred to v1.5. Keep these as Postman /
  Newman or migrate to your existing integration suite.
- Tests that call out to external services — same; not the kind of
  thing APIWright is for.

---

## Step 8 — Migration patterns

| Postman concept | APIWright equivalent |
|---|---|
| Environment variable `{{base_url}}` | `${env.base_url}` in declaration / env-level `base_url` |
| Pre-request script setting a var | Not supported in v1.0; pre-stage in env YAML or move to integration test |
| Collection variables | env YAML fields (`name`, `base_url`, custom `${...}` references) |
| Folder | Subdirectory under `tests/` |
| Auth at collection level | `auth_strategies` in env YAML; per-endpoint `auth_strategy` reference |
| `pm.test(...)` | `assertions[]` entry |
| `pm.response.to.have.status(N)` | `response.expected_status: N` |
| `pm.expect(j.x).to.equal(v)` | `response.body.x equals v` |
| `pm.expect(j.x).to.be.a('string')` | `response.body.x is_not_null` + `response.schema` with type |
| `pm.collectionVariables.set('id', j.id)` for next request | Not supported v1.0 (multi-step) |

---

## Known limitations of the importer

These are real gaps documented in
[limitations.md](../limitations.md):

- **Swagger 2.0 body endpoints miss `Content-Type: application/json`** —
  the importer reads `consumes` but doesn't always set the request
  header. Hand-add when needed.
- **No request `body_example` is seeded** from Postman's `body.raw`
  in some shapes — re-paste from the collection if the import didn't
  catch it.
- **Auth references but doesn't scaffold** — referenced strategies
  must exist in the env YAML's `auth_strategies` block; the importer
  doesn't add them.

Fix list-style — known and tracked. Open an issue if any other
quirks bite.

---

## Migration order — what to tackle first

1. **Run validate immediately after import.** Get a clean error-free
   baseline before adding anything.
2. **Run smoke against the live API.** See what works as-is —
   typically 30-50 % of imported reads will pass without further
   work.
3. **Augment 5-10 most-critical endpoints first.** Add real
   `body_schema`, `response.schema`, `db_verify`, key assertions.
4. **Add `auth_strategies` to the env YAML** for any auth-tagged
   imports.
5. **Add tags + markers** to the imports so you can filter cleanly
   (smoke vs regression, write vs read).
6. **Iterate.** Each newly-augmented endpoint unlocks 5-20 new
   generated cases. Run, inspect, fix bugs the catalog surfaces.

A typical mid-sized Postman collection (50-150 requests) migrates to
a useful APIWright suite in a few days of focused work, with the
first end-to-end run happening in the first hour.

---

## Where to go next

- **[CRUD API](./crud-api.md)** — see what a hand-authored
  declaration looks like (helpful when augmenting imports).
- **[Authenticated API](./authenticated-api.md)** — set up the env's
  `auth_strategies` block.
- **[DB side effects](./db-side-effects.md)** — add `db_verify` to
  imported write endpoints.

Reference:

- **[postman-import.md](../postman-import.md)** — every importer flag,
  every supported Postman feature, every known limitation.
- **[openapi-import.md](../openapi-import.md)** — same recipe but
  for OpenAPI 3.x / Swagger 2.0 specs.
