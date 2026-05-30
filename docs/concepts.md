# Concepts

APIWright has a small vocabulary. Learn these six terms and you have the
whole mental model.

```
DECLARATION  ──▶  CATALOG  ──▶  PLAN  ──▶  RUN  ──▶  REPORT
  (you author)   (auto-generated)            (real HTTP)   (artifacts)
```

That's it. Everything in the docs is one of these or a property of one.

---

## 1. The declaration — the source of truth

A **declaration** is one JSON file per API endpoint. It captures everything
APIWright needs to know about the endpoint: how to call it, what to expect
back, and what side-effects to verify.

```json
{
  "id": "users.create",
  "name": "POST /users — create a new user",
  "method": "POST",
  "url": "/api/v1/users",
  "tags": ["users", "write"],
  "markers": ["regression"],
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
    "body_example": { "email": "qa@example.com", "name": "QA Bot" }
  },
  "response": {
    "expected_status": 201,
    "sla_ms": 500,
    "schema": {
      "type": "object",
      "required": ["id", "email"],
      "properties": {
        "id": { "type": "string" },
        "email": { "type": "string" }
      }
    }
  },
  "assertions": [
    "response.body.id is_uuid_v4",
    "response.body.email equals request.body.email"
  ]
}
```

One declaration. ~40 lines. APIWright now knows enough to generate **~16
distinct test cases** for this single endpoint (see *the catalog*, next).

You can hand-author declarations or import them from Postman v2.1, OpenAPI
3.x, or Swagger 2.0 — see [postman-import.md](./postman-import.md) and
[openapi-import.md](./openapi-import.md).

---

## 2. The catalog — what APIWright auto-generates

The **catalog** is the fixed set of test types APIWright knows how to
synthesise from any declaration. For the declaration above, the catalog
expands into cases like:

- **HTTP correctness** — status code matches `expected_status`,
  content-type aligns with the response body, response time ≤ `sla_ms`.
- **Schema validation** — request body satisfies `body_schema`; response
  body satisfies `response.schema`.
- **Auth boundaries** — request with no auth must return 401; request
  with a garbage token must return 401 (only when `auth_strategy` is
  declared).
- **HTTP semantics** — method-not-allowed (e.g. PUT to a POST-only
  endpoint), malformed JSON returns 400 (not 500).
- **Input validation per declared field** — for every required field,
  one case omits it and expects 400; for every typed field, one case
  sends a value of the wrong type and expects 400; for every field with
  `minimum`/`maximum`/`minLength`/`maxLength`/`enum`, the boundary
  battery sends inside, outside, and at-boundary values.
- **Idempotency** — GET twice / DELETE twice must give the same result.
- **DB state verification** — when `db_verify` is declared, the configured
  SQL/Cypher/Mongo query runs against the connected database and its
  result matches the expected fields/rows.
- **Declarative assertions** — every entry in the `assertions` array runs
  against the request/response/db state.

The full list of generator types and what they produce is in
[test-catalog.md](./test-catalog.md).

One declaration with 5 required fields + 6 typed fields + 1 numeric range
+ 1 string-length + 1 enum constraint typically expands to **20-30
generated cases**. For 100 such endpoints, that's **~2,000 tests** you
didn't write.

---

## 3. The environment — what differs between targets

An **environment** is a YAML file that captures everything that differs
between dev / qa / staging / production: base URLs, database connection
details, secrets, default SLAs, auth tokens.

```yaml
# environments/qa.yaml
name: qa
prod: false
base_url: https://qa-api.example.com
default_sla_ms: 2000

databases:
  primary_postgres:
    type: postgres
    host: ${secret.QA_DB_HOST}
    port: 5432
    database: app
    user: ${secret.QA_DB_USER}
    password: ${secret.QA_DB_PASSWORD}

auth_strategies:
  bearer:
    type: static_token
    token: ${secret.QA_API_TOKEN}
    header: Authorization
    header_value: Bearer ${token}
```

`${secret.X}` references resolve from `process.env` at run time and are
automatically redacted from every report (`Bearer [REDACTED]` instead of
the raw token).

The **same declaration files run unchanged against every environment** —
only the YAML changes. See [environment-config.md](./environment-config.md)
for the full reference.

---

## 4. The marker — how you slice what runs

Every generated case carries a **marker**: `smoke`, `regression`, or `e2e`.

| Marker | What it covers | When to run |
|---|---|---|
| `smoke` | Happy-path commodity (status, schema, content-type, sla, auth_happy, assertions) | Every PR, every deploy |
| `regression` | Negative / boundary / type-violation / idempotency / db_state cases | Nightly, before release |
| `e2e` | Reserved for multi-step flows (v1.5) | — |
| `all` | CLI shorthand for everything | Manual full sweeps |

You select markers at run time:

```bash
apiwright run --env qa --markers smoke              # fast, every-PR
apiwright run --env qa --markers smoke,regression   # thorough, nightly
apiwright run --env qa --markers all                # everything
```

The marker → case mapping is fixed by APIWright (the §3 catalog assigns
each generated case to exactly one marker). See
[markers-and-lifecycle.md](./markers-and-lifecycle.md) for the full table
and recommended pipeline integration.

---

## 5. The run — what actually happens

A **run** is one invocation of `apiwright run`. It:

1. Loads + validates every `*.endpoint.json` in `tests_dir`.
2. Loads + validates the requested `environments/<env>.yaml`.
3. Expands declarations into the catalog (the test plan).
4. Filters the plan by markers + CLI flags (`--tag`, `--exclude-tag`,
   `--endpoint`, `--path`).
5. Executes the plan with N parallel workers (`workers` config, default 4),
   sending real HTTP requests and running db_verify queries.
6. Retries failed cases per the configured retry policy.
7. Writes JSON / HTML / JUnit reports to `reports_dir`.

Every case is hermetic — no shared state between cases, deterministic
ordering of the report regardless of worker count.

---

## 6. The report — what you (and your CI) see

Every run produces (default `./reports/run-<timestamp>.{json,html,xml}`):

| Format | Audience | What it carries |
|---|---|---|
| **JSON** | Tooling, the rest of your test stack | Full structured run result: summary counts, per-endpoint results, per-attempt request/response, assertion outcomes, db_verify outcomes, failure reasons |
| **HTML** | Humans | Human-readable per-endpoint breakdown, status badges, request/response bodies, timings |
| **JUnit XML** | CI test-result publishers (GitHub Actions, GitLab, Jenkins, Azure) | Standard `<testsuites>` / `<testsuite>` / `<testcase>` for the platform's native test view |

Secrets are redacted in every artifact (see
[environment-config.md](./environment-config.md) for the redaction
contract).

See [reports.md](./reports.md) for the full report schema and consumer
patterns.

---

## How the pieces fit, in one diagram

```
┌───────────────┐         ┌──────────────┐         ┌──────────────┐
│ declarations  │         │ environment  │         │ apiwright.   │
│ tests/*.json  │         │ qa.yaml etc. │         │ config.json  │
└───────┬───────┘         └──────┬───────┘         └──────┬───────┘
        │                        │                        │
        └────────────┬───────────┴────────────┬───────────┘
                     ▼                        ▼
              ┌─────────────────────────────────┐
              │      apiwright run command       │
              │   validate → plan → filter →     │
              │   execute (N workers) → retry    │
              └────────────────┬─────────────────┘
                               ▼
                  ┌────────────────────────┐
                  │ reports/run-<ts>.json  │
                  │ reports/run-<ts>.html  │
                  │ reports/run-<ts>.xml   │
                  └────────────────────────┘
```

---

## What APIWright is not

To keep the model clean, here's what APIWright explicitly does **not** do:

- It is **not** a multi-step flow tester. One run = one HTTP call per
  generated case. Multi-step flows are v1.5; in v1.0, write those as
  integration tests in your existing stack.
- It is **not** a load tester. For perf/load use k6, Gatling, or Locust.
- It is **not** a contract-testing tool (Pact-style). APIWright is
  provider-side: you declare what the endpoint is and it verifies the
  endpoint behaves that way. See [comparisons.md](./comparisons.md).

See [limitations.md](./limitations.md) for the full v1.0 scope boundary.

---

## Next steps

- **Author your first endpoint** — [Quickstart](https://github.com/anshulgupta1791/apiwright/wiki/Quickstart).
- **See every generator** — [test-catalog.md](./test-catalog.md).
- **Write assertions** — [assertions.md](./assertions.md).
- **Verify DB state** — [db-verify.md](./db-verify.md).
