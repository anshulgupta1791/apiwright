# Changelog

All notable changes to APIWright are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the version
numbering follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Nothing yet. The next entry will be appended above this section when a
new tag is cut.

## [1.0.0] — 2026-06-XX (pre-release; tag pending Lens 0 sweep + `private:false` flip)

Initial public release. APIWright is a declarative, self-hosted API
testing framework: author endpoints in JSON (or import from Postman v2.1
/ OpenAPI 3.x / Swagger 2.0), and APIWright generates and runs a catalog
of commodity HTTP tests covering status codes, content types, schemas,
auth boundaries, input validation, idempotency, response-time SLAs, and
database-state verification.

### Added

- **Declarative endpoint model** (`*.endpoint.json`) — full schema in
  [docs/canonical-model.md](./docs/canonical-model.md).
- **16 §3 test-case generators** — universal smoke (status / content-type
  / schema / auth / SLA), idempotency (GET + DELETE two-request), auth
  negatives (no-auth / garbage-token / method-not-allowed), body
  negatives (malformed-JSON / required-field-omission / type-violation /
  boundary-battery), and `db_state_matches_expectation`. See
  [docs/test-catalog.md](./docs/test-catalog.md).
- **20 declarative assertion operators** — equals, not_equals, contains,
  starts_with, ends_with, matches (regex), greater_than, less_than,
  between, in, exists, not_exists, is_null, not_null, count_equals,
  count_greater_than, count_less_than, is_uuid_v4,
  is_recent_timestamp, type_is. Bracket-notation target paths
  (`response.headers["X-Request-ID"]`) for keys with special
  characters. See [docs/assertions.md](./docs/assertions.md).
- **`db_verify` block** — PostgreSQL, MySQL, MongoDB, Neo4j drivers
  ship with the package (no separate install). Modes: `exists`,
  `not_exists`, `match`, `exact`. Templated SQL with `${env.*}`,
  `${request.body.*}`, `${response.body.*}` interpolation handled
  safely via parameter binding (never string concatenation). See
  [docs/db-verify.md](./docs/db-verify.md).
- **Two auth strategies** — `static_token` (fixed header from a
  `${secret.*}` ref) and `token_endpoint` (OAuth-style fetch-and-cache
  with `cache_ttl_seconds`). All secret values redacted as
  `[REDACTED]` in every artifact (HTML / JSON / JUnit / partial-JSONL
  / console). See [docs/environment-config.md](./docs/environment-config.md).
- **Postman v2.1 importer** — `apiwright import postman <collection>`.
  Walks folders, rewrites `{{var}}` tokens to `${env.*}`, extracts
  auth via a closed allowlist (4 forms), seeds response schema from
  example bodies. Bracket-notation target paths emitted when needed.
- **OpenAPI 3.x / Swagger 2.0 importer** — `apiwright import openapi
  <spec>`. Walks `paths` / `operations`, mirrors `tags` to folder
  structure, extracts auth from `security` / `securitySchemes`,
  emits `body_schema` and `response.schema` from the spec.
- **Three CLI subcommands** — `validate` (offline schema + cross-ref
  checks), `run` (HTTP execution + reports), `import` (postman /
  openapi), `docs` (generate Markdown per endpoint). See
  [docs/cli.md](./docs/cli.md).
- **Report artifacts** — HTML technical report, JSON sidecar (full
  request/response capture per attempt + kind + case_id), JUnit XML
  for CI publishers, partial-JSONL streamed during the run (survives
  process crashes). See [docs/reports.md](./docs/reports.md).
- **Prod-safety gate** — endpoints declared `prod_safe: false`
  filtered out on `--env <prod>` runs unless
  `--allow-non-smoke-in-prod` + `ALLOW_PROD_DESTRUCTIVE=true` are
  both set.
- **Retry policy** — global (`apiwright.config.json:retry.{count,
  delay_ms, backoff, strict}`), per-endpoint override
  (`endpoint.retry`), and CLI override (`--retries N`). Precedence:
  default ← global config ← per-endpoint ← CLI.
- **Markers + lifecycle** — `smoke` / `regression` / `e2e`. Filter
  via `--markers <csv|all>`. See
  [docs/markers-and-lifecycle.md](./docs/markers-and-lifecycle.md).
- **Sharding** — `--shard N/M` for parallel CI jobs. Endpoints
  deterministically split into M slices.
- **Docker image** — multi-stage `alpine` build, non-root user,
  `tini` for signal handling, HEALTHCHECK + OCI labels. Published
  to GHCR on `v*` tags.
- **Cookbook** — 7 step-by-step recipes:
  [quickstart](./docs/cookbook/quickstart.md),
  [CRUD API](./docs/cookbook/crud-api.md),
  [authenticated API](./docs/cookbook/authenticated-api.md),
  [DB side effects](./docs/cookbook/db-side-effects.md),
  [preparing to import](./docs/cookbook/preparing-to-import.md),
  [migrating from Postman](./docs/cookbook/migrating-from-postman.md),
  [migrating from OpenAPI](./docs/cookbook/migrating-from-openapi.md),
  [setting up CI](./docs/cookbook/setting-up-ci.md).
- **CI integration examples** — GitHub Actions / Jenkins / GitLab /
  Azure Pipelines, all in [`examples/ci/`](./examples/ci/).
- **Working example** — `examples/working-example/` runs against the
  public `httpbin.org`. No setup, no secrets, no Docker required.

### Fixed (notable v1.0 bug-fix batch — surfaced by dogfooding)

A focused dogfooding pass against the rahulshettyacademy Library
Postman collection plus an external pytest-based integration harness
surfaced and fixed a class of issues that the unit-test layer could
not catch:

- **`${env.X}` substitution at request-build time** (PR #79) — runner
  now substitutes templates in URL / headers / body_example before the
  HTTP request goes out. Previously the literal `${env.X}` token
  shipped in requests.
- **Auto-prepend of `env.base_url`** (PR #79) — `joinUrl` now detects
  already-absolute URLs (after template substitution) and skips the
  prepend, preventing doubled hosts.
- **Empty schema sentinel + skip-with-WARN** (PR #80) — importer
  emits `{"_pending_review": true}` instead of `{}` when no example
  response is available; planner detects the sentinel + bare `{}` and
  SKIPS `response_schema_validation` with a per-endpoint WARN —
  prevents false-positive PASSes against any 2xx body.
- **CI build dist before tests** (PR #82) — CI workflow now runs
  `npm run build` before `npm test` so subprocess-based integration
  tests can spawn the CLI binary. Resolves 5 chronically-flaky test
  suites.
- **`db_verify` on read methods gates** (PR #85) — catalog generator
  now emits `db_state_matches_expectation` for ANY method with
  `db_verify` declared, not just writes. Read-method db_verify
  failures now correctly turn the run red (previously they recorded
  `pass: false` in the report but the run exited green).
- **Retry config wiring** (PR #86) — `resolveEffectiveSettings` now
  produces `globalRetryPolicy: Partial<ResolvedRetryPolicy>`
  carrying all four fields (count + delay_ms + backoff + strict),
  and `cliRetryOverride` is only set when `--retries N` is passed.
  Per-endpoint `retry.count: 0` now wins over the config default.
- **Idempotency runner two-request comparison** (PR #52) —
  `getIdempotencyVerdict` compares response bodies via canonical
  JSON; `deleteIdempotencyVerdict` derives `second_delete_status`
  from `expected_status` (204→204, 404→404, other→404).
- **Template substitution sourcemaps clean** — `dist/**/*.map` files
  contain no absolute build-machine paths.

### Lens 0 pre-release hardening (this release)

A formal pre-release audit identified and fixed 13 blockers before
v1.0:

- **`postman-collection` SDK dropped** (PR #88, B13) — the SDK
  transitively pulled in vulnerable lodash + uuid. `npm overrides`
  protected our local audit but NOT consumers of the published
  tarball. Replaced with an in-house typed Postman v2.1 walker
  (`src/importers/postman/v2-schema.ts`). Tarball install now reports
  `found 0 vulnerabilities` (was 4 — 3 high + 1 moderate).
- **Assertion DSL bracket notation** (PR #89, B10) — target paths
  now support `["X-Request-ID"]` segments alongside the dot syntax,
  so HTTP headers (and any key with hyphens / dots / slashes) can be
  asserted. The pitched 5-minute working example no longer aborts.
- **Version, husky-on-user-install, prepublishOnly, doc links,
  cookbook README, dead deps** — see PR description for the full
  metadata cluster.
- **CHANGELOG.md** added (this file).
- **PVR enabled** in the GitHub repo so the `SECURITY.md` reporting
  URL no longer 404s.

### Security

- No high- or critical-severity advisories on the published tarball
  as of release tagging.
- Private Vulnerability Reporting enabled. See
  [SECURITY.md](./SECURITY.md) for the disclosure process.
- All `${secret.*}` values are redacted in every artifact and on the
  console at every log level.

### Known limitations (v1.0, by design — see [docs/limitations.md](./docs/limitations.md))

- **No SOAP / XML / GraphQL / gRPC / WebSocket / SSE.** v1.0 is
  REST + JSON.
- **No multi-step flows.** Each endpoint runs independently with a
  constant env value; chain flows belong in an external integration-
  test harness (pytest / Jest / your existing stack).
- **No request-once-assert-many.** Universal cases issue one HTTP
  request per case; for rate-limited APIs, fall back to single-call
  hand-written tests.
- **No query-param API-key auth.** Auth strategies are header-only
  in v1.0.

[Unreleased]: https://github.com/anshulgupta1791/apiwright/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/anshulgupta1791/apiwright/releases/tag/v1.0.0
