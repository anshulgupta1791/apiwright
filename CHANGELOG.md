# Changelog

All notable changes to APIWright are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the version
numbering follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.2] — 2026-06-03

Seven new endpoint-level test generators (skip-cases, PUT idempotency,
HEAD/GET parity, ETag/conditional-GET, pagination boundary, CORS preflight,
response variants) bring `ALL_SKIPPABLE_KINDS` from 16 to 21 entries and
`GeneratedTestType` to 20 §3-generated kinds. Four DB seam test expansions
round out the release.

### Added

- New `response_variants` field on `*.endpoint.json`. Declares known
  non-happy-path status codes and optional JSON Schemas for their
  response bodies. When a STATUS_EQ_KINDS test case receives a status
  that differs from `expected_status` AND that status appears as a key
  in `response_variants`, the `failure_reason` in the report is enriched
  with one of four messages:
  - Body matches the variant schema: `expected status <E>, got <A>
    (response body matched declared variant schema for <A>)`.
  - Body does not match the variant schema: `expected status <E>, got <A>
    (response body did not match declared variant schema for <A>: <ajv-error>)`.
  - Variant declared without a schema: `expected status <E>, got <A>
    (status <A> is a documented variant)`.
  - No variant declared (unchanged plain message): `expected status <E>, got <A>`.
  Variant lookup is suppressed when `actual === expected` (happy-path
  uses `response.schema`, not `response_variants`). Variant keys must
  match `^[1-5]\d{2}$`; wildcard keys are rejected at load time. Two
  plan-time warnings guard misconfigured declarations: a variant key
  that equals the happy-path status (the variant is never reachable),
  and an empty `response_variants` object. No new generator or skip token
  is introduced; `ALL_SKIPPABLE_KINDS` is unchanged at 21 entries.
  Applies to all nine STATUS_EQ_KINDS (`status_code_conformance`,
  `no_auth_returns_401`, `garbage_token_returns_401`,
  `method_not_allowed`, `malformed_json_returns_400`,
  `required_field_omission_returns_400`, `type_violation_returns_400`,
  `boundary_battery`, `pagination_boundary`). Multi-property verdict
  kinds (`put_idempotency`, `head_get_parity`, `conditional_get_304`,
  `cors_preflight`) are unaffected.
  See [docs/test-catalog.md](./docs/test-catalog.md) and
  [docs/cookbook/response-variants.md](./docs/cookbook/response-variants.md).

- Endpoint-level `skip_cases` and global `case_generation.skip_globally`
  opt-outs for generated test types. Tokens take one of two forms:
  `"kind"` (skip every generated case of that kind for the matching scope)
  or `"kind:field"` (skip only the instance whose body-field matches — valid
  for `required_field_omission_returns_400`, `type_violation_returns_400`,
  and `boundary_battery`). Malformed tokens or unknown kind names emit a
  warning and the plan still generates. Endpoint and global opt-outs form
  a union: a per-endpoint `skip_cases` entry can only add to the global
  set, never remove from it. See [docs/skip-cases.md](./docs/skip-cases.md).

- New auto-generated test type `put_idempotency` for PUT endpoints (RFC 7231
  §4.3.4 idempotency compliance). Issues two identical PUTs and asserts the
  resource state is unchanged. Two compare modes, selected automatically:
  `body_equality` (default — second PUT's response body equals the first's)
  or `db_state` (auto-selected when `db_verify` is declared — re-runs
  `db_verify` after the second PUT and requires every step to pass).
  Brings `ALL_SKIPPABLE_KINDS` from 16 to 17 entries. Opt out with
  `skip_cases: ["put_idempotency"]` at the endpoint level or via
  `case_generation.skip_globally` in config.
  See [docs/test-catalog.md](./docs/test-catalog.md) and
  [docs/cookbook/put-idempotency.md](./docs/cookbook/put-idempotency.md).

- New auto-generated test type `head_get_parity` for HEAD endpoints with
  `pair_with: "<get-endpoint-id>"` declared (RFC 7231 §4.3.2 compliance).
  Sends HEAD and GET to the same URL and asserts: status codes identical,
  HEAD body empty (`null`, `undefined`, or `""`), and response headers
  identical except for the ignored set (`content-length`,
  `transfer-encoding`, `date`, `set-cookie`, `etag`, and hop-by-hop headers
  `connection`, `keep-alive`, `x-request-id`, `x-trace-id`). Marker =
  `smoke`. Opt-in only: HEAD endpoints without `pair_with` receive no case.
  If the paired GET endpoint cannot be resolved (not found, wrong method, or
  URL mismatch), the case is dropped with a warning. Brings
  `ALL_SKIPPABLE_KINDS` from 17 to 18 entries. Opt out with
  `skip_cases: ["head_get_parity"]` at the endpoint level or via
  `case_generation.skip_globally` in config.
  See [docs/test-catalog.md](./docs/test-catalog.md) and
  [docs/cookbook/head-get-parity.md](./docs/cookbook/head-get-parity.md).

- New auto-generated test type `conditional_get_304` for GET endpoints that
  declare `etag_supported: true` (RFC 7232 compliance). Issues two GET
  requests: the first collects the ETag from the response; the second adds
  `If-None-Match: <etag>` and expects 304 Not Modified with a matching ETag
  and an empty body. Marker = `regression`. Opt-in only: GET endpoints
  without `etag_supported: true` receive no case. Brings `ALL_SKIPPABLE_KINDS`
  from 18 to 19 entries. Opt out with `skip_cases: ["conditional_get_304"]`
  at the endpoint level or via `case_generation.skip_globally` in config.
  See [docs/test-catalog.md](./docs/test-catalog.md) and
  [docs/cookbook/etag-conditional-get.md](./docs/cookbook/etag-conditional-get.md).

- New auto-generated test type `pagination_boundary` for GET endpoints that
  declare a `pagination` block. Probes boundary conditions for three
  pagination styles: `page` (4 probes: `size_zero`, `size_max`,
  `size_max_plus_one`, `page_negative`), `offset` (3 probes: above minus
  `page_negative`), and `cursor` (2 probes: `size_zero`, `size_max`). Each
  probe asserts either a 400 rejection or a successful response as
  appropriate. Marker = `regression`. Opt-in only: GET endpoints without a
  `pagination` block receive no case. Brings `ALL_SKIPPABLE_KINDS` from 19
  to 20 entries. Individual probes can be skipped with the
  `"pagination_boundary:<probe>"` token (e.g.
  `"pagination_boundary:size_zero"`); bare `"pagination_boundary"` skips all
  probes for that endpoint. Two plan-time warnings guard misconfigured
  declarations (missing `page_param` with `page` style; `max_size` less than
  `default_size`). Opt out with `skip_cases: ["pagination_boundary"]` at the
  endpoint level or via `case_generation.skip_globally` in config.
  See [docs/test-catalog.md](./docs/test-catalog.md) and
  [docs/cookbook/pagination-boundary.md](./docs/cookbook/pagination-boundary.md).

- New auto-generated test type `cors_preflight` for OPTIONS endpoints
  that declare a `cors` block (`allow_origins`, `allow_methods`,
  `allow_headers`). Sends an OPTIONS preflight with `Origin`,
  `Access-Control-Request-Method`, and (when non-empty)
  `Access-Control-Request-Headers`; asserts the response status is 200
  or 204, `Access-Control-Allow-Origin` matches the sent origin, and
  `Access-Control-Allow-Methods` / `Access-Control-Allow-Headers` are
  supersets of the declared values (case-insensitive). Wildcard origin
  (`["*"]`) accepts either `*` or the echoed origin in the response;
  multi-origin lists require the server to echo the sent origin exactly.
  Empty `allow_headers` is valid and omits the `ACR-Headers` request
  header. Non-OPTIONS endpoints with a `cors` block are silently ignored.
  Marker = `smoke`. Brings `ALL_SKIPPABLE_KINDS` from 20 to 21 entries.
  Two plan-time warnings guard misconfigured declarations (empty
  `allow_origins`; empty `allow_methods`). Opt out with
  `skip_cases: ["cors_preflight"]` at the endpoint level or via
  `case_generation.skip_globally` in config.
  See [docs/test-catalog.md](./docs/test-catalog.md) and
  [docs/cookbook/cors-preflight.md](./docs/cookbook/cors-preflight.md).

### Fixed

- **From-source build no longer silently produces an empty `dist/`** when
  the user wipes `dist/` between builds. The TypeScript `--incremental`
  cache (`node_modules/.cache/tsbuildinfo`) trusts the cache and skips
  emit if it thinks the output is current — but doesn't verify that the
  output files still exist on disk. The pre-1.0.2 failure mode: clone
  → `npm run build` (works) → `rm -rf dist` → `npm run build` (exits 0,
  no error, but only 1 of 218 expected `.js` files appears). Now a
  `prebuild` script clears both `dist/` and the incremental cache before
  every `tsc` run, so the failure mode cannot recur. Surfaced during the
  v1.0.2 cross-platform install rehearsal.

- **`apiwright validate <subdir>` now suggests the project-root
  remediation** when no environment YAMLs were walked. Previously the
  error said only `"Declared env keys across all environments:
  (none declared)"` — accurate but unhelpful when the user passed
  `validate endpoints/` instead of `validate .`. The new message
  appends a hint: *"if you passed an endpoints subdirectory, try
  `apiwright validate .` from the project root containing both
  endpoints/ and environments/"*. Same hint also appears in the
  `auth_strategy` undeclared error. Surfaced during the install
  rehearsal.

## [1.0.1] — 2026-06-02

Three small fixes surfaced by the v1.0.0 install rehearsal — the
whole point of the rehearsal was to find this class of issue before
external adoption, and it did.

### Fixed

- **Dockerfile `ENTRYPOINT` uses an absolute path** so the image
  works regardless of the working directory the user mounts into
  the container. Previously, the canonical *"mount my whole
  project"* pattern (`docker run -v $PWD:/work -w /work
  ghcr.io/.../apiwright:1.0.0 run ...`) failed with
  `Error: Cannot find module '/work/dist/cli/entry.js'`. The CI
  workflow template in [`docs/cookbook/quickstart.md`](./docs/cookbook/quickstart.md)
  uses that `-w` pattern, so this was the first real-world failure
  mode an adopter would hit. The `HEALTHCHECK` got the same
  absolute-path treatment for the same reason.

- **CHANGELOG `[1.0.0]` operator list corrected** to match the
  actual `src/assertions/operator-registry.ts`. Five names were
  wrong (`between` → `in_range`, `not_null` → `is_not_null`,
  `count_less_than` / `in` / `type_is` don't exist) and three
  operators that DO exist were missing (`is_iso_timestamp`,
  `is_email`, `is_url`). A user following the v1.0.0 changelog
  would have hit `Unknown operator 'type_is'` on first attempt.
  `docs/assertions.md` was already correct — it's the
  authoritative list and the CHANGELOG was the only doc out of
  sync.

- **README badges**: dropped the `img.shields.io/node/v/apiwright`
  and `img.shields.io/npm/v/apiwright` badges that render
  *"package not found"* because `apiwright` is not yet published
  to npmjs.org. Replaced with a static `node ≥ 22` badge that
  reflects the `engines.node` constraint. The npm version badge
  will return the moment `npm publish` lands.

### Notes

This release reuses the v1.0.0 stable surface unchanged — every
SemVer-guaranteed surface in [`docs/compatibility.md`](./docs/compatibility.md)
is identical. Users on v1.0.0 can upgrade with no migration step.

## [1.0.0] — 2026-06-02

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
- **20 declarative assertion operators** —
  comparison (5): `equals`, `not_equals`, `greater_than`,
  `less_than`, `in_range`;
  pattern (4): `matches` (regex), `contains`, `starts_with`,
  `ends_with`;
  existence (4): `exists`, `not_exists`, `is_null`, `is_not_null`;
  format (5): `is_uuid_v4`, `is_iso_timestamp`,
  `is_recent_timestamp`, `is_email`, `is_url`;
  aggregate (2): `count_equals`, `count_greater_than`.
  Bracket-notation target paths
  (`response.headers["X-Request-ID"]`) for keys with special
  characters. See [docs/assertions.md](./docs/assertions.md) for the
  authoritative list, operand shapes, and worked examples.
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

[Unreleased]: https://github.com/anshulgupta1791/apiwright/compare/v1.0.2...HEAD
[1.0.2]: https://github.com/anshulgupta1791/apiwright/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/anshulgupta1791/apiwright/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/anshulgupta1791/apiwright/releases/tag/v1.0.0
