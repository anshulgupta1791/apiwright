# OpenAPI / Swagger import

> **First time importing?** Walk
> [Preparing to import](./cookbook/preparing-to-import.md) first. Twenty
> minutes of upfront triage on the spec catches the issues that take hours
> to reverse-engineer once the import has happened. Then come back here for
> the importer's behaviour reference, or jump straight to
> [Migrating from OpenAPI](./cookbook/migrating-from-openapi.md) for the
> step-by-step walkthrough.

`apiwright import openapi <spec>` reads an OpenAPI 3.x or Swagger 2.0
spec and emits one `*.endpoint.json` per operation. The output is
ready for `apiwright validate` and (after augmentation) `apiwright
run`. See [postman-import.md](./postman-import.md) for the
Postman v2.1 importer; the lifecycle is identical.

---

## Quick start

```bash
apiwright import openapi ./spec.yaml --output ./tests
```

What you get:

```
tests/
  pet/                      ← one folder per OpenAPI tag (or "default/")
    add-pet.endpoint.json
    update-pet.endpoint.json
    find-pets-by-status.endpoint.json
    ...
  store/
    place-order.endpoint.json
    get-order-by-id.endpoint.json
    ...
  user/
    create-user.endpoint.json
    login-user.endpoint.json
    ...
```

One file per operation. Folder layout mirrors the spec's `tags`.

---

## Supported spec versions

Both OpenAPI 3.x and Swagger 2.0 are handled by the same `import
openapi` command — the importer auto-detects the version from the
spec's `openapi: 3.x` / `swagger: "2.0"` header.

| Spec version | File extension | Auto-detected | Notes |
|---|---|---|---|
| OpenAPI 3.0.x | `.yaml` / `.json` | ✅ | Full coverage |
| OpenAPI 3.1.x | `.yaml` / `.json` | ✅ | Full coverage |
| Swagger 2.0 | `.yaml` / `.json` | ✅ | Full coverage; `consumes`/`produces` mapped to request/response content types |

The importer also accepts URLs (`apiwright import openapi
https://example.com/spec.yaml`) — the spec is fetched once,
cached locally, and parsed.

---

## What gets extracted

For every operation in the spec, the importer fills out:

| Endpoint field | Source |
|---|---|
| `id` | `<tag>.<operationId>` (lowercased + kebab-cased) |
| `name` | `summary` or `description` |
| `method` | the HTTP verb on the path item |
| `url` | the path (with `{params}` preserved) |
| `tags` | the operation's `tags` array |
| `request.headers` | extracted from `parameters[in=header]` + content-type from `requestBody.content` |
| `request.body_schema` | `requestBody.content[<media-type>].schema` |
| `request.body_example` | `requestBody.content[<media-type>].example` if present; otherwise empty |
| `response.expected_status` | the first `2xx` response key |
| `response.schema` | the matching `responses[<status>].content[<media-type>].schema` |

URL path parameters (e.g. `/pets/{petId}`) are preserved as
templates — you fill in the values via `${request.body.id}` or by
hand-editing the declaration after import.

---

## What does NOT get inferred

The importer extracts what's IN the spec. It does NOT invent fields
the spec doesn't carry:

| What | Why missing | How to add |
|---|---|---|
| `markers` | Not part of OpenAPI | Hand-add per endpoint (defaults to `smoke`) |
| `prod_safe` | Not part of OpenAPI | Hand-add for destructive endpoints |
| `db_verify` | Not part of OpenAPI | Hand-add per endpoint that touches a database |
| `assertions` | Not part of OpenAPI | Hand-add business-logic checks |
| `sla_ms` | Not part of OpenAPI | Hand-add or rely on env-level `default_sla_ms` |
| `auth_strategy` | Inferred from `security` schemes but not always wired (see Known limitations) | Hand-add or fix the import |

The intended flow: **import gives you breadth fast; augmentation gives
you depth.**

---

## Augmenting an imported declaration

A typical post-import workflow:

1. **Run `apiwright validate ./tests`** — confirms the import is
   structurally well-formed.
2. **Run `apiwright run --env qa --markers smoke`** — see which
   imported endpoints pass against your live API and which need
   adjustment.
3. **For endpoints that need richer testing**, hand-edit the file to
   add:
   - tighter request body schemas (the spec's `body_schema` might
     have been loose)
   - response schemas if missing
   - `db_verify` blocks for write endpoints with DB side effects
   - `assertions` for business-logic checks
   - `auth_strategy` reference if the security scheme didn't import
     cleanly

The classic Petstore Swagger 2.0 spec is a good fixture to verify
the same pipeline end-to-end against.

---

## Authentication

The importer reads the spec's `securitySchemes` (OpenAPI 3.x) or
`securityDefinitions` (Swagger 2.0) and emits matching `auth_strategy`
references on each protected endpoint:

| Spec scheme | Maps to APIWright |
|---|---|
| `http` + `bearer` | `auth_strategy: bearer` referencing a `static_token` strategy in the env |
| `apiKey` (in: header) | `auth_strategy: api_key` referencing a `static_token` strategy |
| `oauth2` (clientCredentials) | `auth_strategy: oauth2_client` referencing a `token_endpoint` strategy |

**You still need to declare the matching strategy in the environment
YAML** — the importer references it by name but can't conjure the
secret values:

```yaml
# environments/qa.yaml
auth_strategies:
  bearer:                          # the name the imported decls reference
    type: static_token
    token: ${secret.QA_API_TOKEN}  # you provide the secret env var
    header: Authorization
    header_value: Bearer ${token}
```

---

## Known limitations

These are real gaps surfaced during dogfooding against published
OpenAPI specs in the wild:

### Content-Type missing on body operations

Swagger 2.0 body operations that declare `consumes:
[application/json]` import with `headers: null` instead of
`Content-Type: application/json`. Running them produces **415
Unsupported Media Type** for every write. The fix is hand-adding the
header to the imported declaration:

```json
"request": {
  "headers": { "Content-Type": "application/json" },
  "body_schema": { ... }
}
```

Fix tracked; will be addressed in a patch release.

### `body_example` not seeded

The importer doesn't populate `request.body_example` from the spec's
`example` field today. Without an example, several catalog
generators (`malformed_json_returns_400`, `boundary_battery` for body
fields) don't fire because they need a baseline to mutate. Hand-add
an example body matching the schema.

### `api_key` auth strategy needs env entry

Imported `auth_strategy: api_key` endpoints abort with `"Unknown
auth strategy 'api_key'. Known: []"` if the env's `auth_strategies:`
block doesn't define a matching `api_key` entry. The importer
references the strategy but doesn't scaffold it. Add the entry
yourself (see "Authentication" above).

### Query-parameter API keys

APIs that authenticate via a query parameter (`?appid=<key>`) — like
OpenWeather — are not supported in v1.0. The auth strategies are
header-only. Workaround: bake the key into the URL template via
`${secret.X}` and accept that the secret appears in the request URL
(which IS redacted in reports, but only if registered through the
env loader's secret pipeline — see
[environment-config.md](./environment-config.md)).

---

## End-to-end example

```bash
# 1. Import the Petstore Swagger 2.0 spec from the swagger.io URL:
apiwright import openapi https://petstore.swagger.io/v2/swagger.json \
  --output ./tests

# Imported 20 operations into ./tests/{pet,store,user}/

# 2. Sanity-check that the output is structurally valid:
apiwright validate ./tests
# ✓ 20 endpoints validated.

# 3. Add the environment that points at the live API:
cat > ./environments/petstore.yaml <<'YAML'
name: petstore
prod: false
base_url: https://petstore.swagger.io/v2
default_sla_ms: 5000
YAML

# 4. Run smoke against the live API to see what's working:
apiwright run --env petstore --markers smoke --reports-dir ./reports

# 5. Inspect failures; hand-augment declarations that need
#    Content-Type headers, body_examples, auth, db_verify, assertions.

# 6. Re-run to verify:
apiwright run --env petstore --markers smoke,regression
```

The honest expectation: a blind import of a real-world public spec
gives you breadth (every endpoint at least called) plus a precise
punch-list of what to augment, NOT zero-work-to-green coverage.

---

## See also

- [postman-import.md](./postman-import.md) — the same flow for Postman
  v2.1 collections.
- [canonical-model.md](./canonical-model.md) — the schema imported
  files conform to.
- [environment-config.md](./environment-config.md) — declaring the
  `auth_strategies` referenced by imported endpoints.
- [limitations.md](./limitations.md) — what the importer cannot do
  (e.g. GraphQL, gRPC).
