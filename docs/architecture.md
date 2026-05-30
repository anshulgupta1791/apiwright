# Architecture

This page is for contributors and anyone who wants to know how
APIWright is built internally. End users don't need to read it.

The codebase is organised into 11 focused modules under `src/`,
each with a single responsibility. The CLI is the only entry point;
everything else is pure(-ish) logic feeding into it.

---

## Block diagram

```
                          ┌────────────────────────┐
                          │   apiwright (CLI)      │   src/cli/
                          │   commander + main()    │
                          └───────────┬────────────┘
                                      │
              ┌───────────────────────┼───────────────────────┐
              ▼                       ▼                       ▼
       ┌──────────┐            ┌───────────┐           ┌────────────┐
       │ validate │            │    run    │           │ import/docs│
       └────┬─────┘            └─────┬─────┘           └─────┬──────┘
            │                        │                       │
            ▼                        ▼                       ▼
     ┌──────────────────┐    ┌────────────────┐      ┌────────────────┐
     │ core (canonical  │    │ env (loader,   │      │ importers      │
     │ model + schema   │    │ secrets,       │      │ (openapi,      │
     │ validator)       │    │ template res.) │      │  postman)      │
     └────────┬─────────┘    └──────┬─────────┘      └────────┬───────┘
              │                     │                          │
              │   ┌─────────────────┴──────────┐               │
              │   ▼                            ▼               ▼
              │ ┌──────────────┐    ┌──────────────────┐   ┌──────┐
              │ │ test-catalog │    │ assertions       │   │ docs │
              │ │ (16 §3       │    │ (20 operators +  │   │      │
              │ │  generators) │    │  parser)         │   │      │
              │ └──────┬───────┘    └────────┬─────────┘   └──────┘
              │        │                     │
              │        ▼                     │
              │   ┌─────────────────────────┐│
              └──▶│       runner            │◀┘
                  │ (workers, retry,        │
                  │  http-client, db_verify,│
                  │  cleanup, sharding)     │
                  └───────────┬─────────────┘
                              ▼
                       ┌──────────────┐
                       │   reporting  │
                       │ (console +   │
                       │  json + html │
                       │  + junit)    │
                       └──────────────┘
                              │
                              ▼
                    ┌─────────────────────┐
                    │ db/  (connectors:    │
                    │  pg, mysql2, mongo,  │
                    │  neo4j)              │
                    └─────────────────────┘

                    ┌─────────────────────┐
                    │ auth/ (static_token │
                    │  + token_endpoint)  │
                    └─────────────────────┘
```

---

## Module-by-module

### `src/core/`

The canonical endpoint model and its meta-schema validator. Defines
the shape every `*.endpoint.json` must satisfy. Every other module
consumes a `CanonicalEndpoint` rather than touching the raw JSON.

Key files: `canonical-model.ts`, `schema-validator.ts`, `safe-json.ts`.

### `src/env/`

Loads `environments/<name>.yaml`, parses it, resolves `${env.X}` and
`${secret.X}` template variables, builds the secret registry that
downstream redaction uses. Validates against the env meta-schema.

Key files: `loader.ts`, `secrets.ts`, `template-resolver.ts`, `redactor.ts`.

### `src/importers/`

Convert external API specs into `CanonicalEndpoint[]`. Two flavours:

- **postman** — Postman v2.1 collections (`apiwright import postman`).
- **openapi** — OpenAPI 3.x AND Swagger 2.0 (`apiwright import openapi`).

Outputs `*.endpoint.json` files that the meta-schema accepts and the
catalog can expand.

### `src/test-catalog/`

The §3 catalog generators. One generator per case type; they take a
parsed endpoint + context and emit zero-or-more `PlannedTestCase[]`.
The marker-classifier assigns markers (`smoke` / `regression` / `e2e`)
to each case type.

Key files: `generators/*.ts`, `marker-classifier.ts`, `prod-safety-classifier.ts`.

### `src/assertions/`

The declarative assertion engine. Pure, no-throw parser + evaluator
for the 20-operator DSL. Five operator families:

- Comparison: `equals` / `not_equals` / `greater_than` / `less_than` / `in_range`.
- Pattern: `matches` / `contains` / `starts_with` / `ends_with`.
- Existence: `exists` / `not_exists` / `is_null` / `is_not_null`.
- Type/format: `is_uuid_v4` / `is_iso_timestamp` / `is_recent_timestamp` / `is_email` / `is_url`.
- Aggregate: `count_equals` / `count_greater_than`.

Key files: `parser.ts`, `evaluator.ts`, `operator-registry.ts`,
`target-path-parser.ts`, `operators/*.ts`.

### `src/auth/`

Auth-strategy plug-ins. Two built-ins:

- **static_token** — fixed token injected into a configured header.
- **token_endpoint** — call a token endpoint, extract the access token,
  use it as bearer.

Key files: `strategies/*.ts`, `config-parser.ts`.

### `src/db/`

Database connector layer for `db_verify` and `cleanup`. Pluggable
driver seam per engine:

- **pg** (PostgreSQL).
- **mysql2** (MySQL).
- **mongodb** (MongoDB).
- **neo4j-driver** (Neo4j).

Key files: `connectors/*.ts`, `drivers/*.ts`, `pool/*.ts`,
`templating/*.ts`, `expect/*.ts`.

### `src/runner/`

The runtime engine. Composes everything above:

1. Discovers endpoint files (`runner/discovery/walker.ts`).
2. Applies filters (`runner/filter/*.ts`).
3. Shards plan into worker batches (`runner/filter/sharder.ts`).
4. Executes cases in parallel (`runner/execute/concurrency-limiter.ts`).
5. Retries failed cases per policy (`runner/execute/retry-policy.ts`).
6. Wraps each case in crash-safe + timeout watchdogs
   (`runner/execute/crash-safe-executor.ts`, `runner/execute/timeout-watchdog.ts`).
7. Runs db_verify + cleanup pipelines (`runner/execute/db-verify-runner.ts`).
8. Streams partial JSONL sidecar (`runner/execute/partial-emitter.ts`).

Key files: `runner.ts`, `execute/endpoint-executor.ts`,
`execute/case-runners.ts`.

### `src/reporting/`

Three renderers + the console reporter. Consumes `RunResult`, emits:

- `run-<ts>.json` (structured) — `json-emitter.ts`.
- `run-<ts>.html` (human) — `html-renderer.ts`.
- `run-<ts>.xml` (JUnit XML) — `junit-xml-renderer.ts`.
- Console output — `console-reporter.ts`.

All outputs pass through the secret redaction pipe before reaching
disk / stdout.

### `src/docs/`

The Markdown documentation generator (`apiwright docs generate`).
Reads endpoint declarations, emits one `.md` file per endpoint with
spec / schema / auth / db / coverage / markers sections.

Key files: `generator.ts`, `composer.ts`, `sections/*.ts`,
`schema-table.ts`.

### `src/cli/`

Commander-based entry point. Defines the four subcommands (`validate`,
`run`, `import`, `docs`), parses flags, loads the config, wires
everything into the runner.

Key files: `entry.ts`, `commands/*.ts`, `config/loader.ts`,
`config/resolve-effective.ts`, `prod-safety.ts`.

---

## Data flow for one `apiwright run`

```
1. CLI parses argv               (src/cli/entry.ts)
2. Config loaded + validated     (src/cli/config/loader.ts)
3. Effective config resolved     (src/cli/config/resolve-effective.ts)
4. Environment YAML loaded       (src/env/loader.ts)
5. Secrets resolved + registered (src/env/secrets.ts + redactor.ts)
6. Auth strategies bound         (src/auth/config-parser.ts)
7. DB connections opened (lazy)  (src/db/pool/*.ts)
8. Endpoint files discovered     (src/runner/discovery/walker.ts)
9. Each endpoint validated       (src/core/schema-validator.ts)
10. Catalog expands each endpoint  (src/test-catalog/generators/*.ts)
11. Plan filtered by markers + CLI (src/runner/filter/filter.ts)
12. Plan sharded if requested      (src/runner/filter/sharder.ts)
13. Workers execute the plan        (src/runner/execute/*.ts)
    └── per case:
        ├── auth.injectInto(request)        (src/auth/)
        ├── http-client.send(request)       (src/runner/execute/http-client.ts)
        ├── eval response checks            (status/schema/sla/content-type)
        ├── eval assertions                 (src/assertions/evaluator.ts)
        ├── run db_verify                   (src/runner/execute/db-verify-runner.ts)
        └── retry-policy decides outcome    (src/runner/execute/retry-policy.ts)
14. Reports emitted              (src/reporting/*.ts)
15. CLI exits with status code (0 = green, non-zero = anything failed)
```

Every step is independent + testable in isolation. The hermetic
integration tests in `tests/integration/` round-trip through real
versions of each module without external network.

---

## Extension points

v1.0 is intentionally **closed** to runtime extension — no plugins,
no user-provided JS, no eval. This keeps the security boundary tight
(the only code that runs is what's in `dist/`).

Extension by editing source is unconstrained. Each module's contract
is small + well-tested; adding (say) a new database driver is "add
a file in `src/db/drivers/`, register it in the driver-seam table,
add tests."

Plugin-style extension is on the **v2.0 roadmap** for reporters and
auth strategies; see [limitations.md](./limitations.md).

---

## File-size discipline

Each module follows a 300-line soft limit / 500-line hard cap per
file, with one exported responsibility per file. This is enforced
by lint + code review; it keeps the codebase navigable and reviewable.

When a file approaches 300 lines, the convention is to split:
"this file has done its one thing; the next thing goes in a sibling
file."

---

## Test layout (mirrors `src/`)

```
tests/
  unit/         ← one *.test.ts per src file, ≥ 95 % branch coverage
  integration/  ← hermetic cross-module tests (no network)
  fixtures/     ← recorded sample data + corpora the above consume
```

Real-service e2e + the dogfooding meta-suite live in the sibling
[apiwright-testing](https://github.com/anshulgupta1791/apiwright-testing)
repo (Python/pytest, drives apiwright through its CLI as an external
consumer would).

---

## See also

- [CONTRIBUTING.md](../CONTRIBUTING.md) — how to set up locally and
  run the gated suite.
- [test-catalog.md](./test-catalog.md) — what the `src/test-catalog/`
  module generates.
- [assertions.md](./assertions.md) — what the `src/assertions/`
  module evaluates.
- [reports.md](./reports.md) — what the `src/reporting/` module emits.
