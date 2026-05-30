# Configuration — `apiwright.config.json`

The configuration file holds the run-level settings that apply across
your whole suite: where declarations and environments live, what
markers run by default, how many workers, retry policy, what report
formats to produce.

CLI flags override config values; config values override built-in
defaults.

---

## Full example

```json
{
  "tests_dir": "./tests",
  "environments_dir": "./environments",
  "reports_dir": "./reports",
  "default_env": "qa",
  "default_markers": ["smoke"],
  "log_level": "warn",
  "workers": 4,
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

Pass via `--config`:

```bash
apiwright run --config ./apiwright.config.json
```

If `--config` is omitted, APIWright looks for `apiwright.config.json` in
the current working directory.

---

## Field reference

### Paths

| Field | Type | Default | What it does |
|---|---|---|---|
| `tests_dir` | string (path) | `./tests` | Where to find `*.endpoint.json` declarations. Walked recursively. |
| `environments_dir` | string (path) | `./environments` | Where to find `<env>.yaml` files (`name.yaml` resolved by `--env` / `default_env`). |
| `reports_dir` | string (path) | `./reports` | Where `run-<ts>.json` and friends are written. Must be writable. |

All three accept absolute paths or paths relative to the config file's
directory.

### Environment + markers

| Field | Type | Default | What it does |
|---|---|---|---|
| `default_env` | string | (none — must be set or pass `--env`) | Which environment YAML to load when `--env` is omitted on the CLI. |
| `default_markers` | string[] | `["smoke"]` | Which markers to include when `--markers` is omitted. Use `["all"]` for everything. |

### Logging

| Field | Type | Default | What it does |
|---|---|---|---|
| `log_level` | `"error"` \| `"warn"` \| `"info"` \| `"debug"` | `"warn"` | Console verbosity. `debug` logs every request/response and assertion trace — useful for diagnosing failing cases. |

CLI override: `--log debug`.

### Concurrency

| Field | Type | Default | What it does |
|---|---|---|---|
| `workers` | integer ≥ 1 | `4` | Number of cases to execute in parallel. Higher = faster but more load on the API and database. |

CLI override: `--workers N`.

### Retry policy

| Field | Type | Default | What it does |
|---|---|---|---|
| `retry.count` | integer 0–5 | `2` | How many times to retry a failed case before giving up. `0` = no retries. |
| `retry.delay_ms` | integer ≥ 0 | `1000` | Initial delay before the first retry. **Currently ignored from config — falls back to default 1000ms regardless. See [limitations.md](./limitations.md).** |
| `retry.backoff` | `"none"` \| `"linear"` \| `"exponential"` | `"linear"` | How `delay_ms` scales per retry attempt. **Currently ignored from config — falls back to `"linear"` regardless. See [limitations.md](./limitations.md).** |
| `retry.strict` | boolean | `false` | If `true`, any first-attempt failure marks the endpoint as `fail` even if a retry passes. If `false`, a retry-passed case is marked `flaky`. |

CLI override: `--retries N` (sets `retry.count` only).

### Report formats

| Field | Type | Default | What it does |
|---|---|---|---|
| `report.json` | boolean | `true` | Write `run-<ts>.json` — the structured run result (always recommended; downstream tooling consumes this). |
| `report.html` | boolean | `true` | Write `run-<ts>.html` — human-readable report for browsing locally / archiving as a CI artifact. |
| `report.junit_xml` | boolean | `true` | Write `run-<ts>.xml` — JUnit XML for CI test-result publishers (GitHub Actions, GitLab, Jenkins, Azure). |
| `report.output_dir` | string (path) | same as `reports_dir` | Where to write report files. Usually leave matching `reports_dir`. |

---

## CLI override matrix

When a flag is passed, it wins. When omitted, the config wins. When
the config doesn't set it either, the built-in default kicks in.

| CLI flag | Overrides config field |
|---|---|
| `--config <path>` | (the config file path itself) |
| `--env <name>` | `default_env` |
| `--markers <csv>` | `default_markers` (comma-separated list) |
| `--workers <N>` | `workers` |
| `--retries <N>` | `retry.count` |
| `--log <level>` | `log_level` |
| `--path <dir>` | (filter: only run cases whose declaration file lives under this path) |
| `--tag <tag>` | (filter: only run cases on endpoints carrying this tag) |
| `--endpoint <id>` | (filter: only run cases on this one endpoint id) |
| `--exclude-tag <csv>` | (filter: skip endpoints carrying any of these tags) |
| `--allow-non-smoke-in-prod` | (production-safety gate override) |

Filters are AND-combined: passing `--tag write --markers regression` runs
regression cases on endpoints tagged `write` only.

---

## File location discovery

Resolution order for `apiwright.config.json`:

1. `--config <path>` if passed on the CLI.
2. `./apiwright.config.json` (current working directory).
3. No config — apply built-in defaults to everything.

If `--config` is passed but the file doesn't exist, APIWright errors
out rather than silently falling back.

---

## Minimal config

The smallest useful config:

```json
{
  "tests_dir": "./tests",
  "environments_dir": "./environments",
  "default_env": "qa"
}
```

Everything else uses defaults. Reports go to `./reports`, marker is
`smoke`, 4 workers, 2 retries with 1000ms linear backoff, all three
report formats produced.

---

## Multi-environment pattern

The same `apiwright.config.json` runs against any environment — only
the YAML changes.

```
tests/                        ← endpoint declarations (one source of truth)
  users/
    create.endpoint.json
    list.endpoint.json
environments/                 ← one YAML per target
  dev.yaml
  qa.yaml
  staging.yaml
  prod.yaml
apiwright.config.json
```

Then:

```bash
apiwright run --env dev      --markers smoke
apiwright run --env qa       --markers smoke,regression
apiwright run --env staging  --markers smoke,regression
apiwright run --env prod     --markers smoke   # destructive cases auto-gated
```

The `prod` env sets `prod: true`, which gates non-smoke destructive
cases unless `--allow-non-smoke-in-prod` is passed explicitly.

---

## Per-CI-stage configs

If you want different defaults per CI stage (e.g. faster on PRs, more
thorough on nightly), have multiple configs:

```
configs/
  apiwright.pr.json         ← workers=8, markers=smoke, retries=0 (fail fast)
  apiwright.nightly.json    ← workers=4, markers=all, retries=2
```

```bash
# In PR CI job:
apiwright run --config configs/apiwright.pr.json --env qa

# In nightly CI job:
apiwright run --config configs/apiwright.nightly.json --env qa
```

Most teams find one config per (target × stage) hits the sweet spot —
flexible without explosion.

---

## Validation

APIWright validates the config against its schema at load time and
errors out with a clear message if something is malformed. Try:

```bash
apiwright validate ./tests --config ./apiwright.config.json
```

`validate` checks both the declarations and the config — it's the
zero-network correctness check you can run in pre-commit.

---

## See also

- [cli.md](./cli.md) — every command and flag.
- [environment-config.md](./environment-config.md) — the `environments/<env>.yaml`
  schema (separate from `apiwright.config.json`).
- [markers-and-lifecycle.md](./markers-and-lifecycle.md) — when to use
  which markers in which CI stage.
