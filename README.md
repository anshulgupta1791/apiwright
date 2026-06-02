# APIWright — API Testing Framework v1.0

[![Security Gate](https://github.com/anshulgupta1791/apiwright/actions/workflows/security-gate.yml/badge.svg?branch=main)](https://github.com/anshulgupta1791/apiwright/actions/workflows/security-gate.yml)
[![Node.js Version](https://img.shields.io/node/v/apiwright)](https://nodejs.org/)
[![npm version](https://img.shields.io/npm/v/apiwright?logo=npm)](https://www.npmjs.com/package/apiwright)
[![License: Apache 2.0](https://img.shields.io/badge/license-Apache_2.0-blue.svg)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Docker Image](https://img.shields.io/badge/docker-ghcr.io-2496ed?logo=docker&logoColor=white)](https://github.com/anshulgupta1791/apiwright/pkgs/container/apiwright)

> A self-hosted, declarative, Docker-packaged API testing framework. Author endpoints in JSON or import from Postman/OpenAPI; APIWright auto-generates and runs a comprehensive test catalog covering HTTP semantics, schema validation, auth boundaries, input validation, and database state verification.

**Start with a URL. Get ~5 generated tests for free, before you know anything about the response shape. Add schema + assertions only when you're ready, at your own pace.** The minimal-viable endpoint declaration is 8 lines — no upfront spec knowledge required. See [the quickstart](./docs/cookbook/quickstart.md) for the four-phase progressive flow.

## Quick Links

**New here?** Start with **[docs/cookbook/quickstart.md](./docs/cookbook/quickstart.md)** (8-line stub → 5 tests in 10 minutes) and the runnable [`examples/working-example/`](./examples/working-example/). The conceptual model is in **[docs/concepts.md](./docs/concepts.md)** (6 terms); install options are in [docs/installation.md](./docs/installation.md).

**Authoring + reference**

- **[docs/installation.md](./docs/installation.md)** — Docker / npm / from source
- **[docs/concepts.md](./docs/concepts.md)** — declaration → catalog → environment → marker → run → report
- **[docs/canonical-model.md](./docs/canonical-model.md)** — full `*.endpoint.json` schema
- **[docs/test-catalog.md](./docs/test-catalog.md)** — every auto-generated case type
- **[docs/assertions.md](./docs/assertions.md)** — the 20 declarative assertion operators
- **[docs/db-verify.md](./docs/db-verify.md)** — DB state verification (Postgres / MySQL / Mongo / Neo4j)
- **[docs/environment-config.md](./docs/environment-config.md)** — environments, auth strategies, secrets, redaction
- **[docs/postman-import.md](./docs/postman-import.md)** / **[docs/openapi-import.md](./docs/openapi-import.md)** — bootstrapping from existing specs
- **[docs/cli.md](./docs/cli.md)** — every command and flag
- **[docs/configuration.md](./docs/configuration.md)** — `apiwright.config.json` reference

**Operating + scaling**

- **[docs/ci-cd.md](./docs/ci-cd.md)** + **[examples/ci/](./examples/ci/)** — GitHub Actions / Jenkins / GitLab / Azure
- **[docs/docker.md](./docs/docker.md)** — running APIWright as a container
- **[docs/reports.md](./docs/reports.md)** — JSON / HTML / JUnit report shapes
- **[docs/markers-and-lifecycle.md](./docs/markers-and-lifecycle.md)** — when to run which marker in which CI stage
- **[docs/performance-and-scale.md](./docs/performance-and-scale.md)** — workers, sharding, scaling to 1,000+ endpoints
- **[docs/best-practices.md](./docs/best-practices.md)** — file layout, naming, tag taxonomy, schema discipline
- **[docs/docs-generator.md](./docs/docs-generator.md)** — `apiwright docs generate` for auto-fresh API docs

**Stuck or evaluating**

- **[docs/faq.md](./docs/faq.md)** — the 25 most-common questions
- **[docs/troubleshooting.md](./docs/troubleshooting.md)** + **[docs/debugging.md](./docs/debugging.md)** — common errors and how to inspect a failing run
- **[docs/comparisons.md](./docs/comparisons.md)** — APIWright vs. Postman / Karate / REST Assured / Pact / k6 / hand-written tests
- **[docs/limitations.md](./docs/limitations.md)** — what v1.0 does NOT do (deferrals + known issues)
- **[docs/compatibility.md](./docs/compatibility.md)** — SemVer policy: which surfaces are stable across v1.x and how deprecations work
- **[docs/glossary.md](./docs/glossary.md)** — short definitions for every APIWright-specific term
- **[docs/architecture.md](./docs/architecture.md)** — internal module overview (for contributors)
- **[docs/README.md](./docs/README.md)** — full categorised docs index

**Cookbook recipes** ([`docs/cookbook/`](./docs/cookbook/README.md)): [quickstart](./docs/cookbook/quickstart.md), [testing a CRUD API](./docs/cookbook/crud-api.md), [authenticated APIs](./docs/cookbook/authenticated-api.md), [DB side effects](./docs/cookbook/db-side-effects.md), [preparing to import](./docs/cookbook/preparing-to-import.md), [migrating from Postman](./docs/cookbook/migrating-from-postman.md), [migrating from OpenAPI](./docs/cookbook/migrating-from-openapi.md), [setting up CI](./docs/cookbook/setting-up-ci.md).

**Contributing + security**

- **[CONTRIBUTING.md](./CONTRIBUTING.md)** — local setup, branching, test gate
- **[CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)** — community standards
- **[SECURITY.md](./SECURITY.md)** — reporting a security issue (uses GitHub Private Vulnerability Reporting)

## What is APIWright?

APIWright extends QA teams' capabilities by automating 65-85% of API testing work. Instead of writing test code, QAs declare endpoints in JSON and let the framework generate comprehensive tests automatically.

```json
{
  "id": "users.create",
  "name": "Create User",
  "method": "POST",
  "url": "/api/v1/users",
  "request": {
    "body_schema": { "type": "object", "properties": {...} }
  },
  "response": {
    "expected_status": 201,
    "schema": { "type": "object", "properties": {...} }
  },
  "db_verify": [{
    "connection": "primary_postgres",
    "query": "SELECT * FROM users WHERE email = '${request.body.email}'",
    "expect": "match"
  }],
  "assertions": [
    "response.body.id is_uuid_v4",
    "response.body.email equals request.body.email"
  ]
}
```

APIWright automatically generates and runs tests for:

- ✅ Status code conformance
- ✅ Response schema validation
- ✅ Authentication boundaries
- ✅ Required field validation
- ✅ Type constraint violations
- ✅ Boundary value testing
- ✅ Idempotency verification
- ✅ Database state verification
- ✅ Business logic assertions
- ✅ Request/response time SLAs

## Features

### Core Capabilities (v1.0)

- **Declarative Authoring** — Endpoints defined in JSON, no code required
- **Multiple Import Sources** — Postman v2.1, OpenAPI 3.x, and Swagger 2.0 importers; native JSON authoring always available
- **65+ Auto-Generated Tests** — Per endpoint, covering happy path + negatives
- **Schema Validation** — JSON Schema validation on request and response bodies
- **Database Verification** — PostgreSQL, MySQL, MongoDB, Neo4j supported
- **Auth Strategies** — Static token and token-endpoint authentication flows
- **Environment Management** — Multi-environment support (dev, qa, prod) with secrets injection
- **Comprehensive Reports** — HTML + JSON technical reports, JUnit XML for CI
- **Prod-Safe by Default** — Write tests stay gated; reads always safe in production
- **Docker Packaging** — Single image, runs identically everywhere (local, CI, staging, prod)

### Pre-Built Test Catalog

Every endpoint automatically gets tests for:

- Status code conformance
- Content-Type validation
- Response time SLA checks
- Schema validation (request + response)
- Authentication happy path
- Auth boundary testing (no auth, bad token, expired token)
- HTTP method validation
- Malformed input handling
- Required field testing
- Type constraint testing
- Boundary value testing
- Idempotency checks (GET, DELETE)
- Database state verification

### Declarative Assertions

Express business logic checks without writing code:

```json
"assertions": [
  "response.body.id is_uuid_v4",
  "response.body.email equals request.body.email",
  "response.body.created_at is_recent_timestamp",
  "db.primary_postgres.user_check.count_equals 1"
]
```

## Getting Started

### 1. Prerequisites

```bash
node --version           # Verify Node.js 22 LTS
docker --version        # Verify Docker installed
```

### 2. Clone and Install

```bash
git clone <repo-url>
cd apiwright
npm install
```

### 3. Import a Postman Collection (or author endpoints directly)

```bash
# Import an existing Postman v2.1 collection
apiwright import postman ./collections/my-api.postman_collection.json \
  --output ./tests

# Or via Docker
docker run --rm -v $(pwd):/work ghcr.io/anshulgupta1791/apiwright:latest \
  import postman /work/collections/my-api.postman_collection.json \
  --output /work/tests
```

The importer writes one `*.endpoint.json` per Postman request, organised into
subdirectories that mirror the collection's folder hierarchy. Review the
console summary for any warnings about auth strategies that need manual
attention. See [docs/postman-import.md](./docs/postman-import.md) for the full
import guide.

### 4. Validate Your Endpoint Definitions

```bash
# Validate all *.endpoint.json and environment YAML files
apiwright validate ./tests

# Or via Docker
docker run --rm -v $(pwd):/work ghcr.io/anshulgupta1791/apiwright:latest \
  validate /work/tests
```

### 5. First Test Run (Against Sample API)

```bash
# Run smoke tests against QA
apiwright run --env qa --markers smoke

# Or via Docker
docker run --rm \
  -v $(pwd)/tests:/app/tests \
  -v $(pwd)/environments:/app/environments \
  -v $(pwd)/reports:/app/reports \
  -e QA_DB_USER -e QA_DB_PASSWORD \
  ghcr.io/anshulgupta1791/apiwright:latest \
  run --env qa --markers smoke,regression
```

### 6. Wire into CI/CD

Copy the reference workflow for your platform out of [`examples/ci/`](./examples/ci/):

| Platform | File | Drop into |
| --- | --- | --- |
| GitHub Actions | [`examples/ci/github-actions.yml`](./examples/ci/github-actions.yml) | `.github/workflows/apiwright.yml` |
| Jenkins | [`examples/ci/Jenkinsfile`](./examples/ci/Jenkinsfile) | `Jenkinsfile` |
| GitLab CI | [`examples/ci/gitlab-ci.yml`](./examples/ci/gitlab-ci.yml) | `.gitlab-ci.yml` |
| Azure Pipelines | [`examples/ci/azure-pipelines.yml`](./examples/ci/azure-pipelines.yml) | `azure-pipelines.yml` |

Each example runs the published Docker image, forwards `${secret.*}`
references from the platform's secret manager, publishes the JUnit XML
to the platform's native test-result view, and archives the HTML report
as a downloadable build artifact. See
[`examples/README.md`](./examples/README.md) for the placeholder
replacement guide.

## Project Layout

```
apiwright/
├── src/
│   ├── core/              # Canonical endpoint model + meta-schema validator
│   ├── importers/         # OpenAPI 3.x, Swagger 2.0, Postman v2.1
│   ├── cli/               # Commander-based entry point + subcommands
│   ├── runner/            # Test execution engine + workers + retry
│   ├── auth/              # Auth strategies (static_token, token_endpoint)
│   ├── db/                # Database connectors (Postgres / MySQL / Mongo / Neo4j)
│   ├── env/               # Environment loader, secrets, template resolver
│   ├── assertions/        # Declarative assertion engine (20 operators)
│   ├── test-catalog/      # §3 case generators (status / schema / boundary / …)
│   ├── reporting/         # HTML, JSON, JUnit renderers + redaction
│   └── docs/              # Markdown documentation generator
├── tests/
│   ├── unit/              # Unit tests — gated at ≥95% coverage
│   ├── integration/       # Hermetic integration tests (no network)
│   └── fixtures/          # Recorded sample data the tests consume
├── docs/                  # User-facing reference (see Quick Links above)
├── examples/
│   ├── README.md          # CI/CD integration guide
│   └── ci/
│       ├── github-actions.yml
│       ├── Jenkinsfile
│       ├── gitlab-ci.yml
│       └── azure-pipelines.yml
├── configs/               # Vitest, ESLint, Prettier, Semgrep
├── Dockerfile             # Production image (Node 22 LTS)
├── CONTRIBUTING.md        # Contributor guide
├── CODE_OF_CONDUCT.md     # Community standards
├── SECURITY.md            # Security disclosure process
└── package.json
```

## Architecture

The framework consists of nine core modules:

1. **Importers** — Convert Postman/OpenAPI/JSON to internal canonical model
2. **Canonical Model** — Internal endpoint representation (types + validation)
3. **Test Plan Generator** — Expand each endpoint into 50+ test cases
4. **Assertions Engine** — Evaluate declarative business logic checks
5. **Auth Strategies** — Apply credentials (static token, token-endpoint)
6. **Database Connectors** — Execute verification queries (Postgres, MySQL, Mongo, Neo4j)
7. **Environment Manager** — Multi-environment config and secrets injection
8. **Test Runner** — Execute tests with Playwright, manage workers and sharding
9. **Reporters** — Produce HTML, JSON, and JUnit XML reports

See [docs/canonical-model.md](./docs/canonical-model.md) and [docs/environment-config.md](./docs/environment-config.md) for the module-level reference.

## Development Workflow

See [CONTRIBUTING.md](./CONTRIBUTING.md) for local setup, the branching
workflow, coding standards, and how to run the gated check suite (lint,
typecheck, unit + integration tests, 95 % coverage, secret scan, dependency
audit).

## Test Coverage

The framework maintains strict quality gates:

- **Unit Tests**: ≥95% branch coverage on business logic
- **Integration Tests**: Real databases via testcontainers
- **Security**: Semgrep, npm audit, dependency scanning
- **Type Safety**: TypeScript strict mode, no `any` in public API
- **Code Quality**: ESLint, Prettier, max 300-line files, 100-char lines

## Known Limitations (v1.0)

Out of scope for v1.0, planned for later versions:

- ❌ E2E flows (multi-step request sequences) — v1.5
- ❌ Session/cookie authentication — v1.5
- ❌ OAuth user flows — v2.0
- ❌ HMAC/SigV4 signing — v2.0
- ❌ mTLS — v2.0
- ❌ Vector database connectors — v1.5
- ❌ Custom reporter plugins — v1.5
- ❌ GraphQL/gRPC importers — v2.0

## Security

APIWright takes security seriously:

- **No hardcoded secrets** — All credentials injected via environment
- **Prod-safe by default** — Destructive tests gated in production
- **Input validation** — All endpoint JSON validated against meta-schema
- **Dependency scanning** — `npm audit` enforced, semgrep rules custom
- **Type safety** — TypeScript strict mode, no unsafe patterns
- **No code injection** — No eval, template evaluation, or dynamic code

**Current status**: `npm audit` reports zero vulnerabilities on the
published tarball. The earlier transitive chain via `postman-collection`
(lodash <=4.17.23 high + uuid <11.1.1 moderate) was eliminated by
replacing the SDK with an in-house Postman v2.1 schema walker (see
`src/importers/postman/v2-schema.ts`). See [SECURITY.md](./SECURITY.md)
for the disclosure process.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for prerequisites, local setup,
branching workflow, coding standards, and how to run the gated check suite.
Bug reports and feature requests via
[GitHub Issues](https://github.com/anshulgupta1791/apiwright/issues).

## License

Apache License 2.0 — See [LICENSE](./LICENSE)

Permissive, well-understood, includes explicit patent protection for contributors and users.

## Community

- **Issues** — [GitHub Issues](https://github.com/anshulgupta1791/apiwright/issues)
- **Discussions** — [GitHub Discussions](https://github.com/anshulgupta1791/apiwright/discussions)
- **Security** — See [SECURITY.md](./SECURITY.md) for reporting vulnerabilities

---

**APIWright v1.0** — *Making APIs work correctly, one test at a time.*
