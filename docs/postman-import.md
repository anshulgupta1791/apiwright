# Importing Postman Collections

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
   `expected_status: 200` with an empty schema and emits a warning.
2. If one or more 2xx examples exist, the first 2xx example (in document order)
   is chosen.
3. If no 2xx example exists, the first example overall is chosen and a warning
   is emitted (non-2xx chosen).

**Schema inference:**

When the chosen example has a valid JSON body, the importer infers a JSON
Schema from it (types and structure; no `required` constraints). This gives the
test runner a starting schema to validate responses against. Review and tighten
the schema after import.

When the example body is not valid JSON or is empty, the importer falls back to
`{ "type": "object" }` or `{}` respectively and emits a warning.

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

4. **Tighten response schemas.** The importer infers structure from the example
   body but does not mark any fields as `required`. Add `"required"` arrays where
   the API contract demands them.

5. **Add `db_verify` blocks** for write endpoints (POST, PUT, PATCH, DELETE) to
   enable database-state verification.

6. **Add `assertions`** for business-rule checks beyond schema conformance. See
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
