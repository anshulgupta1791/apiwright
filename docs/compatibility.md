# Compatibility and SemVer policy

APIWright follows [Semantic Versioning 2.0](https://semver.org/spec/v2.0.0.html).
This document tells you, surface-by-surface, **what's stable** (a change
requires a MAJOR bump), **what's free to evolve** (MINOR or PATCH is
fine), and **how deprecation works** when something needs to go away.

The promise in one sentence: **a v1.x release should never break an
endpoint file, environment YAML, CLI invocation, report-consumer
script, or CI workflow that worked on a previous v1.x release.**

---

## Stable surfaces

Changing any of these requires a MAJOR version bump (1.x → 2.0). Bug
fixes that align behaviour to the documented contract are NOT
breaking, even if they change observable output (see [Bug-fix exceptions](#bug-fix-exceptions)).

### 1. `*.endpoint.json` schema

Every field documented in
[`docs/canonical-model.md`](./canonical-model.md). This includes:

- The top-level keys (`id`, `name`, `method`, `url`, `request`,
  `response`, `auth_strategy`, `tags`, `markers`, `prod_safe`,
  `db_verify`, `assertions`, `cleanup`, `retry`, `source`).
- The shape of `request.headers`, `request.body_schema`,
  `request.body_example`, `request.query_params`.
- The shape of `response.expected_status`, `response.schema`,
  `response.headers`, `response.sla_ms`.
- The `db_verify[]` entry shape — `connection`, `query`, `expect`,
  `fields`, `query_id`.
- The `retry` policy shape — `count`, `delay_ms`, `backoff`, `strict`.
- The interpretation of `${env.*}` / `${secret.*}` / `${request.*}` /
  `${response.*}` template references inside any string value.

> **What's NOT covered:** the **internal** sentinel placeholder format
> (` APIWRIGHT_PARAM_<N> `) used between the ref-extractor and the DB
> binders. That's an implementation detail of the runner; users never
> see it.

### 2. Environment YAML schema

Every field documented in
[`docs/environment-config.md`](./environment-config.md):

- Top-level keys (`name`, `prod`, `base_url`, `default_sla_ms`,
  `databases`, `auth_strategies`).
- The connection-config shape per `type` (postgres, mysql, mongodb,
  neo4j) — `host`, `port`, `database`, `user`, `password`, `uri`/`url`,
  `ssl`, plus the engine's documented extras.
- The two auth-strategy shapes (`static_token` and `token_endpoint`,
  including their nested fields).
- The `${secret.*}` resolution rules — read from `process.env`,
  registered into the redaction set automatically.

### 3. Assertion DSL

The grammar accepted by the `assertions` array:

- All 20 documented operators (`equals`, `not_equals`, `contains`,
  `starts_with`, `ends_with`, `matches`, `greater_than`, `less_than`,
  `between`, `in`, `exists`, `not_exists`, `is_null`, `not_null`,
  `count_equals`, `count_greater_than`, `count_less_than`,
  `is_uuid_v4`, `is_recent_timestamp`, `type_is`).
- Target-path syntax: dot notation, bracket notation (PR #89), and
  the four well-known roots (`request.*`, `response.*`, `db.*`,
  `env.*` inside RHS).
- The RHS literal grammar (numbers, strings, booleans, `null`, arrays
  in `in`/`between`/`count_equals`).
- Error-emission shape: `code`, `segmentIndex`, `offset`, `message`.

### 4. CLI surface

Every flag, subcommand, and exit code documented in
[`docs/cli.md`](./cli.md):

- The four subcommands: `validate`, `run`, `import`, `docs`.
- Their argument signatures.
- The flag set: `--env`, `--markers`, `--workers`, `--retries`,
  `--shard`, `--path`, `--tag`, `--endpoint`, `--exclude-tag`,
  `--allow-non-smoke-in-prod`, `--config`, `--log`, `--version`,
  `--help`, `--output` (on `import`), `--source` (on `docs`).
- Exit code mapping: 0 (pass), 1 (fail-after-retries), 2 (config /
  empty-plan), 3 (validation), 4 (prod-safety decline), 5 (deferred-
  seam — legacy), 70 (unexpected).

### 5. `apiwright.config.json`

The keys documented in [`docs/configuration.md`](./configuration.md):
`tests_dir`, `environments_dir`, `default_env`, `default_markers`,
`workers`, `retry.{count,delay_ms,backoff,strict}`, `log_level`,
`report.{html,json,junit_xml,output_dir}`, `prod_safe_default`.

**v1.0.2 additions (additive — no migration needed):**

- `skip_cases` on `*.endpoint.json` — opt out of specific generated
  test-case kinds at the endpoint level. Endpoint files from v1.0.x
  that do not include this field continue to work identically.
- `case_generation.skip_globally` in `apiwright.config.json` — opt out
  of specific kinds across the entire run. Configs from v1.0.x that do
  not include this key continue to work identically.
- `put_idempotency` — new §3 generator for PUT endpoints. Extends the
  generator set to 16 §3-generated kinds (was 15 pre-v1.0.2) and
  `ALL_SKIPPABLE_KINDS` to 17 entries (was 16). Endpoint files and
  configs from v1.0.1 continue to work unchanged. Existing `skip_cases`
  mechanisms automatically support the new kind. PUT endpoints that
  previously had no idempotency case now produce one additional
  regression case per endpoint.
- `head_get_parity` — new §3 generator for HEAD endpoints that declare
  `pair_with: "<get-endpoint-id>"`. Extends the generator set to 17
  §3-generated kinds and `ALL_SKIPPABLE_KINDS` to 18 entries (was 17).
  Opt-in only: HEAD endpoints without `pair_with` are unaffected.
  The new `pair_with` field on `*.endpoint.json` is additive; endpoint
  files from v1.0.0 / v1.0.1 that do not include it continue to work
  identically. Existing `skip_cases` mechanisms automatically support
  the new kind.

The set of recognised skippable kind names (18 as of v1.0.2) is part
of the v1.x stable surface. Removing or renaming a kind is a
major-version break. New kinds may be added in MINOR releases. See
[`docs/skip-cases.md`](./skip-cases.md) for the full reference.

### 6. Report artifact schemas

For machine-readable artifacts (JSON sidecar + JUnit XML), the shape
documented in [`docs/reports.md`](./reports.md). Specifically:

- **JSON report** — top-level `started_at` / `ended_at` / `env` /
  `filters` / `shard` / `workers` / `endpoints[]` / `summary{...}`;
  per-endpoint `endpoint_id` / `status` / `flaky` / `attempts[]` /
  `cleanup`; per-attempt `attempt` / `verdict` / `started_at` /
  `ended_at` / `request{...}` / `response{...}` / `assertions[]` /
  `db_verify[]` / `failure_reason`.
- **JUnit XML** — the `<testsuites>` / `<testsuite>` / `<testcase>`
  / `<failure>` nesting + the standard `name` / `classname` / `time`
  / `tests` / `failures` attributes.
- **Partial JSONL sidecar** — one `EndpointResult` per line in the
  same shape as the JSON report's `endpoints[]` entries.

The **HTML report** is for humans; its layout may change between
MINOR releases (visual refresh, new collapsible section). The
underlying JSON it embeds follows the rules above.

### 7. Environment variables consumed

- `ALLOW_PROD_DESTRUCTIVE` — gate flag.
- `APIWRIGHT_LOG_LEVEL` — override CLI default.
- `CI` — read by the husky bootstrap.
- `SKIP_TESTCONTAINERS` — opt-out for the real-DB integration tests
  (you only see this if you're running APIWright's own test suite).
- Any environment variable referenced by a `${secret.X}` in user
  config — those are user-defined, but the **lookup mechanism**
  (read from `process.env`, register into the redactor) is stable.

### 8. Docker image contract

- The image tag scheme: `<version>` (e.g. `1.0.0`), `latest`, `sha-<40>`.
- The image's `WORKDIR=/app`, the three documented mount points
  (`/app/tests`, `/app/environments`, `/app/reports`), the
  non-root `apiwright` user (uid 1001), the `ENTRYPOINT` (`tini` →
  `node dist/cli/entry.js`), the `HEALTHCHECK` (CLI `--version`).
- The OCI labels (`org.opencontainers.image.*`).

The image's **layer structure** and **size** are NOT stable — we
may switch the base image or restructure layers in a MINOR release.

### 9. The `apiwright` npm package's `main` and `bin`

- `main` points at the CLI entry; `bin.apiwright` runs the CLI.
- `types` points at the .d.ts shipped alongside `main`.
- The `engines.node` minimum (currently `>=22.0.0`) may TIGHTEN
  in a MAJOR; it will not loosen.

### 10. The Postman v2.1 + OpenAPI 3.x / Swagger 2.0 importers

The OUTPUT shape: one `*.endpoint.json` per request/operation,
named per the documented rules in
[`docs/postman-import.md`](./postman-import.md) and
[`docs/openapi-import.md`](./openapi-import.md). The mapping table
from each input source to `CanonicalEndpoint` fields is stable.

The INPUT we accept may evolve (e.g. accept a new OpenAPI 3.1
feature) — that's a MINOR. Refusing input we previously accepted
is a MAJOR.

---

## Internal surfaces — free to evolve

These can change in any MINOR or PATCH release without notice. If
you depend on them, that's at your own risk.

- Every TypeScript export not declared in `dist/cli/entry.d.ts`.
- Every internal class (`PostgresConnector`, `MongodbDriverSeam`,
  `AssertionEngine`, `RunReporter`, …) and its method signatures.
- The sentinel placeholder format (` APIWRIGHT_PARAM_<N> `).
- The coverage report shape under `coverage/` (istanbul / v8 — pure
  test artefact).
- Internal log message formats and `INFO:` / `WARN:` prefixes
  (with one exception: the `Run summary: ...` line is stable —
  PR #95 split it to a dedicated channel for this reason).
- The arrangement of `src/`. File moves, splits, and renames don't
  affect users; only `dist/cli/entry.{js,d.ts}` is the API.
- Internal env-loader state, secret-registry implementation,
  HTTP-client retry-loop wiring, promise-pool work-stealing, etc.

If you find yourself needing to import from a non-exported path
or depending on log-line shape — open an issue describing the
use case. We may promote the surface to stable, OR add a documented
mechanism that gives you what you need.

---

## Bug-fix exceptions

Some changes look breaking but **are not** under SemVer because the
prior behaviour was a documented bug:

- **Schema-validation bugs in the spec implementation.** If
  `docs/canonical-model.md` says field X must be a string and the
  validator wrongly accepted numbers, fixing the validator is a
  PATCH — the documented contract didn't change.
- **Assertion-parser bugs** like the B10 hyphen-in-target-path issue
  (PR #89). Adding bracket-notation support to ACCEPT a previously-
  rejected target path was a MINOR (new feature). Now retroactively
  rejecting paths that worked by accident under a buggy parser
  would be a MAJOR.
- **Security fixes** in `db_verify` parameter binding, secret
  redaction, prod-safety gating, etc. — always PATCH or MINOR, even
  if behaviour observably tightens. We will document the change in
  `CHANGELOG.md` and call it out in the release notes.

If you depended on a bug, the release notes will say so. Where
practical we offer a configuration flag to restore the old behaviour
for one MINOR release before the change becomes mandatory.

---

## Deprecation policy

When something stable needs to go away, the path is:

1. **Deprecation announcement.** A future-removal notice appears in:
   - The release notes for the release that introduces the warning.
   - A `DEPRECATED:` warning line emitted at runtime (visible at
     `--log warn` and above).
   - The relevant doc page, with a migration path.

2. **Deprecation window.** Minimum **one MINOR release** before
   removal. Typically **two**, so users on a slower upgrade cadence
   see at least one release with the warning before they hit the
   removal.

3. **Removal.** Happens in the next MAJOR (if the deprecated thing
   is on a stable surface) OR in a MINOR (if it's an internal
   surface — but those rarely warrant a deprecation cycle at all).

4. **Replacement.** Every deprecation announcement names the
   replacement. If we can't suggest one, the deprecation doesn't
   happen yet — we keep the thing supported and ask for input on
   GitHub Discussions instead.

---

## What's NOT covered by the policy

A few things are deliberately outside the SemVer contract:

- **The behaviour of the live `httpbin.org` working example.** It's a
  third-party service that can be slow, rate-limited, or down. The
  working example illustrates the framework; the behaviour against
  any specific HTTP endpoint depends on that endpoint.

- **Performance characteristics.** Throughput, memory, startup time
  are NOT contractual. We try to make them better release-on-release
  but we don't pin numbers.

- **Error-message wording.** The `code` field on every
  diagnostic is stable (e.g. `TARGET_TOO_LONG`,
  `DB_CONNECTION_FAILED`). The accompanying human-readable
  `message` may be rephrased for clarity in any release. If you
  match on text rather than `code`, you're outside the policy.

- **Log line text other than the run summary.** Same rule —
  match on level / structure / your own log-stream regex, not on
  prose wording.

---

## Versioning the v1.x line in practice

| Version family | What can change |
|---|---|
| v1.0.x (PATCH) | Bug fixes, security fixes, doc clarifications, internal refactors, test-only changes. No new flags, no new operators, no new schema fields. |
| v1.x.0 (MINOR) | New CLI flags (existing flags' defaults unchanged), new assertion operators, new schema fields (existing required-ness unchanged), new importer source formats, new report-format options, new DB drivers added to `optionalDependencies`. |
| v2.0.0 (MAJOR) | Anything that breaks a stable surface — rename a flag, remove an operator, tighten a schema requirement, change an exit-code mapping, etc. Will be preceded by deprecation warnings + a migration guide. |

---

## How to know if your change is breaking — quick test

1. **A v1.x release's existing endpoint files still load + validate**
   on the new version: not breaking.
2. **A v1.x release's existing environment YAML still loads + resolves**
   on the new version: not breaking.
3. **A user's CI script that parses `run-<ts>.json` still works** on
   the new version: not breaking.
4. **A working `apiwright run --env qa --markers smoke` invocation
   still runs and exits with the same code class** (0 / 1 / 2 / 3 /
   4): not breaking.

If any of these would regress, the change needs a MAJOR — even if
the code diff is one line.

---

## Related docs

- [`docs/limitations.md`](./limitations.md) — what v1.0 explicitly
  doesn't do (these are NOT bugs; documented absences).
- [`CHANGELOG.md`](../CHANGELOG.md) — the actual release history;
  every breaking change is called out.
- [`SECURITY.md`](../SECURITY.md) — security disclosure process
  (separate from the public release flow).
