# FAQ

Short answers to the questions that come up most often. If the answer
points at a deeper doc, follow the link — the FAQ entry is the
2-paragraph version.

---

## General

### What is APIWright?

A self-hosted, declarative API testing framework. You describe each
endpoint in one ~40-line JSON file; APIWright auto-generates roughly 16
distinct test cases per endpoint (HTTP status, schema validation, auth
boundaries, missing-required-field, wrong-type, boundary values,
idempotency, DB state verification, plus any business-logic assertions
you declare). One declaration, ~16 generated cases, real HTTP +
real DB queries against your live API. See [concepts.md](./concepts.md).

### Do I need to write code?

No. Declarations are JSON; assertions are a short DSL
(`response.body.id is_uuid_v4`); environments are YAML. The only time
you'd write code is to extend APIWright itself.

### What language is APIWright written in?

TypeScript. But you don't interact with TypeScript to use it — the CLI is
language-neutral.

### Is there a hosted version?

No. APIWright is self-hosted by design: it lives in your repo or your
Docker registry, runs against your APIs from your network, and never
sends data anywhere.

### What license is it under?

Apache 2.0 — permissive, includes explicit patent protection. See
[LICENSE](../LICENSE).

---

## Adoption

### How long does it take to learn?

The full mental model is 6 terms ([concepts.md](./concepts.md)). Most
users have their first endpoint running in under 10 minutes following
the [Quickstart](./cookbook/quickstart.md).
The full catalog (what each generator does) takes maybe an hour to
internalise.

### Why APIWright instead of writing tests in Jest / pytest / RestAssured?

Hand-written test code covers what the author thought to test —
typically 15–25 % of the API-correctness surface (happy paths + a few
errors). APIWright covers the systematic stuff (every endpoint × every
HTTP-correctness check × every declared field's negative test) from one
declaration. The two are complementary, not alternatives. See
[comparisons.md](./comparisons.md) for the full breakdown.

### How is this different from Postman / Newman?

Postman is for interactive API exploration + collection sharing; Newman
runs Postman collections in CI. Both are great for "I want to call this
endpoint and see what happens." APIWright is for "I want to systematically
test every endpoint's HTTP correctness, schema conformance, auth boundaries,
input validation, and DB side effects, generated from one declaration each."
You can import a Postman collection into APIWright as a starting point
(see [postman-import.md](./postman-import.md)).

### Can my QA team use APIWright without dev help?

Yes — that's the design goal. JSON authoring + YAML environments + CLI
invocation. The skills required are: read a spec, write JSON, run a
command. No JavaScript / Python / Java required.

### How do I evaluate APIWright on my existing API in 30 minutes?

1. Install (Docker is fastest — see [installation.md](./installation.md)).
2. If you have a Postman collection, run `apiwright import postman
   your-collection.json --output ./tests`. Otherwise hand-author 2-3
   `*.endpoint.json` files for your most-used endpoints.
3. Create a minimal `environments/dev.yaml` with `base_url` and any auth.
4. `apiwright run --env dev --markers smoke` and inspect the HTML report.

Within 30 minutes you'll have a concrete sample of what APIWright catches
on YOUR API.

---

## Features

### What gets auto-generated per endpoint?

Up to 16 distinct case types from one declaration. The full list is in
[test-catalog.md](./test-catalog.md). Highlights:

- Status code conformance, content-type alignment, response schema
  validation, SLA conformance.
- Auth boundary tests (no auth → 401, bad token → 401).
- Method-not-allowed, malformed-JSON-returns-400.
- Per-required-field omission tests; per-typed-field type-violation tests.
- Boundary value battery for every constrained field.
- GET / DELETE idempotency.
- `db_verify` checks against your database after writes.

### Does it support OpenAPI / Swagger?

Yes — `apiwright import openapi <file>` accepts both OpenAPI 3.x and
Swagger 2.0 specs and emits one `*.endpoint.json` per operation. See
[openapi-import.md](./openapi-import.md).

### Does it support Postman?

Yes — `apiwright import postman <file>` accepts Postman v2.1 collections.
See [postman-import.md](./postman-import.md).

### Does it support GraphQL / gRPC / SOAP / WebSocket / SSE?

Not in v1.0 — see [limitations.md](./limitations.md). The v1.0 scope is
REST / HTTP-JSON APIs. GraphQL and gRPC importers are on the v2.0
roadmap.

### Does it support multi-step flows (login → create → verify)?

Not in v1.0 — single-call per case. v1.5 adds multi-step flows. Until
then, write multi-step scenarios in your existing integration test suite
(Jest / pytest / etc.) and let APIWright handle the per-endpoint
commodity coverage.

### Which databases does `db_verify` support?

PostgreSQL, MySQL, MongoDB, and Neo4j. Drivers (`pg`, `mysql2`, `mongodb`,
`neo4j-driver`) ship with APIWright — no separate install. See
[db-verify.md](./db-verify.md).

### What auth strategies are supported?

`static_token` (a fixed token injected into a header) and `token_endpoint`
(call an OAuth-style endpoint, extract the token, use it as bearer).
Both resolve secret values from `${secret.*}` env-var references and
redact them in all output. OAuth user flows (`authorization_code` with
browser redirect) are deferred to v2.0.

### Are secrets safe?

Yes. Every `${secret.*}` value is replaced with `[REDACTED]` in every
output artifact (JSON report, HTML report, JUnit XML, partial-JSONL
sidecar, console logs). See [environment-config.md](./environment-config.md)
for the contract; we have an end-to-end test in apiwright-testing that
verifies the contract on real runs.

### Can I assert on database state?

Yes — `db_verify` blocks on a declaration run SQL / Cypher / Mongo queries
after the request and assert the side effect landed correctly. See
[db-verify.md](./db-verify.md). (Caveat: db_verify gating only fires on
write methods — POST/PUT/PATCH/DELETE — see "Known limitations" below.)

### Can I generate documentation from declarations?

Yes — `apiwright docs generate --source ./tests --output ./docs/api`
emits one Markdown file per endpoint with the spec, schema, auth, db
effects, marker coverage, and which auto-generated cases run. Useful as
a continuously-fresh API reference for your team. See
[docs-generator.md](./docs-generator.md).

---

## Technical

### What's the configuration file?

`apiwright.config.json` — pass via `--config`. Holds `tests_dir`,
`environments_dir`, `reports_dir`, `default_env`, `default_markers`,
`workers`, `retry`, `report`, `log_level`. See
[configuration.md](./configuration.md) for the full schema.

### How does parallelism work?

`workers: N` in the config (or `--workers N` on the CLI; default 4) runs
N cases concurrently. Endpoint ordering in the report stays deterministic
regardless of worker count. See
[performance-and-scale.md](./performance-and-scale.md).

### Can I run a subset of tests?

Yes — four filters: `--markers smoke,regression`, `--tag write`,
`--endpoint users.create`, `--path tests/users/`, `--exclude-tag flaky`.
All combinable. See [cli.md](./cli.md).

### How does retry work?

`retry: {count, delay_ms, backoff, strict}` in the config. A failed case
is retried `count` times with `delay_ms × multiplier` between attempts
(multiplier per `backoff`: `none` / `linear` / `exponential`). If a case
passes on retry, lenient mode reports it as `flaky`; strict mode keeps it
as `fail`. **Note: only `count` is currently honored from the config
block; `delay_ms` and `backoff` are pinned to defaults** — see "Known
limitations" below.

### Where do reports go?

`reports_dir` (default `./reports`). Each run writes
`run-<timestamp>.{json,html,xml}` and a temporary `.partial.jsonl`
sidecar that is removed on graceful exit. See [reports.md](./reports.md).

### How big is the Docker image?

Under 200 MB (enforced by CI; the release workflow refuses to publish
images that exceed the limit).

---

## Integration

### CI/CD — does it work with my platform?

Yes for GitHub Actions, Jenkins, GitLab CI, and Azure Pipelines —
copy-paste workflows in [`examples/ci/`](../examples/ci/). All four
follow the same pattern: pull the Docker image, mount your test
directory, forward secrets, archive the JUnit XML + HTML. See
[ci-cd.md](./ci-cd.md).

### Does APIWright integrate with TestRail / Zephyr / qTest / ReportPortal?

Indirectly — APIWright emits standard JUnit XML, which every major
test-management system can ingest. See [reports.md](./reports.md) for
the JUnit shape.

### Can it post results to Slack / Discord / etc.?

Not natively — but the JSON report is structured, so a 20-line script in
your CI workflow can parse it and post a summary anywhere. The shape is
documented in [reports.md](./reports.md).

---

## Known limitations

These are real gaps, called out honestly. See [limitations.md](./limitations.md)
for the full list.

- **`db_verify` on a GET endpoint runs and records `pass: false` but does
  not gate the test verdict.** Write methods (POST/PUT/PATCH/DELETE) DO
  gate correctly — see [db-verify.md](./db-verify.md).
- **Config-level `retry.delay_ms` and `retry.backoff` are ignored; only
  `count` is honored.** Defaults (1000ms / linear) apply regardless.
- **Per-endpoint `retry.count` is overridden by the global config count.**
  Per-endpoint overrides are effectively non-functional.
- **Multi-step flows are not supported** in v1.0; v1.5 roadmap.
- **OAuth user flows (browser redirect, PKCE) are not supported**; v2.0.

---

## Troubleshooting

### Where do I file a bug?

[GitHub Issues](https://github.com/anshulgupta1791/apiwright/issues).
For security issues, see [SECURITY.md](../SECURITY.md).

### My test fails with "response body did not match schema" but the response looks fine.

Run `apiwright run --log debug` to see the full response body and the
schema that's being applied; the mismatch is usually a tighter `type` or
`required` than the live response actually conforms to. See
[troubleshooting.md](./troubleshooting.md).

### How do I see what HTTP request APIWright sent?

`--log debug` prints every outgoing request (method, URL, headers, body)
and every response. The JSON report also captures all of this per
attempt under `attempts[].request` / `attempts[].response`.

### How do I get more help?

[GitHub Discussions](https://github.com/anshulgupta1791/apiwright/discussions)
for general questions, [Issues](https://github.com/anshulgupta1791/apiwright/issues)
for bugs / feature requests.
