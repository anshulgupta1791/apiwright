# Preparing to import — readiness checklist before `apiwright import`

You have a Postman collection, or an OpenAPI / Swagger spec, and you're
about to run `apiwright import`. Stop. Twenty minutes of triage here
saves hours of post-import rework — the kind of rework documented in
[`postman-import.md`'s "What is NOT imported"](../postman-import.md#what-is-not-imported-and-the-post-import-fixup-recipe)
and [`openapi-import.md`'s "Known limitations"](../openapi-import.md#known-limitations).

This guide is format-agnostic. The triage steps apply equally to
Postman v2.1 collections and OpenAPI 3.x / Swagger 2.0 specs; we call
out format-specific gotchas inline.

---

## What you'll have when you're done

- A clear count of what will import cleanly, what will need hand
  augmentation, and what doesn't belong in apiwright at all.
- An env YAML scaffold ready before you run the importer.
- An explicit decision per stateful operation: does it run in
  apiwright (commodity HTTP cases) or in your flow-test layer
  (response chaining, ordered state)?
- A pre-flight checklist you can re-use for every future import.

---

## What you need first

- The source file: `.postman_collection.json` (Postman → Collection
  → Export → v2.1) or `spec.yaml` / `spec.json` (OpenAPI 3.x or
  Swagger 2.0).
- 20–40 minutes of triage time (longer for collections >100 requests
  or specs >50 operations).
- The API or its docs accessible — you'll want to verify a couple of
  facts about state behaviour and auth.
- APIWright **installed but not yet invoked** on the source.

You do not need an environment YAML yet — you'll build the scaffold
in step 6.

---

## Why this step matters

The importer is a one-shot conversion. It extracts what's in the
source and emits canonical declarations. Two classes of issue only
become visible AFTER the import — and both are cheap to address
beforehand:

1. **Source-of-truth gaps.** Postman collections and OpenAPI specs
   carry request shape but not test behaviour. Auth held in
   pre-request scripts, schemas held in test scripts, response IDs
   threaded through a chain — none of that travels. If you don't
   know it's missing, you import 200 endpoints, run them, see a
   pile of WARNs, and have to reverse-engineer the gaps.
2. **Scope mismatch.** APIWright covers commodity HTTP behaviour
   (status / content-type / schema / auth / response time) per
   endpoint, independently. It does NOT chain responses, sequence
   state mutations, or run JS test scripts. Importing endpoints
   that fundamentally need flow tests, and then expecting apiwright
   to test them, produces noise rather than coverage.

The triage below catches both before the import.

---

## The 6 prep tasks

### 1. Inventory the source

Get a flat count and a categorisation. For a Postman collection:

```bash
jq '[..|.request? | select(.)] | length' my-collection.postman_collection.json
# → e.g. 87
```

For an OpenAPI spec (count operations):

```bash
yq '.paths[] | keys[]' spec.yaml | wc -l
# → e.g. 47
```

Then bucket each request / operation into one of three categories:

| Category | Will apiwright handle it well? | Examples |
|---|---|---|
| **Stateless reads** | ✅ Yes — perfect fit | `GET /users`, `GET /products/{id}`, `GET /health`, search endpoints |
| **Stateful writes — idempotent or duplicate-safe** | ⚠️ Mostly — needs care with prod_safe + test data | `PUT /settings/{key}` (idempotent), `POST /users` if API tolerates duplicates |
| **Stateful writes — destructive or non-idempotent** | ❌ Limited — commodity case OK; flows belong elsewhere | `DELETE /accounts/{id}`, `POST /orders` (creates unique resource), payment endpoints |

A rough rule: aim for **60–80% of your imports to be reads**. If
your collection is mostly writes, plan more flow-test work upfront.

---

### 2. Map the auth surface

APIWright supports four declarative auth strategies (declared in
the environment YAML's `auth_strategies` block):

| apiwright strategy | What it does | Postman analogue | OpenAPI analogue |
|---|---|---|---|
| `static_token` | Sends a fixed `Authorization: Bearer <token>` from a secret | request-level Bearer auth, or a pre-request setting `Authorization` | `securitySchemes.bearer` |
| `token_endpoint` | OAuth2 client_credentials or password flow — fetches a token at run start | pre-request that POSTs to a token URL and stashes the result | `securitySchemes.oauth2` |
| `basic_auth` | Standard HTTP Basic | request-level Basic auth | `securitySchemes.http.scheme: basic` |
| `api_key` | Sends a fixed key in a header or query | request-level API key | `securitySchemes.apiKey` |

For each authenticated endpoint in your source, identify which
strategy fits. Flag anything that doesn't map to one of the four:

- mTLS / client certificates → not supported in v1.0; needs a
  custom HTTP client wrapper outside apiwright.
- OAuth2 authorization-code flow (interactive consent) → not
  supported; pre-obtain the token and use `static_token`.
- Request signing (AWS Sigv4, HMAC) → not supported; pre-sign or
  use a proxy.
- API key in cookie → not supported; refactor to a header on the
  API side or work around with a proxy.
- JWT-with-rotating-secret-per-request → not supported.

**Postman-specific:** if a request has a pre-request script that
does anything OTHER than a single literal assignment of a token
(see the [allowlist in postman-import.md](../postman-import.md#what-gets-auto-extracted)),
the importer will emit a `review auth manually` warning and leave
`auth_strategy` unset. List those requests now; you'll need to set
`auth_strategy` by hand after import.

**OpenAPI-specific:** `security` schemes are usually mapped
correctly, but global-vs-operation-level security can cause
surprises. Verify that every authenticated operation declares
`security` either globally or at the operation level.

---

### 3. Identify state-mutating endpoints

APIWright runs every endpoint **independently** and in
**alphabetical file order**. An endpoint that mutates state
(`POST` / `PUT` / `PATCH` / `DELETE`) will leave the API in a
different state for any subsequent endpoint in the same run.

The pattern that bites users most often:

```
alphabetical order:  addbook → deletebook → getbook
                                ↑              ↑
                                deletes        404, "no such book"
                                the book       (because deletebook ran first)
```

For each write endpoint in your source, decide upfront:

| Decision | When to use | Where it goes |
|---|---|---|
| **Run in apiwright with seeded test data** | The API has a known-stable test record that survives runs (e.g. a `test-tenant` you control) | `apiwright/`, with the seeded ID hardcoded in env |
| **Run in apiwright with per-run-unique data** | The API tolerates duplicates (e.g. accepts repeated `POST /users` and returns the same ID) | `apiwright/`, with the per-run-unique value derived in env or by a setup hook |
| **Move to flow tests** | The endpoint's value-add only makes sense in a chain (create → read → update → delete on the same resource) | `tests/api/<page>/test_*_flow.py` |
| **Move to flow tests + leave a smoke-only stub in apiwright** | The endpoint is critical and you also want commodity coverage on its individual HTTP shape | Both — apiwright with `prod_safe: false`, flow tests with the full chain |

If you don't know an API's state-tolerance behaviour, `curl` two
identical creates and see what happens (200 with "already exists"
marker? 409 conflict? 200 with a new ID?). This is the kind of
fact you want to know BEFORE you import.

---

### 4. Spot response chaining

APIWright has no inter-request context. If request B uses a value
from request A's response, **B must run in your flow-test layer,
not in apiwright** (or you pre-seed a constant for B).

How to spot chaining in each format:

**Postman:** look in TEST scripts (the `event[type=test]` block) for
`pm.environment.set` or `pm.collectionVariables.set`:

```js
// AddBook's TEST script — sets book_id for downstream requests
const jsonData = pm.response.json();
pm.environment.set("book_id", jsonData.ID);   // ← chaining
```

Any variable set this way is consumed somewhere downstream. Trace
the chain and add the downstream endpoints to your "flow tests"
pile.

**OpenAPI / Swagger:** the spec itself doesn't encode chaining —
but READMEs, Postman-export-of-an-OpenAPI workflows, or
`example`-blocks that reference a previous response often imply
it. Check whether your spec has any `examples` whose values look
like "the ID from the previous create call". If yes, those
endpoints chain.

The cleanest mental rule: **any endpoint whose request value comes
from another endpoint's response chains**. Move it to flow tests.

---

### 5. Format-specific gotchas

#### Postman (v2.1)

Before importing, run a quick audit:

- **Disabled requests** — Postman items with `"disabled": true` (item-level
  or request-level) are silently skipped. Count them so the import
  summary's "wrote N files" doesn't surprise you.
  ```bash
  jq '[.. | objects | select(.disabled == true)] | length' my-collection.postman_collection.json
  ```
- **Test scripts holding schemas** — `pm.response.to.have.jsonSchema(...)`
  in TEST scripts is NOT read by the importer (it only reads saved
  example response BODIES). Note which requests have these — you'll
  manually transcribe the schemas after import. See
  [postman-import.md recipe #3](../postman-import.md#3-schemas-declared-in-test-scripts--manually-transcribe).
- **Pre-request data generation** — `{{$randomInt}}`,
  `pm.iterationData.*`, `pm.globals.*`, `pm.variables.replaceIn(...)`
  do not execute. List the variables each pre-request computes;
  you'll provide literal values in env YAML.
- **Collection-level vs request-level auth** — the importer prefers
  request-level when both are present. If you've set auth ONLY at
  the collection level, that's fine. If both, the request-level wins
  silently. Decide which you want before importing.

#### OpenAPI 3.x / Swagger 2.0

Before importing, lint the spec:

```bash
npx @stoplight/spectral-cli lint spec.yaml
```

Address spec-level errors first — apiwright's importer trusts the
spec is structurally valid.

Then check for these gotchas:

- **Missing `example` blocks on requests** — without examples, the
  importer can't seed `body_example`. Without `body_example`, the
  body-mutator cases (`malformed_json`, `type_violation`,
  `required_field_omission`) cannot be generated. List operations
  without `requestBody.content[*].example` so you know which need
  hand-augmentation.
- **Missing `example` blocks on responses** — same issue; without
  a response example body, the importer emits the
  `{"_pending_review": true}` sentinel and the planner skips
  `response_schema_validation` with a WARN. See
  [openapi-import.md "body_example not seeded"](../openapi-import.md#body_example-not-seeded).
- **Swagger 2.0 `consumes` / `produces`** — these map to
  Content-Type headers, but the importer occasionally misses
  `Content-Type: application/json` on body operations. See
  [openapi-import.md "Content-Type missing on body operations"](../openapi-import.md#content-type-missing-on-body-operations).
- **API keys in query parameters** — `securitySchemes.apiKey.in:
  query` is supported but requires extra env wiring. See
  [openapi-import.md "Query-parameter API keys"](../openapi-import.md#query-parameter-api-keys).
- **Path parameters with no type info** — some specs declare
  `{id}` in the path but don't document its `type` / `format`.
  apiwright treats these as opaque strings; if your IDs are
  integers, the body-mutator's type-violation cases may not be
  meaningful.

---

### 6. Decide the apiwright vs flow-test split

From steps 1–5 you now have per-endpoint metadata. Build a simple
table (a spreadsheet or just a markdown table in your repo):

| Endpoint | apiwright? | Flow tests? | Notes |
|---|---|---|---|
| `GET /users` | ✅ | – | Pure read, stateless |
| `GET /users/{id}` | ✅ (with seeded test-user) | – | Reads stable test data |
| `POST /users` | ✅ (if idempotent) OR ❌ | ✅ (full lifecycle) | API rejects duplicates → flow tests only |
| `DELETE /users/{id}` | ✅ smoke only, `prod_safe: false` | ✅ (full lifecycle) | Both: apiwright commodity HTTP + flow for create→delete→404 |
| `POST /auth/login` | ❌ | ✅ | Sets a session cookie chain reads |
| `POST /payments` | ❌ | ✅ | Stateful, destructive, business-critical — flow tests own this entirely |

The point isn't to be exhaustive — the point is to KNOW the split
before the importer makes the decision for you. Without this table,
you'll import 47 OpenAPI operations and discover only after running
that 12 of them require flow tests, 6 fail because their auth
didn't import, and 3 mutate state out from under their own reads.

---

## The pre-flight checklist

Print this; tick before invoking `apiwright import`.

```
[ ] Inventoried the source — total count by category (read / write-idempotent / write-destructive)
[ ] Mapped every auth scheme to one of {static_token, token_endpoint, basic_auth, api_key}
    OR flagged it as "needs custom handling outside apiwright"
[ ] Listed every endpoint that mutates state — decided seeded-data vs per-run-unique vs flow-tests
[ ] Listed every request that chains a response value into a downstream request
    (Postman: pm.environment.set in TEST scripts; OpenAPI: README/example hints)
[ ] Postman: counted disabled requests, listed test-script schemas, listed pre-request data generation
[ ] OpenAPI: ran spectral lint cleanly; listed operations without request/response examples
[ ] Drafted the apiwright-vs-flow-tests split table
[ ] Drafted the environment YAML scaffold — at minimum: name, prod, base_url
[ ] Decided the import target directory in your testing repo
[ ] Confirmed you have ~30 min for the import + first validate + first triage of warnings
```

When all ten are checked, proceed to:

- **Postman:** [Migrating from Postman](./migrating-from-postman.md)
- **OpenAPI / Swagger:** [Migrating from OpenAPI](./migrating-from-openapi.md)

---

## What just happened

You spent ~30 minutes catching what a fresh import would have spent
~3 hours uncovering reactively:

- The wrong-shape requests (state-chained, mTLS-authed, JS-script-generated)
  are now flagged BEFORE they live in apiwright as broken endpoints.
- The env YAML scaffold exists; first `apiwright validate` will pass
  the cross-check.
- The flow-test pile is identified; nothing in apiwright pretends to
  cover what it can't.
- You know, per-endpoint, why it's where it is — which is the difference
  between a maintainable test suite and a pile of imported `.json`
  files nobody trusts.

---

## Where to go next

- **[Migrating from Postman](./migrating-from-postman.md)** —
  Postman-specific 8-step walkthrough now that you've done the prep.
- **[Migrating from OpenAPI](./migrating-from-openapi.md)** —
  OpenAPI / Swagger-specific 8-step walkthrough.
- **[Limitations](../limitations.md)** — the v1.0 capability surface,
  in one page, so you stop trying to make apiwright do flows.
- **[Concepts](../concepts.md)** — if any of the apiwright-side
  terms above (catalog, marker, prod_safe, env) felt fuzzy.

Reference:

- **[postman-import.md](../postman-import.md)** — every Postman
  importer behaviour, every recipe for what it doesn't import.
- **[openapi-import.md](../openapi-import.md)** — same for the
  OpenAPI / Swagger importer, including known limitations.
