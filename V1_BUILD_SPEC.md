# APIWright — v1.0 Build Specification

> A self-hosted, declarative, Docker-packaged API testing framework. Author endpoints in JSON or import from Postman/OpenAPI; APIWright auto-generates and runs a comprehensive test catalog covering HTTP semantics, schema validation, auth boundaries, input validation, and database state verification.

---

## About the Name

**APIWright** — *one who makes APIs work correctly.*

The suffix **-wright** belongs to a small family of English words denoting a maker or skilled practitioner: playwright, wheelwright, shipwright, millwright, cartwright. A wright is someone who works with care and craft to produce something that functions properly. APIWright applies that idea to the API testing problem — the framework is the skilled practitioner that takes raw endpoint declarations and crafts the comprehensive test coverage your APIs deserve.

The name was chosen for four reasons:

1. **Domain-evocative.** The `API` prefix immediately communicates what the framework is for; no tagline needed for first-glance recognition.
2. **Distinctive.** "-wright" is rare in software naming, which makes APIWright easy to remember, easy to search, and unlikely to collide with existing products.
3. **Aligned with the mission.** A wright is a craftsperson — diligent, methodical, attentive to detail. That's exactly what the framework does on QAs' behalf: the methodical, comprehensive testing work that humans don't have time to do by hand.
4. **Carries the right posture.** A wright works in service of something larger than themselves. APIWright serves QA teams — it's the extra hand that does the careful, repetitive craft work so QAs can focus on judgment, exploration, and business logic.

---

## Mission Statement

APIWright is an API testing framework designed to extend a QA team's capabilities, not replace them.

QAs declare endpoints, expected behavior, and database queries in JSON. APIWright generates and runs a comprehensive battery of pre-built tests automatically — covering status codes, schema conformance, authentication boundaries, input validation, idempotency, and database state verification. It runs anywhere via Docker, integrates with any CI/CD pipeline that can run a container, emits standard JUnit XML for any reporting dashboard, and exposes clean extension points so teams can plug it into AI agent workflows, custom tooling, or existing test infrastructure.

APIWright handles the mechanical 70% of API testing — the repetitive checks that every endpoint deserves and that no human QA enjoys running by hand. QAs are freed to focus on business logic, exploratory testing, edge cases that require judgment, and the work that genuinely requires a human in the loop.

**APIWright is not a replacement for QAs. It is the extra hand QAs have been asking for.**

---

## The Problem APIWright Solves

API testing at scale has predictable pain points that manual workflows leave unaddressed:

- **Coverage is shallow** because no human has time to run every input-validation, auth-boundary, and idempotency check on every endpoint after every change.
- **Database state is rarely verified** because checking the DB after every API call is tedious; APIs that silently fail to persist data can reach production unnoticed.
- **Manual test runs don't fit cleanly into CI** without an automation layer that turns intent into repeatable, gated executions.
- **API documentation drifts from reality** when it isn't generated from the same source that runs the tests.
- **Reports are typically built for engineers, not for managers**, leaving leadership without visibility into what's actually being tested.

APIWright addresses all five directly: it auto-generates the test catalog QAs would otherwise write by hand; it verifies database state on every write; it runs anywhere via Docker; it produces both human-readable and machine-readable reports; and it can generate documentation from declared endpoint definitions.

---

## Guiding Principles

1. **Declaration over implementation.** QAs declare what an endpoint does; the framework figures out how to test it. No test code in any language.
2. **Self-hosted by design.** The framework runs inside your infrastructure. Your APIs, your databases, your secrets never leave your network.
3. **Polyglot-friendly via standard interfaces.** Authoring is JSON. Execution is Docker. Output is JUnit XML and structured JSON. Any language stack can consume the framework without writing TypeScript.
4. **Honest about coverage.** The framework auto-generates 65–70% of test coverage. Declarative assertions extend that to ~85%. The framework states explicitly what it does and does not check.
5. **Prod-safe by default.** Destructive tests cannot run in production without explicit, interactive confirmation. The framework treats production as different from staging at the infrastructure level, not just by convention.
6. **Extensible at every boundary.** Importers, DB connectors, auth strategies, and reporters are pluggable. Teams add what their environment needs without forking the framework.
7. **AI-workflow ready.** Structured input (JSON) and structured output (JUnit XML + JSON reports) mean AI agents can author endpoint definitions, consume test results, and act on failures without bespoke integration.

---

## Coverage Promise (Honest)

| Coverage Tier | What QAs Provide | What the Framework Covers |
|---|---|---|
| **Tier 1 — Endpoint definition only** | URL, method, auth strategy, request shape, response schema, required fields | ~50–60% of typical manual test cases: status codes, schema conformance, content-type, auth boundary, malformed-input handling, method-not-allowed, basic idempotency |
| **Tier 2 — Endpoint + SQL verification queries** | Above plus DB verification queries for writes | ~65–70%: adds database state verification for POST/PUT/PATCH/DELETE |
| **Tier 3 — Endpoint + SQL + declarative assertions** | Above plus declarative business-rule assertions in JSON (no code, fixed vocabulary) | ~80–85%: adds business-logic checks (computed fields, conditional behavior, cross-field validations) |
| **Out of scope for v1.0** | — | E2E flows across multiple endpoints, UI-coupled testing, async/event-driven verification |

APIWright does not claim 100% coverage. The remaining 15–20% requires either E2E flow testing (v1.5 roadmap) or genuinely human judgment, and the framework is honest about that.

---

## Getting Started — The Workflow

This section describes what onboarding a service into APIWright looks like in practice. A polished `apiwright init` quickstart is deferred to v1.5; in v1.0, the workflow is manual but well-defined.

### 1. Install the Docker image

```bash
docker pull ghcr.io/<org>/apiwright:1.0.0
```

No host-side Node.js installation required. The image bundles the runtime, the CLI, and all dependencies.

### 2. Create the repository structure

```
my-api-tests/
├── apiwright.config.json
├── environments/
│   ├── dev.yaml
│   ├── qa.yaml
│   └── prod.yaml
├── tests/
│   └── (endpoint JSON files go here)
└── .env                          # gitignored; local secrets only
```

### 3. Author one environment file

`environments/qa.yaml`:

```yaml
name: qa
prod: false
base_url: https://api-qa.example.com
default_sla_ms: 1000

databases:
  primary:
    type: postgres
    host: db-qa.example.com
    port: 5432
    database: app_qa
    user: ${secret.QA_DB_USER}
    password: ${secret.QA_DB_PASSWORD}

auth_strategies:
  user_token:
    type: token_endpoint
    url: https://api-qa.example.com/auth/login
    credentials:
      username: ${secret.QA_USER}
      password: ${secret.QA_PASSWORD}
    token_path: $.access_token
    header: Authorization
    header_value: "Bearer ${token}"
```

### 4. Import existing Postman collections (or author endpoint JSON manually)

```bash
docker run --rm -v $(pwd):/work ghcr.io/<org>/apiwright:1.0.0 \
  import postman /work/collections/users.postman_collection.json --output /work/tests/
```

The importer emits one `.endpoint.json` file per Postman request, organized by Postman folders.

### 5. Review and enrich imported endpoints

Open each generated JSON file. The importer fills in URL, method, request shape, and example response. Add:

- `db_verify` block for write endpoints — the SQL/Cypher/Mongo query that verifies the right data landed.
- `assertions` block for business rules — declarative expectations beyond schema conformance.
- Mark required fields, types, and constraints accurately so negative tests generate correctly.

### 6. Validate the test definitions

```bash
docker run --rm -v $(pwd):/work ghcr.io/<org>/apiwright:1.0.0 validate /work/tests/
```

The framework checks every JSON file against the meta-schema and reports any errors before you attempt a run.

### 7. First test run (smoke against QA)

```bash
docker run --rm \
  -v $(pwd)/tests:/app/tests \
  -v $(pwd)/environments:/app/environments \
  -v $(pwd)/reports:/app/reports \
  -e QA_DB_USER -e QA_DB_PASSWORD -e QA_USER -e QA_PASSWORD \
  ghcr.io/<org>/apiwright:1.0.0 \
  run --env=qa --markers=smoke
```

Open `reports/technical-report.html` in a browser to see results.

### 8. Wire into CI/CD

Copy the appropriate reference workflow from `examples/` into your repository (`.github/workflows/`, `Jenkinsfile`, `.gitlab-ci.yml`, etc.). Configure secrets in your CI platform's secret manager. The workflow runs the same Docker command above on every push or PR.

### 9. Generate documentation (optional)

```bash
docker run --rm -v $(pwd):/work ghcr.io/<org>/apiwright:1.0.0 \
  docs generate --source /work/tests/ --output /work/docs/
```

Commit the generated Markdown to your repository or publish it via your documentation platform.

**Expected time, end to end, for a QA new to the framework with an existing Postman collection of ~50 endpoints: 2–4 hours for first import and review, then 30–60 minutes per endpoint to enrich with DB verification and business assertions. Onboarding amortizes quickly because the framework runs forever after that, every commit, with no further authoring.**

---

## Technology Stack

### Core Runtime

| Component | Choice | Rationale |
|---|---|---|
| Language | TypeScript 5.x | Type safety for framework internals; first-class support in Playwright; best ecosystem for AI tool integration as of 2026 |
| Module resolution | NodeNext | Modern, explicit, future-proof |
| Runtime | Node.js 22 LTS | Current LTS, mature, broadly supported |
| Test runner foundation | Playwright (`@playwright/test`) | Native TypeScript; mature worker model; native sharding; HTTP request context built in |
| Container base | `node:22-alpine` | Small image, predictable, broadly trusted |

### Framework Libraries

| Concern | Library | Reason |
|---|---|---|
| CLI | `commander` | Lightweight, well-maintained, sufficient for our needs |
| JSON Schema validation | `ajv` + `ajv-formats` | Industry standard; performant; supports all JSON Schema features we need |
| Postman parsing | `postman-collection` (official Postman SDK) | Handles all v2.1 collection edge cases including pre-request scripts and environments |
| OpenAPI parsing | `@apidevtools/swagger-parser` | Validates and dereferences OpenAPI 3.x and Swagger 2.0 |
| YAML parsing | `js-yaml` | Used for env configs; safe-load only |
| Logging | `pino` | Fast, structured, leveled, JSON-native output |
| JUnit XML | Custom emitter | Small footprint; JUnit XML is well-specified and writing it directly is cheaper than a dependency |
| Templating | Custom resolver | `${env.*}`, `${secret.*}`, `${response.*}` namespaced; intentionally limited |
| Local env loading | `dotenv` | Standard for `.env` files during local dev |
| Date/time | `date-fns` | Used in templating helpers (`is_recent_timestamp`) |
| Process management | `execa` | If shelling out for any custom assertion helpers |

### Database Connectors (v1.0 ships these; interface supports more)

| Database | Library |
|---|---|
| PostgreSQL | `pg` |
| MySQL / MariaDB | `mysql2` |
| MongoDB | `mongodb` (official driver) |
| Neo4j (graph) | `neo4j-driver` |
| Generic SQL fallback | — |

> Vector DB connectors (Pinecone, Weaviate, Qdrant) and additional NoSQL connectors are deferred to v1.5 but the interface supports them.

### Framework's Own Testing

| Concern | Choice |
|---|---|
| Unit testing | Vitest |
| Integration testing | Vitest + testcontainers for DB integration |
| Type checking | `tsc --noEmit` in CI |
| Linting | ESLint with `@typescript-eslint` |
| Formatting | Prettier |

**Live external-API validation (Alpaca PAPER).** Validation against a real
third-party API is split by layer so the merge gate never depends on the
network or secrets:

- **Integration (gated, always-on):** hermetic. `tests/integration/env/alpaca-paper.integration.test.ts`
  drives the shipped `EnvironmentLoader` + `${secret.*}` resolution (creds
  injected, not from `process.env`) and round-trips recorded representative
  Alpaca responses (`tests/fixtures/alpaca/*`) through the importer schema
  engine. No network; runs in `npm test`; counts toward the 95% gate.
- **E2E (opt-in, not gated):** `tests/e2e/alpaca-paper.e2e.test.ts`, run only
  via `npm run test:e2e` (`configs/vitest.e2e.config.ts`; excluded from the
  gated suite). It hits the real **paper** API (read-only `clock`/`account`/
  `assets`) using `ALPACA_KEY_ID`/`ALPACA_SECRET_KEY` from the environment,
  auto-skips when they are absent, and asserts the live shape still matches
  the recorded fixtures (drift guard). PAPER endpoint only; never live
  trading; no mutating calls.
- **Deferred (Phase 10):** the full product E2E — APIWright's own Test
  Runner (§9) executing a declared `.endpoint.json` suite against live
  paper Alpaca via the auth-strategy layer (§6) — lands once the Test
  Runner exists.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                          CLI Entry Point                         │
│       (commander; run, import, validate, docs subcommands)       │
└────────────────────────────────┬────────────────────────────────┘
                                 │
                ┌────────────────┴────────────────┐
                │                                 │
        ┌───────▼────────┐               ┌────────▼────────┐
        │   Importers    │               │ Config Resolver │
        │  (Postman,     │               │  (env files,    │
        │   OpenAPI,     │               │   secrets from  │
        │   JSON native) │               │   process.env)  │
        └───────┬────────┘               └────────┬────────┘
                │                                 │
                └────────────┬────────────────────┘
                             │
                ┌────────────▼─────────────┐
                │ Internal Canonical Model │
                │  (endpoints, schemas,    │       ┌────────────────┐
                │   auth refs, db refs,    │──────▶│  Docs Generator│
                │   assertions)            │       │  (separate     │
                └────────────┬─────────────┘       │   CLI command) │
                             │                     └────────────────┘
                ┌────────────▼─────────────┐
                │   Test Plan Generator    │
                │  (expands each endpoint  │
                │   into N tests by        │
                │   marker; binds          │
                │   assertions)            │
                └────────────┬─────────────┘
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
┌───────▼────────┐  ┌────────▼────────┐  ┌────────▼────────┐
│  Test Runner   │  │ Auth Strategies │  │  DB Connectors  │
│  (Playwright   │  │  (static,       │  │  (Postgres,     │
│   workers,     │◄─┤   token-        │  │   MySQL, Mongo, │
│   sharding)    │  │   endpoint)     │  │   Neo4j, ...)   │
└───────┬────────┘  └─────────────────┘  └─────────────────┘
        │
        │  per-test results +
        │  assertion outcomes
        ▼
┌─────────────────────────────┐
│    Assertion Evaluator      │
│  (declarative vocabulary;   │
│   runs after each endpoint) │
└──────────────┬──────────────┘
               │
┌──────────────▼─────────────────────────────┐
│              Reporters                      │
│  ┌──────────────┐  ┌─────────────────────┐ │
│  │ Technical    │  │ JUnit XML           │ │
│  │ Report (HTML │  │ (CI-ready)          │ │
│  │ + JSON)      │  │                     │ │
│  └──────────────┘  └─────────────────────┘ │
└────────────────────────────────────────────┘
```

The Docs Generator is a separate code path invoked via `apiwright docs generate`. It reads from the same canonical model but does not participate in test runs.

---

## Module-by-Module Build Plan

### 1. Importer System

**Purpose:** Convert various input formats into the framework's internal canonical model.

**What ships in v1.0:**

- **Postman v2.1 importer** — handles folders, requests, environments, pre-request scripts (extracts auth logic where parseable; flags unparseable scripts for manual review), example responses (used to seed response schemas), and disabled requests (skipped with warning). The importer is **fully functional** in this release.

  Implementation notes:
  - Folder structure is mirrored as a directory tree under the output directory; nested folders become nested subdirectories.
  - Postman `{{var}}` tokens are rewritten to `${env.*}` format (matching the environment config grammar). Variable names containing illegal characters are sanitised with a warning.
  - Auth strategy is extracted from the request-level auth block (`bearer` → `user_token`, `basic` → `basic_auth`, `apikey` → `api_key`) or, when no recognised auth block is present, from the pre-request script via a closed allowlist of four string-matched forms. **Scripts are never executed, eval'd, or dynamically interpreted** — the extractor uses string/regex matching only against a closed allowlist and a closed denylist. Any script outside the allowlist (control flow, network calls, crypto/signing, multi-statement, process/eval/dynamic patterns) results in the request being imported without `auth_strategy` and flagged with a manual-review warning.
  - Both item-level (`"disabled": true` on the item) and request-level (`"disabled": true` on the `request` object) disabling are recognised; both skip the request with a warning.
  - Example/saved responses seed `response.expected_status` and `response.schema`; the first 2xx example is preferred over non-2xx examples.
  - Requests with excessively nested bodies are skipped with a warning rather than crashing the import.
  - Every assembled endpoint is validated against the canonical meta-schema before writing; invalid endpoints are dropped with a warning.
  - The import returns a summary: number of files written plus all accumulated warnings.

- **OpenAPI 3.x and Swagger 2.0 importer** — available in a later release. `apiwright import openapi` is wired in the CLI but exits with code 5 until the engine ships.
- **JSON native authoring** — QAs author endpoints directly in the framework's canonical JSON format; primary path for endpoints not present in any spec.
- **Generic importer interface** — `Importer.parse(source) → CanonicalModel[]`; adding GraphQL introspection, gRPC reflection, or other formats later is one implementation behind this interface.

**Importer output schema (canonical JSON shape per endpoint):**

```json
{
  "id": "users.create",
  "name": "Create User",
  "method": "POST",
  "url": "/api/v1/users",
  "auth_strategy": "user_token",
  "request": {
    "headers": { "Content-Type": "application/json" },
    "body_schema": { "type": "object", "properties": {...}, "required": [...] },
    "body_example": { "email": "...", "name": "..." }
  },
  "response": {
    "expected_status": 201,
    "schema": { ... },
    "sla_ms": 500
  },
  "db_verify": [
    {
      "connection": "primary_postgres",
      "query": "SELECT id, email, name FROM users WHERE email = '${request.body.email}'",
      "expect": "match",
      "fields": { "email": "${request.body.email}" }
    }
  ],
  "assertions": [
    "response.body.email equals request.body.email",
    "response.body.id matches uuid_v4"
  ],
  "markers": ["smoke", "regression"],
  "source": { "type": "postman", "collection": "users.postman_collection.json" }
}
```

### 2. Internal Canonical Model

**Purpose:** A single in-memory representation of all endpoints, consumed by every downstream component.

**What ships in v1.0:**

- TypeScript type definitions (`CanonicalEndpoint`, `CanonicalFlow`, etc.) shared across the codebase.
- Validation layer: every imported endpoint validated against a meta-schema before downstream consumption; invalid endpoints rejected with clear errors at framework startup.
- File-based persistence as JSON in the user's repo (importers emit; runner reads).

### 3. Test Catalog (Pre-Built Test Generator)

**Purpose:** Given a canonical endpoint, generate the complete set of tests to run against it.

**What ships in v1.0** (the auto-generated test types, marker shown in brackets):

**Universal tests (run for every endpoint regardless of method):**

- `status_code_conformance` [smoke] — response status matches declared expected status
- `content_type_alignment` [smoke] — Content-Type header matches what schema implies; body is parseable
- `response_time_sla` [smoke] — response time within declared SLA
- `response_schema_validation` [smoke] — body conforms to declared response schema
- `auth_happy_path` [smoke] — correctly authenticated request returns expected 2xx

**Negative tests (run for every authenticated endpoint):**

- `no_auth_returns_401` [regression] — request with auth header stripped returns 401
- `garbage_token_returns_401` [regression] — request with malformed/expired token returns 401
- `method_not_allowed` [regression] — request with unsupported HTTP method returns 405

**Negative tests (run for every endpoint that accepts a body):**

- `malformed_json_returns_400` [regression] — invalid JSON body returns 400
- `required_field_omission_returns_400` [regression] — each required field stripped one at a time; expect 400 for each
- `type_violation_returns_400` [regression] — each typed field substituted with wrong type; expect 400 for each
- `boundary_battery` [regression] — for fields with min/max/enum constraints, send boundary values inside and outside the constraint; expect 200/400 per constraint

**Method-specific tests:**

- `get_idempotency` [regression] — two GETs return identical body
- `delete_idempotency` [regression] — second DELETE returns 404 or 204 per declaration

**DB-state tests (run when `db_verify` is declared, for POST/PUT/PATCH/DELETE):**

- `db_state_matches_expectation` [regression] — declared query executes; result matches declared `expect` mode (`exists`, `not_exists`, `match`, `exact`)

**Marker semantics:**

- `smoke` — happy-path correctness tests. **For read methods (GET, HEAD, OPTIONS)**, smoke tests are non-destructive and safe to run in production by default. **For write methods (POST, PUT, PATCH, DELETE)**, smoke tests genuinely call the endpoint and mutate state; running them in production therefore requires either (a) a designated test tenant/account so writes are isolated, (b) explicit per-endpoint opt-in via `prod_safe: true` in the endpoint JSON declaring that the endpoint is safe to invoke against prod (e.g., idempotent upserts to a synthetic-monitoring account), or (c) skipping smoke for write methods in prod entirely. By default, smoke tests for write methods are skipped in environments flagged `prod: true` unless `prod_safe: true` is set on the endpoint.
- `regression` — includes negative tests, idempotency checks, boundary battery, DB verification; mutates state; not run in production.
- `e2e` — placeholder for v1.5 multi-step flow tests; reserved in v1.0 schema but no e2e tests generated.
- `all` — convenience shorthand for `smoke + regression` in v1.0; will include `e2e` when v1.5 ships.

### 4. Declarative Assertions Engine

**Purpose:** Allow QAs to express business-rule expectations in JSON without writing code.

**What ships in v1.0:**

- Assertion vocabulary (fixed; extensible in code, not via config):
  - Comparison: `equals`, `not_equals`, `greater_than`, `less_than`, `in_range`
  - Pattern: `matches` (regex), `contains`, `starts_with`, `ends_with`
  - Existence: `exists`, `not_exists`, `is_null`, `is_not_null`
  - Type/format: `is_uuid_v4`, `is_iso_timestamp`, `is_recent_timestamp`, `is_email`, `is_url`
  - Aggregate: `count_equals`, `count_greater_than` (for arrays and DB result sets)
- Assertion targets (referenced via dot-notation):
  - `request.headers.*`, `request.body.*`, `request.url.*`
  - `response.status`, `response.headers.*`, `response.body.*`, `response.time_ms`
  - `db.<connection>.<query_id>.*` (results of named verification queries)
- Parser: each assertion is a string parsed at test-plan generation; invalid syntax fails at startup, not at runtime.
- Runner: assertions execute after the auto-generated test catalog for each endpoint; pass/fail captured per assertion.

**Example assertions:**

```json
"assertions": [
  "response.status equals 201",
  "response.body.id is_uuid_v4",
  "response.body.email equals request.body.email",
  "response.body.created_at is_recent_timestamp",
  "response.body.total equals (request.body.subtotal * 1.08)",
  "db.primary_postgres.user_check.count_equals 1"
]
```

### 5. Database Connector Layer

**Purpose:** Execute QA-authored verification queries against any supported database after API calls.

**What ships in v1.0:**

- **Connector interface:**
  ```typescript
  interface DbConnector {
    connect(config: ConnectionConfig): Promise<void>;
    execute(query: string, params?: Record<string, unknown>): Promise<NormalizedResult>;
    disconnect(): Promise<void>;
  }
  ```
- **Built-in connectors:** PostgreSQL, MySQL, MongoDB, Neo4j
- **Normalized result format:** every connector returns `{ rows: Record<string, unknown>[], rowCount: number, raw: unknown }` regardless of underlying DB shape
- **Connection pooling:** managed per-connection-name; reused across tests within a run
- **Templating in queries:** queries can reference `${request.body.*}`, `${response.body.*}`, `${env.*}` at execution time
- **`expect` modes:**
  - `exists` — result has at least one row/document/node
  - `not_exists` — result is empty (used for DELETE verification)
  - `match` — result contains a row where declared fields equal declared values; other fields ignored
  - `exact` — result row equals declared fields exactly (no extras, no missing)

**Deferred to v1.5:** snapshot-diff verification (before/after); vector DB connectors; advanced graph traversal patterns.

**Test data lifecycle — operational guidance:**

Because v1.0 does not include per-test setup/teardown lifecycle hooks (deferred to v1.5 alongside E2E flows), QAs must handle test data accumulation operationally. Three patterns are supported, in order of recommended preference:

1. **Disposable test database, reset between runs.** Run regression tests against a dedicated database that is dropped and recreated (or restored from a baseline snapshot) before each CI run. This is the cleanest pattern and the recommended default for regression and e2e markers. CI pipeline orchestrates the reset; APIWright is unaware of it.
2. **Uniquified test inputs.** QAs author endpoint definitions so each test run uses unique identifiers — typically by including `${env.run_id}` or `${env.timestamp}` in test inputs. Created records accumulate but never collide. Periodic external cleanup (a nightly job that truncates old test data) keeps the database from growing unbounded. Suitable when a disposable test DB is impractical.
3. **QA-authored cleanup queries.** Each write endpoint declares an optional `cleanup` block in its JSON, containing a DB query the framework runs after the verification query. This is a v1.0 affordance that gives QAs explicit control but adds authoring burden per endpoint. Should be used selectively for the most critical or hardest-to-uniquify endpoints.

The framework does not auto-clean up test data and does not roll back transactions; both would require semantic knowledge of the API and DB schema that the framework deliberately does not have.

### 6. Authentication Strategy Layer

**Purpose:** Apply auth credentials to outgoing requests without hardcoding strategy-specific logic into the test runner.

**What ships in v1.0:**

- **Strategy interface:**
  ```typescript
  interface AuthStrategy {
    apply(request: PreparedRequest, context: RunContext): Promise<AuthorizedRequest>;
  }
  ```
- **`static_token` strategy** — reads token from env vars, attaches as configurable header (`Authorization: Bearer ${token}`, or any custom header pattern)
- **`token_endpoint` strategy** — hits configured URL at run start with configured credentials, extracts token from response via JSONPath, caches for run duration, attaches to subsequent requests; supports token refresh based on declared expiration
- Strategy configuration lives in environment YAML files, not per-endpoint; endpoints reference strategy by name
- Negative auth tests (`no_auth_returns_401`, `garbage_token_returns_401`) bypass or mangle the strategy's output to generate the attack vector

**Deferred to v1.5:** session cookie auth, OAuth user flows, HMAC/SigV4 signing, mTLS.

### 7. Environment Manager

**Purpose:** Allow tests to run unchanged across multiple environments by externalizing all environment-specific values.

**What ships in v1.0:**

- **Environment files:** YAML, one per environment. Two file locations are supported and tried in order:
  1. `<rootDir>/.env.<name>.yaml` — root-level dotfile; gitignored; intended for local overrides and real secrets on a developer's machine.
  2. `<rootDir>/environments/<name>.yaml` — committed file; use `${secret.*}` references here instead of literal credentials.

  Both paths are resolved relative to the repository root. `<rootDir>` is determined from `environments_dir` in `apiwright.config.json` (default `"./environments"`): the loader derives the repo root as `dirname(resolve(environments_dir))` and then appends `environments/` itself when looking up the committed fallback path. Concretely, with the default config, `--env qa` resolves the committed file at `./environments/qa.yaml` relative to the repo root. The `environments_dir` config key should point at the `environments/` directory itself; the loader constructs the full path internally.

  The loader tries the dotfile first. The fallback is tried only when the dotfile is genuinely absent. A dotfile that exists but is malformed or empty surfaces its own error and does not fall through to the committed file.

- **Variable namespaces:**
  - `${env.*}` — environment-specific values (base URL, DB host, tenant ID, SLA thresholds); resolved against the env document; nested paths supported (`${env.db.host}`)
  - `${secret.*}` — secrets resolved from `process.env` with no prefix (`${secret.FOO}` reads `process.env.FOO`); namespace isolation is structural — `${env.*}` has no access to `process.env`
  - `${response.*}` — runtime values captured from API responses
  - `${request.*}` — values from the current request payload
  - `${db.<connection>.<query>.*}` — results from named DB queries
- **Resolution rules:**
  - Namespaces never overlap; `${env.foo}` cannot reference a secret
  - Missing env values fail at startup with explicit error listing which references failed
  - Missing secrets fail at startup before any test runs; all missing secrets named in one message
  - The loader never throws on user-config errors; every failure returns a structured result with aggregated messages
- **Per-environment overrides:** an `environments:` map in the YAML document is deep-merged at load time (`environments[name]` merged over the base); the `environments` key is stripped from the result; plain objects merge key-by-key, arrays and scalars replace wholesale.
- **Prod safety:**
  - Each environment file declares `prod: true | false`
  - When `prod: true`, only `--markers=smoke` runs without confirmation
  - Other marker selections (`regression`, `e2e`, `all`) trigger an interactive prompt: `WARNING: You are about to run non-smoke tests against prod. Type 'CONFIRM' to proceed:`
  - In CI, the prompt fails fast unless `--allow-non-smoke-in-prod` flag is passed; this flag is itself gated to require additional CI env var (`ALLOW_PROD_DESTRUCTIVE=true`)

**Example environment file (`environments/qa.yaml`):**

```yaml
name: qa
prod: false
base_url: https://api-qa.example.com
default_sla_ms: 1000

databases:
  primary_postgres:
    type: postgres
    host: db-qa.example.com
    port: 5432
    database: app_qa
    user: ${secret.QA_DB_USER}
    password: ${secret.QA_DB_PASSWORD}

auth_strategies:
  user_token:
    type: token_endpoint
    url: https://api-qa.example.com/auth/login
    credentials:
      username: ${secret.QA_USER}
      password: ${secret.QA_PASSWORD}
    token_path: $.access_token
    header: Authorization
    header_value: "Bearer ${token}"
```

### 8. Secrets Resolution

**Purpose:** Resolve secret values from CI/CD environment variables without ever persisting them to disk or logs.

**What ships in v1.0:**

- All `${secret.FOO}` references resolved from `process.env.FOO` at framework startup
- Local development: `.env` file loaded via `dotenv` if present (gitignored)
- CI: secrets injected by Jenkins/GitHub Actions/GitLab CI as job-level environment variables
- **Fail-fast validation:** before any test runs, framework scans all loaded configs for `${secret.*}` references and verifies each resolves to a non-empty value
- **Log redaction:** in-memory registry of resolved secret values; every log/report output passes through a redactor that replaces secret values with `[REDACTED]` before serialization
- **No secret store integration in v1.0:** Vault/AWS Secrets Manager/GCP Secret Manager are out of scope; the framework relies on the CI/CD platform's existing secret management

### 9. Test Runner

**Purpose:** Discover, schedule, and execute the test plan with appropriate parallelism, retries, isolation, and reporting hooks.

**What ships in v1.0:**

**Test discovery and file organization:**

- **Recursive directory walk.** The framework walks the configured test directory (default: `tests/`) to any depth and loads all files matching the naming convention. Directory structure carries no semantic meaning to the framework — QAs organize files however makes sense for their team.
- **File naming convention is the only contract.** Files matching `*.endpoint.json` are loaded as endpoint definitions; files matching `*.flow.json` are reserved for v1.5 flows; all other files are ignored. This lets QAs keep notes, fixtures, schemas, and READMEs alongside their tests without confusing the loader.
- **Recommended organization — feature/module hierarchy.** QAs typically structure tests by service or feature, then by sub-module, in a Page-Object-Model-style hierarchy:
  ```
  tests/
    user-service/
      users/
        create.endpoint.json
        update.endpoint.json
        delete.endpoint.json
      sessions/
        login.endpoint.json
        logout.endpoint.json
    payment-service/
      transactions/
        charge.endpoint.json
        refund.endpoint.json
  ```
  The framework is agnostic to the specific scheme, but this structure is what reference examples and the Postman importer produce by default.
- **Cross-cutting tags inside endpoint JSON.** Each endpoint can declare `tags: ["billing", "critical-path", "smoke-prod-safe"]`. Tags are independent of directory structure and let endpoints in different folders be grouped at run time.

**Filtering options at run time** (combinable; all flags AND together):

- `--markers=smoke` / `--markers=smoke,regression` / `--markers=all` — filter by test marker
- `--path=tests/user-service/` — filter by directory subtree (runs only endpoints under that path)
- `--tag=billing` — filter by endpoint tag (orthogonal to directory)
- `--endpoint=users.create` — run a single endpoint by its declared `id`
- `--exclude-tag=slow` — exclude endpoints with a given tag

**Parallelism and sharding:**

- **Worker parallelism:** Playwright's worker model; configurable `--workers=N`; default = number of CPU cores.
- **Sharding:** `--shard=N/M` splits the deterministically-ordered test plan across M parallel CI jobs; shard N runs its slice; results merged post-run.
- **Execution order:** within a worker, sequential; across workers, parallel; deterministic ordering for shard correctness.

**Retry behavior:**

Transient failures (network blips, momentary DB contention, slow infrastructure) are inevitable at 1,000+ endpoints. The framework supports automatic retries on test failure, controlled centrally:

- **Retry triggers.** A test is retried when its assertion fails — regardless of whether the failure is "got wrong status," "schema validation failed," "DB verification returned wrong result," or "request raised a network exception." A "failure" is any divergence between actual and expected; the framework retries on all failure types because flakiness can produce any of them.
- **Configuration is centralized.** Retry policy is set once in `apiwright.config.json` and applies framework-wide:
  ```json
  {
    "retry": {
      "count": 2,
      "delay_ms": 1000,
      "backoff": "linear"
    }
  }
  ```
  Defaults: `count: 2` (one initial attempt plus up to two retries = up to three attempts total), `delay_ms: 1000`, `backoff: "linear"` (other options: `"exponential"`, `"none"`).
- **Per-endpoint override.** Individual endpoints can override the global policy via a `retry` block in the endpoint JSON when needed. Otherwise, the global policy applies — change in one place, takes effect everywhere.
- **CLI override.** `--retries=N` overrides the config file value for a single run (useful for CI debugging).
- **Retry semantics.** The framework re-executes the entire test (re-sends the request, re-runs all assertions, re-runs DB verification). Retries do not partially re-run; each attempt is a clean execution.
- **Pass-after-retry policy (lenient by default).** A test that fails its initial attempt but passes on a subsequent attempt is reported as **passed with a "flaky" warning**. The CI does not break for retry-passes; the report surfaces them so teams can address flakiness deliberately. Strict mode (`retry.strict: true` in config) treats any first-attempt failure as a fail regardless of subsequent passes; teams adopt strict mode once their suite has stabilized.
- **Reporting integration.** Every attempt's full request/response/timing/assertion trace is captured to the technical report regardless of log level. Console output filters traces by log level (see Reporting below).

**Lifecycle hooks:**

- Per-endpoint setup/teardown is supported in v1.0 only at the connection level (DB connections opened, auth tokens fetched once at run start). Per-test setup/teardown is deferred to v1.5 alongside E2E flows.

### 10. Reporting

**Purpose:** Produce outputs for human consumption and CI/CD integration.

**What ships in v1.0:**

**Technical report (HTML + JSON sidecar):**
- HTML rendered locally; opens in browser
- Per-endpoint detail: request payload, response body, response time, schema validation result, every auto-generated test pass/fail, every declarative assertion result, DB query results
- **All retry attempts captured.** Every attempt's full request/response/timing/assertion trace is stored, regardless of console log level. Tests that pass after retry show all prior attempts as "flaky" entries with full traces. Nothing is ever discarded from the report.
- Failure context: stack traces (where applicable), diff output for schema mismatches, query result tables
- Run summary: total/passed/failed/flaky counts; flaky list separately surfaced for triage
- JSON sidecar: same content as machine-readable JSON for downstream tooling

**Console output (controlled by `--log` level):**

The framework distinguishes between what's *captured* (always everything, in the report) and what's *displayed* during the run (filtered by log level). Default log level is `warn` — verbose enough to see real problems, quiet enough that the console isn't a wall of noise during a 1,000-endpoint run.

- `--log=error` — show only test failures (after retries exhausted); no retry-pass notices; no per-test progress; final summary only.
- `--log=warn` (**default**) — show test failures plus a one-line notice for each flaky test ("`users.create` passed on attempt 2 after 1 retry"). No verbose request/response dumps. No per-test progress in non-CI mode.
- `--log=info` — above plus per-test progress (one line per test as it runs), retry-attempt summaries with first-attempt failure reasons.
- `--log=debug` — above plus full request/response bodies for every attempt, full DB query results, full assertion evaluation traces. Use for debugging flakiness or unexpected failures locally; produces large output volumes.

Log level is configurable via `apiwright.config.json` (same as retry config — one place to change), overridable per-run via `--log=` flag.

**JUnit XML:**
- Standard JUnit XML format consumed by every CI/CD system
- Each endpoint = one test suite; each auto-generated test + each declarative assertion = one test case
- Flaky tests (passed after retry) are reported as `passed` with a `<system-out>` note indicating retry count; CI does not break, but the information is preserved.
- Compatible with Jenkins test result publisher, GitHub Actions test reporting, GitLab CI test reports, Azure DevOps test integration

**Deferred to v1.5:** management-style plain-English report, AI-powered failure triage.

### 11. Markdown Documentation Generator

**Purpose:** Generate per-endpoint Markdown documentation from declared endpoint definitions.

**What ships in v1.0:**

- One MD file per endpoint, output to a configurable directory (default: `docs/endpoints/`)
- Content per file (declared sources only — no observation store in v1.0):
  - Header: endpoint name, URL, method, environments tested
  - Authentication: strategy name and what it requires
  - Request: schema rendered as readable table, example payload
  - Response: schema, example response body, expected status code
  - Database side effects: tables/collections/nodes referenced in `db_verify`
  - Test coverage: which auto-generated tests run for this endpoint, plus the assertion list
  - Markers: which markers this endpoint participates in
- Stable, deterministic output: same inputs produce byte-identical Markdown; safe to commit to git and diff in PRs

### 12. Command Line Interface

**Purpose:** Single, discoverable entry point for all framework operations.

**What ships in v1.0:**

```bash
apiwright run --env=qa --markers=smoke,regression --log=info
apiwright run --env=prod --markers=smoke   # safe; no confirmation needed
apiwright run --env=prod --markers=regression   # triggers interactive confirmation
apiwright import postman ./collections/users.postman_collection.json --output ./tests/
apiwright import openapi https://api.example.com/openapi.json --output ./tests/
apiwright validate ./tests/   # checks all JSON files against meta-schema
apiwright docs generate --output ./docs/
apiwright --version
apiwright --help
```

All flags are also configurable via `apiwright.config.json` in the repo root. The config file is the single source of truth for framework-wide defaults; CLI flags override the config for a single run.

**Example `apiwright.config.json`:**

```json
{
  "tests_dir": "./tests",
  "environments_dir": "./environments",
  "reports_dir": "./reports",
  "default_env": "qa",
  "default_markers": ["smoke"],
  "log_level": "warn",
  "workers": 8,
  "retry": {
    "count": 2,
    "delay_ms": 1000,
    "backoff": "linear",
    "strict": false
  },
  "report": {
    "html": true,
    "json": true,
    "junit_xml": true,
    "output_dir": "./reports"
  }
}
```

Change a setting once in the config file; every test run uses the new value. This is the canonical pattern for log level, retry count, worker count, default environment, and report destinations — set once, apply everywhere.

### 13. Docker Packaging

**Purpose:** Single distributable unit; runs identically locally and in any CI/CD.

**What ships in v1.0:**

- `Dockerfile` based on `node:22-alpine`
- Image published to a public container registry (Docker Hub, GitHub Container Registry)
- Image tagged by version (`apiwright:1.0.0`, `apiwright:latest`) and by SHA
- Mounts: test directory, environment directory, output directory
- Environment variable passthrough: all `${secret.*}` references resolved from container env
- Entry point invokes the CLI with passed arguments
- Image size target: < 200MB

**Example usage:**

```bash
docker run --rm \
  -v $(pwd)/tests:/app/tests \
  -v $(pwd)/environments:/app/environments \
  -v $(pwd)/reports:/app/reports \
  -e QA_DB_USER -e QA_DB_PASSWORD -e QA_USER -e QA_PASSWORD \
  ghcr.io/<org>/apiwright:1.0.0 \
  run --env=qa --markers=smoke,regression
```

### 14. CI/CD Integration Examples (ships as documentation, not as features)

**Purpose:** Lower friction for adoption by providing copy-paste integrations for major CI platforms.

**What ships in v1.0** (in the README and `examples/` directory):

- GitHub Actions workflow YAML
- Jenkins declarative pipeline `Jenkinsfile`
- GitLab CI `.gitlab-ci.yml`
- Azure Pipelines YAML
- Each example shows: running the container, passing secrets, archiving the JUnit XML, publishing the HTML report as a build artifact

---

## Integration with Your QA Toolchain

APIWright is designed to plug into the tools QA teams already use. Every integration point uses standard formats and protocols so no custom adapters are needed.

### API Authoring & Exploration Tools

- **Postman** — Import existing Postman v2.1 collections directly via `apiwright import postman`. Postman continues to serve its purpose as an exploratory and manual-testing tool; QAs prototype new endpoints there, then import into the framework for automation.
- **Bruno, Insomnia, Hoppscotch** — Export to Postman v2.1 format, then import. The framework's importer interface is also open for native connectors for these tools as a v1.5 addition.
- **OpenAPI / Swagger** — Import directly from a spec URL or file via `apiwright import openapi`. Services that auto-generate specs (FastAPI, NestJS, Spring Boot with springdoc, ASP.NET Core, Flask with `flask-restx`) become test targets immediately with zero authoring effort.
- **IDE (VS Code, IntelliJ, Cursor, Zed)** — Endpoint JSON files are standard JSON; QAs edit them in their preferred IDE. The framework publishes a JSON Schema alongside its releases, enabling autocomplete, inline validation, and hover documentation in any editor that supports JSON Schema.

### CI/CD Platforms

- **GitHub Actions, Jenkins, GitLab CI, Azure Pipelines, CircleCI, Buildkite, Bitbucket Pipelines, Drone** — All consume the Docker image identically. The framework requires only `docker run` capability and environment variable injection for secrets. Reference workflows for the major platforms ship in the `examples/` directory.
- **Self-hosted runners and custom CI** — Any system that can run a Docker container can run APIWright. The CLI is the only contract.

### Test Management Systems

- **TestRail, Zephyr Scale, qTest, Xray for Jira, PractiTest** — All consume JUnit XML output natively. Test case results flow back into the test management system without custom integration; failed runs link directly to the corresponding test management entry.
- **TestLink, Kiwi TCMS** — Same JUnit XML pathway.

### Reporting & Observability Platforms

- **Allure** — Convert JUnit XML to Allure format via standard converters, or generate Allure-compatible reports directly from the framework's structured JSON output.
- **ReportPortal** — Ingests JUnit XML directly; supports the framework's full output without additional configuration.
- **Grafana, Datadog, Splunk, ELK Stack, New Relic** — Ship the framework's structured JSON output to log and metrics platforms via standard collectors (Fluentd, Filebeat, Datadog Agent, Splunk Forwarder). Track pass rates, response time percentiles, and failure patterns alongside production telemetry in your existing dashboards.
- **Prometheus** — Convert JSON results to Prometheus metrics format via lightweight exporters; track test outcomes alongside infrastructure metrics.

### Bug Tracking & Issue Management

- **Jira, Linear, GitHub Issues, GitLab Issues, Azure Boards, Asana** — Wire failure events from your CI/CD platform to file issues automatically when tests fail. The framework's structured JSON output provides the failure context (endpoint, expected vs actual, request/response, stack trace) needed to populate the issue.
- **PagerDuty, Opsgenie** — Trigger alerts on critical failures (typically smoke-test failures in production) via your CI/CD platform's webhook integration.

### Team Communication

- **Slack, Microsoft Teams, Mattermost, Discord, Rocket.Chat** — Use your CI/CD platform's notification mechanism (Jenkins notifiers, GitHub Actions webhooks, GitLab CI integrations) to alert on failures. The framework provides the data; your platform handles delivery.
- **Email** — Same pattern; standard CI/CD email reporters consume the framework's JUnit XML output.

### AI Agents & AI Coding Tools

- **Claude Code, Cursor, GitHub Copilot, Aider, Continue** — These tools work directly with the framework's JSON files. AI agents author new endpoint definitions, propose declarative assertions, explain failure output in plain English, and refactor test definitions in bulk. The framework's structured input/output is designed to be consumed by LLMs without intermediate translation.
- **MCP (Model Context Protocol) servers** — The framework's CLI and structured outputs allow easy wrapping in an MCP server, letting AI agents invoke test runs, query results, and modify endpoint definitions through a standard protocol. A reference MCP server may ship in v1.5.
- **Custom agentic workflows** — JSON in, JSON out. Any agentic system that reads and writes JSON can drive the framework or consume its results. Pair the framework with internal AI agents to auto-triage failures, propose schema updates from observed responses, or generate endpoint definitions from natural-language descriptions.
- **LangChain, LlamaIndex, CrewAI, AutoGen** — Wrap the framework's CLI as a tool in any of these agent frameworks; the structured JSON output flows back to the LLM cleanly.

### Database & Data Tooling

- **DBeaver, pgAdmin, MongoDB Compass, Neo4j Browser, DataGrip, TablePlus** — QAs author DB verification queries in their familiar database tool, then paste into endpoint JSON files. The framework executes them exactly as written.
- **Mockaroo, Faker, JSON Generator, Test Data Manager tools** — Generate fixture and seed data referenced by endpoint definitions; data files plug in via standard file paths.
- **dbt** — Pair with dbt-managed test environments to seed known data before runs.

### API Mocking & Service Virtualization

- **WireMock, Mockoon, Prism, MockServer, Hoverfly** — Point the framework at a mock server's base URL for testing against simulated upstream dependencies. The framework treats mocks identically to real APIs since both speak HTTP.

### Documentation Platforms

- **Confluence, Notion, GitBook, MkDocs, Docusaurus, Read the Docs, Backstage** — The framework's Markdown documentation generator outputs standard `.md` files that embed in any documentation platform. Generate on every release in CI and publish automatically.
- **API portals** — The generated Markdown can feed internal API portals as the canonical reference for what each endpoint does and how it's verified.

### Version Control

- **Git (GitHub, GitLab, Bitbucket, Gitea, Azure Repos)** — All test definitions are JSON files committed to git. Endpoint changes are reviewed in pull/merge requests alongside code changes. Diffable, blameable, branchable, revertible.

### Secrets Management

- **Jenkins Credentials, GitHub Actions Secrets, GitLab CI Variables, Azure Key Vault references** — Inject as job-level environment variables; the framework reads from `process.env`. No additional integration needed.
- **HashiCorp Vault, AWS Secrets Manager, GCP Secret Manager, Azure Key Vault, 1Password CLI** — Pull secrets into the CI job's environment via your CI's existing integration before the framework runs. The framework remains agnostic to the source; whatever ends up in `process.env` works.

### Cloud & Container Platforms

- **Kubernetes (Jobs, CronJobs), Amazon ECS, Google Cloud Run, Azure Container Instances** — Run the framework's Docker image as a one-shot job or scheduled task in any container orchestration platform.
- **Local Docker, Docker Compose, Podman** — Identical execution path for local development and debugging.

---

## Project Repository Layout

```
apiwright/
├── README.md
├── LICENSE
├── CHANGELOG.md
├── package.json
├── tsconfig.json
├── Dockerfile
├── .dockerignore
├── docker-compose.yml             # for local development of the framework itself
├── src/
│   ├── cli/                       # commander entry points
│   ├── importers/
│   │   ├── postman/
│   │   ├── openapi/
│   │   └── native-json/
│   ├── core/
│   │   ├── canonical-model.ts
│   │   ├── test-plan-generator.ts
│   │   ├── templating.ts
│   │   └── meta-schema.ts
│   ├── tests/                     # the pre-built test catalog
│   │   ├── status.ts
│   │   ├── schema.ts
│   │   ├── auth.ts
│   │   ├── negative.ts
│   │   ├── boundary.ts
│   │   ├── idempotency.ts
│   │   └── db-verify.ts
│   ├── assertions/
│   │   ├── parser.ts
│   │   ├── vocabulary/
│   │   └── runner.ts
│   ├── connectors/
│   │   ├── interface.ts
│   │   ├── postgres.ts
│   │   ├── mysql.ts
│   │   ├── mongodb.ts
│   │   └── neo4j.ts
│   ├── auth/
│   │   ├── interface.ts
│   │   ├── static-token.ts
│   │   └── token-endpoint.ts
│   ├── env/
│   │   ├── loader.ts          # EnvironmentLoader: orchestrates the full load pipeline
│   │   ├── yaml-reader.ts     # js-yaml safe-load (JSON_SCHEMA; no code execution)
│   │   ├── template-resolver.ts  # ${env.*} resolution against the env document
│   │   ├── secrets.ts         # ${secret.*} resolution from process.env; SecretRegistry
│   │   ├── schema.ts          # AJV schema validator for resolved env documents
│   │   ├── types.ts           # ResolvedEnvironment and related TypeScript types
│   │   ├── tree-walk.ts       # Utility: walk/map string leaves in a config tree
│   │   └── index.ts           # Public re-exports
│   │   # prod-safety.ts (prod gate / interactive confirmation) — separate module
│   ├── runner/
│   │   ├── discovery.ts
│   │   ├── filtering.ts
│   │   └── executor.ts
│   ├── reporters/
│   │   ├── technical-html.ts
│   │   ├── technical-json.ts
│   │   └── junit-xml.ts
│   └── docs-generator/
│       └── markdown.ts
├── tests/                          # framework's own tests
│   ├── unit/
│   ├── integration/
│   └── fixtures/
├── examples/
│   ├── github-actions/
│   ├── jenkins/
│   ├── gitlab-ci/
│   ├── azure-pipelines/
│   └── sample-project/             # working example of using the framework
└── docs/
    ├── getting-started.md
    ├── authoring-endpoints.md
    ├── assertions-reference.md
    ├── connectors.md
    ├── auth-strategies.md
    └── ci-integration.md
```

---

## What Is NOT in v1.0 (Explicit Scope Boundaries)

The following are deliberately out of scope. Listing them prevents scope creep and sets honest expectations with users.

### Deferred to v1.5

- Multi-step E2E flows with step chaining, templating across steps, and mandatory teardown
- Snapshot-diff DB verification (before/after diffing to catch side effects)
- Session cookie authentication strategy
- Management-style plain-English report
- AI-powered failure triage layered on the management report
- Opinionated quickstart mode (`apiwright init` that scaffolds a working setup in 5 minutes)
- Vector DB connectors (Pinecone, Weaviate, Qdrant)
- Per-test setup/teardown lifecycle hooks
- Custom reporter plugins

### Deferred to v2.0 or later

- Cross-language extension protocol (currently TypeScript-only for custom connectors/strategies)
- GraphQL and gRPC importers
- OAuth user-flow authentication (authorization code, PKCE)
- HMAC and AWS SigV4 request signing
- mTLS support

### Not planned

- Hosted execution from a cloud service (the framework is self-hosted by design)
- Built-in run history dashboard (use the CI/CD platform's existing reporting)
- Built-in scheduled runs (use CI/CD platform's cron capability)
- Distributed test orchestration (CI sharding handles this when needed)
- UI/browser testing (use Playwright directly for that)
- Performance/load testing (different problem; use k6, Gatling, JMeter)

---

## v1.5 Roadmap (Tentative, In Priority Order)

1. **E2E flows with step chaining** — Level 2 design from the spec: linear sequence + setup/teardown + variable extraction + assertions-at-end model.
2. **Quickstart mode** — `apiwright init` walks a QA from "Postman collection in hand" to "first test run" in under 15 minutes with sensible defaults.
3. **Management-style report** — second report variant; plain-English failure summaries; jargon expansions; designed with input from actual managers.
4. **AI-powered failure triage** — LLM integration that analyzes failures and explains likely root cause in the management report.
5. **Snapshot-diff DB verification** — before/after diffing for unintended side-effect detection.
6. **Session cookie auth strategy** — third built-in auth strategy.
7. **Vector DB connectors** — Pinecone, Weaviate, Qdrant at minimum.
8. **Custom reporter plugin interface** — load user-authored reporters via configuration.

---

## Success Criteria for v1.0

APIWright v1.0 is shippable when:

1. A QA can import a Postman collection and have a working test suite running in under 30 minutes (zero TypeScript code authored).
2. The framework runs against a real internal API with PostgreSQL DB verification, in CI, with secrets supplied via GitHub Actions or Jenkins, producing JUnit XML consumed by the CI's native test reporter.
3. Running `--markers=smoke` in a production-flagged environment completes without confirmation prompts. Running `--markers=regression` in the same environment triggers the confirmation gate.
4. The Postman importer successfully ingests a 100+ request collection including pre-request scripts, environments, and folders, with explicit warnings for any unparseable scripts.
5. All 12 built-in test types in the pre-built catalog generate and run correctly for at least one endpoint of each HTTP method.
6. The Docker image runs identically on a developer laptop and in a clean CI runner with no host configuration differences.
7. Test coverage of the framework's own codebase is ≥ 80% (unit + integration combined).
8. End-to-end framework run time on a 100-endpoint suite with 8 workers is under 5 minutes for `--markers=smoke,regression`.
9. A test that fails on first attempt due to a simulated transient failure (e.g., injected connection reset) and passes on retry is reported as `passed` with a flaky annotation in both the technical report and JUnit XML; the CI build does not break.
10. Changing `log_level` or `retry.count` in `apiwright.config.json` and re-running produces the expected behavior without any CLI flag changes — the config file is the single source of truth.

---

## Glossary

- **Canonical model:** the framework's internal representation of an endpoint, after all importers have converted their formats into a shared shape.
- **Marker:** a tag (`smoke`, `regression`, `e2e`, `all`) attached to tests; QAs select which markers to run at invocation time.
- **Pre-built test catalog:** the fixed set of test types the framework generates for every endpoint automatically based on HTTP method and declared schema.
- **Declarative assertion:** a business-rule check expressed in JSON using a fixed vocabulary; QA authors this instead of writing test code.
- **DB verification query:** a SQL/Cypher/Mongo query authored by QA, executed by the framework after write operations to verify database state.
- **Connector:** a pluggable component that wraps a specific database type and exposes the framework's unified DB interface.
- **Auth strategy:** a pluggable component that knows how to authenticate outgoing requests for a particular auth scheme.
- **Environment:** a named set of configuration values (base URL, DB credentials, auth credentials, SLA thresholds) the framework loads at run start.
- **Prod safety gate:** the rule that production-flagged environments only run smoke tests by default and require explicit confirmation for anything else.
- **Tag:** a free-form QA-applied label inside endpoint JSON (e.g., `billing`, `critical-path`) used for cross-cutting test selection independent of directory structure.
- **Flaky test:** a test that fails its initial attempt but passes on retry; reported as passed with a flaky annotation rather than breaking CI.
- **Pass-after-retry (lenient mode):** the default reporting policy where tests that succeed within the configured retry budget are counted as passes; strict mode treats any first-attempt failure as a fail.
- **Attempt trace:** the full request, response, timing, and assertion record captured for every individual retry attempt; preserved in the technical report regardless of console log level.

---

## License

**Apache License 2.0.** Permissive, well-understood, allows commercial adoption while providing patent protection for both contributors and users. Includes an explicit grant of patent rights from contributors, which protects downstream users from contributor-held patents covering their contributions. The right default for an open-source developer tool intended for enterprise adoption.

The `LICENSE` file in the repository root contains the full Apache 2.0 text.

---

*This specification represents the v1.0 build target. Changes between v1.0 release and this document should be reflected by updating this file; the spec is the source of truth for what v1.0 means.*
