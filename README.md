# APIWright — API Testing Framework v1.0

> A self-hosted, declarative, Docker-packaged API testing framework. Author endpoints in JSON or import from Postman/OpenAPI; APIWright auto-generates and runs a comprehensive test catalog covering HTTP semantics, schema validation, auth boundaries, input validation, and database state verification.

## Quick Links

- **[V1_BUILD_SPEC.md](./V1_BUILD_SPEC.md)** — Complete technical specification for v1.0
- **[QUICKSTART.md](./QUICKSTART.md)** — Get started in 5 minutes
- **[docs/cli.md](./docs/cli.md)** — CLI command reference
- **[docs/postman-import.md](./docs/postman-import.md)** — Postman import guide
- **[docs/](./docs/)** — User guides and feature documentation

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
- **Multiple Import Sources** — Postman v2.1 (functional); OpenAPI 3.x / Swagger 2.0 (available in a later release); native JSON authoring always available
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
docker run --rm -v $(pwd):/work ghcr.io/your-org/apiwright:latest \
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
docker run --rm -v $(pwd):/work ghcr.io/your-org/apiwright:latest \
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
  ghcr.io/your-org/apiwright:latest \
  run --env qa --markers smoke,regression
```

## Project Layout

```
apiwright/
├── src/
│   ├── core/              # Canonical model, schema validator
│   ├── importers/         # Postman, OpenAPI, JSON importers
│   ├── cli/               # Command-line interface
│   ├── runner/            # Test execution engine
│   ├── auth/              # Auth strategies
│   ├── connectors/        # Database connectors
│   ├── assertions/        # Business logic assertions
│   ├── env/               # Environment loader, secrets, template resolver
│   └── reporters/         # HTML, JSON, JUnit XML reports
├── tests/
│   ├── unit/              # Unit tests (passing coverage checks)
│   └── integration/       # Integration tests with real databases
├── docs/
│   ├── cli.md
│   ├── postman-import.md
│   ├── environment-config.md
│   ├── canonical-model.md
│   ├── authoring-endpoints.md
│   ├── assertions-reference.md
│   ├── auth-strategies.md
│   └── connectors.md
├── examples/
│   ├── github-actions/
│   ├── jenkins/
│   ├── gitlab-ci/
│   └── sample-project/
├── configs/               # ESLint, Prettier, Vitest, Semgrep
├── .claude/               # Agent pipeline (development)
├── V1_BUILD_SPEC.md       # Complete technical spec
└── QUICKSTART.md          # Contributor quickstart
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

See [V1_BUILD_SPEC.md](./V1_BUILD_SPEC.md) for detailed architecture diagrams.

## Development Workflow

The project uses a gated, human-controlled agent pipeline for development:

```bash
# Activate the conductor to start work on a task
npx claude "Activate conductor. Run the phases for <goal>."
```

The conductor orchestrates 10 phases:

1. **Plan** — Decompose goal into atomic tasks
2. **Design** — Solution architecture and type design
3. **Tests** — Write failing tests (TDD red phase)
4. **Code** — Implement to pass tests (TDD green phase)
5. **Quality** — ESLint, Prettier, coverage checks
6. **Review** — Semantic code review
7. **Security** — Security audit (semgrep, npm audit)
8. **Docs** — Update user-facing documentation
9. **Integration** — E2E tests and Docker build
10. **Release** — Tag and publish version

See [QUICKSTART.md](./QUICKSTART.md) for contributor setup.

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

**Current Status**: Zero vulnerabilities in code and production dependencies (dev dependencies only in source, excluded from Docker image).

## Contributing

See [QUICKSTART.md](./QUICKSTART.md) for:

- Prerequisites (Node.js 22 LTS, Docker)
- First-time setup
- Development workflow
- How to use the conductor agent pipeline
- Where to find documentation for each phase

## License

Apache License 2.0 — See [LICENSE](./LICENSE)

Permissive, well-understood, includes explicit patent protection for contributors and users.

## Community

- **Issues** — [GitHub Issues](https://github.com/your-org/apiwright/issues)
- **Discussions** — [GitHub Discussions](https://github.com/your-org/apiwright/discussions)
- **Security** — See [SECURITY.md](./SECURITY.md) for reporting vulnerabilities

---

**APIWright v1.0** — *Making APIs work correctly, one test at a time.*
