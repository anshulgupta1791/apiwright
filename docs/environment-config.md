# Environment & Configuration

The environment system externalizes all values that differ between deployment
targets — base URLs, database hostnames, auth credentials, SLA thresholds —
so the same endpoint definitions and test suite run unchanged across dev, QA,
staging, and production. This document covers file resolution, YAML schema,
template namespaces, per-environment overrides, fail-fast validation, and the
secret-redaction contract.

## File Resolution

When you run `apiwright run --env=qa`, the loader resolves environment `qa`
by checking two candidate paths under the project root in this order:

1. `.env.qa.yaml` (root-level dotfile, gitignored)
2. `environments/qa.yaml` (committed file)

The loader tries the dotfile first. If it exists and is readable, it is used
exclusively — the fallback is never consulted. The fallback is tried only when
the dotfile is genuinely absent (`not_found`). A dotfile that is present but
malformed or empty produces its own error; it does not silently fall through
to the committed file.

The intent is that `.env.<name>.yaml` holds locally overridden or real-secret
values for a developer's machine and is never committed, while
`environments/<name>.yaml` is the version-controlled, `${secret.*}`-only form
that CI uses. Both files accept the same YAML schema.

### Path-traversal guard

Environment names are constrained to the pattern `^[A-Za-z0-9_-]+$`. Any
name that contains path separators, dots, or other special characters is
rejected immediately with a structured error, never reaching the filesystem.

### Error messages

The loader never throws on user-configuration problems. Every failure — file
not found, malformed YAML, unresolved template reference, missing secret,
schema violation, duplicate connection name — is returned as a structured
result:

```
{ valid: false, errors: ["..."], secretRegistry: <registry> }
```

All errors in a stage are aggregated before the result is returned, so you see
every problem at once rather than fixing issues one at a time.

## YAML Schema

An environment file is a YAML mapping (top-level object). Four keys are
defined by the schema; all other top-level keys are treated as custom
environment values accessible via `${env.*}`.

### Required keys

| Key | Type | Description |
|---|---|---|
| `name` | string | Environment identifier, must match the filename stem. |
| `prod` | boolean | `true` gates destructive test markers behind confirmation. |
| `base_url` | string | Base URL prepended to all relative endpoint paths. |

### Optional keys

| Key | Type | Description |
|---|---|---|
| `default_sla_ms` | integer | Default response-time SLA for all endpoints in milliseconds. |
| `databases` | object | Named database connection configs (see below). |
| `auth_strategies` | object | Named auth strategy configs (see below). |
| `environments` | object | Per-name overrides merged over the base document at load time (see [Per-environment overrides](#per-environment-overrides)). This key is stripped from the resolved document and never available via `${env.*}`. |

### Custom keys

Any additional top-level key is allowed and becomes an `${env.*}` reference:

```yaml
name: qa
prod: false
base_url: https://api-qa.example.com
default_sla_ms: 1000
tenant_id: acme-qa-01
run_id: local
```

`${env.tenant_id}` and `${env.run_id}` are then available anywhere in the
file and in endpoint definitions.

### Database connection config

Each entry under `databases` is keyed by a connection name (letters, digits,
and underscores only) and contains:

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | string | yes | One of `postgres`, `mysql`, `mongodb`, `neo4j`. |
| `host` | string | | Hostname (postgres, mysql). |
| `port` | integer | | Port (postgres, mysql). |
| `database` | string | | Database or schema name. |
| `user` | string | | Username. Typically `${secret.*}`. |
| `password` | string | | Password. Always `${secret.*}`. |
| `uri` | string | | Connection URI (mongodb, neo4j). |

### Auth strategy config

Each entry under `auth_strategies` is keyed by a strategy name and contains:

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | string | yes | One of `static_token`, `token_endpoint`. |
| `token` | string | | Bearer token literal (static_token strategy). |
| `url` | string | | Token endpoint URL (token_endpoint strategy). |
| `credentials` | object | | Credentials map posted to the token endpoint. |
| `token_path` | string | | JSONPath to extract the token from the response. |
| `header` | string | | Request header name (e.g. `Authorization`). |
| `header_value` | string | | Header value template; may include `${token}`. |

### Connection name constraints

Connection names (both `databases` keys and `auth_strategies` keys) must
match `^[A-Za-z0-9_]+$`. A name used in both sections is an error because it
would be ambiguous for `${db.*}` resolution.

## Template Namespaces

Environment files (and endpoint JSON files) use a `${namespace.path}` syntax
for dynamic values. The namespaces are strictly isolated from each other.

### `${env.*}` — environment values

Resolved against the current environment document before secrets are
substituted. The path is dot-notation and supports nested access:

```yaml
db_host: db-qa.example.com
db:
  host: db-qa.example.com
  port: 5432
```

`${env.db_host}` and `${env.db.host}` both work. Whole-token references
(the entire string is exactly one `${env.*}` token) preserve the resolved
type — a YAML integer remains an integer in the resolved document. Embedded
tokens are stringified.

`${env.*}` has no access to `process.env` or secrets. Namespace isolation is
structural: the template resolver receives only the env document and nothing
else.

### `${secret.*}` — secrets from environment variables

Resolved from `process.env` with no prefix. `${secret.QA_DB_PASSWORD}` reads
`process.env.QA_DB_PASSWORD`.

Secret resolution runs after `${env.*}` resolution. Secret values never appear
in error messages. The mapping is direct: the name after `secret.` is the
exact environment variable name.

`${secret.*}` cannot be used inside a `${env.*}` token, and `${env.*}` cannot
reference a secret. The two namespaces are independent and resolved in order.

### Namespaces left for the runner

These tokens appear in environment files and endpoint definitions but are not
resolved by the loader. The test runner substitutes them at execution time:

| Token | Resolved by |
|---|---|
| `${response.*}` | Runner, after each API call |
| `${request.*}` | Runner, from the current request |
| `${db.<connection>.<query>.*}` | Runner, from DB verification results |
| `${token}` | Auth strategy, after token acquisition |

The loader preserves these tokens verbatim in the resolved document.

## Per-Environment Overrides

A single YAML file can carry per-name overrides under a top-level
`environments` key. When the loader resolves environment `qa`, it deep-merges
`environments.qa` over the base document. The `environments` key is stripped
from the result.

Deep-merge semantics:

- Plain objects (YAML mappings) are merged key-by-key recursively.
- Arrays, scalars, and null values in the override replace the base value
  wholesale; they are not concatenated or partially merged.

This feature is most useful for a single shared file that defines common values
with per-environment tweaks:

```yaml
# environments/shared.yaml  (illustrative multi-env file)
name: shared
prod: false
base_url: https://api-dev.example.com
default_sla_ms: 2000

databases:
  primary_postgres:
    type: postgres
    host: db-dev.example.com
    port: 5432
    database: app_dev
    user: ${secret.DB_USER}
    password: ${secret.DB_PASSWORD}

environments:
  qa:
    name: qa
    base_url: https://api-qa.example.com
    databases:
      primary_postgres:
        host: db-qa.example.com
        database: app_qa
  staging:
    name: staging
    prod: false
    base_url: https://api-staging.example.com
    default_sla_ms: 800
    databases:
      primary_postgres:
        host: db-staging.example.com
        database: app_staging
```

When `--env=qa` loads this file, the result has `base_url` from the `qa`
override, the merged `databases.primary_postgres` object with `host` and
`database` overridden and `port` preserved from the base, and `name` set
to `qa`. The `environments` key does not appear in the resolved document.

## Fail-Fast Validation

The loader runs five checks in sequence. Each check short-circuits on failure.

1. **Env name pattern** — the name matches `^[A-Za-z0-9_-]+$`.
2. **File parse** — the file is readable, non-empty, and contains valid YAML
   with only JSON-safe constructs (no custom tags, no code execution).
3. **`${env.*}` resolution** — every `${env.path}` token in the document
   resolves to an existing path in the same document.
4. **`${secret.*}` resolution** — every `${secret.NAME}` token resolves to a
   non-empty `process.env.NAME`.
5. **Schema validation** — the resolved document satisfies the environment
   schema (required fields present, types correct, connection name pattern).
6. **Connection name consistency** — no connection name appears in both
   `databases` and `auth_strategies`.

All errors within a stage are collected before returning. For example, if three
secrets are missing, the error message names all three in one line rather than
reporting them one at a time.

A failed result always includes the `secretRegistry` populated up to the point
of failure, so downstream log redaction can scrub any partially resolved
secret values even when the load did not complete.

## Secret Redaction Contract

When the loader resolves `${secret.*}` references successfully, it records each
resolved value in a `SecretRegistry`. The registry is returned as part of every
load result — including failed results, so secrets resolved before a later
failure are still tracked.

The framework's reporters and log emitters consume the registry to replace
secret values with `[REDACTED]` before any string is serialized to disk, a
report, or the console. Secret values never appear in:

- Error messages from the loader
- Test-run reports (HTML, JSON, JUnit XML)
- Console output at any log level

An empty string is never treated as a resolved secret value. Secrets whose
environment variable is unset or empty are reported as missing at startup.

## Complete Worked Example

This is a complete, copy-ready `environments/qa.yaml` that uses `${env.*}` for
internal cross-references and `${secret.*}` for credentials. The secrets are
supplied via plain environment variables — no prefix, no wrapper.

### environments/qa.yaml

```yaml
name: qa
prod: false
base_url: https://api-qa.example.com
default_sla_ms: 1000

# Custom env values — available as ${env.*} anywhere in this file
# or in endpoint JSON referencing this environment.
tenant_id: acme-qa
db_host: db-qa.example.com
db_port: 5432

databases:
  primary_postgres:
    type: postgres
    host: ${env.db_host}
    port: ${env.db_port}
    database: app_qa
    user: ${secret.QA_DB_USER}
    password: ${secret.QA_DB_PASSWORD}

  reporting_mysql:
    type: mysql
    host: ${env.db_host}
    port: 3306
    database: reports_qa
    user: ${secret.QA_REPORT_USER}
    password: ${secret.QA_REPORT_PASSWORD}

auth_strategies:
  user_token:
    type: token_endpoint
    url: ${env.base_url}/auth/login
    credentials:
      username: ${secret.QA_USER}
      password: ${secret.QA_PASSWORD}
    token_path: $.access_token
    header: Authorization
    header_value: "Bearer ${token}"

  admin_token:
    type: static_token
    token: ${secret.QA_ADMIN_TOKEN}
    header: Authorization
    header_value: "Bearer ${token}"
```

### Supplying secrets

Set the corresponding environment variables before running. The variable name
is the portion after `secret.` — no prefix, no transformation.

```bash
export QA_DB_USER=apiwright_qa
export QA_DB_PASSWORD=...
export QA_REPORT_USER=reports_ro
export QA_REPORT_PASSWORD=...
export QA_USER=qa-test-user@example.com
export QA_PASSWORD=...
export QA_ADMIN_TOKEN=...
```

Then run:

```bash
docker run --rm \
  -v $(pwd)/tests:/app/tests \
  -v $(pwd)/environments:/app/environments \
  -v $(pwd)/reports:/app/reports \
  -e QA_DB_USER \
  -e QA_DB_PASSWORD \
  -e QA_REPORT_USER \
  -e QA_REPORT_PASSWORD \
  -e QA_USER \
  -e QA_PASSWORD \
  -e QA_ADMIN_TOKEN \
  ghcr.io/<org>/apiwright:1.0.0 \
  run --env=qa --markers=smoke,regression
```

In CI (GitHub Actions, Jenkins, GitLab CI), set these as job-level secrets and
pass them with `-e VARNAME` (Docker) or directly in the CI step environment.
The framework reads them from `process.env` inside the container with no
additional configuration.

### What the resolved document looks like

After loading, `${env.db_host}` and `${env.db_port}` are replaced with their
literal values, `${secret.*}` references are replaced with the resolved
environment-variable values, and the result is schema-validated. The `name`
field of the resolved document is `"qa"`, `prod` is `false`, and `base_url` is
`"https://api-qa.example.com"`.

The `tenant_id`, `db_host`, and `db_port` fields remain in the resolved
document under their original names and are accessible at runtime via
`${env.tenant_id}`, `${env.db_host}`, and `${env.db_port}` in endpoint
definitions.

## Common Pitfalls

**Secret variable not set**

```
Unresolved secret(s): QA_DB_PASSWORD, QA_USER. Set the corresponding
environment variable(s) before running.
```

All missing secrets are listed in one message. Set the named environment
variables and re-run.

**`${env.*}` path does not exist**

```
Unresolved environment reference(s): env.db.hostname. Check the environment
file.
```

The path `db.hostname` does not exist in the environment document. Either the
field is misspelled or the nesting is wrong. Note that `${env.db.host}` and
`${env.db.hostname}` are different paths.

**Dotfile exists but is empty**

```
Environment file is empty: /project/.env.qa.yaml
```

The loader found `.env.qa.yaml` but it has no content. Remove the file or add
valid YAML content. The fallback `environments/qa.yaml` is not consulted when
the dotfile is present.

**Environment name contains slashes**

```
Invalid environment name "qa/production": use only letters, digits, hyphen,
or underscore.
```

Environment names must match `^[A-Za-z0-9_-]+$`. Rename the file and use
`--env=qa-production` (hyphen is allowed).

**Connection name collision**

```
connection name "primary" is used by both databases and auth_strategies
```

A connection name must be unique across both sections. Rename one of the
conflicting entries.

## Related Documentation

- **[Auth Strategies](./auth-strategies.md)** — Configuration details for each auth strategy type
- **[Database Connectors](./connectors.md)** — Connection configuration per database type
- **[Authoring Endpoints](./authoring-endpoints.md)** — Using `${env.*}` and `${secret.*}` in endpoint JSON
- **[CI Integration](./ci-integration.md)** — Injecting secrets in CI/CD platforms
