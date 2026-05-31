# CLI Reference

The APIWright CLI is the single entry point for all framework operations —
validating endpoint definitions, running tests, importing collections, and
generating documentation. This document covers every command and flag, the
`apiwright.config.json` configuration schema, how CLI flags and config
interact, the production-safety confirmation flow, and the process exit codes
your CI scripts can rely on.

## Installation

The CLI ships inside the Docker image. No host-side installation is required:

```bash
docker run --rm ghcr.io/<org>/apiwright:1.0.0 --help
```

If you are running from a local checkout with Node.js 22 LTS:

```bash
npm install
npm run build
node dist/cli/entry.js --help
```

---

## Quick Reference

```
apiwright --help
apiwright --version

apiwright validate <dir>
apiwright run [options]
apiwright import postman <file> --output <dir> [--config <path>]
apiwright import openapi <source> --output <dir> [--config <path>]
apiwright docs generate --output <dir> [--source <dir>] [--config <path>]
```

---

## Global Flags

| Flag | Description |
|---|---|
| `--version` | Print the framework version and exit (exit 0). |
| `--help` | Print the top-level help text and exit (exit 0). |

---

## Commands

### `apiwright validate <dir>`

Validates every `*.endpoint.json` file and every `*.yaml` / `*.yml` file found
recursively under `<dir>` against the canonical schemas.

- Endpoint files are validated against the canonical meta-schema via the core
  `SchemaValidator`. JSON parse errors and schema violations are both reported.
- Environment YAML files are validated through the full `EnvironmentLoader`
  pipeline: YAML parse, `${env.*}` resolution, `${secret.*}` resolution, and
  schema conformance. See [Environment & Configuration](./environment-config.md)
  for the YAML schema and resolution rules.
- `*.flow.json` files are noted as reserved and skipped.
- All other files are silently ignored.

**Arguments**

| Argument | Description |
|---|---|
| `<dir>` | Directory to walk recursively for endpoint and environment files. Required. |

**Exit codes**

| Code | Meaning |
|---|---|
| 0 | All files passed validation. |
| 2 | `<dir>` does not exist; contains no validatable files; or contains environment YAML but zero `*.endpoint.json` files (usage error). |
| 3 | One or more files failed validation. |

**Examples**

```bash
# Validate the default tests directory
apiwright validate ./tests

# Validate a specific service sub-directory
apiwright validate ./tests/user-service

# In Docker
docker run --rm -v $(pwd):/work ghcr.io/<org>/apiwright:1.0.0 \
  validate /work/tests
```

**Output**

Each file prints a single `PASS` or `FAIL` line. Failures include the specific
validation errors below the file path. The run ends with a summary line.

On full success:

```
INFO: PASS tests/user-service/users/create.endpoint.json
INFO: PASS environments/qa.yaml
INFO: Validated 1 endpoint file(s) and 1 environment file(s) — OK
```

On partial failure (exit 3):

```
INFO: PASS tests/user-service/users/create.endpoint.json
ERROR: FAIL tests/payment-service/charge.endpoint.json
ERROR:   /response/expected_status response.expected_status must be an HTTP status code (100-599)
INFO: PASS environments/qa.yaml
INFO: Validated 2 endpoint file(s) and 1 environment file(s) — 1 passed, 1 failed
ERROR: 1 file(s) failed validation
```

On a directory with environment YAML but zero `*.endpoint.json` files (exit 2):

```
ERROR: no endpoint files (*.endpoint.json) found under <dir>
  (found N environment file(s) but zero endpoints — check your tests_dir
  / glob, or remove the environments and re-run from a different root)
```

---

### `apiwright run`

Resolves configuration, loads the named environment, evaluates the production-
safety gate, and delegates to the test-runner engine.

The test-runner engine is available in a later release. In the current release,
`apiwright run` performs all setup steps (config resolution, environment loading,
prod-safety evaluation) and exits with code 5 to indicate the engine is not yet
present. CI scripts may use this to validate wiring before the runner ships.

**Options**

| Flag | Description | Default |
|---|---|---|
| `--env <name>` | Environment name to load (e.g. `qa`, `prod`). | `config.default_env` |
| `--markers <csv>` | Comma-separated test markers: `smoke`, `regression`, `e2e`, or `all`. | `config.default_markers` |
| `--log <level>` | Console log level: `error`, `warn`, `info`, `debug`. | `config.log_level` |
| `--workers <n>` | Number of parallel workers (positive integer). | `config.workers` |
| `--retries <n>` | Retry count per test, 0–5. Overrides `config.retry.count` for this run only. | `config.retry.count` |
| `--shard <N/M>` | Run only the Nth slice of M (1-based). The plan is deterministically ordered before slicing so the same input produces the same slice; ideal for parallel CI matrix jobs. Validated: `1 <= N <= M` and `M >= 1`. | (no sharding) |
| `--path <dir>` | Run only endpoints whose file lives under this directory subtree. Combines (AND) with other filters. | (all paths) |
| `--tag <tag>` | Run only endpoints declaring this `tags` entry. Combines (AND) with other filters. | (all tags) |
| `--endpoint <id>` | Run only the single endpoint matching this declared `id`. Combines (AND) with other filters. | (all endpoints) |
| `--exclude-tag <csv>` | Exclude endpoints carrying any of these tags. Comma-separated list. Combines (AND) with other filters. | (none excluded) |
| `--allow-non-smoke-in-prod` | Permit non-smoke markers against a `prod: true` environment in CI. See [Production-safety gate](#production-safety-gate). | `false` |
| `--config <path>` | Path to an `apiwright.config.json` file. Overrides the default repo-root lookup. | `./apiwright.config.json` |

**Exit codes**

| Code | Meaning |
|---|---|
| 0 | All tests passed. |
| 1 | One or more tests failed after retries. Matches the pytest / vitest / mocha convention so CI tooling Just Works. |
| 2 | Config load error, unrecognised flag value, or empty test plan (`RUNNER_PLAN_EMPTY` / `RUNNER_SHARD_INVALID`). |
| 3 | Pre-flight validation failed: schema-invalid endpoint JSON, parse error, or declared assertion is malformed. Mirrors `apiwright validate` for the same input. |
| 4 | Production-safety gate declined (interactive `CONFIRM` not typed, or CI fail-fast). |
| 5 | A deferred seam was invoked before its engine has been implemented (legacy v0.x; should not appear in v1.0+). |
| 70 | Unexpected internal error (sysexits `EX_SOFTWARE`). |

**Examples**

```bash
# Smoke tests against QA (uses config defaults if --env omitted)
apiwright run --env qa --markers smoke

# Full regression run with verbose output
apiwright run --env qa --markers smoke,regression --log info

# All markers, higher worker count for a fast machine
apiwright run --env qa --markers all --workers 16

# Smoke-only against production (no confirmation prompt)
apiwright run --env prod --markers smoke

# Non-smoke against production (triggers confirmation prompt in interactive mode)
apiwright run --env prod --markers regression

# Use a non-default config file
apiwright run --env staging --config ./ci/apiwright.config.json

# Override retry count for a single debugging run
apiwright run --env qa --markers smoke --retries 0
```

---

### `apiwright import postman <file>`

Imports a Postman v2.1 collection file and converts it to `*.endpoint.json`
files in the output directory. One file is written per Postman request,
organised into subdirectories that mirror the collection's folder hierarchy.

See [Importing Postman Collections](./postman-import.md) for a full guide
covering folder mapping, variable templating, auth extraction, response
seeding, disabled-request handling, and a worked example.

**Arguments**

| Argument | Description |
|---|---|
| `<file>` | Path to a Postman v2.1 `.json` collection file. Required. |

**Options**

| Flag | Description | Default |
|---|---|---|
| `--output <dir>` | Directory to write generated endpoint files. Required. | — |
| `--config <path>` | Path to `apiwright.config.json`. | `./apiwright.config.json` |

**Exit codes**

| Code | Meaning |
|---|---|
| 0 | Import completed. Check summary output for any warnings. |
| 2 | Usage error (missing required argument or flag). |
| 70 | Unexpected internal error. Re-run with `--log debug` for the full trace. |

**Examples**

```bash
apiwright import postman ./collections/users.postman_collection.json \
  --output ./tests/user-service

docker run --rm -v $(pwd):/work ghcr.io/<org>/apiwright:1.0.0 \
  import postman /work/collections/users.postman_collection.json \
  --output /work/tests
```

---

### `apiwright import openapi <source>`

Imports an OpenAPI 3.x or Swagger 2.0 specification and converts it to
`*.endpoint.json` files. The source may be a local file path or a URL.

The OpenAPI importer is available in a later release. In the current release
this command exits with code 5.

**Arguments**

| Argument | Description |
|---|---|
| `<source>` | Local file path or HTTPS URL to an OpenAPI/Swagger spec. Required. |

**Options**

| Flag | Description | Default |
|---|---|---|
| `--output <dir>` | Directory to write generated endpoint files. Required. | — |
| `--config <path>` | Path to `apiwright.config.json`. | `./apiwright.config.json` |

**Exit codes**

| Code | Meaning |
|---|---|
| 0 | Import completed successfully (available in a later release). |
| 2 | Usage error (missing required argument). |
| 5 | Importer engine not yet available in this release. |
| 70 | Unexpected internal error. |

**Examples**

```bash
# From a local file
apiwright import openapi ./specs/payments.openapi.json --output ./tests/payments

# From a live spec URL
apiwright import openapi https://api.example.com/openapi.json --output ./tests
```

---

### `apiwright docs generate`

Generates per-endpoint Markdown documentation from the endpoint definitions in
the configured tests directory.

The documentation generator engine is available in a later release. In the
current release this command performs config resolution and exits with code 5.

**Options**

| Flag | Description | Default |
|---|---|---|
| `--output <dir>` | Directory to write generated Markdown files. Required. | — |
| `--source <dir>` | Override `config.tests_dir` for this run. | `config.tests_dir` |
| `--config <path>` | Path to `apiwright.config.json`. | `./apiwright.config.json` |

**Exit codes**

| Code | Meaning |
|---|---|
| 0 | Generation completed successfully (available in a later release). |
| 2 | Usage error. |
| 5 | Generator engine not yet available in this release. |
| 70 | Unexpected internal error. |

**Examples**

```bash
apiwright docs generate --output ./docs/endpoints

# Override the source directory for this run only
apiwright docs generate --source ./tests/user-service --output ./docs/user-service
```

---

## `apiwright.config.json` Reference

`apiwright.config.json` in the repository root is the single source of truth
for framework-wide defaults. Every field is optional — a missing file or a
file with only some keys filled in causes the framework to fill in defaults
silently; it never errors on a missing config file.

### Complete schema with defaults

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

### Field reference

| Field | Type | Default | Description |
|---|---|---|---|
| `tests_dir` | string | `"./tests"` | Directory the runner walks for `*.endpoint.json` files. |
| `environments_dir` | string | `"./environments"` | Directory where environment YAML files live (see [Environment file resolution](#environment-file-resolution)). |
| `reports_dir` | string | `"./reports"` | Directory where test reports are written. |
| `default_env` | string | `"qa"` | Environment name used when `--env` is not passed. |
| `default_markers` | string[] | `["smoke"]` | Markers used when `--markers` is not passed. Values: `"smoke"`, `"regression"`, `"e2e"`. |
| `log_level` | string | `"warn"` | Console verbosity. Values: `"error"`, `"warn"`, `"info"`, `"debug"`. |
| `workers` | integer | `8` | Number of parallel Playwright workers. |
| `retry.count` | integer | `2` | Retry attempts per failing test (0–5). Total attempts = count + 1. |
| `retry.delay_ms` | integer | `1000` | Milliseconds to wait before the first retry. |
| `retry.backoff` | string | `"linear"` | Backoff strategy: `"none"`, `"linear"`, or `"exponential"`. |
| `retry.strict` | boolean | `false` | When `true`, any first-attempt failure is reported as failed even if a retry passes. |
| `report.html` | boolean | `true` | Emit an HTML technical report. |
| `report.json` | boolean | `true` | Emit a JSON sidecar alongside the HTML report. |
| `report.junit_xml` | boolean | `true` | Emit JUnit XML for CI reporting integration. |
| `report.output_dir` | string | `"./reports"` | Directory for report files (can differ from `reports_dir` if desired). |

### `--config <path>` override

When you pass `--config <path>` on any command, the loader reads that file
instead of `./apiwright.config.json`. Useful for:

- CI-specific config that differs from local config.
- Monorepos with multiple distinct test suites, each with its own config.
- Temporary debugging overrides without modifying the committed config.

```bash
apiwright run --env staging --config ./ci/apiwright.staging.config.json
apiwright docs generate --output ./docs/api --config ./ci/apiwright.staging.config.json
```

Note: `apiwright validate` does NOT accept `--config`; it walks the given
directory and validates each file in isolation, so configuration is not
needed. The flag is supported on `run`, `import postman`, `import openapi`,
and `docs generate`.

### Config vs. flag precedence

CLI flags take precedence over the config file for a single run. The config
file is never mutated.

| Value | Source |
|---|---|
| `--env qa` | CLI flag wins; `default_env` in config is ignored for this run. |
| `--markers smoke` | CLI flag wins; `default_markers` in config is ignored. |
| `--log debug` | CLI flag wins; `log_level` in config is ignored. |
| `--workers 4` | CLI flag wins; `workers` in config is ignored. |
| `--retries 0` | CLI flag wins; `retry.count` in config is ignored. |
| (flag absent) | Config value (or built-in default if config absent) is used. |

---

## Environment File Resolution

When `apiwright run --env <name>` executes, the environment loader looks for
the named environment's YAML file in two locations under the repository root,
in this order:

1. `<repo-root>/.env.<name>.yaml` — root-level dotfile; gitignored; for local
   overrides and real secrets on a developer's machine.
2. `<repo-root>/environments/<name>.yaml` — the committed, version-controlled
   file; uses `${secret.*}` references instead of literal credentials.

The loader tries the dotfile first. If it exists, it is used exclusively — the
`environments/` fallback is never consulted. The fallback is only tried when
the dotfile is genuinely absent. A dotfile that is present but malformed or
empty produces its own error; it does not silently fall through.

The `environments_dir` config field (default `./environments`) tells the
framework where the committed environment files live. Set it to the
`environments/` directory itself — for example `"./environments"` or an
absolute path. The loader derives the repo root as the parent of that
directory and then resolves the committed fallback path as
`<parent>/environments/<name>.yaml`. With the default `"./environments"` this
is simply `./environments/<name>.yaml` relative to the repo root.

For the full YAML schema, template namespaces, secret resolution, and worked
examples, see [Environment & Configuration](./environment-config.md).

---

## Production-Safety Gate

The prod-safety gate prevents accidental destructive test runs against
production environments.

### How it works

Every environment YAML declares `prod: true` or `prod: false`. When
`prod: true`:

- `--markers smoke` — allowed immediately, no prompt.
- Any other marker combination (e.g. `--markers regression`, `--markers all`)
  — triggers the gate.

### Interactive mode (local terminal)

When the CLI is running in an interactive terminal and the gate triggers, it
prints:

```
WARNING: You are about to run non-smoke tests against prod. Type 'CONFIRM' to proceed:
```

Type `CONFIRM` (exactly, case-sensitive) and press Enter to proceed. Any
other response aborts the run with exit code 4.

### CI mode

The CLI detects CI automatically via the `CI` environment variable (set by
GitHub Actions, Jenkins, GitLab CI, Azure Pipelines, and most CI platforms).

In CI, the prompt is never shown. Instead:

- Without `--allow-non-smoke-in-prod` or without `ALLOW_PROD_DESTRUCTIVE=true`
  in the environment: the run fails fast with exit code 4 and a message
  explaining both requirements.
- With `--allow-non-smoke-in-prod` **and** `ALLOW_PROD_DESTRUCTIVE=true` set
  as an environment variable: the run proceeds.

Both conditions must be satisfied simultaneously — the flag alone is not
sufficient in CI.

**Example CI configuration (GitHub Actions):**

```yaml
- name: Run smoke tests in production
  run: apiwright run --env prod --markers smoke
  # No special flags needed; smoke-only is always allowed.

- name: Run regression against production (exceptional; requires explicit gate)
  run: apiwright run --env prod --markers regression --allow-non-smoke-in-prod
  env:
    ALLOW_PROD_DESTRUCTIVE: "true"
```

### Summary table

| Environment `prod` | Markers | Mode | Outcome |
|---|---|---|---|
| `false` | any | any | Always allowed. |
| `true` | smoke only | any | Allowed without prompt. |
| `true` | any non-smoke | interactive | Prompt shown; `CONFIRM` required. |
| `true` | any non-smoke | CI, no flag | Fail fast, exit 4. |
| `true` | any non-smoke | CI, flag only | Fail fast, exit 4. |
| `true` | any non-smoke | CI, flag + env var | Allowed. |

---

## Exit Codes

All APIWright CLI commands use a consistent exit-code vocabulary. CI scripts
and pipeline tools can branch on these codes reliably.

| Code | Name | Meaning |
|---|---|---|
| 0 | SUCCESS | Command completed successfully. |
| 1 | TEST_FAILURE | `apiwright run` completed but at least one test case failed after retries. Matches the pytest / vitest / mocha convention so CI tooling Just Works. |
| 2 | USAGE | Bad flag, malformed or schema-invalid config, unknown command, missing required argument, or empty test plan. Stack trace not shown. |
| 3 | VALIDATION | `apiwright validate` found at least one invalid file, OR `apiwright run` was given a directory whose endpoint JSONs fail meta-schema validation at startup (same contract — both commands agree). |
| 4 | PROD_SAFETY | Prod-safety gate declined: interactive user did not type `CONFIRM`, or CI fail-fast triggered. |
| 5 | NOT_IMPLEMENTED | A deferred seam was invoked before its engine has been implemented. v1.0+ should not produce this; reserved for forward-compat. |
| 70 | INTERNAL | Unexpected internal error (maps to sysexits `EX_SOFTWARE`). Stack trace is printed at `--log debug`. |

Stack traces are suppressed except at `--log debug`. If a command exits with
code 70 and you need the trace, re-run with `--log debug` appended.

---

## Log Levels

The `--log` flag (and `log_level` in config) controls what the CLI prints to
the console during a run. Everything is always captured in the test report
regardless of log level; the flag only controls console verbosity.

| Level | What is shown |
|---|---|
| `error` | Test failures only (after retries exhausted). No per-test progress, no retry notices. Final summary only. |
| `warn` | (default) Failures plus a one-line notice for each flaky test. No request/response dumps. |
| `info` | Above plus per-test progress (one line per test) and retry-attempt summaries. |
| `debug` | Above plus full request/response bodies for every attempt, DB query results, assertion evaluation traces, and stack traces on error. Produces large output on sizeable suites. |

---

## Common Pitfalls

**`validate` exits with code 2 on a directory that exists**

The directory exists but contains no `*.endpoint.json` or `*.yaml`/`*.yml`
files. Check the path and that endpoint files follow the `.endpoint.json`
naming convention.

**`run` exits with code 2 mentioning config errors**

The `apiwright.config.json` at the repo root has a JSON syntax error or a
field with an invalid type (e.g. `"workers": "eight"`). Run
`apiwright validate` or check the file against the schema above.

**`run` exits with code 4 in CI**

The environment is `prod: true` and markers include non-smoke tests. Either:
- Switch to `--markers smoke` for the production run.
- Add `--allow-non-smoke-in-prod` to the CLI invocation **and** set
  `ALLOW_PROD_DESTRUCTIVE=true` in the CI job's environment.

**`run` exits with code 5**

The test-runner engine ships in a later release. This is expected behaviour for
the current release.

**Environment file not found**

The loader looks for `.env.<name>.yaml` at the repo root and
`environments/<name>.yaml` under the directory determined by `environments_dir`.
Confirm both spellings match the `--env` value (names are case-sensitive and
must match `^[A-Za-z0-9_-]+$`).

---

## Related Documentation

- **[Environment & Configuration](./environment-config.md)** — Full YAML schema,
  secret resolution, per-environment overrides, and worked examples.
- **[Importing Postman Collections](./postman-import.md)** — Full guide to
  `apiwright import postman`: folder mapping, variable templating, auth
  extraction, response seeding, and a worked example.
- **[Authoring Endpoints](./authoring-endpoints.md)** — Writing and organising
  `*.endpoint.json` files.
- **[Canonical Model Reference](./canonical-model.md)** — The endpoint JSON
  schema that `validate` checks against.
- **[CI Integration](./ci-integration.md)** — GitHub Actions, Jenkins, GitLab CI,
  and Azure Pipelines reference workflows.
