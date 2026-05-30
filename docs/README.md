# APIWright Documentation

User-facing documentation for the APIWright API testing framework.
Reference pages (one per feature) live under `docs/`; end-to-end
cookbook recipes (one per scenario) live under
[`docs/cookbook/`](./cookbook/README.md).

---

## Start here

| Doc | What it gets you |
|---|---|
| **[Installation](./installation.md)** | Set up APIWright via Docker, npm, or from source. |
| **[Quickstart](./cookbook/quickstart.md)** | Your first endpoint, end-to-end, in five minutes. |
| **[Concepts](./concepts.md)** | The mental model. Six terms — declaration, catalog, environment, marker, run, report — and how they fit together. |
| **[Glossary](./glossary.md)** | Short definition for every APIWright-specific term. |
| **[FAQ](./faq.md)** | The 25 most-common questions, answered. |
| **[Comparisons](./comparisons.md)** | APIWright vs. Postman/Newman, Karate, REST Assured, Pact, k6, hand-written integration tests. |

---

## Authoring

| Doc | What it covers |
|---|---|
| **[Canonical model](./canonical-model.md)** | The full `*.endpoint.json` schema: every field, every property, every option. |
| **[Test catalog](./test-catalog.md)** | What APIWright auto-generates per endpoint — every §3 generator and the cases it produces. |
| **[Assertions](./assertions.md)** | The 20 declarative assertion operators, their grammar, target paths, and operand types. |
| **[DB verify](./db-verify.md)** | Verifying database side effects after writes — Postgres, MySQL, MongoDB, Neo4j. |
| **[Markers and lifecycle](./markers-and-lifecycle.md)** | smoke / regression / e2e markers, when to use each, and how to wire them into your CI pipeline. |

---

## Importing existing API specs

| Doc | What it covers |
|---|---|
| **[Postman import](./postman-import.md)** | Convert a Postman v2.1 collection into APIWright declarations. |
| **[OpenAPI import](./openapi-import.md)** | Convert an OpenAPI 3.x or Swagger 2.0 spec into APIWright declarations. |

---

## Configuration

| Doc | What it covers |
|---|---|
| **[Environment configuration](./environment-config.md)** | `environments/*.yaml` reference — base URL, databases, auth strategies, secrets injection, redaction contract. |
| **[apiwright.config.json](./configuration.md)** | The CLI configuration file: directories, defaults, workers, retry, report shape. |
| **[CLI reference](./cli.md)** | Every command and flag — `validate`, `run`, `import`, `docs`. |

---

## Operations

| Doc | What it covers |
|---|---|
| **[Reports](./reports.md)** | JSON / HTML / JUnit XML shape, what each carries, how to consume them. |
| **[Docs generator](./docs-generator.md)** | `apiwright docs generate` — auto-generated Markdown documentation per endpoint. |
| **[CI/CD integration](./ci-cd.md)** | Wiring APIWright into GitHub Actions / Jenkins / GitLab / Azure Pipelines. See also [examples/ci/](../examples/ci/). |
| **[Docker usage](./docker.md)** | Running APIWright as a container, mounting test directories, forwarding secrets. |
| **[Performance & scale](./performance-and-scale.md)** | Workers, sharding, retry tuning. Scaling to 500+ endpoints. |
| **[Best practices](./best-practices.md)** | Organising 100+ declarations, naming conventions, marker discipline. |
| **[Debugging](./debugging.md)** | Log levels, what each emits, tracing a failing case. |
| **[Troubleshooting](./troubleshooting.md)** | Common errors and their fixes. |

---

## Honest limits

| Doc | What it covers |
|---|---|
| **[Limitations](./limitations.md)** | What APIWright v1.0 does NOT do — out-of-scope by design, deferred to v1.5 / v2.0, and known issues. |

---

## Cookbook — end-to-end recipes ([`docs/cookbook/`](./cookbook/README.md))

Each recipe walks through a complete task from scratch:

- [Quickstart](./cookbook/quickstart.md) — first endpoint, five minutes.
- [Testing a CRUD REST API](./cookbook/crud-api.md) — full Create / Read / Update / Delete walkthrough.
- [Testing an authenticated API](./cookbook/authenticated-api.md) — `static_token` + `token_endpoint` flows.
- [Verifying DB side effects](./cookbook/db-side-effects.md) — `db_verify` end-to-end against a real Postgres.
- [Migrating from Postman](./cookbook/migrating-from-postman.md) — import + augment.
- [Setting up CI](./cookbook/setting-up-ci.md) — pipeline-by-pipeline.

---

## Contributing

| Doc | What it covers |
|---|---|
| **[Contributing](../CONTRIBUTING.md)** | Local setup, branching, coding standards, the gated test suite. |
| **[Code of Conduct](../CODE_OF_CONDUCT.md)** | Community standards (Contributor Covenant). |
| **[Security](../SECURITY.md)** | Reporting a security issue privately via GitHub Private Vulnerability Reporting. |
