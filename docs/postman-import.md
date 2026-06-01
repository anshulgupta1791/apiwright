# Importing Postman Collections

> **First time importing?** Walk
> [Preparing to import](./cookbook/preparing-to-import.md) first. Twenty
> minutes of upfront triage on the collection catches the issues that take
> hours to reverse-engineer once the import has happened. Then come back
> here for the importer's behaviour reference, or jump straight to
> [Migrating from Postman](./cookbook/migrating-from-postman.md) for the
> step-by-step walkthrough.

The `apiwright import postman` command converts a Postman v2.1 collection
into one `*.endpoint.json` file per request, ready for validation, enrichment,
and test runs. This document covers the command and its single flag, how the
output is organised on disk, variable-token conversion, auth extraction, response
seeding, disabled-request handling, and the warnings and summary the command
emits.

## Command

```bash
apiwright import postman <file> --output <dir>
```

| Argument / flag | Required | Description |
|---|---|---|
| `<file>` | Yes | Path to a Postman v2.1 collection `.json` file. |
| `--output <dir>` | Yes | Directory under which the generated endpoint files are written. Created automatically if it does not exist. |
| `--config <path>` | No | Path to `apiwright.config.json`. Defaults to `./apiwright.config.json` at the repo root. |

**Exit codes**

| Code | Meaning |
|---|---|
| 0 | Import completed. Check the summary for any warnings. |
| 2 | Usage error — missing required argument or flag. |
| 70 | Unexpected internal error. Re-run with `--log debug` to see the full trace. |

**Via Docker:**

```bash
docker run --rm -v $(pwd):/work ghcr.io/<org>/apiwright:1.0.0 \
  import postman /work/collections/users.postman_collection.json \
  --output /work/tests
```

---

## What the importer does

The importer:

1. Loads and parses the Postman v2.1 JSON file.
2. Walks the item tree depth-first in document order, preserving folder
   structure.
3. Skips disabled requests (see [Disabled requests](#disabled-requests)).
4. Rewrites `{{var}}` tokens to `${env.*}` format (see
   [Variable templating](#variable-templating)).
5. Assembles one `CanonicalEndpoint` per request: core fields, inferred request
   schema, seeded response schema, and extracted auth strategy.
6. Validates every assembled endpoint against the canonical meta-schema; invalid
   endpoints are dropped with a warning rather than aborting the import.
7. Writes one `*.endpoint.json` file per endpoint, organised by folder path.
8. Prints a summary line: files written and any warnings.

---

## Output organisation — folder structure mirroring

Postman folders become subdirectories under the `--output` directory. The
directory tree mirrors the Postman folder hierarchy exactly, no matter how
deeply nested.

**Example:** a collection containing:

```
users.postman_collection.json
├── Health Check           (root-level request)
├── Users/
│   ├── List Users
│   ├── Create User
│   └── Admin/
│       ├── List Admin Users
│       └── Internal/
│           └── Get Metrics
└── Auth/
    ├── Login
    └── Refresh Token
```

produces (under `--output ./tests`):

```
tests/
├── health-check.endpoint.json
├── users/
│   ├── list-users.endpoint.json
│   ├── create-user.endpoint.json
│   └── admin/
│       ├── list-admin-users.endpoint.json
│       └── internal/
│           └── get-metrics.endpoint.json
└── auth/
    ├── login.endpoint.json
    └── refresh-token.endpoint.json
```

**File-naming rules:**

- File names and directory names are slugified from the Postman request/folder
  name: NFKD-normalised, lowercased, non-alphanumeric runs replaced with `_`,
  consecutive underscores collapsed, leading/trailing separators trimmed.
- If two requests in the same folder produce the same slug, a numeric suffix is
  appended (`create-user.endpoint.json`, `create-user_2.endpoint.json`, …).
  A rename warning is emitted for each collision.
- Each file name ends with `.endpoint.json` — the naming convention the
  `apiwright run` and `apiwright validate` commands recognise.

**`source` field:**

Every generated file carries a `source` block recording its origin:

```json
"source": {
  "type": "postman",
  "collection": "users.postman_collection.json"
}
```

---

## Variable templating — `{{var}}` to `${env.*}`

Postman collections use `{{variableName}}` tokens for environment values.
APIWright's environment system uses `${env.variableName}`. The importer rewrites
every `{{var}}` it encounters in URLs, header values, query-parameter values,
and raw request bodies.

**Standard rewrite:**

```
{{baseUrl}}  →  ${env.baseUrl}
{{token}}    →  ${env.token}
{{userId}}   →  ${env.userId}
```

**Variable name sanitisation:**

The `${env.*}` grammar requires names that match
`[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*`. If a Postman variable name contains
characters outside that set, the importer sanitises it (replaces illegal
characters with `_`, collapses runs, trims leading/trailing separators) and
emits a warning:

```
Variable 'user-id' rewritten to 'user_id' (illegal characters in ${env.*} grammar)
```

After importing, add the corresponding keys to your environment YAML file so
the references resolve at run time. See
[Environment & Configuration](./environment-config.md) for the full `${env.*}`
grammar, variable namespaces, and how to declare environment values.

**What is NOT rewritten:**

- Header keys (names) are never rewritten — only values.
- Query-parameter keys are never rewritten — only values.
- Pre-request scripts are consumed verbatim by the auth extractor; they are
  not rewritten and are not written into the endpoint file.

---

## Auth extraction from pre-request scripts

Postman collections often use pre-request scripts to set tokens or attach
Authorization headers. The importer inspects these scripts to populate the
`auth_strategy` field in the generated endpoint, but with strict safety
constraints.

### Security guarantee: scripts are never executed

Pre-request scripts are inspected by string and regular-expression matching
only. The importer never evaluates, `eval`s, `Function`-constructs, spawns, or
runs scripts through any JavaScript execution context. This is enforced
structurally: the auth-extractor module does not import `vm`, `child_process`,
`eval`, or any other execution facility.

### What gets auto-extracted

Auth strategy is detected from two sources, checked in this order:

**1. Request-level auth block (checked first)**

When a Postman request has a native auth block, it maps directly:

| Postman auth type | Canonical `auth_strategy` |
|---|---|
| `bearer` | `user_token` |
| `basic` | `basic_auth` |
| `apikey` | `api_key` |

**2. Pre-request script — closed allowlist**

When there is no (or unrecognised) auth block, the importer checks the
pre-request script against a closed allowlist of four recognised forms. All
four are matched by regex; no execution occurs.

| Form | Pattern | Assigned strategy |
|---|---|---|
| 1 | `pm.environment.set('token', <value>)` — single statement, simple RHS | `user_token` |
| 2 | `pm.collectionVariables.set('token' \| 'accessToken' \| 'access_token', <value>)` | `user_token` |
| 3 | `pm.request.headers.add({key:'Authorization', value:'Bearer ...'})` | `user_token` |
| 4 | `pm.request.headers.upsert({key:'Authorization', value:'Bearer ...'})` | `user_token` |

The script must contain exactly one effective statement (after stripping
comments) to match any of the four forms.

### What triggers a manual-review warning

Any pre-request script that does not match the closed allowlist — and any auth
block whose type is not in the table above — results in the request being
imported **without** an `auth_strategy` and with a warning:

```
Request 'Complex Auth Script' has a pre-request script outside the recognized
allowlist; review auth manually
```

Scripts are automatically excluded from the allowlist (and always flagged) when
they contain any of the following patterns:

- Control flow: `if`, `for`, `while`, `switch`, `case`, ternary (`?`),
  logical operators (`&&`, `||`), arrow functions (`=>`), `function`
- Network calls: `pm.sendRequest`, `pm.execution`, `fetch`, `require(`,
  `XMLHttpRequest`
- Crypto/signing: `crypto`, `CryptoJS`, `hmac`, `sha256`, `sha1`, `md5`,
  `sign`, `Buffer`
- Process/eval/dynamic: `process`, `eval`, `Function`, `child_process`, `fs.`,
  `import(`, `globalThis`, `__proto__`
- More than one effective statement

After importing, open any file that received a manual-review warning and set
`auth_strategy` to the appropriate strategy name defined in your environment
YAML. Auth strategies are declared in the `auth_strategies` map of your
environment YAML file; see
[Environment & Configuration](./environment-config.md) for the YAML schema.

### Empty scripts

A request with no pre-request script and no auth block is imported without an
`auth_strategy` and without a warning — this is the expected case for
unauthenticated endpoints.

---

## Response seeding

If a Postman request has saved / example responses, the importer uses them to
seed `response.expected_status` and `response.schema` in the generated
endpoint.

**Selection algorithm:**

1. If the request has no example responses, the importer defaults to
   `expected_status: 200` with a `{ "_pending_review": true }` sentinel
   schema and emits a warning.
2. If one or more 2xx examples exist, the first 2xx example (in document order)
   is chosen.
3. If no 2xx example exists, the first example overall is chosen and a warning
   is emitted (non-2xx chosen).

**Schema inference:**

When the chosen example has a valid JSON body, the importer infers a JSON
Schema from it (types and structure; no `required` constraints). This gives the
test runner a starting schema to validate responses against. Review and tighten
the schema after import.

When the example body is not valid JSON, the importer falls back to
`{ "type": "object" }` and emits a warning. When it is empty, the importer
falls back to the `{ "_pending_review": true }` sentinel and emits a warning.

**Why a sentinel instead of `{}`:** an empty schema `{}` matches ANY 2xx body
— so running `response_schema_validation` against it would pass even a 200
HTML marketing-homepage response when the request never reached the API. To
prevent that false-positive avenue, the planner detects the sentinel (and
also a bare `{}` from older imports) and **skips `response_schema_validation`
+ emits a per-endpoint WARN at run time**. See section
[Empty / sentinel schema → tighten or accept the skip-with-WARN](#4-empty--sentinel-schema--tighten-or-accept-the-skip-with-warn)
for the full fixup recipe.

---

## Disabled requests

Two forms of disabling are recognised:

- **Item-level:** the Postman item has `"disabled": true` at the top level.
- **Request-level:** the Postman item's `request` object has `"disabled": true`.

Both are skipped during import. For each skipped request, the summary contains:

```
Skipped disabled request 'Request Name'
```

Disabled requests produce no endpoint file.

---

## Excessively nested bodies

If a request body is so deeply nested that schema inference would overflow the
call stack, the request is skipped entirely rather than crashing the import.
The summary contains:

```
Request 'Request Name' skipped: unprocessable (e.g. excessively nested body)
```

This is expected to be rare in real collections. If it occurs, author the
endpoint file manually.

---

## Summary output

The import command returns an `ImportOutcome` containing:

- `written` — number of `*.endpoint.json` files written to disk.
- `warnings` — array of human-readable strings describing any skipped or
  degraded requests (disabled requests, unsupported auth, missing example
  responses, name collisions, etc.).

The exit code is 0 when the import completes, regardless of how many warnings
were emitted. Warnings indicate endpoints or fields that need manual attention,
not failures. Check the `--output` directory to count the files written, and
review warnings to identify any requests that need follow-up.

An exit code of 2 means a usage error (for example, `--output` was not
provided). An exit code of 70 means an unexpected internal error; re-run with
`--log debug` to see the full trace.

---

## What is NOT imported (and the post-import fixup recipe)

The importer reads Postman's REQUEST shape (URL, method, headers, body, auth
block, pre-request script) and the SAVED example responses. It does **not**
import Postman's runtime / execution model:

- Pre-request data generation — `{{$randomInt}}`, `pm.iterationData.*`,
  `pm.globals.*`, `pm.variables.replaceIn(...)`.
- Test scripts — `pm.test(...)`, `pm.response.to.have.jsonSchema(...)`,
  custom assertions.
- Response-driven variables — `pm.environment.set("X", response.value)`
  inside a TEST script that feeds a downstream request.
- Conditional flow — `postman.setNextRequest(...)`, retry-on-error blocks,
  manual order control.
- Data-runner iteration — CSV / JSON test-data files driving repeated runs.
- Collection-level `event` hooks.

apiwright runs every endpoint **independently**. There is no inter-request
context. This is by design — flows belong in integration tests (see
[Limitations](./limitations.md)) — but it means several Postman patterns
require manual fixup after import. The five most common are catalogued
below. Each is grounded in a real walkthrough (the public
`rahulshettyacademy.com/Library` API) so you can recognise the shape in
your own collections.

### 1. Pre-request data generation → literal env values

Postman pre-request scripts often compute test data dynamically. Example
from the Library collection's AddBook request:

```js
const code = pm.globals.get("companyCode");
const val  = pm.variables.replaceIn('{{$randomInt}}');
pm.collectionVariables.set("isbn", code + val);
pm.collectionVariables.set("book_name", pm.iterationData.get("BookName"));
pm.collectionVariables.set("author_name", pm.iterationData.get("Author"));
```

apiwright does not execute JavaScript. The importer flags scripts like
this with a warning (`pre-request script outside the recognized allowlist;
review auth manually`) and proceeds without populating `auth_strategy`.

**Fixup:** edit the environment YAML to provide a literal value for each
Postman variable the pre-request script computed. The endpoint file
already references them as `${env.X}` (the importer rewrote `{{X}}` →
`${env.X}` automatically).

```yaml
# environments/qa.yaml
isbn: "978-1234567890"
book_name: "Test Book"
author_name: "Test Author"
```

### 2. Response chaining → constant env values, or split into multiple runs

Postman TEST scripts often capture a value from a response and store it
for downstream requests. Example from AddBook's TEST script:

```js
const jsonData = pm.response.json();
const bookId = jsonData.ID;
pm.environment.set("book_id", bookId);   // ← consumed by GetBook / DeleteBook
```

apiwright has no equivalent — each endpoint sees only the env loaded at
startup, plus its own request/response. Two recipes:

**Recipe A — Use a known, stable test record.** Seed your API with a
test record that survives across runs, and hardcode its ID in env:

```yaml
# environments/qa.yaml
book_id: "978-12345678902529857"   # well-known test book ID
```

**Recipe B — Run each endpoint in its own CI step.** Use `--endpoint`
to scope a run to one endpoint at a time, threading state outside
apiwright (e.g. between CI steps that pipe data through env vars):

```bash
ID=$(apiwright run --endpoint addbook --env qa | jq -r '...')
apiwright run --endpoint getbook --env qa
```

### 3. Schemas declared in test scripts → manually transcribe

Postman writers often inline JSON Schemas in their TEST scripts. Example
from GetBook's TEST script:

```js
const schema = {
  "type": "array",
  "items": [{
    "type": "object",
    "properties": {
      "book_name": { "type": "string" },
      "isbn":      { "type": "string" },
      "aisle":     { "type": "string" },
      "author":    { "type": "string" }
    },
    "required": ["book_name", "isbn", "aisle", "author"]
  }]
};
pm.response.to.have.jsonSchema(schema);
```

The importer reads `response.body` from saved examples to infer a schema;
it does NOT parse test scripts. After import, copy the test-script schema
into `response.schema` of the endpoint file. Modernise the deprecated
tuple-form `items: [{ ... }]` to single-form `items: { ... }` as JSON
Schema 2020-12 requires:

```json
{
  "response": {
    "expected_status": 200,
    "schema": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "book_name": { "type": "string" },
          "isbn":      { "type": "string" },
          "aisle":     { "type": "string" },
          "author":    { "type": "string" }
        },
        "required": ["book_name", "isbn", "aisle", "author"]
      }
    }
  }
}
```

### 4. Empty / sentinel schema → tighten or accept the skip-with-WARN

When the importer cannot derive a schema (no example response, empty body,
unparseable body), it writes the sentinel `{ "_pending_review": true }`
into `response.schema` and warns:

```
Request 'GetBook' has no example response; defaulted to 200 with a
pending-review schema (response_schema_validation will be skipped until
you tighten 'response.schema' in the endpoint file)
```

At run time the planner DETECTS the sentinel (and also a bare `{}` from
older imports) and **skips the `response_schema_validation` test case +
emits a per-endpoint WARN** in the run output:

```
WARN: Endpoint 'getbook': response.schema is empty or pending review;
response_schema_validation skipped to avoid false-positive PASSes against
any 2xx body. Tighten the schema in the endpoint file to enable validation.
```

This is **intentional** — running schema validation against `{}` would
pass every 2xx response, including completely wrong ones. (A real example
from the walkthrough: a 200 marketing-homepage HTML matched `{}` and was
reported as PASS even though the request had not reached the API at all.)

**Fixup:** replace `{ "_pending_review": true }` (or any bare `{}`) with
a real schema. Even the minimum `{"type": "object"}` is enough to catch
type mismatches — and a real schema, transcribed from a sample response
or a test-script `jsonSchema()` call, is far better.

### 5. State-mutating endpoint order → filter or seed/restore

apiwright runs endpoints in alphabetical file order by default. When one
endpoint mutates state another endpoint reads, the second will see the
mutated state. In the Library walkthrough this manifests as:

```
addbook    → PASS  (creates / accepts duplicate)
deletebook → PASS  (deletes the book, side effect)
getbook    → FAIL  (404 — book deleted by deletebook a moment ago)
```

Three recipes:

**a. Scope each run with `--endpoint`** so only one mutating endpoint
runs per CI step.

**b. Seed/restore test data outside apiwright** — a CI setup step that
ensures the API is in a known state before each `apiwright run`.

**c. Move write-then-read flows to `apiwright-testing/`** (Python /
pytest) where ordering, fixtures, and rollback are first-class.

### Diagnostic workflow when a run fails unexpectedly

1. Open the JSON report under `reports/`. Every attempt records the exact
   URL, headers, body sent, and response received.
2. `curl` the captured URL with the captured body. If curl gets the same
   response apiwright did, the issue is the request shape — fix the
   endpoint file (URL, method, body, headers).
3. If curl works but apiwright fails, the issue is template substitution
   or env wiring — check `${env.*}` tokens against the YAML keys.
4. If both curl and apiwright get the same 2xx but apiwright reports
   FAIL, the response shape does not match `response.schema` — tighten
   the schema to match reality, or fix the API.

---

## Worked example

### Input collection

`users.postman_collection.json` (simplified):

```json
{
  "info": {
    "name": "Users API",
    "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
  },
  "variable": [
    { "key": "baseUrl", "value": "https://api.example.com" }
  ],
  "item": [
    {
      "name": "Users",
      "item": [
        {
          "name": "List Users",
          "request": {
            "method": "GET",
            "url": "{{baseUrl}}/api/v1/users",
            "header": [
              { "key": "Authorization", "value": "Bearer {{token}}", "disabled": false }
            ],
            "auth": { "type": "bearer" }
          },
          "response": [
            {
              "code": 200,
              "body": "{\"users\": [{\"id\": 1, \"name\": \"Alice\"}], \"total\": 1}"
            }
          ]
        },
        {
          "name": "Create User",
          "request": {
            "method": "POST",
            "url": "{{baseUrl}}/api/v1/users",
            "header": [
              { "key": "Content-Type", "value": "application/json", "disabled": false }
            ],
            "body": {
              "mode": "raw",
              "raw": "{\"email\": \"{{userEmail}}\", \"name\": \"Test User\"}"
            },
            "auth": { "type": "bearer" }
          },
          "response": [
            {
              "code": 201,
              "body": "{\"id\": 42, \"email\": \"test@example.com\", \"name\": \"Test User\"}"
            }
          ]
        }
      ]
    }
  ]
}
```

### Command

```bash
apiwright import postman ./users.postman_collection.json --output ./tests
```

### Output file tree

```
tests/
└── users/
    ├── list-users.endpoint.json
    └── create-user.endpoint.json
```

### Generated `tests/users/list-users.endpoint.json`

```json
{
  "id": "list-users",
  "name": "List Users",
  "method": "GET",
  "url": "${env.baseUrl}/api/v1/users",
  "auth_strategy": "user_token",
  "request": {
    "headers": {
      "Authorization": "Bearer ${env.token}"
    }
  },
  "response": {
    "expected_status": 200,
    "schema": {
      "type": "object",
      "properties": {
        "users": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "id": { "type": "number" },
              "name": { "type": "string" }
            }
          }
        },
        "total": { "type": "number" }
      }
    }
  },
  "source": {
    "type": "postman",
    "collection": "users.postman_collection.json"
  }
}
```

### Result

The command exits 0. Two files are written under `tests/users/`. No warnings
are emitted for this collection because both requests have recognised auth
blocks, valid 2xx example responses, and no disabled items.

---

## After importing — recommended next steps

1. **Run `apiwright validate ./tests`** to confirm all generated files pass the
   canonical meta-schema.

2. **Review auth strategies.** Any endpoint flagged with a manual-review warning
   needs its `auth_strategy` field set. Ensure the named strategy is declared in
   your environment YAML.

3. **Review variable references.** All `${env.*}` tokens in generated files need
   corresponding keys in your environment YAML (or `.env.<name>.yaml` for local
   secrets).

4. **Tighten response schemas.** The importer infers structure from example
   bodies but does not mark any fields as `required`. Add `"required"` arrays
   where the API contract demands them. Any endpoint left with
   `{ "_pending_review": true }` (no example response was available) will
   trigger a `response_schema_validation` skip + per-endpoint WARN at run
   time — see section
   [What is NOT imported (and the post-import fixup recipe)](#what-is-not-imported-and-the-post-import-fixup-recipe)
   for the full diagnostic + fixup workflow.

5. **Transcribe schemas from test scripts** if the Postman collection uses
   `pm.response.to.have.jsonSchema(...)` in TEST scripts. The importer does
   not parse test scripts; copy any inline schemas into `response.schema`
   manually. The same section above has the recipe.

6. **Replace dynamic test data with literal env values.** If the collection's
   pre-request scripts compute values via `{{$randomInt}}`,
   `pm.iterationData`, `pm.globals`, or response-chaining, define literal
   replacements in your environment YAML — apiwright does not run JS.

7. **Add `db_verify` blocks** for write endpoints (POST, PUT, PATCH, DELETE) to
   enable database-state verification.

8. **Add `assertions`** for business-rule checks beyond schema conformance. See
   [Canonical Model Reference](./canonical-model.md) for the full endpoint
   schema including the `assertions` field.

---

## Import OpenAPI

`apiwright import openapi` is available in a later release. For now, use
`apiwright import postman` for Postman v2.1 collections and author endpoint
files directly in JSON for any other sources.

---

## Related documentation

- **[Canonical Model Reference](./canonical-model.md)** — The endpoint JSON
  schema that every generated file conforms to.
- **[Environment & Configuration](./environment-config.md)** — How to declare
  `${env.*}` values, configure auth strategies, and manage secrets.
- **[CLI Reference](./cli.md)** — Full command and flag reference, including
  exit codes.
