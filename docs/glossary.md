# Glossary

Short definitions for every APIWright-specific term you'll meet in the
docs. Cross-linked to the deep-dive page for each concept.

---

**Assertion** — A line of declarative business logic in a declaration's
`assertions` array, evaluated after the request returns. Uses one of the
20 supported operators against a typed target (request / response / db).
Example: `response.body.id is_uuid_v4`. See [assertions.md](./assertions.md).

**Assertion operator** — One of the 20 fixed operators the assertion engine
recognises (`equals`, `not_equals`, `greater_than`, `matches`, `contains`,
`exists`, `is_uuid_v4`, `count_equals`, etc.). See
[assertions.md](./assertions.md) for the full list and grammar.

**Auth strategy** — A named bundle in the environment YAML's
`auth_strategies` block that describes how to inject credentials into
outgoing requests (`static_token` or `token_endpoint`). Endpoints reference
a strategy by name (`auth_strategy: bearer`). See
[environment-config.md](./environment-config.md).

**Backoff** — The schedule for delays between retries: `none`, `linear`
(delay × attempt), or `exponential` (delay × 2^(attempt − 2)). Configured
in the retry block.

**Boundary battery** — The §3 generator that, for every numeric field with
`minimum`/`maximum`, every string field with `minLength`/`maxLength`, and
every field with `enum`, sends inside-the-boundary, outside-the-boundary,
and at-the-boundary values to test input validation.

**Canonical model** — APIWright's internal, importer-neutral representation
of an endpoint. Postman, OpenAPI, Swagger, and hand-authored JSON all
normalise into this shape before the catalog generates from them. See
[canonical-model.md](./canonical-model.md).

**Catalog** — The fixed set of test-case types (§3) APIWright knows how to
auto-generate from a declaration: status_code_conformance,
content_type_alignment, response_schema_validation, response_time_sla,
auth_happy_path, no_auth_returns_401, garbage_token_returns_401,
method_not_allowed, malformed_json_returns_400, required_field_omission,
type_violation, boundary_battery, get_idempotency, delete_idempotency,
db_state_matches_expectation, plus user-declared assertions. See
[test-catalog.md](./test-catalog.md).

**Cleanup** — An optional block on a declaration carrying a query that
runs after the test (regardless of pass/fail) to roll back side effects.
Same connector machinery as `db_verify`.

**`db_verify`** — A block on a declaration that runs a SQL / Cypher / Mongo
query against a configured database to verify the side effect of the
endpoint landed correctly. See [db-verify.md](./db-verify.md).

**Declaration** — One `*.endpoint.json` file describing a single endpoint.
The unit of input APIWright operates on. See [concepts.md](./concepts.md)
and [canonical-model.md](./canonical-model.md).

**`default_sla_ms`** — Environment-level fallback for per-endpoint
`sla_ms`. If an endpoint doesn't declare its own SLA, this value applies.

**Endpoint** — One API endpoint described by one declaration. Has a
unique `id`, a `method`, a `url`, a `request` shape, a `response`
contract, and optional auth / `db_verify` / `assertions` / `markers` /
`tags` / `cleanup`.

**Environment** — One `environments/<name>.yaml` file capturing what
differs between deployment targets (base URLs, database connections, auth
credentials, default SLA). See [environment-config.md](./environment-config.md).

**Failure reason** — The structured string APIWright records on each
failed attempt explaining WHY the case failed (e.g. `"response body did
not match schema"`, `"SLA 1ms exceeded (got 4ms)"`, `"db_verify did not
satisfy expect mode"`).

**Flaky** — Final status of an endpoint that failed on its first attempt
but passed on a retry. In strict mode this stays as `fail`; in lenient
mode it's reported as `flaky` and surfaced as a warning.

**Generator** — A §3 case-type producer that takes a parsed declaration
and emits zero-or-more concrete test cases. The 16 generators are listed
under "Catalog" above.

**HTTP-correctness checks** — The §3 catalog cases that verify the
endpoint behaves as an HTTP API should (correct status, content-type,
auth boundaries, schema, etc.) — orthogonal to whether the feature is
correct for your use case.

**Idempotency case** — The §3 generator that calls a GET or DELETE
twice and asserts identical results — exercising the REST idempotency
contract.

**Importer** — A module that converts external spec files into APIWright
declarations: `import postman <file>` (Postman v2.1), `import openapi
<file>` (OpenAPI 3.x and Swagger 2.0). Outputs `*.endpoint.json` files.
See [postman-import.md](./postman-import.md) and
[openapi-import.md](./openapi-import.md).

**Index** — The `docs/README.md` file; the navigation hub for all
user-facing documentation.

**Malformed JSON** — The §3 generator that sends `{"unterminated:` as the
body and asserts the endpoint returns 400 (not 500). Catches "we forgot
to validate" parser errors.

**Marker** — Tag attached to every generated case classifying it as
`smoke`, `regression`, or `e2e`. Selected at run time via
`--markers smoke,regression` or shorthand `--markers all`. See
[markers-and-lifecycle.md](./markers-and-lifecycle.md).

**Meta-schema** — The JSON Schema APIWright uses internally to validate
that every `*.endpoint.json` you write or import is structurally well-
formed. `apiwright validate <dir>` runs it.

**`method_not_allowed`** — The §3 generator that sends a method other than
the declared one (e.g. PUT to a POST endpoint) and asserts the endpoint
returns 405 (or 404 — see [troubleshooting.md](./troubleshooting.md) for
real-API quirks).

**Plan** — The full set of generated test cases for one run after filters
have been applied. The plan is deterministic — same inputs always
produce the same plan in the same order.

**`prod_safe`** — Boolean property on a declaration (default `true`)
indicating whether the endpoint's destructive cases (writes, deletes) are
safe to run against a production environment. Used by the runner to gate
destructive cases when the environment has `prod: true`.

**Redaction** — APIWright's contract that every `${secret.*}` value is
masked to `[REDACTED]` in every output artifact (JSON report, HTML
report, JUnit XML, console logs, partial-JSONL sidecar). Implemented by
intercepting at the writer boundary.

**Retry policy** — The block in `apiwright.config.json` controlling
how failed cases are retried: `{count, delay_ms, backoff, strict}`. See
[configuration.md](./configuration.md).

**Required field omission** — The §3 generator that, for each required
field in `body_schema`, sends a body missing exactly that field and
asserts the endpoint returns 400.

**Run** — One invocation of `apiwright run`. Produces one set of
`run-<timestamp>.{json,html,xml}` files in `reports_dir`. See
[concepts.md](./concepts.md).

**Sharding** — Splitting the test plan into `N` deterministic shards via
`--shard k/n` so independent CI jobs can run disjoint subsets in
parallel. See [performance-and-scale.md](./performance-and-scale.md).

**SLA** — Per-endpoint response time budget in milliseconds, declared as
`response.sla_ms` (or inherited from the environment's `default_sla_ms`).
The `response_time_sla` case asserts `time_ms ≤ sla_ms`.

**Sla_delegated** — Internal flag indicating an endpoint did not declare
its own `sla_ms` and is using the environment's `default_sla_ms`.

**Smoke marker** — The fast happy-path coverage layer:
status_code_conformance, content_type_alignment,
response_schema_validation, response_time_sla, auth_happy_path, plus
declared assertions. Designed to run on every PR.

**`static_token` strategy** — Auth strategy where a fixed token (resolved
from `${secret.*}`) is injected into a configured header per request.

**Test case** — One concrete generated execution: a specific request to
send, a specific check to run, a specific case marker. The
runtime unit the runner schedules across workers.

**Test plan** — See "Plan".

**`token_endpoint` strategy** — Auth strategy where APIWright first calls
a token endpoint (e.g. `/oauth/token`), extracts the returned access
token, and uses it as the bearer token for subsequent requests.

**Type violation** — The §3 generator that, for each typed field in
`body_schema`, sends a value of the wrong type and asserts the endpoint
returns 400.

**Universal case** — Any of the §3 cases that apply to every endpoint
regardless of shape (status, content-type, schema, sla). Distinct from
shape-dependent cases (boundary, type-violation, required-omission, etc.)
which only fire when the relevant declaration features are present.

**Worker** — One concurrent execution unit. APIWright defaults to 4
workers; configurable via `workers` in `apiwright.config.json` or
`--workers N` on the CLI.

---

See [concepts.md](./concepts.md) for how these pieces fit together.
