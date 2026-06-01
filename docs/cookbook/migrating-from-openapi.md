# Migrating from an OpenAPI / Swagger spec

You have an existing OpenAPI 3.x or Swagger 2.0 spec. By the end of
this recipe you'll have:

1. Every spec operation as an APIWright `*.endpoint.json` (bulk
   import, ~one command).
2. The imported files validated, runnable, and gaining commodity
   coverage automatically.
3. A clear list of what to hand-augment (Content-Type headers,
   request body examples, db_verify, assertions, auth) — and why.

This is the recommended migration path when you have an OpenAPI /
Swagger spec as your starting point. The lifecycle is **the same** as
the Postman path ([migrating-from-postman.md](./migrating-from-postman.md));
the differences are in what each importer extracts vs. doesn't, and
in the format-specific gotchas.

> **Before you start:** if this is your first import, walk
> [Preparing to import](./preparing-to-import.md) first. Twenty
> minutes of upfront triage catches the issues that take hours to
> reverse-engineer once the import has happened.

---

## What you need first

- APIWright installed.
- An OpenAPI 3.x or Swagger 2.0 spec — `.yaml` or `.json`, local file
  or HTTPS URL.
- The [pre-import checklist](./preparing-to-import.md#the-pre-flight-checklist)
  completed.
- ~30 minutes (longer for large specs >100 operations).

---

## Step 1 — Run the importer

```bash
apiwright import openapi ./spec.yaml --output ./tests
```

`apiwright` auto-detects whether the spec is OpenAPI 3.x or Swagger
2.0 from the spec's header (`openapi: 3.x` or `swagger: "2.0"`). URLs
work too:

```bash
apiwright import openapi https://petstore.swagger.io/v2/swagger.json --output ./tests
```

What you get:

```
tests/
├── pet/                                 ← one folder per spec tag
│   ├── add-pet.endpoint.json
│   ├── update-pet.endpoint.json
│   ├── find-pets-by-status.endpoint.json
│   └── ...
├── store/
│   ├── place-order.endpoint.json
│   ├── get-order-by-id.endpoint.json
│   └── ...
└── user/
    ├── create-user.endpoint.json
    ├── login-user.endpoint.json
    └── ...
```

One `*.endpoint.json` per operation. Folders mirror the spec's
`tags`. Operations without tags land under `default/`.

The console summary tells you the count + any warnings (operations
without examples, security schemes that need env-side setup,
known-limitation notes).

---

## Step 2 — What the importer extracts vs. what it doesn't

Per operation, the importer fills:

| Field | Source in the spec |
|---|---|
| `id` | `<tag>.<operationId>` (lowercased + kebab-cased) |
| `name` | `summary` or `description` |
| `method` | the HTTP verb on the path item |
| `url` | the path (with `{params}` preserved as template variables) |
| `tags` | the operation's `tags` array |
| `request.headers` | `parameters[in=header]` + content-type from `requestBody.content` |
| `request.body_schema` | `requestBody.content[<media-type>].schema` |
| `request.body_example` | `requestBody.content[<media-type>].example` if present; otherwise empty |
| `response.expected_status` | the first `2xx` response key |
| `response.schema` | the matching `responses[<status>].content[<media-type>].schema` |
| `auth_strategy` (referenced by name) | from operation-level or global `security` |

URL path parameters (e.g. `/pets/{petId}`) are **preserved as
templates** in the canonical declaration. You fill in the values at
run time via `${env.*}` substitution, by hand-editing the
declaration after import, or via `${request.body.*}` references if
the parameter mirrors a body field.

What it does NOT extract (because OpenAPI doesn't carry this info):

| Missing field | Why | How to add |
|---|---|---|
| `markers` | Not part of OpenAPI | Hand-add per endpoint (default is `["smoke"]`) |
| `prod_safe` | Not part of OpenAPI | Hand-add `false` for destructive endpoints |
| `db_verify` | Not part of OpenAPI | Hand-add per endpoint that touches a database |
| `assertions` | OpenAPI examples are static, not assertions | Translate the documented invariants into the declarative DSL |
| `sla_ms` | Not part of OpenAPI | Hand-add or rely on env's `default_sla_ms` |
| `auth_strategy` (sometimes) | `security` is read but not always wired (see step 4) | Hand-set; declare in env YAML |

The intent: **import gives you breadth fast; augmentation gives you
depth.** Same as Postman.

---

## Step 3 — First validation pass

```bash
apiwright validate ./tests
```

You may see errors. Common ones from a fresh OpenAPI import:

| Error | Cause | Fix |
|---|---|---|
| `response must be an object with expected_status and schema` | spec operation has no `2xx` response declared | add `"schema": {"type": "object"}` minimum; investigate why the spec is missing this |
| `Unknown auth strategy 'X'` | imported endpoint references an auth strategy not in env YAML | declare the strategy in `environments/<env>.yaml` (see step 4) |
| `${env.X} not declared in environments/qa.yaml` | imported URL contains a templated path parameter | declare `X` in the env YAML or replace with a literal in the endpoint file |
| `body_schema is empty / malformed` | the spec's `requestBody.content[...].schema` is itself broken | fix the source spec OR hand-edit the imported declaration |

Don't fix these one-by-one. First scope the total, then bulk-edit
in your favourite editor or with a one-liner. Most fresh imports
need 3–5 distinct fixes applied across many files.

---

## Step 4 — Set up the environment + auth

The importer references auth strategies by name but can't conjure
the secrets. You declare the strategy in the env YAML:

```yaml
# environments/qa.yaml
name: qa
prod: false

# Base URL — apiwright prepends this to relative endpoint paths.
# Trim any trailing slash to avoid `//` in joined URLs.
base_url: https://petstore.swagger.io/v2

# Default SLA — overridden per endpoint by `response.sla_ms`.
default_sla_ms: 2000

# Path-parameter / body-field values that the import templated as ${env.*}.
# Replace placeholders with real values BEFORE running.
pet_id:   "1"      # a stable test pet ID seeded in the API
order_id: "10"     # a stable test order ID

# Auth strategies — declare every strategy your imported endpoints reference.
# Strategy names come from the spec's `securitySchemes` keys.
auth_strategies:
  api_key:
    type: api_key
    header: api_key
    secret: PETSTORE_API_KEY     # resolved from .env.local at run time

  petstore_auth:
    type: token_endpoint
    url: ${env.base_url}/oauth/token
    credentials:
      grant_type: client_credentials
      client_id: ${secret.PETSTORE_CLIENT_ID}
      client_secret: ${secret.PETSTORE_CLIENT_SECRET}
    token_path: $.access_token
    cache_ttl_seconds: 1800
```

The four supported strategies + their typical OpenAPI source:

| apiwright strategy | OpenAPI `securitySchemes` entry |
|---|---|
| `static_token` | `type: http, scheme: bearer` with a pre-obtained token |
| `token_endpoint` | `type: oauth2` (client_credentials / password flow) |
| `basic_auth` | `type: http, scheme: basic` |
| `api_key` | `type: apiKey, in: header` or `in: query` |

Add an `auth_strategies` block to your env YAML for every name the
imported endpoints reference. The mapping isn't always 1:1 —
sometimes a single OpenAPI `securityScheme` is best implemented as
two apiwright strategies (e.g. one bearer token in QA, another in
staging) under different names.

See [environment-config.md](../environment-config.md) for the full
env YAML reference.

---

## Step 5 — First run (raw imports)

```bash
apiwright run --env qa --markers smoke
```

What you'll see — three buckets:

- **Operations that pass cleanly** — typically the spec's well-defined
  GETs against a working API. The catalog generates the universal
  smoke kinds (`status_code_conformance`, `content_type_alignment`,
  `response_schema_validation`, `auth_happy_path`, `response_time_sla`)
  and each passes.
- **Operations that pass with WARN** — schema sentinel triggered
  because the spec had no response example. See
  [postman-import.md "Empty / sentinel schema"](../postman-import.md#4-empty--sentinel-schema--tighten-or-accept-the-skip-with-warn)
  for the fix (transcribe a real schema).
- **Operations that fail** — most commonly: wrong env value
  (placeholder still in qa.yaml), wrong path parameter (the spec
  said `petId: integer` but you've put a string in env), or auth
  not wired (`auth_strategy` declared but the env strategy name
  doesn't match).

This run is intentionally noisy. Treat the failures as the work
list for steps 6–7.

---

## Step 6 — Augment one operation at a time

Pick the highest-value operation (typically the most-called read or
the most-business-critical write). Open its `*.endpoint.json`.

### Before (raw import)

```json
{
  "id": "pet.find-pets-by-status",
  "name": "Finds Pets by status",
  "method": "GET",
  "url": "/pet/findByStatus?status=${env.pet_status}",
  "tags": ["pet"],
  "request": {},
  "response": {
    "expected_status": 200,
    "schema": { "_pending_review": true }
  },
  "source": {
    "type": "openapi",
    "spec": "spec.yaml",
    "operation_id": "findPetsByStatus"
  }
}
```

### After (augmented)

```json
{
  "id": "pet.find-pets-by-status",
  "name": "Finds Pets by status",
  "method": "GET",
  "url": "/pet/findByStatus?status=${env.pet_status}",
  "tags": ["pet", "read", "smoke"],
  "markers": ["smoke", "regression"],
  "prod_safe": true,
  "auth_strategy": "api_key",
  "request": {
    "headers": { "Accept": "application/json" }
  },
  "response": {
    "expected_status": 200,
    "sla_ms": 1500,
    "schema": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "name", "status"],
        "properties": {
          "id":     { "type": "integer" },
          "name":   { "type": "string" },
          "status": { "type": "string", "enum": ["available", "pending", "sold"] },
          "tags":   { "type": "array" }
        }
      }
    }
  },
  "assertions": [
    "response.body[0].status equals ${env.pet_status}",
    "response.body length greater_than 0"
  ]
}
```

What augmentation unlocks:

- The 5 universal cases now run with real signal: schema validation
  catches drift, status / content-type / SLA are pinned.
- The `assertions[]` block adds two declarative checks per
  endpoint that the catalog evaluates as additional smoke cases.
- `prod_safe: true` declares the endpoint can safely run against
  production envs.
- `tags + markers` make filter-by-tag and filter-by-marker work
  cleanly in CI (`--markers regression --tag read`).

For a write endpoint, also add `db_verify` (see
[db-side-effects](./db-side-effects.md)) and `request.body_example`
so the body-mutator cases (`malformed_json_returns_400`,
`type_violation_returns_400`, `required_field_omission_returns_400`,
`boundary_battery`) get generated.

---

## Step 7 — Translate spec examples into declarative assertions

OpenAPI specs often carry examples that imply invariants —
"`status` is always one of three enum values", "`id` echoes the
created resource's id", "list responses contain at least one item".
APIWright's `assertions[]` block expresses these declaratively (see
[assertions.md](../assertions.md) for the full operator catalogue).

| Spec hint | apiwright assertion |
|---|---|
| Enum on a response field | `response.body.status in ["available","pending","sold"]` |
| Example shows id echoing back | `response.body.id equals request.body.id` |
| Example shows a non-empty list | `response.body length greater_than 0` |
| Example shows a UUID | `response.body.id matches "^[0-9a-f]{8}-[0-9a-f]{4}-..."` |
| Description says "returns 201 with Location header" | `response.headers.Location is_not_null` |

Most documented invariants translate cleanly. Things that don't:

- Conditional invariants (`if response.status == 'pending' then ...`) —
  split into two endpoints (one per condition) or move to hand-written
  integration tests.
- Multi-step business rules (the first call sets state, the second
  validates it) — flow tests, not apiwright.
- Invariants that require a DB lookup — express as `db_verify`
  instead of `assertions`.

---

## Step 8 — Migration patterns

| OpenAPI / Swagger concept | apiwright equivalent |
|---|---|
| `servers[0].url` | env-level `base_url` |
| `parameters[in=query]` | hand-augmented into the URL or `request.query_params` |
| `parameters[in=path]` (`{petId}`) | URL template — value from `${env.*}` or hand-replaced |
| `parameters[in=header]` | `request.headers` (imported automatically) |
| `requestBody.content.application/json.schema` | `request.body_schema` (imported automatically) |
| `requestBody.content.application/json.example` | `request.body_example` (imported automatically) |
| `responses.200.content.application/json.schema` | `response.schema` (imported automatically) |
| `securitySchemes.bearer + global security` | env's `auth_strategies` (declare separately) |
| `tags: [pet]` | `tags: ["pet"]` in the endpoint file |
| `operationId: findPetsByStatus` | `id: <tag>.find-pets-by-status` (lowercased + kebab) |
| `description` text | manual translation into `assertions[]` where it implies invariants |
| `deprecated: true` | not auto-imported — review and either delete or mark with a custom tag |

---

## Known limitations of the importer

These are real gaps documented in
[openapi-import.md](../openapi-import.md#known-limitations) — call
them out for your team upfront:

- **Content-Type missing on body operations** — the importer reads
  `consumes` (Swagger 2.0) or `requestBody.content` (OpenAPI 3.x)
  but occasionally misses setting the `Content-Type` request
  header. Hand-add `"headers": {"Content-Type": "application/json"}`
  where needed.
- **`body_example` not seeded** when the spec declares a body
  `schema` but no `example`. Without `body_example`, the body-mutator
  test kinds cannot be generated. Hand-add an example.
- **`api_key` auth strategy needs explicit env entry** — the
  importer references the strategy but doesn't add it to the env
  YAML's `auth_strategies` block.
- **Query-parameter API keys** (`securitySchemes.apiKey.in: query`)
  need a manual URL template — the importer doesn't auto-append the
  key as a query param.
- **OpenAPI 3.1 union types** (`type: [string, "null"]`) may need
  flattening for some validators.
- **`oneOf` / `anyOf` / `allOf` in response schemas** — supported by
  the schema validator but can be surprising; verify the resulting
  validation behaviour against a known-good response.

If any other quirks bite, open an issue — these are the kind of
things only real-world specs surface.

---

## Migration order — what to tackle first

1. **Run validate immediately after import.** Get a clean
   error-free baseline before adding anything.
2. **Run smoke against the live API.** See what passes as-is — for
   well-specified APIs, expect 40–60% of reads to pass without
   further work.
3. **Augment 5–10 most-critical operations first.** Add `body_example`,
   tighten `response.schema`, add `db_verify`, key assertions, and
   set `markers` + `tags`.
4. **Wire every auth strategy in env YAML.** Run again; auth happy-path
   cases should now pass for authenticated endpoints.
5. **Tag-first ordering.** OpenAPI tags map directly to subfolders.
   Migrate one tag at a time (`/tests/pet/`, then `/tests/store/`,
   then `/tests/user/`) — gives clean PRs and clean filter scoping
   (`--tag pet` runs just that domain).
6. **Iterate.** Each newly-augmented endpoint unlocks 5–20 new
   generated cases. Run, inspect, fix bugs the catalog surfaces.

A typical mid-sized OpenAPI spec (50–100 operations) migrates to a
useful APIWright suite in a few days of focused work, with the
first end-to-end run happening in the first hour.

---

## Where to go next

- **[CRUD API](./crud-api.md)** — see what a hand-authored
  declaration looks like (helpful when augmenting imports).
- **[Authenticated API](./authenticated-api.md)** — set up the env's
  `auth_strategies` block in depth.
- **[DB side effects](./db-side-effects.md)** — add `db_verify` to
  imported write endpoints.
- **[Setting up CI](./setting-up-ci.md)** — wire the imported +
  augmented suite into your pipeline.

Reference:

- **[openapi-import.md](../openapi-import.md)** — every importer
  flag, every supported OpenAPI / Swagger feature, every known
  limitation.
- **[postman-import.md](../postman-import.md)** — same recipe but
  for Postman v2.1 collections, plus the 5 post-import fixup
  recipes (most apply to OpenAPI too).
- **[preparing-to-import.md](./preparing-to-import.md)** — the
  pre-import readiness checklist (run this BEFORE your next
  import).
